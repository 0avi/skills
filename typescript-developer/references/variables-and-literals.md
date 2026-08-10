# Variables and Literals

## Declarations

**`const` by default, `let` when reassigned, never `var`.**

`var` is function-scoped and hoisted, which produces bugs that survive review. `const` and `let` are block-scoped. There is no case for `var` in new code.

`const` only prevents rebinding, not mutation - `const xs = []; xs.push(1)` is legal. That is still worth having: it tells the reader this binding never points at something else.

**One variable per declaration.** `let a = 1, b = 2;` is banned - the comma form makes diffs noisier and makes it easy to miss that only the first has a type annotation.

Declare at first use, not at the top of the function, and never use a variable before its declaration.

## Array literals

Never `Array()`, with or without `new`:

```typescript
new Array(2);      // [ <2 empty items> ] - a length, not a value
new Array(2, 3);   // [2, 3] - different behaviour for the same call shape
[2];               // unambiguous
[2, 3];
```

The one-argument and two-argument forms mean entirely different things. For a pre-sized array, say so explicitly:

```typescript
Array.from<number>({length: 5}).fill(0);   // [0, 0, 0, 0, 0]
```

**Never set non-index properties on an array.** An array with a `name` property is a `Map` or an object wearing the wrong type.

### Spread

Spread copies shallowly and concatenates. The spread operand must always be an array:

```typescript
const bar = [5, ...(shouldUseFoo && foo)];   // spreads `false` when the guard fails
const foo = shouldUseFoo ? [7] : [];         // make the conditional produce an array
const bar = [5, ...foo];
```

### Destructuring

```typescript
const [a, b, c, ...rest] = generateResults();
const [, second, , fourth] = someArray;          // elide what you do not use

function destructured([a = 4, b = 2] = []) { … }  // default is []
function bad([a, b] = [4, 2]) { … }               // non-empty default hides arity
```

Prefer object destructuring where you can - it names each element and lets each carry its own type. Array destructuring is for genuinely positional data.

Under `noUncheckedIndexedAccess`, array destructuring yields `T | undefined` per element. That is correct: nothing guarantees the array had that many elements.

## Object literals

Never `new Object()`. Use `{}`.

### Iterating

Bare `for...in` walks the prototype chain and is banned:

```typescript
for (const k in obj) { … }                    // includes inherited keys

for (const k of Object.keys(obj)) { … }        // preferred
for (const [k, v] of Object.entries(obj)) { … }
```

If you must use `for...in`, guard it with `Object.hasOwn(obj, k)` - the modern replacement for `obj.hasOwnProperty(k)`, which itself breaks on an object with a null prototype.

### Spread

Later keys win. The operand must be an object, never an array or primitive:

```typescript
const merged = {...defaults, ...overrides};
const bad = {num: 5, ...(flag && foo)};       // spreads `false` when the guard fails
```

With `exactOptionalPropertyTypes`, spreading an object with an explicit `undefined` value is not the same as omitting the key. See [nullability.md](nullability.md).

### Computed keys

Permitted for `Symbol` keys. Otherwise, do not mix quoted or computed keys with plain ones in the same literal - a literal is either a struct or a dictionary, and mixing the two hides which:

```typescript
const iterable = {[Symbol.iterator]: function* () { … }};   // fine
const mixed = {normalKey: 1, ['dictKey']: 2};                // pick one style
```

### Destructuring parameters

One level, shorthand only. No nesting, no computed keys, and defaults on the left:

```typescript
function fn({num, str = 'default'}: Options = {}) { … }        // good
function fn({x: {num, str}}: {x: Options}) { … }               // too deep
function fn({num, str}: Options = {num: 42, str: 'd'}) { … }   // non-trivial default
```

## Strings

**Single quotes.** Use a template literal rather than escaping a quote inside a string.

**No line continuations** - a backslash at end of line breaks silently on trailing whitespace:

```typescript
const s = 'one \
  two';                        // banned
const s = `one
  two`;                        // template literal
const s = 'one ' + 'two';      // or concatenation
```

**Template literals** over concatenation whenever more than one piece is involved. They also span lines without forcing indentation to match.

Beware what a template literal does to a non-string: `` `${obj}` `` yields `[object Object]` and `` `${arr}` `` silently joins with commas. Neither is an error.

## Numbers

Decimal, hex, octal or binary. Lowercase `0x`, `0o`, `0b` prefixes. No leading zero except as part of one of those prefixes - `0755` is not the octal you meant.

Use `_` separators for long numbers: `1_000_000`.

## Coercion

| Conversion | Use | Never |
|---|---|---|
| To string | `String(x)`, or a template literal | `'' + x` |
| To boolean | `!!x`, or the value directly in a condition | `Boolean(x)` inside an `if` |
| To number | `Number(x)`, then check `Number.isNaN` | `+x`, `parseInt(x)` |

`Number()` over `parseInt()`: `parseInt('12abc')` is `12`, silently. `Number('12abc')` is `NaN`, which you can detect. Use `parseInt` only with an explicit radix for non-base-10 input. For an integer, `Number()` then `Math.trunc()`.

Do not write an explicit coercion inside a condition - `if (x)` not `if (Boolean(x))`. But do use an explicit comparison when the falsy set matters:

```typescript
if (count) { … }            // wrong when 0 is meaningful
if (count > 0) { … }
if (name !== '') { … }
if (value != null) { … }    // the one sanctioned == - covers null and undefined
```

## Version notes

Version-agnostic. `Object.hasOwn` needs `lib: es2022`, and numeric separators need ES2021 - both are below the ES2022 target this skill assumes ([tsconfig.md](tsconfig.md)).

`noUncheckedIndexedAccess` changes what indexing and array destructuring return; it is a flag rather than a version, and off by default at every version.

## Gotchas

- Agent uses `var` - block scoping only; `const` then `let`
- Agent declares several variables in one statement - one per statement
- Agent calls `new Array(n)` - the one- and two-argument forms mean different things
- Agent spreads a `&&` expression - spreads `false` when the guard fails; make the conditional yield an array or object
- Agent uses bare `for...in` - walks the prototype chain; use `Object.keys`/`entries`
- Agent calls `obj.hasOwnProperty(k)` - breaks on a null-prototype object; use `Object.hasOwn`
- Agent uses double quotes - single quotes, and template literals to avoid escaping
- Agent concatenates three or more pieces - use a template literal
- Agent interpolates an object into a template literal - silently yields `[object Object]`
- Agent uses `parseInt` for base-10 input - it accepts trailing garbage; use `Number` and check `Number.isNaN`
- Agent uses unary `+` to convert a string - unreadable and accepts more than it should
- Agent writes `if (Boolean(x))` - redundant inside a condition
- Agent writes `if (count)` where `0` is a real value - compare explicitly
- Agent nests destructuring in a parameter list - one level, shorthand only

## Related

- [functions.md](functions.md) · [control-flow.md](control-flow.md) · [nullability.md](nullability.md) · [arrays-and-collections.md](arrays-and-collections.md) · [naming.md](naming.md)
