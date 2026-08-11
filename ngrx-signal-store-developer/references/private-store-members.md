# Private Store Members

Any store member whose key starts with an underscore (`_`) is **private**: it is stripped from the public type of the store. Consumers that try to call `store._method()` or read `store._slice()` get a TypeScript error.

Privacy works on every kind of member:

| Member kind          | Public            | Private             |
| -------------------- | ----------------- | ------------------- |
| State slice          | `count`           | `_count`            |
| Computed signal      | `doubleCount`     | `_doubleCount`      |
| Custom prop          | `count$`          | `_count$`           |
| Method               | `increment`       | `_increment`        |
| Named entity collection | `book`         | `_book`             |

## Example

```ts
import { computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  patchState, signalStore, withComputed, withMethods, withProps, withState,
} from '@ngrx/signals';

export const CounterStore = signalStore(
  withState({
    count1: 0,
    _count2: 0,           // private state
  }),
  withComputed(({ count1, _count2 }) => ({
    _doubleCount1: computed(() => count1() * 2),   // private computed
    doubleCount2: computed(() => _count2() * 2),
  })),
  withProps(({ _count2, _doubleCount1 }) => ({
    _count2$: toObservable(_count2),               // private prop
    doubleCount1$: toObservable(_doubleCount1),
  })),
  withMethods((store) => ({
    increment1(): void {
      patchState(store, { count1: store.count1() + 1 });
    },
    _increment2(): void {                          // private method
      patchState(store, { _count2: store._count2() + 1 });
    },
  })),
);
```

In a consuming component:

```ts
store.count1();          // ✅
store._count2();         // ❌ compile error
store._doubleCount1();   // ❌
store.doubleCount2();    // ✅
store.increment1();      // ✅
store._increment2();     // ❌
```

## When to make a member private

- **Implementation detail**: intermediate computed signals or helper methods that other features use, but consumers must not.
- **Mutable raw storage** behind a public, narrower computed view (typical with `withEntities`; see [entity-management.md](entity-management.md) for the `_books` → `books` pattern).
- **Internal observables** for bridging with RxJS-based plumbing.

## Privacy is "soft" at runtime

The `_` is real on the instance and accessible at runtime, but the public TypeScript type omits it. Don't rely on privacy for security; it's an API-design tool. Sensitive data still needs proper handling.

## Version notes

The `_` prefix convention is present in the earliest published release, `@ngrx/signals` 17.2.0, and applies to every member kind through 21. It is version-agnostic within the range this skill targets.

The one part with a floor is the table row for named entity collections: private collections need the `entityConfig` form, which is `@ngrx/signals` **18.0.0**. On 17 you can still prefix a plain `withEntities` store's members, but not a named collection. See [entity-management.md](entity-management.md).

## Gotchas

- Agent treats `_` as an access control - it is a type-level omission only. The member is on the instance at runtime, so this is API design, never security
- Agent puts a token, credential or personal data in a `_` slice and considers it protected
- Agent exposes a private slice by returning it unchanged from a public computed - `todos: _todoEntities` re-publishes the same signal, which is sometimes the intent and sometimes an accidental leak
- Agent renames a public member to `_name` and breaks every consumer at once - that is a breaking API change, not a refactor
- Agent uses `_` on a member a custom feature needs from the host store - a `signalStoreFeature` input contract cannot reference private members
- Agent prefixes a method that components legitimately call, then works around the compile error with a cast
- Agent assumes `_` hides the member from `getState` - state slices still appear in the snapshot regardless of the prefix

## Related

- [signal-store.md](signal-store.md) · [custom-store-properties.md](custom-store-properties.md) · [entity-management.md](entity-management.md) · [custom-store-features.md](custom-store-features.md)

