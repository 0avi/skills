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

