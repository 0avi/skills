# Book Deltas

This skill derives from Scott Oaks' **_Java Performance_** - the 1st edition (*The Definitive Guide*, 2014, Java 7/8) and the 2nd edition (2020, Java 8/11). Both were read in full.

This file records, in the same spirit as the sibling skills' style-delta files, exactly **where this skill departs from the books and why**, and what it could not verify. The books remain the best treatment of the subject. They are also five years old, and the JVM half of them has changed more between 2020 and Java 25 than it did between the two editions.

---

## First: the two books are one book

`java-performance-the-definitive-guide` and `java-performance-in-depth-advice-for-tuning-and-programming-java-8-11-and-beyond` are **the 1st and 2nd editions of the same Scott Oaks book**, not two independent works.

That changes how they are used here. The 2nd edition supersedes the 1st on every shared topic, so the 1st contributes only where the 2nd **dropped** material. Its unique content is:

| 1st-edition-only material | Status now |
| ------------------------- | ---------- |
| Client vs server compiler, `-client`/`-server`/`-d64` | Obsolete. `-d64` **fatal from 11** |
| Permgen sizing (`PermSize`, `MaxPermSize`) | Obsolete. Permgen gone **in** Java 8; flags **fatal from 17** |
| CMS permgen sweeping (`CMSPermGenSweepingEnabled`, `CMSClassUnloadingEnabled`) | Obsolete. **Fatal from 17** |
| Incremental CMS (`CMSIncrementalMode` and its duty-cycle flags) | Obsolete. Deprecated in 8, **fatal from 17** |
| `AggressiveOpts` and its alternate `HashMap`/`TreeMap`/`BigDecimal` implementations | Obsolete. Removed in 12, **fatal from 17** |
| `UseSpinning` | Obsolete. **Absent from all five versions tested** |
| Java EE: EJB pools and caches, HTTP session replication, local vs remote interfaces, IIOP | Obsolete as written. The pooling *principle* survives in [object-lifecycle.md](object-lifecycle.md) |
| XML: SAX vs StAX vs DOM vs JAXB, schema validation, parser factory lookup | Largely superseded by JSON. Kept in reduced form in [server-performance.md](server-performance.md) |
| 32-bit JVM trade-offs | Obsolete for practical purposes |
| `JPA Read-Only Entities` | Provider-specific; folded into [database-performance.md](database-performance.md) |

**Four things from the 1st edition are carried forward** because they are durable and the 2nd edition dropped or shortened them:

1. **The coarse-vs-chatty interface trade-off**, with its measured inflection point (10 × 60 B costing as much as 1 × 186 KB, and how caching moves the crossover). In [server-performance.md](server-performance.md).
2. **Wire-level payload work** - whitespace stripping and compression, with the LAN/broadband/WiFi table showing compression *hurting* on a LAN and helping 60× on public WiFi. In [server-performance.md](server-performance.md).
3. **Factory and schema reuse** as a general pattern, and the classpath-scan-per-factory-creation hazard. In [server-performance.md](server-performance.md).
4. **The object-identity trap in hand-written serialization**, which the 2nd edition kept but which originates here. In [io-performance.md](io-performance.md).

**Because this skill covers Java 8, the 1st edition is not discarded - it is version-scoped.** Its CMS tuning, permgen sizing and 32-bit material is wrong for 25 and correct for 8, and it is the authoritative source for the Java 8 column of every version table.

---

## Errata found by running the book's flags

Three. Each would produce a JVM that does not start.

| Book says | Reality | Verified |
| --------- | ------- | -------- |
| `-XX:MaxFreqInlineSize=N`, default 325 | **Does not exist on any version.** The flag is **`FreqInlineSize`**, default 325 | Absent on 8, 11, 17, 21, 25; `FreqInlineSize=325` present on all five |
| `-XX:ProfiledCodeHapSize`, `-XX:NonProfiledCodeHapSize` | **Misspelled** - "Hap" for "Heap". The flags are `ProfiledCodeHeapSize` / `NonProfiledCodeHeapSize` | The "Hap" forms absent from all five; the "Heap" forms present from 11 |
| Appendix A lists `-XX:HeapFreeLimit` | Does not exist. The body text correctly uses `GCHeapFreeLimit` | `GCHeapFreeLimit=2` on all five |

