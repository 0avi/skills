# Async and Promises

## Every promise is handled

A floating promise - created and neither awaited, returned, nor given a `.catch()` - is the most common serious bug in TypeScript codebases. Its rejection becomes an unhandled rejection, which in Node terminates the process by default, and the operation's ordering relative to everything else is undefined.

```typescript
save(order);                  // floating
await save(order);            // awaited
return save(order);           // returned - the caller's problem now
void save(order);             // deliberately fire-and-forget, and it says so
```

`void` is the explicit "I know, and I mean it" marker - but it discards rejections too, so attach a handler when the operation can fail:

```typescript
void save(order).catch((error: unknown) => logger.error({error}, 'background save failed'));
```

`@typescript-eslint/no-floating-promises` catches all of this and is worth treating as an error, not a warning.

### The quiet cases

```typescript
items.forEach(async (item) => { await save(item); });   // every promise floats; no waiting
for (const item of items) { await save(item); }         // sequential, awaited

<button onClick={async () => { await submit(); }} />    // handler returns void; promise floats
```

`@typescript-eslint/no-misused-promises` catches passing an `async` function where a `void`-returning one is expected.

## `async`/`await` over `.then()`

```typescript
const order = await load(id);
const priced = await price(order);

return load(id).then((order) => price(order));    // worse: no try/catch, harder to read
```

`await` gives real control flow - `try`/`catch`, loops, early return. Mixing the two styles in one function is worse than either.

Never combine `await` with `.catch()` on the same call. Pick one.

## Concurrency

**Sequential when there is a dependency, concurrent when there is not.** The commonest performance bug in async code is a loop of independent awaits:

```typescript
for (const id of ids) {
  results.push(await load(id));          // N round trips, serially
}

const results = await Promise.all(ids.map((id) => load(id)));   // concurrent
```

| Need | Use |
|---|---|
| All must succeed; fail fast | `Promise.all` |
| Want every outcome, successes and failures | `Promise.allSettled` |
| First success; reject only if all fail | `Promise.any` |
| First to settle, either way | `Promise.race` |

`Promise.all` rejects on the first failure but **does not cancel the others** - they keep running, and their rejections become unhandled. Where that matters, use `allSettled` and inspect:

```typescript
const results = await Promise.allSettled(ids.map((id) => load(id)));
const loaded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
const failed = results.filter((r) => r.status === 'rejected');
```

The `status` field is a discriminated union, so the `.value`/`.reason` access narrows correctly ([advanced-types.md](advanced-types.md)).

**Unbounded `Promise.all` over a large array will exhaust connections or hit rate limits.** For anything unbounded in size, batch it or use a concurrency limiter - `Promise.all` over 10,000 items opens 10,000 requests.

## Cancellation

There is no promise cancellation. Use `AbortSignal`, which the platform APIs accept:

```typescript
async function load(id: string, signal?: AbortSignal): Promise<Order> {
  const response = await fetch(`/orders/${id}`, {signal});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<Order>;
}

const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);
await load(id, controller.signal);
```

`AbortSignal.timeout(5_000)` does the common case in one call, and `AbortSignal.any([a, b])` combines them. Accept an optional `signal` on any function that performs I/O - retrofitting it later means changing every signature in the chain.

An aborted `fetch` rejects with an `AbortError`; distinguish it from a real failure before logging.

## Async correctness

**`async` without `await`** is a smell - the function returns a promise for no reason. Either it should not be `async`, or an `await` is missing. `@typescript-eslint/require-await`.

**`await` on a non-promise** is a no-op that costs a microtask and usually indicates a misunderstanding of what the function returns. `@typescript-eslint/await-thenable`.

**Return, do not `return await`** - except inside a `try`, where you need the `await` for the `catch` to see the rejection:

```typescript
async function outer() {
  try {
    return await inner();     // await is required here
  } catch (error) {
    …
  }
}
```

**Annotate `Promise<T>` on exported async functions.** An inferred promise type is a common route for `any` to escape a public API ([type-inference.md](type-inference.md)).

## Narrowing does not survive `await`

```typescript
if (this.#client !== undefined) {
  await something();
  this.#client.send();        // error - narrowing discarded
}
```

Correct, not pedantic: the property could have been reassigned during the await. Copy to a `const` first. See [nullability.md](nullability.md).

## Errors

`try`/`catch` around `await` behaves exactly as it does synchronously. The catch binding is `unknown`; narrow it. See [errors-and-exceptions.md](errors-and-exceptions.md).

`fetch` does **not** reject on a 404 or 500 - only on a network failure. Check `response.ok`.

## Async iteration

For a stream of values, `for await...of`:

```typescript
for await (const chunk of stream) {
  process(chunk);
}
```

Sequential by definition. If the items are independent and you want concurrency, collect and use `Promise.all` instead.

## Version notes

- **`Promise.allSettled`** needs ES2020, **`Promise.any`** ES2021, **`AbortSignal.timeout`/`any`** ES2024 (and Node 17.3+/20+). Check `lib` before using them.
- **Top-level `await`** requires an ES module and `module: es2022` or above.
- **`using`/`await using`** for scoped cleanup - see [resource-management.md](resource-management.md).
- Version-agnostic otherwise. On 7.0 the lint rules named here are unavailable ([enforcement.md](enforcement.md)), which makes the floating-promise discipline a review responsibility.

## Gotchas

- Agent calls an async function without `await`, `return` or `void` - the promise floats and its rejection is unhandled
- Agent uses `void` on a promise that can fail without attaching a `.catch()`
- Agent passes an `async` callback to `.forEach()` - every promise floats and the loop does not wait
- Agent passes an `async` function to an event handler expecting `void` - same
- Agent awaits inside a loop over independent items - N sequential round trips; use `Promise.all`
- Agent uses `Promise.all` over an unbounded array - opens one request per item
- Agent assumes `Promise.all` cancels siblings on rejection - it does not; they run on and reject unhandled
- Agent uses `Promise.all` where a partial result is acceptable - `allSettled`
- Agent mixes `await` and `.then()` in one function
- Agent writes `await` and `.catch()` on the same call
- Agent marks a function `async` with no `await` in it
- Agent omits `AbortSignal` from an I/O function - retrofitting means changing the whole chain
- Agent logs an `AbortError` as a failure - it is a deliberate cancellation
- Agent assumes `fetch` rejects on a 404 - check `response.ok`
- Agent keeps a property narrowing across an `await` - copy to a `const` first
- Agent writes `return await` outside a `try` - unnecessary; inside one it is required

## Related

- [errors-and-exceptions.md](errors-and-exceptions.md) · [resource-management.md](resource-management.md) · [functions.md](functions.md) · [nullability.md](nullability.md) · [control-flow.md](control-flow.md) · [enforcement.md](enforcement.md)
