# The Performance Toolbox

Performance analysis is visibility, and visibility is tools. This file covers what to reach for, how to read what it gives back, and - most importantly - the ways each tool systematically lies.

| Tool | Use it for | Overhead | Available |
| ---- | ---------- | -------- | --------- |
| **OS tools** (`vmstat`, `iostat`, `nicstat`, `top -H`) | Establishing which resource is the constraint, before touching Java | None | Always |
| **`jcmd`** | The one Java tool to learn. Flags, heap info, histograms, thread dumps, JFR control, NMT | Low; histograms force a full GC | 8+ |
| **JFR + JMC** | The default profiler. Allocation, locks, I/O, GC, exceptions - all from inside the JVM | **~1-2%** | 8u262+ |
| **async-profiler** | CPU and allocation flame graphs with no safepoint bias; native frames | ~1% | 8+ (Linux/macOS) |
| **`jstat`** | Watching GC live with no configuration, in a shell | Negligible | 8+ |
| **Eclipse MAT** | Heap dump analysis. Nothing bundled comes close | Offline | Any |
| **`jhsdb`** | Post-mortem on a core file or a hung JVM | Offline | 11+ |
| **Instrumenting profilers** | Invocation *counts*, second-pass drill-down on a known package | **High** - changes what it measures | Various |

**Reach for JFR first on anything 11 or later.** It is built into the JVM, so it sees things no external profiler can - which thread holds which monitor, which object was allocated where, why a full GC happened - at an overhead low enough to leave on in production.

---

## Start outside the JVM

The first question is never a Java question. It is "which resource is saturated", and Java tools cannot answer it.

### CPU

```
% vmstat 1
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa
 2  0      0 1797836 1229068 1508276  0    0     0     9 2250 3634 42  3 55  0
```

- `us` user + `sy` system = busy. Here 45% busy, 55% idle.
- **`r` is the run queue** - threads wanting a CPU. On Unix it *includes* running threads, so `r` ≥ 1 whenever anything runs; sustained `r` > CPU count means overload. Windows' `\System\Processor Queue Length` via `typeperf` **excludes** running threads, so there the target is 0. Comparing the two numbers directly is a mistake.
- **`si`/`so` non-zero means swapping. Stop and fix that first** - nothing else you do will matter, and the JVM cannot see it from the inside.
- High `sy` relative to `us` points at syscall volume: unbuffered I/O is the classic cause.

**The goal for CPU is high, not low.** For fixed work, idle CPU means something is blocked; driving utilisation up shortens the job. Only at a fixed arrival rate does lower CPU per request represent a win.

### Disk and network

```
% iostat -xm 5
Device: rrqm/s wrqm/s  r/s   w/s  rMB/s wMB/s ... w_await svctm %util
sda       0.00  11.60 0.02 24.20  0.00  0.14 ...    6.08  0.15   1.04
```

Two opposite failure modes, and you must recognise both:

- **Too little throughput** - low `%util`, low MB/s, but high `sy` and a high operation *count*. Above: 24 writes/s to move 0.14 MB is a lot of syscalls for very little data. That is unbuffered I/O. See [io-performance.md](io-performance.md).
- **Too much throughput** - `%util` at 100%, `w_await` in the hundreds of ms, deep queue. The disk cannot keep up; reduce the I/O.

For network, packet and byte counts are not enough - you need *utilisation*, which means knowing the interface bandwidth. `nicstat` computes it; `netstat` and `typeperf` make you do the arithmetic. Remember bandwidth is bits and tools report bytes: a 1,000 Mb interface carries 125 MB/s. **Sustained utilisation above ~40% on switched Ethernet means saturated**, not 100%.

### Mapping a hot OS thread back to Java

```bash
top -H -p <pid>                                   # find the busiest tid (decimal)
printf '%x\n' <tid>                               # convert to hex
jcmd <pid> Thread.print | grep -A6 'nid=0x<hex>'  # that thread's Java stack
```

This is the fastest way to identify a runaway thread, and it works when a profiler will not attach.

---

## `jcmd`: the one to learn

