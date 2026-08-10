# Generics

## When not to use one

A generic that appears **once** in a signature is not doing anything:

```typescript
function log<T>(value: T): void { … }          // T is just `unknown` with extra steps
function log(value: unknown): void { … }
```

A type parameter earns its place only when it **relates two positions** - an argument to a return type, or two arguments to each other. If you cannot point at the relationship, delete it.

## Return-type-only generics are banned

```typescript
function parse<T>(raw: string): T { … }        // banned
const config = parse<Config>(raw);             // caller invents the type; nothing checks it
```

`T` appears only in the return position, so there is nothing to infer it from. The caller supplies a type, the function returns whatever it actually parsed, and the compiler certifies a claim nobody verified. It is `any` with a nicer signature.

Return `unknown` and make the caller narrow, or take a validator:

```typescript
function parse(raw: string): unknown { … }

function parse<T>(raw: string, guard: (v: unknown) => v is T): T {
  const value: unknown = JSON.parse(raw);
  if (!guard(value)) throw new Error('Validation failed');
  return value;
}
```

Now `T` is inferred from an argument, and the guard actually runs.

When you must call an existing API of this shape, always pass the type argument explicitly rather than letting it infer to `unknown`.

## Constraints

Constrain to what the function actually needs, and no more:

```typescript
function longest<T extends {length: number}>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}
```

`T extends {length: number}` keeps the caller's precise type in the return, which `(a: {length: number})` would discard. That relationship is the entire point of the generic.

Use `extends keyof` for property access, which is the most common genuinely-useful generic:

```typescript
function pluck<T, K extends keyof T>(items: readonly T[], key: K): Array<T[K]> {
  return items.map((item) => item[key]);
}
```

## Defaults

```typescript
interface Paged<T, TCursor = string> { … }
```

A default is useful for a rarely-varied parameter. It does not remove the need for a constraint - write both where both apply: `<T extends object = Record<string, unknown>>`.

## `const` type parameters

`const` on a type parameter infers literal types from the argument without the caller writing `as const`:

```typescript
function routes<const T extends readonly string[]>(paths: T): T { … }

const r = routes(['/a', '/b']);        // readonly ['/a', '/b'], not string[]
```

Use it on APIs whose value lies in the exact literals - route tables, config keys, state machine definitions. It moves the burden off the call site, which is where it does not belong.

## `NoInfer`

Stops a position from contributing to inference:

```typescript
function withDefault<T>(values: readonly T[], fallback: NoInfer<T>): T { … }

withDefault(['a', 'b'], 'c');          // error - 'c' is not 'a' | 'b'
```

Without `NoInfer`, `T` widens to include the fallback and the mistake compiles. Reach for it whenever one parameter should be *checked against* a type inferred from another, rather than widening it.

## Variance annotations

`in` and `out` on a type parameter declare its variance explicitly:

```typescript
interface Producer<out T> { get(): T }
interface Consumer<in T> { accept(value: T): void }
```

These are a **performance and clarity** tool, not a correctness one - TypeScript already infers variance structurally. They help on large recursive generic types where inference is slow, and they document intent. Do not add them routinely; they are noise on ordinary generics.

## Keep them shallow

A generic with four parameters, or one whose constraint is itself a conditional type, is usually solving a problem that a plain overload or two separate functions would solve more legibly. The reader has to hold every parameter in their head at once, and the error messages become unreadable.

Concretely: if the signature no longer fits on one line, reconsider.

## Naming

`T` for a single obvious parameter. `UpperCamelCase` when there is more than one, or when the name carries meaning - `TKey`, `TValue`, `TResult`. A single letter that is not `T` (`K`, `V`, `E`) is fine where the convention is well established. See [naming.md](naming.md).

## Version notes

- **`const` type parameters** need 5.0+.
- **`NoInfer`** needs 5.4+.
- **Variance annotations** (`in`/`out`) need 4.7+.
- Inference behaviour is stable across 6.0 and 7.0 - `stableTypeOrdering` is locked on in 7.0 to keep results matching 6.0.

## Gotchas

- Agent adds a type parameter used once in the signature - that is `unknown` with extra steps
- Agent writes `function f<T>(...): T` with `T` only in the return - nothing infers it; return `unknown` or take a validator
- Agent calls a return-type-only API without an explicit type argument - it silently becomes `unknown`
- Agent leaves a type parameter unconstrained where the body assumes structure
- Agent constrains more tightly than the body needs - rejects valid callers
- Agent uses `(x: {length: number})` where `<T extends {length: number}>` was needed - the caller's precise type is lost
- Agent writes `as const` at every call site instead of a `const` type parameter on the API
- Agent lets a default parameter widen an inferred type where `NoInfer` was needed
- Agent adds `in`/`out` variance annotations routinely - they are for large recursive generics, not ordinary ones
- Agent writes a four-parameter generic - split it, or use overloads
- Agent names generic parameters `A`, `B`, `C` - use `T`, or a meaningful `TKey`/`TValue`

## Related

- [type-inference.md](type-inference.md) · [advanced-types.md](advanced-types.md) · [any-and-unknown.md](any-and-unknown.md) · [functions.md](functions.md) · [naming.md](naming.md)
