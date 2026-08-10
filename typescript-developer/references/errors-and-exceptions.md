# Errors and Exceptions

## Throw only `Error`

```typescript
throw new Error('Submission rejected');    // yes
throw 'Submission rejected';               // no - no stack trace
throw {code: 'REJECTED'};                  // no
throw Error('...');                        // works, but always use `new`
```

Anything that is not an `Error` (or a subclass) arrives at the catch site with no stack trace, and browsers and Node report it uselessly. `@typescript-eslint/only-throw-error` enforces this.

## Custom error classes

Subclass `Error` when callers need to distinguish failures. Set `name` - it is what appears in logs - and preserve the original with `cause`:

```typescript
export class SubmissionRejectedError extends Error {
  override readonly name = 'SubmissionRejectedError';

  constructor(
    readonly submissionId: string,
    readonly reasonCode: string,
    options?: {cause?: unknown},
  ) {
    super(`Submission ${submissionId} rejected: ${reasonCode}`, options);
  }
}
```

`cause` (ES2022) is how you wrap without losing the original. Node and modern browsers print the chain:

```typescript
try {
  await client.submit(payload);
} catch (error) {
  throw new SubmissionRejectedError(id, 'UPSTREAM_FAILURE', {cause: error});
}
```

Never swallow the original by re-throwing only its message - that discards the stack you will need.

## `catch` receives `unknown`

Under `strict`, the catch binding is `unknown`, because JavaScript can throw anything. Narrow before use:

```typescript
try {
  await submit(payload);
} catch (error) {
  if (error instanceof SubmissionRejectedError) {
    logger.warn({submissionId: error.submissionId}, error.message);
    return;
  }
  throw error;                              // not ours - let it go
}
```

Do not annotate the binding as `any` or `Error` to skip the narrowing. `catch (error: any)` is the most common way `any` enters an otherwise strict codebase.

`instanceof` fails across realms - iframes, worker threads, some bundler setups that duplicate a module. Where that applies, check a discriminant field instead of the prototype.

## Rethrow what you do not handle

A `catch` that handles one failure mode must rethrow the rest. Catching broadly and continuing turns a specific failure into corrupt state further downstream.

## Empty catch blocks

An empty `catch` needs a comment saying why nothing is done. Without one, a reader cannot tell deliberate suppression from an unfinished thought:

```typescript
try {
  await cache.delete(key);
} catch {
  // Cache eviction is best-effort; a stale entry expires on its own.
}
```

Use the bindingless `catch { }` form when the error is genuinely unused.

## Keep `try` narrow

Only the statements that can throw belong inside:

```typescript
// Too wide - a bug in parse() is reported as a network failure
try {
  const response = await fetch(url);
  const data = await response.json();
  return transform(data);
} catch (error) {
  throw new NetworkError('fetch failed', {cause: error});
}

// Narrow
let data: unknown;
try {
  const response = await fetch(url);
  data = await response.json();
} catch (error) {
  throw new NetworkError('fetch failed', {cause: error});
}
return transform(data);
```

Widening a `try` to cover a whole loop for performance is a reasonable exception.

Note that `fetch` does not reject on a 404 or 500 - check `response.ok` explicitly. A `try` around `fetch` catches network failures only.

## `throw` versus a `Result`

Both are legitimate. The distinction is whether the failure is **expected**.

**Throw for the unexpected** - a bug, a violated invariant, a dependency that is down. These should propagate to a boundary that logs and returns a 500. Do not catch them locally.

**Return a value for the expected** - validation failure, not found, insufficient funds. These are outcomes the caller must handle, and the type system should say so:

```typescript
type Result<T, E> =
  | {ok: true; value: T}
  | {ok: false; error: E};

function parseSubmission(raw: string): Result<Submission, ValidationError> { … }

const result = parseSubmission(raw);
if (!result.ok) {
  return badRequest(result.error);
}
use(result.value);
```

A thrown exception is invisible in the signature - nothing tells the caller it can fail, and nothing checks that they handled it. A `Result` makes both explicit, and the discriminated union means the compiler will not let you read `value` without checking `ok`.

The cost is that `Result` is viral: it propagates up through every caller, and mixing the two styles arbitrarily is worse than picking one. Apply it where a failure is genuinely part of the contract - parsing, validation, external calls at a boundary - and throw everywhere else.

A hand-rolled `Result` like the above is usually enough. Reach for a library only if you want the combinator chain, and only if the team will actually use it.

## Async errors

`try`/`catch` around `await` works exactly as it does synchronously. What does not work is a `catch` that never runs because nothing awaited the promise - see [async-and-promises.md](async-and-promises.md).

Never mix `await` with `.catch()` on the same call; pick one.

## Version notes

- **`Error.cause`** needs `lib: es2022`. Below that, add the original as a property yourself.
- **`useUnknownInCatchVariables`** is part of `strict` from 4.4; before that the binding was `any`.
- **Bindingless `catch { }`** needs ES2019.
- **`Error.captureStackTrace`** is Node-only - do not use it in shared code.

Everything else is version-agnostic across 5.x, 6.0 and 7.0.

## Gotchas

- Agent throws a string or an object literal - no stack trace; throw an `Error`
- Agent writes `catch (error: any)` - the binding is `unknown` for a reason; narrow it
- Agent reads `error.message` without narrowing - `unknown` has no `message`
- Agent wraps an error and passes only its message - use `{cause: error}` and keep the stack
- Agent catches broadly and continues - rethrow what you did not handle
- Agent leaves an empty `catch` with no comment - indistinguishable from an unfinished edit
- Agent wraps twenty lines in one `try` - a bug in the last line is reported as a failure of the first
- Agent assumes `fetch` rejects on a 404 - it does not; check `response.ok`
- Agent relies on `instanceof` across a worker or iframe boundary - use a discriminant field
- Agent throws for an expected, recoverable outcome - that failure belongs in the return type
- Agent introduces `Result` in one function and throws in its neighbours - pick one per boundary
- Agent forgets `override` on `name` in an `Error` subclass - `noImplicitOverride` will flag it

## Related

- [async-and-promises.md](async-and-promises.md) · [control-flow.md](control-flow.md) · [any-and-unknown.md](any-and-unknown.md) · [advanced-types.md](advanced-types.md) · [classes.md](classes.md)