The third is a book-internal inconsistency rather than a straight typo - the prose is right and the appendix is wrong.

---

## Where the JVM has moved on

The 2nd edition is accurate for Java 8 and 11. These are the places following it on a modern JVM would be actively wrong.

### Collectors

| Book | Now |
| ---- | --- |
| CMS covered in depth as *the* concurrent collector, with a full tuning section | **Removed in 14. Every `CMS*` flag is fatal from 17** |
| ZGC and Shenandoah "experimental, may be production-ready by the next LTS" | **Both production from 17.** ZGC needs an unlock flag on 11 (verified fatal without it) |
| Generational ZGC does not exist | **Opt-in on 21 (`ZGenerational`), default from 23.** The flag exists *only* on 21 and is ignored on 25 |
| Epsilon "may become production-ready" | **Still experimental on 11, 17, 21 and 25** |
| G1 full GC single-threaded (Java 8), parallel (11) | Correct, and the strongest GC argument for leaving 8 |

### Defaults that changed under the book

| Flag | Book (8) | Now (11+) | Consequence |
| ---- | -------- | --------- | ----------- |
| `GCTimeRatio` | 99 | **12** | The book's "start with 19" advice **tightens** the goal on 11+, where 12 is already more permissive |
| `MaxGCPauseMillis` | not set | **200** | A pause goal now exists by default |
| `StringTableSize` | 60013 | 65536 | Minor |
| Default collector | Parallel | **G1** | Cross-version comparisons must pin the collector |
| `G1HeapRegionSize` | computed | 2 MB (11), **4 MB (17+)** | Ergonomics changed between 11 and 17 |

**`GCTimeRatio` is the most consequential.** It is repeated advice in a widely read book that is now backwards, and it will make a JVM grow its heap chasing a goal the user did not intend.

### Ahead-of-time compilation: entirely replaced

The book devotes a section to `jaotc`, `-XX:AOTLibrary` and `--compile-for-tiered`.

**Verified: that mechanism existed in Java 11 and nowhere else.** `-XX:+UseAOT` reports `mixed mode, aot` on 11.0.32.1 and the `jaotc` binary is present there; both are absent from 17, 21 and 25 (removed by JEP 410).

Its replacement is the **AOT cache** in Java 24/25 - `-XX:AOTCache`, `-XX:AOTMode`, `-XX:AOTCacheOutput`, verified as product flags on 25 and absent from 21. It is a **different mechanism**: it records class loading, linking and method profiles rather than compiling to native code. Measured here at ~10-15% off startup on top of CDS. Covered in [startup-and-warmup.md](startup-and-warmup.md).

### GC logging: a hard break the book cannot warn about

The book documents both Java 8 and Java 11 forms, which is correct. What it cannot tell you is the **severity** of the transition, which this skill verified by launching each JVM:

- `-XX:+PrintGCDetails` and `-Xloggc:` survive as **deprecated aliases**.
- `-XX:+PrintGCTimeStamps`, `PrintGCDateStamps`, `UseGCLogFileRotation`, `PrintTenuringDistribution`, `PrintReferenceGC`, `PrintAdaptiveSizePolicy`, `PrintTLAB` and `PrintStringDeduplicationStatistics` are **unrecognised and the JVM refuses to start.**

So a Java 8 logging block does not degrade - it stops the JVM. Full matrix in [flags.md](flags.md).

### Things that did not exist in 2020

| Feature | Version | Where |
| ------- | ------- | ----- |
| Virtual threads | 21 | [concurrency-performance.md](concurrency-performance.md) |
| `synchronized` no longer pinning a virtual thread | 24 | [concurrency-performance.md](concurrency-performance.md) |
| `StructuredTaskScope` | 21 preview | Deferred to [`java-developer`](../../java-developer/SKILL.md) |
| Compact object headers | 25 | [allocation.md](allocation.md) |
| AOT cache | 24 | [startup-and-warmup.md](startup-and-warmup.md) |
| Default CDS archive shipped | 17 | [startup-and-warmup.md](startup-and-warmup.md) |
| Dynamic AppCDS, `AutoCreateSharedArchive` | 17, 21 | [startup-and-warmup.md](startup-and-warmup.md) |
| `jdk.ObjectAllocationSample` JFR event | 16 | [heap-analysis.md](heap-analysis.md) |
| `Thread.vthread_scheduler` / `vthread_pollers` | 25 | [tooling.md](tooling.md) |
| Stream gatherers | 24 | [lambdas-and-streams.md](lambdas-and-streams.md) |
| Helpful NPE messages by default | 15 | [exceptions-and-logging.md](exceptions-and-logging.md) |
| Default charset UTF-8 | 18 | [strings.md](strings.md) |
| Container CPU/memory awareness as standard | 8u192 | [containers.md](containers.md) |

