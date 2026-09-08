# Performance Checklist

For a review pass over existing code and configuration. **Split into two halves, and the split is the point.**

- **Part A: apply blind.** Correct without a measurement. A finding here is actionable as it stands.
- **Part B: measure first.** Requires evidence. A finding here without a measurement is a guess, and stating it as a recommendation is the failure mode this skill exists to prevent.

**Establish the JDK version before starting.** Most rules are version-gated, and "use compact strings" is noise on Java 8. See the version table at the end.

---

## Part A: apply blind

Correct on every version unless the gating column says otherwise. No measurement needed.

### I/O

| # | Rule | Measured | Since | Reference |
| - | ---- | -------- | ----- | --------- |
| A1 | **Never read or write a file or socket a byte at a time unbuffered.** Wrap in `BufferedInputStream`/`BufferedOutputStream`, or `BufferedReader`/`BufferedWriter` | **143× read, 763× write** | 8 | [io-performance.md](io-performance.md) |
| A2 | Prefer a `byte[]` block loop, or `Files.readAllBytes`, over any single-byte loop | **39× over buffered single-byte** | 8 | [io-performance.md](io-performance.md) |
| A3 | Put a buffer **above** a compressing or encrypting stream in a filter chain, never below it | **2.7×** for gzip above the deflater; **1.0× (nothing) below it** | 8 | [io-performance.md](io-performance.md) |
| A4 | Do **not** buffer a `ByteArrayInputStream`/`ByteArrayOutputStream` with nothing in between | Copies twice for nothing | 8 | [io-performance.md](io-performance.md) |
| A5 | Encode and decode whole buffers, never a character at a time | Cost is per call | 8 | [io-performance.md](io-performance.md) |
| A6 | Always name the charset explicitly | Correctness too; default changed at 18 | 8 | [strings.md](strings.md) |
| A7 | Use `transferTo` for stream-to-stream copies | No buffer needed | 11 | [io-performance.md](io-performance.md) |

### Strings

| # | Rule | Measured | Since | Reference |
| - | ---- | -------- | ----- | --------- |
| A8 | **Never concatenate in a loop** where the result carries to the next iteration. Use `StringBuilder` | **2-2.5×**, quadratic in iterations | 8 | [strings.md](strings.md) |
| A9 | Do **not** replace single-line concatenation with `StringBuilder` | Measured no faster, less readable | 8 | [strings.md](strings.md) |
| A10 | Size `StringBuilder`, `StringBuffer` and `ByteArrayOutputStream` when the length is estimable | Doubling leaves ~25% waste | 8 | [collections-performance.md](collections-performance.md) |

### Collections

| # | Rule | Measured | Since | Reference |
| - | ---- | -------- | ----- | --------- |
| A11 | **Size array-backed collections at construction** when the size is known | `HashMap` **1.5× at 1k, 2.3× at 100k**; `ArrayList` 1.15× at 1k and **not measurable at 100k** - still free to do | 8 | [collections-performance.md](collections-performance.md) |
| A12 | Size `HashMap` for the load factor: `expected / 0.75 + 1`, or `HashMap.newHashMap(n)` | Resizes at 75% otherwise | 8 / 19 | [collections-performance.md](collections-performance.md) |
| A13 | Choose the structure for the access pattern. Avoid `LinkedList` for indexed or general use | Asymptotic | 8 | [collections-performance.md](collections-performance.md) |
| A14 | Use `entrySet()` or `forEach`, never `keySet()` plus `get()` | Hashes every key twice | 8 | [collections-performance.md](collections-performance.md) |
| A15 | Do not use a collection for one or two values | 8 bytes against hundreds | 8 | [collections-performance.md](collections-performance.md) |
| A16 | Never depend on `HashMap` iteration order, nor `Set.of`/`Map.of` order | Correctness | 8 | [collections-performance.md](collections-performance.md) |
| A17 | Prefer a concurrent collection to a synchronised wrapper when shared | Per-bin locking | 8 | [collections-performance.md](collections-performance.md) |

