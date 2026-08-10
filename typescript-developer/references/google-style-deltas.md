# Google Style Deltas

The [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) is the baseline for this skill. This file lists every point where the skill says something different, and why. Nothing is changed silently, and nothing here is a matter of taste - each entry names a specific reason Google's position no longer produces the outcome it was written to produce.

If you disagree with a delta, this is the file to argue with. Everything not listed here is Google's rule, kept as written.

## 1 - Enums: allowed → banned outright

**Google:** bans `const enum`; plain `enum` is permitted, and `CONSTANT_CASE` enum members appear in the naming table.

**This skill:** never generate an enum of any kind. Use a literal union, or an `as const` object where the values are needed at runtime. See [enums-and-constants.md](enums-and-constants.md).

**Why:** an enum is the only TypeScript type construct that emits JavaScript. That makes it non-erasable, so it breaks Node's native type stripping and `erasableSyntaxOnly`, and it diverges between transpilers. Numeric enums are additionally not type-safe - any `number` is assignable to one.

## 2 - Parameter properties: required → conditional

**Google:** use `constructor(private readonly x: X) {}` rather than declaring and assigning the field.

**This skill:** declare the field explicitly by default. Use parameter properties only where a framework's DI requires them - Angular and NestJS - and then only with `erasableSyntaxOnly` off. See [classes.md](classes.md).

**Why:** a parameter property expands into an assignment statement, so it is not erasable syntax. It is rejected by `erasableSyntaxOnly` and by Node's type stripper. Google's guide assumes a build step that always transpiles; running `.ts` directly is now ordinary.

## 3 - `#private` fields: banned → default at ES2022+

**Google:** private identifiers are forbidden; use the `private` modifier. Stated rationale: "substantial emit size/performance regressions when downleveled and are unsupported before ES2015."

**This skill:** prefer `#private` for new class internals when `target` is ES2022 or above. Use `private` below that target, and `protected` wherever subclass access is needed - there is no `#protected`. See [classes.md](classes.md).

**Why:** `#` fields are native from ES2022. Below that they downlevel to `WeakMap`, which is exactly the cost Google cites - so the rationale is real, but only under ES2022. TypeScript 6.0 removed the ES5 target and its default target floats well above ES2022, so for a current project the penalty does not exist. `#` also gives genuine runtime encapsulation rather than a compile-time convention, and the TypeScript team's own framing favours "the JavaScript-first way" where the language provides one.

**Caveat, stated honestly:** this is the softest delta here. TypeScript is explicit that it will not deprecate `private`, `#` cannot express `protected`, and a codebase that tests class internals will find `#` obstructive. If a project has picked `private` and applied it consistently, that is a defensible choice - follow it.

## 4 - `@ts-expect-error`: tests only → everywhere, over `@ts-ignore`

**Google:** avoid `@ts-ignore`; `@ts-expect-error` is permitted in unit tests.

**This skill:** when a suppression is genuinely unavoidable anywhere, it is `@ts-expect-error` with a comment explaining why. Never `@ts-ignore`.

**Why:** the two differ in one way that matters. `@ts-expect-error` becomes an error itself once the underlying error is fixed, so it deletes itself from the codebase when it stops being needed. `@ts-ignore` sits there silently suppressing whatever error later appears on that line, including a new and unrelated one. Google is right that suppressions should be rare; that is an argument for the self-removing form everywhere, not for the rotting form outside tests.

## 5 - `satisfies`: absent → the first thing to try

**Google:** covers type annotations and `as` assertions, and prefers annotations for object literals.

**This skill:** reach for `satisfies` before either. See [type-inference.md](type-inference.md).

**Why:** `satisfies` postdates the guide. It checks a value against a type without widening it to that type, which is precisely what people were reaching for `as` to do and not getting. Google's underlying instinct - prefer the checked form over the asserting form - is unchanged; there is now a better checked form.

## What is *not* a delta

Several rules get quoted as conflicts and are not.

**"Prefer interfaces over type aliases"** is narrower than it is usually repeated. Google's rule is about `type X = { ... }` object-literal aliases specifically. It does not ban type aliases for unions, functions, primitives, or mapped and conditional types - for which interfaces cannot be used at all. Read that way, it agrees with the TypeScript handbook's "use `interface` until you need features from `type`" and with the compiler-performance argument for `extends` over `&`. See [interfaces-and-type-aliases.md](interfaces-and-type-aliases.md).

**Dropped rather than changed:** the Google-internal machinery - Apps JSPB protos, Closure/JSCompiler property renaming, `@nocollapse`, tsetse and tsec conformance. Where the reasoning generalises it is kept in portable terms. The visibility rule is the clearest case: Google frames bypassing `private` via `obj['foo']` as breaking JSCompiler property renaming; the portable version is that it breaks any minifier that renames properties, and defeats the only signal a reader has about what is internal.

## Version notes

Deltas 1, 2 and 3 all trace to the same version change: the erasability constraint arriving with `erasableSyntaxOnly` (TypeScript 5.8) and Node's native type stripping, and the ES5 target being removed in 6.0. On 5.x below 5.8 with a build step that always transpiles, Google's original positions on enums and parameter properties are internally consistent - they are simply not the situation any current project is in. Delta 3 is conditional on `target` and reverses below ES2022. Delta 5 requires 4.9+.

## Gotchas

- Agent treats this file as optional colour - it is the list of places the skill and its stated source disagree, which is exactly what a reviewer needs
- Agent applies delta 3 without checking `target` - below ES2022, `#` downlevels to `WeakMap` and Google's rationale holds
- Agent flips an existing codebase from `private` to `#private` because of delta 3 - it applies to new code; consistency wins over correctness-at-the-margin here
- Agent cites "Google prefers interfaces" to ban a union type alias - the rule is about object-literal aliases only
- Agent adds its own deviations without recording them here - an undocumented delta is indistinguishable from a mistake

## Related

- [enums-and-constants.md](enums-and-constants.md) · [classes.md](classes.md) · [type-inference.md](type-inference.md) · [interfaces-and-type-aliases.md](interfaces-and-type-aliases.md) · [tsconfig.md](tsconfig.md) · [typescript-versions.md](typescript-versions.md)
