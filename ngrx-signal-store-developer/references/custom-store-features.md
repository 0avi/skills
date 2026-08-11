# Custom Store Features (`signalStoreFeature`)

`signalStoreFeature` packages a sequence of features behind a function so the same combination of state + computed + methods + hooks can be reused across stores. Think of it as a "trait" or "mixin" for SignalStores.

## When to extract a feature

- Two or more stores share the same state shape (e.g. `requestStatus`, `pagination`, `selection`).
- A repeating pattern needs typed input (for example, it expects an `EntityState<X>`).
- You want a single place to wire cross-cutting concerns like logging or persistence.

## Standalone feature (no input)

```ts
import { computed } from '@angular/core';
import { signalStoreFeature, withComputed, withState } from '@ngrx/signals';

export type RequestStatus = 'idle' | 'pending' | 'fulfilled' | { error: string };
export type RequestStatusState = { requestStatus: RequestStatus };

export function withRequestStatus() {
  return signalStoreFeature(
    withState<RequestStatusState>({ requestStatus: 'idle' }),
    withComputed(({ requestStatus }) => ({
      isPending: computed(() => requestStatus() === 'pending'),
      isFulfilled: computed(() => requestStatus() === 'fulfilled'),
      error: computed(() => {
        const s = requestStatus();
        return typeof s === 'object' ? s.error : null;
      }),
    })),
  );
}
```

Pair the feature with **standalone updater functions** rather than methods on the feature itself. Updaters tree-shake, are easy to test, and compose nicely inside one `patchState` call:

```ts
export const setPending = (): RequestStatusState => ({ requestStatus: 'pending' });
export const setFulfilled = (): RequestStatusState => ({ requestStatus: 'fulfilled' });
export const setError = (error: string): RequestStatusState => ({ requestStatus: { error } });
```

Use it:

```ts
export const BooksStore = signalStore(
  withEntities<Book>(),
  withRequestStatus(),
  withMethods((store, booksService = inject(BooksService)) => ({
    async loadAll(): Promise<void> {
      patchState(store, setPending());
      const books = await booksService.getAll();
      patchState(store, setAllEntities(books), setFulfilled());
    },
  })),
);
```

## Feature with typed input

`signalStoreFeature` can declare what state/props/methods it expects the host store to already provide. Use the `type<...>()` helper from `@ngrx/signals` to phrase the contract:

```ts
import { computed } from '@angular/core';
import { signalStoreFeature, type, withComputed, withState } from '@ngrx/signals';
import { EntityId, EntityState } from '@ngrx/signals/entities';

export type SelectedEntityState = { selectedEntityId: EntityId | null };

export function withSelectedEntity<Entity>() {
  return signalStoreFeature(
    { state: type<EntityState<Entity>>() },         // contract
    withState<SelectedEntityState>({ selectedEntityId: null }),
    withComputed(({ entityMap, selectedEntityId }) => ({
      selectedEntity: computed(() => {
        const id = selectedEntityId();
        return id ? entityMap()[id] : null;
      }),
    })),
  );
}
```

If a host store doesn't satisfy the contract, the compile breaks:

```ts
// ❌ EntityState properties (entityMap, ids) are missing
signalStore(withState({ books: [] }), withSelectedEntity());

// ✅
signalStore(withEntities<Book>(), withSelectedEntity());
```

You can require `props` and `methods` too:

```ts
signalStoreFeature(
  {
    props: type<{ foo: Signal<number> }>(),
    methods: type<{ bar(n: number): void }>(),
  },
  withMethods((store) => ({ baz: () => store.bar(store.foo()) })),
);
```

## TypeScript pitfall: empty generic for input-only features

When a feature accepts input but declares no generic parameter, combining it with other input features can fail to compile. Add an unused generic to defeat the issue:

```ts
function withZ<_>() { /* … */ }
function withW<_>() { /* … */ }

signalStore(withState({ x: 1, y: 1 }), withZ(), withW()); // ✅
```

## `withFeature`: runtime composition

`signalStoreFeature`'s typed input contract is purely structural. When the feature needs a **value** (e.g. a specific signal from the host store) at compose time, use `withFeature`. The callback receives the store-assembled-so-far and returns a feature.

```ts
import { computed, Signal } from '@angular/core';
import { signalStore, signalStoreFeature, withComputed, withFeature, withMethods, withState, patchState } from '@ngrx/signals';
import { withEntities } from '@ngrx/signals/entities';

export function withBooksFilter(books: Signal<Book[]>) {
  return signalStoreFeature(
    withState({ query: '' }),
    withComputed(({ query }) => ({
      filteredBooks: computed(() => books().filter((b) => b.name.includes(query()))),
    })),
    withMethods((store) => ({
      setQuery(query: string): void { patchState(store, { query }); },
    })),
  );
}

export const BooksStore = signalStore(
  withEntities<Book>(),
  withFeature(({ entities }) => withBooksFilter(entities)),
);
```

## Logging feature: the canonical example

```ts
import { effect } from '@angular/core';
import { getState, signalStoreFeature, withHooks } from '@ngrx/signals';

export function withLogger(name: string) {
  return signalStoreFeature(
    withHooks({
      onInit(store) {
        effect(() => console.log(`${name} state`, getState(store)));
      },
    }),
  );
}
```

```ts
signalStore(withEntities<Book>(), withRequestStatus(), withLogger('books'));
```

## Design checklist

- Prefer **loosely-coupled** features without input. Reach for `type<...>()` contracts only when truly necessary.
- Export updater functions alongside the feature for tree-shaking and composition.
- Test custom features by wrapping them in a minimal `signalStore(...)` and asserting on that store (see [testing.md](testing.md)).

## Version notes

`signalStoreFeature` and the `type<...>()` helper are in the earliest published release, 17.2.0. `withFeature` is newer: the published types put it in `@ngrx/signals` 19.1.0.

| Symbol | Floor, read from the published types |
| ------ | ------------------------------------ |
| `signalStoreFeature`, `type` | 17.2.0 |
| `withFeature` | **19.1.0** |
| `withProps`, if the feature contributes props | 19.0.0 |
| `withLinkedState`, if the feature contributes linked state | 20.0.0 |

On 17 and 18 there is no `withFeature`, so a feature needing a value from the host store has to take it as a plain function argument and be composed by hand, as `withBooksFilter(entities)` would be if you already had the signal.

The empty-generic workaround described above is a TypeScript inference limitation rather than a library version issue, and it still applies on 21.

## Gotchas

- Agent declares an input contract with `type<...>()` when the feature needs no input - contracts couple the feature to the host's shape. Prefer loosely coupled features
- Agent writes two input-taking features with no generic parameter and composes them - inference collapses. Add the unused generic, as `withZ<_>()`
- Agent uses `withFeature` when a structural contract would do - `withFeature` is for when the feature needs an actual value at compose time, not a shape
- Agent puts methods on the feature where standalone updater functions would tree-shake and compose inside one `patchState`
- Agent composes a feature before the state it reads - features merge in order
- Agent has a feature reference a host member prefixed with `_` - private members cannot appear in an input contract. See [private-store-members.md](private-store-members.md)
- Agent duplicates a `requestStatus` slice in two features that are then composed into one store - the second `withState` overwrites the first for any shared key
- Agent tests a feature by inspecting the returned object rather than composing it into a store
- Agent generates `withFeature` on `@ngrx/signals` 18 - it arrived in 19.1.0

## Related

- [signal-store.md](signal-store.md) · [entity-management.md](entity-management.md) · [custom-store-properties.md](custom-store-properties.md) · [state-tracking.md](state-tracking.md) · [testing.md](testing.md)

