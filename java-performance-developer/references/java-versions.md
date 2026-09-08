# Java Versions: The Performance Delta

What changed for performance in each release, and what an upgrade costs and buys. Every claim here was verified on Temurin **8u504, 11.0.32.1, 17.0.20.1, 21.0.12 and 25.0.4.1**.

| Upgrade | Headline performance gain | What breaks |
| ------- | ------------------------- | ----------- |
| **8 → 11** | Compact strings (**measured 56 → 48 bytes** for 8 chars, ~25% less heap for string-heavy apps); G1 full GC becomes parallel; thread stacks commit lazily (**61.7 MB → 3.7 MB** for 63 threads); unified logging; JFR open-sourced | Every Java 8 `Print*` GC flag except `PrintGCDetails`; the log-rotation trio (`UseGCLogFileRotation`, `NumberOfGCLogFiles`, `GCLogFileSize`); `UseParNewGC`; `CMSPermGenSweepingEnabled`; `UnlockCommercialFeatures`; `UseStringCache`; `AutoShutdownNMT`; `-d64` |
| **11 → 17** | ZGC and Shenandoah become production; default CDS archive ships (**~32% of startup**, measured paired); helpful NPE messages; dynamic AppCDS | **All CMS flags**; `UseParallelOldGC`; `AggressiveOpts`; `PermSize`/`MaxPermSize` |
| **17 → 21** | Virtual threads; generational ZGC (opt-in); `AutoCreateSharedArchive`; `Thread.dump_to_file` | `UseBiasedLocking` |
| **21 → 25** | **AOT cache** (measured **~18% startup on top of CDS**; see [startup-and-warmup.md](startup-and-warmup.md)); `synchronized` no longer pins virtual threads (24); compact object headers (**24 → 16 bytes** for a boxed `Long`); generational ZGC default; virtual thread diagnostics | `MaxRAMFraction`; `ZGenerational` becomes ignored |

**If you can only make one argument for upgrading:** compact strings and lazy thread stacks between 8 and 11 mean the same application typically runs in **~75% of the heap**, and Java 8's single-threaded G1 full GC turns a multi-second stall into a fraction of that.

---

## Per-version performance summary

### Java 8

The baseline, and still widely deployed. Both editions of Oaks' *Java Performance* target it, so the books are authoritative for this column and increasingly wrong for later ones.

- **Default collector is Parallel** (verified `UseParallelGC=true`). G1 exists and must be asked for.
- **CMS is available** and was the concurrent collector of choice. Every `CMS*` flag works here and nowhere later.
- **No compact strings** - `char[]` backing, so every string is 16 bits per character. Verified: an 8-char `String` costs 56 bytes against 48 on 11+.
- **Thread stacks commit eagerly** - verified 61,699 KB committed for 63 threads, against 3,665 KB on 25. Thread count is a direct, large memory cost on 8 and mostly not later.
- **Legacy GC logging** - `PrintGCDetails`, `PrintGCTimeStamps`, `Xloggc`, `UseGCLogFileRotation`. No `-Xlog`, and **no `jcmd VM.log`**, so enabling GC logging requires a restart. That is the real diagnostic loss.
- **No default CDS archive** - verified absent. `-Xshare:dump` builds one, but on 8 CDS is restricted to `rt.jar`.
- **`GCTimeRatio` defaults to 99** and `MaxGCPauseMillis` is unset - both change at 11.
- **`StringTableSize` is 60013** (65536 later).
- **`AggressiveOpts` substitutes faster `HashMap`, `TreeMap`, `BigDecimal` and format classes.** Removed in 12.
- **Permgen is already gone**, replaced by metaspace *in* 8. `MaxPermSize` is accepted and ignored with a warning.
- **JFR works from 8u262+** with no unlock flag - verified on 8u504, which produced a valid 219 KB recording. Do not tell users on current 8 builds that JFR is unavailable.
- **Container awareness from 8u192+**, cgroup v2 from 8u372+. Below those, the JVM reads the *host's* CPU count and memory and will size a heap that gets the container killed.

**The Java 8 hall pass:** plenty of production Java 8 exists and will continue to. When advising on 8, the constraints above are the environment - do not lead with "upgrade" unless asked. But **do** state the measured cost of staying: ~25% more heap for string-heavy applications, a single-threaded G1 full GC, thread stacks committed eagerly, and no way to turn on GC logging without a restart.

### Java 11