```bash
jcmd -l                              # list JVMs
jcmd <pid> help                      # every command this JVM supports
jcmd <pid> help <command>             # syntax for one

jcmd <pid> VM.version                 # actual build
jcmd <pid> VM.command_line            # how it was started
jcmd <pid> VM.flags -all              # every flag incl. ergonomic values
jcmd <pid> VM.system_properties
jcmd <pid> VM.uptime
jcmd <pid> VM.native_memory summary   # needs -XX:NativeMemoryTracking=summary at start
jcmd <pid> VM.metaspace               # 11+, metaspace breakdown
jcmd <pid> VM.classloader_stats       # 8+, per-loader class and byte counts
jcmd <pid> VM.log output=gc.log what=gc*   # 11+, turn on logging LIVE

jcmd <pid> GC.heap_info               # committed vs used per generation
jcmd <pid> GC.class_histogram          # top classes - forces a full GC
jcmd <pid> GC.heap_dump /path/out.hprof
jcmd <pid> GC.run                      # explicit full GC

jcmd <pid> Thread.print                # all stacks
jcmd <pid> Thread.dump_to_file -format=json /path/t.json   # 21+
jcmd <pid> Thread.vthread_scheduler    # 25 only - virtual thread carrier pool state

jcmd <pid> JFR.start name=r settings=profile
jcmd <pid> JFR.dump name=r filename=/path/r.jfr
jcmd <pid> JFR.view hot-methods <pid>  # 21+, read a profile without leaving the shell
```

**`VM.log` is the single biggest reason to be on 11+ during an incident.** On 8, enabling GC logging requires a restart, which destroys the state you were trying to diagnose.

**`GC.class_histogram` forces a full GC.** Do not run it inside a measurement window. `jmap -histo` without `:live` skips the collection but then reports unreachable objects too.

### Flags, and finding a default

```bash
# the platform default for a flag, given the rest of your command line
java <your other options> -XX:+PrintFlagsFinal -version | grep MaxHeapSize
```

Always include your other options - flags affect each other, especially GC flags. In the output, `:=` marks a non-default value (set on the command line, set indirectly, or computed ergonomically); `=` marks the built-in default. The trailing brace gives the category: `product`, `pd product` (platform-dependent default), `manageable` (changeable at runtime), `experimental` (needs `-XX:+UnlockExperimentalVMOptions`), `diagnostic` (needs `-XX:+UnlockDiagnosticVMOptions`).

`jinfo -flag <Name> <pid>` reads one flag from a live JVM, and `jinfo -flag [+-]<Name> <pid>` can change the `manageable` ones. On 8 `jinfo` would silently accept a change the JVM then ignored; **on 11+ it reports an error instead**, which is the behaviour you want.

---

## Profilers, and how they lie

### Sampling

A timer fires, the profiler asks each thread what it is executing, and that method is charged for the whole interval. Cheap, and therefore the default - but subject to two distinct errors.

**Interval error.** A thread alternating between `methodA` and `methodB` may be sampled only ever in `methodB`, which then appears to own all the time. Longer runs and shorter intervals reduce it; shorter intervals raise overhead. This is unavoidable in principle.

**Safepoint bias, which is worse and is fixable.** The classic JVMTI interface can only capture a stack when the thread is at a *safepoint*. Safepoint polls are inserted at specific places - method returns, loop back-edges, allocations, blocking calls - and a long stretch of arithmetic or a tight counted loop may contain none. Time inside it gets charged to whichever frame reached the next safepoint. The result is not noise but a *systematic* misattribution, and it is why two profilers can name different hot methods for the same program.

**Prefer a profiler using `AsyncGetCallTrace`** - async-profiler, and JFR's method sampler - which can sample without waiting for a safepoint. Interval error remains; the bias does not.

### Instrumenting

Bytecode is rewritten to count and time invocations. It gives you something sampling cannot - **exact invocation counts** - and that is often the more actionable number. A profile showing 166 million calls to a random-number method tells you to make fewer calls, which is a bigger win than making the method faster, and no sampling profile would reveal it.

The cost is that it changes the program: instrumented methods may no longer be small enough to inline, so the profile over-attributes to them, and overhead is high. **Use it as a second pass on a package sampling has already implicated**, never as a first look, and never across the whole application.

### Blocked threads are usually absent from a profile

Most profilers exclude threads that are not on-CPU, because `select()` waiting for work consumes nothing and cannot be optimised. That default is right far more often than it is wrong. But when the problem *is* waiting - a lock, a database, a downstream service - the profile will look healthy while the application is slow. This is the single most common way a CPU profile misleads. When CPU is low and throughput is flat, stop profiling CPU and go to [triage.md](triage.md) Branch G.

---

## JFR: the default choice on 11+

