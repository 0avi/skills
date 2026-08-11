# Sealed Types

**Where data has a constrained set of alternatives you own, use a sealed hierarchy.** A record expresses **AND**; a sealed type expresses **OR**.

Use the simple shape - **sealed interface at the root, `final` records as the alternatives**:

```java
public sealed interface Address permits StreetAddress, MilitaryAddress {}

public record StreetAddress(String line, String city, String postcode) implements Address {}
public record MilitaryAddress(String unit, String bfpo) implements Address {}
```

## Why: it unlocks exhaustiveness

Sealing tells the compiler the subtype list is complete, and the compiler gives that back as exhaustiveness checking.

```java
// ✅ no default, no throw - the compiler proves completeness
var formatted = switch (address) {
  case StreetAddress(var line, var city, var postcode) -> line + ", " + city + " " + postcode;
  case MilitaryAddress(var unit, var bfpo)             -> unit + ", BFPO " + bfpo;
};
```

**Omit `default`** so that adding an alternative breaks every switch until it is handled. In an open hierarchy a new subtype silently falls into someone's `default` and ships.

Nesting extends this to combined shapes:

```java
record Person(String name, Address address) {}

var label = switch (person) {
  case Person(var name, StreetAddress(var line, _, _)) -> name + " at " + line;
  case Person(var name, MilitaryAddress(var unit, _))  -> name + " with " + unit;
};   // exhaustive
```

(`_` requires Java 22; on 21 name the unused components `var ignoredCity` etc.)

## When to use one

| Use a sealed hierarchy | Do not |
| ---------------------- | ------ |
| Payment method: card, transfer, direct debit | An extension point for third-party implementations - use an ordinary interface |
| Result: success or failure | An open-ended set you expect to keep growing from outside |
| Filing status with per-status data | A plain closed set of constants with no data - use an **enum** |
| Expression nodes in a parser or rules engine | |

**Strong signal to refactor:** a "type" discriminator field plus a set of nullable fields only meaningful for certain types. That is a sealed hierarchy waiting to be extracted.

## Keep it simple

Avoid until something concretely demands it:

- **`non-sealed`** - re-opens a branch and destroys exhaustiveness for it.
- **Sealed abstract classes** - drag in inherited state, conflicting with records as alternatives.
- **Multi-level sealing** - legal, occasionally right, but harder to read. Flatten where you can.

## Mechanics

- Permitted subtypes must be in the same **module** (or same **package** in an unnamed module). Sealing does not cross module boundaries.
- `permits` may be omitted when all subtypes are in the same source file - tidy for small hierarchies:

  ```java
  public sealed interface Address {
    record StreetAddress(String line, String city) implements Address {}
    record MilitaryAddress(String unit, String bfpo) implements Address {}
  }
  ```

- Every permitted subtype must be `final`, `sealed`, or `non-sealed` - the compiler forces the choice.
- If the hierarchy is recompiled separately and gains a subtype, an old switch throws `MatchException` rather than silently misbehaving.

## Version notes

Sealed types are **Java 17**, but the payoff described above arrives in stages, and the exhaustive switch that justifies sealing is Java 21:

| Feature | Since |
| ------- | ----- |
| `sealed`, `permits`, `non-sealed` | 17 |
| Records as the alternatives | 16, so available wherever sealing is |
| Exhaustive `switch` over the hierarchy with no `default` | **21** |
| `MatchException` when a separately recompiled hierarchy gains a subtype | 21 |
| `_` for components a pattern does not need | 22 |

**On Java 17 to 20 you can seal but you cannot switch over it.** Sealing still buys the closed subtype list and the compiler's modifier enforcement, but the type-pattern switch shown above needs 21, so pair sealing with an `instanceof` chain until then. Below 17 there is no sealing: use an ordinary interface, document the intended alternatives, and keep the `default` branch that throws.

## Gotchas

- Agent seals a hierarchy on Java 17 and then generates the exhaustive `switch` from this page - the switch needs 21 and will not compile
- Agent writes a permitted subtype with no modifier - rejected. Every permitted subtype must be `final`, `sealed`, or `non-sealed`, and the compiler forces the choice
- Agent adds `default -> throw ...` to the switch anyway - that discards the whole benefit. A new alternative should break the build
- Agent reaches for `non-sealed` to make one branch extensible - that branch loses exhaustiveness permanently. If callers outside need to implement it, an ordinary interface was the right model
- Agent puts permitted subtypes in another module - sealing does not cross module boundaries, and in an unnamed module they must share a package
- Agent seals a closed set of constants with no per-alternative data - that is an `enum`
- Agent seals a hierarchy a framework proxies or deserialises into - proxying a final record alternative is not possible, so check the framework first
- Agent builds a deep multi-level sealed hierarchy - legal, and much harder to read than a flat one. Flatten unless a level is carrying its weight
- Agent omits `permits` when the subtypes are in separate files - `permits` may only be omitted when every subtype is in the same source file

## Related

- [records.md](records.md) · [switch.md](switch.md) · [patterns.md](patterns.md) · [data-oriented-programming.md](data-oriented-programming.md)
