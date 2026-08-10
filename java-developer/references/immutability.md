# Immutability

**Favour immutability by default.** It is the precondition for records, sealed types and pattern matching, so treat it as the first design decision rather than a later refinement.

- Make classes `final` unless explicitly designed for extension.
- Make fields `final`.
- Confine any genuine mutability to a **single source file** - never let a mutable object escape the file that owns it.
- Name mutable locals, parameters and fields `mutableXxx`, so mutability looks unusual in review.

```java
public final class TradeSummary {
  private final List<Trade> trades;

  public TradeSummary(List<Trade> trades) {
    this.trades = List.copyOf(trades);   // caller's list cannot reach in
  }

  public Money total() {
    var mutableTotal = Money.ZERO;       // confined to this method, and named to say so
    for (var trade : trades) {
      mutableTotal = mutableTotal.plus(trade.amount());
    }
    return mutableTotal;
  }
}
```

## Eliminate these backdoors

An immutable object holding a mutable thing is **not** immutable, and is worse than honest mutability because callers assume otherwise.

| Backdoor | Fix |
| -------- | --- |
| Mutable collection field | `List.copyOf` / `Set.copyOf` / `Map.copyOf` in the constructor |
| **Array field** | Arrays cannot be made immutable - use an immutable `List` or a purpose-built type |
| Mutable bean field | Store a record or an immutable value instead |
| `Date`, `Calendar`, `StringBuilder` | `java.time`, `String` |

```java
// ❌ caller keeps a live reference, and so does every getter caller
this.holdings = holdings;
public List<String> holdings() { return holdings; }

// ✅ immutable snapshot in, already-immutable value out
this.holdings = List.copyOf(holdings);
public List<String> holdings() { return holdings; }
```

Use `copyOf`, not `Collections.unmodifiableList` - the latter wraps a live collection rather than copying it. See [immutable-collections.md](immutable-collections.md).

## Prefer composition over inheritance

Immutable classes must not form inheritance hierarchies - a subclass can add mutable state, and `equals` becomes unfixable.

- Model "has a" with a field.
- Model a constrained set of alternatives with a **sealed interface**, not an open superclass. See [sealed-types.md](sealed-types.md).
- Mark implementation classes `final`.

```java
// ✅ composition
public record Invoice(Customer customer, List<InvoiceLine> lines) {}

// ✅ constrained choice
public sealed interface Payment permits CardPayment, BankTransfer {}
```

## Where to apply it

| Kind of type | Rule |
| ------------ | ---- |
| Domain values - money, dates, identifiers, addresses | Always immutable |
| Data crossing a boundary - payloads, messages, rows | Always immutable; model as records |
| Configuration | Immutable; read once at startup |
| Long-lived accumulators and coordinators | Mutability acceptable - keep few, keep small, keep private |

## Related

- [immutable-collections.md](immutable-collections.md) · [records.md](records.md) · [data-oriented-programming.md](data-oriented-programming.md)