A stream of events emitted by the JVM itself into a ring buffer, dumped on demand. Because the JVM produces them, JFR sees what nothing outside can.

```bash
# standing configuration for production - leave this on
-XX:StartFlightRecording=maxsize=256m,maxage=6h,settings=default,filename=/var/log/app.jfr

# ad hoc on a running JVM
jcmd <pid> JFR.start name=diag settings=profile duration=120s filename=/tmp/diag.jfr
jcmd <pid> JFR.check
jcmd <pid> JFR.dump name=diag filename=/tmp/diag.jfr
```

Two built-in settings profiles: **`default`** targets under ~1% and is safe to leave running; **`profile`** lowers thresholds and samples harder for roughly 2%, for a bounded diagnostic window. `settings=` also takes a path to a custom `.jfc`, which is plain XML - the reliable way to see exactly which events and thresholds a profile enables is to read that file.

Reading a recording without a GUI:

```bash
jfr summary r.jfr                                    # event counts - start here
jfr print --events jdk.GarbageCollection r.jfr
jfr print --events jdk.JavaMonitorEnter r.jfr        # lock contention, with stacks
jfr print --events jdk.ObjectAllocationSample r.jfr  # 16+, allocation hot spots
jfr print --events jdk.VirtualThreadPinned r.jfr     # 21+, carrier pinning
jcmd <pid> JFR.view hot-methods                      # 21+, no file needed
```

The events worth knowing, and why each is hard to get any other way:

| Event | Tells you |
| ----- | --------- |
| `jdk.GarbageCollection`, `jdk.GCPhasePause` | Per-collection cause, duration, per-phase breakdown |
| `jdk.JavaMonitorEnter` | Which thread blocked on which monitor, for how long, with the stack |
| `jdk.ObjectAllocationSample` (16+) | Where allocation actually happens - the fastest route to GC pressure |
| `jdk.ObjectAllocationOutsideTLAB` | Allocations too large for a TLAB - see [allocation.md](allocation.md) |
| `jdk.ExceptionStatistics`, `jdk.JavaExceptionThrow` | Throw rate. Frequently a surprise |
| `jdk.FileRead`, `jdk.SocketRead` | Slow I/O, per call site, above a threshold |
| `jdk.ThreadPark`, `jdk.ThreadSleep` | Where threads wait |
| `jdk.VirtualThreadPinned` (21+) | A virtual thread that could not unmount |
| `jdk.CompilerCompile`, `jdk.CodeCacheFull` | JIT progress; code cache exhaustion |
| `jdk.NativeMemoryUsage` (24+) | NMT-style totals as a time series |

**Threshold-based events only fire above their threshold**, so "no `jdk.FileRead` events" means no *slow* reads, not no reads. Reading absence as a clean bill of health is a common error.

**JMC** (Java Mission Control) is the GUI, and it is a **separate download** - it has never been bundled with the JDK, in any version tested here. It gives the automated-analysis view, flame graphs and the event browser. `jvisualvm` was likewise unbundled after 8 and is absent from all five Adoptium builds tested; do not instruct a user to run a tool their JDK does not ship.

---

## `jstat`: GC visibility with nothing installed

```bash
jstat -gcutil <pid> 1000        # percentages, every second
jstat -gc <pid> 1000            # the same in KB
jstat -gccause <pid> 1000       # adds the cause of the last collection
jstat -compiler <pid>           # compiled/failed counts
```

```
  S0     S1     E      O      M     CCS    YGC   YGCT    FGC   FGCT     GCT
  0.00  51.71  99.12  60.98  97.02 92.31    98   1.985     8   2.397   4.382
```

`S0`/`S1` survivor spaces, `E` eden, `O` old, `M` metaspace, `CCS` compressed class space, then young collection count and cumulative time, full collection count and time, and total. **Watch `O` immediately after each `FGC` increments** - if that floor rises monotonically, you have a leak. Rising `FGC` with `O` staying high is the signature to act on.

Its real value is that it needs no restart, no flags and no file. It is the right tool for "is GC the problem" in thirty seconds on a box you have just been handed.

---

## Version notes

Tool availability was verified by listing `bin/` and running `jcmd <pid> help` on Temurin **8u504, 11.0.32.1, 17.0.20.1, 21.0.12 and 25.0.4.1**.