- **G1 becomes the default** (verified `UseG1GC=true`).
- **G1's full GC becomes parallel.** On 8 it is single-threaded and can take many seconds; this is the strongest single GC argument for leaving 8.
- **Compact strings** (JEP 254, from 9) - measured 56 → 48 bytes for 8 chars, 40 → 24 for empty.
- **Thread stacks commit lazily** (from 9) - the measured 61.7 MB → 3.7 MB change.
- **Unified `-Xlog`** replaces every legacy GC logging flag, and **`jcmd VM.log` can enable logging on a running JVM**.
- **JFR open-sourced** - available in every OpenJDK build.
- **Segmented code cache** (verified `SegmentedCodeCache` absent on 8, `true` from 11) - separate heaps for profiled, non-profiled and non-method code.
- **`GCTimeRatio` default changes from 99 to 12**, and `MaxGCPauseMillis` gains a default of 200. **This invalidates the widely repeated advice to "set `GCTimeRatio` to 19 because 99 is unrealistic"** - 12 is already more permissive than 19.
- **ZGC arrives, experimental.** Verified: `-XX:+UseZGC` **fails to start on 11** without `-XX:+UnlockExperimentalVMOptions`.
- **Shenandoah arrives** as a product flag in Adoptium builds; absent from Oracle's.
- **`String` concatenation compiles to `invokedynamic`** (from 9). Verified with `javap`. But see the honest measurement in [strings.md](strings.md) - I did not reproduce a general speedup.
- **Old-style AOT exists here and only here.** Verified: `-XX:+UseAOT` reports `mixed mode, aot` and `jaotc` is present on 11, both absent from 17. Oaks' entire `jaotc` / `AOTLibrary` section applies to exactly one release.
- **`MaxPermSize` still tolerated** (ignored with a warning), which is why it survives into so many 11 deployments.
- **No default CDS archive yet** - verified absent.

### Java 17

- **ZGC becomes production** (verified `product`, no unlock needed). Shenandoah likewise.
- **Default CDS archive ships** - verified `classes.jsa`, 12 MB. **Measured on 25: `-Xshare:off` costs ~32% of startup** (paired, 31.9% and 31.8% across two passes), so from 17 the largest startup win is on by default.
- **Dynamic AppCDS** - `-XX:ArchiveClassesAtExit` verified present from 17, absent on 8 and 11. One step instead of three.
- **Helpful NullPointerException messages** on by default (JEP 358, from 15).
- **CMS is gone.** Verified: `-XX:+UseConcMarkSweepGC` and every `CMS*` flag **unrecognised and fatal**. Also fatal from here: `UseParallelOldGC`, `AggressiveOpts`, `PermSize`/`MaxPermSize`.
- **`AutoShutdownNMT` disappears** - NMT no longer disables itself under pressure, which is what you want.
- **`G1HeapRegionSize` ergonomics change** - verified 2 MB on 11 and 4 MB on 17 for the same heap.
- **`UseBiasedLocking` still accepted** (biased locking was disabled by default in 15), and becomes fatal at 21.

### Java 21

- **Virtual threads** (JEP 444). Thread-per-request becomes viable again, and pool sizing for blocking I/O stops being the constraint.
- **`synchronized` still pins a virtual thread** - a hard concurrency ceiling at the carrier count. Fixed in 24. On 21-23, replace `synchronized` with `ReentrantLock` around blocking calls.
- **Generational ZGC, opt-in.** Verified: `ZGenerational` exists **only on 21** - absent on 17 and on 25.
- **`AutoCreateSharedArchive`** - verified present from 21. Self-healing CDS archives.
- **`jcmd Thread.dump_to_file`** with JSON output - verified from 21.
- **`jdk.VirtualThreadPinned` JFR event.**
- **`UseBiasedLocking` becomes fatal.** Verified accepted on 17, unrecognised on 21.
- **`HashMap.newHashMap(n)`** (from 19) sizes correctly for the load factor.

### Java 25

- **AOT cache** (Project Leyden, JEP 483 in 24 / 514 and 515 in 25). Verified `AOTCache`, `AOTCacheOutput`, `AOTMode` as product flags on 25 and absent from 21; `AOTMode` accepts exactly `off, record, create, auto, on`. **Measured ~18% off startup on top of CDS** (17.9% and 17.5% across two independent paired passes, IQR 15.7-20.9). This is the replacement for Oaks' `jaotc`, and an unrelated mechanism.
- **`synchronized` no longer pins virtual threads** (JEP 491, delivered in 24).
- **Compact object headers** (`UseCompactObjectHeaders`, verified product, off by default). Measured: an empty object **16 → 8 bytes**, and `TwoInt`, `OneLong`, `IntPlusRef`, `byte[1]` and a boxed `Long` all **24 → 16 bytes**.
- **Generational ZGC is the only mode.** `ZGenerational` accepted but ignored with a warning.
- **`MaxRAMFraction` becomes fatal.** Verified accepted on 8-21.
- **Virtual thread diagnostics:** `jcmd Thread.vthread_scheduler` and `Thread.vthread_pollers`, verified present only on 25. Neither edition of Oaks covers them.
- **Graal compiler module renamed** `jdk.internal.vm.compiler` → **`jdk.graal.compiler`**. Verified with `--list-modules`.
- **Stream gatherers** (`Stream.gather`, from 24) - the supported extension point for intermediate operations, including `mapConcurrent` which uses virtual threads.
- **`System.map` / `System.dump_map`** jcmd commands, verified only on 25.

