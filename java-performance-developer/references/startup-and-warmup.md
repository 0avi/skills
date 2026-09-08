# Startup and Warm-up

Two distinct problems that get conflated, with different fixes.

- **Startup** - time from process launch to ready. Dominated by class loading.
- **Warm-up** - ready but slow for a while. Dominated by JIT compilation, plus cold caches and pool ramp-up.

| Technique | Helps | Available | Effort |
| --------- | ----- | --------- | ------ |
| **Default CDS** | Startup, ~20-25% | **Shipped from 17**; manual on 8/11 | None on 17+ - already on |
| **AppCDS / dynamic archive** | Startup, application classes too | 10+ (static), **13+** (dynamic) | Low |
| **AOT cache** (Leyden) | Startup, more than CDS alone | **24+** | Low |
| **`-XX:TieredStopAtLevel=1`** | Warm-up for *short-lived* processes | 8+ | None - one flag |
| **Application warm-up requests** | Warm-up, reliably | Any | Low |
| **GraalVM Native Image** | Startup, dramatically | Separate toolchain | High - real constraints |
| **Fewer classes / smaller classpath** | Startup, always | Any | Varies |

**On 17+ the largest single win is already switched on.** Check you have not disabled it before doing anything else.

---

## Class loading is the startup cost

Class data must be found on the classpath, read, parsed, verified and linked. A large application loads tens of thousands of classes, and a long classpath means searching many JARs for each one.

```bash
jcmd <pid> VM.classloader_stats           # 8+  : loaders, class counts, bytes
jcmd <pid> VM.classloaders                # 11+ : the loader tree
java -Xlog:class+load:file=cl.txt ...     # 9+  : every class and its source
java -verbose:class ...                   # 8   : the equivalent
```

Reduce it by loading fewer classes and by packaging into fewer JARs. Both are architectural, and both are usually more effective than any flag - but neither is quick.

---

## Class Data Sharing

CDS maps a pre-parsed, pre-linked class archive into memory. Originally for sharing metadata between JVMs to save memory; the bigger win in practice is **startup**, even for a single JVM.

**Verified: the default archive ships from Java 17.**

| | 8u504 | 11.0.32.1 | 17.0.20.1 | 21.0.12 | 25.0.4.1 |
| --- | ----- | --------- | --------- | ------- | -------- |
| `classes.jsa` bundled | **none** | **none** | 12 MB | 13 MB | 16 MB |

So on 17, 21 and 25 you get JDK-class CDS for free.

**Measured on 25.0.4.1** with a **paired, interleaved** harness: the three configurations run inside every round in a rotated order, and each round's ratio is computed within that round, so machine drift affecting a whole round cancels out of it. 40 rounds, then an independent replication of 30. Absolute medians:

| Configuration | Median | p25 - p75 | Min |
| ------------- | ------ | --------- | --- |
| Default (CDS on) | 186.5 ms | 182.7 - 199.4 | 170.5 |
| `-Xshare:off` | **280.2 ms** | 273.1 - 293.5 | 250.4 |
| `-XX:AOTCache=app.aot` | **154.1 ms** | 150.1 - 164.1 | 139.5 |

The figures that matter are the paired ratios, not the absolutes:

| Comparison | Pass 1 (40 rounds) | Pass 2 (30 rounds) | Rounds agreeing on direction |
| ---------- | ------------------ | ------------------ | ---------------------------- |
| Cost of `-Xshare:off` | **31.9%** (IQR 28.9-34.0) | **31.8%** (IQR 27.8-38.3) | 40/40 and 28/30 |
| Saving from the AOT cache | **17.9%** (IQR 15.7-20.9) | **17.5%** (IQR 11.1-22.6) | 40/40 and 25/30 |

**Turning CDS off costs about a third of startup**, and **the AOT cache saves about 18% on top of CDS.** Both reproduced across independent passes to within half a percentage point.

Two corrections to earlier versions of this file, and the second is a methodology lesson worth more than the numbers:

