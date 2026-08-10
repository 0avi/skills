# Arrays and Collections

## `T[]` or `Array<T>`

**`T[]` for simple element types. `Array<T>` when the element type is complex enough that brackets get lost.**

```typescript
string[]                        // simple
readonly string[]
string[][]

Array<string | number>          // union - parentheses would be needed otherwise
Array<{id: string; total: number}>
Array<() => void>
ReadonlyArray<string | null>
```

The test is whether a reader can see where the element type ends. `(string | number)[]` is legal and worse. `@typescript-eslint/array-type` with `"array-simple"` encodes exactly this.

## `readonly`

Default to `readonly` for anything a function receives and should not mutate:

```typescript
function total(lines: readonly OrderLine[]): number { … }
```

It documents intent and the compiler enforces it. `readonly T[]` prevents `push`, `pop`, `sort` and the rest of the mutating methods; it does not deep-freeze the elements.

Note `readonly T[]` is not assignable to `T[]`, which is correct and occasionally inconvenient - a function that genuinely needs a mutable copy should make one with `[...xs]`.

## `noUncheckedIndexedAccess`

With the flag on ([tsconfig.md](tsconfig.md)), every indexed read yields `T | undefined`:

```typescript
const first = xs[0];            // string | undefined
first.toUpperCase();            // error - correctly
```

This is not pedantry: `xs[0]` on an empty array is `undefined` at runtime, and without the flag the compiler tells you it is a `string`.

Handle it by checking, or by using a method that models absence honestly:

```typescript
const first = xs.at(0);         // string | undefined regardless of the flag
if (first !== undefined) { … }

const [head] = xs;              // also T | undefined under the flag
```

`.at()` accepts negative indices, so `xs.at(-1)` is the clean way to get the last element.

The flag does **not** apply to a `for...of` loop variable, which is one more reason to prefer it over indexed iteration.

## Index signatures

Label the key so it means something:

```typescript
interface Cache { [userName: string]: Order }     // yes
interface Cache { [key: string]: Order }          // says nothing
```

But prefer `Record` for a fixed value type, and a `Map` for an actual keyed collection:

```typescript
type Cache = Record<string, Order>;
type StatusLabels = Record<Status, string>;       // exhaustive over a union - the compiler
                                                   // requires every member
```

`Record<Status, string>` over a literal union is genuinely useful: add a status and every `Record` fails to compile until you supply the label. That is the same exhaustiveness benefit as `assertNever` in a switch ([control-flow.md](control-flow.md)).

`@typescript-eslint/consistent-indexed-object-style` enforces `Record` where it applies.

## `Map` and `Set` over objects

Use a `Map` when keys are dynamic, non-string, or numerous:

| | Object / `Record` | `Map` |
|---|---|---|
| Keys | strings and symbols only | any value |
| Prototype keys | `toString`, `constructor` etc. are present | none |
| Size | `Object.keys(o).length` | `.size` |
| Iteration order | integer-like keys sort first | insertion order |
| Delete | `delete o[k]` - deoptimises the object | `.delete(k)` |

The prototype row is the one that causes incidents. `({} as Record<string, unknown>)['constructor']` returns a function, not `undefined`. If you must use an object as a dictionary of untrusted keys, create it with `Object.create(null)` - or just use a `Map`.

Use a `Record` for a fixed, known set of keys. Use a `Map` for a collection that grows.

## Tuples

Use tuple syntax for genuinely positional pairs, and label the elements:

```typescript
type Entry = [key: string, value: number];
const [key, value] = entry;
```

Labels appear in tooltips and error messages and cost nothing.

Beyond two elements, or where the meaning is not positional, use an object - `{host: string; port: number}` says what a `[string, number]` does not.

`as const` produces a readonly tuple, which is what you usually want from a literal:

```typescript
const pair = ['a', 1] as const;    // readonly ['a', 1]
const pair = ['a', 1];             // (string | number)[]
```

## Iteration and transformation

Prefer the array methods for transformation and `for...of` for effects:

```typescript
const ids = orders.map((o) => o.id);
const open = orders.filter((o) => o.status === 'open');
const total = orders.reduce((sum, o) => sum + o.total, 0);

for (const order of orders) {
  await persist(order);            // effects, and `await` works here
}
```

`reduce` is fine for a genuine fold; it is the wrong tool for building an object or an array, where `Object.fromEntries` and `map`/`filter` are clearer.

Do not `await` inside `.forEach()` - the callback's promise is discarded and the loop does not wait. See [async-and-promises.md](async-and-promises.md).

`.sort()` mutates and compares as strings by default. `[...xs].sort((a, b) => a - b)` for numbers. `toSorted()`, `toReversed()` and `with()` are the non-mutating forms (ES2023).

## Version notes

- **`Array.prototype.at`** needs ES2022; **`toSorted`/`toReversed`/`with`/`findLast`** need ES2023. Set `lib` accordingly if you use them.
- **`Object.groupBy`/`Map.groupBy`** need ES2024.
- `noUncheckedIndexedAccess` is a flag, not a version - off by default at every version including 7.0.
- **6.0+** - the floating `target` sits above ES2022, so `at` is available without extra configuration; pin `lib` explicitly if you need a fixed floor.

## Gotchas

- Agent writes `(string | number)[]` - use `Array<string | number>`
- Agent writes `Array<string>` for a simple type - `string[]`
- Agent omits `readonly` on a parameter the function does not mutate
- Agent writes `readonly lines: OrderLine[]` and expects an immutable array - the property is readonly, the array is not
- Agent indexes an array and uses the result without checking under `noUncheckedIndexedAccess`
- Agent uses `xs[xs.length - 1]` - `xs.at(-1)` says it
- Agent uses an object as a dictionary for untrusted keys - prototype keys are present; use a `Map`
- Agent uses an index signature where `Record` over a union would give exhaustiveness
- Agent leaves an index-signature key named `key` - name what it is
- Agent returns a tuple of three or more elements - use an object
- Agent omits tuple element labels
- Agent calls `.sort()` on numbers - the default comparator is lexicographic
- Agent calls `.sort()` on an array it does not own - it mutates; copy first or use `toSorted`
- Agent `await`s inside `.forEach()` - the loop does not wait
- Agent uses `reduce` to build an object - `Object.fromEntries` is clearer

## Related

- [variables-and-literals.md](variables-and-literals.md) · [tsconfig.md](tsconfig.md) · [nullability.md](nullability.md) · [control-flow.md](control-flow.md) · [async-and-promises.md](async-and-promises.md) · [interfaces-and-type-aliases.md](interfaces-and-type-aliases.md)
