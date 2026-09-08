# Structured Concurrency and Scoped Values

Two APIs that only start to matter once virtual threads are in use. Virtual threads make **concurrent requests** cheap; they do nothing for a **serial fan-out inside one request**. `StructuredTaskScope` is what fixes that, and `ScopedValue` is what keeps context alive once you have fanned out.

| API | Status on 25 | Verdict |
| --- | ------------ | ------- |
| `StructuredTaskScope` | **Preview** - needs `--enable-preview` | Use it in an application you control and can rebuild. **Never in a published library**, and never enable preview across a whole production build just to get it |
| `ScopedValue` | **Final** | Adopt. It is the only correct answer once you fork |

The two are a package deal: the moment you fork, every plain `ThreadLocal` in the call chain stops working. Do not adopt the first without the second.

---

## The problem neither virtual threads nor a pool solves

```java
// three independent calls, 500 ms each, run one after another
var google   = client.retrieveInfo("google", speaker);
var linkedin = client.retrieveInfo("linkedin", speaker);
var facebook = client.retrieveInfo("facebook", speaker);   // this one throws
```

Two defects, and enabling virtual threads fixes neither. It is 1.5 seconds of wall clock that should be 500 ms, and one dead source fails the whole call.

---

## Pinning: `synchronized` around a blocking call

A virtual thread blocked inside `synchronized` could not unmount before Java 24 - it was **pinned** to its carrier, so the carrier count became the concurrency ceiling. Measured here, 100 virtual threads each sleeping 1 s while holding a **different** lock, so there is no contention to confuse the result:

| JDK | Carriers | `synchronized` | `ReentrantLock` |
| --- | -------- | -------------- | --------------- |
| 21.0.12 | 8 (default = CPU count) | **13.1 s** | 1.0 s |
| 21.0.12 | 20 (`-Djdk.virtualThreadScheduler.parallelism=20`) | **5.0 s** | 1.0 s |
| 25.0.4.1 | 8 | **1.0 s** | 1.0 s |

The 13.1 s is `ceil(100 / 8)` batches of one second. That the number moves with the carrier count and not with the lock is the proof that pinning, not contention, is what you are looking at.

- **On 21 to 23**, replace `synchronized` with `ReentrantLock` wherever a blocking call sits inside it. This is exactly what Apache Tomcat did.
- **From 24** the ceiling is gone (JEP 491). Prefer `ReentrantLock` in new code anyway - it is more expressive - but stop treating `synchronized` as a virtual-thread defect.
- **Do not tune `jdk.virtualThreadScheduler.parallelism` to work around pinning.** Raising it buys a proportional improvement to a problem a JDK upgrade removes entirely.

Diagnosing it: `-Djdk.tracePinnedThreads=short` on 21 prints `reason:MONITOR` with the offending frame. The `jdk.VirtualThreadPinned` JFR event is present on 21 and 25 alike and is the one to reach for on either.

---

## `StructuredTaskScope`

A scope runs each forked task on its own virtual thread and will not let you leave the block until they have all settled. Requires `import static java.util.concurrent.StructuredTaskScope.*;`.

```java
try (var scope = open(Joiner.<Info>awaitAll())) {
  var google   = scope.fork(() -> client.retrieveInfo("google", speaker));
  var linkedin = scope.fork(() -> client.retrieveInfo("linkedin", speaker));
  var facebook = scope.fork(() -> client.retrieveInfo("facebook", speaker));

  scope.join();                                  // the synchronisation point

  return Stream.of(google, linkedin, facebook)
      .filter(task -> task.state() == Subtask.State.SUCCESS)
      .map(Subtask::get)
      .max(comparingInt(info -> info.entries().size()))
      .orElseThrow();
}
```

`fork` returns a `Subtask<T>` immediately - a handle, not a value. **Read nothing until `join()` has returned.** `Subtask.state()` is `UNAVAILABLE`, `SUCCESS` or `FAILED`; `get()` is valid only on the second, `exception()` only on the third.

### `open()` is fail-fast, and that is the Java 25 behaviour change

Bare `open()` is `open(Joiner.awaitAllSuccessfulOrThrow())`. One failed subtask and `join()` throws `StructuredTaskScope.FailedException` with the first failure as its cause - the filtering above is never reached. **`Joiner.awaitAll()` is what makes a failure survivable**, and it has to be asked for.

### The built-in joiners