**Virtual threads are the largest single change**, because they invalidate the book's central thread-pool-sizing advice for I/O-bound work. That advice was a workaround for threads being expensive. This skill keeps the sizing arithmetic for CPU-bound work and for pre-21 code, and says plainly where it no longer applies.

### The Graal JIT

The book presents the Graal JIT with a table of its performance against C2, concluding it was catching up.

Two corrections. **The module is still present on 25 but was renamed** - verified with `--list-modules`: `jdk.internal.vm.compiler` on 11, 17 and 21, and **`jdk.graal.compiler`** on 25.0.4.1. And the book's numbers are long superseded, since both compilers moved repeatedly in the intervening releases. This skill therefore says the flag starts and the module exists, treats it as worth an experiment on compute-bound work, and quotes no figures. See the honest-limits section below.

### NMT categories

The book states direct byte buffers appear under NMT's `Internal` section. **Verified correct on 8u504 and wrong on 25.0.4.1**, where a deliberately allocated 32 MB direct buffer appeared under **`Other`**. A reader following the book on a modern JVM would look in the wrong place.

---

## Where this skill's own measurements disagree with the book

Reported because the book is the source and disagreement matters.

### Single-expression string concatenation

**The book reports 49.4 ns against 77.0 ns** for a concatenation involving a `double`, attributing the gain to Java 11's `invokedynamic` strategy and recommending recompilation.

**Measured here: ~39-43 ns in every configuration** - javac 8 on JDK 8, javac 11 on 11, javac 25 on 25, and javac 25 `--release 8` on 25. **No meaningful difference.**

The probable reconciliation is that the book's case used a `double`, where the Java 8 `StringBuilder` strategy bailed out to a slow path, while this test concatenated `String + String + int`, which Java 8 handled well. So the fair statement, adopted in [strings.md](strings.md), is that **the indified strategy helps where the Java 8 one bailed out and is roughly neutral otherwise.** This skill does not promise a general concatenation speedup from recompiling.

### Streams against iterators over a full traversal

**The book reports 7 ms for a single filter against 7.4 ms for an iterator**, concluding a filter "will slightly outperform an iterator".

**Re-measured with JMH: the book is not contradicted, and an earlier version of this file was wrong to say it was.**

| Shape | n | Loop | Sequential stream | Ratio | Real difference? |
| ----- | - | ---- | ----------------- | ----- | ---------------- |
| `int[]` sum | 100,000 | 9.884 ± 0.195 µs | 10.567 ± 0.620 µs | 1.07× | **No - ranges overlap** |
| filter + map + sum | 100,000 | 398.5 ± 63.9 µs | 428.6 ± 21.4 µs | 1.07× | **No - ranges overlap** |
| `List<Integer>` sum | 1,000 | 0.638 ± 0.017 µs | 0.866 ± 0.027 µs | 1.36× | Yes |

The book's two numbers (7 ms against 7.4 ms) were within noise of each other, and **so are two of the six shapes measured here.** An earlier version of this file reported "6,794 µs against 4,155 µs, ~1.6× slower" from a hand-rolled harness and called the book's finding reversed. Those figures were around 400× the JMH result for the same traversal, which is the signature of a harness measuring itself; **the reversal is withdrawn.**

What both sets of measurements actually support: **over a full traversal the difference between a loop and a sequential stream is small and frequently not measurable**, so neither Oaks' "slightly outperforms" nor a "1.6× slower" claim should be repeated as a finding. The book's laziness result is confirmed and strengthened - short-circuiting turns an O(n) traversal into an O(1) one, which is a complexity argument rather than a multiplier. See [lambdas-and-streams.md](lambdas-and-streams.md).

### What the measurements confirmed

Reported for symmetry, since the book is right far more often than not:

