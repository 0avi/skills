# Functions

## Which form

| Situation | Form |
|---|---|
| Named top-level function | `function` declaration |
| Callback | Arrow function |
| Nested helper | Either; arrow inside a method body so `this` carries |
| Needs a `this` parameter or is a generator | `function` |
| Anything else | Arrow function |

```typescript
export function parseSubmission(raw: string): Submission { … }   // declaration

const parse = function (raw: string) { … };                      // banned: function expression
const parse = (raw: string) => { … };                            // arrow, if you need a const
```

Function declarations hoist and carry their name into stack traces. Function expressions do neither and have no advantage over an arrow - the only reasons to write one are a dynamic `this` (discouraged, below) or a generator.

### Arrow bodies

Concise body only when the value is used:

```typescript
items.map((x) => x.id);                    // value consumed
items.forEach((x) => void save(x));        // value discarded - `void` makes that explicit
items.forEach((x) => { save(x); });        // or a block body
```

A concise body whose value is ignored is a trap: it silently returns whatever the last expression produced, which matters when the callback's return type is checked - the classic case being an `async` callback passed where `void` is expected, which turns into an unhandled promise. See [async-and-promises.md](async-and-promises.md).

## `this`

**Never rebind `this`.** All three of these are banned:

```typescript
const self = this;
fn.bind(this);
function () { … }.call(this);
```

Use an arrow function, which closes over the lexical `this`, or pass the value you need as a parameter. `this` is legitimate only in a class constructor or method, an arrow function inside one, or a function with an explicit `this` parameter:

```typescript
function handler(this: HTMLElement, event: Event) { … }   // explicit, checked
```

Outside those, `this` refers to something you did not intend - the module, `undefined` under strict mode, or an event target.

### Arrow properties on classes

```typescript
class Foo {
  handle = () => { … };     // avoid by default
  handle() { … }            // prefer
}
```

An arrow property is created per instance rather than shared on the prototype, and it silently changes what subclassing and spying do. The legitimate case is a handler that must be removable:

```typescript
class Widget {
  readonly #onClick = (e: Event) => { … };   // stable reference

  attach(el: Element) { el.addEventListener('click', this.#onClick); }
  detach(el: Element) { el.removeEventListener('click', this.#onClick); }
}
```

Never `addEventListener('click', this.onClick.bind(this))` - `bind` returns a new function each call, so the listener can never be removed. That is a leak, not a style issue.

## Parameters

**Defaults must be side-effect-free and simple.** A default that calls a function runs on every call that omits the argument, which is rarely what people expect.

**More than two or three parameters, or any boolean flag, becomes an options object:**

```typescript
createOrder(customerId, true, false, 30);              // unreadable at the call site
createOrder(customerId, {express: true, dryRun: false, timeoutSeconds: 30});
```

A boolean parameter is unreadable at every call site, always. Name it.

**Rest over `arguments`:**

```typescript
function log(...parts: string[]) { … }     // typed, real array
```

Never name anything `arguments`. Use spread rather than `Function.prototype.apply`. No space after `...`.

## Return types

Inference is fine for most functions. Annotate when the function is exported, when the inferred type would be wide or surprising, or when you want the compiler to catch a change in what the body returns rather than propagating it to callers. See [type-inference.md](type-inference.md).

Annotate `Promise<T>` explicitly on exported async functions - an inferred promise type is where accidental `any` most often escapes into a public API.

## Overloads

Prefer a union parameter or an optional parameter to an overload set. Overloads have real costs: the implementation signature is not checked against the overloads as strictly as people assume, and the call site loses the relationship between argument and return type.

When they are genuinely warranted - different argument shapes producing different return types - order them most specific first, and keep the implementation signature private to the module:

```typescript
export function parse(input: string): Submission;
export function parse(input: Buffer, encoding: BufferEncoding): Submission;
export function parse(input: string | Buffer, encoding?: BufferEncoding): Submission { … }
```

Often a generic with a conditional return type, or two separately named functions, is clearer than either. Two names is usually the right answer.

## Version notes

Version-agnostic. `this` parameters, rest parameters and default parameters are stable across 5.x, 6.0 and 7.0.

One interaction to note: with `erasableSyntaxOnly` on, parameter *properties* are banned ([classes.md](classes.md)) - ordinary parameters and defaults are unaffected.

## Gotchas

- Agent writes a function expression - use a declaration for a named function, an arrow otherwise
- Agent uses `const self = this` or `.bind(this)` - use an arrow function or pass the value
- Agent registers a listener with `.bind(this)` - a new reference each call, so it can never be removed
- Agent gives a class an arrow property by default - per-instance allocation and altered subclass behaviour; use a method
- Agent writes a concise arrow body whose value is discarded - use a block body, or `void`
- Agent passes an `async` callback where `void` is expected - the returned promise floats
- Agent adds a boolean parameter - unreadable at the call site; use an options object
- Agent writes a default parameter that calls a function - it runs on every call that omits the argument
- Agent reads `arguments` - use rest parameters
- Agent reaches for overloads first - a union or optional parameter usually beats them, and two names usually beat both
- Agent omits the return type on an exported async function - the easiest place for `any` to escape

## Related

- [classes.md](classes.md) · [type-inference.md](type-inference.md) · [async-and-promises.md](async-and-promises.md) · [variables-and-literals.md](variables-and-literals.md) · [generics.md](generics.md)
