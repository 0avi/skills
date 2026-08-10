# `any` and `unknown`

## `any` is banned

`any` does not mean "some type". It means "stop checking", and it is contagious - every expression derived from an `any` is also `any`, so one annotation disables checking across a call chain. A codebase with `any` scattered through it has the cost of types and none of the benefit.

Four alternatives, in order:

1. **Write the type.** Usually the answer. An interface, an inline object type, a union.
2. **Use a generic** with a constraint, when the type varies by call site. See [generics.md](generics.md).
3. **Use `unknown`** when the value genuinely is opaque at that point.
4. **Suppress, with a comment** - rare, and see below.

## `unknown`

`unknown` accepts any value and permits nothing until you narrow it. That is the whole difference, and it is the right default for anything crossing a trust boundary:

```typescript
function handle(payload: unknown) {
  payload.id;                                   // error - good

  if (typeof payload === 'object' && payload !== null && 'id' in payload) {
    payload.id;                                 // narrowed
  }
}
```

For anything with real structure, narrow once with a type predicate rather than inline checks everywhere:

```typescript
function isSubmission(value: unknown): value is Submission {
  return typeof value === 'object' && value !== null
      && 'id' in value && typeof value.id === 'string';
}
```

Hand-written predicates are unchecked - the compiler trusts the return type without verifying the body. For anything non-trivial, validate with a schema library and derive the type from the schema, so the check and the type cannot drift apart. See [advanced-types.md](advanced-types.md).

## Where `any` gets in

Mostly not by being typed. It arrives from untyped sources:

| Source | Returns | Do |
|---|---|---|
| `JSON.parse()` | `any` | Annotate the receiver `unknown`, then validate |
| `await response.json()` | `any` | Same |
| An untyped dependency | `any` | Write a `.d.ts`, or wrap it in a typed function |
| A `catch` binding annotated `any` | `any` | Leave it `unknown` and narrow ([errors-and-exceptions.md](errors-and-exceptions.md)) |
| An inferred return type touching any of the above | `any` | Annotate exported return types |

```typescript
const data: unknown = JSON.parse(raw);
if (!isSubmission(data)) throw new Error('Malformed submission');
use(data);
```

The `@typescript-eslint/no-unsafe-*` family - `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`, `no-unsafe-argument` - exists to catch exactly this leakage, and is the reason `strictTypeChecked` is worth extending from. `no-explicit-any` alone only catches the ones you wrote by hand.

## `{}`, `object`, `unknown`

Three types people reach for interchangeably. They are not.

| Type | Accepts | Use for |
|---|---|---|
| `unknown` | everything | An opaque value. **Almost always the one you want** |
| `object` | anything non-primitive: objects, arrays, functions | "Not a primitive", genuinely |
| `{}` | everything except `null` and `undefined` | Essentially nothing |

`{}` does not mean "empty object". It means "any non-nullish value" - `42` and `'hello'` are both assignable to `{}`. It is almost always a mistake, and `@typescript-eslint/no-empty-object-type` flags it.

For "an object with unknown properties", write `Record<string, unknown>`.

## Wrapper types are banned

Never `String`, `Number`, `Boolean`, `Symbol`, `BigInt` as types, and never call them with `new`:

```typescript
const s: String = 'x';           // banned
const s: string = 'x';

new Boolean(false);              // an object - truthy. Always.
```

`@typescript-eslint/no-wrapper-object-types` catches these. Also avoid bare `Function` as a type - it accepts any callable and returns `any`; write the signature. That is `no-unsafe-function-type`.

## When suppression is unavoidable

It happens: a dependency with wrong types, a genuine gap in what the type system can express. When it does:

```typescript
// The upstream types declare `data` as string, but the API returns a parsed
// object when Accept is application/json. Tracked at OWNER-1234.
// @ts-expect-error - remove once @acme/client v3 ships corrected types.
const parsed = response.data.items;
```

Three requirements:

- **`@ts-expect-error`, never `@ts-ignore`.** `@ts-expect-error` fails once the underlying error is fixed, so it removes itself. `@ts-ignore` silently suppresses whatever error later lands on that line, including an unrelated new one.
- **A comment saying why**, and what would let it be removed.
- **The narrowest possible scope.** One expression. Never a file-level `@ts-nocheck`.

Prefer fixing the types at the boundary - a small `.d.ts` or a typed wrapper function - over scattering suppressions at every call site.

## Version notes

- **`unknown`** since 3.0; **`useUnknownInCatchVariables`** part of `strict` from 4.4.
- typescript-eslint v8 split the old `ban-types` rule into `no-empty-object-type`, `no-unsafe-function-type` and `no-wrapper-object-types`. On v7 or earlier, `ban-types` covers all three.
- Version-agnostic otherwise across 5.x, 6.0 and 7.0 - but note that on 7.0 the entire lint layer is unavailable ([enforcement.md](enforcement.md)), which makes the compiler-side discipline here more important, not less.

## Gotchas

- Agent writes `any` to make an error go away - it disables checking for everything downstream
- Agent uses `any` where `unknown` would do - `unknown` accepts the same values and forces a narrow
- Agent assigns `JSON.parse()` or `response.json()` to an inferred variable - both return `any`
- Agent writes `catch (error: any)` - leave it `unknown`
- Agent adds `no-explicit-any` and considers `any` handled - most `any` arrives by inference; the `no-unsafe-*` family catches that
- Agent uses `{}` meaning "an empty object" - it means "anything except null and undefined"
- Agent uses `object` where `Record<string, unknown>` was meant
- Agent writes `String`, `Number` or `Boolean` as a type
- Agent uses `Function` as a type - write the call signature
- Agent writes a type predicate whose body does not actually check what it claims - the compiler does not verify it
- Agent uses `@ts-ignore` - use `@ts-expect-error`, which deletes itself when fixed
- Agent adds `@ts-nocheck` to a file - never; narrow to one expression
- Agent suppresses at ten call sites instead of fixing the type at the boundary once

## Related

- [type-inference.md](type-inference.md) · [advanced-types.md](advanced-types.md) · [errors-and-exceptions.md](errors-and-exceptions.md) · [generics.md](generics.md) · [enforcement.md](enforcement.md) · [google-style-deltas.md](google-style-deltas.md)
