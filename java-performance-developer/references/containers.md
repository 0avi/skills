# Containers and Resource Limits

Most Java now runs under a CPU or memory limit, and this is where the JVM's ergonomic defaults most often go wrong. The failure mode is characteristic: the application works on a developer machine and is killed in production, or works and is inexplicably slow.

| Concern | The mistake | The fix |
| ------- | ----------- | ------- |
| **Memory limit** | Sizing the container from `-Xmx` | Size from total footprint; heap is ~60-70% of it |
| **Fixed `-Xmx` in an image** | One image, several limits, one wrong heap | `-XX:MaxRAMPercentage=75.0` |
| **CPU limit** | Assuming it only slows things down | It silently changes collector, thread counts and pool sizes |
| **CPU *shares* vs *quota*** | Treating them alike | Only a quota yields a processor count; shares are ignored |
| **Old Java 8** | Assuming container awareness | Needs 8u192 for cgroup v1, **8u372 for cgroup v2** - and modern hosts are v2 |

**The single most important thing: a CPU limit is not just "slower". It reconfigures the JVM.**

---

## The CPU limit cascade

`availableProcessors()` is the input to a surprising number of defaults. Verified on 25.0.4.1 by varying `-XX:ActiveProcessorCount`, which is exactly what a container CPU limit does to the JVM's view:

| Visible CPUs | Collector chosen | `ParallelGCThreads` | `ConcGCThreads` | `CICompilerCount` | `commonPool` parallelism |
| ------------ | ---------------- | ------------------- | --------------- | ----------------- | ------------------------ |
| 1 | **Serial** | 0 | 0 | 2 | 1 |
| 2 | G1 | 2 | 1 | 2 | 1 |
| 4 | G1 | 4 | 1 | 3 | 3 |
| 8 | G1 | 8 | 2 | 4 | 7 |

Read down that table before setting a CPU limit. Dropping from 8 to 1 does not scale the application down by eight - it **changes the garbage collector**, removes the concurrent GC threads entirely, and reduces the common `ForkJoinPool` to a single thread.

Everything downstream of `availableProcessors()` moves with it, including things the JVM does not own:

- `ForkJoinPool.commonPool()` - **verified as `max(1, availableProcessors() - 1)`**, so 7 at 8 CPUs, 3 at 4, and **1 at both 2 and 1 CPUs** (the floor is what makes 1 and 2 CPUs identical). Every parallel stream in the application runs there.
- Framework thread pools that size themselves from the processor count - Netty, Tomcat, Jetty, most connection pools.
- The virtual thread scheduler's carrier pool, which defaults to the processor count on 21+.

**At 1 or 2 CPUs, parallel streams stop being parallel.** `commonPoolParallelism=1` means the work runs on the calling thread. Code that was carefully parallelised silently becomes sequential, with no error and no warning.

### Shares are not a limit the JVM can use

In Kubernetes terms, a **CPU limit** maps to a cgroup quota and the JVM can derive an integer processor count from it. A **CPU request** maps to shares, which express relative weight, not a ceiling.

The JVM historically tried to infer a processor count from shares, and the results were poor enough that the behaviour was withdrawn: **the JVM now ignores shares entirely and derives the processor count from the quota alone.**

Do **not** reach for `-XX:+PreferContainerQuotaForCPUCount`. It existed only in 10 through 13 as the switch for that transition, and was **removed in JDK 14** (JDK-8226575) once quota-only became unconditional. It is therefore absent from four of the five versions this skill covers, and a startup script carrying it **will not start** on 17, 21 or 25. It is not verifiable on the Windows hosts used here at all - see the platform caveat in the version notes - so its 10-13 behaviour is taken from the JDK issue, not measured.

**Set a CPU limit, not just a request, if you want predictable JVM sizing.** Where you cannot, set `-XX:ActiveProcessorCount=N` explicitly and take the decision yourself.

Fractional quotas round **up**: 1.5 CPUs is seen as 2.

---

## Memory: never a fixed `-Xmx` in a shared image

A container image with `-Xmx2g` baked in is wrong the moment the same image is deployed under a different limit. Use a percentage so the heap tracks the limit:

