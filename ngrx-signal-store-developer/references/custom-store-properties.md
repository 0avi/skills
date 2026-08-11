# Custom Store Properties (`withProps`)

`withProps` attaches arbitrary non-signal/non-method members to a store: observables, injected services, configuration constants, sub-objects. The factory runs in the injection context and receives the store assembled so far.

## Use cases

### 1. Group injected dependencies

Pull dependencies into one place so later features can destructure them from `store`:

```ts
import { inject } from '@angular/core';
import { signalStore, withProps, withMethods, withState, patchState } from '@ngrx/signals';

export const BooksStore = signalStore(
  withState({ books: [] as Book[], isLoading: false }),
  withProps(() => ({
    booksService: inject(BooksService),
    logger: inject(Logger),
  })),
  withMethods(({ booksService, logger, ...store }) => ({
    async loadBooks(): Promise<void> {
      logger.debug('Loading books…');
      patchState(store, { isLoading: true });
      const books = await booksService.getAll();
      patchState(store, { books, isLoading: false });
    },
  })),
);
```

This is preferable to repeating `inject(...)` defaults across multiple `withMethods` blocks.

### 2. Expose `toObservable` views

Bridge a signal-based store to RxJS-based APIs:

```ts
import { toObservable } from '@angular/core/rxjs-interop';

export const BooksStore = signalStore(
  withState({ books: [], isLoading: false }),
  withProps(({ isLoading }) => ({
    isLoading$: toObservable(isLoading),
  })),
);
```

### 3. Static metadata / configuration

```ts
withProps(() => ({
  pageSize: 25,
  apiBase: inject(API_BASE_URL),
}));
```

## What NOT to put in `withProps`

- **State** → use `withState` so it participates in `patchState`, `getState`, and `watchState`.
- **Computed signals** → use `withComputed` so they integrate with the store's signal graph.
- **Methods that mutate state** → use `withMethods` so they are bound and discoverable.

## Privacy

Prefix a property with `_` to make it private to the store:

```ts
withProps(({ count }) => ({
  _count$: toObservable(count),         // hidden from consumers
  count$: toObservable(count),          // public
}));
```

See [private-store-members.md](private-store-members.md).

## Version notes

`withProps` is exported from `@ngrx/signals` from **19.0.0**, read from the published types. On 17 and 18 there is no `withProps`, so this page's "group injected dependencies" pattern is unavailable and the alternative is repeating `inject(...)` defaults across each `withMethods` factory.

| Release | Position |
| ------- | -------- |
| 17.2.0, 18.x | No `withProps` |
| 19.0.0 and later | `withProps` as described here, unchanged through 21 |

`toObservable` comes from `@angular/core/rxjs-interop`, not from `@ngrx/signals`, so its availability tracks your Angular version rather than the store library.

## Gotchas

- Agent generates `withProps` on `@ngrx/signals` 18 - it arrived in 19.0.0
- Agent puts state in `withProps` - it then misses `patchState`, `getState` and `watchState` entirely, so it is invisible to persistence and devtools-style logging
- Agent puts a computed signal in `withProps` instead of `withComputed` - it stays outside the store's signal graph
- Agent puts a state-mutating function in `withProps` - those belong in `withMethods`, where they are bound and discoverable
- Agent destructures props in a later feature and forgets to spread the rest - `withMethods(({ booksService, ...store }) => ...)` is the shape; dropping the spread loses the store
- Agent places `withProps` after the feature that needs it - features merge in order, so the dependency must be declared first
- Agent exposes an injected service as a public prop - consumers can then reach past the store's API straight to the service. Prefix it with `_`
- Agent stores a mutable configuration object in props and mutates it later - props are not reactive, so nothing recomputes

## Related

- [signal-store.md](signal-store.md) · [private-store-members.md](private-store-members.md) · [custom-store-features.md](custom-store-features.md)

