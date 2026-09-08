---
name: java-performance-developer
description: Diagnoses and fixes Java performance problems, and writes Java that does not create them, for Java 8 through 25. Trigger when an application is slow, when latency or throughput regresses, for GC pause and heap tuning, out-of-memory errors, high CPU, memory growth and native leaks, slow startup and warm-up, JVM flag selection, garbage collector choice between Serial, Parallel, G1, ZGC, Shenandoah and Epsilon, JIT and code cache tuning, benchmarking with JMH, profiling with JFR, JMC, async-profiler, jcmd, jstat and Native Memory Tracking, heap dump analysis, thread pool and executor sizing, lock contention and false sharing, allocation and object sizing, collection and String performance, buffered I/O, serialization, container and cgroup memory limits, or JDBC and JPA access cost.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# Java Performance Guidelines

Covers diagnosing, tuning and writing Java for performance on **Java 8, 11, 17, 21 and 25**.

This skill has two halves, because Java performance does. One half is **tuning the JVM** - flags, collectors, heap geometry - and it is worthless without measurement. The other half is **writing better code** - allocation, collections, strings, I/O - and most of it is correct without measuring anything. Confusing the two is the most common way to waste effort, so this skill keeps them apart everywhere, including in its checklist.

## Operating rules

1. **Never recommend a JVM flag without the measurement that justifies it.** There is no `-XX:+RunReallyFast`. Hundreds of flags exist, the overwhelming majority should never be changed, and changing one on a hunch is as likely to hurt as help. If you have not seen the GC log, the profile or the footprint, you do not yet have a recommendation - you have a guess. Say so.

2. **Find the bottleneck before optimising anything.** Adding load to a component that is already saturated makes the whole system *slower*, so a successful local optimisation can produce a global regression. Establish which component is the constraint first; if it is not the JVM, say that and stop.

3. **Establish the JDK that *runs* the application, not the one that compiles it.** Default collector, flag names, GC log format and object header size all differ across 8, 11, 17, 21 and 25. Two traps: a Java 8 command line **will not start** on 21 or 25 if it contains `-XX:+PrintGCTimeStamps` or any CMS flag, and the same `--release 21` bytecode behaves differently on 21 and 25 because the `synchronized` pinning fix is a runtime change. See [java-versions.md](references/java-versions.md).

4. **Separate what is safe to apply blind from what is not.** Buffering a stream, sizing a collection, hoisting a `StringBuilder` out of a loop and guarding a log statement are all correct with no measurement. Heap sizing, collector choice, pool sizing and every `-XX` flag are not. [checklist.md](references/checklist.md) marks every rule as one or the other; keep that distinction in any advice you give.

5. **Prefer the ergonomic default and the framework switch.** The JVM tunes heap, thread counts and generation sizes from the machine it finds itself on, and it has got better at it in every release. Most applications need a maximum heap and nothing else. Reach for a framework setting before an executor, and an executor before a flag.

6. **Optimise for the common case, and apply Occam's razor.** Profile-driven work on the hot path beats speculative work everywhere else. A bug in new code is a likelier explanation than a JVM defect - do not jump to the exotic cause first.

Every reference carries a **`## Version notes`** section stating what differs across 8, 11, 17, 21 and 25, and a **`## Gotchas`** list of the specific mistakes agents make in that area. Read the gotchas even when skimming.

**Version-specific behaviour in this skill was verified by running it, on Temurin 8u504, 11.0.32.1, 17.0.20.1, 21.0.12 and 25.0.4.1.** Flag existence, defaults, types and removal behaviour were read from `-XX:+PrintFlagsFinal` and from launching each JVM; object sizes were measured; library constants were read from each JDK's own `src.zip`; timings are JMH with a control benchmark.

Three limits on that claim, stated here because the rest of the skill leans on it:

- **All Windows x64, all Temurin, one 8-CPU host.** Container and cgroup flags **do not exist on this platform**, so every container claim is cited from the JDK issues rather than measured - see the platform caveat in [flags.md](references/flags.md).
- **Launching a JVM proves a flag was accepted, never that it had an effect.** Those are recorded as separate columns, because conflating them is how flag advice goes wrong.
- **Update-version boundaries** (8u192, 8u372, 8u262) come from the release history, not from testing each update.

