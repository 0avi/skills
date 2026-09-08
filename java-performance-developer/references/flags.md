# JVM Flags: Verified Reference

**Consult this before recommending any flag.** Every entry was verified by running `-XX:+PrintFlagsFinal` and by actually launching the JVM on Temurin **8u504, 11.0.32.1, 17.0.20.1, 21.0.12 and 25.0.4.1** (Windows x64).

This file exists because the single most common defect in Java performance advice is a flag that no longer exists. A removed flag does not degrade gracefully - **in most cases the JVM refuses to start.**

## How to read the removal tables

**The classification records what launching a JVM establishes, and nothing more.** Starting a JVM with a flag shows whether it starts and what it prints. It does **not** show whether the flag had any effect. Those are separate questions and this file keeps them separate, because conflating them is how flag advice goes wrong.

| Classification | What launching the JVM showed |
| -------------- | ----------------------------- |
| **start** | Starts, prints nothing about the flag |
| **warn-dep** | Starts, prints a **deprecation** warning. The flag still does its job unless the Effect column says otherwise |
| **warn-ign** | Starts, prints a warning that says the option is being **ignored**. The JVM itself tells you it has no effect |
| **warn** | Starts, prints some other warning (usually environmental, e.g. large pages unavailable) |
| **absent** | **"Unrecognized VM option". The JVM prints an error and does not start** |
| **bad-value** | Recognised, value format rejected. The JVM does not start |
| **needs-unlock** | Recognised only after `-XX:+UnlockDiagnosticVMOptions` or `-XX:+UnlockExperimentalVMOptions`; without it the JVM does not start |
| **needs-companion** | Recognised, but the JVM refuses to start until a companion flag or value is supplied |

**On effect.** A separate **Effect** column appears only where the effect was *behaviourally* tested - by observing what the JVM then did, not by reading the flag back. Where that column is blank, the effect was not established here and no claim is made. Three specific warnings:

- **`warn-dep` does not mean inert.** `-XX:MaxRAMFraction=8` prints a deprecation warning on 11, 17 and 21 and **still halves the heap** (measured: 8516 MB default to 4259 MB). Treating a deprecation warning as "harmless, it is ignored" is a live source of error.
- **Absence of a warning does not mean effect.** `-XX:CompileThreshold=8000` starts silently on all five versions and sets the flag, but the thresholds that actually gate compilation under tiered compilation (`Tier3InvocationThreshold` 200, `Tier4InvocationThreshold` 5000) are unchanged. Reading a flag back with `PrintFlagsFinal` proves it was *accepted*, never that it was *used*.
- **A warning-free flag can be actively harmful.** `-XX:+DisableExplicitGC` starts silently everywhere and breaks direct `ByteBuffer` reclamation - see [garbage-collection.md](garbage-collection.md).

## Platform caveat, stated before the tables

Everything here is **Temurin on Windows x64**. That is a real limitation for three families of flag, and it is stated here rather than in a footnote because it changes what the tables can be used for:

- **Container and cgroup flags do not exist on this platform at all.** `-XX:+UseContainerSupport`, `-XX:+PreferContainerQuotaForCPUCount` and `-XX:+UseTransparentHugePages` were **"Unrecognized VM option" on all five versions, including with both unlock flags set.** That is a Windows fact, not a version fact, and these tables cannot distinguish "removed in version N" from "Linux-only" for such flags. Where this file states a container boundary, it is cited from the JDK issue and marked as not measured.
- **Large pages** (`-XX:+UseLargePages`) is recognised and returns `warn` on all five, because the OS has not been configured for it. Behaviour was not exercised.
- **Flags marked *(pd)*** are platform-dependent by definition, and the default heap and thread figures below are functions of this host's 8 CPUs and 32 GB.

---

## The removal matrix

Re-measured by launching each JVM with each flag and recording exit status and warning text. The **Effect** column is populated only where behaviour was separately tested; blank means not established here.

