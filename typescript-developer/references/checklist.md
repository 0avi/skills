# Best Practices Checklist

Every rule in the skill, in one scannable list. Use it for a review pass over existing code, or as a gate before opening a PR.

## The eight that cause the most damage

| | Rule | Why it is the worst |
|---|---|---|
| 1 | **No `any`** | Contagious. One annotation disables checking across a whole call chain, and most of it arrives by inference, not by hand |
| 2 | **Every promise awaited, returned, or `void`-marked** | A floating rejection terminates a Node process, and the ordering is undefined |
| 3 | **No `enum`** | The only type construct that emits JavaScript. Non-erasable, and numeric ones are not type-safe |
| 4 | **`noUncheckedIndexedAccess` on** | Without it the compiler states that `xs[0]` is defined. It is not |
| 5 | **Never suppress to make an error go away** | `as`, `!`, `@ts-ignore` each convert a compile error into a runtime one |
| 6 | **Mutually exclusive states are a discriminated union** | The all-optional-fields alternative permits illegal states and needs `!` at every read |
| 7 | **Validate at the boundary, derive the type from the schema** | A hand-written check and a hand-written type drift apart silently |
| 8 | **`projectService` in the ESLint config** | Without it every type-aware rule silently does nothing while appearing configured |

## Version and configuration

| # | Rule | Reference |
|---|---|---|
| 1 | TypeScript version read from `devDependencies`, not a global install | [typescript-versions.md](typescript-versions.md) |
| 2 | TypeScript 6.0 as the baseline; 7.0 only once 7.1 restores the programmatic API, or with the side-by-side alias | [typescript-versions.md](typescript-versions.md) |
| 3 | No `ignoreDeprecations` left in the config - it does not work on 7.0 | [typescript-versions.md](typescript-versions.md) |
| 4 | `types` listed explicitly on 6.0+ - it defaults to `[]` | [tsconfig.md](tsconfig.md) |
| 5 | `strict: true`, and understood as a floor rather than the target | [tsconfig.md](tsconfig.md) |
| 6 | `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` on | [tsconfig.md](tsconfig.md) |
| 7 | `exactOptionalPropertyTypes` on for new projects | [tsconfig.md](tsconfig.md) |
| 8 | `verbatimModuleSyntax` and `isolatedModules` on | [tsconfig.md](tsconfig.md) |
| 9 | `target` at ES2022 or above | [tsconfig.md](tsconfig.md) |
| 10 | `erasableSyntaxOnly` on, unless framework DI needs parameter properties | [tsconfig.md](tsconfig.md) |
| 11 | Config read via `tsc --showConfig`, not by opening one file in an `extends` chain | [tsconfig.md](tsconfig.md) |
| 12 | ESLint config has `projectService`; extends `strictTypeChecked` | [enforcement.md](enforcement.md) |
| 13 | Formatter owns quoting, semicolons and width; no lint rule duplicates it | [enforcement.md](enforcement.md) |

## Source files

| # | Rule | Reference |
|---|---|---|
| 14 | UTF-8; no unescaped tabs or non-breaking spaces in strings | [file-structure.md](file-structure.md) |
| 15 | Order: copyright, `@fileoverview`, imports, implementation | [file-structure.md](file-structure.md) |
| 16 | `kebab-case.ts` filenames matching the primary export | [file-structure.md](file-structure.md) |
| 17 | Named exports only - no default exports | [imports-and-exports.md](imports-and-exports.md) |
| 18 | No `export let`; export a getter function | [imports-and-exports.md](imports-and-exports.md) |
| 19 | Nothing exported that is used only in its own file | [imports-and-exports.md](imports-and-exports.md) |
| 20 | No static-only container classes - the module is the namespace | [imports-and-exports.md](imports-and-exports.md) |
| 21 | `import type` for type-only imports; `export type` for type re-exports | [imports-and-exports.md](imports-and-exports.md) |
| 22 | `.js` extensions on relative imports under `nodenext` | [imports-and-exports.md](imports-and-exports.md) |
| 23 | No `baseUrl`; relative paths, `paths`, or a package boundary | [imports-and-exports.md](imports-and-exports.md) |
| 24 | No per-directory barrel files | [imports-and-exports.md](imports-and-exports.md) |

## Language

