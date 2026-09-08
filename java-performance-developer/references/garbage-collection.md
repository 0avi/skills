# Garbage Collection: How It Works and Which to Choose

Short of rewriting code, choosing and tuning the collector is the largest single lever on Java performance. This file covers the model, the catalogue and the logs. Sizing and tuning are in [gc-tuning.md](gc-tuning.md).

| Collector | Flag | Available | Status | Choose it when |
| --------- | ---- | --------- | ------ | -------------- |
| **G1** | `-XX:+UseG1GC` | 8+ | **Default 11+** | The default answer. Balanced pauses and throughput, and it will not surprise you |
| **Parallel** | `-XX:+UseParallelGC` | 8+ | **Default on 8** | Batch work that is CPU-bound, where total throughput is the only metric and pauses do not matter |
| **Serial** | `-XX:+UseSerialGC` | 8+ | Supported | One CPU, or a small heap (≲100 MB), or a short-lived process. Ergonomic default at 1 CPU on 11+ |
| **ZGC** | `-XX:+UseZGC` | 11+ | Experimental 11-16, **product 17+** | Pause time is the requirement and you have spare CPU and RAM. Sub-millisecond pauses, large heaps |
| **Shenandoah** | `-XX:+UseShenandoahGC` | 11+ (build-dependent) | Product in Adoptium | Same goal as ZGC, better on smaller heaps. Absent from some vendors' builds |
| **Epsilon** | `-XX:+UseEpsilonGC` | 11+ | **Experimental on all versions** | Never in production. Benchmark baselines, and processes that provably never need to collect |

**Start with the default and change it only with evidence.** For the overwhelming majority of applications on 11+ that means G1, and the only tuning needed is a maximum heap. The decision tree below is for when that is not enough.

---

## The model

The collector's job is to find objects that are *reachable* and reclaim everything else. Reachability, not reference counting - a circular linked list has a reference to every node yet the whole structure is garbage once nothing outside points in. So the JVM periodically walks from **GC roots** (thread stacks, static fields of system-loaded classes, JNI handles) and everything it does not reach is collectable.

Three operations, and the third is what distinguishes the collectors:

1. **Mark** - find the live objects.
2. **Sweep** - make the dead objects' memory available.
3. **Compact** - move live objects together, so free memory is contiguous.

Compaction is the expensive part and the reason for stop-the-world pauses. Consider a heap alternating 1,000-byte and 24-byte arrays where every 24-byte array dies: there is plenty of free memory but no gap large enough for a 1,000-byte allocation. Without compaction, allocation fails on a heap that is mostly free. And because compaction *moves* objects, application threads must not be reading them while it happens - which is why the simple collectors stop everything, and why the concurrent ones need read barriers.

### Generations

Most objects die young. This loop, summing squared deviations over a year of prices, creates roughly 750 intermediate `BigDecimal` objects, nearly all of which are garbage on the next iteration:

```java
sum = new BigDecimal(0);
for (StockPrice sp : prices.values()) {
  BigDecimal diff = sp.getClosingPrice().subtract(averagePrice);
  diff = diff.multiply(diff);
  sum = sum.add(diff);
}
```

So the heap is split. New objects go in **eden**; when it fills, a **young collection** copies the survivors into a **survivor space** (or promotes them to the **old generation**) and eden is empty again. Two wins fall out of this, and the second is easy to miss:

- Collecting a small region is fast, so pauses are short. They are more frequent than collecting the whole heap would be, but far shorter - almost always the better trade.
- **The young generation is compacted for free.** Everything live is copied out, so what remains is contiguous by construction. No separate compaction step.

The old generation fills eventually, and how that is handled is the whole difference between the collectors: stop everything and compact (Serial, Parallel), or mark concurrently and compact incrementally (G1), or do nearly all of it concurrently including compaction (ZGC, Shenandoah).

A **full GC** is a stop-the-world collection of the entire heap. With Parallel and Serial it is routine. **With G1, ZGC or Shenandoah a full GC is a failure signal** - the concurrent machinery lost a race - and its cause string in the log names which race.

---

## Choosing: the decision tree