```bash
-XX:InitialRAMPercentage=50.0
-XX:MaxRAMPercentage=75.0
```

**Write the decimal point.** These flags are typed `double`, and verified on Temurin 8u504, `-XX:MaxRAMPercentage=75` fails with *"Improperly specified VM option"* and **the JVM does not start**, while `=75.0` works. On 11, 17, 21 and 25 both forms are accepted. An integer therefore works everywhere except Java 8 - the classic way to break one environment in a fleet.

Verified defaults, identical on all five versions: `MaxRAMPercentage=25.0`, `InitialRAMPercentage=1.5625`, `MinRAMPercentage=50.0`.

**But the default heap is not a flat quarter.** The two percentages describe a step, and which one applies depends on how much memory the JVM sees. Measured by varying `-XX:MaxRAM`, which is how the JVM models a limit internally, on all five versions:

| Memory the JVM sees | Default max heap | Effective share | Governed by |
| ------------------- | ---------------- | --------------- | ----------- |
| 128 MB | 64 MB | **50.0%** | `MinRAMPercentage` |
| 256 MB | 126 MB | **49.2%** | `MinRAMPercentage` |
| 512 MB | 128 MB | 25.0% | `MaxRAMPercentage` |
| 1 GB | 256 MB | 25.0% | `MaxRAMPercentage` |
| 2 GB | 512 MB | 25.0% | `MaxRAMPercentage` |
| 4 GB | 1 GB | 25.0% | `MaxRAMPercentage` |
| 16 GB | 4 GB | 25.0% | `MaxRAMPercentage` |

The figures were identical on 8u504, 11.0.32.1, 17.0.20.1, 21.0.12 and 25.0.4.1, to the byte.

So: **at or below ~256 MB the default is already 50%, and above it the default is 25%.** Raising the percentage is the valuable change for a dedicated container of 512 MB or more, where a quarter is far too conservative for a pod running one JVM. Below ~256 MB the default is *already* half the limit and raising it further is how you get OOM-killed.

Do **not** use `-XX:MaxRAMFraction`. Verified: accepted on 8, 11, 17 and 21, and **unrecognised and fatal on 25** - a startup script carrying it survives three LTS releases and breaks on the fourth.

`MinRAMPercentage` does not set a minimum heap - the name is actively misleading. It is the percentage used *instead of* `MaxRAMPercentage` when memory is small, which is the 50% band in the table above. It is what keeps a 128 MB container from getting a 32 MB heap, and it is relevant only below ~256 MB.

### Choosing the percentage

The heap was **~69% of committed footprint** in the NMT measurement in [native-memory.md](native-memory.md) - 264 MB heap of 381 MB total. So 75% is a reasonable starting point for a limit of 1 GB or more, and you should verify rather than assume:

```bash
jcmd <pid> VM.native_memory summary     # needs -XX:NativeMemoryTracking=summary
```

Compare committed total against the limit. Non-heap needs 0.5-1 GB in absolute terms for a typical server, so **for small containers the percentage must come down, not up**: at a 256 MB limit, 75% leaves 64 MB for everything else and will be killed. Small containers need a smaller percentage, which is the opposite of most people's intuition.

Two consequences of being OOM-killed rather than throwing:

- Exceeding a **cgroup memory limit** means the kernel kills the process. No `OutOfMemoryError`, no heap dump, no stack trace - just exit code 137. If a container dies with no Java-level evidence, this is the first hypothesis.
- Because the JVM commits heap lazily, a container can start fine and be killed hours later when the heap finally grows into ground it never touched. **`-XX:+AlwaysPreTouch` converts that late failure into an immediate one**, which is usually preferable: fail at deploy, not at 3 a.m. It costs startup time.

---

## Java 8 before 8u192

Before **8u192**, the JVM had no container awareness at all: it read the *host's* CPU count and memory. On a 4 CPU / 8 GB host with a container limited to 1 CPU and 512 MB, the JVM would see 4 CPUs and 8 GB, choose a 2 GB maximum heap against a 512 MB limit, and start GC and compiler threads for four CPUs. The heap grows, the limit is hit, **the container is killed**.

