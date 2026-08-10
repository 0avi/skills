# Nullability

## `undefined` or `null`

Both are legal. Pick per API and be consistent within a boundary.

The convention that actually holds: **JavaScript itself uses `undefined`** (`Map.get`, an absent property, a missing argument), **the DOM and many wire formats use `null`** (`Element.getAttribute`, JSON, most SQL drivers).

For new internal code, prefer `undefined` - it is what the language produces, and it composes with optional properties and parameters, which `null` does not. Use `null` where you are modelling something that crossed a boundary that uses it, and convert at that boundary rather than letting both leak inward.

Do not use both to mean different things in the same type. `string | null | undefined` almost always means nobody decided.

## Never put nullability in a type alias

```typescript
type MaybeOrder = Order | null;         // no
type Order = { … };                     // yes - add | null where it is actually optional
```

Nullability belongs at the point of use, where a reader can see which specific value can be absent:

```typescript
function find(id: string): Order | undefined { … }
```

Folding it into the alias hides where absence originates and pushes null-handling into every layer that touches the type, including the ones where it cannot be absent.

## Optional properties over `| undefined`

```typescript
interface Options {
  timeout?: number;              // yes
  retries: number | undefined;   // no - forces callers to pass it explicitly
}
```

`?` means "may be omitted". `| undefined` means "must be provided, and may be `undefined`". The second forces every call site to write `retries: undefined`, which is noise.

Same for parameters: `function f(x?: number)` over `function f(x: number | undefined)`.

## `exactOptionalPropertyTypes`

Without the flag, `?` and `| undefined` collapse together and `{timeout: undefined}` is assignable to `{timeout?: number}`. With it, they are distinct:

```typescript
interface Options { timeout?: number }

const a: Options = {};                       // absent
const b: Options = {timeout: undefined};     // error with the flag on
```

The distinction is real - `'timeout' in a` is `false`, `'timeout' in b` is `true`, and `Object.keys` differs. Code that spreads or merges options objects gets this wrong constantly:

```typescript
const merged = {...defaults, ...overrides};
// If overrides.timeout is explicitly undefined, it overwrites the default with undefined.
```

Enable it on new projects. Retrofitting is a deliberate migration. See [tsconfig.md](tsconfig.md).

## Narrowing

Let control flow do the work:

```typescript
function describe(order: Order | undefined): string {
  if (!order) return 'none';
  return order.reference;       // narrowed to Order
}
```

**Truthiness narrowing is wrong when `0` or `''` is a legitimate value:**

```typescript
if (!count) { … }               // also fires on 0
if (count === undefined) { … }
if (value != null) { … }        // null and undefined together
```

`??` and `?.` for defaults and access, not `||`:

```typescript
const timeout = options.timeout ?? 30;    // only when null/undefined
const timeout = options.timeout || 30;    // also replaces 0 - usually a bug
```

`??=`, `||=` and `&&=` exist and are fine where the plain form would be repetitive.

### Narrowing that does not survive

A narrowing on a property is lost across a function call or an `await`, because the compiler cannot know the property was not reassigned:

```typescript
if (this.#config !== undefined) {
  await something();
  this.#config.host;              // error - narrowing discarded
}

const config = this.#config;      // pull it into a const first
if (config !== undefined) {
  await something();
  config.host;                    // fine
}
```

This is the single most common cause of "TypeScript is being stupid" - it is not; the property genuinely could have changed.

## Definite assignment

`x!: T` tells the compiler a field is assigned before use without proving it. Use it only where a framework does the assigning - a DI container, a test setup hook - and never as a way to skip initialisation you could just do.

## Version notes

- **`exactOptionalPropertyTypes`** needs 5.0+, and is off by default at every version including 7.0.
- **`??`, `?.`** need ES2020; **logical assignment** needs ES2021. Both are below the assumed baseline.
- `strictNullChecks` is part of `strict`, on by default from 6.0.

## Gotchas

- Agent bakes `| null` into a type alias - put it at the point of use
- Agent uses both `null` and `undefined` in one type without a reason - pick one per boundary and convert there
- Agent writes `x: T | undefined` where `x?: T` was meant - forces every caller to pass it explicitly
- Agent enables `exactOptionalPropertyTypes` mid-task on an existing codebase - it is a migration
- Agent spreads an options object containing an explicit `undefined` over a default - the default is destroyed
- Agent uses `||` for a default where `0` or `''` is valid - use `??`
- Agent narrows with `if (!x)` where `0` is a real value
- Agent keeps a narrowing across an `await` or a function call - copy the property to a `const` first
- Agent uses `!` to dismiss a possible `undefined` - write the check
- Agent uses `x!: T` to avoid initialising a field - reserve it for framework-assigned fields

## Related

- [type-inference.md](type-inference.md) · [tsconfig.md](tsconfig.md) · [arrays-and-collections.md](arrays-and-collections.md) · [control-flow.md](control-flow.md) · [any-and-unknown.md](any-and-unknown.md)
