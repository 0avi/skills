# State Tracking (`getState`, `watchState`)

State tracking lets you observe the whole state of a SignalStore for cross-cutting concerns: logging, persistence, undo/redo, analytics, sync with another store.

## `getState`: snapshot

Synchronously returns the current full state value. When called inside a reactive context (an `effect`, `computed`, or `rxMethod` pipe), it auto-tracks future changes.

```ts
import { effect } from '@angular/core';
import { getState, signalStore, withHooks, withState } from '@ngrx/signals';

export const CounterStore = signalStore(
  withState({ count: 0 }),
  withHooks({
    onInit(store) {
      effect(() => {
        // Re-runs whenever any state slice changes.
        console.log('state', getState(store));
      });
    },
  }),
);
```

Because `effect` is glitch-free, multiple synchronous `patchState` calls in the same tick produce a single log with the final value. That's usually what you want.

## `watchState`: synchronous, on every change

Use when you need to observe **every** intermediate update (e.g. undo stack, analytics events). Runs synchronously on each `patchState`.

```ts
import { signalStore, watchState, withHooks, withMethods, withState, patchState } from '@ngrx/signals';

export const CounterStore = signalStore(
  withState({ count: 0 }),
  withMethods((store) => ({
    increment(): void {
      patchState(store, (s) => ({ count: s.count + 1 }));
    },
  })),
  withHooks({
    onInit(store) {
      watchState(store, (state) => console.log('[sync]', state));
      store.increment();
      store.increment();
      // logs: { count: 0 }, { count: 1 }, { count: 2 }
    },
  }),
);
```

`watchState` is tied to the surrounding injection context and auto-cleans on destroy.

## Manual cleanup

`watchState` returns `{ destroy }` for early disposal:

```ts
const { destroy } = watchState(store, log);
setTimeout(destroy, 5_000);
```

## Use outside an injection context

Pass an injector as the options argument:

```ts
ngOnInit(): void {
  watchState(this.store, console.log, { injector: this.injector });
}
```

## Practical patterns

### Persist to storage on every change

```ts
withHooks({
  onInit(store) {
    const storage = inject(StorageService);
    watchState(store, (state) => storage.saveJson('books-state', state));
  },
}),
```

### Hydrate from storage at startup

A store can patch its own state from inside `onInit`, so `unprotected` is not needed here. State protection only blocks writes from outside the store.

```ts
withHooks({
  onInit(store) {
    const storage = inject(StorageService);
    storage.getJson<BooksState>('books-state').then((saved) => {
      if (saved) patchState(store, saved);
    });
  },
}),
```

When the state is available synchronously at construction, a `withState(() => inject(...))` factory is cleaner still. Reserve `unprotected` for tests.

### Build a generic `withLogger`

See [custom-store-features.md](custom-store-features.md). `getState` + `effect` inside a `signalStoreFeature` is the canonical pattern.

## Version notes

The two functions on this page have different floors, read from the published types:

| Symbol | Floor |
| ------ | ----- |
| `getState` | 17.2.0 |
| `watchState` | **18.0.0** |

On `@ngrx/signals` 17 there is no `watchState`, so every-intermediate-value observation has to be built from `effect` plus `getState`, which coalesces and therefore cannot see intermediate values at all. If you need an undo stack on 17, record it in the methods that mutate.

There is no devtools entry point in `@ngrx/signals` at any version, which is why `getState` and `watchState` are the logging story. See [install.md](install.md).

## Gotchas

- Agent uses `getState` in an `effect` and expects every intermediate value - `effect` is glitch-free, so several `patchState` calls in one tick produce one notification with the final value. That is `watchState`'s job
- Agent uses `watchState` for logging - it fires on every write, so a noisy store floods the console. `getState` in an `effect` is usually what was wanted
- Agent calls `getState` outside a reactive context and expects it to keep tracking - it is a snapshot there
- Agent calls `watchState` outside an injection context without `{ injector }` - the watcher then has no lifetime and leaks
- Agent hydrates from storage in `onInit` and races the first fetch - the later write wins, and which one is later is timing-dependent. Prefer a `withState(() => inject(...))` factory when the value is available synchronously
- Agent reaches for `unprotected` to hydrate - a store may patch its own state from inside `onInit`. Protection only blocks writes from outside
- Agent persists whole state snapshots including derived slices - `withLinkedState` slices are real state and will round-trip. See [linked-state.md](linked-state.md)
- Agent persists on every change with `watchState` and writes synchronously to `localStorage` - that is a synchronous write per keystroke. Debounce it

## Related

- [signal-store.md](signal-store.md) · [lifecycle-hooks.md](lifecycle-hooks.md) · [custom-store-features.md](custom-store-features.md) · [linked-state.md](linked-state.md) · [install.md](install.md)

