---
name: typescript-developer
description: Generates modern TypeScript and provides architectural guidance, deriving from the Google TypeScript Style Guide and extending it to current practice. Trigger when writing or reviewing TypeScript, or for guidance on tsconfig and strictness flags, imports and exports, ES modules, classes and private fields, functions, control flow, error handling, the type system (inference, satisfies, nullability, interfaces vs type aliases, generics, any vs unknown, branded types, discriminated unions), replacing enums with literal unions and as const objects, decorators, async and promises, resource management with using, naming, JSDoc, testing, or migrating between TypeScript 5.x, 6.0 and 7.0.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# TypeScript Developer Guidelines

Derived from the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), which is the baseline for every rule here. Where Google's stated rationale has since expired - usually because it rested on ES5 downlevel emit, which no longer exists - this skill takes the current position instead and says so. Every such departure is listed in [google-style-deltas.md](references/google-style-deltas.md); nothing is changed silently.

1. **Always determine the TypeScript version and the tsconfig before giving guidance.** 6.0 changed the defaults (`strict`, `module`, `types`) and removed the ES5 target; 7.0 removed more and ships without a programmatic API. What compiles on one line will not on another. Read [typescript-versions.md](references/typescript-versions.md).

2. **`strict` is the floor, not the target.** `strict: true` alone leaves `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax` off, and each of those catches a class of bug the strict family does not. Read [tsconfig.md](references/tsconfig.md).

3. **Never widen a type to make an error go away.** No `any`, no `as` to silence a mismatch, no `!` to dismiss a null, no `@ts-ignore`. Each converts a compile error into a runtime one. Narrow, guard, or fix the type. Read [any-and-unknown.md](references/any-and-unknown.md).

4. **Never generate an `enum`.** Not `const enum`, not a string enum, not a numeric one. Use a literal union, or an `as const` object when the values are needed at runtime. Enums are the one TypeScript type construct that emits JavaScript, which makes them non-erasable, and numeric enums are not even type-safe. [enums-and-constants.md](references/enums-and-constants.md) carries the replacement for every enum shape. If the codebase already uses enums, match it and raise it rather than silently mixing.

5. **Prefer the construct that emits nothing.** The same erasability rule bans `namespace` and makes parameter properties conditional - Node's type stripper and `erasableSyntaxOnly` both reject anything that is not a pure annotation.

6. **Match the surrounding code and raise the conflict.** These rules apply to new code. In a codebase that consistently does otherwise, follow the local convention and say so rather than silently mixing styles.

7. **After generating code, type-check it and run the tests.** `tsc --noEmit` plus the project's test command. Do not skip this - inference, generic constraints and exhaustiveness all fail in ways that are not obvious by reading.

Every reference carries a **`## Version notes`** section stating what differs across TypeScript 5.x, 6.0 and 7.0, and a **`## Gotchas`** list of the specific mistakes agents make in that area. Read the gotchas even when skimming.

## Determining the Version and Configuration

**Step 1.** Read `typescript` in `package.json` `devDependencies`, not a global install. Confirm with `npx tsc --version`.

**Step 2.** Read the whole `tsconfig.json`, following `extends`. The strictness flags decide what advice is even applicable - `noUncheckedIndexedAccess` changes what every array access returns.

**Step 3.** Check for `erasableSyntaxOnly`, and whether the project runs `.ts` directly under Node. Either one bans enums, namespaces and parameter properties.

**Step 4.** Check the module format - `module`, `type` in `package.json`, and whether imports carry `.js` extensions. This decides import style before anything else.

**Step 5.** New projects: TypeScript **6.0**. Read [typescript-versions.md](references/typescript-versions.md) for why 7.0 is not yet the default recommendation.

## Foundations

- **TypeScript Versions**: The 6.0 baseline, what 6.0 removed and redefaulted, the 7.0 Go-native compiler and its missing programmatic API, running 6 and 7 side by side, and the 5.x → 6 → 7 path. Read [typescript-versions.md](references/typescript-versions.md)
- **tsconfig**: The recommended configuration flag by flag - the strict family and what it misses, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, `isolatedDeclarations`, `erasableSyntaxOnly`. Read [tsconfig.md](references/tsconfig.md)
- **Enforcement**: Which rules a linter can enforce and which only review catches, the typescript-eslint mapping, formatter setup, and what breaks on TypeScript 7. Read [enforcement.md](references/enforcement.md)
- **Google Style Deltas**: Every point where this skill departs from the Google guide, with the expired rationale that justifies each. Read [google-style-deltas.md](references/google-style-deltas.md)

## Source Files