### Allocation

| # | Rule | Measured | Since | Reference |
| - | ---- | -------- | ----- | --------- |
| A18 | Do not instantiate a collection or expensive object in a field that is usually unused | Reference 8 B, graph hundreds | 8 | [allocation.md](allocation.md) |
| A19 | Declare the narrowest correct field type | Only pays across an 8-byte boundary | 8 | [allocation.md](allocation.md) |
| A20 | Prefer a local variable to a field where the value is used in one method | Falls out of scope free | 8 | [allocation.md](allocation.md) |
| A21 | Clear stale references in long-lived structures (`elementData[--size] = null`) | Otherwise retained forever | 8 | [allocation.md](allocation.md) |
| A22 | Do **not** null out fields generally to help the collector | Unnecessary | 8 | [allocation.md](allocation.md) |
| A23 | Design immutable types with a factory, not a public constructor | Enables canonicalisation later | 8 | [allocation.md](allocation.md) |
| A24 | Double-checked locking needs `volatile`, a local, and publish-last | Data race otherwise | 8 | [allocation.md](allocation.md) |

### Exceptions and logging

| # | Rule | Measured | Since | Reference |
| - | ---- | -------- | ----- | --------- |
| A25 | Use exceptions for exceptional conditions. Test a cheap condition instead of throwing | **1,300 ns at depth 1, 6,716 ns at depth 60**; add ~5× again if the trace is materialised | 8 | [exceptions-and-logging.md](exceptions-and-logging.md) |
| A26 | Do not log a full stack trace on a hot path | **~24 µs** to materialise 60 frames | 8 | [exceptions-and-logging.md](exceptions-and-logging.md) |
| A27 | Guard any log statement whose arguments call methods, concatenate or allocate | Evaluated even when disabled | 8 | [exceptions-and-logging.md](exceptions-and-logging.md) |
| A28 | Write plenty of logging; enable almost none by default. INFO is not for normal flow | INFO is on by default | 8 | [exceptions-and-logging.md](exceptions-and-logging.md) |
| A29 | Log numerically in access logs: IPs not hostnames, epochs not formatted dates | A DNS lookup is a round trip | 8 | [exceptions-and-logging.md](exceptions-and-logging.md) |
| A30 | Never parse a stack trace programmatically. Use `StackWalker` to find a caller | The JVM may elide traces | 8 / 11 | [exceptions-and-logging.md](exceptions-and-logging.md) |

### Streams and lambdas

| # | Rule | Measured | Since | Reference |
| - | ---- | -------- | ----- | --------- |
| A31 | **Never build intermediate collections between passes.** One lazy pipeline | Forfeits short-circuiting: **O(n) instead of O(1)**. Measured 3,480 µs against 0.069 µs on 100k | 8 | [lambdas-and-streams.md](lambdas-and-streams.md) |
| A32 | Use primitive streams (`mapToInt`, `IntStream`) to avoid boxing | 16 B per element of garbage | 8 | [lambdas-and-streams.md](lambdas-and-streams.md) |
| A33 | Prefer one clear predicate to several trivial chained filters | **13%** for four instead of one | 8 | [lambdas-and-streams.md](lambdas-and-streams.md) |
| A34 | Do **not** rewrite working loops as streams for speed, **or streams as loops** | JMH: 1.07-1.36×, and **two of six shapes showed no difference at all** | 8 | [lambdas-and-streams.md](lambdas-and-streams.md) |
| A35 | Never put blocking work in a parallel stream or the common pool | Stalls every parallel stream in the JVM | 8 | [lambdas-and-streams.md](lambdas-and-streams.md) |
| A36 | Choose lambda or anonymous class on readability | Measured indistinguishable | 8 | [lambdas-and-streams.md](lambdas-and-streams.md) |
| A37 | Prefer `toList()` to `collect(Collectors.toList())` | One less intermediate | 16 | [lambdas-and-streams.md](lambdas-and-streams.md) |