```
Pause time is a hard requirement (SLO on p99, trading, interactive)?
├─ Yes → ZGC (17+) or Shenandoah. Budget spare CPU and ~10-15% more heap.
│        On 11-16 ZGC is experimental - prefer G1 unless you can accept that.
└─ No  → Is total throughput the only metric, and is the job CPU-bound?
         ├─ Yes → Parallel GC. Its full-GC pauses are the price; batch jobs do not care.
         └─ No  → One CPU, or heap ≲100 MB, or a process living seconds?
                  ├─ Yes → Serial GC.
                  └─ No  → G1. This is most applications.
```

The trade-offs behind that tree, which matter more than the tree itself:

**Concurrent collectors buy pause time with CPU.** G1's background threads need cycles *while application threads run*. Given a CPU-bound application that already saturates every core, they cannot get them, and the effect is indistinguishable from a pause - the application thread simply does not run. Measured by Oaks on a single-CPU batch job: Serial 434 s elapsed with 79 s paused, G1 501 s with 97 s paused, and the extra 49 s of G1's wall clock is background threads stealing CPU from the one application thread. **On a saturated CPU, a concurrent collector is the wrong choice.**

**Serial is not a legacy curiosity.** Single-CPU containers made it relevant again, and on small heaps its simplicity beats G1's bookkeeping. Oaks measured a 1-CPU REST workload: Serial 0.10 s average response, G1 0.13 s - but Serial's 99th percentile was 0.69 s against G1's 0.40 s, because Serial's full GCs are long. **That is the choice in miniature: Serial for the average, G1 for the tail.** Pick according to which your users feel.

**Parallel beats G1 when there are no full GCs to avoid.** G1's advantage is avoiding long full-GC pauses; if the old generation never fills, that advantage is worth nothing and G1's extra bookkeeping is pure cost.

### Hyper-threading is not two CPUs

The JVM sees hyper-threads as CPUs and sizes GC thread counts from the count. But a core runs one hardware thread at a time, switching on stalls, so a 4-core/8-thread machine delivers roughly **five to six times** a single core's throughput on CPU-bound work, not eight. GC is very CPU-bound, so a machine reporting 8 CPUs does not collect twice as fast as one reporting 4. Oaks measured a 1-core/2-thread batch job: Parallel's pause total fell only ~20% versus Serial's, nowhere near half.

---

## Reading the logs

### Java 8: legacy flags

Verified on Temurin 8u504, `-Xmx96m -Xms96m -XX:+PrintGCDetails -XX:+PrintGCTimeStamps`, default (Parallel) collector:

```
0.072: [GC (Allocation Failure) [PSYoungGen: 24576K->1040K(28672K)] 24576K->1048K(94208K), 0.0005922 secs] [Times: user=0.00 sys=0.00, real=0.00 secs]
```

Read it as: at 0.072 s, a young collection caused by allocation failure took the young generation from 24,576K to 1,040K (of 28,672K), and the whole heap from 24,576K to 1,048K (of 94,208K), in 0.59 ms. `user` exceeding `real` means multiple GC threads.

The same JVM with `-XX:+UseConcMarkSweepGC` - CMS names the young collector `ParNew`:

```
[GC (Allocation Failure) [ParNew: 26240K->950K(29504K), 0.0007089 secs] 26240K->950K(95040K), 0.0007696 secs]
```

And with `-XX:+UseG1GC`, which on 8 is far terser than the unified format:

```
[GC pause (G1 Evacuation Pause) (young), 0.0010766 secs]
```

The Java 8 logging flag set, all of which are gone later: `-XX:+PrintGCDetails`, `-XX:+PrintGCTimeStamps`, `-XX:+PrintGCDateStamps`, `-Xloggc:<file>`, `-XX:+UseGCLogFileRotation`, `-XX:NumberOfGCLogFiles=N`, `-XX:GCLogFileSize=N`, plus `-XX:+PrintTenuringDistribution`, `-XX:+PrintReferenceGC`, `-XX:+PrintAdaptiveSizePolicy`, `-XX:+PrintTLAB`.

```bash
# a reasonable Java 8 standing configuration
-Xloggc:gc.log -XX:+PrintGCDetails -XX:+PrintGCTimeStamps \
-XX:+UseGCLogFileRotation -XX:NumberOfGCLogFiles=8 -XX:GCLogFileSize=16M
```

