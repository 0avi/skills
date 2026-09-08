# Beyond the Language: Modern APIs

| API | Version | When to use it |
| --- | ------- | -------------- |
| Stream gatherers | 24 | When a stream needs an intermediate operation the JDK does not have |
| Virtual threads | 21 | I/O-bound concurrency - usually a framework config change, not new code |
| Structured concurrency, `ScopedValue` | 25 | Fanning out I/O *inside* one task, and the context that has to survive it. See [structured-concurrency.md](structured-concurrency.md) |
| Foreign Function & Memory | 22 | Replacing existing JNI or `sun.misc.Unsafe` code |

---

## Stream Gatherers

`Stream.gather(Gatherer)` is the extension point for **intermediate** operations, as `Collector` is for terminal ones. Use one instead of falling back to a loop or a stateful-lambda hack.

| Gatherer | Effect |
| -------- | ------ |
| `windowFixed(n)` | Non-overlapping batches of `n` |
| `windowSliding(n)` | Overlapping windows of `n` |
| `fold(initial, folder)` | Sequential fold to a single element |
| `scan(initial, scanner)` | Running / cumulative values |
| `mapConcurrent(limit, fn)` | Concurrent mapping with a concurrency cap (uses virtual threads) |

```java
// batch for a bulk API that accepts 100 at a time
submissions.stream()
    .gather(Gatherers.windowFixed(100))
    .forEach(batch -> client.submitBatch(batch));

// running balance
transactions.stream()
    .gather(Gatherers.scan(() -> BigDecimal.ZERO, (running, tx) -> running.add(tx.amount())))
    .toList();
```

- Prefer the built-ins. Write a custom `Gatherer` only for a genuinely reusable operation, and keep it in one well-named place.
- **Do not rewrite working streams to use gatherers** for their own sake.

---

## Virtual Threads

Lightweight threads managed by the JVM. Blocking parks a continuation rather than pinning an OS thread, so thread-per-request scales to hundreds of thousands of tasks - **blocking, sequential, debuggable code scales the way reactive code did, without the reactive model.**

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
  for (var clientRef : clientRefs) {
    executor.submit(() -> fetchFilings(clientRef));
  }
}
```

Rules:

- **I/O-bound work only.** They give nothing to CPU-bound work - use the common `ForkJoinPool` for that.
- **Never pool them.** One per task, then let it die. Pooling defeats the design.
- Prefer `ReentrantLock` over `synchronized` around blocking calls in hot paths. Before Java 24 this was not a preference but a ceiling: a virtual thread blocked inside `synchronized` cannot unmount, so concurrency caps at the carrier count. Measured at **13.1 s versus 1.0 s** for the same work on 21 and 25 in [structured-concurrency.md](structured-concurrency.md).
- Prefer `ScopedValue` over `ThreadLocal`, which is expensive at this scale - **but only on 25**, where it is final. See the version notes below.
- **Prefer the framework switch.** Most application servers and HTTP clients enable virtual threads with one setting - take that rather than hand-rolling executors. Use explicit executors when fanning out I/O yourself.

They speed up **concurrent tasks** and nothing else. A single request that makes three REST calls one after another is exactly as slow with them as without; that is what structured concurrency is for. Read [structured-concurrency.md](structured-concurrency.md) before fanning out inside a task, and before replacing any `ThreadLocal`.

---

## Foreign Function & Memory API

The supported replacement for JNI and for `sun.misc.Unsafe` memory access: no C glue, no separate build step, deterministic deallocation, bounds-checked access.

```java
var linker = Linker.nativeLinker();
var strlen = linker.downcallHandle(
    linker.defaultLookup().find("strlen").orElseThrow(),
    FunctionDescriptor.of(ValueLayout.JAVA_LONG, ValueLayout.ADDRESS));