### Object lifecycle

| # | Rule | Measured | Since | Reference |
| - | ---- | -------- | ----- | --------- |
| A38 | **Never override `finalize()`.** `AutoCloseable` first, `Cleaner` as backstop | Delays the whole object graph | 8 / 9 | [object-lifecycle.md](object-lifecycle.md) |
| A39 | A `Cleaner` action must not reference the object being cleaned. Use a `static` nested class | Otherwise it never runs | 9 | [object-lifecycle.md](object-lifecycle.md) |
| A40 | Reuse only genuinely expensive-to-**initialise** objects, in small numbers | Allocation is a pointer bump | 8 | [object-lifecycle.md](object-lifecycle.md) |
| A41 | Prefer a `ThreadLocal` to a pool where a per-thread object fits and no throttle is needed | **52 µs vs 3,763 µs** for `Random` | 8 | [object-lifecycle.md](object-lifecycle.md) |
| A42 | Never build a canonicalising cache with strong keys | That is a leak | 8 | [allocation.md](allocation.md) |
| A43 | Close `Inflater`/`Deflater` and streams built on them | Native memory waits for GC otherwise | 8 | [native-memory.md](native-memory.md) |

### Database and remote calls

| # | Rule | Measured | Since | Reference |
| - | ---- | -------- | ----- | --------- |
| A44 | **Batch writes, and turn off autocommit for bulk work** | **141× combined** | 8 | [database-performance.md](database-performance.md) |
| A45 | Use `PreparedStatement` for repeated SQL; plain `Statement` for genuinely one-off | Reuse is the whole benefit | 8 | [database-performance.md](database-performance.md) |
| A46 | Configure statement pooling in exactly one place, driver or container | Not both | 8 | [database-performance.md](database-performance.md) |
| A47 | Never flatten shared object references in custom serialization | **Breaks object identity** | 8 | [io-performance.md](io-performance.md) |
| A48 | Mark derived and large fields `transient` where the receiver may not need them | ~15% time, ~13% size | 8 | [io-performance.md](io-performance.md) |
| A49 | Share one HTTP client object; it is thread-safe and expensive | `HttpClient` pools per object | 8 | [server-performance.md](server-performance.md) |
| A50 | One `ObjectMapper` per application | Builds proxies per type | 8 | [server-performance.md](server-performance.md) |
| A51 | Reuse parser factories; never share a parser across threads | Factories are thread-safe, parsers are not | 8 | [server-performance.md](server-performance.md) |
| A52 | Design coarse remote interfaces | 10 × 60 B cost as much as 1 × 186 KB | 8 | [server-performance.md](server-performance.md) |
| A53 | Bound every work queue and reject with 429/503 under overload | Unbounded latency otherwise | 8 | [concurrency-performance.md](concurrency-performance.md) |
| A54 | Construct `ThreadPoolExecutor` explicitly; avoid the `Executors` factories | Unbounded queue or threads | 8 | [concurrency-performance.md](concurrency-performance.md) |
| A55 | Identify and fix JPA N+1 selects | **66,817 statements against 1** | 8 | [database-performance.md](database-performance.md) |
| A56 | Verify JPA bytecode enhancement is configured | Behaviour is unpredictable without it | 8 | [database-performance.md](database-performance.md) |

### Configuration that is always right

