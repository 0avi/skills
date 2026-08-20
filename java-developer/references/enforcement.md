# Enforcement

A rule that nothing checks is a suggestion. This maps the skill's rules onto the tool that actually enforces each one, and is honest about which are left to review.

Four tiers. Push every rule to the highest one available:

| Tier | Enforces | Cost of a violation |
| ---- | -------- | ------------------- |
| **Compiler** (`javac -Xlint`) | Language-level hazards, deprecation, fall-through | Build fails with `-Werror` |
| **Static analysis** (Error Prone, NullAway) | Everything needing the AST or nullness information | Build fails |
| **Formatter** (google-java-format) | Everything purely visual | Auto-fixed |
| **Architecture tests** (ArchUnit) | Layering, dependency direction, naming | Test fails |
| Review | Judgement: naming quality, whether a record was the right model | Nothing catches it |

## javac is nearly silent by default

**`javac` warns about almost none of this unless you ask.** Measured on JDK 25: compiling a Foreign Function and Memory call produced no output at all with default settings, and `[restricted]` once `-Xlint:all` was added. Turn it on and make it fatal:

```xml
<plugin>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <release>25</release>
    <compilerArgs>
      <arg>-Xlint:all</arg>
      <arg>-Werror</arg>
    </compilerArgs>
  </configuration>
</plugin>
```

```kotlin
tasks.withType<JavaCompile> {
  options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}
```

### The keys that carry this skill's rules

| Key | Catches | Skill rule |
| --- | ------- | ---------- |
| `fallthrough` | `possible fall-through into case` | The label `switch` forms this skill tells you to ignore. See [switch.md](switch.md) |
| `removal` | Use of API marked for removal, including `Object.finalize` | [exceptions-and-resources.md](exceptions-and-resources.md) |
| `this-escape` | A constructor calling a method an external subclass could override | The `final`-class rule in [immutability.md](immutability.md) |
| `identity` | Use of a value-based class where an identity class is expected, including synchronising on one | [immutability.md](immutability.md). `synchronization` is a deprecated alias for it |
| `restricted` | Restricted methods, so every FFM downcall | [modern-apis.md](modern-apis.md) |
| `text-blocks` | Inconsistent white space in text block indentation | [smaller-features.md](smaller-features.md) |
| `static` | `static method should be qualified by type name` rather than through an instance | Not otherwise stated in this skill; free to adopt |
| `try` | try-with-resources problems | [exceptions-and-resources.md](exceptions-and-resources.md) |
| `serial` | `Serializable` without `serialVersionUID`, and suspect declarations | Relevant wherever records are serialised |
| `dangling-doc-comments` | A doc comment attached to no declaration | [javadoc.md](javadoc.md) |
| `overrides`, `unchecked`, `rawtypes`, `deprecation` | The long-standing set | General |

`-Xlint:all` also switches on `serial` and `missing-explicit-ctor`, which are noisy on some codebases. If `all` is not acceptable, enumerate: `-Xlint:fallthrough,removal,this-escape,identity,restricted,text-blocks,static,try,unchecked,rawtypes,deprecation`.

**What javac will not do:** it never warns about a missing `@Override`. Verified on JDK 21 with `-Xlint:all` on a class declaring `toString()` with no annotation: no output. That rule needs the next tier.

## Error Prone

Google's javac plugin, and the tool that mechanises three of this skill's headline rules. Every check below is on by default at `WARNING` severity, so `-Werror` makes them fail the build.

| Check | Does | Skill rule |
| ----- | ---- | ---------- |
| `StatementSwitchToExpressionSwitch` | Flags a statement `switch` convertible to an arrow `switch`, and groups neighbouring cases | Rule 17, [switch.md](switch.md) |
| `PatternMatchingInstanceof` | Flags `instanceof` plus a separate cast | Rule 18, [patterns.md](patterns.md) |
| `MissingOverride` | Flags a method overriding a supertype method with no `@Override`. Cites Google Java Style 6.1 by name | The rule javac cannot enforce |
| `OptionalNotPresent` | Flags a `get()` or equivalent on an `Optional` known not to be present | Rule 14, [optional-and-null.md](optional-and-null.md) |
| `OptionalOfRedundantMethod` | `ERROR` severity. Flags redundant `Optional` construction | Rule 14 |
| `ImmutableEnumChecker` | Flags mutable state inside an enum | [immutability.md](immutability.md) |
| `MutablePublicArray` | Flags a public static array field, which cannot be made immutable | Rule 10, [immutability.md](immutability.md) |
| `UnusedVariable` | Flags unused locals and private fields | Complements `_`, [smaller-features.md](smaller-features.md) |
| `DoNotCall`, `Finally` | Methods that must not be called; `finally` blocks that do not complete normally | [exceptions-and-resources.md](exceptions-and-resources.md) |

