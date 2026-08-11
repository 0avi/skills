# Testing SignalStores

A SignalStore is an Angular service, so test it with `TestBed`. The same rules apply whether it's globally provided or component-scoped.

## Guiding principles

- **Assert on the public API only.** Test state values, computed values, and observable effects of method calls. Don't spy on the store's own methods. If a method is complex enough to want a spy, extract that logic into a separate service and mock that service.
- **Use `TestBed`, not `new MyStore()`.** SignalStore relies on injection context for `rxMethod`, `signalMethod`, `inject()`, and hooks.
- **Prefer state assertions over interaction assertions.** "After clicking, count is 1" is more durable than "increment was called once".

## 1. Testing a globally provided store

```ts
import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';

const CounterStore = signalStore(
  { providedIn: 'root' },
  withState({ count: 0 }),
);

describe('CounterStore (global)', () => {
  it('starts at 0', () => {
    const store = TestBed.inject(CounterStore);
    expect(store.count()).toBe(0);
  });
});
```

## 2. Testing a locally provided store

```ts
const CounterStore = signalStore(withState({ count: 0 }));

describe('CounterStore (local)', () => {
  it('starts at 0', () => {
    TestBed.configureTestingModule({ providers: [CounterStore] });
    const store = TestBed.inject(CounterStore);
    expect(store.count()).toBe(0);
  });
});
```

## 3. Testing state + computed + method together

```ts
const CounterStore = signalStore(
  { providedIn: 'root' },
  withState({ count: 0 }),
  withComputed(({ count }) => ({ doubleCount: () => count() * 2 })),
  withMethods((store) => ({
    increment(): void {
      patchState(store, ({ count }) => ({ count: count + 1 }));
    },
  })),
);

it('increment updates count and doubleCount', () => {
  const store = TestBed.inject(CounterStore);

  store.increment();
  expect(store.count()).toBe(1);
  expect(store.doubleCount()).toBe(2);
});
```

## 4. Writing directly to protected state with `unprotected`

The default state is read-only from outside. When a test needs to set up arbitrary state for a scenario, wrap the store with `unprotected` from `@ngrx/signals/testing`:

```ts
import { unprotected } from '@ngrx/signals/testing';

it('doubleCount recomputes when count is patched', () => {
  const store = TestBed.inject(CounterStore);

  patchState(unprotected(store), { count: 5 });

  expect(store.doubleCount()).toBe(10);
});
```

Use sparingly, and prefer driving state through real methods when possible.

## 5. Mocking dependencies

Provide a fake via `useValue`. Implement only the methods the store actually calls.

```ts
@Injectable({ providedIn: 'root' })
class StepService { getStep() { return 1; } }

const CounterStore = signalStore(
  { providedIn: 'root' },
  withState({ count: 0 }),
  withMethods((store, step = inject(StepService)) => ({
    increment() {
      patchState(store, ({ count }) => ({ count: count + step.getStep() }));
    },
  })),
);

it('uses the mock step', () => {
  TestBed.configureTestingModule({
    providers: [{ provide: StepService, useValue: { getStep: () => 3 } }],
  });

  const store = TestBed.inject(CounterStore);
  store.increment();
  expect(store.count()).toBe(3);
});
```

## 6. Testing `signalMethod` instances

`signalMethod` internally uses an `effect`. When called with a static value the work is synchronous; when called with a signal, you must flush the effect.

```ts
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

const CounterStore = signalStore(
  { providedIn: 'root' },
  withState({ count: 0 }),
  withMethods((store) => ({
    increment: signalMethod<number>((step) => {
      patchState(store, ({ count }) => ({ count: count + step }));
    }),
  })),
);

it('static call is synchronous', () => {
  const store = TestBed.inject(CounterStore);
  store.increment(1);
  expect(store.count()).toBe(1);
});

it('signal call requires a tick', () => {
  const store = TestBed.inject(CounterStore);
  const step = signal(2);

  TestBed.runInInjectionContext(() => store.increment(step));
  expect(store.count()).toBe(0); // effect not flushed yet

  TestBed.tick();
  expect(store.count()).toBe(2);

  step.set(3);
  TestBed.tick();
  expect(store.count()).toBe(5);
});
```

## 7. Testing `rxMethod` instances

Same idea as `signalMethod`, plus you can also drive the input with an `Observable`:

