# GC Tuning

Sizing the heap and adjusting the collector. Read [garbage-collection.md](garbage-collection.md) first - choosing the right collector outranks tuning the wrong one, and most applications need nothing on this page beyond a maximum heap.

| Tuning | When to reach for it | Risk |
| ------ | -------------------- | ---- |
| **Maximum heap** (`-Xmx` / `-XX:MaxRAMPercentage`) | Almost always the only change needed | Low, but never exceed physical memory |
| **Pause-time goal** (`-XX:MaxGCPauseMillis`) | Pauses close to target but not meeting it | Moderate - an unrealistic value makes things far worse |
| **Fixed heap** (`-Xms` = `-Xmx`) | Heap size already known and finely tuned | Low. Costs adaptive sizing, saves resize work |
| **Generation sizing** (`-XX:NewRatio`, `-Xmn`) | Measured promotion problem, adaptive sizing already off | High - easy to make worse |
| **G1 concurrent-cycle tuning** (`IHOP`, `ConcGCThreads`, `G1MixedGCCountTarget`) | Specific, identified G1 failure in the log | Moderate. Requires the log evidence first |
| **Survivor / tenuring** (`SurvivorRatio`, `MaxTenuringThreshold`) | `gc+age` shows survivor overflow | High, low reward. Usually the answer is "more heap" |
| **Everything else** | Practically never | Do not |

**The tuning order that actually works:** get the collector right, set a maximum heap, set a realistic pause goal if pauses are the complaint, and stop. Only if the GC log shows a *named* failure do you touch anything else.

---

## Sizing the heap

Two dangers, in opposite directions.

**Too small** and the application spends its life collecting. **Too large** and each pause grows - the JVM will happily do fewer, longer collections and make your tail latency worse. Oaks measured a REST server across heap sizes: 256 MB spent 36% of time in GC and throughput was crippled; throughput climbed steeply to about 1,500 MB, then flattened as GC fell to ~6%; and above 4,500 MB **throughput started to decline** because the collections, though rarer, had become long enough to cost more than they saved.

**The hard rule: never specify a heap larger than physical memory**, and where several JVMs share a host, never let the sum exceed it. Leave at least 1 GB for the OS plus room for the JVM's own non-heap memory ([native-memory.md](native-memory.md)). The reason is specific and severe: a full GC touches the entire heap, so it is precisely the moment the OS is guaranteed to page - and a swapping full GC is an order of magnitude slower than a resident one. **Systems running Java must be configured so that swapping never happens.**

### Defaults, verified

On a 32 GB host with no heap flags at all:

| | 8u504 | 11.0.32.1 | 17.0.20.1 | 21.0.12 | 25.0.4.1 |
| --- | ----- | --------- | --------- | ------- | -------- |
| `InitialHeapSize` | 508 M | 508 M | 508 M | 508 M | 508 M |
| `MaxHeapSize` | 8122 M | 8122 M | 8124 M | 8124 M | 8124 M |
| `MaxRAMPercentage` | 25.0 | 25.0 | 25.0 | 25.0 | 25.0 |
| `InitialRAMPercentage` | 1.5625 | 1.5625 | 1.5625 | 1.5625 | 1.5625 |
| `MinRAMPercentage` | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |

So the defaults are **¼ of RAM for maximum** and **1/64 for initial**, consistently across all five versions. `MinRAMPercentage` is the misleading one: it does not set a minimum heap. It applies only when physical memory is *small* (under ~256 MB), capping the heap at 50% so the OS keeps room. Ignore it on any normal host.

The JVM grows the heap from initial towards maximum whenever it decides it is doing too much GC, so **an oversized maximum is not itself a memory cost** - the heap only expands if the GC goals demand it.

### How to pick a number

Run to steady state - caches populated, connections established - then force a full GC and read the occupancy:

```bash
jcmd <pid> GC.run && jcmd <pid> GC.heap_info
```

**Size the heap so it is roughly 30% occupied after a full GC.** That live set plus headroom is the working figure. Then add 0.5-1 GB of non-heap headroom when sizing the container.

```bash
# the common case, and often the only GC configuration needed
-Xms4g -Xmx4g

# containers: prefer a percentage so the JVM tracks the limit
-XX:InitialRAMPercentage=50.0 -XX:MaxRAMPercentage=75.0
```

**Write the percentage flags with a decimal point.** They are typed `double`, and this is not cosmetic - verified on Temurin 8u504, `-XX:MaxRAMPercentage=75` fails with *"Improperly specified VM option"* and **the JVM does not start**, while `-XX:MaxRAMPercentage=75.0` works. On 11, 17, 21 and 25 both forms are accepted. An integer therefore works everywhere except Java 8, which is exactly the kind of difference that breaks one environment in a fleet. Always write `75.0`.

