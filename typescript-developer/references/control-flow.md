# Control Flow

## Blocks

Braces on every control statement. The one permitted exception is an `if` with no `else` that fits entirely on one line:

```typescript
if (!valid) return;                     // fine

if (!valid)
  return;                               // no - brace it

for (const x of xs) {
  process(x);
}
```

## Assignment in conditions

Avoid it. Where it genuinely reads better, double-parenthesise so the intent is unmistakable:

```typescript
while ((match = re.exec(input)) !== null) { … }
```

Without the extra parentheses a reader cannot tell `=` from a mistyped `===`.

## Iteration

| Iterating | Use |
|---|---|
| Array values | `for (const x of xs)` |
| Array with index | `for (const [i, x] of xs.entries())` |
| Object keys | `for (const k of Object.keys(obj))` |
| Object entries | `for (const [k, v] of Object.entries(obj))` |
| `Map` / `Set` | `for...of` directly |
| Transform to a new array | `.map()` |

**Never bare `for...in`** - it walks the prototype chain, and on an array it yields string indices. If it is unavoidable, guard with `Object.hasOwn(obj, key)`.

Prefer `for...of` to `.forEach()` when the body might `return`, `break`, `continue`, or `await` - none of those work as written inside a `forEach` callback. An `await` inside `forEach` is a particularly quiet bug: the loop does not wait. See [async-and-promises.md](async-and-promises.md).

Indexed `for` loops are fine where you genuinely need the index arithmetic - iterating backwards, striding, or mutating the array as you go.

## Switch

Every `switch` has a `default`, placed last. Non-empty cases must end in `break`, `return`, or `throw`; empty cases may fall through to group values.

```typescript
switch (status) {
  case 'draft':
  case 'pending':          // empty fallthrough - fine
    return 'editable';
  case 'submitted':
    return 'locked';
  default:
    return 'unknown';
}
```

Enable `noFallthroughCasesInSwitch` ([tsconfig.md](tsconfig.md)) so the compiler enforces this rather than a reviewer.

### Exhaustiveness

Over a union, prove you handled every case:

```typescript
type Status = 'draft' | 'submitted' | 'accepted';

function label(status: Status): string {
  switch (status) {
    case 'draft':     return 'Draft';
    case 'submitted': return 'Submitted';
    case 'accepted':  return 'Accepted';
    default:
      return assertNever(status);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
```

Add a member to `Status` and the `default` branch fails to compile, naming the file that needs updating. Without it, the new case silently falls to a default that returns something wrong.

This is the main reason literal unions beat enums - see [enums-and-constants.md](enums-and-constants.md). `@typescript-eslint/switch-exhaustiveness-check` enforces it.

## Equality

`===` and `!==`, always. The single exception is `== null`, which tests for `null` and `undefined` together and is the idiomatic way to do so:

```typescript
if (value != null) { … }        // not null and not undefined
```

Configure `eqeqeq` as `["error", "always", {"null": "ignore"}]`.

Note the traps `===` does not solve: `NaN === NaN` is `false` - use `Number.isNaN`. Objects compare by reference, so `{a: 1} === {a: 1}` is `false`.

## Grouping parentheses

Omit them where precedence is unambiguous to every reader; keep them where mixing operators would make someone check. Never wrap the whole operand of `return`, `throw`, `typeof`, `void`, `delete`, `case`, `in`, `of` or `yield`.

Mixing `&&` with `||`, or `??` with either, deserves parentheses - TypeScript actually requires them for `??` mixed with `&&`/`||`.

## Labels and `continue`

Avoid labelled statements. A loop that needs a label is usually a function whose inner loop should `return`.

## Version notes

Version-agnostic. `Object.hasOwn` needs `lib: es2022`; `Array.prototype.entries` needs ES2015. Both are below the assumed baseline.

`noUncheckedIndexedAccess` makes indexed `for` loops produce `T | undefined` on each access, which is one more reason to prefer `for...of`.

## Gotchas

- Agent omits braces on a multi-line `if` body
- Agent writes an assignment inside a condition without the extra parentheses - indistinguishable from a typo
- Agent uses bare `for...in` - walks the prototype chain and yields string indices on arrays
- Agent uses `.forEach()` with an `await` inside - the loop does not wait
- Agent uses `.forEach()` where the body needs to `break` or `return` - it cannot
- Agent omits the `default` case
- Agent lets a non-empty case fall through without `break`, `return` or `throw`
- Agent writes a `switch` over a union with no `assertNever` in the default - adding a union member then silently produces wrong output instead of a compile error
- Agent uses `==` - `===` everywhere except `!= null`
- Agent compares with `=== NaN` - always false; use `Number.isNaN`
- Agent mixes `&&` and `||` without parentheses
- Agent reaches for a labelled `break` - extract a function and `return`

## Related

- [variables-and-literals.md](variables-and-literals.md) · [enums-and-constants.md](enums-and-constants.md) · [advanced-types.md](advanced-types.md) · [async-and-promises.md](async-and-promises.md) · [tsconfig.md](tsconfig.md)