| Flag | 8 | 11 | 17 | 21 | 25 | Effect |
| ---- | - | -- | -- | -- | -- | ------ |
| `-XX:+UseConcMarkSweepGC` | start | **warn-dep** | **absent** | absent | absent | |
| `-XX:CMSInitiatingOccupancyFraction=N` | start | start | **absent** | absent | absent | |
| `-XX:+CMSClassUnloadingEnabled` | start | start | **absent** | absent | absent | |
| `-XX:+CMSPermGenSweepingEnabled` | start | **absent** | absent | absent | absent | |
| `-XX:+UseParNewGC` | **warn-dep** | **absent** | absent | absent | absent | **effective on 8, and harmful** ⁴ |
| `-XX:+UseParallelOldGC` | start | start | **absent** | absent | absent | effective (already the default with Parallel) |
| `-XX:+AggressiveOpts` | start | **warn-dep** | **absent** | absent | absent | |
| `-XX:MaxPermSize=N` / `-XX:PermSize=N` | **warn-ign** | **warn-ign** | **absent** | absent | absent | none - the JVM says so ⁵ |
| `-XX:+UseBiasedLocking` | start | start | **warn-dep** | **absent** | absent | |
| `-XX:MaxRAMFraction=N` | start | **warn-dep** | warn-dep | warn-dep | **absent** | **effective on 8-21** ⁶ |
| `-XX:+PrintGCDetails` | start | **warn-dep** | warn-dep | warn-dep | warn-dep | mapped to `-Xlog:gc*` |
| `-Xloggc:file` | start | **warn-dep** | warn-dep | warn-dep | warn-dep | mapped to `-Xlog:gc:file=…` |
| `-XX:+PrintGCTimeStamps` | start | **absent** | absent | absent | absent | |
| `-XX:+PrintGCDateStamps` | start | **absent** | absent | absent | absent | |
| `-XX:+UseGCLogFileRotation` | start | **absent** | absent | absent | absent | |
| `-XX:NumberOfGCLogFiles=N` | start | **absent** | absent | absent | absent | |
| `-XX:GCLogFileSize=N` | start | **absent** | absent | absent | absent | |
| `-XX:+PrintTenuringDistribution` | start | **absent** | absent | absent | absent | |
| `-XX:+PrintReferenceGC` | start | **absent** | absent | absent | absent | |
| `-XX:+PrintAdaptiveSizePolicy` | start | **absent** | absent | absent | absent | |
| `-XX:+PrintTLAB` | start | **absent** | absent | absent | absent | |
| `-XX:+PrintStringDeduplicationStatistics` | start | **absent** | absent | absent | absent | |
| `-XX:+PrintSafepointStatistics` | start | **warn-dep** | **absent** | absent | absent | use `-Xlog:safepoint` |
| `-XX:+TraceClassLoading` | start | **warn-dep** | **absent** | absent | absent | use `-Xlog:class+load` |
| `-XX:+UnlockCommercialFeatures` | start | **absent** | absent | absent | absent | |
| `-XX:+UseFastAccessorMethods` | start | **absent** | absent | absent | absent | |
| `-XX:+UseStringCache` | **warn-ign** | **absent** | absent | absent | absent | none - the JVM says so |
| `-XX:-AutoShutdownNMT` | **warn-ign** | **absent** | absent | absent | absent | none on 8; flag gone from 11 |
| `-XX:+ScavengeBeforeFullGC` | start | start | start | start | **absent** | |
| `-XX:-UseCounterDecay` | start | start | start | start | **absent** | |
| `-XX:+UseSpinning` | **absent** | absent | absent | absent | absent | never existed in these builds |
| `-XX:MaxFreqInlineSize=N` | **absent** | absent | absent | absent | absent | erratum - the flag is `FreqInlineSize` |
| `-XX:AOTLibrary=path` | absent | needs-unlock¹ | **absent** | absent | absent | |
| `-XX:+UseAOT` | absent | needs-unlock¹ | **absent** | absent | absent | |
| `-XX:+ZGenerational` | absent | absent | absent | **start** | **warn-ign** | none on 25 - "removed in 24.0" |
| `-XX:+UseZGC` | absent | needs-unlock² | start | start | start | |
| `-XX:+UseShenandoahGC` | absent | start | start | start | start | vendor-dependent ⁷ |
| `-XX:+UseEpsilonGC` | absent | needs-unlock | needs-unlock | needs-unlock | needs-unlock | |
| `-XX:MaxRAMPercentage=75` | **bad-value** | start | start | start | start | |
| `-XX:MaxRAMPercentage=75.0` | start | start | start | start | start | effective |
| `-XX:-CompactStrings` | **absent** | start | start | start | start | |
| `-XX:+UseCompressedClassPointers` | start | start | start | start | **warn-dep** | deprecated by compact headers |
| `-XX:+UseCompactObjectHeaders` | absent | absent | absent | absent | **start** | effective - measured in [allocation.md](allocation.md) |
| `-XX:-ShowCodeDetailsInExceptionMessages` | **absent** | **absent** | start | start | start | |
| `-XX:+EnableDynamicAgentLoading` | **absent** | start | start | start | start | |
| `-XX:ArchiveClassesAtExit=f` | **absent** | **absent** | start | start | start | |
| `-XX:+AutoCreateSharedArchive` | absent | absent | absent | **start** | **warn** | needs `SharedArchiveFile` ⁸ |
| `-XX:AOTCache` / `AOTMode` / `AOTCacheOutput` / `AOTConfiguration` | absent | absent | absent | absent | **start** | ⁹ |
| `-XX:SoftMaxHeapSize=N` | absent | absent | start | start | start | |
| `-XX:+ZUncommit` | absent | absent | start | start | start | |
| `-XX:+G1UseAdaptiveIHOP` | **absent** | start | start | start | start | |
| `-d64` | start | **absent** | absent | absent | absent | |
| `-client` / `-server` | start | start | start | start | start | **no-op on 64-bit** ¹⁰ |
| `-XX:+FlightRecorder` | start | start | **warn-dep** | warn-dep | warn-dep | JFR is always available now |
| `-XX:CompileThreshold=N` | start | start | start | start | start | **none under tiered** ¹¹ |
| `-XX:+PrintInlining` | needs-unlock | needs-unlock | needs-unlock | needs-unlock | needs-unlock | diagnostic |
| `-XX:GuaranteedSafepointInterval=N` | needs-unlock | needs-unlock | needs-unlock | needs-unlock | needs-unlock | diagnostic |
| `-XX:+EnableJVMCI` | **absent** | needs-unlock | needs-unlock | needs-unlock | needs-unlock | not confirmed to compile ⁷ |
| `-XX:+UseContainerSupport` | absent | absent | absent | absent | absent | **Linux only - see platform caveat** |
| `-XX:+PreferContainerQuotaForCPUCount` | absent | absent | absent | absent | absent | **removed in 14; Linux only** ¹² |
| `-XX:+UseTransparentHugePages` | absent | absent | absent | absent | absent | **Linux only** |
| `-XX:+UseLargePages` | warn | warn | warn | warn | warn | OS not configured on this host |
| `-XX:FreqInlineSize=N` | start | start | start | start | start | |
| `-XX:+UseStringDeduplication` | start | start | start | start | start | |
| `-XX:+DisableExplicitGC` | start | start | start | start | start | **effective, and breaks direct buffers** ¹³ |
| `-XX:+ExplicitGCInvokesConcurrent` | start | start | start | start | start | |