**Setting `-Xms` equal to `-Xmx`** removes resize work and makes behaviour predictable, at the cost of adaptive sizing and of committing all of it up front. Worth it when you know the number; otherwise let the JVM adapt. Pair it with `-XX:+AlwaysPreTouch` (default `false`, verified on all five) to fault the pages in at startup - trading slower startup for no first-touch stalls later, which is usually right for a long-lived server and wrong for a CLI.

---

## Goal-based tuning

Rather than dictating geometry, tell the collector what you want and let it size the generations.

```bash
-XX:MaxGCPauseMillis=N     # target maximum pause
-XX:GCTimeRatio=N          # throughput goal, as a ratio
```

`GCTimeRatio` is unintuitive. The throughput target is `1 - 1/(1 + GCTimeRatio)`:

| `GCTimeRatio` | Target time in GC |
| ------------- | ----------------- |
| 99 | 1% |
| 19 | 5% |
| 12 | ~7.7% |
| 9 | 10% |

To go the other way, `GCTimeRatio = throughput / (1 - throughput)`.

**The defaults changed at Java 11 and this invalidates a lot of older advice.** Verified:

| | 8u504 | 11+ |
| --- | ----- | --- |
| `MaxGCPauseMillis` | `18446744073709551615` (unset) | **200** |
| `GCTimeRatio` | **99** | **12** |

The frequently repeated recommendation to "set `GCTimeRatio` to 19 because the default of 99 is unrealistic" was written against Java 8. On 11+ the default is already 12 - *more* permissive than 19 - so applying that advice tightens the goal and can make the JVM grow the heap in pursuit of it. Do not carry it forward without re-deriving it.

`MaxGCPauseMillis` takes precedence over `GCTimeRatio`: the JVM adjusts generation sizes until the pause goal is met, then grows the heap until the throughput goal is met, then shrinks to the smallest heap satisfying both.

**Be realistic.** Setting a very low pause goal makes the JVM shrink the old generation until it *can* be collected that fast, which means collecting it constantly. Oaks measured a GC-heavy workload: default settings settled on a 1.7 GB heap at 9.3% GC and 8.4 OPS; `MaxGCPauseMillis=50` forced the heap down to 588 MB, pushed GC to **15.1%** and dropped throughput to 7.9 OPS. The unrealistic goal made every metric worse.

### Adaptive sizing

`-XX:+UseAdaptiveSizePolicy` (default `true`) is how the JVM meets those goals, and **it should normally stay on** - it is what lets a small utility use 64 MB when the default maximum is 8 GB, and what lets most applications need no tuning at all. Turn it off only when you have finely tuned the geometry yourself, or when the application has sharply distinct phases and you want one of them optimal.

Setting `-Xms` = `-Xmx` *and* `-XX:NewSize` = `-XX:MaxNewSize` effectively disables it too, survivor spaces aside. Inspect its decisions with `-Xlog:gc+ergo*=debug` on 11+ (`-XX:+PrintAdaptiveSizePolicy` on 8 - **unrecognised and fatal on 11+**).

---

## Sizing the generations

Only after the collector, the heap and the goals. The trade-off: a larger young generation means longer but rarer young collections, less promotion, and a smaller old generation that fills sooner. There is no universally right split, which is why adaptive sizing exists.

```bash
-XX:NewRatio=N       # old:young ratio. Initial young = heap / (1 + N). Default 2 → young is 1/3
-XX:NewSize=N        # initial young size; overrides the NewRatio calculation
-XX:MaxNewSize=N     # maximum young size
-Xmn<size>           # sets NewSize and MaxNewSize together
```

`NewRatio` is **2 on all five versions** (verified), so the young generation starts at one third of the heap. With a fixed heap, prefer `-Xmn` for a fixed young generation; with a dynamic heap, adjust `NewRatio` and let both scale together. Specifying a min/max young range is the fiddliest option and rarely worth it.

### Survivor spaces and tenuring

Live objects move from eden to a survivor space, ping-pong between the two survivor spaces for a few collections, and are promoted to the old generation when they exceed the **tenuring threshold** or when the target survivor space overflows.

```bash
-XX:InitialSurvivorRatio=N   # initial: survivor = young / (N + 2). Default 8 → 10% each
-XX:MinSurvivorRatio=N       # the MAXIMUM survivor size (default 3 → 20%). Counter-intuitive name
-XX:TargetSurvivorRatio=N    # how full a survivor space should be after GC. Default 50
-XX:InitialTenuringThreshold=N   # default 7
-XX:MaxTenuringThreshold=N       # default 15
```

