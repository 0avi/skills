# Linked State (`withLinkedState`)

`withLinkedState` defines state slices that automatically track other signals while still being writable. It is the SignalStore equivalent of Angular's `linkedSignal`. The slices become first-class state: they show up in `getState`, can be updated via `patchState`, and are wrapped in `DeepSignal`s.

## Implicit linking: computation function

Pass a computation function and the store wraps it in a `linkedSignal()`. The slice recomputes whenever any signal it reads changes; manual `patchState` calls still work and "win" until the next source change.

```ts
import {
  patchState, signalStore, withLinkedState, withMethods, withState,
} from '@ngrx/signals';

export const OptionsStore = signalStore(
  withState({ options: [1, 2, 3] }),
  withLinkedState(({ options }) => ({
    // Resets to options()[0] whenever options changes.
    selectedOption: () => options()[0] ?? undefined,
  })),
  withMethods((store) => ({
    setOptions(options: number[]): void {
      patchState(store, { options });
    },
    setSelectedOption(selectedOption: number): void {
      patchState(store, { selectedOption });
    },
  })),
);
```

Behaviour:

```ts
store.selectedOption(); // 1
store.setSelectedOption(2);
store.selectedOption(); // 2
store.setOptions([4, 5, 6]);
store.selectedOption(); // 4, recomputed from the new options
```

## Explicit linking: `linkedSignal` with previous value

When the slice needs to react to source changes but preserve user intent, return a `linkedSignal` with `source` + `computation`:

```ts
import { linkedSignal } from '@angular/core';
import { signalStore, withLinkedState, withState } from '@ngrx/signals';

export const OptionsStore = signalStore(
  withState({ options: [] as Option[] }),
  withLinkedState(({ options }) => ({
    selectedOption: linkedSignal<Option[], Option>({
      source: options,
      computation: (newOptions, previous) => {
        const stillThere = newOptions.find((o) => o.id === previous?.value.id);
        return stillThere ?? newOptions[0];
      },
    }),
  })),
);
```

## When to choose `withLinkedState` vs `withComputed`

- **`withComputed`** → read-only derived value. Cannot be `patchState`'d.
- **`withLinkedState`** → derived initial value that the user can override; resets when sources change.

Use `withLinkedState` for things like the currently-selected row in a list, the active tab keyed by route params, or a form field pre-filled from server data.

## Version notes

`withLinkedState` is exported from `@ngrx/signals` from **20.0.0**, read from the published types. It is the newest of the state-contributing features, so this page does not apply to 17, 18 or 19.

| Release | Position |
| ------- | -------- |
| 17.2.0 to 19.x | No `withLinkedState`. Hold the slice in `withState` and reset it explicitly from the method that changes the source |
| 20.0.0 and later | `withLinkedState` as described here |

The explicit form shown above wraps Angular's `linkedSignal`, which is **Angular 19**, so on Angular 18 neither form is available regardless of the `@ngrx/signals` version.

## Gotchas

- Agent generates `withLinkedState` on `@ngrx/signals` 19 - it arrived in 20.0.0
- Agent uses it where `withComputed` belongs - if nothing ever writes the slice, it is derived state and should be read-only
- Agent uses it for a value that must survive source changes - the point of the feature is that it *resets* when sources change. Use `withState` if the user's choice should persist
- Agent expects a manual `patchState` to stick permanently - it wins only until the next source change, which is easy to misread as a lost write
- Agent reads `previous?.value` without the optional chain - `previous` is undefined on the first computation
- Agent puts an expensive computation in the implicit form - it re-runs on every source change, so memoise upstream
- Agent forgets the slice is real state - it appears in `getState`, so anything persisting whole-state snapshots now round-trips a derived value
- Agent links to a signal that the same store writes in a method, creating a loop between the source and the linked slice

## Related

- [signal-store.md](signal-store.md) · [state-tracking.md](state-tracking.md) · [custom-store-properties.md](custom-store-properties.md)