**There are two boundaries, and the later one is the one that bites.** 8u192 added awareness of **cgroup v1** only (JDK-8146115). **cgroup v2 needs 8u372** (JDK-8230305). Current distributions and Kubernetes default to cgroup v2, so a Java 8 at, say, 8u302 is container-aware in principle and still reads no limits on a modern host, which looks exactly like the pre-8u192 failure. **When advising on Java 8 in a container, ask for 8u372 or later, not 8u192.** Both boundaries are taken from the JDK issues rather than measured - cgroups do not exist on the Windows hosts used to verify this skill.

If you are stuck below 8u192, set everything by hand:

```bash
-Xmx384m -Xms384m \
-XX:ActiveProcessorCount=1 \
-XX:ParallelGCThreads=1 -XX:CICompilerCount=2
```

The flags to check on 8u192+ are `-XX:+UseContainerSupport` (default on) and `-XX:ActiveProcessorCount`. These are **Linux-only** - verified absent from the Windows builds tested here, where there are no cgroups to read.

---

## Which collector under a limit

The cascade already picks for you, and it usually picks well:

| Limit | Default | Consider instead |
| ----- | ------- | ---------------- |
| 1 CPU | Serial | G1 if the tail matters more than the average |
| 2+ CPUs | G1 | Parallel for CPU-bound batch; ZGC if pauses are the requirement and CPU is spare |
| Small heap (≲100 MB) | - | Serial regardless of CPU count |

The trade-off from [garbage-collection.md](garbage-collection.md) applies with particular force here, because a container is where CPU is genuinely scarce: **a concurrent collector needs CPU cycles while the application runs.** In a 1-CPU container G1's background threads compete directly with the single application thread, and the effect is indistinguishable from a pause. Oaks measured a 1-CPU REST workload - Serial 0.10 s average against G1's 0.13 s, but Serial's 99th percentile 0.69 s against G1's 0.40 s. Serial wins the average, G1 wins the tail. Choose by which your users experience.

**Do not enable ZGC in a small container.** It wants spare CPU for concurrent work and 10-15% more heap for its metadata; starved of either it behaves badly.

---

## A working baseline

```bash
# Linux container, one JVM, limit ≥ 1 GB, JDK 17+
java \
  -XX:MaxRAMPercentage=75.0 \
  -XX:InitialRAMPercentage=50.0 \
  -XX:+AlwaysPreTouch \
  -XX:+ExitOnOutOfMemoryError \
  -XX:NativeMemoryTracking=summary \
  -Xlog:gc*:file=/var/log/gc.log:time,uptime,level,tags:filecount=5,filesize=16M \
  -XX:StartFlightRecording=maxsize=128m,maxage=4h,settings=default \
  -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/log \
  -jar app.jar
```

Why each is there: the percentages so one image works under any limit; `AlwaysPreTouch` so a footprint error fails at deploy; `ExitOnOutOfMemoryError` so the orchestrator restarts rather than leaving a degraded JVM; NMT so footprint questions are answerable; GC log and JFR so the *next* incident has evidence; the heap dump so an OOM is diagnosable.

Deliberately absent: any collector choice, any thread count, any pause goal. Add those only with a measurement.

Set `-XX:ActiveProcessorCount=N` as well when only a CPU *request* is set, or when the platform's reporting is unreliable.

---

## Version notes

Verified with `-XX:+PrintFlagsFinal` and by launching each JVM on Windows x64. **Container detection itself could not be verified here** - cgroups are a Linux mechanism, and `UseContainerSupport` is absent from every Windows build tested. The CPU cascade *was* verified, using `-XX:ActiveProcessorCount` to reproduce exactly what a quota does to the JVM's view.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| Container awareness | **8u192+** | ✓ | ✓ | ✓ | ✓ |
| `UseContainerSupport` (Linux) | 8u192+ | ✓ | ✓ | ✓ | ✓ |
| `ActiveProcessorCount` | ✓ (`-1`) | ✓ | ✓ | ✓ | ✓ |
| `MaxRAMPercentage` | ✓ 25.0 | ✓ 25.0 | ✓ 25.0 | ✓ 25.0 | ✓ 25.0 |
| `MaxRAMPercentage=75` (integer) | **fatal** | ✓ | ✓ | ✓ | ✓ |
| `MaxRAMPercentage=75.0` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `MaxRAMFraction` | ✓ | ✓ accepted | ✓ accepted | ✓ accepted | **fatal** |
| `InitialRAMPercentage` | ✓ 1.5625 | ✓ | ✓ | ✓ | ✓ |
| cgroup v2 support | 8u372+ | 11.0.16+ | ✓ | ✓ | ✓ |
| Thread stacks committed lazily | **✗** | ✓ | ✓ | ✓ | ✓ |
| `ExitOnOutOfMemoryError` | 8u92+ | ✓ | ✓ | ✓ | ✓ |

