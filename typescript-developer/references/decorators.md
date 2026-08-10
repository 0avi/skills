# Decorators

There are two incompatible decorator systems in TypeScript. Establish which one the project uses before writing anything.

| | Standard (stage 3) | `experimentalDecorators` |
|---|---|---|
| Enabled by | Nothing - valid syntax since 5.0 | `"experimentalDecorators": true` |
| Based on | The TC39 proposal that will become JavaScript | An older, abandoned draft |
| Parameter decorators | **Not supported** | Supported |
| Metadata | `context.metadata` (stage 3) | `emitDecoratorMetadata` + reflect-metadata |
| Used by | New code | Angular, NestJS, TypeORM, most existing DI |

**They cannot be mixed.** The flag selects one interpretation for the whole compilation. A decorator written for one system will not work under the other.

## Which to use

**If the project uses Angular, NestJS, TypeORM or similar** - it is on `experimentalDecorators`, and it must stay there. Those frameworks depend on parameter decorators and `emitDecoratorMetadata`, neither of which the standard system provides. Do not "modernise" the flag; you will break dependency injection everywhere.

**Otherwise** - use the standard decorators, which need no flag. Or, more likely, use nothing.

## Prefer not to

Google's rule: **use only decorators the framework defines**, and do not write your own. That holds, and the reasoning has grown stronger.

A decorator is invisible action at a distance. It changes what a method or class does with no call site to read, it is hard to type well, it resists tree-shaking, and it makes testing harder because the behaviour cannot be omitted. Almost everything a custom decorator does, a higher-order function or an explicit wrapper does more legibly:

```typescript
@retry(3)
async submit() { … }

async submit() {
  return withRetry(3, () => this.#doSubmit());     // visible at the call site
}
```

Use `@Component`, `@Injectable`, `@Entity` and the rest because the framework requires them. Write your own only when a framework's extension point genuinely demands it.

## Standard decorators, if you do

```typescript
function logged<This, Args extends unknown[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, typeof target>,
) {
  return function (this: This, ...args: Args): Return {
    console.log(`entering ${String(context.name)}`);
    return target.call(this, ...args);
  };
}
```

The `context` argument carries `kind`, `name`, `private`, `static`, `addInitializer` and `metadata`. Return a replacement, or `undefined` to leave the original in place.

Notable: standard decorators **can** decorate `#private` members, which the experimental system could not.

## Formatting and placement

A decorator immediately precedes what it decorates, with no blank line between. One per line for classes and methods; a short field decorator may share the line:

```typescript
@Injectable({providedIn: 'root'})
export class OrderService {
  @Input() readonly orderId!: string;

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent) { … }
}
```

## Interaction with the rest of this skill

- **Parameter decorators require a constructor**, so an otherwise-unnecessary constructor is justified when they are present ([classes.md](classes.md)).
- **`erasableSyntaxOnly` does not ban decorators** - but the parameter *properties* that Angular and NestJS constructors use alongside them are banned. In practice, framework code keeps that flag off ([tsconfig.md](tsconfig.md)).
- **A decorated class member read by a template** must not be `#private` or `private` - Angular templates cannot see either. Use `protected` ([classes.md](classes.md)).
- **Decorator names are `UpperCamelCase`** ([naming.md](naming.md)).

## The `accessor` keyword

Introduced alongside standard decorators. It declares a field with an auto-generated getter/setter pair backed by a private slot, so a decorator can intercept reads and writes:

```typescript
class Counter {
  @observable accessor count = 0;
}
```

Only useful with a decorator that needs the interception. Without one, it is a plain field written the long way - do not use it decoratively.

## Version notes

- **Standard decorators** need 5.0+ and no flag. **Decorator metadata** (`context.metadata`, `Symbol.metadata`) needs 5.2+ and `lib: esnext.decorators`.
- **`experimentalDecorators`** still exists in 6.0 and 7.0 and is not deprecated - Angular and NestJS depend on it. 5.0 tightened its type-checking, which broke some pre-5.0 decorator code.
- **`emitDecoratorMetadata`** works only with `experimentalDecorators`, and requires `reflect-metadata` at runtime.
- **`accessor`** needs 4.9+.

## Gotchas

- Agent writes a standard decorator in an Angular or NestJS project - that project is on `experimentalDecorators`; the two systems are incompatible
- Agent turns off `experimentalDecorators` to "modernise" - breaks every parameter-decorator DI site in the codebase
- Agent writes a parameter decorator under standard decorators - not supported
- Agent expects `emitDecoratorMetadata` to work with standard decorators - it does not
- Agent writes a custom decorator where a higher-order function would do - invisible at the call site, hard to type, resists tree-shaking
- Agent forgets `reflect-metadata` must be imported once at the entry point when `emitDecoratorMetadata` is on
- Agent puts a blank line between a decorator and what it decorates
- Agent makes a decorated member `private` or `#private` and then reads it from an Angular template - templates see neither; use `protected`
- Agent uses `accessor` without a decorator that needs it - it is a plain field written the long way

## Related

- [classes.md](classes.md) · [tsconfig.md](tsconfig.md) · [naming.md](naming.md) · [typescript-versions.md](typescript-versions.md) · [functions.md](functions.md)
