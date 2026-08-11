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

## Version notes

The core of this page is the oldest and most stable part of the library: `signalStore`, `withState`, `withComputed`, `withMethods`, `withHooks`, `patchState`, `getState` and `signalStoreFeature` are all present in the earliest published release, `@ngrx/signals` 17.2.0, and their shapes here are unchanged through 21.

| Symbol | Floor, read from the published types |
| ------ | ------------------------------------ |
| `signalStore`, `withState`, `withComputed`, `withMethods`, `patchState`, `getState` | 17.2.0 |
| `watchState` | 18.0.0 |
| `deepComputed` | 18.1.0 |
| `withProps` | 19.0.0 |
| `withLinkedState` | 20.0.0 |

Two things on this page are **not** library features and depend on your TypeScript configuration rather than your `@ngrx/signals` version:

- `books().toSorted(...)` needs `lib` to include **ES2023**. The Angular CLI generates `"target": "ES2022"` with no explicit `lib`, so `lib` defaults from the target and this fails with **TS2550** in a default Angular 19, 20 or 21 project. Either raise `lib` to `ES2023`, or write `[...books()].sort(...)`.
- The bare arrow shorthand in `withComputed`, which the library wraps in `computed()` for you, is a convenience. Writing `computed()` explicitly always works and is clearer once the body is more than one line.

## Gotchas

- Agent uses `books().toSorted(...)` on the Angular CLI's default tsconfig - TS2550, because `lib` resolves to ES2022. A tsconfig problem, not a store problem
- Agent lists a `{ providedIn: 'root' }` store in a component's `providers` - that creates a second independent instance and the shared state silently splits in two
- Agent patches a nested slice without spreading - `patchState(store, { filter: { query } })` replaces the whole `filter` and drops `order`. Use the function form and spread
- Agent destructures values instead of signals - `const { books } = store` keeps the signal, `books()` does not. Pass signals and read at the point of use
- Agent calls `patchState` from a component - state is protected by default and the compiler rejects it. Add a method to the store
- Agent disables `protectedState` to make a test easier - use `unprotected` from `@ngrx/signals/testing`, which needs 19.1.0
- Agent puts a side effect inside a `withComputed` body
- Agent reads a state signal at `withMethods` factory time rather than inside the method body - that captures one value, not the signal
- Agent adds a `withState` slice for something derivable, then keeps the two in sync by hand
- Agent writes a `constructor` to inject dependencies - there is no constructor to write. Use `inject(...)` as a default parameter in the feature factory

## Related

- [rx-method.md](rx-method.md) · [lifecycle-hooks.md](lifecycle-hooks.md) · [custom-store-properties.md](custom-store-properties.md) · [linked-state.md](linked-state.md) · [private-store-members.md](private-store-members.md) · [testing.md](testing.md)

