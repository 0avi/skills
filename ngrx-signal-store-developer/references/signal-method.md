# `signalMethod`: Reactive Side Effects Without RxJS

`signalMethod` is the RxJS-free sibling of `rxMethod`. It runs a processor function whenever its input signal changes, but loses RxJS operators in exchange for a smaller bundle and a simpler mental model.

Import:

```ts
import { signalMethod } from '@ngrx/signals';
```

## Basic usage

The processor accepts the value type `T`. The returned callable accepts `T | Signal<T> | (() => T)`:

```ts
import { Component, signal } from '@angular/core';
import { signalMethod } from '@ngrx/signals';

@Component({ /* … */ })
export class Numbers {
  readonly logDoubled = signalMethod<number>((n) => {
    console.log(n * 2);
  });

  constructor() {
    this.logDoubled(1);                       // logs 2 (one-shot)
    const num = signal(2);
    this.logDoubled(num);                     // logs 4, then re-runs on every num.set
    this.logDoubled(() => this.a() + this.b()); // re-runs when a or b change
  }
}
```

## Cleanup model

Internally `signalMethod` uses an `effect`. The effect's lifetime follows the caller's injection context (when called inside one) or, if invoked outside an injection context, falls back to the injector where `signalMethod` was **created**.

```ts
@Injectable({ providedIn: 'root' })
class NumbersService {
  readonly logDoubled = signalMethod<number>((n) => console.log(n * 2));
}

@Component({ /* … */ })
class Numbers {
  readonly svc = inject(NumbersService);
  readonly injector = inject(Injector);

  ngOnInit(): void {
    const value = signal(2);
    // The service lives in root, so without an explicit injector this effect
    // would outlive the component (memory leak).
    this.svc.logDoubled(value, { injector: this.injector });

    this.svc.logDoubled(2);  // static, no effect created, no injector needed
  }
}
```

**Rule:** if `signalMethod` was created in an ancestor injector and you call it with a signal/computation outside an injection context, you must pass `{ injector: ... }`. Static-value calls don't need it.

## Initialising outside an injection context

```ts
ngOnInit(): void {
  const log = signalMethod<number>((n) => console.log(n * 2), { injector: this.injector });
}
```

## Advantages over a plain `effect`

| | `signalMethod` | `effect` |
|---|---|---|
| Input type | `T \| Signal<T> \| (() => T)` | Closure capture only |
| Reusable with many inputs | ✅ | ❌ (one effect per call) |
| Needs injection context to call | ❌ for static, ✅ for signals (with explicit fallback) | Always ✅ |
| Tracks only declared inputs | ✅ (signals inside the body stay untracked) | ❌ (tracks every signal it reads) |

## `signalMethod` vs `rxMethod`

`signalMethod` ≈ `rxMethod` without RxJS: smaller bundle, no operators.

**Choose `signalMethod` when:**

- The work is purely synchronous or uses native Promises with no need for cancellation.
- You want to react to a signal change with a small side effect (sync to storage, navigate, log).
- Bundle size matters and you don't need RxJS.

**Choose `rxMethod` when:**

- Race conditions matter. RxJS has `switchMap`, `concatMap`, `exhaustMap`; signals coalesce synchronous updates (glitch-free) and can drop intermediate values.
- You need debouncing, retry, throttling, polling, or composition with other observables.
- You're handling HTTP calls. `tapResponse` from `@ngrx/operators` is invaluable.

Most data-fetching stores in this project should use **`rxMethod`**. Reserve `signalMethod` for lightweight side effects.

