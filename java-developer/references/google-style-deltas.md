# Google Style Deltas

The [Google Java Style Guide](https://google.github.io/styleguide/javaguide.html) is the baseline for this skill's style rules. This file lists every point where the skill says something different, and why. Nothing is changed silently.

If you disagree with a delta, this is the file to argue with. Everything not listed here is Google's rule, kept as written.

## First, the size of the overlap

The guide is a formatting-and-naming standard with a short programming-practices section. It is **silent on almost everything this skill is about**, so most of the skill is neither an agreement nor a delta. Counted over the guide's text:

| Topic | Times the guide mentions it |
| ----- | --------------------------- |
| `var` (the keyword) | **0** |
| `instanceof`, patterns, pattern matching | **0** |
| Streams, `java.time`, virtual threads, gatherers, FFM | **0** |
| `Optional` as a type | **0** - every "optional" in the guide is the English word |
| `sealed` | 1, in the modifier-order list |
| `record` | 9, all of them formatting or Javadoc |

Read the guide for layout, naming and the section 6 practices. Do not read its silence as prohibition, which is what delta 3 is about.

## 1 - Compact source files: banned outright, to adopt for scripts

**Google:** section 3.2, "Every source file must have a package declaration. Compact source files are not used."

**This skill:** adopt compact source files and instance `main` for **scripts, examples, and anything run via `java Foo.java`**. Neutral for applications, where the entry point is one line in the whole codebase. See [smaller-features.md](smaller-features.md).

**Why:** the guide is describing a single enormous monorepo where every file is a build target, tooling assumes a package, and there is no "run this one file" mode. That reasoning is real and does not generalise. For a throwaway script the package declaration is pure ceremony, and the feature exists precisely to remove it.

## 2 - Name affixes: none, to two specific ones

**Google:** section 5.1, "special prefixes or suffixes are not used", giving `name_`, `mName`, `s_name` and `kName` as the examples.

**This skill:** two suffixes are required. Mutable locals, parameters and fields are named `mutableXxx` ([immutability.md](immutability.md)), and `Optional` locals take an `Opt` suffix ([var.md](var.md)).

**Why:** Google's four examples are all **scope or type** encoding - Hungarian notation and field-versus-local markers - which carry no information a reader cannot get from the declaration. Both suffixes here encode **semantics the declaration no longer shows**. `mutableTotal` marks the one thing this skill treats as unusual, so it stands out in review, and the guide's own section 5.2.4 names a non-constant field `mutableCollection` in exactly this spirit. `personOpt` exists because `var` removed the type from the line, so `person.map(...)` would otherwise read as though `Person` has a `map` method.

**Caveat:** the `Opt` suffix is the softest rule in this skill. If a codebase has picked plain names and applied them consistently, follow it.

## 3 - `var`: silence, to adopt wholesale

**Google:** says nothing. The keyword does not appear in the guide.

**This skill:** use `var` for local variables, all in rather than sparingly, with the naming condition attached. See [var.md](var.md).

**Why:** listed here only because the silence is routinely quoted as a ban. It is not one. The guide predates nothing here - it covers `record`, `sealed`, text blocks, unnamed variables and module imports, so it has been maintained through Java 25 - it simply takes no position on local type inference. Section 4.8.2.2, "local variables are declared close to the point they are first used", is the closest it comes, and that rule supports `var` rather than opposing it.

## 4 - Javadoc: HTML, to Markdown and inline tags

**Google:** section 7 is entirely HTML. `<p>` immediately before the first word of each paragraph after the first, `<ul>` for lists, and no mention of `///`.

**This skill:** use Markdown doc comments (`///`) for new code, `{@return}` for accessor summaries, and `{@snippet}` in place of `<pre>{@code}`. See [javadoc.md](javadoc.md).

**Why:** these postdate the relevant part of the guide. `///` removes the HTML entirely, `{@return}` fixes the specific mistake the guide itself calls out in 7.2 (`/** @return the customer ID */` with no summary), and a file-based `{@snippet}` is compiled by the build so it cannot rot. The guide's underlying instincts - a summary fragment, ordered block tags, no empty tag descriptions - are unchanged and kept in full.

## 5 - Guava immutable collections: default, to conditional

**Google:** uses `ImmutableList` and `ImmutableMap` freely as the ordinary way to hold a constant, in its section 5.2.4 examples.

**This skill:** default to the JDK factories (`List.of`, `Map.of`, `copyOf`), and reach for Guava **where iteration order matters or you need a builder**. See [immutable-collections.md](immutable-collections.md).

**Why:** the JDK factories did not exist when this part of the guide was written, and Google's codebase has Guava everywhere regardless. For a project without Guava, adding the dependency for `Map.of`'s job is not worth it. The exception is real and specific: `Set.of` and `Map.of` randomise iteration order per JVM run, and Guava is the clean answer there.

## What is *not* a delta

Three rules get quoted as conflicts and are not.

**Switch exhaustiveness (4.8.4.3)** looks like a conflict with this skill's "omit `default` over a sealed type", because the guide says exhaustiveness "may require adding a `default` label, even if it contains no code". Read the definition it gives: a switch is exhaustive if it has a `default` **or** if the selector is an enum with every constant matched. A complete enum switch and an exhaustive sealed switch are therefore already exhaustive under Google Style with no `default`, and the guide's rule only bites where the labels genuinely do not cover everything. The two positions agree, including on the harder half - the guide requires exhaustiveness of **statement** switches too, which is exactly what [switch.md](switch.md) says you own yourself.

**One top-level class per file (3.4.1)** does not conflict with omitting `permits`. A sealed hierarchy can omit `permits` when the subtypes are in the same **source file**, and the way to do that within Google Style is to declare them as **nested members** of the sealed interface, which is how [sealed-types.md](sealed-types.md) shows it. Several top-level records in one file also compiles, but it is the form the guide rules out.

**Module imports and wildcard imports (3.3.1, 3.3.1.1)** are agreements worth citing rather than deltas. The guide bans both, and `import module java.base;` is its example. [smaller-features.md](smaller-features.md) reaches the same verdict independently.

**Dropped rather than changed:** the guide's Google-internal machinery - JSNI method references, `crbug` links in the TODO format, and the 100-column limit and every other layout rule. Where the reasoning generalises it is kept in portable terms, and the portable version of section 4 in full is "run a formatter", per [enforcement.md](enforcement.md).

## Version notes

Two deltas are version-gated, and both reverse below their floor:

| Delta | Applies from |
| ----- | ------------ |
| 1, compact source files | **25**. Below that there is nothing to disagree about |
| 4, Javadoc | **16** for `{@return}`, 18 for `{@snippet}`, 23 for `///`, and these track the **javadoc tool** rather than `--release` - see [javadoc.md](javadoc.md) |
| 2, name affixes | 8 for `mutableXxx`; **10** for the `Opt` suffix, which only exists because `var` does |
| 3, `var` | **10** |
| 5, Guava | **9**, when `List.of` and `Map.of` made the JDK an option at all. On Java 8 Guava is the answer and the delta does not apply |

## Gotchas

- Agent treats this file as optional colour - it is the list of places the skill and its stated source disagree, which is exactly what a reviewer needs
- Agent cites the guide's silence on `var` as a prohibition - delta 3 exists because that happens
- Agent quotes 4.8.4.3 to add an empty `default` to a switch over a sealed type - read the definition of exhaustive in that section. A complete sealed switch already satisfies it
- Agent applies delta 1 to an application's `main` method as a modernisation - it is one line in the codebase. The delta is about scripts
- Agent strips the `Opt` suffix or the `mutableXxx` prefix from an existing codebase citing guide 5.1 - delta 2 is the argument for keeping them, and consistency beats either position
- Agent adds Guava to a project to hold a three-entry constant - delta 5 is conditional on iteration order or a builder
- Agent brings the guide's formatting rules in as prose - that is a formatter's job, per [enforcement.md](enforcement.md)
- Agent adds its own deviation without recording it here - an undocumented delta is indistinguishable from a mistake

## Related

- [smaller-features.md](smaller-features.md) · [javadoc.md](javadoc.md) · [var.md](var.md) · [immutability.md](immutability.md) · [immutable-collections.md](immutable-collections.md) · [switch.md](switch.md) · [sealed-types.md](sealed-types.md) · [enforcement.md](enforcement.md)
