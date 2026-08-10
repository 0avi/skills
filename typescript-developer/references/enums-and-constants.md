# Enums and Constants

**Never generate an `enum`.** Not `const enum`, not a string enum, not a numeric one.

This is stricter than the Google guide, which bans only `const enum`. See [google-style-deltas.md](google-style-deltas.md).

## Why

**An enum emits JavaScript.** It is the only TypeScript type construct that does - everything else erases. That single fact produces the rest:

- **Not erasable.** Node's native type stripping cannot run a file containing an enum, and `erasableSyntaxOnly` rejects it. Every non-`tsc` transpiler treats it as a special case.
- **Numeric enums are not type-safe.** Any `number` is assignable to a numeric enum, including one that is not a member:

  ```typescript
  enum Status { Draft, Submitted }
  const s: Status = 47;          // compiles
  ```

- **Numeric and string enums behave differently.** Numeric ones get a reverse mapping (`Status[0] === 'Draft'`), string ones do not. Same keyword, two semantics.
- **String enums are nominal, not structural** - unlike everything else in TypeScript. `'draft'` is not assignable to a `Status` whose member equals `'draft'`, which surprises everyone at an API boundary.
- **`const enum` breaks across compilation boundaries.** It inlines values, so it cannot be published in a library and does not work under `isolatedModules`.

## The replacements

### Literal union - the default

When you only need the type:

```typescript
type Status = 'draft' | 'submitted' | 'rejected';

function label(status: Status): string { … }
label('draft');                 // just works - no import needed
```

Simpler, erases completely, structurally typed, and autocompletes at every call site. It also narrows properly in a `switch`, which is what makes exhaustiveness checking work ([control-flow.md](control-flow.md)).

### `as const` object - when you need the values at runtime

When you need to iterate the members, or map from a stored value:

```typescript
export const OrderStatus = {
  Draft: 'draft',
  Submitted: 'submitted',
  Rejected: 'rejected',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
//   'draft' | 'submitted' | 'rejected'
```

Declaring the constant and the type with the same name is deliberate - TypeScript keeps values and types in separate namespaces, so `OrderStatus.Draft` and `status: OrderStatus` both work. That is the ergonomic an enum was offering, without the emit.

You get what an enum gave you, and more:

```typescript
OrderStatus.Draft;                       // 'draft'
Object.values(OrderStatus);              // iterate - enums make this awkward
const s: OrderStatus = 'draft';          // structural: the raw string is accepted
```

### Numeric constants

```typescript
export const HttpStatus = {
  Ok: 200,
  NotFound: 404,
} as const;
```

Same pattern. Unlike a numeric enum, `47` is not assignable.

## Migrating

Mechanical, one enum at a time:

1. Replace `enum X { A = 'a' }` with the `as const` object plus derived type above.
2. `X.A` call sites keep working unchanged.
3. `import {X}` keeps working - it is now a value and a type under one name.
4. Fix any `Object.keys(X)` that relied on a numeric reverse mapping. This is the only step that needs thought, and only for numeric enums.

Because member access is unchanged, the diff is usually confined to the declaration.

## Enforcing it

No typescript-eslint rule bans enum declarations. Two ways:

```jsonc
// tsconfig.json - also bans namespaces and parameter properties
{"compilerOptions": {"erasableSyntaxOnly": true}}
```

```js
// eslint.config.js
'no-restricted-syntax': [
  'error',
  {selector: 'TSEnumDeclaration', message: 'Use a literal union or an `as const` object.'},
],
```

Enable both where the project allows it. See [enforcement.md](enforcement.md).

## When you will still meet one

A dependency's `.d.ts`, or generated code - protobuf, OpenAPI clients, Prisma. You cannot remove those. Use them at the boundary, convert to your own union inward, and do not propagate the enum type through your domain.

If a codebase already uses enums throughout, match it and raise it. A file half-converted is worse than either.

## Constant naming

`CONSTANT_CASE` is for a module-level value that is **deeply immutable and a genuine constant** - a value the program treats as fixed:

```typescript
export const MAX_RETRIES = 3;
export const DEFAULT_TIMEOUT_MS = 30_000;
```

Not for every `const`. A local, or a `const` holding a mutable object, is `lowerCamelCase`:

```typescript
const activeUsers = new Map<string, User>();     // const binding, mutable value
```

Members of an `as const` object take `UpperCamelCase` - `OrderStatus.Draft` - matching what enum members would have been. See [naming.md](naming.md).

## Version notes

- **`as const`** needs 3.4+; available everywhere.
- **`erasableSyntaxOnly`** needs 5.8+.
- **`isolatedModules`** has always been incompatible with `const enum`.
- Enums are not removed in 6.0 or 7.0 - the language still has them. This is a project rule, enforced by configuration, not something the compiler does for you by default.
- Node's native type stripping (22.6+, on by default from 22.18) is what makes this a practical constraint rather than a stylistic one.

## Gotchas

- Agent writes an `enum` - use a literal union, or an `as const` object when runtime values are needed
- Agent writes a `const enum` thinking it avoids the emit - it breaks `isolatedModules` and cannot be published
- Agent uses a numeric enum for a closed set - any `number` is assignable, including invalid ones
- Agent forgets `as const` on the object - every value widens to `string` and the derived type becomes useless
- Agent derives the type as `keyof typeof X` - that gives the *keys* (`'Draft'`), not the values; use `(typeof X)[keyof typeof X]`
- Agent gives the constant and the type different names - same name works, values and types are separate namespaces
- Agent propagates a generated enum from protobuf or Prisma through the domain - convert at the boundary
- Agent converts one enum in a codebase full of them - match and raise, or convert all
- Agent uses `CONSTANT_CASE` for every `const` - it is for deeply immutable module-level constants
- Agent relies on a numeric enum's reverse mapping after migrating - that behaviour does not exist on an `as const` object

## Related

- [google-style-deltas.md](google-style-deltas.md) · [control-flow.md](control-flow.md) · [advanced-types.md](advanced-types.md) · [naming.md](naming.md) · [tsconfig.md](tsconfig.md) · [enforcement.md](enforcement.md) · [disallowed-features.md](disallowed-features.md)