How each class of figure was produced, and which earlier figures were withdrawn and why, is in [methodology.md](references/methodology.md); what could not be verified is in [flags.md](references/flags.md) and [book-deltas.md](references/book-deltas.md).

## Start Here: Triage

**When there is a symptom, start with triage and do not skip to a fix.** The reference routes from what the user observed to the measurement that identifies the cause, and only then to the section that fixes it.

- **Triage**: The decision tree from symptom to cause - slow response times, low throughput, high CPU, long pauses, memory growth, out-of-memory, slow startup - with the one command to run at each branch and the reading that discriminates between causes. Also covers what to collect *before* the problem recurs. Read [triage.md](references/triage.md)

## Measuring

Get this wrong and everything downstream is noise. Most "performance results" that turn out to be wrong were wrong here.

- **Methodology**: Micro, meso and macro benchmarks and when each lies; JMH and why hand-rolled microbenchmarks are almost always broken; throughput against response time against elapsed time; why percentiles beat averages; establishing whether a difference is real with a t-test rather than eyeballing two numbers; warm-up. Read [methodology.md](references/methodology.md)
- **Tooling**: What to reach for and how to read its output - OS-level CPU, run queue, disk and network; `jcmd`, `jstat`, `jinfo`, `jmap`, `jstack`; JFR and JMC as the default profiler on 11+; sampling against instrumenting and the safepoint bias that makes older profilers lie; async-profiler and flame graphs; native profilers. Read [tooling.md](references/tooling.md)

## The JVM

- **Garbage Collection**: How the collectors work and which to choose. The generational model, the full catalogue - Serial, Parallel, G1, ZGC, Shenandoah, Epsilon - with a per-version availability and status matrix, and GC logging in both the Java 8 form and the unified `-Xlog` form. Read [garbage-collection.md](references/garbage-collection.md)
- **GC Tuning**: Sizing the heap and the generations, pause-time and throughput goals, G1's concurrent cycle and its failure modes, ZGC's very different tuning surface, tenuring and survivor spaces, humongous objects, region sizing, TLABs and collector parallelism. Read [gc-tuning.md](references/gc-tuning.md)
- **JIT Compiler**: Tiered compilation and the five levels, the code cache and how to tell when it is full, inlining, escape analysis, deoptimisation and why "made not entrant" in a log is usually healthy, compiler threads, and the flags here that are worth touching (few). Read [jit-compiler.md](references/jit-compiler.md)
- **Startup and Warm-up**: Why the first requests are slow and what actually helps. Class loading, CDS and AppCDS, the Java 24/25 AOT cache that replaces the old `jaotc` approach entirely, GraalVM Native Image, and the tiered compilation trade-off for short-lived processes. Read [startup-and-warmup.md](references/startup-and-warmup.md)
- **Native Memory**: Everything outside the heap, which is where "the heap is fine but the container keeps dying" lives. Reserved against committed, Native Memory Tracking, thread stacks, code cache, direct byte buffers, native library leaks, glibc arenas, large pages, and compressed oops with the 32 GB cliff. Read [native-memory.md](references/native-memory.md)
- **Containers**: Running under a CPU or memory limit, where most Java now runs and where the defaults most often go wrong. Container awareness by version, `MaxRAMPercentage` in place of a fixed `-Xmx`, and the knock-on effects of a CPU limit on GC threads, JIT threads and every pool sized from `availableProcessors()`. Read [containers.md](references/containers.md)

## Writing Code That Performs

Most of this is applicable without a measurement, which makes it the highest-yield section for code review and for generation.