Rotation must have all three flags: enabling it alone leaves count and size at 0, meaning unlimited.

### Java 11 and later: unified logging

One flag, four colon-separated sections - *what*, *where*, *decorators*, *output options*:

```bash
-Xlog:gc*:file=gc.log:time,uptime,level,tags:filecount=8,filesize=16M
```

Verified on 25.0.4.1, `-Xlog:gc` with the default (G1) collector:

```
[0.022s][info][gc] Using G1
[0.064s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 48M->2M(96M) 1.208ms
[0.070s][info][gc] GC(1) Pause Young (Normal) (G1 Evacuation Pause) 45M->3M(96M) 0.815ms
```

`-Xlog:gc*` adds the phase and region detail, which is what you actually want for tuning:

```
[0.090s][info][gc,start    ] GC(1) Pause Young (Normal) (G1 Evacuation Pause)
[0.090s][info][gc,task     ] GC(1) Using 2 workers of 8 for evacuation
[0.091s][info][gc,phases   ] GC(1)   Pre Evacuate Collection Set: 0.09ms
[0.091s][info][gc,phases   ] GC(1)   Merge Heap Roots: 0.04ms
[0.091s][info][gc,phases   ] GC(1)   Evacuate Collection Set: 0.50ms
[0.091s][info][gc,phases   ] GC(1)   Post Evacuate Collection Set: 0.16ms
[0.091s][info][gc,heap     ] GC(1) Eden regions: 43->0(53)
[0.091s][info][gc,heap     ] GC(1) Survivor regions: 2->3(6)
[0.091s][info][gc,heap     ] GC(1) Old regions: 2->2
[0.091s][info][gc,heap     ] GC(1) Humongous regions: 0->0
[0.091s][info][gc,metaspace] GC(1) Metaspace: 90K(320K)->90K(320K) NonClass: ... Class: ...
```

Note `Using 2 workers of 8` - G1 sizes the worker count per collection, so a small pause using few workers is normal and not a misconfiguration.

Useful selectors, since `gc*` at `info` is not always the right granularity:

```bash
-Xlog:gc                            # one line per collection - the summary view
-Xlog:gc*                           # all gc tags at info: phases, heap, regions
-Xlog:gc+heap=debug                 # sizing decisions
-Xlog:gc+age=debug                  # tenuring distribution (the old PrintTenuringDistribution)
-Xlog:gc+humongous=debug            # humongous allocations
-Xlog:gc+ref=debug                  # reference processing (the old PrintReferenceGC)
-Xlog:gc+tlab=debug                 # TLAB behaviour (the old PrintTLAB)
-Xlog:safepoint                     # pauses that are not GC
-Xlog:help                          # every tag and level this JVM supports
```

**Log rotation differs between 8 and 11+, which matters when you script log collection.** On 8 the current file is `gc.log.N.current` and gets renamed on rotation; on 11+ the current file is `gc.log` and the rotated ones become `gc.log.0`, `gc.log.1`. In neither case does the number indicate age - the indices cycle, so the oldest file can be any of them. Sort by mtime, never by name.

### What to look for, in order

1. **Fraction of wall clock paused.** Under ~3%, GC is not your problem. Over ~10%, it is worth real effort. Applications in memory-constrained environments routinely run at 10-15% and still meet their goals - the fraction is context, not a verdict.
2. **Pause distribution**, not the mean. One 4-second full GC outranks a thousand 20 ms young collections.
3. **Any full GCs at all**, if using G1/ZGC/Shenandoah. Read the cause string.
4. **Heap occupancy after each full GC.** Rising monotonically means a leak - go to [heap-analysis.md](heap-analysis.md), not to tuning.
5. **`System.gc()` in the log.** Find the caller; note RMI's distributed GC calls it hourly by default. Do **not** reach for `-XX:+DisableExplicitGC` as the first move - it breaks direct `ByteBuffer` reclamation. See [Causing and disabling explicit collection](#causing-and-disabling-explicit-collection).

No good open-source GC log parser has emerged; GCeasy (free tier) and similar services handle the aggregation. `jstat -gcutil` is the zero-setup alternative for a live JVM - see [tooling.md](tooling.md).

