# Advanced Types

## The restraint rule

Use the simplest construct that expresses the requirement. Mapped and conditional types are powerful and they cost:

- **Tooling degrades.** Find-references and rename stop working through a mapped type. The IDE can no longer tell you where a property is used, because the property does not exist in any source file.
- **Errors become unreadable.** A failure inside a conditional type reports the expansion, not the intent.
- **Maintenance concentrates.** A type only two people understand is a bottleneck.

Prefer an explicit interface, or `interface X extends Y`, over deriving one with utility types - unless the derivation is what keeps two things in sync. That exception is real and important:

```typescript
type CreateOrder = Omit<Order, 'id' | 'createdAt'>;   // stays correct as Order changes
```

That earns its keep. `DeepPartial<Record<keyof T, Unwrap<T[keyof T]>>>` does not.

## Discriminated unions

The most valuable type-level tool in TypeScript, and the one to reach for first. A shared literal field lets the compiler narrow the whole shape:

```typescript
type SubmissionState =
  | {status: 'draft'; savedAt: Date}
  | {status: 'submitted'; reference: string; submittedAt: Date}
  | {status: 'rejected'; reasonCode: string};

function describe(state: SubmissionState): string {
  switch (state.status) {
    case 'draft':     return `Saved ${state.savedAt.toISOString()}`;
    case 'submitted': return `Reference ${state.reference}`;
    case 'rejected':  return `Rejected: ${state.reasonCode}`;
    default:          return assertNever(state);
  }
}
```

This is how you make illegal states unrepresentable. The alternative - one interface with every field optional - permits `{status: 'draft', reference: 'X'}` and forces `!` at every read.

**Rule of thumb: two booleans or two mutually-exclusive optional fields on the same object are a discriminated union that has not been written yet.**

Pair with `assertNever` for exhaustiveness ([control-flow.md](control-flow.md)).

## Type predicates

A function whose return type is `value is T` narrows at the call site:

```typescript
function isRejected(state: SubmissionState): state is Extract<SubmissionState, {status: 'rejected'}> {
  return state.status === 'rejected';
}
```

**The compiler does not verify the body.** A predicate that returns `true` unconditionally type-checks fine and lies to every caller. Treat writing one as writing an assertion, and keep the body trivially obviously correct.

From 5.5, TypeScript **infers** predicates for simple functions, so many hand-written ones are now unnecessary:

```typescript
const isDefined = (x: string | undefined) => x !== undefined;
xs.filter(isDefined);          // narrows to string[] without an explicit predicate
```

Check whether inference already does it before writing one.

### Assertion functions

```typescript
function assertIsOrder(value: unknown): asserts value is Order {
  if (!isOrder(value)) throw new Error('Not an Order');
}
```

Narrows everything after the call. Requires an explicit type annotation on the declaration - it cannot be inferred, and a `const` arrow assigned without one fails at runtime in a confusing way.

## Validate at the boundary

For anything arriving from outside - HTTP, a queue, a config file, `localStorage` - a hand-written predicate is a maintenance liability, because the type and the check drift independently.

Use a schema validator and derive the type from the schema, so there is one source of truth:

```typescript
const submissionSchema = z.object({
  id: z.string().uuid(),
  total: z.number().nonnegative(),
});

type Submission = z.infer<typeof submissionSchema>;

const submission = submissionSchema.parse(await response.json());
```

Now the type cannot disagree with the validation. Inside the boundary, use the derived type and stop re-checking.

## Branded types

Structural typing means `UserId` and `OrderId` are both `string`, and swapping them compiles:

```typescript
declare const brand: unique symbol;
type Brand<T, B> = T & {readonly [brand]: B};

type UserId = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;

function loadUser(id: UserId) { … }
loadUser(orderId);              // error - correctly
```

Construct through a validating factory, which is where the brand is applied:

```typescript
function toUserId(raw: string): UserId {
  if (!/^u_[0-9a-f]{32}$/.test(raw)) throw new Error(`Invalid user id: ${raw}`);
  return raw as UserId;
}
```

The `as` inside the factory is the one sanctioned use - it is the single place the invariant is checked. Worth the ceremony for identifiers that get passed through many layers, and for validated primitives (`Email`, `PositiveInteger`). Not worth it for a local variable.

## Template literal types

```typescript
type Route = `/${string}`;
type EventName = `on${Capitalize<string & keyof Events>}`;
```

Genuinely useful for constraining string shapes - route paths, CSS units, event names. Keep them shallow: combining two template literal types multiplies the union, and a few thousand members will visibly slow the compiler.

## Utility types worth knowing

| Type | Use |
|---|---|
| `Partial<T>` / `Required<T>` | Toggle optionality |
| `Pick<T, K>` / `Omit<T, K>` | Derive a subset. `Omit` does not check `K` exists - a typo silently omits nothing |
| `Record<K, V>` | Keyed map. Over a union, forces exhaustiveness |
| `Readonly<T>` | Shallow only |
| `Extract<T, U>` / `Exclude<T, U>` | Filter a union |
| `NonNullable<T>` | Strip `null` and `undefined` |
| `ReturnType<F>` / `Parameters<F>` | Derive from a function. Resolves the *last* overload - a known trap |
| `Awaited<T>` | Unwrap a promise, recursively |
| `NoInfer<T>` | Block a position from inference ([generics.md](generics.md)) |

The `Omit` and `ReturnType` caveats catch people regularly. `Omit<T, 'typoo'>` compiles and does nothing; `ReturnType` of an overloaded function silently picks one signature.

## Version notes

- **Template literal types**, `Capitalize` and friends need 4.1+.
- **`satisfies`** needs 4.9+ ([type-inference.md](type-inference.md)).
- **`const` type parameters** need 5.0+, **`NoInfer`** 5.4+, **inferred type predicates** 5.5+.
- **`unique symbol`** for branding works on every supported version.
- Deep conditional types recurse further on 7.0's compiler before hitting the depth limit, but a type that needs the extra depth is a type to simplify, not to celebrate.

## Gotchas

- Agent reaches for a mapped or conditional type where an interface would do - find-references and rename stop working
- Agent chains four utility types into one alias - unreadable, and errors report the expansion
- Agent models mutually exclusive states as optional fields on one interface - that is a discriminated union, and the optional version needs `!` at every read
- Agent adds a second boolean flag to an object - usually the point at which a union is required
- Agent writes a type predicate whose body does not check what it claims - the compiler does not verify it
- Agent hand-writes a predicate that 5.5 would infer - check first
- Agent writes an assertion function as a `const` arrow without an explicit type annotation - it will not narrow
- Agent hand-writes validation for external data - derive the type from a schema so check and type cannot drift
- Agent re-validates inside the boundary - validate once, at the edge
- Agent uses `string` for every identifier - brand the ones that get passed through layers
- Agent applies a brand with `as` outside the validating factory - the factory is the only place the invariant is checked
- Agent nests template literal types - the union multiplies and the compiler slows
- Agent trusts `Omit<T, 'typo'>` - the key is not checked to exist
- Agent uses `ReturnType` on an overloaded function - it resolves the last overload only

## Related

- [interfaces-and-type-aliases.md](interfaces-and-type-aliases.md) · [generics.md](generics.md) · [control-flow.md](control-flow.md) · [any-and-unknown.md](any-and-unknown.md) · [type-inference.md](type-inference.md) · [enums-and-constants.md](enums-and-constants.md)