- **Allocation and Object Layout**: What an object costs, measured. Header size, field packing, alignment padding, compressed oops, and the Java 25 compact object headers that change the arithmetic. Reducing object size, lazy initialisation and when it backfires, canonical and immutable objects. Read [allocation.md](references/allocation.md)
- **Object Lifecycle**: When to defeat the garbage collector deliberately and when not to. Object pools against thread-local reuse with the trade-offs of each, soft, weak and phantom references and their real cost, `Cleaner` in place of `finalize()`, and the short list of things genuinely worth pooling. Read [object-lifecycle.md](references/object-lifecycle.md)
- **Heap Analysis**: Finding what is actually filling the heap. Histograms, heap dumps, shallow against retained against deep size, dominators, comparing two dumps to find a leak, and the full out-of-memory taxonomy - because most `OutOfMemoryError`s are not "the heap is too small". Read [heap-analysis.md](references/heap-analysis.md)
- **Collections**: Choosing and sizing them. Why the initial capacity matters more than people expect, the cost of getting the data structure wrong, synchronised against concurrent against unsynchronised, memory efficiency, and when a collection is the wrong answer entirely. Read [collections-performance.md](references/collections-performance.md)
- **Strings**: Usually the largest single consumer of a Java heap. Compact strings, deduplication, interning and the string table, concatenation and the compiler strategy change that makes the old `StringBuilder` advice partly obsolete, and encoding. Read [strings.md](references/strings.md)
- **I/O and Serialization**: Buffering, and the fact that missing it is still one of the most common real defects. Where a buffer belongs in a filter chain and where it is pure overhead, encoders and decoders, `transferTo`, Java serialization cost and its object-identity trap, and compression. Read [io-performance.md](references/io-performance.md)
- **Exceptions and Logging**: The measured cost of throwing, why stack trace depth is what you actually pay for, the JVM optimisation that makes hot system exceptions nearly free, and logging discipline - including the guard that matters and the levels that should not be on by default. Read [exceptions-and-logging.md](references/exceptions-and-logging.md)
- **Lambdas and Streams**: Lambdas against anonymous classes, where the difference is real and where it is noise, stream laziness as a performance feature, when a stream beats a loop and when it does not, and parallel streams with the common pool problem. Read [lambdas-and-streams.md](references/lambdas-and-streams.md)
- **Concurrency Performance**: Amdahl's law as the ceiling on all of it. Sizing thread pools by what the work actually does, `ForkJoinPool` and work stealing, the cost of synchronisation and the memory semantics behind it, CAS against locks, adders and accumulators under contention, false sharing, and how virtual threads change the sizing question rather than answering it. Read [concurrency-performance.md](references/concurrency-performance.md)

## Beyond the JVM

This skill owns **proving where the bottleneck is** and then hands over. It does not duplicate the sibling skills.

- **Database Access**: How to establish that the database is the constraint, then the Java-side costs that are yours to fix - batching, prepared statement pooling, connection pool sizing, fetch size, transaction scope and isolation, and the JPA lazy-versus-eager and N+1 traps. Defers query and schema work to [`postgresql-developer`](../postgresql-developer/SKILL.md). Read [database-performance.md](references/database-performance.md)
- **Servers and Remote Calls**: Thread models and why non-blocking I/O decouples connections from threads, sizing server and client pools, HTTP client connection reuse and keep-alive, JSON processing costs, payload size and compression, and the coarse-against-chatty interface trade-off. Defers framework configuration to [`spring-boot-developer`](../spring-boot-developer/SKILL.md). Read [server-performance.md](references/server-performance.md)

## Reference

- **Flags**: Every flag in this skill, verified against all five JDKs - whether it exists, its default, its type, and for removed flags whether the JVM warns or **refuses to start**. This is the file to consult before recommending any flag, and the one that catches advice copied from older material. Read [flags.md](references/flags.md)
- **Java Versions**: What changed for performance in each release, the consolidated per-version matrix, and the 8 to 11 to 17 to 21 to 25 upgrade path with the flag translations each step needs. Read [java-versions.md](references/java-versions.md)
- **Checklist**: Every practice in one scannable list for a review pass, **split into apply-blind and measure-first**, with the version floor for each. Read [checklist.md](references/checklist.md)
- **Book Deltas**: Where this skill departs from Scott Oaks' *Java Performance* - the material that was correct in 2020 and is now wrong, the three errata found by running his flags, and what this skill could not verify. Read [book-deltas.md](references/book-deltas.md)