Verified on all five: `SurvivorRatio` 8, `TargetSurvivorRatio` 50, `InitialTenuringThreshold` 7, `MaxTenuringThreshold` 15. Note `MinSurvivorRatio` sets the *maximum* size, because a smaller ratio yields a larger space.

**What to look for.** The failure is short-lived objects being promoted straight to the old generation because the survivor space overflowed, which then drives full GCs.

```bash
-Xlog:gc+age=debug      # 11+
-XX:+PrintTenuringDistribution   # 8 only; fatal on 11+
```

```
Desired survivor size 35782656 bytes, new threshold 2 (max 6)
- age 1: 33291392 bytes, 33291392 total
- age 2:  4098176 bytes, 37389568 total
```

37 MB of surviving data against a 35 MB desired survivor size: it is overflowing, and the JVM has cut the threshold to 2 in response. **A tenuring threshold the JVM has driven down to 1 or 2 is the tell** - it has concluded that promotion is happening anyway.

**The right fix is almost always more heap, not a survivor tweak.** Enlarging the survivor spaces takes memory from eden, so young collections become more frequent; enlarging the young generation shrinks the old generation, so full GCs become more frequent. The only clean move is to raise the total heap (or the young generation) *and* lower the survivor ratio, so survivor spaces grow more than eden shrinks. And none of it helps if the objects were going to live a long time regardless - they will reach the old generation either way.

`-XX:+AlwaysTenure` and `-XX:+NeverTenure` exist (both default `false`) and are for experiments, not production.

---

## Tuning G1

**The goal is to eliminate full GCs.** Under G1 a full GC means the concurrent machinery lost a race. On Java 8 that full GC is **single-threaded** and can take many seconds; from 11 it is parallel and much cheaper - the strongest single GC argument for leaving 8.

Start and often finish with the pause goal:

```bash
-XX:MaxGCPauseMillis=200      # the default on 11+; raise it to give G1 more room
```

Raising it lets G1 collect more old regions per mixed collection, which lets the next concurrent cycle start sooner - frequently the whole fix. Lowering it shrinks the young generation and reduces the old regions collected per mixed GC, which makes concurrent mode failure *more* likely.

Then, only against a named failure in the log:

| Log signature | Meaning | Fix |
| ------------- | ------- | --- |
| Full GC interrupts a marking cycle (`concurrent-mark-abort`) | **Concurrent mode failure** - old gen filled before marking finished | More heap; lower `InitiatingHeapOccupancyPercent`; raise `ConcGCThreads` |
| Full GC immediately after a mixed collection, `to-space exhausted` | **Promotion failure** - mixed GCs too slow to free regions | Lower `G1MixedGCCountTarget`; more heap |
| `Pause Young (Normal) ... To-space exhausted` | **Evacuation failure** - heap full or fragmented | More heap |
| `Pause Full (G1 Humongous Allocation)` | No contiguous regions for a large object | Raise `G1HeapRegionSize`, or allocate smaller objects |
| Young collection delayed waiting for root region scan | Concurrent cycle cannot be interrupted mid-scan | Same fixes as concurrent mode failure |

```bash
-XX:InitiatingHeapOccupancyPercent=45   # when the concurrent cycle starts. Default 45
-XX:ConcGCThreads=N                     # concurrent marking threads. Default 2 on 11+
-XX:ParallelGCThreads=N                 # stop-the-world worker threads
-XX:G1MixedGCCountTarget=8              # mixed GCs to spread region collection over. Default 8
-XX:G1HeapRegionSize=N                  # power of two, 1-32 MB
```

**`InitiatingHeapOccupancyPercent` is a percentage of the whole heap, not the old generation** - unlike CMS's equivalent, which is a common confusion when migrating. It is a constant that G1 never adapts, so setting it too high causes full GCs and too low causes needless background work and extra short pauses. Read the occupancy after a concurrent cycle completes and set it comfortably above that.

Note that on 11+ this flag is adaptive by default via `-XX:+G1UseAdaptiveIHOP`; setting `InitiatingHeapOccupancyPercent` explicitly is what pins it.

**`ConcGCThreads` defaults differ:** verified 0 on 8u504 and 2 on 11+. Raising it shortens the concurrent cycle so G1 wins its race - but only if spare CPU exists. On a saturated machine, more concurrent threads steal from application threads and the cure is worse than the disease.

