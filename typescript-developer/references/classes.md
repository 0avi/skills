# Classes

## Privacy

**`#private` for internals at target ES2022 or above. `protected` where subclasses need access. `private` below ES2022, or in a codebase already committed to it.**

```typescript
class OrderService {
  #cache = new Map<string, Order>();

  get(id: string): Order | undefined {
    return this.#cache.get(id);
  }
}
```

`#` is a real runtime boundary - nothing outside the class body can read the field, in TypeScript or in JavaScript. `private` is erased at compile time; any JavaScript consumer, and any `obj['field']` escape hatch, walks straight through it.

This departs from the Google guide, which bans `#` on the grounds of downlevel emit cost. That cost is real below ES2022, where `#` compiles to a `WeakMap`. At ES2022 and above it is native and free. See [google-style-deltas.md](google-style-deltas.md) for the full reasoning and its limits.

Three things `#` cannot do, all of which are legitimate reasons to use `private` instead:

- There is no `#protected`. A field a subclass must reach is `protected`.
- A field a test needs to reach directly. Prefer restructuring the test, but a `private` field is better than an exported internal.
- A field a framework reads reflectively, or a template reads by name - Angular templates cannot see `#` or `private` members, so those are `protected` or public.

**Never bypass visibility with `obj['field']`.** It defeats the only signal a reader has about what is internal, and it breaks any minifier that renames properties.

## Members

**`readonly` on anything never reassigned after construction.** It costs nothing and documents intent. It does not make the value deeply immutable - a `readonly` array field can still be pushed to.

**Initialize fields where they are declared**, not in the constructor, when the value does not depend on constructor arguments:

```typescript
class Foo {
  readonly #users: string[] = [];       // here
}
```

**Do not use `public`.** Members are public by default; the modifier is noise. The one place it is required is a public parameter property.

## Parameter properties

Google requires these. This skill makes them conditional, because they are not erasable syntax:

```typescript
// Google's form - banned under erasableSyntaxOnly and by Node's type stripper
class Foo {
  constructor(private readonly barService: BarService) {}
}

// Default: declare the field
class Foo {
  readonly #barService: BarService;

  constructor(barService: BarService) {
    this.#barService = barService;
  }
}
```

Use parameter properties **only** where a framework's dependency injection requires them - Angular, NestJS - and then leave `erasableSyntaxOnly` off. Everywhere else, write the field. See [tsconfig.md](tsconfig.md).

## Constructors

Always parenthesise: `new Foo()`, never `new Foo`. `new Foo.Bar()` and `new Foo().Bar()` mean different things.

Omit a constructor that is empty or only calls `super` with the same arguments - the default does exactly that. Keep one that has parameter properties, visibility modifiers, or parameter decorators. A `private constructor() {}` to prevent instantiation is also legitimate.

## Accessors

Getters must be pure. A getter that mutates observable state is a bug waiting for a debugger to trigger it:

```typescript
get next() { return this.#id++; }   // mutates on read
```

Do not write a pass-through accessor pair just to make a field look encapsulated - make the field public, or `readonly`. At least one of the pair should do real work:

```typescript
class Foo {
  #wrappedBar = '';
  get bar() { return this.#wrappedBar || 'bar'; }
  set bar(value: string) { this.#wrappedBar = value.trim(); }
}
```

Never define accessors with `Object.defineProperty` - it is invisible to the type system and to property renaming.

## Statics

Prefer a module-level function to a private static method. The module is already the namespace.

**Do not use `this` in a static method**, and do not call a static method on a subclass or through a variable holding a class. Static members are inherited in JavaScript, which makes both of those resolve in ways that surprise:

```typescript
class MyClass {
  static foo() { return this.staticField; }   // `this` is whichever class was used to call
}
```

Call statics on the class that declares them.

## Prototypes and inheritance

Use `class`. Never assign to `prototype` directly, never modify a builtin's prototype, and do not write mixins by prototype manipulation.

**Prefer composition to inheritance.** A class hierarchy more than one level deep is usually modelling a relationship that an interface plus a field would express better. Where you do extend, mark overrides:

```typescript
class Sub extends Base {
  override handle(): void { … }    // required by noImplicitOverride
}
```

`noImplicitOverride` ([tsconfig.md](tsconfig.md)) catches a renamed base method silently becoming a new method on the subclass - a bug that otherwise produces no error anywhere.

## When not to use a class

Most TypeScript does not need one. A class earns its place when there is state with invariants to protect, or a real polymorphic boundary. For data, use an interface and a plain object; for behaviour without state, export functions. A class with no fields is a namespace ([imports-and-exports.md](imports-and-exports.md)); a class with only fields is an interface.

## Version notes

- **Target ES2022+** - `#private` is native. Static initialization blocks are available. This is the assumed baseline.
- **Target ES2015-ES2021** - `#private` downlevels to `WeakMap`, with the size and speed cost Google cites. Use `private` here.
- **Below ES2015** - not reachable: 6.0 removed the ES5 target.
- `erasableSyntaxOnly` (5.8+) bans parameter properties at every target.
- `override` and `noImplicitOverride` need 4.3+.

## Gotchas

- Agent uses `private` at target ES2022+ for new code - `#` is native there and is a real boundary
- Agent uses `#` for a member a subclass needs - there is no `#protected`; use `protected`
- Agent uses `#` or `private` for a member an Angular template reads - templates cannot see either; use `protected`
- Agent writes `obj['field']` to reach a private member - defeats the signal and breaks property renaming
- Agent writes a parameter property outside framework DI - not erasable; declare the field
- Agent enables `erasableSyntaxOnly` on an Angular or NestJS codebase - parameter-property DI stops compiling
- Agent writes `public` on a member - public is the default
- Agent omits `readonly` on a field never reassigned - free documentation, and `prefer-readonly` will flag it
- Agent writes an empty constructor, or one that only forwards to `super` - the default already does that
- Agent writes `new Foo` without parentheses
- Agent writes a getter that mutates state
- Agent writes a pass-through getter/setter pair - make the field public or `readonly`
- Agent uses `this` in a static method - it resolves to whichever class was used to call
- Agent builds a three-level class hierarchy - compose instead
- Agent omits `override` - silently creates a new method when the base is renamed
- Agent writes a class with only static members - export functions from the module

## Related

- [functions.md](functions.md) · [google-style-deltas.md](google-style-deltas.md) · [tsconfig.md](tsconfig.md) · [interfaces-and-type-aliases.md](interfaces-and-type-aliases.md) · [decorators.md](decorators.md) · [imports-and-exports.md](imports-and-exports.md)
