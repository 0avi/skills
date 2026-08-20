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
| 6 | **Avoid module import declarations** in application code, and no wildcard imports either. | [smaller-features.md](smaller-features.md) |
| 7 | Markdown doc comments (`///`) for new code; convert existing opportunistically, never en masse. | [javadoc.md](javadoc.md) |

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

## Nullness

| # | Rule | Reference |
| - | ---- | --------- |
| 23 | `@NullMarked` once per package, then `@Nullable` only on the exceptions. Placement is type-use: `String @Nullable []` is a nullable array, `@Nullable String[]` is nullable elements. | [nullness.md](nullness.md) |
| 24 | **An unchecked `@Nullable` is a comment.** javac never reads it - wire up NullAway or claim nothing. | [nullness.md](nullness.md) · [enforcement.md](enforcement.md) |

## Exceptions and resources

| # | Rule | Reference |
| - | ---- | --------- |
| 25 | Never swallow an exception. Always attach the cause when wrapping. Restore the interrupt flag after `InterruptedException`. | [exceptions-and-resources.md](exceptions-and-resources.md) |
| 26 | try-with-resources, never try/finally - `finally` loses the body's exception when the close also throws. `AutoCloseable` for anything holding a resource. | [exceptions-and-resources.md](exceptions-and-resources.md) |
| 27 | **Never override `finalize()`.** `AutoCloseable` first, `Cleaner` as a backstop, and its action must not capture `this`. | [exceptions-and-resources.md](exceptions-and-resources.md) |

## Javadoc

| # | Rule | Reference |
| - | ---- | --------- |
| 28 | Javadoc on every visible class, member and record component. Summary is a fragment, not "This method returns". `{@return x}` instead of a bare `@return`. Components documented as `@param` on the record. | [javadoc.md](javadoc.md) |
| 29 | `{@snippet}` instead of `<pre>{@code}`, and file-based where the build can compile it. | [javadoc.md](javadoc.md) |

## Enforcement

| # | Rule | Reference |
| - | ---- | --------- |
| 30 | `-Xlint:all -Werror`. javac is nearly silent by default, and `restricted`, `this-escape` and `text-blocks` are all off. | [enforcement.md](enforcement.md) |
| 31 | Adopt a formatter (google-java-format via Spotless) and reformat in **one commit of its own**. That retires every layout question. | [enforcement.md](enforcement.md) |
| 32 | Run Error Prone. `StatementSwitchToExpressionSwitch`, `PatternMatchingInstanceof` and `MissingOverride` mechanise rules 17, 18 and the one javac cannot check. | [enforcement.md](enforcement.md) |

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

Rules 1, 2 and 30 to 32 apply on every release. **Most of the rest are gated**, and applying one below its floor produces code that does not compile:

| Rules | Need at least |
| ----- | ------------- |
| 9, 10, 12 (immutability, composition), 25 (exceptions), 28 (Javadoc coverage), and the carried-over `java.time` rule | 8 |
| 23 (the JSpecify annotations themselves, as type-use annotations) | 8 |
| 11 (`Set.of` / `Map.of` ordering), 26 (`try (resource)` over an effectively-final variable), 27 (`Cleaner`) | 9 |
| 13, 14 (`Optional` API beyond the Java 8 core) | 9, and 10 for `orElseThrow()` |
| 16 (`var`) | 10 |
| 4 (text blocks) | 15 |
| 18 (`instanceof` type patterns), 20 (records) | 16 |
| 22 (sealed types) | 17 |
| 17 (arrow `switch`) | 14 for the form, **21** for pattern cases |
| 19 (record patterns) | 21 |
| 5 (`_`) | 22 |
| 3, 6 (module import declarations) | 25 |

Three rules are gated by something other than `--release`, which is what makes them easy to get wrong:

| Rule | Actually gated by |
| ---- | ----------------- |
| 24 (NullAway checking anything) | The **JDK running the build**: 22+, or 21.0.8+ / 17.0.19+ on an OpenJDK build with `-XDaddTypeAnnotationsToSymbol=true` |
| 7, 28, 29 (`///`, `{@return}`, `{@snippet}`) | The **javadoc tool version** - 23, 16 and 18 respectively. `--release` does not gate them |
| 30 (which `-Xlint` keys exist) | The **javac version**. `restricted` and `identity` are absent on 21, present on 25 |

The full verified table, including the API-level floors that catch people out, is in [java-versions.md](java-versions.md). Establish the project's release before running a review pass with this list, or half the findings will be unactionable.

## Gotchas

- Agent reviews against this list without establishing the Java release first - most rules are gated, and the finding "use a record here" is noise on a Java 11 project
- Agent reports every deviation as a defect - each rule links to the reference that states when it does not apply. Read that before filing
- Agent treats the list as a generation checklist - it is written for a review pass over existing code
- Agent flags a mutable accumulator inside one method - confined mutability is explicitly allowed, and the `mutableXxx` naming is the tell that it was deliberate
- Agent flags Lombok in a Lombok codebase and rewrites files piecemeal - raise it, match the surrounding code, and keep removal as its own change
- Agent counts 32 rules as 32 separate commits - several are one design decision, and the records-versus-beans choice (20, 21) is a system-level one
- Agent reports a nullness or Javadoc finding without checking what actually gates it - rules 7, 24, 28, 29 and 30 are gated by the JDK or tool version, not by `release`
- Agent files rules 30 to 32 as code findings - they are build configuration, and each is one change for the whole repository

## Related

- [java-versions.md](java-versions.md) · [data-oriented-programming.md](data-oriented-programming.md) · [records.md](records.md) · [beans-vs-records.md](beans-vs-records.md) · [optional-and-null.md](optional-and-null.md) · [nullness.md](nullness.md) · [switch.md](switch.md) · [exceptions-and-resources.md](exceptions-and-resources.md) · [javadoc.md](javadoc.md) · [enforcement.md](enforcement.md) · [google-style-deltas.md](google-style-deltas.md)