1. **The figures were wrong, in both directions.** An earlier draft gave "about 25%" then "19-25%" for `-Xshare:off`, against a measured **32%**; and "10-15%" then "7-19%" for the AOT cache, against a measured **18%**. It also measured a directory classpath, where `-XX:AOTMode=create` **silently skips the application's own classes** - the log says `Skipping Startup: Unsupported location`. Packaging into a JAR includes them and grew the cache from 13.8 MB to 14.5 MB. **If you build an AOT cache and the app classes are on a directory classpath, you are caching JDK classes only.** Check the creation log for `Skipping`.
2. **The old band was wide because the method was wrong, not because the JVM is unpredictable.** Running each configuration as its own sequential pass put all the drift between passes onto the comparison, which is how two passes produced 7.1% and 19.0% for the same quantity. Interleaving and pairing collapsed that to 17.9% and 17.5%. The noise did not go away - pass 2 contained a 1,553 ms outlier against a 205 ms median - it stopped landing on the answer. See [methodology.md](methodology.md).

Absolute numbers are from one Windows laptop and should not be read as a capacity figure - the *ratios* reproduced across both passes, the absolutes drifted, and one outlier run took 29 seconds. That is exactly why the table reports medians. See [methodology.md](methodology.md).

### On 8 and 11 you must create the archive

```bash
java -Xshare:dump          # writes the JDK-class archive into the JDK directory
```

Verified working on 8u504. On Java 8 CDS is additionally restricted to the classes in `rt.jar` and, for the original implementation, to the Serial collector with the client JVM - so its practical value on 8 is small. On 11 it works generally but is not pre-built.

### AppCDS: include your own classes

The default archive covers JDK classes. Your application's classes are the larger share of a big startup, and AppCDS covers those.

**Dynamic archive - one step, and the one to use.** Verified `ArchiveClassesAtExit` absent on 8 and 11, present on 17, 21 and 25:

```bash
# run once; the archive is written on a clean exit
java -XX:ArchiveClassesAtExit=app.jsa -cp app.jar com.example.Main
# then use it
java -XX:SharedArchiveFile=app.jsa -cp app.jar com.example.Main
```

**Static archive - the older two-step, available on 10+:**

```bash
java -XX:DumpLoadedClassList=app.lst -cp app.jar com.example.Main
java -Xshare:dump -XX:SharedClassListFile=app.lst -XX:SharedArchiveFile=app.jsa -cp app.jar
java -XX:SharedArchiveFile=app.jsa -cp app.jar com.example.Main
```

**Auto-create - the least ceremony, 21+.** Verified `AutoCreateSharedArchive` present on 21 and 25, absent earlier:

```bash
java -XX:+AutoCreateSharedArchive -XX:SharedArchiveFile=app.jsa -cp app.jar com.example.Main
```

It creates the archive if missing and regenerates it if stale - which removes the operational trap below.

### The constraints that make CDS fail silently

**The classpath used to create the archive must be a prefix of the classpath used to run**, and the JARs must not have changed. Break either and the archive is rejected.

`-Xshare` has three values, and the default is what makes this dangerous:

| Value | Behaviour |
| ----- | --------- |
| `off` | Do not use CDS |
| `on` | Use CDS, **fail to start** if it cannot be mapped |
| `auto` | **Default.** Use CDS if possible, otherwise carry on silently |

Under `auto`, a rebuilt JAR invalidates the archive, the JVM starts anyway, and **the only symptom is that startup got slower again**. No warning. Two defences: use `-Xshare:on` in environments where you want the failure to be loud, or `-XX:+AutoCreateSharedArchive` on 21+ so staleness self-heals.

Confirm it is actually working:

```bash
java -Xlog:class+load=info ... | grep "shared objects file"
# → [0.080s][info][class,load] java.lang.Comparable source: shared objects file
```

Classes must come from JARs or modules. Classes loaded from an exploded directory or a network URL cannot be archived - which is why CDS often appears to do nothing in a development setup and works in production.

---

## The AOT cache (Java 24+)

Project Leyden's replacement for the old `jaotc` approach, and a genuinely different mechanism: rather than compiling to native code ahead of time, it records the class-loading and linking work - and, from 25, method profiles - so a later run skips it.