| Joiner | `join()` returns | Behaviour |
| ------ | ---------------- | --------- |
| `awaitAllSuccessfulOrThrow()` | `Void` | The default. Any failure throws `FailedException` |
| `awaitAll()` | `Void` | Waits for all, throws nothing. Inspect the subtasks yourself |
| `allSuccessfulOrThrow()` | `Stream<Subtask<T>>` | As above, but hands you the subtasks |
| `anySuccessfulResultOrThrow()` | `T` | First success wins, the rest are cancelled |
| `allUntil(Predicate)` | `Stream<Subtask<T>>` | Cancels the scope when the predicate accepts a settled subtask |

`allUntil` cancels rather than waits, so subtasks still running are left `UNAVAILABLE`. Handle that state when you read the stream.

### A custom joiner moves the aggregation out of the caller

```java
public final class BestInfoJoiner implements Joiner<Info, Info> {

  // onComplete is called from the completing subtasks' threads, concurrently
  private final Collection<Info> results = new ConcurrentLinkedQueue<>();
  private final Collection<Throwable> failures = new ConcurrentLinkedQueue<>();

  @Override
  public boolean onComplete(Subtask<? extends Info> subtask) {
    if (subtask.state() == Subtask.State.SUCCESS) {
      results.add(subtask.get());
    } else {
      failures.add(subtask.exception());
    }
    return false;                                // false = keep going; true = cancel the scope now
  }

  @Override
  public Info result() {
    if (results.isEmpty()) {
      var failure = new NoInfoFoundException("every source failed");
      failures.forEach(failure::addSuppressed);  // one throw, every stack trace
      throw failure;
    }
    return results.stream().max(comparingInt(info -> info.entries().size())).orElseThrow();
  }
}
```

The caller then reduces to `try (var scope = open(new BestInfoJoiner())) { ... return scope.join(); }` - the forks need not even be assigned.

`Joiner<T, R>` earns its two type parameters:

- **`T` restricts what `fork` may return.** Under `Joiner<Info, Info>`, `scope.fork(() -> true)` is a compile error. Bare `open()` restricts nothing.
- **`R` is what `join()` returns.** This is what moves aggregation out of the calling method and into a class testable with plain JUnit - no framework, and nothing to mock.

Three rules that are not negotiable:

1. **`onComplete` runs on the completing subtasks' threads.** Use concurrent collections. An `ArrayList` here is a data race that will pass every test you write.
2. **`onComplete` is only ever called for a settled subtask**, so a `default` branch handling `UNAVAILABLE` is dead code. Prefer `if`/`else` over a `switch` that needs an unreachable arm.
3. **`result()` throwing does not propagate your exception.** `join()` wraps it in `FailedException`, and the suppressed exceptions stay attached to **the cause**, not the wrapper. Any caller catching your domain exception must unwrap first.

### `close()` without `join()` is an error

Falling out of the try-with-resources without calling `join()` throws `IllegalStateException: Owner did not join after forking`. It is a runtime failure on a path you may not have tested - an early `return` between the last `fork` and the `join` is how people meet it.

### Configuration

```java
try (var scope = open(new BestInfoJoiner(), cfg -> cfg.withName("info").withTimeout(ofSeconds(2)))) {
```

`withName` shows up in stack traces and is worth setting on every scope. `withTimeout` throws **`StructuredTaskScope.TimeoutException`** - a nested, unchecked type, not the `java.util.concurrent.TimeoutException` your imports will offer you first. `withThreadFactory` replaces the default unnamed-virtual-thread factory.

---

## `ScopedValue`

The context mechanism for code that has stopped being thread-per-request.

```java
public static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();

ScopedValue.where(CURRENT_USER, user).run(() -> handle(request));
```

- **There is no `set()`.** `where(key, value)` returns a `Carrier` that does nothing on its own; the binding exists only for the duration of the `run` or `call` you hand it. Chain `where(...).where(...)` to bind several at once.
- **`call` propagates the operation's checked exception unwrapped** - its parameter is `CallableOp<R, X>`, not `Callable`. Reach for `call` rather than wrapping a checked exception in a `RuntimeException` just to satisfy `run(Runnable)`.
- **Rebinding means nesting.** An inner `where(...).run(...)` shadows the outer binding, and the outer value is untouched afterwards. Nested scopes inherit every outer binding.
- Read with `get()`, and guard with `isBound()` - `get()` on an unbound value throws.

### Against `ThreadLocal`

| | `ThreadLocal` | `ScopedValue` |
| --- | ------------- | ------------- |
| Bound to | a thread | a scope |
| Mutable | yes, from anywhere on that thread | no - rebind in an inner scope |
| Visible inside `scope.fork(...)` | **no** | **yes** |
| Cost per virtual thread | allocated per task, and there is one task per request | none - the binding is shared |

The third row is the whole reason this section exists. Verified on 25: inside a `scope.fork(...)`, a plain `ThreadLocal.get()` returns `null` while the scoped value reads through.