¹ On 11, `-XX:+UseAOT` needs `-XX:+UnlockExperimentalVMOptions`; with it the JVM reports `mixed mode, aot` and `jaotc` is present. Absent from 17 onward.
² On 11, ZGC needs `-XX:+UnlockExperimentalVMOptions`. From 17 it is a plain product flag.
⁴ **This is not "ignored", and the correction matters.** On 8u504, `-XX:+UseParNewGC` prints a *deprecation* warning and then **changes the collector pair**: `UseParallelGC` and `UseParallelOldGC` both flip from `true` to `false`, and the GC log moves from `PSYoungGen`/`ParOldGen` to `ParNew`/`Tenured` - the **single-threaded** old-generation collector. The JVM says as much: *"Using the ParNew young collector with the Serial old collector is deprecated"*. Leaving this flag on a Java 8 command line therefore costs you parallel full GCs, which on a large heap is seconds of pause. Remove it; do not assume it is inert.
⁵ The warning is explicit: *"ignoring option MaxPermSize=128m; support was removed in 8.0"*. This is the one family where "accepted but no effect" is established, because the JVM states it.
⁶ Measured: default `MaxHeapSize` 8516 MB, with `-XX:MaxRAMFraction=8` it becomes 4259 MB, on 11, 17 and 21 alike. The deprecation warning does **not** mean the flag stopped working - it means it will be removed, and on 25 it is.
⁷ Build-level, not version-level. Shenandoah is `product` in Adoptium builds and absent from Oracle's. For JVMCI, only startup and module presence were confirmed, not that Graal compiled anything.
⁸ Bare `-XX:+AutoCreateSharedArchive` refuses to start: *"requires -XX:SharedArchiveFile"*. With one supplied it starts on 21 and starts with a warning on 25.
⁹ `-XX:AOTMode=record` alone refuses to start: *"At least one of AOTCacheOutput and AOTConfiguration must be specified"*. See [startup-and-warmup.md](startup-and-warmup.md) for the working sequences.
¹⁰ Both accepted on all five, and both yield **"OpenJDK 64-Bit Server VM"** on 8u504 - there is no client VM on 64-bit. Accepted, no warning, no effect.
¹¹ Accepted silently on all five and the flag reads back as set, but `Tier3InvocationThreshold` (200) and `Tier4InvocationThreshold` (5000) are unchanged, and those are what gate compilation while `TieredCompilation` is `true` - which it is by default everywhere.
¹² Existed only in 10-13 as the switch for the quota-only transition, and was removed in JDK 14 (JDK-8226575); shares are now ignored unconditionally. Absent here on every version, but that is also what Windows reports for every container flag, so the *removal* is cited, not measured.
¹³ Starts silently on all five, and on all five it turns `OutOfMemoryError: Direct buffer memory` from something that cannot happen into something that happens after exactly one cap's worth of allocation. See [garbage-collection.md](garbage-collection.md).

### The upgrade boundaries this reveals

| Upgrade | What breaks first |
| ------- | ----------------- |
| **8 → 11** | Every `Print*` GC flag except `PrintGCDetails`; the GC log rotation trio (`UseGCLogFileRotation`, `NumberOfGCLogFiles`, `GCLogFileSize`); `UseParNewGC`; `CMSPermGenSweepingEnabled`; `UnlockCommercialFeatures`; `UseStringCache`; `AutoShutdownNMT`; `UseFastAccessorMethods`; `-d64` |
| **11 → 17** | **All CMS flags** (including `CMSClassUnloadingEnabled`); `UseParallelOldGC`; `AggressiveOpts`; `PermSize`/`MaxPermSize`; `PrintSafepointStatistics`; `TraceClassLoading` |
| **17 → 21** | `UseBiasedLocking` |
| **21 → 25** | `MaxRAMFraction`; `ScavengeBeforeFullGC`; `UseCounterDecay`; `ZGenerational` becomes ignored; `UseCompressedClassPointers` becomes deprecated |

**11 → 17 is the most dangerous step** for anything CMS-tuned, and 8 → 11 for anything with Java 8 GC logging. Note the asymmetry that makes these survive: `MaxPermSize` and `MaxRAMFraction` are silently tolerated for two to three LTS releases before turning fatal, so they sit in scripts for years.

