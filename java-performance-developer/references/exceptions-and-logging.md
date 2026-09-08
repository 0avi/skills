# Exceptions and Logging

Two areas where the received wisdom is wrong in an interesting way. Exceptions are not slow - **stack traces are**. And logging is usually a bigger real cost than exceptions, because it runs on the happy path.

| Claim | Verdict |
| ----- | ------- |
| "try/catch blocks are expensive" | **False, and this one is confirmed against a control.** A `try`/`catch` that never fires is indistinguishable from no `try` at all, at every depth tested |
| "Throwing is expensive" | **Partly true, and depth is why.** With no stack trace at all: 0.9 ns from one frame down, but **506 ns at 10 frames and 2,985 ns at 60** - that is stack unwinding |
| "Stack trace capture is expensive" | **True, and it scales sublinearly.** ~1,300 ns at depth 1 and ~3,731 ns at depth 60 - a 60× deeper stack costs 2.9× more |
| "Materialising a trace is expensive" | **True, and it is the largest term.** 7,189 ns at depth 1, ~5× the throw itself |
| "Use exceptions for control flow if it is faster" | **No.** Design first; the cost is a reason not to, never a reason to |

---

## The measurement

Measured with **JMH** on Temurin 25.0.4.1, `AverageTime` in ns/op, parameterised by the **depth of the call chain** the exception is thrown from. Every row includes a **control** that runs the same call chain and returns normally, because without one you cannot tell an operation's cost from the harness's:

| Depth | Control: call chain, no throw | `try`/`catch` that never fires | Preallocated, `writableStackTrace=false` | `throw new`, caught, ignored | `throw new` + `getStackTrace()` |
| ----- | ----------------------------- | ------------------------------ | ---------------------------------------- | ---------------------------- | ------------------------------- |
| 1 | 1.571 ± 0.265 | 1.129 ± 0.042 | **0.901 ± 0.100** | 1,300 ± 37 | 7,189 ± 137 |
| 10 | 10.971 ± 0.254 | 11.740 ± 1.050 | 506 ± 22 | 2,234 ± 150 | 35,474 ± 18,848 |
| 60 | 140.314 ± 3.547 | 138.588 ± 2.244 | 2,985 ± 338 | 6,716 ± 273 | not completed¹ |

¹ `getStackTrace()` at depth 60 was abandoned: at depth 10 its error bar is already ± 53%, and a figure that unstable is not worth quoting. Read the depth-1 and depth-10 columns as a magnitude and stop there.

**Note the control column first, because an earlier version of this table got this wrong.** It listed a control of **12 ns** for doing nothing, and a preallocated throw at **11 ns**, and concluded the throw was free because 11 < 12. With a real control the floor is **1.571 ns at depth 1**, not 12 - the old figures were the harness, and the "free" conclusion was drawn from noise. See [methodology.md](methodology.md).

Four conclusions, in order of how much they should change your code:

1. **A `try`/`catch` that never fires is genuinely free.** Compare columns two and three at every depth: 1.129 against 1.571 at depth 1, 11.740 against 10.971 at depth 10, 138.588 against 140.314 at depth 60. **Indistinguishable at every depth.** So "wrap it in try/catch and see" costs nothing when nothing throws, and the folklore about expensive `try` blocks is dead. This is the one claim in this file that a control actually *confirmed*.

2. **The throw is not free, and unwinding is why.** A preallocated exception with no writable stack trace still costs **0.9 ns at depth 1 but 506 ns at depth 10 and 2,985 ns at depth 60.** No trace is captured in any of those, so this is the cost of *unwinding the stack* to find the handler, and it scales with how far it has to go. The older claim that "the throw is free, only the stack trace costs" is true only when you throw from one frame down. **Throwing across a deep stack is expensive even with stack traces disabled**, which also means `-XX:-StackTraceInThrowable` buys less than people expect.

3. **Capturing the trace costs, and it scales *sublinearly*.** Subtract the preallocated column to isolate `fillInStackTrace`: about **1,300 ns at depth 1, 1,729 ns at depth 10, 3,731 ns at depth 60.** A **60× deeper stack costs only 2.9× more** to capture. That is worth knowing in both directions: the fixed cost of constructing a throwable dominates at shallow depths, and deep stacks are not the catastrophe a linear model predicts. An earlier version of this file claimed "4.4× deeper stack, 4.4× cost", i.e. linear; **that is withdrawn - the relationship is clearly sublinear.**

4. **Materialising the trace is the expensive part.** `getStackTrace()` converts the internal representation into `StackTraceElement[]`, allocating one object per frame: **7,189 ns at depth 1** against 1,300 ns for the throw alone. That is roughly 5× the cost of the throw, and it is what logging an exception with its stack trace actually costs. At a thousand a second, ~7 µs each is 0.7% of a core spent formatting traces - and more on deeper stacks.