**One refinement, because the blanket claim is wrong:** `InheritableThreadLocal` **does** cross `scope.fork(...)`. Measured on 25 - the forked subtask sees the parent's value. So "thread locals break when you fork" is true of `ThreadLocal` and false of its subclass. That is not a reason to keep an `InheritableThreadLocal`: it is still mutable, still per-thread, and still costs an allocation per task.

### Finding the ones you missed

```
-Djdk.traceVirtualThreadLocals=true
```

Prints a stack trace at every `ThreadLocal` access from a virtual thread. Verified on 25: it fires on `ThreadLocal.set` and names the frame. Run it once over a test suite before adopting scopes and it will list the migration for you.

---

## Version notes

Every floor below was established by compiling and running the exact idiom on the JDK named.

| Idiom | Since | Notes |
| ----- | ----- | ----- |
| `Thread.ofVirtual()`, `Executors.newVirtualThreadPerTaskExecutor()` | 21 | Final |
| `synchronized` no longer pins a blocking virtual thread | **24** | Measured on 21 and 25. JEP 491 |
| `ScopedValue` | 25 final | **Present on 21 as a preview API with a different shape** - static `runWhere` / `callWhere` / `getWhere`. Java 21 source does not compile on 25 |
| `StructuredTaskScope` as used here | 25, **preview** | `--enable-preview` at compile and at run |
| `Joiner.allUntil(Predicate)` | 25 | The fifth built-in; easy to miss |

**The Java 25 redesign is a source break, not an addition.** On 21 to 24 `StructuredTaskScope` was a class you instantiated; on 25 it is an interface you open:

| | 21 to 24 | 25 |
| --- | -------- | -- |
| Type | `class StructuredTaskScope<T>` | `interface StructuredTaskScope<T, R>` |
| Creation | `new StructuredTaskScope<>()`, `ShutdownOnFailure`, `ShutdownOnSuccess` | `open()`, `open(Joiner)`, `open(Joiner, Function)` |
| Policy | subclass and override `handleComplete` | pass a `Joiner` |
| `join()` returns | the scope | `R` |
| Cancellation | `shutdown()`, `joinUntil(Instant)` | the joiner's `boolean`, `withTimeout` |

None of the Java 21 names exist on 25. Any structured-concurrency snippet predating Java 25 has to be rewritten rather than adapted - and because both shapes are preview, neither compiles without a flag.

## Gotchas

- Agent writes `new StructuredTaskScope<>()` or `ShutdownOnFailure` on Java 25 - both were removed; the entry point is `open()`
- Agent generates `StructuredTaskScope` code without `--enable-preview` on the compiler **and** the launcher - it is still preview on 25
- Agent puts a preview API into a library, or turns on `--enable-preview` across a production build to get one - preview classes are not binary compatible between releases
- Agent uses bare `open()` and then filters on `Subtask.State` - `open()` is fail-fast, so `join()` already threw. `Joiner.awaitAll()` is the one that tolerates failure
- Agent reads `subtask.get()` before `join()` - the result is not available and it throws
- Agent returns early between a `fork` and the `join` - `close()` then throws `IllegalStateException: Owner did not join after forking`
- Agent collects into an `ArrayList` inside `onComplete` - it is called concurrently from the completing threads
- Agent writes a `default` arm in `onComplete` for `UNAVAILABLE` - unreachable; use `if`/`else`
- Agent expects a domain exception thrown from `result()` to reach the caller - `join()` wraps it in `FailedException`, and suppressed exceptions hang off the cause
- Agent catches `java.util.concurrent.TimeoutException` for `withTimeout` - it is the nested `StructuredTaskScope.TimeoutException`
- Agent relies on a `ThreadLocal` set before the scope and read inside a `fork` - it is empty there
- Agent calls `ScopedValue.set(...)` - there is none. Bind with `where(...).run(...)` and rebind by nesting
- Agent wraps a checked exception in a `RuntimeException` to fit `run(Runnable)` - `call` propagates it unwrapped
- Agent recommends `ScopedValue` on a Java 21 project - it is preview there, with `runWhere` rather than `where(...).run(...)`
- Agent raises `jdk.virtualThreadScheduler.parallelism` to work around pinning - upgrade past 24, or use `ReentrantLock`
- Agent opens a scope for a single task, or for CPU-bound work - a scope is for fanning out I/O and joining it

## Related

- [modern-apis.md](modern-apis.md) · [java-versions.md](java-versions.md) · [exceptions-and-resources.md](exceptions-and-resources.md) · [checklist.md](checklist.md)