```ts
import { of, scheduled, asyncScheduler, tap } from 'rxjs';

const CounterStore = signalStore(
  { providedIn: 'root' },
  withState({ count: 0 }),
  withMethods((store) => ({
    increment: rxMethod<number>(
      tap((n) => patchState(store, ({ count }) => ({ count: count + n }))),
    ),
  })),
);

it('sync observable', () => {
  const store = TestBed.inject(CounterStore);
  store.increment(of(1, 2, 3));
  expect(store.count()).toBe(6);
});

it('async observable', async () => {
  const store = TestBed.inject(CounterStore);
  store.increment(scheduled([1, 2, 3], asyncScheduler));
  expect(store.count()).toBe(0);
  // expect.poll is Vitest only; under Jasmine or Jest wrap the test in fakeAsync and call tick().
  await expect.poll(() => store.count()).toBe(6);
});
```

## 8. Mocking a SignalStore from a component test

The store's public API is just signals + functions. Provide a plain object with the same shape:

```ts
const count = signal(0);
const mockStore = {
  count,
  increment() { count.set(count() + 1); },
};

TestBed.configureTestingModule({
  providers: [{ provide: CounterStore, useValue: mockStore }],
}).createComponent(CounterComponent);
```

Prefer asserting on rendered state (DOM text, attributes) over asserting that `increment` was called (see "Guiding principles" above).

## 9. Testing custom features

Wrap the feature in a minimal store and assert on that store:

```ts
function withCounter() {
  return signalStoreFeature(
    withState({ count: 0 }),
    withComputed(({ count }) => ({ doubleCount: () => count() * 2 })),
    withMethods((store) => ({
      increment() { patchState(store, ({ count }) => ({ count: count + 1 })); },
    })),
  );
}

it('withCounter starts at 0 and increments', () => {
  const CounterStore = signalStore({ providedIn: 'root' }, withCounter());
  const store = TestBed.inject(CounterStore);

  expect(store.count()).toBe(0);
  store.increment();
  expect(store.count()).toBe(1);
  expect(store.doubleCount()).toBe(2);
});
```

## Flushing effects in tests

- `TestBed.tick()` (Angular 20+) runs a full synchronization cycle and flushes effects deterministically. It works under any test runner, so prefer it.
- `expect.poll(...)` is handy for waiting on asynchronous, scheduler-driven state, but it is Vitest only. Under Jasmine or Jest, wrap the test in `fakeAsync` and advance with `tick()`.
- For DOM and component tests, follow your runner's recommended Angular setup (for example, Vitest browser mode, or Karma with Jasmine).

## Version notes

Two of this page's tools have floors worth checking before you copy a test:

| Tool | Floor |
| ---- | ----- |
| `unprotected` from `@ngrx/signals/testing` | `@ngrx/signals` **19.1.0** |
| `TestBed.tick()` | Angular **20**. In Angular 20 `ComponentFixture.tick()` is deprecated in favour of it |
| `expect.poll` | Vitest only, at any version |
| `signalMethod`, tested in section 6 | `@ngrx/signals` 19.0.0 |

On `@ngrx/signals` 17 or 18 there is no `unprotected`, so a test that needs arbitrary state has to drive it through real methods, which is the better habit anyway. On Angular 19 or earlier there is no `TestBed.tick()`: use `fixture.detectChanges()` for component tests, or `fakeAsync` with `tick()`.

## Gotchas

- Agent writes `new MyStore()` - a SignalStore needs an injection context for `inject`, `rxMethod`, `signalMethod` and hooks. Always `TestBed.inject`
- Agent calls an `rxMethod` or `signalMethod` with a signal and asserts immediately - the effect has not flushed. `TestBed.tick()` first
- Agent uses `expect.poll` under Jasmine or Jest - it is Vitest only. Use `fakeAsync` and `tick()`
- Agent reaches for `unprotected` to set up every test - prefer driving state through the store's own methods, so the test exercises the real write path
- Agent spies on the store's own methods and asserts they were called - assert on the resulting state instead, which survives refactoring
- Agent forgets `TestBed.runInInjectionContext` when calling a reactive method with a signal from a bare test body
- Agent mocks a store with a plain object and omits a computed the component reads - the component then throws on a missing function rather than failing an assertion
- Agent provides a `{ providedIn: 'root' }` store in `TestBed.configureTestingModule` providers as well - two instances, and the assertions watch the wrong one
- Agent tests a `signalStoreFeature` in isolation - wrap it in a minimal `signalStore(...)` and assert on that

## Related

- [signal-store.md](signal-store.md) · [rx-method.md](rx-method.md) · [signal-method.md](signal-method.md) · [custom-store-features.md](custom-store-features.md) · [install.md](install.md)