| # | Rule | Why | Since | Reference |
| - | ---- | --- | ----- | --------- |
| A57 | **GC logging always on, rotating, including production** | Negligible cost, first evidence needed | 8 | [garbage-collection.md](garbage-collection.md) |
| A58 | **`-XX:+HeapDumpOnOutOfMemoryError` with a path** | Costs nothing until failure | 8 | [heap-analysis.md](heap-analysis.md) |
| A59 | **JFR running continuously with `settings=default`** | ~1%, and the only route to some data | 8u262 | [tooling.md](tooling.md) |
| A60 | `-XX:+ExitOnOutOfMemoryError` in a container | A JVM past an OOM is in an unknown state | 8u92 | [heap-analysis.md](heap-analysis.md) |
| A61 | Use a **percentage** rather than a fixed `-Xmx` in a shared image, **with the decimal point** | A fixed `-Xmx` is wrong under every other limit; the integer form is **fatal on 8** | 8u191 | [containers.md](containers.md) |
| A62 | Never let a system swap | An order of magnitude on full GC | 8 | [gc-tuning.md](gc-tuning.md) |
| A63 | Never set a heap larger than physical memory, summed across JVMs | Guarantees swapping | 8 | [gc-tuning.md](gc-tuning.md) |
| A64 | Remove every flag from the removal matrix that is fatal on the target version | **The JVM will not start** | - | [flags.md](flags.md) |
| A65 | Never add `System.gc()` to application code | Always a full stop-the-world GC | 8 | [garbage-collection.md](garbage-collection.md) |

---

## Part B: measure first

**A finding here is not actionable without the stated evidence.** If you do not have it, say what to collect rather than what to change.