---

## Verified defaults

Measured on an 8-CPU, 32 GB Windows x64 host with no other flags. Values marked *(pd)* are platform-dependent.

### Heap and memory

| Flag | 8 | 11 | 17 | 21 | 25 |
| ---- | - | -- | -- | -- | -- |
| `InitialHeapSize` *(pd)* | 508 M | 508 M | 508 M | 508 M | 508 M |
| `MaxHeapSize` *(pd)* | 8122 M | 8122 M | 8124 M | 8124 M | 8124 M |
| `MaxRAMPercentage` | 25.0 | 25.0 | 25.0 | 25.0 | 25.0 |
| `InitialRAMPercentage` | 1.5625 | 1.5625 | 1.5625 | 1.5625 | 1.5625 |
| `MinRAMPercentage` | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| `NewRatio` | 2 | 2 | 2 | 2 | 2 |
| `SurvivorRatio` | 8 | 8 | 8 | 8 | 8 |
| `TargetSurvivorRatio` | 50 | 50 | 50 | 50 | 50 |
| `InitialTenuringThreshold` | 7 | 7 | 7 | 7 | 7 |
| `MaxTenuringThreshold` | 15 | 15 | 15 | 15 | 15 |
| `MetaspaceSize` | ~20 M | ~20 M | ~21 M | ~21 M | ~21 M |
| `MaxMetaspaceSize` | unlimited | unlimited | unlimited | unlimited | unlimited |
| `MaxDirectMemorySize` | 0 (= `-Xmx`) | 0 | 0 | 0 | 0 |
| `UseCompressedOops` | true | true | true | true | true |
| `UseCompactObjectHeaders` | **absent** | absent | absent | absent | **false** |
| `AlwaysPreTouch` | false | false | false | false | false |
| `UseLargePages` | false | false | false | false | false |
| `SoftRefLRUPolicyMSPerMB` | 1000 | 1000 | 1000 | 1000 | 1000 |
| `GCTimeLimit` | 98 | 98 | 98 | 98 | 98 |
| `GCHeapFreeLimit` | 2 | 2 | 2 | 2 | 2 |
| `UseGCOverheadLimit` | true | true | true | true | true |
| `MaxRAM` *(pd)* | 128 G | 128 G | 128 G | 128 G | 128 G |
| `NewSize` *(pd)* | **169 M** | 1.3 M | 1.3 M | 1.3 M | 1.3 M |
| `MaxNewSize` *(pd)* | **2707 M** | 4872 M | 4872 M | 4872 M | 4872 M |
| `InitialSurvivorRatio` | 8 | 8 | 8 | 8 | 8 |
| `MinSurvivorRatio` | 3 | 3 | 3 | 3 | 3 |
| `AlwaysTenure` / `NeverTenure` | false | false | false | false | false |
| `TLABSize` | 0 (adaptive) | 0 | 0 | 0 | 0 |
| `MinTLABSize` | 2048 | 2048 | 2048 | 2048 | 2048 |
| `HeapDumpBeforeFullGC` / `HeapDumpAfterFullGC` | false | false | false | false | false |

`NewSize` and `MaxNewSize` differ sharply between 8 and 11+ because the **default collector** differs: Parallel GC on 8 sizes a fixed young generation eagerly, G1 on 11+ sizes regions adaptively and starts far smaller. This is the clearest illustration of why a default quoted without its collector is meaningless.

### Garbage collection

| Flag | 8 | 11 | 17 | 21 | 25 |
| ---- | - | -- | -- | -- | -- |
| `UseParallelGC` | **true** | false | false | false | false |
| `UseG1GC` | false | **true** | true | true | true |
| `UseSerialGC` | false | false | false | false | false |
| `UseZGC` | absent | false *(exp)* | false | false | false |
| `ZGenerational` | absent | absent | absent | **false** | absent |
| `UseShenandoahGC` | absent | false | false | false | false |
| `UseEpsilonGC` | absent | false *(exp)* | false *(exp)* | false *(exp)* | false *(exp)* |
| `MaxGCPauseMillis` | **unset**¹ | **200** | 200 | 200 | 200 |
| `GCTimeRatio` | **99** | **12** | 12 | 12 | 12 |
| `ParallelGCThreads` *(pd)* | 8 | 8 | 8 | 8 | 8 |
| `ConcGCThreads` *(pd)* | 0 | 2 | 2 | 2 | 2 |
| `InitiatingHeapOccupancyPercent` | 45 | 45 | 45 | 45 | 45 |
| `G1HeapRegionSize` *(pd)* | 0² | 2 M | 4 M | 4 M | 4 M |
| `G1MixedGCCountTarget` | 8 | 8 | 8 | 8 | 8 |
| `UseAdaptiveSizePolicy` | true | true | true | true | true |
| `UseStringDeduplication` | false | false | false | false | false |
| `StringDeduplicationAgeThreshold` | 3 | 3 | 3 | 3 | 3 |
| `UseTLAB` / `ResizeTLAB` | true | true | true | true | true |

