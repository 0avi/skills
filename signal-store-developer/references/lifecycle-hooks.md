# Lifecycle Hooks (`withHooks`)

`withHooks` adds `onInit` and/or `onDestroy` hooks to a SignalStore. Use it for:

- Triggering initial data loads (so consumers don't have to call `loadAll()` in every `ngOnInit`).
- Wiring up reactive subscriptions whose lifetime should match the store.
- Cleanup of timers, sockets, or external subscriptions.

## Object signature

The simplest form takes an object with `onInit` and/or `onDestroy`:

```ts
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import {
  patchState, signalStore, withHooks, withMethods, withState,
} from '@ngrx/signals';

export const CounterStore = signalStore(
  withState({ count: 0 }),
  withMethods((store) => ({
    increment(): void {
      patchState(store, (s) => ({ count: s.count + 1 }));
    },
  })),
  withHooks({
    onInit(store) {
      interval(2_000)
        .pipe(takeUntilDestroyed()) // ✅ auto-clean on store destroy
        .subscribe(() => store.increment());
    },
    onDestroy(store) {
      console.log('final count', store.count());
    },
  }),
);
```

A raw `interval(...).subscribe()` like the one above is the rare case where a manual subscription is acceptable, because `takeUntilDestroyed()` ties it to the store's lifetime. For anything that fetches data or reacts to a signal, prefer `rxMethod`.

`onInit` runs inside the injection context, so `inject(...)`, `takeUntilDestroyed()`, `effect()`, and `rxMethod()` calls all work.

`onDestroy` does **not** run inside the injection context. If you need an injected dependency in `onDestroy`, use the factory signature.

## Factory signature

When `onInit` and `onDestroy` share state or `onDestroy` needs an injected dependency:

```ts
withHooks((store) => {
  const logger = inject(Logger);
  let intervalId = 0;

  return {
    onInit() {
      intervalId = setInterval(() => store.increment(), 2_000);
    },
    onDestroy() {
      logger.info('final count', store.count());
      clearInterval(intervalId);
    },
  };
});
```

The factory function itself runs inside an injection context.

## Triggering reactive methods from `onInit`

The most common pattern is to call an `rxMethod` with a signal from `onInit`, so the data automatically re-fetches whenever the signal changes:

```ts
withHooks({
  onInit(store) {
    // Re-runs the loader whenever store.query changes.
    store.loadByQuery(store.query);
  },
}),
```

## Order matters

Hooks contributed by features are flushed in the order the features were composed. Place `withHooks` **after** the `withMethods` (or `rxMethod`) it depends on, otherwise the names will not yet exist on `store`.