| # | Change | Required evidence | Reference |
| - | ------ | ----------------- | --------- |
| B1 | `-Xmx` / `-Xms` | Occupancy after a full GC; target ~30% | [gc-tuning.md](gc-tuning.md) |
| B2 | Collector choice | GC log showing pause or throughput failure, plus CPU headroom | [garbage-collection.md](garbage-collection.md) |
| B3 | `-XX:MaxGCPauseMillis` | GC log showing pauses near but above target | [gc-tuning.md](gc-tuning.md) |
| B4 | `-XX:GCTimeRatio` | Time-in-GC fraction, **and the version's default** (99 on 8, 12 on 11+) | [gc-tuning.md](gc-tuning.md) |
| B5 | Generation sizing (`NewRatio`, `-Xmn`) | Measured promotion problem, adaptive sizing already off | [gc-tuning.md](gc-tuning.md) |
| B6 | Survivor / tenuring | `gc+age` showing survivor overflow. High effort, low reward | [gc-tuning.md](gc-tuning.md) |
| B7 | G1 concurrent tuning (`IHOP`, `ConcGCThreads`, `G1MixedGCCountTarget`) | A **named** G1 failure in the log | [gc-tuning.md](gc-tuning.md) |
| B8 | `-XX:G1HeapRegionSize` | Humongous allocation events, or a very wide heap range | [gc-tuning.md](gc-tuning.md) |
| B9 | `-XX:ReservedCodeCacheSize` | "CodeCache is full" warning, or `Compiler.codecache` | [jit-compiler.md](jit-compiler.md) |
| B10 | `-XX:CICompilerCount` | Several JVMs per host, or a 1-CPU container | [jit-compiler.md](jit-compiler.md) |
| B11 | `-XX:TieredStopAtLevel=1` | A genuinely short-lived process. **Never a server** | [startup-and-warmup.md](startup-and-warmup.md) |
| B12 | Thread pool size | Where threads block, and which component is saturated | [concurrency-performance.md](concurrency-performance.md) |
| B13 | Connection pool size | The **database's** utilisation, not the JVM's | [database-performance.md](database-performance.md) |
| B14 | `-XX:ParallelGCThreads` | JVM count per host, or a very large machine | [gc-tuning.md](gc-tuning.md) |
| B15 | `ForkJoinPool.common.parallelism` | Contention for the common pool, or a CPU limit | [concurrency-performance.md](concurrency-performance.md) |
| B16 | `ForkJoinPool` instead of partitioning | That the work is genuinely **unbalanced** | [concurrency-performance.md](concurrency-performance.md) |
| B17 | Fork/join leaf threshold | Measured; it dominates the result | [concurrency-performance.md](concurrency-performance.md) |
| B18 | `-XX:+UseStringDeduplication` | Duplicate string proportion. **Can increase memory** | [strings.md](strings.md) |
| B19 | `intern()` plus `StringTableSize` | `PrintStringTableStatistics` bucket sizes | [strings.md](strings.md) |
| B20 | `-XX:SoftRefLRUPolicyMSPerMB` | Soft-reference cache filling faster than the default clears | [object-lifecycle.md](object-lifecycle.md) |
| B21 | `-XX:MaxDirectMemorySize` | NMT `Other`/`Internal`, or buffer pool MBeans | [native-memory.md](native-memory.md) |
| B22 | `-Xss` | Memory pressure **and** high thread count. Not on 9+ first | [native-memory.md](native-memory.md) |
| B23 | `-XX:+UseLargePages` | Large heap, and OS configuration done | [native-memory.md](native-memory.md) |
| B24 | `-XX:+UseCompactObjectHeaders` (25) | Measured benefit on **your** objects; invalidates an AOT cache | [allocation.md](allocation.md) |
| B25 | AOT cache | Startup is the actual complaint | [startup-and-warmup.md](startup-and-warmup.md) |
| B26 | AppCDS beyond the default archive | Startup is the complaint, and classpath is stable | [startup-and-warmup.md](startup-and-warmup.md) |
| B27 | GraalVM Native Image | Short-lived workload, **and** reflection/proxy/JNI audit | [startup-and-warmup.md](startup-and-warmup.md) |
| B28 | TLAB tuning | Allocation-outside-TLAB events. Fix object sizes first | [allocation.md](allocation.md) |
| B29 | Response compression | **Tested on the users' real network** | [server-performance.md](server-performance.md) |
| B30 | `JOIN FETCH` for N+1 | What the **L2 cache** would do. Measured **5× slower** on repeats | [database-performance.md](database-performance.md) |
| B31 | Transaction isolation | Correctness requirements first, always | [database-performance.md](database-performance.md) |
| B32 | Optimistic vs pessimistic locking | Collision rate | [database-performance.md](database-performance.md) |
| B33 | `setFetchSize` | Result set size and observed `next()` latency | [database-performance.md](database-performance.md) |
| B34 | L2 cache sizing | Cached entity count against full GC duration | [database-performance.md](database-performance.md) |
| B35 | `-XX:-StackTraceInThrowable` | Extreme throw rates. **Last resort** | [exceptions-and-logging.md](exceptions-and-logging.md) |
| B36 | `-XX:+AlwaysPreTouch` | Preferring a deploy-time failure. Not for short-lived processes | [gc-tuning.md](gc-tuning.md) |
| B37 | `-XX:ActiveProcessorCount` | Only a CPU *request* set, or wrong detection | [containers.md](containers.md) |
| B38 | The **value** of `-XX:MaxRAMPercentage` | The limit, and the non-heap footprint under it. **Measured default is 50% at or below ~256 MB and 25% above**, so raising it helps a 512 MB+ container and harms a small one | [containers.md](containers.md) |
| B39 | `-XX:+DisableExplicitGC` | A GC log showing `System.gc()` pauses that actually cost you, **and** proof the process allocates no direct or mapped `ByteBuffer`s. **Verified to cause `OutOfMemoryError: Direct buffer memory` on all of 8/11/17/21/25.** Prefer `-XX:+ExplicitGCInvokesConcurrent` | [garbage-collection.md](garbage-collection.md) |

---

## Top five

1. **Buffer your I/O.** Two to three orders of magnitude on byte-at-a-time streams, because unbuffered means a system call per byte. Still one of the most common real defects, and it needs no measurement to fix.
2. **Find the bottleneck before optimising anything.** Adding load to a saturated component made response time 9× worse in Oaks' measurement. A local win can be a global regression.
3. **Size your collections, especially maps.** JMH: `HashMap` 2.3× at 100,000 entries. `ArrayList` gains little and sometimes nothing measurable, but the constructor argument is free either way.
4. **Never concatenate strings in a loop.** 2-2.5×, and quadratic in the iteration count.
5. **Turn on the GC log, JFR and heap-dump-on-OOM now**, before you need them. They cost almost nothing and they are the difference between diagnosing the next incident and waiting for the one after.

