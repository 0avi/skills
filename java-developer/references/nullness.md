# Nullness Annotations

**`Optional` states absence on a return type. Nullness annotations state it everywhere `Optional` must not go - parameters, fields and generic type arguments.** They are complementary halves of one policy, not competing answers. Read [optional-and-null.md](optional-and-null.md) for the return-type half.

Use **JSpecify** (`org.jspecify.annotations`). It is the one set the tooling has converged on, replacing the previous scattering of `javax.annotation`, `org.jetbrains.annotations` and framework-local variants.

```java
@NullMarked                                   // everything below is non-null unless marked
package com.example.filing;
```

```java
public Person register(String name, @Nullable String nickname) { ... }
```

## The four annotations

| Annotation | Means | Applies to |
| ---------- | ----- | ---------- |
| `@Nullable` | A value of this type can be `null` | A **type use** |
| `@NonNull` | No value of this type should be `null` | A **type use** |
| `@NullMarked` | Unannotated types in this scope are `@NonNull` | Module, package, class, interface, method |
| `@NullUnmarked` | Return this scope to unspecified nullness | Package, class, method, inside a `@NullMarked` scope |

**Set `@NullMarked` once per package and then annotate only the exceptions.** That is the whole ergonomic argument: without it every non-null parameter needs `@NonNull`, and nobody sustains that. With it, `@NonNull` is rarely written at all and `@Nullable` marks the genuinely nullable minority.

`@NullUnmarked` is the incremental-adoption tool. Mark the package, unmark the classes not yet audited, and delete those as you go.

## Placement is part of the meaning

These are **type-use** annotations, so they sit immediately before the type they qualify, and moving one changes what it says:

| Written | Means |
| ------- | ----- |
| `@Nullable String name` | The `String` may be `null` |
| `@Nullable String[] names` | The **elements** may be `null`; the array may not |
| `String @Nullable [] names` | The **array** may be `null`; the elements may not |
| `List<@Nullable String> names` | The list is non-null; its elements may be `null` |
| `Map.@Nullable Entry<K, V> entry` | The nested type is the nullable one |
| `Object @Nullable... args` | The varargs array may be `null` |

This is the one place agents get wrong consistently, because the intuitive reading of `@Nullable String[]` is the wrong one.

Two positions carry no nullness meaning: **local variables** and **type variable uses** are excluded from `@NullMarked`'s non-null default, so annotating a local says nothing a checker will act on.

## Do not use these where `Optional` belongs

```java
// ❌ two mechanisms for one job, and the caller can still ignore this one
public @Nullable Person findPerson(String id) { ... }

// ✅
public Optional<Person> findPerson(String id) { ... }
```

The division of labour:

| Position | Use |
| -------- | --- |
| Public return type | `Optional` |
| Parameter | `@Nullable`, or an overload |
| Field | `@Nullable`, with an `Optional`-returning accessor |
| Generic type argument | `@Nullable` - `Optional` cannot express it |
| Array element, or the array itself | `@Nullable` - same reason |
| Framework-reflected getter | Plain type, `@Nullable` if it can be absent |

## Nothing is enforced until a checker runs

**An unchecked `@Nullable` is a comment.** javac does not read it and never warns on it. Wire up **NullAway**, an Error Prone plugin, or you have documentation rather than a guarantee. See [enforcement.md](enforcement.md).

```
-XepOpt:NullAway:OnlyNullMarked=true
-XepOpt:NullAway:JSpecifyMode=true
```

`OnlyNullMarked` tells NullAway to trust `@NullMarked` scopes rather than a hand-maintained package list, which is what you want with JSpecify. It arrived in NullAway 0.12.3; before that `-XepOpt:NullAway:AnnotatedPackages=...` was mandatory. Exactly one of the two must be set.

## Where Spring sits

Spring Framework 7 and Boot 4 are themselves `@NullMarked`, and moved from `org.springframework.lang.Nullable` to `org.jspecify.annotations.Nullable`. **A Boot 4 upgrade can therefore surface nullness errors in code that compiled silently on Boot 3**, where a null checker or Kotlin is in the build. On Boot 3.5.x the framework's own annotations are the Spring ones; use JSpecify in your own code either way. The `spring-boot-developer` skill owns that migration detail.

## Version notes

JSpecify is a **library**, so it has no JDK language floor of its own. The constraints are the annotation target and the checker:

| Piece | Requirement |
| ----- | ----------- |
| Type-use annotations at all (`ElementType.TYPE_USE`) | Java **8** |
| `@NullMarked` on a module declaration | Java 9, since that is when module declarations exist. The module name is `org.jspecify`, so `requires static org.jspecify;` |
| The JSpecify 1.0.0 artefact | Any release from 8. It contains exactly the four annotations above and nothing else |
| NullAway 0.12.11+ running the check | **JDK 22+**, or JDK 21.0.8+ / 17.0.19+ with `-XDaddTypeAnnotationsToSymbol=true` |
| That `-XD` flag | OpenJDK builds only - Temurin and Zulu have it, Oracle JDK 21 and 17 do not |

So the annotations reach back to Java 8 but **the enforcement does not**: a Java 21 LTS project needs at least 21.0.8 on an OpenJDK build to run NullAway's current releases, and a Java 17 project needs 17.0.19. Establish this before telling a user their nullness will be checked.

The two NullAway rows are that project's own documented requirements. **Every placement in the table above was compiled against the JSpecify 1.0.0 artefact**, including the module declaration, `Map.@Nullable Entry`, `Object @Nullable...` and `@Nullable` on a local, which is legal and simply carries no checked meaning.

Null-restricted types (`String!` / `String?`) are a future language feature, in no release through 25. When they arrive they replace these annotations, not `Optional` - see [optional-and-null.md](optional-and-null.md).

## Gotchas

- Agent writes `@Nullable String[] names` meaning the array may be `null` - that says the **elements** may be null. `String @Nullable []` is the array
- Agent annotates a local variable - locals are excluded from `@NullMarked`'s default and no checker acts on it
- Agent adds `@Nullable` and reports the code as null-safe - javac ignores the annotation entirely. Without NullAway wired up it is a comment
- Agent writes `@NonNull` on every parameter - that is what `@NullMarked` is for. Frequent `@NonNull` means the scope annotation is missing
- Agent uses `javax.annotation.Nullable`, `org.jetbrains.annotations.Nullable` or `org.springframework.lang.Nullable` in new code - JSpecify is the converged answer, and mixing sets makes the checker's view incoherent
- Agent puts `@Nullable` on a public return type instead of using `Optional` - the two halves of the policy are not interchangeable
- Agent promises NullAway on a Java 17 or 21 project without checking the JDK vendor and patch level - it needs 22+, or 21.0.8+ / 17.0.19+ on OpenJDK with an extra `-XD` flag
- Agent adds `@NullMarked` to a package and leaves the build red - `@NullUnmarked` on the unaudited classes is the incremental path
- Agent annotates a type variable use expecting it to constrain the type argument - type variable uses are excluded from the default

## Related

- [optional-and-null.md](optional-and-null.md) - the return-type half of the same policy
- [enforcement.md](enforcement.md) - wiring up NullAway, without which none of this is checked
- [records.md](records.md) - component nullability, better fixed by validating in the compact constructor