### Region sizing and humongous objects

Region size is a power of two between 1 MB and 32 MB, chosen so the heap holds roughly 2,048 regions:

| Heap | Default region size |
| ---- | ------------------- |
| < 4 GB | 1 MB |
| 4-8 GB | 2 MB |
| 8-16 GB | 4 MB |
| 16-32 GB | 8 MB |
| 32-64 GB | 16 MB |
| > 64 GB | 32 MB |

Verified defaults for a 96 MB heap: `G1HeapRegionSize` reads 0 on 8u504 (computed later), 2 MB on 11.0.32.1, and 4 MB on 17.0.20.1, 21.0.12 and 25.0.4.1 - so the ergonomics changed between 11 and 17.

**An object at least half a region is "humongous"** and is allocated directly into contiguous old-generation regions. Three consequences: it needs *contiguous* free regions, so it can fail on a heap that has room; it skips the young generation entirely, so a short-lived one defeats the generational design; and the tail of the last region is wasted (a 3.1 MB array in 1 MB regions occupies four regions and wastes 0.9 MB).

Two tuning cases:

- **A very wide heap range** - `-Xms2g -Xmx32g` yields 1 MB regions and, when fully expanded, 32,000 of them against a design point of ~2,048. Raise `G1HeapRegionSize` so the count is near 2,048 at the *expected* heap size.
- **Known large objects** - set the region size to at least twice the largest object plus one byte, so it is no longer humongous. This applies only from 512 KB upward, since the smallest region is 1 MB.

Find them with `-Xlog:gc+humongous=debug` (11+). On 8 the situation was far worse - humongous allocation often forced a full GC - and JDK 8u60 plus all 11+ builds largely fixed it.

---

## Tuning ZGC and Shenandoah

**Deliberately close to untunable.** Set a maximum heap and stop.

- Give them **more heap than G1 needs**, roughly 10-15% more, for barriers and metadata. Starving them is the main way to make them behave badly.
- Ensure spare CPU for concurrent work. Same principle as G1, more so.
- On 21, generational ZGC needs `-XX:+ZGenerational` - **verified present only on 21**, absent on 17, and accepted-but-ignored with a warning on 25 where generational is the only mode.
- Do not port G1's flags across. `MaxGCPauseMillis` and `InitiatingHeapOccupancyPercent` do not mean the same things, and most G1 flags have no ZGC equivalent.

---

## Controlling parallelism

`-XX:ParallelGCThreads=N` sets the stop-the-world worker count for every collector except Serial. The default is one per CPU up to 8, then `8 + (N - 8) * 5/8`:

| CPUs | Default GC threads |
| ---- | ------------------ |
| 1-8 | = CPU count |
| 16 | 13 |
| 32 | 23 |
| 64 | 43 |
| 128 | 83 |

Verified 8 on this 8-CPU host for all five versions.

**Two situations demand lowering it.** A small heap on a many-CPU machine - 83 threads dividing a 1 GB heap is pure coordination overhead. And **several JVMs on one host**: each sizes independently, so four JVMs on a 16-CPU box get 13 threads each, and 52 CPU-hungry threads contend for 16 CPUs whenever they collect simultaneously. Four each is far better. Even when they do not collide, one JVM collecting with 13 threads leaves the other three competing for the 3 remaining CPUs.

In a container this is computed from the **container's** CPU limit on 8u192+ and all later versions, so it is usually right without intervention. See [containers.md](containers.md).

---

## Metaspace

Class metadata lives outside the heap, in metaspace (permgen before Java 8). **Its default maximum is unlimited**, which is why it rarely needs sizing - and why an unbounded class loader leak can consume the machine.

```bash
-XX:MetaspaceSize=N        # initial; the high-water mark that first triggers a collection
-XX:MaxMetaspaceSize=N     # maximum. Unlimited by default
```

Verified initial: ~20 MB on 8u504 and 11.0.32.1, ~21 MB on 17.0.20.1, 21.0.12 and 25.0.4.1.

**Resizing metaspace requires a full GC**, so many full GCs during startup while classes load is the signature of an undersized initial value. Servers commonly set 128-256 MB initial to avoid it. Setting a maximum is a guard against class loader leaks - it converts "consume the host" into a diagnosable `OutOfMemoryError: Metaspace`. Inspect with `jcmd <pid> VM.metaspace` (11+) or `jcmd <pid> VM.classloader_stats` (8+).

On 8, CMS did not collect permgen by default and needed `-XX:+CMSClassUnloadingEnabled` plus `-XX:+CMSPermGenSweepingEnabled`. All of those flags are gone from 17+ along with CMS itself.

