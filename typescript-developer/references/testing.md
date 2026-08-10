# Testing

The Google guide specifies only test naming. Everything else here is this skill's addition.

## Structure

Tests sit beside the source: `order-service.ts`, `order-service.test.ts`. Pick `.test.ts` or `.spec.ts` and use one consistently across the project.

Arrange, act, assert - with the three visually separated:

```typescript
it('rejects a submission past the deadline', async () => {
  const service = new SubmissionService({clock: fixedClock('2026-02-01')});

  const result = await service.submit(lateSubmission);

  expect(result.ok).toBe(false);
});
```

**One behaviour per test.** A test asserting four unrelated things reports one failure and hides the other three.

## Naming

Describe the behaviour and the condition, not the method:

```typescript
it('returns empty when no orders match');           // yes
it('throws when the reference is unknown');         // yes
it('tests getOrders');                              // says nothing
it('works');                                        // says less
```

The `_` separator form (`returns_empty_when_no_orders_match`) is permitted - it is the one place underscores are allowed in an identifier-like position. Follow whatever the project does.

A `describe` block names the unit; the `it` completes a sentence starting with "it".

## `any` in a test is still a bug

The single most common failure here. Tests are code, and the reasoning that bans `any` in production applies unchanged - arguably more, since a test's whole job is to detect a mismatch.

```typescript
const mockRepo = {} as any;                          // no
const mockRepo = {load: vi.fn()} as unknown as Repo; // still poor - the shape is unchecked

const mockRepo: Pick<Repo, 'load'> = {load: vi.fn()};  // checked
```

For a partial double, type the partial:

```typescript
function fakeRepo(overrides: Partial<Repo> = {}): Repo {
  return {load: async () => stubOrder, save: async () => {}, ...overrides};
}
```

Now a change to `Repo` breaks the fake at compile time, which is exactly the signal you want. A double typed `any` keeps compiling after the interface it stands in for has changed, so the test passes while testing nothing.

## Test doubles

Prefer, in order:

1. **The real thing.** A pure function, an in-memory implementation, a real object with test data. No double needed.
2. **A hand-written fake** implementing the interface - the `fakeRepo` above.
3. **A mock** from the test framework, for verifying an interaction that has no observable result.

Mock at architectural boundaries - the network, the clock, the filesystem, randomness. Do not mock the unit's own collaborators to the point that the test asserts the implementation rather than the behaviour; such a test fails on every refactor and passes through real bugs.

Inject the clock and the id generator rather than mocking globals. A function taking `now: Date` is testable without any framework at all.

## What to assert

Assert the observable outcome. Avoid asserting on internals - a `#private` field is unreachable by design ([classes.md](classes.md)), and needing to reach it usually means the behaviour should be observable some other way.

Prefer a specific matcher to a general one: `toEqual({id: 'x'})` over `toBeTruthy()`. A truthiness assertion passes for almost anything.

For errors, assert the type and something identifying, not the whole message - messages are the thing most likely to be reworded:

```typescript
await expect(service.submit(bad)).rejects.toThrow(SubmissionRejectedError);
```

`expect(...).rejects` matters: a promise assertion that is not awaited or returned always passes, because nothing ever checks it. This is the floating-promise problem wearing a test's clothing ([async-and-promises.md](async-and-promises.md)), and `no-floating-promises` catches it.

## Type-level testing

For a type that carries real logic - a mapped type, a conditional type, a generic API - assert the type as well as the value:

```typescript
import {expectTypeOf} from 'vitest';

expectTypeOf(parse('{}')).toEqualTypeOf<unknown>();
expectTypeOf<Prettify<A & B>>().toEqualTypeOf<{a: string; b: number}>();
```

`@ts-expect-error` is a type assertion too - it fails if the code *stops* erroring, which is a real test:

```typescript
// @ts-expect-error - id must be branded, not a raw string
loadUser('raw-string');
```

This is the one place [google-style-deltas.md](google-style-deltas.md)'s suppression rule is not a concession: here the suppression *is* the assertion.

Do not type-test what the compiler already guarantees. Reserve it for types with logic in them.

## Determinism

A flaky test is worse than no test - it trains the team to re-run CI. The usual causes, all removable:

- **Time.** Inject a clock. Never `new Date()` inside the unit.
- **Randomness and ids.** Inject the generator.
- **Ordering.** `Object.keys` order and `Promise.all` completion order are not guarantees to assert on.
- **Shared state between tests.** Build fresh fixtures per test rather than mutating a module-level object.
- **Real timers and real network.** Fake the timers; stub at the boundary.

## Coverage

A target is a diagnostic, not a goal. Coverage tells you what was *executed*, not what was *verified* - a test with no assertions covers everything it touches.

Look at what is uncovered rather than at the number. Uncovered error paths are the ones that matter, because they are the paths that run when something is already going wrong.

## Version notes

Version-agnostic in the rules. Tooling is not:

- **`ts-jest` cannot run on TypeScript 7.0** - it needs the programmatic API. So does anything else that type-checks during the test run ([typescript-versions.md](typescript-versions.md)).
- A transpile-only runner (Vitest with esbuild, `swc-jest`, `node --test` with type stripping) is unaffected, because it never type-checks. That is worth knowing in both directions: it also means your test run is not type-checking, so `tsc --noEmit` must be a separate CI step.
- **Node's built-in runner** (`node --test`) runs `.ts` directly from 22.18, and type-strips - so it rejects enums, namespaces and parameter properties ([tsconfig.md](tsconfig.md)).

## Gotchas

- Agent types a test double `any` - it keeps compiling after the interface changes, so the test passes while testing nothing
- Agent writes `{} as unknown as Repo` - the shape is unchecked; type the partial
- Agent asserts on a private field - unreachable by design, and the wrong thing to assert
- Agent uses `toBeTruthy()` where a specific matcher applies
- Agent asserts a full error message - the most-reworded part; assert the type
- Agent forgets to `await` or return a `rejects` assertion - it always passes
- Agent mocks the unit's own collaborators - the test then asserts the implementation and fails on every refactor
- Agent calls `new Date()` or `Math.random()` inside the unit under test - inject them
- Agent mutates a shared fixture between tests - build fresh per test
- Agent asserts on `Object.keys` order or `Promise.all` completion order
- Agent puts several unrelated assertions in one test - one failure hides the rest
- Agent names a test after the method rather than the behaviour
- Agent treats a coverage percentage as the goal - look at which paths are uncovered
- Agent assumes a transpile-only runner type-checks - it does not; `tsc --noEmit` is a separate step
- Agent configures `ts-jest` on TypeScript 7.0 - it cannot run there

## Related

- [any-and-unknown.md](any-and-unknown.md) · [naming.md](naming.md) · [async-and-promises.md](async-and-promises.md) · [classes.md](classes.md) · [typescript-versions.md](typescript-versions.md) · [advanced-types.md](advanced-types.md)
