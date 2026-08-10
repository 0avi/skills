# Disallowed Features

One list, each with the reason. Most are enforceable ([enforcement.md](enforcement.md)).

## Language and runtime

| Banned | Instead | Why |
|---|---|---|
| `var` | `const`, `let` | Function-scoped and hoisted |
| `enum`, `const enum` | Literal union, `as const` object | Emits runtime code; not erasable. [enums-and-constants.md](enums-and-constants.md) |
| `namespace`, `module X {}` | ES modules | Emits a runtime object; a file is already a namespace |
| `/// <reference path=…>` | `import` | Predates modules |
| `import x = require(…)` | `import` | CommonJS-only syntax |
| `with` | Explicit property access | Makes scope undecidable; illegal in strict mode anyway |
| `eval`, `new Function(string)` | Anything else | Executes arbitrary strings; blocked by most CSPs |
| `debugger` | A breakpoint | Halts execution in production |
| `String`, `Number`, `Boolean`, `Symbol`, `BigInt` as types | `string`, `number`, … | Wrapper objects are not primitives |
| `new String(…)`, `new Boolean(…)` | The literal | `new Boolean(false)` is an object, so it is truthy |
| `Function` as a type | The call signature | Accepts anything callable, returns `any` |
| `{}` as "an empty object" | `Record<string, unknown>`, `unknown` | Means "anything except null/undefined". [any-and-unknown.md](any-and-unknown.md) |
| `any` | A real type, or `unknown` | Disables checking downstream. [any-and-unknown.md](any-and-unknown.md) |
| `@ts-ignore`, `@ts-nocheck` | `@ts-expect-error`, scoped, with a reason | `@ts-ignore` rots; `@ts-expect-error` self-removes |
| `Array()` constructor | `[]` | One- and two-argument forms differ |
| `new Object()` | `{}` | |
| Bare `for…in` | `Object.keys`/`entries` | Walks the prototype chain |
| `parseInt` for base-10 | `Number()` then `Number.isNaN` | Silently accepts trailing garbage |
| Unary `+` to coerce | `Number()` | Unreadable |
| `==` / `!=` | `===` / `!==` | Coercion. The one exception is `== null` |
| Line continuations in strings | Template literal, concatenation | Breaks on trailing whitespace |
| `export let` | An exported getter function | Consumers see it change with no way to observe |
| Default exports | Named exports | No canonical name. [imports-and-exports.md](imports-and-exports.md) |
| `Object.defineProperty` for accessors | `get`/`set` | Invisible to the type system |
| Direct `prototype` manipulation | `class` | |
| Modifying builtin prototypes | A free function | Global mutation; collides with future standards |
| Labelled `break`/`continue` | Extract a function and `return` | |

## Semicolons and ASI

Terminate statements explicitly. Never rely on Automatic Semicolon Insertion - the cases where it does not insert one, notably a line starting with `(` or `[`, produce a runtime error rather than a syntax error.

This is the formatter's job. Set `semi: true` in Prettier and stop thinking about it.

## Non-standard features

- **Deprecated ECMAScript or Web Platform features.** If MDN says deprecated, do not use it.
- **TC39 proposals below stage 4**, unless the framework requires one. Stage-3 decorators are the sanctioned exception ([decorators.md](decorators.md)); the proposal changed shape more than once before settling, which is exactly the risk.
- **Transpiler-specific extensions** not in any standard.

## Modifying builtins

Never add to `Array.prototype`, `Object.prototype`, `String.prototype` or any other builtin. It is global mutation, it breaks `for…in` on every array in the process, and a future standard method with the same name will collide with yours.

This includes indirectly - avoid dependencies that do it. A polyfill implementing a stage-4 standard exactly is the exception.

## The two most common ways these get in

**`any` and `@ts-ignore` are the ones to watch.** Both are used as an escape hatch under time pressure, and both are load-bearing by the time anyone revisits them. `no-explicit-any` alone is insufficient - most `any` arrives by inference from an untyped source, which is what the `no-unsafe-*` family exists for.

## Version notes

- **`erasableSyntaxOnly`** (5.8+) enforces the `enum`, `namespace` and parameter-property bans at the compiler.
- **6.0** removed `target: es5` and `moduleResolution: node`/`classic`.
- **7.0** removed `baseUrl`, `downlevelIteration`, and `module: amd`/`umd`/`systemjs`; `esModuleInterop`, `allowSyntheticDefaultImports` and `alwaysStrict` can no longer be disabled.
- typescript-eslint v8 split `ban-types` into `no-empty-object-type`, `no-unsafe-function-type` and `no-wrapper-object-types`.
- On 7.0 the lint layer is unavailable until 7.1, so the compiler-enforceable bans matter more ([enforcement.md](enforcement.md)).

## Gotchas

- Agent writes an `enum` because the codebase has one - match and raise, or convert; do not add another
- Agent writes a `namespace` to group related types - a module already does that
- Agent uses `@ts-ignore` - `@ts-expect-error`, scoped, with a reason
- Agent adds `@ts-nocheck` to a file
- Agent writes `String` or `Number` as a type annotation
- Agent uses `Function` as a parameter type - write the signature
- Agent uses `{}` to mean an empty object
- Agent adds a method to `Array.prototype` - global mutation, and it breaks `for…in` everywhere
- Agent adopts a stage-2 proposal because a blog demonstrated it
- Agent relies on ASI - a line starting with `(` or `[` becomes a runtime error
- Agent uses `new Boolean(false)` and treats it as falsy - it is an object, always truthy
- Agent uses a labelled `break` - extract a function

## Related

- [enums-and-constants.md](enums-and-constants.md) · [any-and-unknown.md](any-and-unknown.md) · [imports-and-exports.md](imports-and-exports.md) · [variables-and-literals.md](variables-and-literals.md) · [decorators.md](decorators.md) · [enforcement.md](enforcement.md)