---

## The consolidated matrix

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| Default collector | **Parallel** | G1 | G1 | G1 | G1 |
| CMS available | ✓ | ✓ | ✗ fatal | ✗ | ✗ |
| ZGC | ✗ | experimental | product | product | product |
| Generational ZGC | ✗ | ✗ | ✗ | opt-in | **default** |
| Shenandoah (Adoptium) | ✗ | ✓ | ✓ | ✓ | ✓ |
| G1 full GC parallel | ✗ | ✓ | ✓ | ✓ | ✓ |
| Unified `-Xlog` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `jcmd VM.log` (enable logging live) | ✗ | ✓ | ✓ | ✓ | ✓ |
| JFR without an unlock flag | 8u262+ | ✓ | ✓ | ✓ | ✓ |
| Compact strings | ✗ | ✓ | ✓ | ✓ | ✓ |
| Compact object headers | ✗ | ✗ | ✗ | ✗ | **opt-in** |
| Lazy thread stack commit | ✗ | ✓ | ✓ | ✓ | ✓ |
| Segmented code cache | ✗ | ✓ | ✓ | ✓ | ✓ |
| Default CDS archive | ✗ | ✗ | **✓** | ✓ | ✓ |
| Dynamic AppCDS | ✗ | ✗ | ✓ | ✓ | ✓ |
| `AutoCreateSharedArchive` | ✗ | ✗ | ✗ | ✓ | ✓ |
| Old-style AOT (`jaotc`) | ✗ | **✓ only** | ✗ | ✗ | ✗ |
| AOT cache | ✗ | ✗ | ✗ | ✗ | **✓** (24+) |
| Virtual threads | ✗ | ✗ | ✗ | ✓ | ✓ |
| `synchronized` pins virtual threads | - | - | - | **✓** | ✗ |
| Container awareness | 8u192+ | ✓ | ✓ | ✓ | ✓ |
| cgroup v2 | 8u372+ | 11.0.16+ | ✓ | ✓ | ✓ |
| Helpful NPE messages | ✗ | ✗ | ✓ | ✓ | ✓ |
| Default charset UTF-8 | ✗ | ✗ | ✗ | ✓ (18+) | ✓ |
| `GCTimeRatio` default | **99** | 12 | 12 | 12 | 12 |
| `MaxGCPauseMillis` default | **unset** | 200 | 200 | 200 | 200 |
| `StringTableSize` default | **60013** | 65536 | 65536 | 65536 | 65536 |

---

## Upgrade procedure

The flag work is mechanical, and skipping it is how upgrades fail in production rather than in test.

**1. Translate the flags before anything else.** Consult the removal matrix in [flags.md](flags.md). Most removed flags are **fatal**, so a JVM with a stale command line does not start - which is at least a loud failure. The dangerous ones are the tolerant ones: `MaxPermSize` and `MaxRAMFraction` are silently accepted for two to three LTS releases.

**2. Translate GC logging.**

| Java 8 | 11+ |
| ------ | --- |
| `-Xloggc:gc.log` | `-Xlog:gc*:file=gc.log` |
| `-XX:+PrintGCDetails` | `-Xlog:gc*` |
| `-XX:+PrintGCTimeStamps` | `:uptime` decorator |
| `-XX:+PrintGCDateStamps` | `:time` decorator |
| `-XX:+UseGCLogFileRotation -XX:NumberOfGCLogFiles=8 -XX:GCLogFileSize=16M` | `:filecount=8,filesize=16M` |
| `-XX:+PrintTenuringDistribution` | `-Xlog:gc+age=debug` |
| `-XX:+PrintReferenceGC` | `-Xlog:gc+ref=debug` |
| `-XX:+PrintAdaptiveSizePolicy` | `-Xlog:gc+ergo*=debug` |
| `-XX:+PrintTLAB` | `-Xlog:gc+tlab=trace` |

Note the count differs by one: Java 8's rotation keeps `NumberOfGCLogFiles` plus a `.current`; Java 11's `filecount=N` yields N+1 active files.

**3. Re-baseline rather than assuming.** Two things change under you: the **default collector** (Parallel → G1 at 11) and **`GCTimeRatio`** (99 → 12 at 11). So a naive "8 versus 17" comparison measures the collector change as well as the release. Pin the collector on both sides and say which you pinned. See [methodology.md](methodology.md).