¹ Reads `18446744073709551615` (`ULONG_MAX`), i.e. no pause goal - Parallel GC ships none.
² Computed later on 8; eagerly on 11+. Note the ergonomics changed between 11 and 17.

### Compiler

| Flag | 8 | 11 | 17 | 21 | 25 |
| ---- | - | -- | -- | -- | -- |
| `TieredCompilation` | true | true | true | true | true |
| `TieredStopAtLevel` | 4 | 4 | 4 | 4 | 4 |
| `ReservedCodeCacheSize` | 240 M | 240 M | 240 M | 240 M | 240 M |
| `InitialCodeCacheSize` | 2.44 M | 2.44 M | 2.44 M | 2.44 M | 2.44 M |
| `SegmentedCodeCache` | **absent** | true | true | true | true |
| `NonProfiledCodeHeapSize` | absent | ~117 M | ~117 M | ~117 M | ~117 M |
| `ProfiledCodeHeapSize` | absent | ~117 M | ~117 M | ~117 M | ~117 M |
| `NonNMethodCodeHeapSize` | absent | ~5.6 M | ~5.6 M | ~5.6 M | ~5.6 M |
| `CICompilerCount` *(pd)* | 4 | 4 | 4 | 4 | 4 |
| `CompileThreshold` (inert) | 10000 | 10000 | 10000 | 10000 | 10000 |
| `Tier3InvocationThreshold` | 200 | 200 | 200 | 200 | 200 |
| `Tier4InvocationThreshold` | 5000 | 5000 | 5000 | 5000 | 5000 |
| `MaxInlineSize` | 35 | 35 | 35 | 35 | 35 |
| `FreqInlineSize` | 325 | 325 | 325 | 325 | 325 |
| `DoEscapeAnalysis` | true | true | true | true | true |
| `EliminateAllocations` | true | true | true | true | true |
| `BackgroundCompilation` | true | true | true | true | true |
| `UseAVX` *(pd)* | 2 | 2 | 2 | 2 | 2 |
| `UseSSE` *(pd)* | 4 | 4 | 4 | 4 | 4 |
| `EnableJVMCI` / `UseJVMCICompiler` | **absent** | false | false | false | false |

### Startup, strings, other

| Flag | 8 | 11 | 17 | 21 | 25 |
| ---- | - | -- | -- | -- | -- |
| `CompactStrings` | **absent** | true | true | true | true |
| `StringTableSize` | **60013** | 65536 | 65536 | 65536 | 65536 |
| `AutoBoxCacheMax` | 128 | 128 | 128 | 128 | 128 |
| `StackTraceInThrowable` | true | true | true | true | true |
| `EnableContended` | true | true | true | true | true |
| `RestrictContended` | true | true | true | true | true |
| `PrintCompilation` | false | false | false | false | false |
| `DumpLoadedClassList` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `SharedClassListFile` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `SharedArchiveFile` | ✓ *(diag)* | ✓ | ✓ | ✓ | ✓ |
| `ArchiveClassesAtExit` | absent | absent | **✓** | ✓ | ✓ |
| `AutoCreateSharedArchive` | absent | absent | absent | **false** | false |
| `UseSharedSpaces` | false | false | true | absent | absent |
| `AOTCache` / `AOTMode` / `AOTCacheOutput` | absent | absent | absent | absent | **✓** |
| `AOTClassLinking` | absent | absent | absent | absent | false |
| `AutoShutdownNMT` | ✓ | ✓ | absent | absent | absent |
| `ActiveProcessorCount` | −1 | −1 | −1 | −1 | −1 |
| `UseContainerSupport` | Linux only | Linux only | Linux only | Linux only | Linux only |

---

## Three errata in Oaks' *Java Performance*

Found by running the flags the book documents, and located in the source text to establish which edition carries each.

**1. `-XX:MaxFreqInlineSize` does not exist.** Named for the frequent-inlining threshold with a default of 325. **Verified absent from all five versions**; the real flag is **`FreqInlineSize`**, default 325 on every version. Using the book's name means the JVM will not start. **This one is in both editions** - 1st ed at the inlining discussion, 2nd ed in both the body and the index - so it is not a 2nd-edition slip and it has been repeated for a decade.

**2. `-XX:ProfiledCodeHapSize` and `-XX:NonProfiledCodeHapSize` are misspelled** - "Hap" for "Heap". Verified absent from all five; the real flags are `ProfiledCodeHeapSize` and `NonProfiledCodeHeapSize`. **2nd edition only**, since the segmented code cache is not covered in the 1st. The book spells the third one, `NonNMethodCodeHeapSize`, correctly, which is what makes the typo easy to miss.

**3. Appendix A lists `-XX:HeapFreeLimit`**, which does not exist on any version; the body text correctly uses `GCHeapFreeLimit`, verified at 2 on all five. **2nd edition appendix and index.**

---

## Flags actually worth setting

Almost everything above is context for *not* setting things. This is the short list.

### Standing configuration for a server (17+)

```bash
-XX:MaxRAMPercentage=75.0                                    # containers; note the decimal
-Xlog:gc*:file=/var/log/gc.log:time,uptime,level,tags:filecount=8,filesize=16M
-XX:StartFlightRecording=maxsize=256m,maxage=6h,settings=default
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/log
-XX:+ExitOnOutOfMemoryError                                  # containers
-XX:NativeMemoryTracking=summary                             # ~5-10% footprint, worth it
```