**Verified on 25.0.4.1**, `AOTCache`, `AOTCacheOutput` and `AOTMode` are `product` flags, and `AOTMode` accepts exactly `off, record, create, auto, on` (the JVM lists them when given an invalid value). All are absent from 8, 11, 17 and 21.

```bash
# one step (25+)
java -XX:AOTCacheOutput=app.aot -cp app.jar com.example.Main
#   → AOTCache creation is complete: app.aot 9437184 bytes

# two step (24+)
java -XX:AOTMode=record -XX:AOTConfiguration=app.aotconf -cp app.jar com.example.Main
java -XX:AOTMode=create -XX:AOTConfiguration=app.aotconf -XX:AOTCache=app.aot -cp app.jar

# use it
java -XX:AOTCache=app.aot -cp app.jar com.example.Main
```

All three paths verified end to end on 25.0.4.1; the one-step form produced a 9.4 MB cache and the two-step form produced an identical size.

**The cache pins the heap-layout flags it was built with.** With `-Xlog:aot`:

```
[0.026s][info][aot] Opened AOT cache app.aot.
[0.026s][info][aot] The AOT cache was created with UseCompressedOops = 1,
                    UseCompressedClassPointers = 1, UseCompactObjectHeaders = 0
```

Change any of those at runtime - notably by enabling `-XX:+UseCompactObjectHeaders`, or by crossing the 32 GB compressed-oops boundary with a larger heap - and the cache no longer applies. **Rebuild the cache whenever the heap configuration or the application changes**, and treat it as a build artefact tied to a specific JVM configuration, not a portable file.

The recording run should exercise a representative workload. A cache recorded from a process that started and immediately exited captures startup only; one recorded after a warm-up captures more.

---

## Warm-up and the tiering trade-off

For a **short-lived** process, C2's better code never repays its compilation cost:

```bash
-XX:TieredStopAtLevel=1     # C1 only: compile fast, never optimise hard
```

Measured on 25.0.4.1 for the 1,135-class startup above: 294 ms against a 302 ms baseline in the first pass - within noise, because the process is too short for C2 to matter either way. **The flag helps when compilation is a real share of a short run**, typically CLIs, serverless functions and batch jobs finishing in under a minute or so. Combined with the AOT cache it gave the best result measured (232 ms).

**Never do this to a long-lived server.** It caps every method at C1 quality permanently, trading a few hundred milliseconds of startup for a permanent throughput deficit.

The reliable technique for a server is unglamorous: **send it representative traffic before putting it in the load balancer.** It warms the JIT, the JPA L2 cache, the connection pools, the filesystem cache and the CPU caches - all the things a flag cannot. Anything measuring performance must do the same, or it is measuring warm-up. See [methodology.md](methodology.md).

---

## GraalVM Native Image

Ahead-of-time compilation to a standalone native binary. Startup drops to milliseconds and initial footprint falls sharply, which is why it is attractive for serverless and CLIs.

Two costs, both real:

**Peak throughput is lower.** There is no JIT, so no profile-guided optimisation and no speculation. For a long-running server the traditional JVM wins in the end. Oaks measured a file-counting program: 4 ms native against 217 ms JVM for 7 files, but **19.2 s JVM against 25.4 s native** for 1.3 million files. The crossover is real and it is not far out.

**Closed-world assumptions restrict the language.** No dynamic class loading via `Class.forName`, no Java agents or JVMTI, no JMX; reflection, dynamic proxies, resource loading and JNI all need explicit configuration. Frameworks that lean on reflection need native-image support to work at all - which most major ones now have, but it constrains what you can add later.

**Choose it for genuinely short-lived or scale-to-zero workloads.** For a long-running service, the AOT cache plus CDS gets a large share of the startup benefit with none of the constraints.

---

## Version notes

Verified by inspecting each JDK's directory and flag set, and by running the workflows.