| # | Rule | Reference |
|---|---|---|
| 25 | `const`, then `let`, never `var`; one declaration per statement | [variables-and-literals.md](variables-and-literals.md) |
| 26 | No `Array()` or `new Object()` constructors | [variables-and-literals.md](variables-and-literals.md) |
| 27 | Spread operands are always an array or object, never a `&&` expression | [variables-and-literals.md](variables-and-literals.md) |
| 28 | `Object.keys`/`entries` over bare `for...in`; `Object.hasOwn` if unavoidable | [variables-and-literals.md](variables-and-literals.md) |
| 29 | Single quotes; template literals over concatenation; no line continuations | [variables-and-literals.md](variables-and-literals.md) |
| 30 | `Number()` and `Number.isNaN` over `parseInt` and unary `+` | [variables-and-literals.md](variables-and-literals.md) |
| 31 | Function declarations for named functions; arrows for callbacks; no function expressions | [functions.md](functions.md) |
| 32 | No `bind(this)`, `const self = this`, or `.call(this)` | [functions.md](functions.md) |
| 33 | Event listeners registered with a stable reference, never `.bind()` | [functions.md](functions.md) |
| 34 | No boolean parameters - use an options object | [functions.md](functions.md) |
| 35 | Return types annotated on exported functions, especially `Promise<T>` | [functions.md](functions.md) |
| 36 | `#private` at ES2022+; `protected` where subclasses or templates need access | [classes.md](classes.md) |
| 37 | No `obj['field']` to bypass visibility | [classes.md](classes.md) |
| 38 | `readonly` on every field not reassigned after construction | [classes.md](classes.md) |
| 39 | Parameter properties only where framework DI requires them | [classes.md](classes.md) |
| 40 | No `public` modifier; no empty or purely-delegating constructor | [classes.md](classes.md) |
| 41 | Getters pure; no pass-through accessor pairs | [classes.md](classes.md) |
| 42 | No `this` in a static method; statics called on the declaring class | [classes.md](classes.md) |
| 43 | `override` on every overriding member; composition over deep hierarchies | [classes.md](classes.md) |
| 44 | Braces on control statements; `===` except `== null` | [control-flow.md](control-flow.md) |
| 45 | Every `switch` has a `default`; no unmarked fallthrough | [control-flow.md](control-flow.md) |
| 46 | `switch` over a union ends in `assertNever` | [control-flow.md](control-flow.md) |
| 47 | `for...of` over `.forEach()` where the body may `break`, `return` or `await` | [control-flow.md](control-flow.md) |
| 48 | Only `Error` subclasses thrown, always with `new` | [errors-and-exceptions.md](errors-and-exceptions.md) |
| 49 | `catch` binding left `unknown` and narrowed | [errors-and-exceptions.md](errors-and-exceptions.md) |
| 50 | Wrapping uses `{cause}`; the original stack is never discarded | [errors-and-exceptions.md](errors-and-exceptions.md) |
| 51 | Empty `catch` blocks carry a comment; `try` blocks kept narrow | [errors-and-exceptions.md](errors-and-exceptions.md) |
| 52 | Expected failures returned as a value; unexpected ones thrown | [errors-and-exceptions.md](errors-and-exceptions.md) |

## Type system

| # | Rule | Reference |
|---|---|---|
| 53 | Obvious types left inferred; exported signatures annotated | [type-inference.md](type-inference.md) |
| 54 | Structural implementations annotated at the declaration | [type-inference.md](type-inference.md) |
| 55 | `satisfies` before an annotation, and an annotation before `as` | [type-inference.md](type-inference.md) |
| 56 | Assertions use `as`, are commented, and go through `unknown` when doubled | [type-inference.md](type-inference.md) |
| 57 | No `!` non-null assertions - write the check | [type-inference.md](type-inference.md) |
| 58 | Nullability at the point of use, never inside a type alias | [nullability.md](nullability.md) |
| 59 | `x?: T` rather than `x: T \| undefined` | [nullability.md](nullability.md) |
| 60 | `??` and `?.` rather than `\|\|` where `0` or `''` is valid | [nullability.md](nullability.md) |
| 61 | Property narrowings copied to a `const` before an `await` or call | [nullability.md](nullability.md) |
| 62 | `interface` for object shapes; `type` for unions and computed types | [interfaces-and-type-aliases.md](interfaces-and-type-aliases.md) |
| 63 | `extends` rather than `&` - it checks, and it caches | [interfaces-and-type-aliases.md](interfaces-and-type-aliases.md) |
| 64 | No `I` prefix or `Interface` suffix | [interfaces-and-type-aliases.md](interfaces-and-type-aliases.md) |
| 65 | Derived types over duplicated shapes, kept shallow | [interfaces-and-type-aliases.md](interfaces-and-type-aliases.md) |
| 66 | `T[]` for simple types, `Array<T>` for complex ones | [arrays-and-collections.md](arrays-and-collections.md) |
| 67 | `readonly T[]` on parameters not mutated | [arrays-and-collections.md](arrays-and-collections.md) |
| 68 | `Record` over index signatures; `Map` over objects for dynamic keys | [arrays-and-collections.md](arrays-and-collections.md) |
| 69 | Tuple elements labelled; objects beyond two elements | [arrays-and-collections.md](arrays-and-collections.md) |
| 70 | `.sort()` never called on an array you do not own | [arrays-and-collections.md](arrays-and-collections.md) |
| 71 | `unknown` over `any`; `Record<string, unknown>` over `{}` | [any-and-unknown.md](any-and-unknown.md) |
| 72 | `JSON.parse` and `response.json()` results typed `unknown` and validated | [any-and-unknown.md](any-and-unknown.md) |
| 73 | No wrapper types; no bare `Function` | [any-and-unknown.md](any-and-unknown.md) |
| 74 | `@ts-expect-error` only, scoped to one expression, with a reason and an exit condition | [any-and-unknown.md](any-and-unknown.md) |
| 75 | No type parameter used only once, and none appearing only in the return type | [generics.md](generics.md) |
| 76 | Constraints match what the body needs; `const` type parameters where literals matter | [generics.md](generics.md) |
| 77 | `NoInfer` where one parameter should be checked against another | [generics.md](generics.md) |
| 78 | Mutually exclusive states modelled as a discriminated union | [advanced-types.md](advanced-types.md) |
| 79 | Type predicate bodies trivially correct - the compiler does not verify them | [advanced-types.md](advanced-types.md) |
| 80 | External data validated by schema, with the type derived from it | [advanced-types.md](advanced-types.md) |
| 81 | Identifiers passed through layers are branded, constructed via a validating factory | [advanced-types.md](advanced-types.md) |
| 82 | Mapped and conditional types used only where an interface will not do | [advanced-types.md](advanced-types.md) |

