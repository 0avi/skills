# Interfaces and Type Aliases

## The rule

**`interface` for object shapes. `type` for everything an interface cannot express.**

```typescript
interface Order {                       // object shape
  id: string;
  total: number;
}

type Status = 'draft' | 'submitted';    // union - interface cannot do this
type Handler = (e: Event) => void;      // function type
type Id = string;                       // alias for a primitive
type Partial2<T> = {[K in keyof T]?: T[K]};   // mapped type
```

Google's rule is often quoted as "prefer interfaces over type aliases", which overstates it. The actual rule is about `type X = { ... }` - object-literal aliases specifically. Unions, functions, primitives, mapped and conditional types have no interface form; nobody is suggesting otherwise. Read that way it matches the TypeScript handbook's own heuristic: use `interface` until you need something only `type` provides.

## Why interface for object shapes

**Extension is cheaper than intersection.** An interface declared with `extends` is cached by name in the compiler's internal registry, so later checks against it are fast. An intersection `A & B` is re-evaluated structurally. On a large codebase this is a measurable difference, and it is the TypeScript team's own stated performance guidance.

```typescript
interface Admin extends User { permissions: string[] }   // cached
type Admin = User & {permissions: string[]};             // re-evaluated
```

**Errors read better.** An interface has a name that appears in messages. An intersection expands into its members.

## Declaration merging - the one real hazard

Two interfaces with the same name in the same scope merge silently:

```typescript
interface Config { host: string }
interface Config { port: number }
// Config is now {host: string; port: number} - no error
```

A type alias errors on redeclaration instead, which is why some experienced practitioners argue for defaulting to `type`. The concern is genuine, and it is the strongest argument against the rule above.

In practice it is manageable: merging only happens within a scope or via module augmentation, so it requires two declarations of the same name in the same module - which is a mistake a reviewer catches. Weighed against the extension-caching benefit and better error messages, interface remains the better default for object shapes.

Where merging is a real risk - a widely-imported name in a large shared module - a type alias is a reasonable local choice. Be consistent within a module.

Merging is also occasionally what you want, for augmenting a third-party type:

```typescript
declare module 'express' {
  interface Request { user?: User }
}
```

That is the sanctioned use, and it only works with interfaces.

## `extends` versus `&`

Use `extends`. Besides the caching, it *checks* - an incompatible override is an error:

```typescript
interface A { x: string }
interface B extends A { x: number }     // error, correctly

type C = A & {x: number};               // x becomes `never`, silently
```

The intersection produces `never` for `x` and reports nothing. You find out when a value fails to be assignable for reasons that make no sense.

## Do not prefix or suffix

No `IOrder`, no `OrderInterface`, no `TStatus`. The name is the concept; whether it is an interface is not the caller's business and may change. See [naming.md](naming.md).

## `readonly` in types

Mark what should not be mutated:

```typescript
interface Order {
  readonly id: string;
  readonly lines: readonly OrderLine[];
}
```

`readonly` on a property prevents reassignment, not deep mutation - `readonly lines: OrderLine[]` still allows `lines.push()`. Use `readonly T[]` for the array itself. See [arrays-and-collections.md](arrays-and-collections.md).

## Derive rather than duplicate

When one type is a function of another, say so:

```typescript
type OrderId = Order['id'];
type OrderKeys = keyof Order;
type CreateOrder = Omit<Order, 'id' | 'createdAt'>;
```

Duplicating the shape means the two drift. But keep it shallow - a type built from four chained utilities is unreadable and breaks find-references. See [advanced-types.md](advanced-types.md).

## Version notes

Version-agnostic. `interface`, `type`, declaration merging and the utility types are stable across 5.x, 6.0 and 7.0.

`@typescript-eslint/consistent-type-definitions` enforces the choice; set it to `"interface"` to match this rule.

## Gotchas

- Agent uses `type X = { ... }` for an object shape - use an interface
- Agent cites "prefer interfaces" to reject a union or function type alias - the rule covers object literals only
- Agent uses `A & B` where `extends` would work - no caching, and an incompatible member silently becomes `never`
- Agent declares the same interface name twice in a module - they merge silently
- Agent names an interface `IOrder` or `OrderInterface`
- Agent writes `readonly lines: OrderLine[]` and expects the array to be immutable - use `readonly OrderLine[]`
- Agent duplicates a shape instead of deriving it with `Omit`, `Pick` or an indexed access
- Agent chains four utility types into one alias - unreadable, and find-references stops working
- Agent uses a type alias for a shape another module needs to augment - only interfaces merge

## Related

- [type-inference.md](type-inference.md) · [advanced-types.md](advanced-types.md) · [arrays-and-collections.md](arrays-and-collections.md) · [naming.md](naming.md) · [classes.md](classes.md) · [google-style-deltas.md](google-style-deltas.md)