Three container-specific version traps:

- **8u372 is the boundary that matters in practice, not 8u192.** 8u192 added container awareness against **cgroup v1** (JDK-8146115); cgroup **v2** support arrived in **8u372** (JDK-8230305). Since current distributions and Kubernetes default to cgroup v2, a Java 8 between 8u192 and 8u371 on a modern host is container-*aware* and still mis-detects the limits, which is the confusing case. Lead with 8u372 when advising on Java 8 in containers. **Neither boundary is verified here** - see the platform caveat above; both are taken from the JDK issues.
- **Java 8 commits thread stacks eagerly** - measured 61.7 MB committed for 63 threads against 3.7 MB on 25 ([native-memory.md](native-memory.md)). In a memory-limited container this alone can decide whether the pod survives.
- **`MaxRAMFraction` is fatal on 25.** It is exactly the flag a Java 8-era container script carries.

## Gotchas

- Agent sizes the container from `-Xmx` alone - heap was ~69% of committed footprint; the rest still needs room
- Agent writes `-XX:MaxRAMPercentage=75` - fatal on Java 8; always write `75.0`
- Agent uses `-XX:MaxRAMFraction` - accepted on 8-21, **fatal on 25**
- Agent leaves the default 25% heap percentage in a dedicated container of 512 MB or more - far too conservative for a single-JVM pod
- Agent says "the default is 25%" without the size qualifier - measured, it is **50% at or below ~256 MB** and 25% above, on all five versions
- Agent recommends `-XX:+PreferContainerQuotaForCPUCount` - **removed in JDK 14**; it will not start on 17, 21 or 25, and shares are ignored unconditionally now
- Agent raises the percentage for a *small* container - at 256 MB, 75% leaves too little for non-heap; small containers need a smaller percentage
- Agent bakes a fixed `-Xmx` into a shared image - wrong under every other limit
- Agent treats a CPU limit as "just slower" - it changes the collector, GC threads, compiler threads and common pool parallelism
- Agent forgets parallel streams stop being parallel at 1-2 CPUs - `commonPool` parallelism is `availableProcessors() - 1`, verified as 1 at both 1 and 2 CPUs
- Agent sets only a CPU *request* and expects sane sizing - shares are not a quota; set a limit or `ActiveProcessorCount`
- Agent looks for an `OutOfMemoryError` after a cgroup kill - the kernel kills the process; exit code 137 and no Java evidence
- Agent assumes container awareness on any Java 8 - needs 8u192 for cgroup v1 and **8u372 for cgroup v2**, and modern hosts are v2, so 8u372 is the number to ask for
- Agent enables ZGC in a small container - needs spare CPU and 10-15% more heap
- Agent omits `-XX:+AlwaysPreTouch` where a late OOM-kill is worse than slow startup - pre-touching converts a 3 a.m. failure into a deploy-time one
- Agent leaves a JVM running after an `OutOfMemoryError` in a container - prefer `-XX:+ExitOnOutOfMemoryError` and let the orchestrator restart it

## Related

- [native-memory.md](native-memory.md) · [gc-tuning.md](gc-tuning.md) · [garbage-collection.md](garbage-collection.md) · [concurrency-performance.md](concurrency-performance.md) · [triage.md](triage.md) · [jit-compiler.md](jit-compiler.md) · [flags.md](flags.md) · [java-versions.md](java-versions.md)