**4. Re-tune the heap downward.** After 8 → 11+, compact strings alone often allow ~25% less heap for the same performance. **Try reducing `-Xmx` rather than leaving it** - that is the payoff, and it is easy to leave on the table.

**5. Rebuild derived artefacts.** CDS archives and AOT caches are tied to a JVM version and configuration. An AOT cache also records `UseCompressedOops`, `UseCompressedClassPointers` and `UseCompactObjectHeaders`, so it stops applying if any of those change - including by crossing the 32 GB heap boundary.

**6. Recompile, and check `--release`.** Verified: `javac 25 --release 8` still emits `StringBuilder` concatenation rather than `invokedynamic`. A project that moved its runtime to 25 but left `--release 8` has not moved its string concatenation. Compact strings, by contrast, are a *runtime* feature and need no recompilation.

**7. On 21-23, audit `synchronized` around blocking calls** before enabling virtual threads. Include your drivers, connection pools and logging frameworks - the pinning is invisible at the call site. Not needed from 24.

---

## Version notes

How to establish what you are actually running, since every claim in this file depends on it, and the answer is frequently not what the project's build file says.

```bash
java -version                        # the runtime that matters
jcmd <pid> VM.version                # the build actually running, for a live process
jcmd <pid> VM.command_line           # what it was started with
jcmd <pid> VM.flags -all             # every flag, including ergonomic values
```

Three distinctions that decide which column of every table applies:

| Question | Why it matters |
| -------- | -------------- |
| **Which JDK *runs* it**, not which compiles it | Collector, flag set, log format, compact strings and virtual thread pinning are all runtime properties |
| **Which `--release` was compiled** | Verified: `--release 8` on javac 25 still emits `StringBuilder` concatenation. The bytecode can be older than the runtime |
| **Which *update* release** | 8u192 (containers), 8u262 (JFR), 8u372 (cgroup v2) and 8u92 (`ExitOnOutOfMemoryError`) are all significant boundaries inside "Java 8" |

**"Java 8" is not one answer.** A 2015 8u60 and a current 8u504 differ on container awareness, JFR availability, cgroup v2 and the string table default. Ask for the update version before advising on Java 8, and check `java -version` rather than trusting a Dockerfile base tag.

Vendor matters in exactly one place covered here: **Shenandoah is present in Adoptium and absent from Oracle's builds.** Everything else in this skill was consistent across the Temurin builds tested, and no other vendor was tested.

## Gotchas

- Agent gives Java 8 advice for a modern JVM, or the reverse - the default collector, flag set and log format all differ
- Agent treats "Java 8" as one version - 8u192, 8u262, 8u372 and 8u92 are real capability boundaries inside it
- Agent reads the version from the build file rather than the runtime - the runtime is what determines almost everything here
- Agent copies a Java 8 command line forward - every `Print*` GC flag except `PrintGCDetails` is fatal from 11
- Agent copies a CMS-tuned command line to 17+ - every `CMS*` flag is fatal there
- Agent assumes a removed flag will be ignored - most are fatal; `MaxPermSize` and `MaxRAMFraction` are the tolerant exceptions, which is why they persist
- Agent repeats "set `GCTimeRatio` to 19" on 11+ - the default is 12 there, already more permissive
- Agent compares releases without pinning the collector - Parallel → G1 at 11 is part of what you would be measuring
- Agent upgrades from 8 and leaves `-Xmx` unchanged - compact strings often allow ~25% less
- Agent expects compact strings to need a recompile - runtime feature; but `--release 8` *does* block the concat change
- Agent recommends `jaotc` or `-XX:AOTLibrary` - Java 11 only
- Agent recommends the AOT cache before 24 - it does not exist there
- Agent enables virtual threads on 21-23 without auditing `synchronized` around blocking calls - pins the carrier
- Agent sets `-XX:+ZGenerational` on 25 - ignored; only meaningful on 21
- Agent assumes container awareness on any Java 8 - needs 8u192+, and cgroup v2 needs 8u372+
- Agent tells a Java 8 user JFR is unavailable - works from 8u262+ with no unlock flag
- Agent reuses a CDS archive or AOT cache across a JVM upgrade or a heap-flag change - both are invalidated
- Agent leads with "upgrade" when asked about Java 8 - state the measured cost of staying, then answer the question asked

## Related

- [flags.md](flags.md) · [book-deltas.md](book-deltas.md) · [garbage-collection.md](garbage-collection.md) · [gc-tuning.md](gc-tuning.md) · [strings.md](strings.md) · [allocation.md](allocation.md) · [startup-and-warmup.md](startup-and-warmup.md) · [native-memory.md](native-memory.md) · [containers.md](containers.md) · [concurrency-performance.md](concurrency-performance.md) · [checklist.md](checklist.md)
