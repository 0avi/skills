# Best Practices Checklist

Use this for a review pass over existing code. Each rule links to the reference that explains when it does not apply.

## Versions

| # | Rule | Reference |
| - | ---- | --------- |
| 1 | Target the newest LTS. Do not leave a project stuck on 11, 17 or 21. Java 8 gets a hall pass. | [java-versions.md](java-versions.md) |
| 2 | Migrate with OpenRewrite, then review the diff. | [java-versions.md](java-versions.md) |

## Smaller features

| # | Rule | Reference |
| - | ---- | --------- |
| 3 | Know new features; adopt only on merit. New ≠ better for this codebase. | [smaller-features.md](smaller-features.md) |
| 4 | Adopt text blocks. Never interpolate into SQL, HTML or shell - parameterise. | [smaller-features.md](smaller-features.md) |
| 5 | Use `_` for deliberately unused variables, and still say why. | [smaller-features.md](smaller-features.md) |
| 6 | **Avoid module import declarations** in application code. | [smaller-features.md](smaller-features.md) |
| 7 | Markdown doc comments (`///`) for new code; convert existing opportunistically, never en masse. | [smaller-features.md](smaller-features.md) |

## Modules

| # | Rule | Reference |
| - | ---- | --------- |
| 8 | **Do not modularise application code.** Boundaries are only enforced on the module path. Use build modules or ArchUnit. | [modules.md](modules.md) |

## Immutability

| # | Rule | Reference |
| - | ---- | --------- |
| 9 | Favour immutability. `final` classes and fields; mutability confined to one source file; mutable variables named `mutableXxx`. | [immutability.md](immutability.md) |
| 10 | No mutable collection, array or bean inside an immutable object. | [immutability.md](immutability.md) |
| 11 | Never depend on `Set.of` / `Map.of` iteration order - it is randomised per JVM run. | [immutable-collections.md](immutable-collections.md) |
| 12 | Prefer composition over inheritance; sealed interface for constrained choices. | [immutability.md](immutability.md) |

## Optional

| # | Rule | Reference |
| - | ---- | --------- |
| 13 | `Optional` on public return types. Never a parameter type; never a field type. | [optional-and-null.md](optional-and-null.md) |
| 14 | Avoid `isPresent()` / `isEmpty()` - use `map`, `flatMap`, `filter`, `or`, `orElse`, `orElseThrow`, `stream`. | [optional-and-null.md](optional-and-null.md) |
| 15 | Keep `Optional` for return types when null-restricted types (`String?` / `String!`) arrive - complementary, not a replacement. | [optional-and-null.md](optional-and-null.md) |

## var

| # | Rule | Reference |
| - | ---- | --------- |
| 16 | Use `var` - go all in. Name the data, not the type; suffix `Optional` locals `Opt`. | [var.md](var.md) |

## Switch and patterns

| # | Rule | Reference |
| - | ---- | --------- |
| 17 | Always prefer the arrow **expression** form. Ignore both label forms. In a statement switch you own exhaustiveness. | [switch.md](switch.md) |
| 18 | Replace every `instanceof` + cast with a type pattern, including in `equals`. | [patterns.md](patterns.md) |
| 19 | Use `var` inside record patterns for components taken as declared, so explicit types mark narrowing - and null exclusion. | [record-patterns.md](record-patterns.md) |

## Records and sealed types

| # | Rule | Reference |
| - | ---- | --------- |
| 20 | Validate in the compact constructor; no array or mutable components; basic types; check `toString()` for sensitive data. Decide per system which side of the bean/record cliff edge you are on. | [records.md](records.md) · [beans-vs-records.md](beans-vs-records.md) |
| 21 | **Generate beans** - Immutables or Joda-Beans. Never hand-write or IDE-paste `equals` / `hashCode` / `toString`. **Avoid Lombok**: it rewrites the compiler AST rather than generating source. | [beans-vs-records.md](beans-vs-records.md) |
| 22 | Constrained choices → sealed interface at the root, `final` records as alternatives, no `default` in the switch. Avoid `non-sealed`. | [sealed-types.md](sealed-types.md) |

## Carried over from Java 8

Use `java.time`. Never `Date` or `Calendar`.

---

## Top three tips

1. **Learn patterns and pattern matching properly** - the test/extract/bind fusion, arbitrary nesting, and the `null` interaction. Not just the two syntax forms.
2. **Use `Optional` like `Stream`.** If `isPresent()` / `isEmpty()` are the only methods called, the feature has been missed.
3. **Keep up with the latest version of Java.**

Records express **AND**, sealed types **OR**, patterns **operate**, enums **validate**. Together that is data-oriented programming - a whole-system commitment, not a local refactor. See [data-oriented-programming.md](data-oriented-programming.md).

---

## Version notes

Rules 1 and 2 apply on every release. **The rest are gated**, and applying one below its floor produces code that does not compile:

| Rules | Need at least |
| ----- | ------------- |
| 9, 10, 12 (immutability, composition), and the carried-over `java.time` rule | 8 |
| 11 (`Set.of` / `Map.of` ordering) | 9 |
| 13, 14 (`Optional` API beyond the Java 8 core) | 9, and 10 for `orElseThrow()` |
| 16 (`var`) | 10 |
| 4 (text blocks) | 15 |
| 18 (`instanceof` type patterns), 20 (records) | 16 |
| 22 (sealed types) | 17 |
| 17 (arrow `switch`) | 14 for the form, **21** for pattern cases |
| 19 (record patterns) | 21 |
| 5 (`_`) | 22 |
| 7 (Markdown doc comments) | 23 |
| 3, 6 (module import declarations) | 25 |

The full verified table, including the API-level floors that catch people out, is in [java-versions.md](java-versions.md). Establish the project's release before running a review pass with this list, or half the findings will be unactionable.

## Gotchas

- Agent reviews against this list without establishing the Java release first - most rules are gated, and the finding "use a record here" is noise on a Java 11 project
- Agent reports every deviation as a defect - each rule links to the reference that states when it does not apply. Read that before filing
- Agent treats the list as a generation checklist - it is written for a review pass over existing code
- Agent flags a mutable accumulator inside one method - confined mutability is explicitly allowed, and the `mutableXxx` naming is the tell that it was deliberate
- Agent flags Lombok in a Lombok codebase and rewrites files piecemeal - raise it, match the surrounding code, and keep removal as its own change
- Agent counts 22 rules as 22 separate commits - several are one design decision, and the records-versus-beans choice (20, 21) is a system-level one

## Related

- [java-versions.md](java-versions.md) · [data-oriented-programming.md](data-oriented-programming.md) · [records.md](records.md) · [beans-vs-records.md](beans-vs-records.md) · [optional-and-null.md](optional-and-null.md) · [switch.md](switch.md)