**In a web application, stacks are deep.** Sixty frames is conservative for anything running in a framework; 100-200 is common. So read the depth-60 row as the realistic one, and note what it says: **a throw from deep in a framework costs about 6.7 µs even before anyone logs it.**

---

## What follows from that

**Use exceptions for exceptional conditions, and the cost takes care of itself.** Good design and good performance agree here, which is the comfortable case.

Where they do not agree, the fix is usually to avoid the *throw*, not to make it cheaper:

```java
// throws on every empty stack - 1,300 ns each from one frame down, ~6,700 ns from deep in a framework
try { return stack.pop(); } catch (EmptyStackException e) { return null; }

// tests first - ~1 ns
return stack.isEmpty() ? null : stack.pop();
```

`Stack.pop`, `Iterator.next`, `Integer.parseInt` and `Optional.get` all throw on states you can cheaply test for. When the "exceptional" branch is common, test instead. Note that `Stack` genuinely permits `null` elements, so returning `null` is not a clean sentinel - which is exactly why the check belongs outside.

### When you want a fast exception deliberately

For a control-flow-like exception in a hot path - a parser bailing out, a search terminating early - remove the stack trace:

```java
// a shared, immutable, trace-free signal
private static final MyException SIGNAL = new MyException("done", null, false, false);
//                                          writableStackTrace ─────────────┘
```

The four-argument `Throwable` constructor takes `enableSuppression` and `writableStackTrace`. With `writableStackTrace = false` the exception costs **11 ns** - nothing. Or override `fillInStackTrace()` to return `this`.

**Only do this for an exception that is genuinely a signal**, never one a human will debug: there is no stack trace, so there is nothing to diagnose from. Make the class private and the intent obvious.

### The JVM already optimises hot implicit exceptions

Repeatedly dereferencing null in the same place produces `NullPointerException`s that eventually cost almost nothing: after the site has been hot for a while, **the JVM reuses a single preallocated exception with no stack trace**. `printStackTrace()` on it produces no output.

Two consequences. A benchmark without a long warm-up measures the un-optimised path and overstates the cost. And code that inspects a caught `NullPointerException`'s stack trace works during development and mysteriously stops working under load - an excellent argument for never parsing stack traces programmatically.

### `-XX:-StackTraceInThrowable`

Disables stack trace capture globally. Verified present on all five versions, default `true`.

This is a **last resort**. It makes every exception trace-free, so diagnosability is gone - and code that reads stack traces to make decisions (which exists, and which is a bad idea) breaks silently.

The one place it is defensible is the pathological case the JDK itself creates: `ClassLoader.loadClass` throws `ClassNotFoundException` when it cannot find a class, which is **not** an exceptional condition - no single loader in a hierarchy is expected to find everything, so a delegation chain generates exceptions as its normal search mechanism. In a server with dozens of loaders and tens of thousands of classes across hundreds of JARs, Oaks measured **up to 3% of startup** recovered by disabling stack traces. Only worth considering at that scale, and only for startup.

---

## Logging

Logging usually costs more than exceptions in practice, because it runs on the path that always executes.

### Three logs, three different answers

| Log | Recommendation |
| --- | -------------- |
| **GC log** | **Always on, including production.** Negligible cost, and the first evidence you need |
| **HTTP access log** | Keep if the business requires it; log numerically and minimally |
| **Application log** | Verbose in the code, almost nothing enabled by default |

The GC log is the clearest cost/benefit in the JVM: the overhead is unmeasurable and the diagnostic value when something goes wrong is enormous. See [garbage-collection.md](garbage-collection.md) for the flags.

Access logs do cost measurably. Where they are required, **log numerically**: IP addresses rather than resolved hostnames, epoch timestamps rather than formatted dates. Every conversion is CPU and allocation on every request, and any of it can be done in post-processing. A reverse DNS lookup per request is a network round trip on the request path.

### The guard that matters

```java
// BAD - concatenates and calls calcX()/calcY() even when FINE is disabled
log.log(Level.FINE, "Value of X is " + calcX() + " and Y is " + calcY());

// GOOD
if (log.isLoggable(Level.FINE)) {
  log.log(Level.FINE, "Value of X is {0} and Y is {1}", new Object[]{calcX(), calcY()});
}
```

The disabled call still evaluates its arguments: two method calls, a concatenation, and - in the parameterised form - an `Object[]` allocation. **Guard any log statement whose arguments involve a method call, a concatenation, or an allocation.**

With SLF4J or Log4j2, parameterised messages avoid the concatenation, but **arguments are still evaluated**:

```java
log.debug("Value of X is {} and Y is {}", calcX(), calcY());   // still calls both
log.debug("Value of X is {}", () -> expensive());              // Log4j2 supplier: not called unless enabled
```

Use a supplier or lambda form where the framework offers one; otherwise guard.

### Levels, and the INFO trap

The JDK has seven levels and enables three by default (INFO and above), which produces a specific and very common mistake: **INFO *sounds* like the level for describing normal flow.** "Now processing task A", "now calling service B" - reasonable-looking messages that, in a scalable multi-threaded application, are both a real cost and too chatty to be useful.