- **Object sizes.** 16 bytes minimum, 16 for `OneInt`, 24 for `TwoInt`, arrays with a 16-byte header. Exactly as the book's table states, on all five versions.
- **Compact strings.** 8-char `String` 56 bytes on 8 against 48 on 11+; empty 40 against 24.
- **Collection sizing.** The book asserts a benefit without a figure. JMH: **`HashMap` 1.54× at 1,000 entries and 2.30× at 100,000**; `ArrayList` 1.15× at 1,000 and **nothing measurable at 100,000**. The book's direction is right, and it was wise not to give a number.
- **Buffered I/O.** The book's ~3.7× for buffered gzip (Table 12-6, and note its ± 8 ms); re-measured, **2.7× with the buffer between caller and deflater and 1.0× with it outside** - the book's *placement* advice is the part that matters and it is correct. For the unbuffered file cases it describes qualitatively: **143× on reads and 763× on writes.**
- **Exception stack depth.** The book's shallow-vs-deep framing is right in direction. JMH, with a control: **1,300 ns at depth 1 against 6,716 ns at depth 60**, and stack-trace capture scaling **sublinearly** (2.9× for a 60× deeper stack). A throw with no stack trace at all is **0.9 ns from one frame down but 2,985 ns from sixty**, so the throw is not free once the stack is deep - see [exceptions-and-logging.md](exceptions-and-logging.md).
- **The string intern table's sensitivity to sizing.** Mechanism unchanged; only the default improved from 1,009 to 60,013/65,536.
- **`MaxRAMPercentage`, `MaxGCPauseMillis`, `GCTimeRatio`, `NewRatio`, `SurvivorRatio`, tenuring thresholds, code cache sizes, inlining thresholds, `CICompilerCount`** - every default the book states for 8 and 11 matched.

---

## What this skill could not verify

Stated plainly, because the rest of it claims verification.

- **Container detection.** cgroups are Linux; `UseContainerSupport` is absent from every Windows build tested. The **CPU cascade** was verified via `-XX:ActiveProcessorCount`, which reproduces what a quota does to the JVM's view, but cgroup *detection* was not.
- **Linux page flags.** `UseTransparentHugePages` does not exist in these builds; `UseLargePages` exists and reads `false` but was not exercised.
- **Whether the Graal JIT actually compiles.** The flag starts and the module is present. Whether Graal was used was not confirmed.
- **Multi-machine and multi-JVM effects.** Everything ran on one 8-CPU Windows laptop. The book's figures for many-JVM hosts, large SPARC register-flush effects, false sharing across cores and network-dependent results are quoted **as the book's**, with attribution, and were not reproduced.
- **False sharing.** The measurement quoted is the book's. It requires specific hardware knowledge to reproduce reliably.
- **Cross-version absolute startup times.** Attempted and abandoned: this host produced a 29-second outlier on a ~300 ms workload. Only the **ratios** within a single JVM (CDS on/off, AOT cache on/off), which reproduced across two independent passes of 20 runs, are reported.
- **Other vendors.** All Temurin. **Shenandoah is a build-level difference** - `product` in Adoptium, absent from Oracle's builds.
- **Other platforms.** All Windows x64. Flags marked platform-dependent differ, and the default heap sizes are functions of this host's 32 GB and 8 CPUs.
- **Update-version boundaries.** Claims like "8u192+ for container awareness", "8u262+ for JFR", "8u372+ for cgroup v2" come from release history, not from testing each update release.
- **Oaks' throughput and response-time figures generally.** Quoted with attribution where they illustrate a principle. They were measured on his hardware, on Java 8 and 11, and indicate **magnitude and direction**, not values to expect.

---

## How to treat the books now

- **For Java 8 and 11**: authoritative. Follow them, with the three errata above.
- **For 17, 21 and 25**: excellent on *mechanism* - how collectors work, why buffering matters, what escape analysis does, how to think about pool sizing - and unreliable on *flags, defaults and collector availability*. **Check every flag against [flags.md](flags.md) before acting on it.**
- **The methodology chapters (2 and 3) have aged best.** Benchmark categories, the statistics of regression testing, throughput against response time, percentiles, warm-up, and the discipline of measuring everything are unchanged and remain the most valuable part of the books. [methodology.md](methodology.md) follows them closely.
- **The thread-sizing chapter needs a virtual-threads asterisk** on 21+, but its CPU-bound arithmetic and its warning about over-sizing are intact.

