# Patterns and Pattern Matching

**Replace every `instanceof` + cast + assign with a type pattern.** This is unambiguously good and worth a dedicated pass over an existing codebase.

```java
// ❌
if (obj instanceof JsonObject) {
  JsonObject json = (JsonObject) obj;
  process(json);
}

// ✅
if (obj instanceof JsonObject json) {
  process(json);
}
```

## What a pattern is - learn this, not just the syntax

A pattern **fuses three operations**: test, extract, bind. Every pattern does all three (binding is optional). This matters because it is what lets patterns nest and compose; treating `Person p` as mere shorthand means missing what record patterns are for.

Patterns appear in two places, and neither spelling advertises that a *pattern* follows:

```java
obj instanceof Person p                    // `Person p` is a pattern
switch (obj) { case Person p -> ... }      // `Person p` is a pattern
```

Three pattern kinds exist in Java 25: **type**, **record** ([record-patterns.md](record-patterns.md)), and **match-all**.

## Type patterns

The binding is scoped to where the match is proven, so both of these compile:

```java
if (value instanceof String str && !str.isBlank()) {
  return str.trim();
}
```

```java
if (!(value instanceof String str)) {
  return "";
}
return str.trim();   // in scope - the early return proved the match
```

## The `equals` idiom

Use this shape for any hand-written `equals`:

```java
// ❌ the old shape
@Override
public boolean equals(Object obj) {
  if (obj instanceof Client) {
    Client other = (Client) obj;
    return reference.equals(other.reference) && yearEnd.equals(other.yearEnd);
  }
  return false;
}

// ✅ instanceof is a boolean expression, so the `if` disappears too
@Override
public boolean equals(Object obj) {
  return obj instanceof Client other
      && reference.equals(other.reference)
      && yearEnd.equals(other.yearEnd);
}
```

Better still, don't hand-write `equals` - use a record or generate the bean. See [beans-vs-records.md](beans-vs-records.md).

## Prefer a pattern switch over an `instanceof` chain

```java
// ❌
if (payment instanceof CardPayment) {
  CardPayment c = (CardPayment) payment;
  return c.last4();
} else if (payment instanceof BankTransfer) {
  BankTransfer b = (BankTransfer) payment;
  return b.sortCode();
}
throw new IllegalStateException();

// ✅ with a sealed type, no default and no throw - the compiler proves completeness
return switch (payment) {
  case CardPayment c  -> c.last4();
  case BankTransfer b -> b.sortCode();
};
```

## Match-all pattern - Java 22+

Use `_` for anything you do not need, so the compiler enforces that you do not use it.

```java
if (person instanceof Person(_, Address(_, var city))) {
  return city;
}
```

**Requires Java 22** (preview in 21). On Java 21 write `var ignoredName` instead - a bare `_` is a compile error, and so is omitting the component entirely. Record patterns must name every component.

`case _ ->` works as a switch catch-all - but over a **sealed type prefer omitting it**, so future alternatives become compile errors rather than being silently swallowed.

## Do not write speculative code

Patterns are expected to gain new kinds (array, user-defined deconstruction) and new positions (local variable declarations, `for`-each over `Map.Entry`, `catch`). **None of this exists today.** Do not generate it; understanding that patterns are a general mechanism is enough to absorb each addition later.

## Version notes

The three pattern kinds arrived across three releases, so "use patterns" means different things on different projects:

| Pattern kind and position | Since |
| ------------------------- | ----- |
| Type pattern in `instanceof`, including the `equals` idiom | 16 |
| Type pattern in a `switch` case, and `when` guards | 21 |
| Record pattern, at any nesting depth | 21 |
| Match-all `_` | 22 |

The `instanceof` pass this page recommends is therefore available from **16**, which makes it the cheapest modernisation on a 17 project. The switch rewrite is not: it needs 21. On Java 8 to 15 neither exists and `instanceof` + cast is the only option.

## Gotchas

- Agent converts an `instanceof` chain to a pattern switch on a Java 17 project - the `instanceof` half is fine at 16, the switch half needs 21
- Agent expects a top-level type pattern to match `null` - it never does. Nested inside a record pattern it can; see [record-patterns.md](record-patterns.md)
- Agent uses a pattern binding outside the branch where the match is proven - the binding's scope is exactly where it is definitely matched, so `!(x instanceof T t)` followed by an early return keeps `t` in scope afterwards but `||` does not
- Agent writes `if (o instanceof String s || s.isEmpty())` - `s` is not in scope in the right operand of `||`
- Agent generates a pattern for a generic type, as in `o instanceof List<String> l` - rejected unless the cast is provably safe; use `List<?>`
- Agent keeps a redundant cast inside the pattern branch after binding
- Agent uses `case _ ->` as a catch-all over a sealed type - that silently swallows future alternatives. Omit it instead
- Agent generates array patterns, deconstruction patterns for ordinary classes, or patterns in `catch` - none of these exist in Java 25
- Agent hand-writes `equals` at all - prefer a record or a generated bean, per [beans-vs-records.md](beans-vs-records.md)

## Related

- [record-patterns.md](record-patterns.md) · [switch.md](switch.md) · [sealed-types.md](sealed-types.md)