---

## What each collector actually does

### Parallel

Multi-threaded mark-sweep-compact, stopping the world for both young and full collections, fully compacting the old generation every full GC. Tuned by goals rather than geometry: `-XX:MaxGCPauseMillis=N` and `-XX:GCTimeRatio=N`. Simple, predictable, and the highest raw throughput when pauses are irrelevant.

### G1

The heap is divided into ~2,048 regions of uniform power-of-two size, each belonging to eden, survivor, old or humongous, and **not contiguously**. Four operations:

1. **Young collection** - stop the world, evacuate live objects out of eden regions.
2. **Concurrent cycle** - background threads mark the old generation, identifying regions that are mostly garbage. Frees almost nothing; it builds the list.
3. **Mixed collection** - a young collection that *also* evacuates some of those marked old regions. Because it evacuates, this is how G1 compacts incrementally, spread over several collections.
4. **Full GC** - the failure path.

The name is "garbage first": a region is eligible when it is ~85% garbage, so a little evacuation reclaims a lot. Region size is `-XX:G1HeapRegionSize`, ergonomic by default - verified 2 MB on 11.0.32.1 and 4 MB on 17.0.20.1, 21.0.12 and 25.0.4.1 for the same heap, so the ergonomics changed between 11 and 17.

Four failure modes, each with a distinct log signature and a distinct fix; all four are covered in [gc-tuning.md](gc-tuning.md):

| Failure | Signature | Meaning |
| ------- | --------- | ------- |
| Concurrent mode failure | Full GC interrupts a marking cycle | Old generation filled before marking finished |
| Promotion failure | Full GC right after a mixed collection | Mixed GCs are not freeing regions fast enough |
| Evacuation failure | `To-space exhausted` on a young collection | Heap full or fragmented |
| Humongous allocation | `Pause Full (G1 Humongous Allocation)` | An object needed contiguous regions and none were free |

**G1's full GC was single-threaded on Java 8 and is parallel from 11 onward.** So the same failure that costs seconds on 8 costs a fraction of that on 11+. This is one of the strongest performance arguments for leaving Java 8.

### ZGC

Concurrent everything, including compaction, via load barriers on object reads. Consequences worth knowing:

- **Not generational until recently.** Generational ZGC arrived as opt-in `-XX:+ZGenerational` in 21, became the default in 23, and the non-generational mode was removed. **Verified: `ZGenerational` exists only on 21** - absent on 17 and absent on 25, where it is accepted but ignored with a warning. So on 21 you must ask for the generational mode; on 23+ you get it and the flag is meaningless.
- Pauses are sub-millisecond and largely independent of heap size, which is the entire point.
- It costs CPU and roughly 10-15% more memory for its barriers and metadata.
- It is close to untunable by design: set a maximum heap and leave it alone.

### Shenandoah

Same objective as ZGC by a different mechanism (Brooks forwarding pointers), generally better on small to medium heaps. **A build-level difference, not a version one:** verified as `product` on Adoptium 11.0.32.1 through 25.0.4.1, but it is absent from Oracle's own builds. Check the vendor before recommending it.

### Epsilon

Allocates and never collects; the heap fills and the JVM throws `OutOfMemoryError`. **Verified `experimental` on 11, 17, 21 and 25** - it has never been promoted - and it needs `-XX:+UnlockExperimentalVMOptions`. Genuinely useful for exactly two things: establishing a no-GC baseline when benchmarking, and very short-lived processes that provably allocate less than the heap. Oaks measured a 4,096-element allocation test at 1.6 s and 2,052 MB under Epsilon against 2.3 s and 3,072 MB under Parallel - the saving is real because Epsilon is non-generational and needs no headroom.

---

## Causing and disabling explicit collection

`System.gc()` triggers a **full** collection regardless of collector, stopping the world for as long as that takes, and it does not make anything more efficient - it moves the cost earlier. Calling it in application code is almost always wrong.

Legitimate exceptions: before taking a heap dump, so the dump contains only live objects; and in a benchmark harness between measurement phases. RMI's distributed GC calls it **hourly** by default (`-Dsun.rmi.dgc.server.gcInterval=N`, `-Dsun.rmi.dgc.client.gcInterval=N`, both in ms, default 3600000).

