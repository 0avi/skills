# Triage: From Symptom to Cause

The entry point for every performance investigation. Work down from the symptom the user actually reported, run the measurement at each branch, and only then open the reference that fixes it.

**The rule that outranks everything else here: adding load to a saturated component makes the whole system slower.** So a local optimisation can produce a global regression. Establish which component is the constraint before touching any of them, and if the constraint is not the JVM, say so and stop.

| Symptom as reported | First measurement | Most likely causes |
| ------------------- | ----------------- | ------------------ |
| "It's slow" (no detail) | Ask: slow for one user, or slow overall? | Response time vs throughput - a different investigation each way |
| Individual requests slow, CPU low | Thread dumps or JFR - what are threads waiting on? | Blocking I/O, lock contention, external system, undersized pool |
| Individual requests slow, CPU high | Profile (JFR or async-profiler) | Hot method, allocation pressure, GC, algorithmic cost |
| Throughput plateaus below expectation | CPU per component, then run queue | Saturated CPU, lock contention, pool throttle, external limit |
| Occasional very slow requests, most fine | GC log first, always | GC pauses, safepoints, JIT deoptimisation, network |
| Getting slower over hours or days | Heap after full GC, and RSS | Heap leak, native leak, cache growing unbounded, metaspace |
| `OutOfMemoryError` | Read the error's own message | Six distinct causes - see the taxonomy below |
| Slow first requests, then fine | `-Xlog:class+load`, JIT log | Class loading, JIT warm-up, cold caches, pool ramp-up |
| Container restarts / OOM-killed | RSS against the limit, then NMT | Total footprint, not heap - heap is only part of it |
| Fast in dev, slow in production | Compare CPU count, memory limit, JDK | Ergonomic defaults differ; network latency is real there |

---

## Step 0: Establish the ground truth first

Four questions, before any measurement. Getting these wrong wastes the entire investigation.

1. **What is the actual metric, and what is the target?** "Slow" is not a metric. Average response time, 99th percentile, requests per second and batch elapsed time all lead to different work, and optimising one can degrade another. See [methodology.md](methodology.md).
2. **Which JDK runs it, and on what?** Version, vendor, CPU count, memory limit, container or not. Defaults derive from all of these. `java -XX:+PrintFlagsFinal -version` on the actual host, not your laptop.
3. **Is the JVM even the constraint?** If the database is saturated, no amount of JVM tuning helps and some of it hurts.
4. **Did this regress, or was it always like this?** A regression has a cause you can bisect. A never-met target is a capacity or design question.

```bash
# the one-shot situational snapshot; run on the affected host
jcmd <pid> VM.version                 # JDK build actually running
jcmd <pid> VM.command_line            # what it was started with
jcmd <pid> VM.flags -all              # every flag, including ergonomic values
jcmd <pid> VM.uptime
jcmd <pid> GC.heap_info               # committed vs used, by generation
jcmd <pid> Thread.print               # what every thread is doing right now
```

### Collect this *before* the problem recurs

Most investigations stall because the evidence was not being captured when the incident happened. All three of these are cheap enough for production and should already be on:

| What | How | Overhead |
| ---- | --- | -------- |
| GC log, always on, rotating | `-Xlog:gc*:file=gc.log:time,uptime,level,tags:filecount=8,filesize=16M` (11+) | Negligible |
| JFR, always on, dumped on demand | `-XX:StartFlightRecording=maxsize=256m,maxage=6h,settings=default` (11+) | ~1% |
| Heap dump on OOM | `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/log/dumps` | Only on failure |

**Turning these on after the incident means waiting for the next one.** Recommend them as a first action even when they do not diagnose today's problem.

---

## Branch A: Long pauses, or occasional slow outliers

The signature is a good average with a bad tail. **Read the GC log before forming any other hypothesis** - it is the cheapest evidence in the JVM and it either implicates or exonerates GC in one pass.

```bash
# already running without GC logging? On 11+ you can turn it on live:
jcmd <pid> VM.log output=gc.log what=gc*  decorators=time,uptime,level,tags
```

What to read, in order:

1. **Total fraction of wall clock spent paused.** Under ~3% and GC is not your problem - look elsewhere even if the pauses are visible. Over ~10% and it is worth real effort.
2. **Pause distribution, not the mean.** One 4-second full GC matters more than a thousand 20 ms young collections, and only the tail shows it.
3. **Are there full GCs at all?** With G1, ZGC or Shenandoah a full GC is a *failure signal*, not routine. Its cause string names the failure: `Allocation Failure`, `G1 Humongous Allocation`, `Metadata GC Threshold`, `System.gc()`.
4. **Heap occupancy immediately after each full GC.** This is the live set. If it climbs monotonically across full GCs, you have a leak - go to Branch D, not to tuning.
5. **`System.gc()` appearing at all.** Something is calling it. Find the caller. If you cannot change it, use `-XX:+ExplicitGCInvokesConcurrent`, **not** `-XX:+DisableExplicitGC` - the latter breaks direct `ByteBuffer` reclamation and is a measured cause of `OutOfMemoryError: Direct buffer memory` on all of 8/11/17/21/25. See [garbage-collection.md](garbage-collection.md).

