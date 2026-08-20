# Java Versions and Migration

## Establish the version before writing code

Read the build configuration - it is authoritative, not the installed JDK:

| Build tool | Where to look |
| ---------- | ------------- |
| Maven | `maven.compiler.release`, or `maven.compiler.source` / `target` in `pom.xml` |
| Gradle | `java.toolchain.languageVersion`, `sourceCompatibility`, or `options.release` |
| Either | `.sdkmanrc`, `.tool-versions`, `.java-version`, CI workflow files |

Then run `java -version`. Projects frequently build on a newer JDK than they target; if the installed JDK is *older* than the configured release, say so - the code will not compile.

**Only generate features available in the configured release.** If a recommendation needs a newer version, state which version and give the version-appropriate alternative. Never silently generate Java 21 code for a Java 17 project.

## Target the newest LTS

Use Java 25 for new projects, and set `release` rather than `source`/`target` so the compiler validates against the correct API surface.

```xml
<properties>
  <maven.compiler.release>25</maven.compiler.release>
</properties>
```

```kotlin
java {
  toolchain { languageVersion = JavaLanguageVersion.of(25) }
}
```

Prefer a Gradle **toolchain** over `sourceCompatibility` - it pins the compiling JDK, not just the bytecode level.

**Do not leave a project stuck on 11, 17 or 21.** Those carry the migration cost of leaving Java 8 without the benefit of arriving at 21+, where records, sealed types, pattern matching and switch expressions finally combine into a coherent style.

## The Java 8 hall pass

A codebase genuinely stuck on Java 8 is a defensible position - Java 8 is deeply embedded in enterprise systems and will be around far longer than the official support dates suggest. When working in one:

- Do **not** generate records, sealed types, patterns, switch expressions, `var`, or text blocks. None exist.
- The highest-value practices still available are **immutability**, **`Optional` return types** and **`java.time`** - and they are exactly what makes a later migration to records straightforward.

## Migrate with OpenRewrite

```bash
# Maven
mvn -U org.openrewrite.maven:rewrite-maven-plugin:run \
  -Drewrite.recipeArtifactCoordinates=org.openrewrite.recipe:rewrite-migrate-java:RELEASE \
  -Drewrite.activeRecipes=org.openrewrite.java.migrate.UpgradeToJava25
```

| Recipe | Effect |
| ------ | ------ |
| `org.openrewrite.java.migrate.UpgradeToJava21` / `...Java25` | Umbrella version migration |
| `org.openrewrite.staticanalysis.InstanceOfPatternMatch` | `instanceof` + cast → type patterns |
| `org.openrewrite.java.migrate.util.SequencedCollection` | Adopts `getFirst()` / `getLast()` / `reversed()` |
| `org.openrewrite.java.migrate.lang.UseTextBlocks` | Concatenated strings → text blocks |

**Always review the diff.** OpenRewrite is mechanical: it will convert an `instanceof` chain faithfully, but it will not tell you the design should have been a sealed hierarchy.

## Version notes

This page is the skill's version reference. Every floor below was established by compiling a minimal example of the exact idiom at each release from 8 to 25 with `javac --release`, and recording the lowest release that compiles. Use it to answer "can this project have that?" before generating anything.

| Release | What becomes available |
| ------- | ---------------------- |
| 8 | The `Optional` core API, `Collectors.toList()`, `Collections.unmodifiable*`, `java.time` |
| 9 | `List.of` / `Set.of` / `Map.of`, `Optional.or` / `stream` / `ifPresentOrElse`, `Objects.requireNonNullElse`, JPMS |
| 10 | `var`, `List.copyOf` / `Set.copyOf` / `Map.copyOf`, `Optional.orElseThrow()` no-arg |
| 11 | `String.isBlank()` / `strip()`, `Optional.isEmpty()`, `var` in lambda parameters |
| 13 | `String.formatted()` |
| 14 | Arrow `switch`, statement and expression, and `yield`. `jpackage` |
| 15 | Text blocks |
| 16 | **Records.** `instanceof` type patterns. `Stream.toList()` |
| 17 | **Sealed types**, `non-sealed` |
| 18 | **UTF-8 becomes the default charset.** `Object.finalize()` deprecated for removal, and `--finalization=disabled` to prove nothing depends on it |
| 21 | **Pattern `switch`, `when` guards, `case null`, record patterns.** `MatchException`, `SequencedCollection` (`getFirst` / `getLast` / `reversed`), virtual threads. `-Xlint:this-escape` |
| 22 | Unnamed variables and patterns (`_`), the Foreign Function & Memory API |
| 23 | Markdown doc comments (`///`) - a javadoc tool change, so `///` compiles as an ordinary comment on any release and simply produces no documentation below 23 |
| 24 | Stream gatherers (`Stream.gather`, `Gatherers`) |
| 25 | `ScopedValue`, `java.lang.IO`, compact source files with instance `main`, module import declarations |

Four results that surprise people, all measured rather than assumed:

- **The default charset changed at 18, and `release` does not control it.** Charset is a property of the JVM that runs, not of the bytecode level you target, so `maven.compiler.release=17` still gets UTF-8 once the build and the application run on 18 or later. Measured on both JDK 21 and 25: `Charset.defaultCharset()` and `file.encoding` are `UTF-8` while `native.encoding` on the same machine is `Cp1252`. **Crossing 18 therefore changes behaviour in code that read or wrote files without naming a charset**, and it changes it at deployment rather than at compile time, which is the worst place to find out. Name the charset explicitly, and set `project.build.sourceEncoding` regardless of release.

- **`String.formatted()` resolves from 13**, before text blocks themselves. Text blocks need 15, so 15 is the floor for the combined idiom.
- **`_` as a variable name compiles on Java 8**, where it is an ordinary identifier. It is rejected from 9 to 21, and only means "unnamed variable" from 22. See [smaller-features.md](smaller-features.md).
- **`ScopedValue` is 25**, not 21, so the standard virtual-threads advice to prefer it over `ThreadLocal` does not apply on a Java 21 LTS project. See [modern-apis.md](modern-apis.md).

## Gotchas

- Agent reads the installed JDK from `java -version` and treats that as the target - the build configuration is authoritative, and projects routinely build on a newer JDK than they target
- Agent finds `maven.compiler.source` / `target` and leaves them - `release` is the one that validates against the correct API surface. Source and target can be set to 8 while a Java 11 method still compiles
- Agent sees Java 25 installed and generates 25 features for a project whose `release` is 17
- Agent checks the language version but not the API - most of what breaks is library surface, not syntax. `Optional.or` on Java 8 is the classic
- Agent treats a migration past 18 as source-compatible and stops there - the default charset changes at runtime, so file and stream code that never named a charset changes behaviour
- Agent assumes a doc-comment feature is gated by `release` - `///`, `{@return}` and `{@snippet}` track the javadoc tool version instead. See [javadoc.md](javadoc.md)
- Agent runs an OpenRewrite recipe and reports it as done without reading the diff - it converts faithfully and will not tell you the design should have been a sealed hierarchy
- Agent proposes leaving a codebase on 11 or 17 as "modern enough" - 21 is where records, sealed types and patterns first combine, per [data-oriented-programming.md](data-oriented-programming.md)
- Agent treats the Java 8 hall pass as permission to write Java 8 style on a Java 21 project - it applies to codebases genuinely stuck on 8
- Agent sets a Gradle `sourceCompatibility` rather than a toolchain - the toolchain pins the compiling JDK, not just the bytecode level

## Related

- [checklist.md](checklist.md) · [smaller-features.md](smaller-features.md)