None of these tunes anything. They make the *next* incident diagnosable, which is the highest-value thing you can do before you have a measurement.

### With a measurement behind it

| Flag | Requires |
| ---- | -------- |
| `-Xmx` / `-Xms` | Occupancy after a full GC |
| `-XX:MaxGCPauseMillis=N` | GC log showing pauses near but above target |
| `-XX:ReservedCodeCacheSize=N` | "CodeCache is full" warning, or `Compiler.codecache` |
| `-XX:+UseParallelGC` | CPU-bound batch work, pauses irrelevant |
| `-XX:+UseZGC` | A pause-time SLO, plus spare CPU and heap |
| `-XX:ParallelGCThreads=N` | Several JVMs per host, or a very large machine |
| `-XX:MaxDirectMemorySize=N` | A footprint ceiling that matters |
| `-XX:StringTableSize=N` | `PrintStringTableStatistics` showing large buckets |
| `-XX:+UseCompactObjectHeaders` | 25 only; measured benefit on your objects |
| `-XX:TieredStopAtLevel=1` | A genuinely short-lived process |
| `-XX:+AlwaysPreTouch` | Preferring a deploy-time failure to a later one |
| `-XX:ActiveProcessorCount=N` | Only a CPU *request* is set, or detection is wrong |

### Flags to actively avoid

| Flag | Why |
| ---- | --- |
| `-XX:+AggressiveOpts` | Removed in 12; **fatal from 17** |
| `-XX:+UseBiasedLocking` | **Fatal from 21** |
| `-XX:MaxRAMFraction` | **Fatal on 25**; use `MaxRAMPercentage` |
| `-XX:CompileThreshold` | Inert under tiered compilation |
| `-XX:-TieredCompilation` | Only to save code cache in a memory-starved JVM |
| `-XX:-DoEscapeAnalysis` | Disables a large correct optimisation |
| `-XX:-StackTraceInThrowable` | Removes diagnosability everywhere |
| `-XX:+AggressiveHeap` | Hides what it sets; values are stale |
| `-XX:-UseAdaptiveSizePolicy` | What makes the defaults work |
| Anything not in this file **or in the coverage table below** | If you cannot find it in this file, do not recommend it |

`-XX:+AggressiveHeap` deserves its own note: it silently sets `Xmx`, `Xms`, `NewSize`, `UseLargePages`, `ResizeTLAB`, `TLABSize`, `UseParallelGC`, `YoungPLABSize`, `OldPLABSize`, `ThresholdTolerance`, `ScavengeBeforeFullGC` and `BindGCTaskThreadsToCPUs` at once. Several are now set better ergonomically, one (`ScavengeBeforeFullGC=false`) is actively harmful in the general case, and because it hides everything you cannot tell what you have configured. Set the specific flags you need.

---

## Coverage: every flag this skill names

Operating rule 1 says not to recommend a flag that is not in this file, so this table exists to make that rule checkable rather than aspirational. It lists every `-XX` flag named anywhere in this skill, and where in this file its status is recorded. **It was generated by extracting flag names from every file and diffing against this one**, so a flag recommended elsewhere and missing here is a defect in the skill, not a judgement call.