### `-XX:+DisableExplicitGC` is not a safe default

The flag turns every `System.gc()` call into a no-op. That sounds harmless and is widely recommended. **It is not harmless, because the JDK itself depends on those calls.**

`java.nio.Bits.reserveMemory()` - the allocation path behind every `ByteBuffer.allocateDirect()` - calls `System.gc()` when it cannot satisfy a reservation within `MaxDirectMemorySize`. That call is what makes unreachable direct buffers release their native memory, because a direct buffer's native block is freed by a `Cleaner`/`PhantomReference` that only runs after a collection. Disable explicit GC and the reclamation path is gone: the JVM hits the cap and throws instead of recovering.

Measured on Temurin 8u504, 11.0.32.1, 17.0.20.1, 21.0.12 and 25.0.4.1, allocating 200 x 8 MB direct buffers under `-XX:MaxDirectMemorySize=64m` and dropping each reference immediately:

| Configuration | Result |
| ------------- | ------ |
| default | **all 200 allocations succeed**, on all five versions |
| `-XX:+DisableExplicitGC` | **`OutOfMemoryError` after 8 allocations**, on all five versions |

Eight allocations is exactly the 64 MB cap: not one byte is ever reclaimed. The failure is identical on every version tested, so this is not a legacy quirk that later releases fixed.

The error it produces is the same one a genuine leak produces, which is what makes it expensive to diagnose:

```
# 8 and 11
java.lang.OutOfMemoryError: Direct buffer memory
# 17, 21 and 25
java.lang.OutOfMemoryError: Cannot reserve 8388608 bytes of direct buffer memory
  (allocated: 67108864, limit: 67108864)
```

Anything doing NIO allocates direct buffers, usually without announcing it: Netty, most NIO-based HTTP servers and clients, Kafka clients, `FileChannel.map`, and the JDK's own `sun.nio.ch` socket paths. In practice you rarely know that a process allocates none.

**So:** treat `-XX:+DisableExplicitGC` as a measure-first change, not a hygiene default. If a third-party `System.gc()` is genuinely costing you pauses, prefer in order:

1. **Fix or configure the caller.** For RMI, raise `sun.rmi.dgc.*.gcInterval` rather than disabling the mechanism.
2. **`-XX:+ExplicitGCInvokesConcurrent`.** Verified present and accepted on all five versions. It keeps the reclamation trigger but serves it with a concurrent cycle instead of a full stop-the-world pause, on the collectors that have one (G1, ZGC, Shenandoah; **not** Serial or Parallel, where there is no concurrent cycle to use). This is the right answer in almost every case where `DisableExplicitGC` gets reached for.
3. **`-XX:+DisableExplicitGC`** only after confirming from NMT or the `java.nio.BufferPool.direct` MBean that direct buffer use is genuinely zero and will stay zero.

---

## Version notes

Verified by running `-XX:+PrintFlagsFinal` and by launching each JVM: Temurin **8u504, 11.0.32.1, 17.0.20.1, 21.0.12, 25.0.4.1**.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| Default collector (multi-CPU) | **Parallel** | **G1** | G1 | G1 | G1 |
| Ergonomic collector at 1 CPU | Serial (implicit) | Serial | Serial | Serial | Serial |
| `UseParallelGC` default value | `true` | `false` | `false` | `false` | `false` |
| `UseG1GC` default value | `false` | `true` | `true` | `true` | `true` |
| CMS (`UseConcMarkSweepGC`) | ✓ | ✓ deprecated | **fatal** | fatal | fatal |
| `UseParNewGC` | **warn, and effective** | **fatal** | fatal | fatal | fatal |
| `UseParallelOldGC` | ✓ | ✓ deprecated | **fatal** | fatal | fatal |
| ZGC | ✗ | experimental¹ | **product** | product | product |
| `ZGenerational` flag | ✗ | ✗ | ✗ | **product** | absent (ignored, warns) |
| Shenandoah (Adoptium) | ✗ | product | product | product | product |
| Epsilon | ✗ | experimental | experimental | experimental | experimental |
| Unified `-Xlog` | ✗ | ✓ | ✓ | ✓ | ✓ |
| G1 full GC is parallel | ✗ (single-threaded) | ✓ | ✓ | ✓ | ✓ |
| `MaxGCPauseMillis` default | unset (`ULONG_MAX`) | **200** | 200 | 200 | 200 |
| `GCTimeRatio` default | **99** | **12** | 12 | 12 | 12 |
| `G1HeapRegionSize` default | 0 (computed later) | 2 MB | 4 MB | 4 MB | 4 MB |
| `ConcGCThreads` default | 0 | 2 | 2 | 2 | 2 |