## Version notes

Which edition is authoritative for which release, and where this skill takes over.

| Release | Authoritative source | Caveat |
| ------- | -------------------- | ------ |
| **7** | 1st edition | Out of scope for this skill |
| **8** | **1st edition for CMS, permgen and 32-bit; 2nd edition for everything else** | The 2nd edition's Java 8 coverage is more mature. Use the 1st only for material the 2nd dropped |
| **11** | **2nd edition** | Accurate throughout, including the 8-to-11 transition |
| **17** | This skill | Books predate CMS removal, production ZGC and shipped CDS |
| **21** | This skill | Books predate virtual threads entirely |
| **25** | This skill | Books predate the AOT cache, compact object headers and the pinning fix |

The books' chapter-by-chapter status on a modern JVM:

| Chapter | Status on 17+ |
| ------- | ------------- |
| 1 Introduction, 2 Performance testing, 3 Toolbox | **Aged best.** Mechanism and discipline unchanged; only tool availability moved |
| 4 JIT compiler | Mechanism correct. AOT section applies to Java 11 only; two flag errata |
| 5, 6 Garbage collection | Mechanism correct. **Collector catalogue and several defaults wrong** |
| 7 Heap memory | Correct, including the object-size table. Missing compact object headers |
| 8 Native memory | Correct. Direct buffers moved from `Internal` to `Other` |
| 9 Threading | CPU-bound arithmetic correct. **Needs a virtual-threads asterisk on 21+** |
| 10 Java servers | Principles correct, framework specifics dated |
| 11 Database | **Almost entirely current.** The least-aged technical chapter |
| 12 Java SE API | Correct. Table 12-11 (lambdas vs anonymous classes) is the figure to use and supersedes the 1st edition's. The single-expression concatenation claim could not be reproduced here |
| Appendix A Tuning flags | **The most degraded part.** Check every entry against [flags.md](flags.md) |

## Gotchas

- Agent treats the two PDFs as independent books - they are the 1st and 2nd editions of one book, and the 2nd supersedes the 1st on every shared topic
- Agent discards the 1st edition entirely - it is the authoritative source for the Java 8 column, where CMS and permgen still exist
- Agent quotes a book flag without checking [flags.md](flags.md) - Appendix A is the most degraded part, and most removed flags stop the JVM starting
- Agent repeats "set `GCTimeRatio` to 19" - correct against the Java 8 default of 99, backwards against the 11+ default of 12
- Agent recommends CMS tuning from the book's CMS chapter - removed in 14, fatal from 17
- Agent recommends `jaotc` or `-XX:AOTLibrary` from the AOT section - Java 11 only
- Agent uses `-XX:MaxFreqInlineSize` or `-XX:ProfiledCodeHapSize` - both are errata; the JVM will not start
- Agent looks for direct byte buffers under NMT `Internal` - correct on 8 and 11, `Other` from 17
- Agent quotes the book's throughput figures as expected values - measured on 2014-2020 hardware on Java 8 and 11; they indicate magnitude and direction only
- Agent presents the book's single-expression concatenation speedup as general - not reproduced here; it applies where the Java 8 strategy bailed out
- Agent quotes a stream-versus-loop multiplier in either direction - **re-measured with JMH, the gap is 1.07-1.36× and two of six shapes showed no difference at all.** Oaks' "a filter slightly outperforms an iterator" and this skill's earlier "1.6× slower" were both within their own noise. Laziness is where streams actually win, and that is a complexity argument, not a multiplier
- Agent applies the book's thread-pool sizing to I/O-bound work on 21+ - virtual threads removed the constraint that advice worked around
- Agent cites a measurement from this skill as vendor- or platform-neutral - all Temurin, all Windows x64, one 8-CPU host

## Related

- [flags.md](flags.md) · [java-versions.md](java-versions.md) · [methodology.md](methodology.md) · [garbage-collection.md](garbage-collection.md) · [gc-tuning.md](gc-tuning.md) · [jit-compiler.md](jit-compiler.md) · [startup-and-warmup.md](startup-and-warmup.md) · [strings.md](strings.md) · [lambdas-and-streams.md](lambdas-and-streams.md) · [native-memory.md](native-memory.md) · [checklist.md](checklist.md)