`StatementSwitchToExpressionSwitch` and `PatternMatchingInstanceof` both ship suggested fixes, so a rule this skill states as a manual pass is a `-XepPatchChecks` run on a codebase that has Error Prone wired up. Review the diff, as with OpenRewrite.

**NullAway** is an Error Prone plugin, not a separate tool, and it is what makes `@Nullable` mean anything. Configuration and its JDK requirements are in [nullness.md](nullness.md).

## Formatter

**Adopt a formatter and stop discussing layout.** This is what makes the whole of the Google Java Style Guide's formatting section a non-decision: braces, indentation, the 100-column limit, line wrapping, import order and blank lines are all mechanical.

| Tool | Notes |
| ---- | ----- |
| **google-java-format** | The reference implementation of Google Java Style, and the guide names it as the authority for wrapping. No options, which is the point |
| **palantir-java-format** | A fork with different line-breaking. Choose it if the team dislikes google-java-format's output; do not mix them |

Wire either through **Spotless**, so `spotlessApply` formats and `spotlessCheck` fails CI. Format the whole repository in **one commit of its own**, before turning the check on, or every subsequent diff is unreadable.

Checkstyle is not needed for formatting once a formatter is in place. Keep it only for rules a formatter cannot express and Error Prone does not cover.

## ArchUnit

For the boundaries JPMS does not give you: layering, dependency direction, package naming, "no controller may import a repository". Asserted as ordinary tests, so they hold however the code is launched. This is the answer to "should we modularise for structure" - see [modules.md](modules.md).

## What nothing enforces

Be honest about these in review rather than pretending a tool covers them:

- Whether a type should be a record, a generated bean, or a sealed hierarchy. [beans-vs-records.md](beans-vs-records.md)
- Whether component types are simple enough. [records.md](records.md)
- Whether `var` names carry the information the type used to. [var.md](var.md)
- Whether a `catch (Exception _)` should have been unused at all. [smaller-features.md](smaller-features.md)
- Whether a record's `toString()` leaks personal data. [records.md](records.md)
- Whether validation is at the boundary or scattered. [data-oriented-programming.md](data-oriented-programming.md)

## Version notes

The lint keys are a property of the **javac you run**, not of `--release`, so a project targeting 17 on a JDK 25 toolchain gets JDK 25's keys.

| Key | Availability |
| --- | ------------ |
| `fallthrough`, `static`, `removal`, `try`, `serial`, `overrides`, `text-blocks` | Long-standing; present on 21 |
| `this-escape` | Present on **21** |
| `dangling-doc-comments`, `identity`, `incubating`, `restricted` | **Absent on 21, present on 25.** The exact release between the two was not measured; only two JDKs were available |
| `synchronization` | Still accepted on 25, documented there as a deprecated alias for `identity` |

Error Prone and Spotless are build plugins, so they follow your build rather than the language release. Error Prone tracks the JDK closely and can block a JDK upgrade until a compatible version ships - the same coupling that earns Lombok its verdict in [beans-vs-records.md](beans-vs-records.md), though Error Prone at least fails loudly.

On **Java 8**, `-Xlint:all -Werror` and a formatter are still worth having, and Error Prone still runs. `StatementSwitchToExpressionSwitch` and `PatternMatchingInstanceof` will find nothing there, because neither target construct exists.

## Gotchas

- Agent adds `-Xlint:all` without `-Werror` and calls the rule enforced - a warning nobody reads is not enforcement
- Agent turns on `-Werror` on an existing codebase in the same commit as a feature - it will fail on unrelated pre-existing warnings. Land the cleanup first
- Agent assumes javac warns about a missing `@Override` - it does not, at any lint level. That is Error Prone's `MissingOverride`
- Agent reports the FFM example as clean because default javac said nothing - `restricted` is not in the default set. Verified on JDK 25
- Agent runs a repository-wide `spotlessApply` mixed into a behavioural change - format in its own commit or the diff is unreviewable
- Agent adds both google-java-format and palantir-java-format, or a formatter plus Checkstyle layout rules - they will fight, and every build will reformat the previous one
- Agent cites a lint key that does not exist on the project's JDK - `restricted` and `identity` are absent on 21
- Agent leaves `@Nullable` annotations in place with no NullAway - see [nullness.md](nullness.md); the annotation alone is a comment
- Agent uses `-XepPatchChecks` and commits the result unread - the fixes are mechanical and will not tell you the design was wrong

## Related

- [nullness.md](nullness.md) · [switch.md](switch.md) · [patterns.md](patterns.md) · [exceptions-and-resources.md](exceptions-and-resources.md) · [modules.md](modules.md) · [checklist.md](checklist.md)
