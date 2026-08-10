# Record Patterns

A record pattern tests, extracts and binds a record's components in one step.

```java
record Person(String name, Number age) {}

if (obj instanceof Person(String name, Number age)) { ... }
```

The `String name` and `Number age` parts are **separate patterns nested inside** the record pattern — not syntax belonging to it.

## Patterns nest arbitrarily

A component pattern can be any pattern, including another record pattern, to any depth.

```java
record Address(String line, String city) {}
record Person(String name, Address address) {}

// two levels down in one pattern
if (obj instanceof Person(var name, Address(var line, var city))) { ... }

// combine with match-all when only part matters (`_` requires Java 22)
if (obj instanceof Person(_, Address(_, var city))) {
  return city;
}
```

Every component must be named by a pattern — you cannot omit one. On **Java 21**, where `_` is only a preview feature, use `var ignoredName`.

```java
// in a switch, nesting discriminates on combined shape
var label = switch (person) {
  case Person(var name, StreetAddress(var line, var city))   -> name + " — " + line + ", " + city;
  case Person(var name, MilitaryAddress(var unit, var bfpo)) -> name + " — " + unit + " " + bfpo;
};
```

## Use `var` for components taken as declared

**Use `var` for every component you accept as declared; use an explicit type only where you are genuinely narrowing.** The explicit types then mark exactly where a runtime test happens — and therefore where `null` is excluded.

```java
// ❌ which of these narrow? You must go and read the record declaration
case Person(String name, Number age)  -> ...
case Person(String name, Integer age) -> ...

// ✅ intent visible without leaving the line
case Person(var name, var age)     -> ...   // both as declared; both may be null
case Person(var name, Integer age) -> ...   // narrowing age; age cannot be null
```

This is the most contested rule in this skill. The argument for it: component *types* were never the interesting information — **which components are narrowed** is. Apply whichever convention a codebase has picked consistently; never mix `var` and redundant explicit types in one pattern.

## The null rule

A top-level type pattern never matches `null`. **A type pattern nested inside a record pattern can.**

> A component pattern whose type **is the declared component type or a supertype** is unconditional — no runtime test is generated, so `null` passes through. A component pattern with a **narrower** type performs a dynamic test, which `null` fails.

```java
record Person(String name, Number age) {}

case Person(var name, Integer age) -> ...   // Integer is narrower → age CANNOT be null
case Person(var name, var age)     -> ...   // as declared → age MAY be null
                                            // name is `String` as declared → MAY be null in both
```

Guard where absence is unacceptable:

```java
var summary = switch (person) {
  case Person(var name, var age) when name != null && age != null -> name + " (" + age + ")";
  case Person(var name, _) -> Objects.requireNonNullElse(name, "Unnamed");
};
```

**The better fix is upstream** — validate in the record's compact constructor so a `Person` with a `null` name cannot exist. See [records.md](records.md).

## Records must be well-behaved to destructure

Record patterns call the accessors, so:

- **Never use an array component** in a record you destructure — you bind an aliased mutable reference.
- **Never override an accessor** to return something derived or lazily computed. A pattern is expected to be a faithful deconstruction; an accessor that lies makes the pattern lie.

## Related

- [patterns.md](patterns.md) · [records.md](records.md) · [var.md](var.md) · [switch.md](switch.md)