| Family | Flags | Recorded in |
| ------ | ----- | ----------- |
| Removed or version-gated | `UseConcMarkSweepGC`, `CMSInitiatingOccupancyFraction`, `CMSClassUnloadingEnabled`, `CMSPermGenSweepingEnabled`, `UseParNewGC`, `UseParallelOldGC`, `AggressiveOpts`, `MaxPermSize`, `PermSize`, `UseBiasedLocking`, `MaxRAMFraction`, all Java 8 `Print*` GC flags, `UseGCLogFileRotation`, `NumberOfGCLogFiles`, `GCLogFileSize`, `UnlockCommercialFeatures`, `UseSpinning`, `MaxFreqInlineSize`, `AOTLibrary`, `UseAOT`, `ZGenerational`, `UseStringCache`, `AutoShutdownNMT`, `UseFastAccessorMethods`, `PrintSafepointStatistics`, `TraceClassLoading`, `ScavengeBeforeFullGC`, `UseCounterDecay`, `-d64`, `-client`/`-server` | the removal matrix |
| Version-gated additions | `CompactStrings`, `UseCompactObjectHeaders`, `UseCompressedClassPointers`, `ShowCodeDetailsInExceptionMessages`, `EnableDynamicAgentLoading`, `ArchiveClassesAtExit`, `AutoCreateSharedArchive`, `AOTCache`, `AOTMode`, `AOTCacheOutput`, `AOTConfiguration`, `SoftMaxHeapSize`, `ZUncommit`, `G1UseAdaptiveIHOP`, `UseZGC`, `UseShenandoahGC`, `UseEpsilonGC` | the removal matrix |
| Explicit collection | `DisableExplicitGC`, `ExplicitGCInvokesConcurrent` | the removal matrix, and [garbage-collection.md](garbage-collection.md) |
| Linux-only | `UseContainerSupport`, `PreferContainerQuotaForCPUCount`, `UseTransparentHugePages` | the platform caveat and the removal matrix |
| Heap and GC defaults | `MaxRAMPercentage`, `InitialRAMPercentage`, `MinRAMPercentage`, `MaxRAM`, `NewRatio`, `NewSize`, `MaxNewSize`, `SurvivorRatio`, `InitialSurvivorRatio`, `MinSurvivorRatio`, `TargetSurvivorRatio`, `InitialTenuringThreshold`, `MaxTenuringThreshold`, `AlwaysTenure`, `NeverTenure`, `MetaspaceSize`, `MaxMetaspaceSize`, `MaxDirectMemorySize`, `SoftRefLRUPolicyMSPerMB`, `GCTimeLimit`, `GCHeapFreeLimit`, `UseGCOverheadLimit`, `MaxGCPauseMillis`, `GCTimeRatio`, `ParallelGCThreads`, `ConcGCThreads`, `InitiatingHeapOccupancyPercent`, `G1HeapRegionSize`, `G1MixedGCCountTarget`, `UseAdaptiveSizePolicy`, `UseDynamicNumberOfGCThreads`, `UseStringDeduplication`, `StringDeduplicationAgeThreshold`, `UseTLAB`, `ResizeTLAB`, `TLABSize`, `MinTLABSize`, `AlwaysPreTouch`, `UseLargePages`, `UseCompressedOops`, `UseNUMA` | Verified defaults |
| Compiler | `TieredCompilation`, `TieredStopAtLevel`, `ReservedCodeCacheSize`, `InitialCodeCacheSize`, `SegmentedCodeCache`, `NonProfiledCodeHeapSize`, `ProfiledCodeHeapSize`, `NonNMethodCodeHeapSize`, `CICompilerCount`, `CompileThreshold`, `Tier3InvocationThreshold`, `Tier4InvocationThreshold`, `MaxInlineSize`, `FreqInlineSize`, `DoEscapeAnalysis`, `EliminateAllocations`, `EliminateLocks`, `OptimizeStringConcat`, `BackgroundCompilation`, `UseCodeCacheFlushing`, `UseAVX`, `UseSSE`, `EnableJVMCI`, `UseJVMCICompiler`, `PrintCompilation`, `PrintInlining` | Verified defaults, Compiler |
| Diagnostics and lifecycle | `HeapDumpOnOutOfMemoryError`, `HeapDumpPath`, `HeapDumpBeforeFullGC`, `HeapDumpAfterFullGC`, `ExitOnOutOfMemoryError`, `NativeMemoryTracking`, `StartFlightRecording`, `FlightRecorder`, `StackTraceInThrowable`, `ActiveProcessorCount`, `PerfDisableSharedMem`, `DisableAttachMechanism`, `UnlockDiagnosticVMOptions`, `UnlockExperimentalVMOptions`, `GuaranteedSafepointInterval`, `UseCountedLoopSafepoints`, `ClassUnloading` | Verified defaults, and the removal matrix where version-gated |
| Strings, boxing, layout | `StringTableSize`, `PrintStringTableStatistics`, `AutoBoxCacheMax`, `ObjectAlignmentInBytes`, `EnableContended`, `RestrictContended` | Verified defaults |
| CDS and AOT paths | `SharedArchiveFile`, `SharedClassListFile`, `DumpLoadedClassList`, `UseSharedSpaces`, `AOTClassLinking` | Verified defaults, and [startup-and-warmup.md](startup-and-warmup.md) |
| Named only to warn against | `AggressiveHeap`, `RunReallyFast` (which does not exist, and is the point of rule 1) | Flags to actively avoid |

---

## Finding a flag's default yourself

```bash
# include your other options - flags affect each other, GC flags especially
java <your other options> -XX:+PrintFlagsFinal -version | grep MaxHeapSize

# every flag including diagnostic and experimental
java -XX:+UnlockDiagnosticVMOptions -XX:+UnlockExperimentalVMOptions \
     -XX:+PrintFlagsFinal -version

# on a running JVM
jcmd <pid> VM.flags -all
jinfo -flag MaxHeapSize <pid>
```

In the output, **`:=` marks a non-default value** (set on the command line, set indirectly by another flag, or computed ergonomically) and **`=` marks the built-in default**. The trailing brace gives the category: `product`, `pd product` (platform-dependent), `manageable` (changeable at runtime via `jinfo`), `experimental` (needs `-XX:+UnlockExperimentalVMOptions`), `diagnostic` (needs `-XX:+UnlockDiagnosticVMOptions`), `C2 product`.

There are **876 flags on 8u504, 946 on 11.0.32.1, 874 on 17.0.20.1, 881 on 21.0.12 and 915 on 25.0.4.1**, counting assignment lines in
`java -XX:+UnlockDiagnosticVMOptions -XX:+UnlockExperimentalVMOptions -XX:+PrintFlagsFinal -version`. Counting only lines carrying a category brace instead gives 873/942/869/877/909, so treat these as **±5, not exact** - the method is stated so you can reproduce or dispute it. The overwhelming majority exist so support engineers can extract information from a misbehaving JVM. Finding a flag in that list is not a reason to set it.

---

## Version notes

