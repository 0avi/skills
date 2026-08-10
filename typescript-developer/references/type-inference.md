# Type Inference and `satisfies`

## What to annotate

Rely on inference. Annotate where inference would produce something wrong, wide, or unreadable.

**Do not annotate** what is obvious from the initialiser:

```typescript
const count: number = 0;                    // noise
const count = 0;

const re: RegExp = /ab+c/;                  // noise
const service: OrderService = new OrderService();   // noise
```

**Do annotate:**

| Case | Why |
|---|---|
| Exported function return types | The signature is the contract; inference makes it change silently |
| Anything that would otherwise infer `any` or `unknown` | Usually a generic parameter with nothing to infer from |
| An empty initialiser | `const xs = []` is `never[]` |
| A structural implementation, at its declaration | See below |
| A complex return type where the name aids reading | Judgement |

```typescript
const orders: Order[] = [];                  // required - otherwise never[]
export function load(id: string): Promise<Order> { … }
```

## Annotate structural implementations at the declaration

When a value is meant to satisfy an interface, say so where it is declared:

```typescript
const handler: RequestHandler = {
  handle(req) { … },
};
```

Without the annotation, a mismatch is reported wherever the value is eventually passed - often a different file, with a worse message. With it, the error lands on the object that is wrong. Change the interface later and the compiler points at every implementation rather than every call site.

## `satisfies`

`satisfies` checks a value against a type **without widening it to that type**. This is what people reach for `as` expecting, and do not get.

```typescript
type Config = Record<string, string | number>;

const config = {
  host: 'localhost',
  port: 8080,
} satisfies Config;

config.port.toFixed();     // works - port is still `number`
```

Compare the alternatives:

```typescript
const a: Config = {host: 'localhost', port: 8080};
a.port.toFixed();          // error - port widened to string | number

const b = {host: 'localhost', port: 8080} as Config;
b.typo;                    // no error - `as` disabled the check entirely
```

`satisfies` gives you both the check and the narrow inferred type.

**Reach for it in this order:**

1. `satisfies` - checked, and keeps the specific type
2. A type annotation - checked, but widens
3. `as` - not checked at all

Use an annotation when you *want* the widening, which is common for a variable that will be reassigned. Use `satisfies` when the literal's precise shape matters - config objects, route tables, lookup maps, anything you will index into.

It pairs with `as const` when you also want readonly literal types:

```typescript
const routes = {
  home: '/',
  orders: '/orders',
} as const satisfies Record<string, `/${string}`>;
```

## Type assertions

An assertion tells the compiler to stop checking. Every one is a place where a runtime error is possible and the type system has been told to be quiet.

**Rules when you must:**

- `value as Type`, never `<Type>value` - the angle-bracket form collides with JSX.
- Comment why it is safe. "The compiler cannot know X, but Y guarantees it."
- Prefer a runtime check. An `instanceof`, an `in`, or a type predicate ([advanced-types.md](advanced-types.md)) gives you the narrowing *and* the safety.
- Parenthesise when accessing a member: `(x as Foo).bar`.
- For a double assertion, go through `unknown`, never `any`: `x as unknown as Foo`. A double assertion is a loud signal that the types are wrong somewhere upstream.

**Non-null assertion `!`** is an assertion too, and the most-abused one:

```typescript
const user = users.find((u) => u.id === id)!;    // asserts found. It may not be.
```

Write the check. Where the invariant is genuinely guaranteed, assert it at runtime so the failure is a clear error rather than a downstream `undefined`:

```typescript
const user = users.find((u) => u.id === id);
if (!user) throw new Error(`No user ${id}`);
```

## Return type inference and `any` leakage

The commonest way `any` enters a strict codebase is an inferred return type that touches an untyped dependency:

```typescript
export function parse(raw: string) {
  return JSON.parse(raw);        // returns any - and now so does parse()
}

export function parse(raw: string): unknown {
  return JSON.parse(raw);        // caller must narrow
}
```

`JSON.parse` returns `any`. So does most of an untyped module. Annotating exported return types stops that spreading. The `no-unsafe-*` lint family catches the rest.

## Version notes

- **`satisfies`** needs 4.9+. Available on every version this skill targets.
- **`const` type parameters** (5.0+) can remove the need for `as const` at some call sites - see [generics.md](generics.md).
- Inference itself is stable across 6.0 and 7.0: `stableTypeOrdering` is locked on in 7.0 specifically so results match 6.0 rather than drifting.

## Gotchas

- Agent annotates `const count: number = 0` - inference already has it
- Agent omits the annotation on `const xs = []` - infers `never[]`, and every later push fails
- Agent omits return types on exported functions - the contract then changes silently with the body
- Agent uses `as` where `satisfies` was wanted - `as` disables checking; `satisfies` keeps it and preserves the narrow type
- Agent annotates a config object instead of using `satisfies` - widens every literal, losing the precise keys and values
- Agent uses `<Type>value` - collides with JSX; use `as`
- Agent writes `as any` as an intermediate step - go through `unknown`
- Agent uses `!` instead of checking - write the check, or throw with a message
- Agent asserts instead of narrowing - `instanceof`, `in` and type predicates give safety as well as the type
- Agent leaves an assertion uncommented - the reason it is safe is the only thing that makes it reviewable
- Agent returns `JSON.parse(...)` from a function with an inferred return type - `any` escapes into the public API

## Related

- [any-and-unknown.md](any-and-unknown.md) · [advanced-types.md](advanced-types.md) · [generics.md](generics.md) · [interfaces-and-type-aliases.md](interfaces-and-type-aliases.md) · [google-style-deltas.md](google-style-deltas.md)