Then: [garbage-collection.md](garbage-collection.md) to confirm the collector is the right one, and [gc-tuning.md](gc-tuning.md) for the fix.

**If the pauses are not GC**, the remaining causes in rough order of likelihood: a safepoint that is slow to reach (`-Xlog:safepoint`), JIT deoptimisation storms, page faults from swapping (check the OS - a swapping JVM performs terribly and the JVM cannot see it), and network retransmits. Never let a system swap; see [native-memory.md](native-memory.md).

---

## Branch B: High CPU

Establish whether the CPU is doing *your* work before optimising your work.

```bash
# Linux: which threads, and how much
top -H -p <pid>
# then map the OS thread id (decimal) to the Java thread: nid=0x<hex> in the dump
jcmd <pid> Thread.print | grep -A3 "nid=0x$(printf %x <tid>)"
```

| Where the CPU is | Evidence | Go to |
| ---------------- | -------- | ----- |
| Application methods | Profile shows your packages | Optimise the hot path; check allocation first |
| GC threads | GC log shows high pause total or high concurrent CPU | [gc-tuning.md](gc-tuning.md) |
| JIT compiler threads (`C2 CompilerThread*`) | Busy only during warm-up | Normal. Only act if it persists - [jit-compiler.md](jit-compiler.md) |
| Kernel / system time high | `vmstat` shows high `sy` | I/O or syscall pattern - usually unbuffered I/O, see [io-performance.md](io-performance.md) |
| Spread thin across everything | No single hot method | Often allocation pressure or excessive small work - profile allocation, not CPU |

**A profile's top method is where to start looking, not what to fix.** If `ObjectOutputStream.writeObject0` is at the top, the fix is to serialize less, not to make that method faster. Read up the call tree to the frame you own. See [tooling.md](tooling.md) for reading profiles, and the safepoint bias that makes some profilers systematically wrong.

**Counter-intuitive but important: for a batch job, high CPU is the goal.** Idle CPU during a fixed workload means something is blocked. Driving utilisation *up* shortens the job. Only for a fixed-arrival-rate service does lower CPU per request represent a win.

---

## Branch C: Low throughput, or a throughput ceiling

```
Is CPU saturated on the JVM host?
├─ Yes → the JVM or its code is the constraint
│        → profile; check GC fraction; check whether the work is parallelised at all
└─ No  → something is throttling. In order of likelihood:
         ├─ A pool is too small        → thread pool, connection pool, HTTP client pool
         ├─ Lock contention            → JFR monitor-blocked events, thread dumps
         ├─ An external system         → DB, another service - measure *its* utilisation
         └─ The load generator itself  → check the client is not the bottleneck
```

The load generator is a genuine and frequently missed cause: a client that cannot issue requests fast enough measures itself. If client CPU is near saturation, or the client does per-response work, fix the harness before believing the number.

Amdahl's law is the ceiling on all of it: with 20% of the work serialised, eight CPUs buy about 3.3x, not 8x. If scaling has flattened, find the serial section. See [concurrency-performance.md](concurrency-performance.md).

---

## Branch D: Memory grows over time

**Distinguish heap growth from process growth first - they have entirely different causes and fixes.**

```bash
jcmd <pid> GC.heap_info          # Java heap
# compare against RSS: ps -o rss= -p <pid>   (Linux)  /  Task Manager working set (Windows)
```

| Observation | Meaning | Go to |
| ----------- | ------- | ----- |
| Heap after full GC climbs monotonically | Java heap leak | [heap-analysis.md](heap-analysis.md) |
| Heap flat, RSS climbing | Leak outside the heap | [native-memory.md](native-memory.md) |
| Metaspace climbing | Class loader leak - classes not being unloaded | [heap-analysis.md](heap-analysis.md) |
| Both flat, container still killed | Footprint was always too big; it just took time to touch it | [containers.md](containers.md) |

The discriminator for a heap leak is **occupancy after a full GC**, not occupancy at any moment. A sawtooth that returns to the same floor is healthy no matter how alarming the peaks. Force a collection and read the floor:

