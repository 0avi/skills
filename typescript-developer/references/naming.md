# Naming

## The casing table

| Style | Applies to |
|---|---|
| `UpperCamelCase` | Classes, interfaces, type aliases, type parameters, decorators, JSX/TSX components, `as const` object members |
| `lowerCamelCase` | Variables, parameters, functions, methods, properties, module namespace aliases |
| `CONSTANT_CASE` | Module-level constants that are deeply immutable |

Enforce with `@typescript-eslint/naming-convention` ([enforcement.md](enforcement.md)).

## Identifiers

**ASCII letters and digits only.** Underscores appear only in `CONSTANT_CASE` and in test names. `$` only where a framework requires it, or for the RxJS observable-suffix convention (`orders$`) if the team uses it - consistently or not at all.

**No decorative affixes.** No `IOrder`, no `OrderInterface`, no `TStatus`, no `opt_` prefix, no trailing or leading underscore for "private". Privacy is expressed by `#` or `private` ([classes.md](classes.md)), not by a naming convention.

## Descriptive names

The name should be clear to someone who has not read the file. Avoid abbreviations that are not universal in the domain - `submissionCount`, not `subCnt`.

Single-letter names are acceptable only in a scope of roughly ten lines or fewer: a loop index, a short callback parameter, a type parameter.

Names that say nothing, and what to do instead:

| Avoid | Ask |
|---|---|
| `data`, `info`, `item`, `obj`, `value` | What is it? `submission`, `orderLine` |
| `handleIt`, `doStuff`, `process` | What does it do? `retrySubmission` |
| `Manager`, `Helper`, `Util`, `Service` (alone) | What does it own? `SubmissionRetryQueue` |
| `flag`, `temp`, `result` | What does it mean? `isSubmitted`, `parsedTotal` |

A linter checks the casing and never the meaning. This is a review responsibility.

### Booleans and functions

Booleans read as predicates: `isSubmitted`, `hasErrors`, `canRetry`, `shouldRefresh`. Not `submitted` or `errorFlag`.

Functions lead with a verb: `parseSubmission`, `loadOrder`, `toDisplayString`. A function named as a noun reads like a value at the call site.

Do not encode the type in the name - `orderList`, `nameStr`, `countNum` all restate what the type already says. `orders` is the array.

## Acronyms are words

```typescript
loadHttpUrl();        // yes
loadHTTPURL();        // no
class XmlParser { }   // yes
class XMLParser { }   // no
```

The exception is a platform name you do not control: `XMLHttpRequest`.

## Constants

`CONSTANT_CASE` is narrower than "declared with `const`". It is for a module-level value that is **deeply immutable** and treated as fixed:

```typescript
export const MAX_RETRIES = 3;
export const DEFAULT_TIMEOUT_MS = 30_000;

const activeUsers = new Map<string, User>();     // const binding, mutable value
function f() {
  const parsedTotal = compute();                 // local
}
```

A local is always `lowerCamelCase`, however constant it is. A `const` holding a mutable object is `lowerCamelCase`.

Members of an `as const` object take `UpperCamelCase` - `OrderStatus.Draft` ([enums-and-constants.md](enums-and-constants.md)).

## Type parameters

`T` for a single obvious one. `UpperCamelCase` with a `T` prefix when there is more than one, or when the name carries meaning: `TKey`, `TValue`, `TResult`. Well-established single letters (`K`, `V`, `E`) are fine in their conventional roles. Never `A`, `B`, `C`.

## Aliases

An alias keeps the casing of what it aliases. Use `const` for a value alias and `readonly` for a field alias, so the alias cannot drift from its source:

```typescript
const {Draft} = OrderStatus;
import {from as observableFrom} from 'rxjs';
```

## Files

`kebab-case.ts`, matching the primary export: `order-service.ts` exports `OrderService`. Tests sit beside the source as `order-service.test.ts`. See [file-structure.md](file-structure.md).

## Test names

Test descriptions may use `_` to separate clauses, which is the one place underscores are permitted in an identifier-like position:

```typescript
it('returns_empty_when_no_orders_match', … );
it('returns empty when no orders match', … );     // also fine; be consistent
```

Prefer whatever the project already does. See [testing.md](testing.md).

## Version notes

Version-agnostic. Naming is unchanged across 5.x, 6.0 and 7.0.

`@typescript-eslint/naming-convention` is a lint rule, so it is unavailable on 7.0 until the programmatic API lands in 7.1 ([enforcement.md](enforcement.md)).

## Gotchas

- Agent prefixes an interface with `I`, or suffixes it with `Interface`
- Agent prefixes a type parameter with `T` when it is the only one - just `T`
- Agent names type parameters `A`, `B`, `C`
- Agent uses a leading or trailing underscore to mean private - use `#` or `private`
- Agent writes `loadHTTPURL` - acronyms are words
- Agent uses `CONSTANT_CASE` for a local, or for a `const` holding a mutable object
- Agent uses `CONSTANT_CASE` for every `const` - it is for deeply immutable module-level values
- Agent names something `data`, `info`, `handleIt` or `Manager`
- Agent names a boolean `submitted` rather than `isSubmitted`
- Agent names a function with a noun - lead with a verb
- Agent encodes the type in the name: `orderList`, `nameStr`
- Agent uses a single-letter name in a scope longer than about ten lines
- Agent adds `$` outside the observable convention or a framework requirement
- Agent assumes the linter validates name quality - it checks casing only

## Related

- [file-structure.md](file-structure.md) · [enums-and-constants.md](enums-and-constants.md) · [classes.md](classes.md) · [interfaces-and-type-aliases.md](interfaces-and-type-aliases.md) · [generics.md](generics.md) · [testing.md](testing.md) · [enforcement.md](enforcement.md)
