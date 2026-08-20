# Exceptions and Resources

**Never do nothing in response to a caught exception, and never close a resource by hand.** Those two rules cover most of what goes wrong here.

## Never swallow an exception

```java
// ❌ the failure is now invisible, and the next reader cannot tell if that was deliberate
try {
  submit(returnDocument);
} catch (IOException e) {
}
```

Doing nothing is very rarely right. The usual responses:

| Situation | Response |
| --------- | -------- |
| Recoverable here | Handle it, and say how in the code |
| Not recoverable here | Rethrow, wrapped, **with the cause attached** |
| Genuinely impossible | `throw new AssertionError(e)` - it documents the claim and fails loudly if wrong |
| Legitimately ignorable | `catch (SomeException _)` **and a comment saying why** |

```java
// ✅ the exception is expected here, the reason is stated, and `_` makes the compiler enforce unused
try {
  return handleNumeric(Integer.parseInt(response));
} catch (NumberFormatException _) {
  // not numeric, which is a valid response shape - fall through to the text handler
}
return handleText(response);
```

`_` states "unused", never "why unused". In a `catch` block, ask first whether the exception *should* be unused at all - a swallowed exception is more often a bug than a decision. See [smaller-features.md](smaller-features.md).

## Always attach the cause

```java
// ❌ the stack trace of the real failure is gone
throw new FilingException("Could not submit " + reference);

// ✅
throw new FilingException("Could not submit " + reference, e);
```

Wrapping without the cause is the most expensive small mistake in this area: it converts a diagnosable failure into a support ticket. Include the identifier in the message, never the personal data - the same discipline as [records.md](records.md) applies to exception messages.

## Restore the interrupt flag

```java
// ✅ catching InterruptedException clears the flag; put it back or the shutdown never propagates
try {
  queue.take();
} catch (InterruptedException e) {
  Thread.currentThread().interrupt();
  throw new IllegalStateException("Interrupted while awaiting work", e);
}
```

This matters more with virtual threads, not less: cancellation is how a task tree is torn down. See [modern-apis.md](modern-apis.md).

## Validate with the right exception

The skill's records and boundary-validation rules use both of these, and the split is not arbitrary:

| Throw | For |
| ----- | --- |
| `NullPointerException`, via `Objects.requireNonNull(x, "x")` | A `null` that the contract forbids. A programmer error |
| `IllegalArgumentException` | A value that is present but outside the permitted range |
| `IllegalStateException` | The object is in the wrong state for the call, regardless of arguments |

`Objects.requireNonNull` returns its argument, so it composes inside a compact constructor or a field assignment. Do not replace it with a hand-written `if (x == null) throw`.

## try-with-resources, never try/finally

```java
// ✅ closes in reverse order, and a failure while closing is attached as suppressed
try (var connection = dataSource.getConnection();
     var statement = connection.prepareStatement(SQL)) {
  statement.setString(1, clientRef);
  return read(statement);
}
```

A hand-written `finally` block gets two things wrong that the language gets right: if the body throws **and** the close throws, `finally` loses the body's exception, while try-with-resources keeps it and attaches the close failure to `getSuppressed()`.

Implement `AutoCloseable` for anything holding a resource. Prefer it to `Closeable`, whose `close()` is restricted to `IOException`.

**A resource already in a variable does not need re-declaring:**

```java
// ✅ Java 9 and later: an effectively-final variable can be the resource
static int firstByte(Reader reader) throws IOException {
  try (reader) {
    return reader.read();
  }
}
```

## Finalizers: never

`Object.finalize()` is deprecated for removal. Overriding it is a build warning today and a compile error eventually, and it never worked well: there is no guarantee it runs, no guarantee of when, and an exception thrown inside it is discarded.

Two replacements, in order of preference:

1. **`AutoCloseable` plus try-with-resources.** Deterministic, visible in the code, and the caller controls it.
2. **`Cleaner`**, as a backstop for when a caller forgets. Not as the primary mechanism.

```java
public final class NativeBuffer implements AutoCloseable {
  private static final Cleaner CLEANER = Cleaner.create();
  private final Cleaner.Cleanable cleanable;

  public NativeBuffer(long address) {
    // the cleaning action must not capture `this`, or the object is never collectable
    this.cleanable = CLEANER.register(this, () -> release(address));
  }

  private static void release(long address) { ... }   // static, so it cannot capture `this`

  @Override
  public void close() {
    cleanable.clean();
  }
}
```