| Capability | 8 | 11 | 17 | 21 | 25 |
| ---------- | - | -- | -- | -- | -- |
| Default `classes.jsa` shipped | ✗ | ✗ | **✓ 12 MB** | ✓ 13 MB | ✓ 16 MB |
| `-Xshare:dump` to build it | ✓ | ✓ | ✓ | ✓ | ✓ |
| CDS restricted to `rt.jar` / Serial+client | ✓ | ✗ | ✗ | ✗ | ✗ |
| `SharedArchiveFile` | ✓ (diagnostic) | ✓ product | ✓ | ✓ | ✓ |
| `DumpLoadedClassList` (static AppCDS) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ArchiveClassesAtExit` (dynamic AppCDS) | ✗ | ✗ | **✓** | ✓ | ✓ |
| `AutoCreateSharedArchive` | ✗ | ✗ | ✗ | **✓** | ✓ |
| `UseSharedSpaces` flag | false | false | true | absent | absent |
| Old-style AOT (`UseAOT`, `jaotc`) | ✗ | **✓ only** | removed | removed | removed |
| AOT cache (`AOTCache`, `AOTMode`) | ✗ | ✗ | ✗ | ✗ | **✓** (24+) |
| `AOTClassLinking` | ✗ | ✗ | ✗ | ✗ | ✓ |
| `TieredStopAtLevel` | ✓ | ✓ | ✓ | ✓ | ✓ |

Three traps in that table:

- **The old AOT was a Java 11-only feature.** Verified: `-XX:+UseAOT` reports `mixed mode, aot` on 11.0.32.1 and `jaotc` is present there, while both are absent from 17, 21 and 25. So `-XX:AOTLibrary=...` - the form in Oaks' book and in a lot of 2020-era material - works on exactly one release. Its modern replacement is `-XX:AOTCache` on 24+, and the two are unrelated mechanisms despite the shared acronym.
- **CDS gives nothing by default on 8 or 11** because no archive ships. The 25% figure applies to 17+; on 8 and 11 you must build the archive first, and on 8 the restrictions make it barely worthwhile.
- **`UseSharedSpaces` disappears at 21.** Scripts probing that flag to decide whether CDS is active break; use `-Xlog:class+load` and look for `shared objects file` instead.

## Gotchas

- Agent conflates startup with warm-up - class loading and JIT compilation are different problems with different fixes
- Agent recommends `-Xshare:off` to work around an archive problem - measured **~32% slower startup** on 25; fix the archive instead
- Agent builds an AOT cache with the application on a **directory** classpath - `-XX:AOTMode=create` prints `Skipping <class>: Unsupported location` and caches **JDK classes only**. Package a JAR and check the creation log
- Agent assumes CDS needs enabling on 17+ - the default archive ships and is already in use
- Agent assumes CDS works out of the box on 8 or 11 - no archive is bundled; run `-Xshare:dump` first
- Agent builds an AppCDS archive and does not notice it silently stops applying - under the default `-Xshare:auto` a changed JAR invalidates it with no warning; use `-Xshare:on` or `+AutoCreateSharedArchive`
- Agent creates an archive with a different classpath than the run uses - it must be a prefix, and JARs must be unchanged
- Agent expects CDS to archive classes from an exploded directory or URL - only JARs and modules
- Agent recommends `-XX:AOTLibrary` or `jaotc` - Java 11 only; removed in 17
- Agent recommends the AOT cache on 21 or earlier - it arrived in 24
- Agent reuses an AOT cache after changing the heap size past 32 GB or enabling compact object headers - the cache records those flags and stops applying
- Agent sets `-XX:TieredStopAtLevel=1` on a long-running server - permanently caps it at C1-quality code
- Agent expects Native Image to be faster at everything - peak throughput is lower; the crossover is early
- Agent proposes Native Image without checking reflection, proxies, JNI and agent usage - the closed-world model forbids or constrains all of them
- Agent measures startup once - startup timing is noisy; take a median of many runs
- Agent skips application-level warm-up before a benchmark or before serving traffic - no flag substitutes for representative requests

## Related

- [jit-compiler.md](jit-compiler.md) · [methodology.md](methodology.md) · [triage.md](triage.md) · [native-memory.md](native-memory.md) · [containers.md](containers.md) · [allocation.md](allocation.md) · [flags.md](flags.md) · [java-versions.md](java-versions.md)
