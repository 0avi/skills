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

## Related

- [record-patterns.md](record-patterns.md) · [switch.md](switch.md) · [sealed-types.md](sealed-types.md)
