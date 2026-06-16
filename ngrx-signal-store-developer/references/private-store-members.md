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