The rule that makes `Cleaner` work is the comment above: **the registered action must not reference the object being cleaned.** A lambda capturing `this` keeps the object reachable forever, so the cleaner never fires. Capture only what the action needs, which usually means a `static` method and a separate state object.

To prove nothing in a codebase depends on finalization, run the tests with finalization off:

```bash
java --finalization=disabled -jar target/app.jar
```

## Prefer a type over an exception for expected outcomes

An exception is for the exceptional. A predictable "did not find it" or "failed validation" is data, and modelling it as data lets the compiler check every caller handled it:

| Outcome | Model as |
| ------- | -------- |
| Might not be there | `Optional`, per [optional-and-null.md](optional-and-null.md) |
| Succeeded or failed, with detail on failure | A **sealed interface** with `record` alternatives, per [sealed-types.md](sealed-types.md) |
| Truly unexpected, or unrecoverable here | An exception |

Do not build a general-purpose `Result<T, E>` type to avoid checked exceptions wholesale. A sealed result for one specific operation, switched over exhaustively, is the version that pays for itself.

## Version notes

Nothing on this page is new syntax, and most of it works on Java 8. The two measured floors:

| Idiom | Since | How established |
| ----- | ----- | --------------- |
| try-with-resources, declaring the resource in the parentheses | 7 | Language |
| **try-with-resources over an effectively-final variable**, `try (reader) {` | **9** | Measured: `--release 8` gives `variables in try-with-resources are not supported in -source 8` |
| **`java.lang.ref.Cleaner`** | **9** | Measured: `cannot find symbol` at `--release 8`, compiles at 9 |
| `Objects.requireNonNull(x, message)` | 7 | Language library |
| `UncheckedIOException`, for wrapping in a lambda | 8 | Library |
| **`Object.finalize()` deprecated for removal** | **18** | Measured: `-Xlint:all` gives zero `[removal]` warnings at `--release 17` and two at `--release 18` |
| `--finalization=disabled` | 18 | Verified accepted on 21 and 25; an invalid value is rejected, so the flag is parsed |
| `_` as a `catch` parameter | 22 | See [smaller-features.md](smaller-features.md) |
| Sealed result types | 17 to declare, **21** to switch over exhaustively | [sealed-types.md](sealed-types.md) |

On Java 8 to 17 the `finalize` override compiles without a removal warning, which is why it survives in old code. It is still wrong there: the replacement advice is unchanged all the way back to 9, where `Cleaner` arrives. Before 9, `AutoCloseable` alone.

On Java 8 to 21, write `catch (IOException ignored)` where this page writes `_`.

## Gotchas

- Agent writes an empty `catch` block - the one thing this page forbids outright. Even "cannot happen" gets `throw new AssertionError(e)`
- Agent wraps an exception and drops the cause - `new XException(message)` instead of `new XException(message, e)`. The original stack trace is then gone
- Agent catches `Exception` or `Throwable` to be safe - that swallows `InterruptedException` and programming errors along with the intended one
- Agent catches `InterruptedException` without calling `Thread.currentThread().interrupt()` - the flag is cleared on catch, so cancellation stops propagating
- Agent hand-writes try/finally to close a resource - if both the body and the close throw, the body's exception is lost. try-with-resources keeps it as suppressed
- Agent declares a new variable in the try-with-resources header for a resource it was handed - `try (reader)` works from Java 9
- Agent registers a `Cleaner` action that captures `this` - the object stays reachable and the cleaner never runs. Capture only the state the action needs
- Agent reaches for `Cleaner` as the primary close mechanism - it is a backstop behind `AutoCloseable`, not a replacement for it
- Agent overrides `finalize()` and sees no warning on a Java 17 project - the removal warning starts at 18. It is still wrong at 17
- Agent puts a client reference, NINO or account number into an exception message - the same leak as a record's `toString()`, and exception messages reach logs faster
- Agent builds a generic `Result<T, E>` to avoid checked exceptions across a codebase - a sealed result per operation is the version that earns its keep
- Agent uses exceptions for an expected "not found" - that is `Optional`

## Related

- [optional-and-null.md](optional-and-null.md) · [nullness.md](nullness.md) · [sealed-types.md](sealed-types.md) - modelling failure as data
- [smaller-features.md](smaller-features.md) - `_` for a deliberately unused catch parameter
- [modern-apis.md](modern-apis.md) - arenas, cancellation and virtual threads
- [enforcement.md](enforcement.md) - `-Xlint:removal`, `-Xlint:try`, `-Xlint:finally`