## Modern syntax, async, conventions

| # | Rule | Reference |
|---|---|---|
| 83 | No `enum`; literal union, or `as const` object with a derived type | [enums-and-constants.md](enums-and-constants.md) |
| 84 | Generated enums converted at the boundary, not propagated inward | [enums-and-constants.md](enums-and-constants.md) |
| 85 | One decorator system per project; never mixed | [decorators.md](decorators.md) |
| 86 | Only framework-defined decorators - a higher-order function otherwise | [decorators.md](decorators.md) |
| 87 | Every promise awaited, returned, or explicitly `void`-marked with a `.catch()` | [async-and-promises.md](async-and-promises.md) |
| 88 | No `async` callback passed where `void` is expected | [async-and-promises.md](async-and-promises.md) |
| 89 | Independent work concurrent via `Promise.all`; never awaited in a loop | [async-and-promises.md](async-and-promises.md) |
| 90 | `Promise.all` bounded; `allSettled` where partial results are acceptable | [async-and-promises.md](async-and-promises.md) |
| 91 | Optional `AbortSignal` on every I/O function | [async-and-promises.md](async-and-promises.md) |
| 92 | `response.ok` checked - `fetch` does not reject on 4xx or 5xx | [async-and-promises.md](async-and-promises.md) |
| 93 | `using` / `await using` for scoped cleanup; `await using` for `AsyncDisposable` | [resource-management.md](resource-management.md) |
| 94 | Casing table followed; no affixes; acronyms treated as words | [naming.md](naming.md) |
| 95 | `CONSTANT_CASE` only for deeply immutable module-level constants | [naming.md](naming.md) |
| 96 | Names say what the thing is - no `data`, `handleIt`, `Manager` | [naming.md](naming.md) |
| 97 | No types in JSDoc; no `@private`, `@override`, `@implements`, `@enum` | [comments-and-jsdoc.md](comments-and-jsdoc.md) |
| 98 | Comments explain why, not what; TODOs carry an owner and a condition | [comments-and-jsdoc.md](comments-and-jsdoc.md) |
| 99 | No commented-out code | [comments-and-jsdoc.md](comments-and-jsdoc.md) |
| 100 | Nothing from the banned list | [disallowed-features.md](disallowed-features.md) |

## Testing

| # | Rule | Reference |
|---|---|---|
| 101 | Test doubles typed against the real interface - never `any` | [testing.md](testing.md) |
| 102 | One behaviour per test; named for the behaviour, not the method | [testing.md](testing.md) |
| 103 | Observable outcomes asserted, not internals; specific matchers | [testing.md](testing.md) |
| 104 | `rejects` assertions awaited or returned | [testing.md](testing.md) |
| 105 | Clock, randomness and ids injected; fresh fixtures per test | [testing.md](testing.md) |
| 106 | `tsc --noEmit` runs in CI as its own step - a transpile-only runner does not type-check | [testing.md](testing.md) |

## Version notes

Rules 2, 3, 4 and 106 are TypeScript 6.0/7.0 specific. Rule 10 needs 5.8+, rule 55 needs 4.9+, rules 76 and 77 need 5.0+ and 5.4+, rule 93 needs 5.2+. Rule 36 is conditional on `target` and reverses below ES2022. Everything else holds on any supported version.

On TypeScript 7.0, every rule whose enforcement is a lint rule becomes a review responsibility until 7.1 - see [enforcement.md](enforcement.md).

## Gotchas

- Agent walks this list instead of reading the reference - the list is a gate, not a substitute for the reasoning
- Agent treats a green `tsc` and a green lint as full compliance - rules 78 to 82, 96 and 98 have no automated check
- Agent applies rule 36 without checking `target`
- Agent applies rule 10 to an Angular or NestJS codebase without checking rule 39 first
- Agent adds a rule here without adding it to the reference that owns it

## Related

- [SKILL.md](../SKILL.md) · [enforcement.md](enforcement.md) · [google-style-deltas.md](google-style-deltas.md) · [tsconfig.md](tsconfig.md) · [typescript-versions.md](typescript-versions.md)