try (var arena = Arena.ofConfined()) {          // always scope allocations in try-with-resources
  var text = arena.allocateFrom("hello");
  long length = (long) strlen.invoke(text);
}
```

- Most applications will never need this - that is fine.
- **Migrate existing JNI or `Unsafe` memory-access code.** `Unsafe`'s memory methods are being removed.
- Use `jextract` to generate bindings from a C header rather than writing them by hand.

### Native access must be enabled

**Every downcall is a restricted method, and the runtime will eventually refuse one that has not been granted access.** Run the code above on JDK 25 with no flag and it works, but prints:

```
WARNING: A restricted method in java.lang.foreign.Linker has been called
WARNING: java.lang.foreign.Linker::downcallHandle has been called by Ffm in an unnamed module
WARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning for callers in this module
WARNING: Restricted methods will be blocked in a future release unless native access is enabled
```

Grant it explicitly, naming the module rather than everything wherever you can:

```bash
java --enable-native-access=com.example.filing -jar app.jar   # modular
java --enable-native-access=ALL-UNNAMED -jar app.jar          # class path
```

For an executable JAR, `Enable-Native-Access: ALL-UNNAMED` in the manifest does the same. At compile time `-Xlint:restricted` reports the same calls, and it is **not** in javac's default set - only `-Xlint:all` or naming the key surfaces it. See [enforcement.md](enforcement.md).

Treat the warning as a future error: per that fourth line, restricted methods get blocked in a later release, so an FFM migration that ignores the flag ships a time bomb.

## Version notes

The table at the top of this page carries each API's release. Verified floors for the exact code shown:

| API as used above | Since |
| ----------------- | ----- |
| `Executors.newVirtualThreadPerTaskExecutor()` | 21 |
| `Linker`, `Arena.ofConfined()`, `arena.allocateFrom(...)` | 22 |
| `--enable-native-access` as a launcher option | Accepted on **21** as well as 25. Measured on both |
| The runtime warning when it is **absent** | Measured on 25. Documented as arriving with JDK 24; not measured below 25 |
| `-Xlint:restricted` | Absent on 21, present on 25. Measured on both |
| `Stream.gather` with `Gatherers.windowFixed` / `scan` / `mapConcurrent` | 24 |
| `synchronized` no longer pinning a blocked virtual thread | **24** |
| `ScopedValue` | **25** as a final API |
| `StructuredTaskScope` in its current shape | **25**, and still preview |

`ScopedValue` is the trap: the virtual threads advice above recommends it over `ThreadLocal`, and it is a Java 25 API. It does compile on 21 with `--enable-preview`, but with a **different API shape** (`ScopedValue.runWhere(...)` rather than `where(...).run(...)`), so code written against one does not compile on the other. On 21 to 24, keep `ThreadLocal` and revisit on 25. Gatherers are 24, so on a Java 21 LTS project the whole of that section is unavailable and a loop is the correct answer.

## Gotchas

- Agent recommends `ScopedValue` on a Java 21 project - it is 25. `ThreadLocal` is the only option on 21 to 24
- Agent generates gatherer code on Java 21 - `Stream.gather` is 24
- Agent pools virtual threads, or sizes a virtual thread executor - one per task, then let it die. Pooling defeats the design
- Agent moves CPU-bound work onto virtual threads for throughput - they give nothing there; use the common `ForkJoinPool`
- Agent hand-rolls a virtual thread executor when the framework has a one-line switch - take the switch
- Agent enables virtual threads and reports a sequential fan-out as fixed - they make concurrent tasks cheap and change nothing inside one task. See [structured-concurrency.md](structured-concurrency.md)
- Agent rewrites working stream pipelines to use gatherers because they are new - the page says explicitly not to
- Agent writes a custom `Gatherer` for a one-off transformation - prefer the built-ins; custom gatherers earn their place only when reused
- Agent allocates in an `Arena` without try-with-resources - the memory's lifetime is the arena's, and a confined arena must be closed on the thread that made it
- Agent ships FFM code without `--enable-native-access` - it works today with four warning lines, and the last of them says restricted methods get blocked in a future release
- Agent grants `--enable-native-access=ALL-UNNAMED` on a modular application - name the module instead; `ALL-UNNAMED` is the class-path answer
- Agent compiles FFM code, sees no javac output, and reports it clean - `restricted` is not in javac's default lint set
- Agent reaches for the FFM API for something a pure-Java library already does - most applications never need it
- Agent leaves `sun.misc.Unsafe` memory access in place - the memory methods are being removed, so that is a migration, not a preference

## Related

- [structured-concurrency.md](structured-concurrency.md) · [java-versions.md](java-versions.md) · [checklist.md](checklist.md)
