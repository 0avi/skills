# Java Versions and Migration

## Establish the version before writing code

Read the build configuration — it is authoritative, not the installed JDK:

| Build tool | Where to look |
| ---------- | ------------- |
| Maven | `maven.compiler.release`, or `maven.compiler.source` / `target` in `pom.xml` |
| Gradle | `java.toolchain.languageVersion`, `sourceCompatibility`, or `options.release` |
| Either | `.sdkmanrc`, `.tool-versions`, `.java-version`, CI workflow files |

Then run `java -version`. Projects frequently build on a newer JDK than they target; if the installed JDK is *older* than the configured release, say so — the code will not compile.

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

Prefer a Gradle **toolchain** over `sourceCompatibility` — it pins the compiling JDK, not just the bytecode level.

**Do not leave a project stuck on 11, 17 or 21.** Those carry the migration cost of leaving Java 8 without the benefit of arriving at 21+, where records, sealed types, pattern matching and switch expressions finally combine into a coherent style.

## The Java 8 hall pass

A codebase genuinely stuck on Java 8 is a defensible position — Java 8 is deeply embedded in enterprise systems and will be around far longer than the official support dates suggest. When working in one:

- Do **not** generate records, sealed types, patterns, switch expressions, `var`, or text blocks. None exist.
- The highest-value practices still available are **immutability**, **`Optional` return types** and **`java.time`** — and they are exactly what makes a later migration to records straightforward.

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

## Related

- [checklist.md](checklist.md) · [smaller-features.md](smaller-features.md)