```bash
jcmd <pid> GC.run                              # full GC, then re-read GC.heap_info
jcmd <pid> GC.class_histogram | head -25       # forces a full GC; top consumers by class
```

Take two dumps minutes or hours apart and diff the histograms - the class whose instance count grows without bound names the leak. Collection classes are the usual culprit: something is added and never removed.

---

## Branch E: `OutOfMemoryError`

**Read the message. It tells you which of six different problems you have, and only two are "the heap is too small".**

| Message | Cause | Fix direction |
| ------- | ----- | ------------- |
| `Java heap space` | Live set exceeds the heap | Leak, or genuinely needs more heap - [heap-analysis.md](heap-analysis.md) |
| `GC overhead limit exceeded` | Spending ~98% of time in GC, reclaiming <2% | Almost always a leak, occasionally a heap far too small |
| `Metaspace` | Class metadata exhausted | Class loader leak, or `MaxMetaspaceSize` set too low |
| `unable to create new native thread` | **Usually not memory at all** - an OS process/thread limit (`ulimit -u`), or thread stacks exhausting address space | Reduce thread count, or `-Xss`, or raise the limit |
| `Direct buffer memory` (17+: `Cannot reserve N bytes...`) | `MaxDirectMemorySize` reached | **Rule out `-XX:+DisableExplicitGC`**, then leak, then cap - [native-memory.md](native-memory.md) |
| `Requested array size exceeds VM limit` | A single array over the implementation limit | An algorithmic bug, not a tuning problem |

A JVM often *survives* an `OutOfMemoryError`: it kills one thread, whose objects then become collectable, and continues in a degraded state. That is why the error sometimes appears in a log hours before anyone notices. Use `-XX:+ExitOnOutOfMemoryError` when you would rather fail fast and let the orchestrator restart, which in a container is usually the right choice.

---

## Branch F: Slow startup, or slow first requests

Separate the two - they have different fixes.

| Which | Test | Fix |
| ----- | ---- | --- |
| Startup: time to become ready | Time to the ready log line | Class loading, CDS, AOT cache - [startup-and-warmup.md](startup-and-warmup.md) |
| Warm-up: ready but slow for a while | Compare request N=1 to N=10,000 | JIT warm-up; also caches, pools, JPA L2 |

```bash
jcmd <pid> VM.classloader_stats             # 8+  ; loaders, classes, bytes each
jcmd <pid> VM.classloaders                  # 11+ ; the loader tree
java -Xlog:class+load:file=cl.txt ...       # 9+  ; what was loaded and from where
java -XX:+PrintCompilation ...              # JIT progress; noisy, use for triage only
```

For a short-lived process (a CLI, a lambda, a batch job under a minute) the trade-off inverts: C2's better code never pays for itself. `-XX:TieredStopAtLevel=1` and the AOT cache are the levers. For a long-lived server, never do that - you would cap it at C1-quality code forever.

---

## Branch G: Lock contention

Suspect it when CPU is *low*, throughput is flat, and threads are numerous.

```bash
# best: JFR - jdk.JavaMonitorEnter events name the lock, the blocked duration and the stack
jfr summary recording.jfr
jfr print --events jdk.JavaMonitorEnter recording.jfr | head -60

# without JFR: several thread dumps a few seconds apart, then look for repetition
for i in 1 2 3 4 5; do jcmd <pid> Thread.print > td-$i.txt; sleep 3; done
grep -c "BLOCKED" td-*.txt
```

Many threads `BLOCKED` on the same monitor across successive dumps is contention. Many `WAITING` in a pool's `getTask` is idleness, which is normal. Many blocked in `socketRead0` is an external system, not a lock - go to Branch C.

Do not build a profiler out of repeated thread dumps: safepoint bias and inconsistent snapshots make the results unreliable. They are good for "are threads blocked, and on what", not for "where is time spent". See [concurrency-performance.md](concurrency-performance.md).

---

## When to conclude the JVM is not the problem

State this plainly when it is true; it is a valid and common outcome:

- CPU low, GC under 3%, no lock contention, threads blocked on I/O → the constraint is downstream. Measure that system's utilisation. See [database-performance.md](database-performance.md) or [server-performance.md](server-performance.md).
- Response time is dominated by network transit → payload size and round-trip count, not the JVM. See [server-performance.md](server-performance.md).
- The system is swapping → fix the memory configuration; nothing else will help until you do.
- The algorithm is quadratic → no flag will fix an `O(n²)` loop. This is the single largest performance factor and it is not a tuning question.

---

## Version notes

Triage tooling differs sharply by version, and this is where investigations on old JDKs stall.

