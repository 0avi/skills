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

## Version notes

The principle is version-agnostic and applies from Java 8. The tools this page reaches for are not:

| Tool used above | Since |
| --------------- | ----- |
| `final` classes and fields, `java.time` | 8 |
| `List.copyOf` / `Set.copyOf` / `Map.copyOf` | 10 |
| `var` in the worked example | 10 |
| Records as the immutable carrier | 16 |
| Sealed interface for a constrained choice | 17 |

**Java 8 is where this page matters most and has the fewest tools.** There, use `Collections.unmodifiableList(new ArrayList<>(input))` for the defensive copy, keep the `final` discipline, and model constrained choices with a documented interface. That work is exactly what makes a later move to records and sealed types mechanical, as [java-versions.md](java-versions.md) argues.

## Gotchas

- Agent marks a field `final` and calls the class immutable - `final` stops the reference changing, not the object. A `final List` field is still mutable through its own methods
- Agent assigns the constructor argument directly, then returns the field from the accessor - the caller holds a live reference at both ends
- Agent uses `Collections.unmodifiableList` as the defensive copy - it wraps a live list. `copyOf` snapshots; the wrapper does not
- Agent defensively copies on the way in but hands the internal collection straight out of the accessor
- Agent copies a collection of mutable elements - the collection is frozen, the elements are not. Immutability has to go all the way down
- Agent names a mutable accumulator `total` rather than `mutableTotal` - the naming rule is what makes the mutation visible in review
- Agent introduces an immutable superclass and subclasses it - a subclass can add mutable state and `equals` becomes unfixable. Compose, or seal
- Agent keeps a `Date`, `Calendar` or `StringBuilder` field in an otherwise immutable type
- Agent makes an entity immutable because this page says to - long-lived accumulators and framework-owned entities are the documented exception. Keep them few, small and private
- Agent adds `List.copyOf` on a collection that may contain `null` - it throws `NullPointerException`. See [immutable-collections.md](immutable-collections.md)

## Related

- [immutable-collections.md](immutable-collections.md) · [records.md](records.md) · [data-oriented-programming.md](data-oriented-programming.md)