¹ On 11, `-XX:+UseZGC` **fails to start** unless preceded by `-XX:+UnlockExperimentalVMOptions` - verified. That is what "experimental" costs you in practice. From 17 it is a plain product flag needing no unlock.

Three of those rows are traps:

- **`GCTimeRatio` changed from 99 to 12 at Java 11.** Older advice to "set it to 19 because 99 is too optimistic" targets a default that no longer exists - 12 already implies roughly 7.7% of time in GC, which is *more* permissive than 19. Do not repeat that advice on 11+ without re-deriving it.
- **`MaxGCPauseMillis` has no default on 8** (it reads as `ULONG_MAX`, i.e. unset) and is **200 ms from 11 onward**, because the default collector changed and G1 ships a pause goal. So "the pause target" exists by default on 11+ and does not on 8.
- **CMS removal is a hard stop.** Verified: `-XX:+UseConcMarkSweepGC` and `-XX:CMSInitiatingOccupancyFraction=70` are both accepted on 8 and 11 and **unrecognised on 17, 21 and 25, where the JVM refuses to start**. A CMS-tuned command line does not degrade gracefully; it fails. Every `CMS*` flag behaves the same way, and so do `-XX:+UseParallelOldGC` and `-XX:+AggressiveOpts`. This is the most common single cause of a failed 11-to-17 upgrade.

## Gotchas

- Agent recommends CMS, or any `CMS*` flag, on 17+ - removed, and the JVM will not start
- Agent copies a Java 8 GC logging block to 11+ - `-XX:+PrintGCTimeStamps`, `PrintGCDateStamps`, `UseGCLogFileRotation`, `PrintTenuringDistribution`, `PrintReferenceGC`, `PrintAdaptiveSizePolicy` are all unrecognised and fatal. `PrintGCDetails` and `-Xloggc:` survive with a deprecation warning
- Agent repeats "GCTimeRatio defaults to 99, set it to 19" on 11+ - the default is 12 there, and 19 would be stricter
- Agent assumes G1 is the default on Java 8 - it is Parallel; G1 exists but must be asked for
- Agent treats a full GC under G1 as routine - it is a failure signal; read the cause string
- Agent recommends a concurrent collector for a CPU-saturated batch job - background threads cannot get cycles, and the application stalls as if paused
- Agent recommends ZGC on Java 11 without saying it is experimental there - it is product only from 17
- Agent sets `-XX:+ZGenerational` on 25 - absent; accepted but ignored with a warning. Needed only on 21
- Agent recommends Shenandoah without checking the vendor - present in Adoptium, absent from Oracle builds
- Agent suggests Epsilon for anything real - experimental on every version, and it never collects
- Agent counts hyper-threads as cores when reasoning about GC throughput - 8 hardware threads deliver roughly 5-6x one core
- Agent diagnoses a leak from peak heap in a sawtooth graph - read occupancy *after a full GC*
- Agent adds `System.gc()` to "help" - always a full stop-the-world collection, and it only moves the cost earlier
- Agent enables Java 8 log rotation with only `-XX:+UseGCLogFileRotation` - count and size default to 0, meaning unlimited; all three flags are required
- Agent sorts rotated GC logs by filename to find the newest - indices cycle; sort by mtime
- Agent tunes the collector before checking the GC fraction - under 3% of wall clock, tuning it is wasted effort

## Related

- [gc-tuning.md](gc-tuning.md) · [triage.md](triage.md) · [heap-analysis.md](heap-analysis.md) · [allocation.md](allocation.md) · [native-memory.md](native-memory.md) · [containers.md](containers.md) · [tooling.md](tooling.md) · [flags.md](flags.md) · [java-versions.md](java-versions.md)
