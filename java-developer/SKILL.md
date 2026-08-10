---
name: java-developer
description: Generates modern Java code and provides architectural guidance for Java 8 through 25. Trigger when writing or modernising Java, or for best practices on immutability, records, sealed types, pattern matching, switch expressions, Optional vs null, var, text blocks, instance main methods, unnamed variables, module imports, Markdown Javadoc, JPMS modules, bean generation, data-oriented programming, or version migration.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# Java Developer Guidelines

Covers the language changes from Java 8 to Java 25.

1. **Always determine the project's Java version and build tool before giving guidance.** Available features vary enormously between 8, 11, 17, 21 and 25 - advice that is correct on 25 will not compile on 17.

2. **Apply these defaults when generating code:** favour immutability, prefer the arrow expression form of `switch`, use `Optional` on public return types, go all in on `var` for locals. Where the surrounding code conflicts, match the surrounding code and raise the conflict - do not silently mix styles.

3. **A new feature is not automatically a best practice.** Some post-Java-8 features should be avoided in application code - JPMS modules, module import declarations, label-form switches. Each reference states a verdict; follow it rather than hedging.

4. **After generating code, compile it and run the tests** with the project's build tool (`mvn -q verify`, `./gradlew build`). Do not skip this - patterns, sealed exhaustiveness and record component nullability fail at compile time in subtle ways.

## Determining the Java Version

**Step 1.** Read the build config - authoritative, not the installed JDK. Maven: `maven.compiler.release`, or `source`/`target`. Gradle: `java.toolchain.languageVersion`, `sourceCompatibility`, `options.release`. Also `.sdkmanrc`, `.tool-versions`, `.java-version`, CI workflows.

**Step 2.** Run `java -version`. If the installed JDK is older than the configured release, say so - the code will not compile.

**Step 3.** Only generate features available in that release. If a recommendation needs a newer version, state which and give the version-appropriate alternative. Never silently generate Java 21 code for a Java 17 project.

**Step 4.** New projects: latest LTS (Java 25), and set `release` rather than `source`/`target`.

Read [java-versions.md](references/java-versions.md) for the Java 8 hall pass and OpenRewrite migration.

## Immutability

Treat immutability as the first design decision, not a later refinement. Consult these references:

- **Immutability**: Final classes and fields, keeping mutability inside a single source file, naming mutable variables to make them stand out in code review, and preferring composition over inheritance. Read [immutability.md](references/immutability.md)
- **Immutable Collections**: `List.of` / `Set.of` / `Map.of`, Guava's immutable collections, `Collections.unmodifiable*`, and the iteration-order randomisation in `Set.of` / `Map.of` that silently creates flaky tests. Read [immutable-collections.md](references/immutable-collections.md)

## Optional and Null

- **Optional and Null**: Why `Optional` belongs on public return types but not on parameters or fields, why `isPresent()` / `isEmpty()` are a code smell, using the `Optional` API as fluently as the Stream API, the `in(Optional)` loop idiom, and why future null-restricted types (`String?` / `String!`) will not replace `Optional`. Read [optional-and-null.md](references/optional-and-null.md)

## Records, Beans and Sealed Types

Use records to express **AND** (a bundle of components) and sealed types to express **OR** (a constrained choice of subtypes). Consult these references:

- **Records**: What a record generates, compact constructor validation, why arrays and mutable components defeat the point of a record, preferring simple types, and the risk of `toString()` leaking sensitive data. Read [records.md](references/records.md)
- **Beans vs Records**: Why "Java beans" are not JavaBeans, the bean/record cliff edge, why records do not replace beans, and why generated beans (Immutables, Joda-Beans, Lombok) are preferable to hand-written ones. Read [beans-vs-records.md](references/beans-vs-records.md)
- **Sealed Types**: Modelling constrained choices, how sealing enables exhaustive `switch`, and keeping hierarchies simple (sealed interface at the root, avoid `non-sealed`). Read [sealed-types.md](references/sealed-types.md)

## Pattern Matching

Read these before working with `instanceof` or a `switch` over types. Treat a pattern as the test/extract/bind construct it is, not as shorter `instanceof` syntax - the nesting rules and the `null` interaction depend on it.

- **Patterns**: The test/extract/bind fusion, type patterns, the modern `equals` idiom, patterns in `switch`, the match-all pattern `_`, and where patterns may appear in future. Read [patterns.md](references/patterns.md)
- **Record Patterns**: Destructuring records, arbitrary pattern nesting, the subtle rule that decides whether a component pattern can match `null`, and using `var` inside record patterns to make narrowing visible. Read [record-patterns.md](references/record-patterns.md)

## Switch

- **Switch**: The six kinds of `switch` (label vs arrow, statement vs expression, exhaustive vs not), why the label forms should be ignored entirely, always preferring the arrow expression form, who is responsible for exhaustiveness in a statement switch, and `case null`. Read [switch.md](references/switch.md)

## var

- **var**: Why local variable type inference should be adopted wholesale rather than sparingly, the parallel with lambda parameter inference, naming variables for the data rather than the type, and the `Opt` suffix convention for `Optional` locals. Read [var.md](references/var.md)

## Smaller Language Features

The reference carries a per-feature verdict table - adopt, adopt for scripts only, or avoid. Follow it rather than adopting on novelty.

- **Smaller Features**: Text blocks (and the SQL injection trap they invite), unnamed variables `_`, Markdown doc comments, instance `main` methods and compact source files, and module import declarations (avoid). Read [smaller-features.md](references/smaller-features.md)

## Modules (JPMS)

- **Modules**: Why modules were essential to the JDK's own evolution, why they see little adoption in applications, the pain of publishing a modular library, and the fact that module boundaries are only enforced on the module path. Read [modules.md](references/modules.md)

## Data-Oriented Programming

- **Data-Oriented Programming**: How records, sealed types, patterns and enums combine into a single design style; where records belong in a typical system (JSON in, database out); validating at the boundaries; and why this is a whole-system commitment rather than a local refactor. Read [data-oriented-programming.md](references/data-oriented-programming.md)

## Beyond the Language

- **Modern APIs**: Stream gatherers, virtual threads, and the Foreign Function & Memory API - when each is genuinely worth reaching for. Read [modern-apis.md](references/modern-apis.md)

## Checklist

- **Best Practices Checklist**: All 22 practices in one scannable list, plus the three top tips. Use this for review passes over existing code. Read [checklist.md](references/checklist.md)