- **File Structure**: Encoding, the required order of copyright, `@fileoverview`, imports and implementation, escape sequences, and non-ASCII characters. Read [file-structure.md](references/file-structure.md)
- **Imports and Exports**: The four import forms and when each applies, named versus namespace imports, why default exports are banned, mutable exports, container classes, `import type`, ES modules, `.js` extensions and package `exports`. Read [imports-and-exports.md](references/imports-and-exports.md)

## Language

- **Variables and Literals**: `const` over `let` over never `var`, one declaration per statement, array and object literals, spread, destructuring, string quoting, template literals, number literals, and type coercion. Read [variables-and-literals.md](references/variables-and-literals.md)
- **Functions**: Declarations versus expressions versus arrows, `this` and why rebinding is banned, callbacks, arrow properties, event handlers, parameter defaults, rest and spread, and overloads. Read [functions.md](references/functions.md)
- **Classes**: `#private` over `private`, `readonly`, field initializers, why parameter properties are now conditional, visibility, accessors, static members, and the prototype rules. Read [classes.md](references/classes.md)
- **Control Flow**: Braces, assignment in conditions, iterating arrays and objects, `switch` and exhaustiveness, `===`, and grouping parentheses. Read [control-flow.md](references/control-flow.md)
- **Errors and Exceptions**: Only throw `Error`, `unknown` in `catch`, custom error classes and `cause`, empty catch blocks, keeping `try` focused, and when a `Result` type beats throwing. Read [errors-and-exceptions.md](references/errors-and-exceptions.md)

## Type System

- **Type Inference and satisfies**: What to annotate and what to leave inferred, return types, annotating structural implementations at the declaration, and `satisfies` as the first choice before any assertion. Read [type-inference.md](references/type-inference.md)
- **Nullability**: `undefined` versus `null`, why nullability never belongs in a type alias, optional properties versus `| undefined`, `exactOptionalPropertyTypes`, and narrowing. Read [nullability.md](references/nullability.md)
- **Interfaces and Type Aliases**: Interfaces for object shapes, aliases for unions and computed types, declaration merging, and what Google's rule actually says. Read [interfaces-and-type-aliases.md](references/interfaces-and-type-aliases.md)
- **Arrays and Collections**: `T[]` versus `Array<T>`, `readonly`, index signatures, `Map` and `Set` and `Record`, and what `noUncheckedIndexedAccess` changes. Read [arrays-and-collections.md](references/arrays-and-collections.md)
- **any and unknown**: Why `any` is banned, `unknown` and narrowing, `{}` versus `object` versus `unknown`, and the discipline for the rare suppression. Read [any-and-unknown.md](references/any-and-unknown.md)
- **Generics**: Constraints, why return-type-only generics are banned, `const` type parameters, `NoInfer`, variance annotations, and when not to reach for a generic. Read [generics.md](references/generics.md)
- **Advanced Types**: Mapped and conditional types and Google's restraint rule, template literal types, discriminated unions, branded types for nominal typing, type predicates and assertion functions. Read [advanced-types.md](references/advanced-types.md)

## Modern Syntax

- **Enums and Constants**: Why `as const` objects and literal unions replace `enum`, the `const enum` ban, and the erasability rule behind both. Read [enums-and-constants.md](references/enums-and-constants.md)
- **Decorators**: Standard stage-3 decorators versus `experimentalDecorators`, why the two cannot be mixed, the framework-only rule, and the `accessor` keyword. Read [decorators.md](references/decorators.md)

## Async

- **Async and Promises**: Floating promises, `async`/`await` over `.then`, concurrency with `Promise.all` and `allSettled`, cancellation with `AbortSignal`, and async error handling. Read [async-and-promises.md](references/async-and-promises.md)
- **Resource Management**: `using` and `await using`, `Symbol.dispose` and `Symbol.asyncDispose`, `DisposableStack`, and where they replace `try`/`finally`. Read [resource-management.md](references/resource-management.md)

## Conventions

- **Naming**: The casing table, descriptive names, acronyms as words, type parameters, test names, the underscore ban, what counts as a constant, and aliases. Read [naming.md](references/naming.md)
- **Comments and JSDoc**: JSDoc versus line comments, form and markdown, which tags are banned because TypeScript already says it, and documenting parameters and returns. Read [comments-and-jsdoc.md](references/comments-and-jsdoc.md)
- **Disallowed Features**: Wrapper objects, semicolons and ASI, `debugger`, `with`, `eval`, non-standard syntax, namespaces, and modifying builtins. Read [disallowed-features.md](references/disallowed-features.md)

## Testing

- **Testing**: Structure and naming, what to assert, type-level testing, why `any` in a test is still a bug, and test doubles. Read [testing.md](references/testing.md)

## Checklist

- **Best Practices Checklist**: Every rule in one scannable list, plus the ones that cause the most damage. Use this for a review pass over existing code. Read [checklist.md](references/checklist.md)