---

## Version notes

| Tuning | 8 | 11 | 17 | 21 | 25 |
| ------ | - | -- | -- | -- | -- |
| `MaxRAMPercentage` accepts integer form (`=75`) | ✗ **fatal** | ✓ | ✓ | ✓ | ✓ |
| `MaxRAMPercentage` accepts decimal (`=75.0`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `MaxRAMFraction` (superseded) | ✓ | ✓ accepted | ✓ accepted | ✓ accepted | **unrecognised, fatal** |
| `MaxGCPauseMillis` default | unset | 200 | 200 | 200 | 200 |
| `GCTimeRatio` default | 99 | 12 | 12 | 12 | 12 |
| G1 full GC parallel | ✗ | ✓ | ✓ | ✓ | ✓ |
| `G1UseAdaptiveIHOP` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `-XX:+PrintAdaptiveSizePolicy` | ✓ | **fatal** | fatal | fatal | fatal |
| `-XX:+PrintTenuringDistribution` | ✓ | **fatal** | fatal | fatal | fatal |
| `-Xlog:gc+age=debug` equivalent | ✗ | ✓ | ✓ | ✓ | ✓ |
| `PermSize` / `MaxPermSize` | ignored+warn | ignored+warn | **fatal** | fatal | fatal |
| `ZGenerational` | ✗ | ✗ | ✗ | ✓ required | ignored+warn |
| `AlwaysPreTouch` | ✓ false | ✓ false | ✓ false | ✓ false | ✓ false |

The migration hazards, all verified by launching the JVM:

- **`-XX:MaxRAMFraction=2` is accepted on 8, 11, 17 and 21, and unrecognised-and-fatal on 25.** A container startup script using it survives three LTS releases and breaks on the fourth.
- **Every `Print*` GC diagnostic from Java 8 is fatal on 11+** except `PrintGCDetails`, which is aliased with a warning. Translate them to `-Xlog` tags rather than deleting them.
- **`PermSize` / `MaxPermSize` are ignored with a warning on 8 *and* 11, and fatal from 17.** That two-release tolerance is why they survive so long in scripts.

## Gotchas

- Agent recommends a heap size, pause goal or any `-XX` flag without having seen the GC log - that is guessing; ask for the log
- Agent writes `-XX:MaxRAMPercentage=75` - fatal on Java 8; the flag is a `double`, so always write `75.0`
- Agent uses `-XX:MaxRAMFraction` - deprecated on 11-21 and **fatal on 25**; use `MaxRAMPercentage`
- Agent repeats "GCTimeRatio defaults to 99, set 19" on 11+ - the default is 12 there, and 19 is stricter
- Agent sets an aggressive `MaxGCPauseMillis` to "make pauses short" - shrinks the heap, raises GC frequency, and degrades everything
- Agent specifies a heap larger than physical memory, or sums several JVMs past it - guarantees swapping during full GC
- Agent believes an oversized `-Xmx` costs memory - the heap only grows if the GC goals require it
- Agent reads `MinRAMPercentage` as a minimum heap - it is a cap that applies only on very small-memory hosts
- Agent disables `UseAdaptiveSizePolicy` as a general optimisation - it is what makes the defaults work
- Agent tunes survivor ratios or tenuring thresholds first - high effort, low reward; the answer is usually more heap
- Agent treats `InitiatingHeapOccupancyPercent` as a percentage of the old generation - it is the whole heap, unlike CMS
- Agent raises `ConcGCThreads` on a CPU-saturated host - the threads cannot get cycles and steal from the application
- Agent ports G1 flags to ZGC - mostly meaningless there; set a maximum heap and leave it
- Agent forgets ZGC and Shenandoah want ~10-15% more heap than G1
- Agent leaves `ParallelGCThreads` default with several JVMs on one host - each sizes to the whole machine
- Agent ignores humongous allocation on a small-region heap - an object ≥ half a region skips the young generation and needs contiguous regions
- Agent sets `-XX:+AlwaysPreTouch` on a short-lived process - it pays the whole page-fault cost at startup for no benefit
- Agent sizes metaspace before checking whether full GCs cluster at startup - that clustering is the actual signal

## Related

- [garbage-collection.md](garbage-collection.md) · [triage.md](triage.md) · [heap-analysis.md](heap-analysis.md) · [allocation.md](allocation.md) · [native-memory.md](native-memory.md) · [containers.md](containers.md) · [methodology.md](methodology.md) · [flags.md](flags.md) · [java-versions.md](java-versions.md)
