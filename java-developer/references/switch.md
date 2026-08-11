# Switch

**Always prefer the arrow expression form.** It cannot fall through, and the compiler enforces exhaustiveness for you.

```java
// ✅ no fall-through, exhaustiveness compiler-checked
var reviewTier = switch (payment) {
  case CardPayment c   -> Tier.STANDARD;
  case BankTransfer b  -> Tier.ENHANCED;
};   // no default needed - Payment is sealed, so this is provably complete
```

Prefer it even when the need looks like a statement: assign the result and act on it afterwards rather than switching on side effects.

## Which form is which

Two axes - **label** (`case X:`) vs **arrow** (`case X ->`), and **statement** vs **expression**:

| Form | Falls through? | Exhaustive? | Verdict |
| ---- | -------------- | ----------- | ------- |
| Label statement | **Yes** | Only if it contains `case null` or a pattern | Ignore - legacy |
| Label expression (`yield`) | **Yes** | Yes | Ignore - no reason to exist |
| Arrow statement | No | Only if it contains `case null` or a pattern | Acceptable; you own exhaustiveness |
| Arrow expression | No | **Yes, always** | **Use this** |

That conditional exhaustiveness is why there are effectively six kinds of `switch`, not four.

**Ignore both label forms.** Fall-through is not wanted in essentially any business logic - it is only a way to be wrong:

```java
// ❌ MONDAY runs openLedger() AND THEN runPayroll()
switch (day) {
  case MONDAY:
    openLedger();
    // missing break
  case TUESDAY:
    runPayroll();
    break;
}
```

## In a statement switch, you own exhaustiveness

The compiler will not help unless a pattern or `case null` is present - an unmatched value silently falls out of the bottom and does nothing.

```java
// ❌ Tuesday..Sunday do nothing, with no warning
switch (day) {
  case MONDAY -> openLedger();
}

// ✅ every alternative covered, and "do nothing" says so explicitly
switch (day) {
  case MONDAY  -> openLedger();
  case TUESDAY -> runPayroll();
  case WEDNESDAY, THURSDAY, FRIDAY -> reconcile();
  case SATURDAY, SUNDAY -> {}   // deliberate
  // no default: enum coverage is complete, so a new constant becomes a compile error
}
```

Add a `default` only to fail loudly, never to silently absorb cases.

## `case null`

A `switch` on a reference throws `NullPointerException` unless `case null` is present. **Prefer removing the possibility of `null` upstream** - validate at the boundary and return `Optional`.

```java
// Acceptable when null genuinely arrives from outside your control
var label = switch (status) {
  case null   -> "Unknown";
  case ACTIVE -> "Active";
  case CLOSED -> "Closed";
};

// Better
var label = switch (requireNonNull(status, "status")) { ... };
```

`case null, default ->` routes `null` into the default branch.

## Guards

The first matching label wins, so order specific cases first:

```java
var band = switch (income) {
  case BigDecimal i when i.compareTo(BASIC_LIMIT) <= 0  -> Band.BASIC;
  case BigDecimal i when i.compareTo(HIGHER_LIMIT) <= 0 -> Band.HIGHER;
  case BigDecimal i                                     -> Band.ADDITIONAL;
};
```

## Version notes

The six kinds of `switch` did not arrive together. **The form this page tells you to prefer is Java 14; the pattern cases that make it interesting are Java 21.**

| Feature | Since |
| ------- | ----- |
| Arrow form, statement and expression, and `yield` | 14 |
| `case CardPayment c ->` type patterns in a switch | 21 |
| `when` guards | 21 |
| `case null`, and `case null, default` | 21 |
| Record patterns in a `case` | 21 |
| `MatchException` when a recompiled sealed hierarchy gains a subtype | 21 |

On Java 14 to 20, `switch (payment) { case CardPayment c -> ... }` does not compile: switch over types needs 21. Use an `instanceof` chain there, or a `switch` over an enum discriminator. On Java 8 to 13 there is no arrow form at all, so the label statement form this page tells you to ignore is the only one available, and `break` discipline matters again.

## Gotchas

- Agent generates a pattern switch on a Java 17 project - `case Type t ->` is 21. Arrow form alone is 14
- Agent writes a statement switch missing enum constants and assumes the compiler will object - **it compiles silently** and the unmatched values do nothing. Only the expression form is checked
- Agent adds `default -> throw new IllegalStateException()` to a switch over a sealed type - that converts a future compile error into a runtime one. Omit it
- Agent orders guarded cases loosest-first - the first match wins, so the loose case swallows the rest
- Agent adds `case null` reflexively - fix the `null` upstream instead; the case is for values genuinely outside your control
- Agent forgets that a switch on a reference throws `NullPointerException` without `case null`, and wraps the whole switch in a try/catch
- Agent mixes `case A:` and `case A ->` in one switch - rejected, the forms cannot be combined
- Agent uses a guard where a nested record pattern would discriminate structurally - see [record-patterns.md](record-patterns.md)
- Agent assumes exhaustiveness over an enum needs `default` - it does not, and adding one means a new constant stops being a compile error

## Related

- [patterns.md](patterns.md) · [sealed-types.md](sealed-types.md) - sealing is what removes the need for `default`