**Do not be afraid of FINE, FINER and FINEST.** Write plenty of logging; enable almost none of it by default. The test is whether the message would mean anything to an end user or an operator - if not, it should not be on by default.

### Fine-grained loggers

A logger per class is tedious; a logger per small module is a good compromise. The reason matters more than the granularity: **production performance problems often disappear when you turn logging on.** If your only option is "logging off" or "logging on for everything", you cannot investigate a load-sensitive problem without changing the conditions that produce it. Fine-grained loggers let you enable a handful of statements in one class and keep the system in the state you are trying to observe.

---

## Version notes

Verified by measurement on 25.0.4.1 and `-XX:+PrintFlagsFinal` on all five.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| `StackTraceInThrowable` (default `true`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `MaxJavaStackTraceDepth` (default 1024) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4-arg `Throwable` (`writableStackTrace`) | ✓ (7+) | ✓ | ✓ | ✓ | ✓ |
| Hot implicit exceptions reused without trace | ✓ | ✓ | ✓ | ✓ | ✓ |
| Helpful NullPointerException messages | ✗ | ✗ | **✓ on by default** | ✓ | ✓ |
| `jdk.ExceptionStatistics` JFR event | ✗ | ✓ | ✓ | ✓ | ✓ |
| `StackWalker` API | ✗ | ✓ | ✓ | ✓ | ✓ |

Two notes:

- **Helpful NullPointerException messages** (JEP 358) became the default in **Java 15**, so they are on for 17, 21 and 25. Building the message inspects bytecode, which adds cost - but only when an NPE is actually thrown, and it is worth it every time for the diagnosis. `-XX:-ShowCodeDetailsInExceptionMessages` disables it; do not, unless the message could leak sensitive variable names into a log.
- **`StackWalker` (9+) is the right way to inspect stacks programmatically.** It walks lazily and can stop early, so it is dramatically cheaper than `getStackTrace()`, which materialises every frame. If you have code calling `new Throwable().getStackTrace()` to find its caller - a real and surprisingly common pattern - `StackWalker` with `RETAIN_CLASS_REFERENCE` and a `limit(2)` replaces it at a fraction of the cost.

**Use JFR to find out whether you have an exception problem at all:**

```bash
jfr print --events jdk.ExceptionStatistics recording.jfr
jfr print --events jdk.JavaExceptionThrow recording.jfr | head -40
```

The throw rate is frequently a surprise - code often throws thousands of exceptions a second that nobody knew about, usually inside a library.

## Gotchas

- Agent says try/catch blocks are expensive - obsolete advice; the block is free, the stack trace is not
- Agent says throwing is inherently expensive - with no stack trace it is **0.9 ns from one frame down**, against a 1.571 ns control
- Agent says throwing is *free* because the stack trace is the only cost - **withdrawn**: with no stack trace at all it is still **506 ns at depth 10 and 2,985 ns at depth 60**, because the stack must be unwound
- Agent assumes stack-trace capture scales linearly with depth - it is **sublinear**: a 60× deeper stack costs 2.9× more to capture
- Agent optimises the throw without noticing the stack trace is the entire cost
- Agent ignores stack depth - **1,300 ns at depth 1 against 6,716 ns at depth 60**, and web application stacks are deep
- Agent logs an exception with its full trace on a hot path - measured ~24 µs to materialise a 60-frame trace
- Agent uses exceptions for ordinary control flow because "it is fast enough" - design first; the cost is never an argument in favour
- Agent catches an exception to test a condition that a cheap check would answer - `isEmpty()` before `pop()`
- Agent creates a trace-free exception for something a human must debug - there is nothing to diagnose from
- Agent benchmarks exception cost without a long warm-up - the JVM eventually reuses hot implicit exceptions with no trace
- Agent parses a stack trace programmatically - the JVM may optimise the trace away entirely under load
- Agent recommends `-XX:-StackTraceInThrowable` as a tuning - last resort; it removes diagnosability everywhere
- Agent logs at INFO to describe normal flow - that is what FINE is for; INFO is on by default
- Agent leaves an unguarded log statement whose arguments call methods or concatenate - evaluated even when disabled
- Agent assumes SLF4J parameterised logging avoids the cost - it avoids the concatenation, not the argument evaluation; use a supplier or guard
- Agent turns off the GC log to save overhead - negligible cost, and the first evidence any investigation needs
- Agent resolves hostnames or formats dates in an access log - network round trips and allocation on every request
- Agent uses `new Throwable().getStackTrace()` to find a caller - `StackWalker` on 9+ is far cheaper

## Related

- [triage.md](triage.md) · [tooling.md](tooling.md) · [garbage-collection.md](garbage-collection.md) · [methodology.md](methodology.md) · [allocation.md](allocation.md) · [server-performance.md](server-performance.md) · [flags.md](flags.md) · [java-versions.md](java-versions.md)
