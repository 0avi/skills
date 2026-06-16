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