| Capability | 8 | 11 | 17 | 21 | 25 |
| ---------- | - | -- | -- | -- | -- |
| Unified `-Xlog` GC logging | ✗ (`PrintGCDetails` etc.) | ✓ | ✓ | ✓ | ✓ |
| JFR usable | **8u262+** | ✓ | ✓ | ✓ | ✓ |
| `jfr` CLI for offline recordings | ✓ (8u504) | ✓ | ✓ | ✓ | ✓ |
| `jcmd VM.log` to enable logging live | ✗ | ✓ | ✓ | ✓ | ✓ |
| `jcmd VM.classloader_stats` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `jcmd VM.classloaders` (loader tree) | ✗ | ✓ | ✓ | ✓ | ✓ |
| `jcmd Thread.dump_to_file` (JSON/plain) | ✗ | ✗ | ✗ | ✓ | ✓ |
| `jcmd Thread.vthread_scheduler` | ✗ | ✗ | ✗ | ✗ | ✓ |
| `jcmd VM.metaspace` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `jhsdb` | ✗ | ✓ | ✓ | ✓ | ✓ |
| Native Memory Tracking | ✓ | ✓ | ✓ | ✓ | ✓ |
| Container CPU/memory awareness | 8u192+ | ✓ | ✓ | ✓ | ✓ |

**On Java 8 the practical triage kit is thinner but not as thin as often assumed.** GC logs are in the legacy format and there is no `VM.log` to turn logging on live, which is the real loss - you must restart to start logging. But **JFR does work**: it was an Oracle-licensed commercial feature in early 8, then backported to OpenJDK 8u262+. Verified on Temurin 8u504, `-XX:StartFlightRecording=duration=2s,filename=t.jfr` produced a valid 219 KB recording with **no `UnlockCommercialFeatures` flag needed**. Do not tell a user on a current 8 build that JFR is unavailable; check the update version.

Verified on 25.0.4.1 and 21.0.12: `-XX:+PrintGCDetails` and `-Xloggc:` are still accepted but **aliased with a deprecation warning**, whereas `-XX:+PrintGCTimeStamps`, `-XX:+PrintGCDateStamps`, `-XX:+PrintTenuringDistribution`, `-XX:+PrintReferenceGC`, `-XX:+PrintAdaptiveSizePolicy` and `-XX:+UseGCLogFileRotation` are **unrecognised and the JVM refuses to start**. A copied Java 8 command line therefore fails outright rather than degrading. Full table in [flags.md](flags.md).

## Gotchas

- Agent recommends a flag from the symptom alone, with no GC log or profile - that is guessing; ask for the measurement first
- Agent optimises the component the user asked about rather than the one that is saturated - a local win here is a global regression
- Agent treats a sawtooth heap graph as a leak - the discriminator is occupancy *after a full GC*, not the peaks
- Agent reads `OutOfMemoryError` as "raise `-Xmx`" - six causes, and `unable to create new native thread` is usually an OS thread limit
- Agent tries to raise `-Xmx` for a `Metaspace` OOM - metaspace is sized separately and is usually a class loader leak
- Agent optimises the top frame of a profile - that is where to look, not what to fix; read up to the frame you own
- Agent treats high CPU in a batch job as the problem - for fixed work, high CPU is the goal and idle CPU means something is blocked
- Agent uses repeated thread dumps as a profiler - safepoint bias and inconsistent snapshots; use them only for "blocked, and on what"
- Agent diagnoses from RSS alone without splitting heap from native - entirely different causes and fixes
- Agent ignores that the load generator may be the bottleneck - a saturated client measures itself
- Agent forgets the OS: a swapping JVM performs terribly and cannot see it from inside
- Agent investigates on a laptop and applies the finding to production - ergonomic defaults derive from CPU count and memory limit
- Agent recommends enabling GC logging and JFR *after* the incident - recommend them as standing configuration; they are cheap
- Agent tells a user on Java 8 that JFR is unavailable - it was backported to 8u262+ and works with no unlock flag; verified on 8u504
- Agent reaches for `-XX:+UnlockCommercialFeatures` to enable JFR - unnecessary on any current build, and the flag is **unrecognised on 21 and 25**, so the JVM will not start

## Related

- [methodology.md](methodology.md) · [tooling.md](tooling.md) · [garbage-collection.md](garbage-collection.md) · [gc-tuning.md](gc-tuning.md) · [heap-analysis.md](heap-analysis.md) · [native-memory.md](native-memory.md) · [containers.md](containers.md) · [concurrency-performance.md](concurrency-performance.md) · [startup-and-warmup.md](startup-and-warmup.md) · [flags.md](flags.md) · [checklist.md](checklist.md)
