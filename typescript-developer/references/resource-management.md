# Resource Management

`using` and `await using` bind a resource to a scope and dispose it automatically when the scope exits - by any route, including a `throw` or an early `return`. They are the replacement for hand-written `try`/`finally` cleanup.

## `using`

```typescript
function readConfig(path: string): string {
  using handle = openFile(path);
  return handle.readAll();
}                                    // handle disposed here, however we leave
```

Against the `try`/`finally` it replaces:

```typescript
function readConfig(path: string): string {
  const handle = openFile(path);
  try {
    return handle.readAll();
  } finally {
    handle.close();
  }
}
```

Two things improve. Cleanup is declared where the resource is acquired rather than several lines later, and nesting three resources produces three `using` lines instead of three levels of indentation.

## Making something disposable

Implement `Symbol.dispose`:

```typescript
class FileHandle implements Disposable {
  readonly #fd: number;

  constructor(path: string) {
    this.#fd = openSync(path, 'r');
  }

  readAll(): string { … }

  [Symbol.dispose](): void {
    closeSync(this.#fd);
  }
}
```

For anything asynchronous, `Symbol.asyncDispose` and `await using`:

```typescript
class Connection implements AsyncDisposable {
  async [Symbol.asyncDispose](): Promise<void> {
    await this.#pool.release(this.#conn);
  }
}

async function run(): Promise<Result> {
  await using conn = await pool.acquire();
  return conn.query(sql);
}
```

`await using` awaits the disposal. Plain `using` on an `AsyncDisposable` does not - it calls nothing and the resource leaks silently, which is the main trap here.

## Rules

**`using` requires `const` semantics.** The binding cannot be reassigned, and there is no `using let`.

**Declaration order determines disposal order** - reverse of acquisition, like a stack:

```typescript
using outer = acquireOuter();
using inner = acquireInner();
// inner disposed first, then outer
```

**`null` and `undefined` are permitted** and dispose to nothing, so an optional resource needs no guard:

```typescript
using maybeLock = shouldLock ? acquireLock() : undefined;
```

**Disposal runs on the way out of the *block*,** not the function. A `using` inside a loop body disposes each iteration, which is usually what you want.

**A throwing disposer does not mask the original error.** If the body threw and disposal also throws, both are reported via `SuppressedError`, which carries `error` and `suppressed`. This is strictly better than `try`/`finally`, where a throwing `finally` discards the original exception entirely.

## `DisposableStack`

When the number of resources is dynamic, or you need to hand ownership back to a caller:

```typescript
function setup(): Disposable {
  using stack = new DisposableStack();

  const server = stack.use(startServer());
  const db = stack.use(connectDatabase());
  stack.defer(() => logger.info('torn down'));

  return stack.move();      // ownership transfers; nothing disposed here
}
```

- `use(resource)` registers a `Disposable`
- `adopt(value, dispose)` registers something that is not `Disposable`
- `defer(fn)` registers a bare callback
- `move()` transfers everything to a new stack, so the current scope's exit disposes nothing

`move()` is the pattern for a factory that acquires several things and must clean all of them up if any step fails, but hand them over intact on success. `AsyncDisposableStack` is the async counterpart.

## When to use it

Use it for anything with a paired acquire and release: file handles, database connections and transactions, locks, subscriptions, temporary directories, spans, test fixtures.

Do not wrap something in `Disposable` that has no real cleanup - that is ceremony. And a resource whose lifetime is genuinely not scope-bound (a connection pool held for the process lifetime) is not a `using` case.

## Version notes

- **TypeScript 5.2+** for the syntax.
- **`Symbol.dispose` and `Symbol.asyncDispose`** need `lib: esnext.disposable` (or `lib: esnext`). Without it the symbols are not declared and the code will not compile.
- **A runtime polyfill is required** below Node 20 / recent browsers, because the symbols must exist at runtime. TypeScript downlevels the syntax but does not supply the symbols.
- Stable and unchanged across 6.0 and 7.0.

## Gotchas

- Agent writes `using` on an `AsyncDisposable` - disposal never runs; use `await using`
- Agent omits `lib: esnext.disposable` - `Symbol.dispose` is undeclared
- Agent ships to a runtime without the symbols and no polyfill - the syntax compiles, the disposal fails at runtime
- Agent tries to reassign a `using` binding, or writes `using let` - neither exists
- Agent expects disposal at the end of the function when the `using` is inside a block - it runs at the end of that block
- Agent assumes acquisition order for disposal - it is reverse order
- Agent guards an optional resource before a `using` - `null` and `undefined` dispose to nothing
- Agent keeps `try`/`finally` for cleanup where `using` applies - and loses the original error when the `finally` throws
- Agent returns a `DisposableStack` without `move()` - everything is disposed as the function returns
- Agent makes a type `Disposable` when it has no real cleanup

## Related

- [async-and-promises.md](async-and-promises.md) · [errors-and-exceptions.md](errors-and-exceptions.md) · [classes.md](classes.md) · [tsconfig.md](tsconfig.md) · [typescript-versions.md](typescript-versions.md)
