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

