# Beyond the Language: Modern APIs

| API | Version | When to use it |
| --- | ------- | -------------- |
| Stream gatherers | 24 | When a stream needs an intermediate operation the JDK does not have |
| Virtual threads | 21 | I/O-bound concurrency - usually a framework config change, not new code |
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
- Prefer `ReentrantLock` over `synchronized` around blocking calls in hot paths (historically this pinned the carrier thread; largely addressed in Java 24, but the guidance still holds).
- Prefer `ScopedValue` over `ThreadLocal`, which is expensive at this scale.
- **Prefer the framework switch.** Most application servers and HTTP clients enable virtual threads with one setting - take that rather than hand-rolling executors. Use explicit executors when fanning out I/O yourself.

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

## Related

- [java-versions.md](java-versions.md) · [checklist.md](checklist.md)