The whole file is a version matrix, so this section records only how the flag *surface* itself changes, which is what determines whether an upgrade breaks on startup.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| Total flags (diagnostic + experimental unlocked) | 876 | **946** | 874 | 881 | 915 |
| Legacy flag handling | tolerant | mixed | **strict** | strict | strict |
| GC logging flag family | legacy `Print*` | unified `-Xlog` | `-Xlog` | `-Xlog` | `-Xlog` |
| Flags fatal that were fine on the previous LTS | - | 8 of those tested | 5 | 1 | 2 |

Two structural observations from that table:

- **Java 11 has the largest flag count** because it carries both the new unified-logging machinery and much of the old GC surface that 17 removed. It is the most permissive release for a legacy command line, and therefore the one that lets stale flags survive into a 17 upgrade unnoticed.
- **Java 17 is the strict boundary.** Five of the flags tested here go from accepted to fatal at 17, including the entire CMS family. Where an upgrade is going to fail on a command line, it fails there.

The safe procedure for any upgrade is: run the target JVM with the existing command line and `-version` first. A fatal flag surfaces immediately and costs nothing to find. That single step catches every red row in the removal matrix.

## What was not verified here

Stated plainly, because the rest of this file claims verification.

- **Container detection.** `UseContainerSupport` and cgroup behaviour are Linux mechanisms and absent from these Windows builds. The **CPU cascade** was verified using `-XX:ActiveProcessorCount`, which reproduces what a quota does to the JVM's view, but cgroup *detection* itself was not.
- **Linux-only page flags.** `UseTransparentHugePages` does not exist in these builds. `UseLargePages` exists and reads `false`, but large-page behaviour was not exercised.
- **Whether the Graal JIT compiles anything.** `-XX:+UseJVMCICompiler` starts successfully on 11, 17 and 25, and the module is present (renamed `jdk.internal.vm.compiler` → **`jdk.graal.compiler`** on 25). Whether it was actually used for compilation was not confirmed.
- **Other vendors.** Everything is Temurin. Shenandoah in particular is a **build-level** difference - `product` in Adoptium, absent from Oracle's builds. Check the vendor.
- **Other platforms.** All Windows x64. Flags marked *(pd)* differ by platform, and the default heap sizes above are functions of this host's 32 GB and 8 CPUs.
- **Update-version boundaries.** Verified on the specific builds named. Statements like "8u192+ for container awareness" and "8u262+ for JFR" come from the release history, not from testing each update.

## Gotchas

- Agent recommends a flag from memory or from older material without checking it here - most removed flags **stop the JVM from starting**
- Agent assumes a removed flag is ignored - the only flags where the JVM itself says it is ignoring the option are `MaxPermSize`/`PermSize`, `UseStringCache` and `AutoShutdownNMT` (on 8), and `ZGenerational` (on 25). Everything else either works or stops the JVM starting
- Agent assumes `-XX:+UseParNewGC` on Java 8 is inert - it is **not**: it disables `UseParallelOldGC` and substitutes the single-threaded old collector. Remove it rather than leaving it
- Agent reads a deprecation warning as "ignored" - `MaxRAMFraction` warns from 11 and still halves the heap through 21
- Agent proves a flag "works" by reading it back from `PrintFlagsFinal` - that proves acceptance, not effect; `CompileThreshold` reads back set and changes nothing under tiered compilation
- Agent copies a Java 8 GC logging block forward - every `Print*` flag except `PrintGCDetails` is fatal from 11
- Agent copies a CMS-tuned command line to 17+ - every `CMS*` flag is fatal there
- Agent writes `-XX:MaxRAMPercentage=75` - **fatal on Java 8**; the flag is a `double`, so write `75.0`
- Agent uses `-XX:MaxRAMFraction` - accepted on 8-21 and **fatal on 25**
- Agent recommends `-XX:MaxFreqInlineSize` - does not exist on any version; the flag is `FreqInlineSize`. Erratum in Oaks' book
- Agent recommends `-XX:ProfiledCodeHapSize` - misspelled in the book; the real flag contains `Heap`
- Agent recommends `-XX:CompileThreshold` - inert under tiered compilation
- Agent enables ZGC on 11 without `-XX:+UnlockExperimentalVMOptions` - verified fatal without it
- Agent sets `-XX:+ZGenerational` on 25 - accepted but ignored; only meaningful on 21
- Agent recommends Shenandoah without checking the vendor - absent from Oracle builds
- Agent quotes a default without stating the host - heap and thread defaults derive from CPU count and RAM
- Agent finds a flag in `PrintFlagsFinal` and recommends it - ~900 flags exist and almost all are for JVM support engineers
- Agent recommends `-XX:+AggressiveHeap` - hides a dozen settings, some now harmful
- Agent omits other options when checking a default with `PrintFlagsFinal` - flags affect each other

## Related

- [java-versions.md](java-versions.md) · [book-deltas.md](book-deltas.md) · [gc-tuning.md](gc-tuning.md) · [garbage-collection.md](garbage-collection.md) · [jit-compiler.md](jit-compiler.md) · [containers.md](containers.md) · [native-memory.md](native-memory.md) · [startup-and-warmup.md](startup-and-warmup.md) · [checklist.md](checklist.md)