**And the meta-rule: no flag without a measurement.** There are around 900 flags on a modern JVM and almost all exist for JVM support engineers. Finding one is not a reason to set it.

---

## Version notes

### Version gating

| Rules | Need at least |
| ----- | ------------- |
| Most of Part A | 8 |
| A7 (`transferTo`), A30 (`StackWalker`), A39 (`Cleaner`) | 9 / 11 |
| A37 (`toList()`) | 16 |
| A12 (`HashMap.newHashMap`) | 19 |
| A59 (JFR without an unlock flag) | 8u262 |
| A60 (`ExitOnOutOfMemoryError`) | 8u92 |
| A61 (percentage instead of fixed `-Xmx`) | 8u191, and **the decimal form on 8** |
| B38 (`MaxRAMPercentage` value) | 8u191 |
| B24 (compact object headers) | **25** |
| B25 (AOT cache) | **24** |
| B26 (dynamic AppCDS) | 17 |

### Gated by something other than the language level

Which is what makes these easy to get wrong:

| Rule | Actually gated by |
| ---- | ----------------- |
| A57 (GC log syntax) | The **runtime JDK**. Java 8 flags are **fatal** on 11+ |
| A8 (concat bytecode) | **`--release`**, not the runtime. `--release 8` on javac 25 still emits `StringBuilder` |
| Compact strings | The **runtime**, needs no recompile |
| A6 (default charset) | The **runtime**. UTF-8 from 18 |
| Virtual thread pinning | The **runtime**. Fixed in 24, so identical bytecode behaves differently on 21 and 25 |
| A64 (which flags are fatal) | The **runtime**. See [flags.md](flags.md) |

### Rules that change meaning on Java 21+

| Rule | Change |
| ---- | ------ |
| B12 (thread pool size) | Virtual threads remove the constraint for I/O-bound work. The CPU-bound arithmetic stands |
| B13 (connection pool size) | The pool becomes the **primary** throttle protecting the database, since threads are no longer scarce |
| A41 (`ThreadLocal` over a pool) | One thread per task means per-thread state multiplies. Consider `ScopedValue` |
| A53 (bound the queue) | More important, not less - virtual threads make it easy to accept more work than the downstream can take |

---

## Gotchas

- Agent reports a Part B item as a recommendation without the evidence - that is the failure this split exists to prevent; say what to collect instead
- Agent runs this list without establishing the JDK version - most rules are gated and half the findings would be unactionable
- Agent treats every deviation as a defect - each rule links to the reference stating when it does not apply
- Agent reports Part A and Part B findings with equal confidence - A is actionable now, B is a hypothesis
- Agent recommends a flag not present in [flags.md](flags.md) - if it is not verified there, do not recommend it
- Agent applies this to generated code wholesale - Part A is a good generation default; Part B never is
- Agent counts 65 Part A rules as 65 separate changes - several are one decision, and A57 to A65 are one configuration change for the whole repository
- Agent quotes a measured multiple as a guarantee - they are from this skill's test environment and indicate magnitude, not a promise
- Agent skips the bottleneck question and works down the list - rule 2 of the top five outranks the entire checklist

## Related

- [triage.md](triage.md) · [flags.md](flags.md) · [java-versions.md](java-versions.md) · [methodology.md](methodology.md) · [book-deltas.md](book-deltas.md) · [io-performance.md](io-performance.md) · [collections-performance.md](collections-performance.md) · [strings.md](strings.md) · [gc-tuning.md](gc-tuning.md) · [concurrency-performance.md](concurrency-performance.md)
