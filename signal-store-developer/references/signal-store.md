# Anatomy of a SignalStore

A `signalStore` returns an injectable Angular service composed from a sequence of **features**. Each feature contributes state, derived signals, methods, properties, or lifecycle hooks. The features are merged in order, so later features can read everything earlier features produced.

## Minimal store

```ts
import { signalStore, withState } from '@ngrx/signals';
import { UserModel } from './user';

type AuthState = {
  user: UserModel | null;
  isAuthenticated: boolean;
};

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
);
```

The exported `AuthStore` is an injectable service. It exposes one signal per top-level key:

- `user: Signal<UserModel | null>`
- `isAuthenticated: Signal<boolean>`

Nested object slices are recursively wrapped as `DeepSignal`s.

## State factory (DI-aware initial state)

When the initial state depends on a service or token, pass a factory. It runs inside the injection context:

```ts
const BookSearchStore = signalStore(
  withState(() => inject(BOOK_SEARCH_STATE)),
);
```

## Derived state: `withComputed`

```ts
import { computed } from '@angular/core';
import { signalStore, withComputed, withState } from '@ngrx/signals';

export const BooksStore = signalStore(
  withState({ books: [] as Book[], filter: 'asc' as 'asc' | 'desc' }),
  withComputed(({ books, filter }) => ({
    booksCount: computed(() => books().length),
    // Bare arrow shorthand is auto-wrapped in `computed()`
    sortedBooks: () => {
      const dir = filter() === 'asc' ? 1 : -1;
      return books().toSorted((a, b) => dir * a.title.localeCompare(b.title));
    },
  })),
);
```

`withComputed` runs inside the injection context so you can `inject(...)` inside it.

## Methods: `withMethods`

Three things go in `withMethods`:

1. **State updaters**: synchronous functions that call `patchState`.
2. **Promise-based side effects**: fine for one-shot fire-and-forget work with no race conditions.
3. **`rxMethod` / `signalMethod`**: for reactive or RxJS-driven side effects (see [rx-method.md](rx-method.md) and [signal-method.md](signal-method.md)).

```ts
import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

export const BooksStore = signalStore(
  withState({
    books: [] as Book[],
    isLoading: false,
    filter: { query: '', order: 'asc' as 'asc' | 'desc' },
  }),
  withMethods((store, booksService = inject(BooksService)) => ({
    setFilter(query: string): void {
      patchState(store, (state) => ({ filter: { ...state.filter, query } }));
    },
    async loadAll(): Promise<void> {
      patchState(store, { isLoading: true });
      const books = await booksService.getAll();
      patchState(store, { books, isLoading: false });
    },
  })),
);
```

The factory runs inside an injection context; default-parameter `inject(...)` calls are the idiomatic way to acquire dependencies. Methods are bound, so components can pass them as callbacks.

## `patchState`

Update state with either a partial object or a function returning a partial object:

```ts
patchState(store, { isLoading: true });
patchState(store, (state) => ({ count: state.count + 1 }));
```

You can pass multiple updaters in one call. They are merged in order:

```ts
patchState(store, setAllEntities(books), setFulfilled());
```

## Providing the store

```ts
// Globally: single shared instance
export const AuthStore = signalStore({ providedIn: 'root' }, withState(...));

// Locally: tied to a component, route, or sub-tree
@Component({
  providers: [PatientFormStore],
  // ...
})
export class PatientForm {
  readonly store = inject(PatientFormStore);
}
```

Do not list a `providedIn: 'root'` store in a component's `providers`. That creates a second instance.

## `protectedState`

By default the state is **protected**: only the store itself may call `patchState`. Do NOT disable this:

```ts
// ❌ Avoid
signalStore({ protectedState: false }, withState(...));
```

External `patchState` writes break the encapsulation that makes the store testable. In tests use `unprotected(store)` from `@ngrx/signals/testing` (see [testing.md](testing.md)).

## Putting it together

```ts
import { computed, inject } from '@angular/core';
import { debounceTime, distinctUntilChanged, pipe, switchMap, tap } from 'rxjs';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';

export const BookSearchStore = signalStore(
  { providedIn: 'root' },
  withState({
    books: [] as Book[],
    isLoading: false,
    filter: { query: '', order: 'asc' as 'asc' | 'desc' },
  }),
  withComputed(({ books, filter }) => ({
    booksCount: computed(() => books().length),
    sortedBooks: computed(() => {
      const dir = filter.order() === 'asc' ? 1 : -1;
      return books().toSorted((a, b) => dir * a.title.localeCompare(b.title));
    }),
  })),
  withMethods((store, booksService = inject(BooksService)) => ({
    updateQuery(query: string): void {
      patchState(store, (state) => ({ filter: { ...state.filter, query } }));
    },
    loadByQuery: rxMethod<string>(
      pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => patchState(store, { isLoading: true })),
        switchMap((query) =>
          booksService.getByQuery(query).pipe(
            tapResponse({
              next: (books) => patchState(store, { books }),
              error: console.error,
              finalize: () => patchState(store, { isLoading: false }),
            }),
          ),
        ),
      ),
    ),
  })),
);
```