| Tool / command | 8 | 11 | 17 | 21 | 25 |
| -------------- | - | -- | -- | -- | -- |
| `jcmd`, `jstat`, `jmap`, `jstack`, `jinfo`, `jconsole` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `jfr` CLI | ✓ | ✓ | ✓ | ✓ | ✓ |
| JFR recording works with no unlock flag | ✓ (8u262+) | ✓ | ✓ | ✓ | ✓ |
| `jhat` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `jhsdb` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `jvisualvm` bundled | ✗ | ✗ | ✗ | ✗ | ✗ |
| `jmc` bundled | ✗ | ✗ | ✗ | ✗ | ✗ |
| `VM.log` (enable logging live) | ✗ | ✓ | ✓ | ✓ | ✓ |
| `VM.metaspace` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `VM.classloader_stats` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GC.rotate_log` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `GC.class_stats` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `Thread.dump_to_file` | ✗ | ✗ | ✗ | ✓ | ✓ |
| `Thread.vthread_scheduler`, `Thread.vthread_pollers` | ✗ | ✗ | ✗ | ✗ | ✓ |
| `Compiler.CodeHeap_Analytics` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `System.map`, `System.dump_map` | ✗ | ✗ | ✗ | ✗ | ✓ |
| `jdk.ObjectAllocationSample` JFR event | ✗ | ✗ | 16+ ✓ | ✓ | ✓ |
| `jdk.VirtualThreadPinned` JFR event | ✗ | ✗ | ✗ | ✓ | ✓ |

Notes on the surprises in that table:

- **JFR on 8 works.** It was Oracle-licensed early in 8's life and needed `-XX:+UnlockCommercialFeatures`, then it was open-sourced in 11 and **backported to OpenJDK 8u262+**. Verified: on Temurin 8u504, `-XX:StartFlightRecording=duration=2s,filename=t.jfr` wrote a valid 219 KB recording with no unlock flag. Do not assert JFR is unavailable on 8 without checking the update version.
- `VM.unlock_commercial_features` still *appears* in `jcmd help` on 8u504 even though it is not needed. On 21 and 25, `-XX:+UnlockCommercialFeatures` is **unrecognised and the JVM refuses to start** - so a Java 8 startup script carrying it fails outright.
- **`Thread.vthread_scheduler` (25) has no equivalent in any older release** and is the only supported way to inspect the virtual thread carrier pool. Neither edition of Oaks covers it.
- Nothing here ships `jmc` or `jvisualvm`. Both are separate downloads.

## Gotchas

- Agent starts with a Java profiler before establishing which resource is saturated - begin outside the JVM
- Agent compares a Unix run queue to a Windows processor queue - Unix includes running threads, Windows excludes them
- Agent ignores `si`/`so` in `vmstat` - a swapping JVM performs terribly and cannot detect it internally
- Agent reads low disk throughput as healthy - low MB/s with a high operation count and high system time is unbuffered I/O
- Agent trusts one sampling profiler's hot method absolutely - safepoint bias is systematic, not random; prefer an `AsyncGetCallTrace` profiler and corroborate
- Agent profiles CPU when CPU is idle - the problem is waiting, and most profilers exclude off-CPU threads entirely
- Agent runs `GC.class_histogram` or `jmap -histo:live` during a measurement - both force a full GC
- Agent uses `jmap -histo` without `:live` and treats the counts as the live set - it includes collectable objects
- Agent reads "no `jdk.FileRead` events" as no I/O - threshold events only fire above their threshold
- Agent leaves `settings=profile` on permanently - it is for a bounded window; `default` is the standing setting
- Agent tells the user to open JMC or jvisualvm from the JDK - neither is bundled in any version tested
- Agent recommends `-XX:+UnlockCommercialFeatures` for JFR - unnecessary now, and fatal on 21 and 25
- Agent instruments the whole application as a first pass - high overhead and it distorts inlining; sample first, instrument one package second
- Agent tries `VM.log` on Java 8 - absent there; enabling GC logging on 8 requires a restart
- Agent forgets `-XX:NativeMemoryTracking` must be set at **startup** before `VM.native_memory` will report anything

## Related

- [triage.md](triage.md) · [methodology.md](methodology.md) · [garbage-collection.md](garbage-collection.md) · [heap-analysis.md](heap-analysis.md) · [native-memory.md](native-memory.md) · [jit-compiler.md](jit-compiler.md) · [concurrency-performance.md](concurrency-performance.md) · [flags.md](flags.md)
