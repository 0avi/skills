# `rxMethod`: Reactive Side Effects (PREFERRED)

`rxMethod` is the project's **default** way to define async side effects in a SignalStore. It takes a chain of RxJS operators and returns a callable that accepts a static value, a signal, a computation function, or an observable. Each invocation pushes the input through the pipe, with cancellation, retry, debouncing, and combination operators available.

Import:

```ts
import { rxMethod } from '@ngrx/signals/rxjs-interop';
```

## Input flexibility

`rxMethod<T>` produces a function whose argument is `T | Signal<T> | (() => T) | Observable<T>`:

```ts
@Component({ /* … */ }) // rxMethod runs at field init, so it needs an injection context
export class Numbers {
  readonly logDoubled = rxMethod<number>(
    pipe(map((n) => n * 2), tap(console.log)),
  );

  constructor() {
    this.logDoubled(1);                              // static value
    this.logDoubled(signal(2));                      // signal, re-runs on change
    this.logDoubled(() => this.a() + this.b());      // computation, re-runs on dep change
    this.logDoubled(interval(1_000));                // observable, runs per emission
  }
}
```

When called with a signal/computation, the method tracks dependencies and **re-runs the entire pipe** whenever any tracked signal changes. This makes `rxMethod` ideal for:

- Auto-fetching when a route param, search query, or selection changes.
- Polling.
- Throttling/debouncing user input.

## Handling API calls: the canonical pattern

```ts
import { inject } from '@angular/core';
import { pipe, switchMap, tap } from 'rxjs';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';

export const BookSearchStore = signalStore(
  withState({ books: [] as Book[], isLoading: false }),
  withMethods((store, books = inject(BooksService)) => ({
    loadByQuery: rxMethod<string>(
      pipe(
        tap(() => patchState(store, { isLoading: true })),
        switchMap((q) =>
          books.getByQuery(q).pipe(
            tapResponse({
              next: (data) => patchState(store, { books: data }),
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

Wire it up from `withHooks` to react to a query signal:

```ts
withHooks({
  onInit(store) {
    store.loadByQuery(store.query);
  },
}),
```

Now every time `query` changes, the previous request is cancelled (`switchMap`) and a new one fires.

### Why `tapResponse`?

A raw RxJS error escapes the source observable and **kills** an `rxMethod` source for good (the `tap` / `switchMap` chain is unsubscribed). `tapResponse` from `@ngrx/operators` keeps the outer stream alive while letting you handle `next` / `error` / `complete` / `finalize` per emission. Always wrap HTTP calls with it.

## Operator cheat sheet

| Operator         | When to use in a store                                                    |
| ---------------- | ------------------------------------------------------------------------- |
| `switchMap`      | Latest-wins. Cancel previous request on new input. (Default for searches.) |
| `exhaustMap`     | Ignore new triggers while one is in flight. (Login, submit buttons.)      |
| `concatMap`      | Queue serially. (Sequential PATCH operations.)                            |
| `mergeMap`       | Run in parallel. (Independent fan-out.)                                   |
| `debounceTime`   | Wait for user to stop typing.                                             |
| `distinctUntilChanged` | Skip when value is unchanged.                                       |
| `retry({ count, delay })` | Auto-retry transient failures.                                   |
| `withLatestFrom` | Combine with another signal/observable at trigger time.                   |
| `tapResponse`    | Safe `next` / `error` / `finalize` for HTTP calls.                        |

## Reactive methods without arguments

Use `void`:

```ts
loadAll: rxMethod<void>(
  exhaustMap(() =>
    booksService.getAll().pipe(
      tapResponse({
        next: (books) => patchState(store, { books }),
        error: console.error,
      }),
    ),
  ),
),
```

Call with `store.loadAll()`.

## Cleanup

When `rxMethod` is created inside an injection context, it auto-cleans on destroy. Two edge cases:

### 1. Called from a descendant context

```ts
@Injectable({ providedIn: 'root' })
class NumbersService {
  readonly log = rxMethod<number>(tap(console.log));
}

@Component({ /* … */ })
export class Numbers {
  readonly svc = inject(NumbersService);
  readonly injector = inject(Injector);

  constructor() {
    this.svc.log(interval(1_000));                                // auto-clean on component destroy
  }

  ngOnInit(): void {
    this.svc.log(interval(2_000), { injector: this.injector });   // need explicit injector outside injection context
  }
}
```

**Warning:** Calling a reactive method with a signal/observable outside an injection context without an injector is deprecated and will throw in a future version.

### 2. Manual disposal

The method itself has a `destroy()` method, and each invocation returns a ref with its own `destroy()`:

```ts
const ref = store.logNumber(interval(500));
setTimeout(() => ref.destroy(), 2_000);                           // stop this one call
store.logNumber.destroy();                                         // stop all calls
```

## Initialising outside an injection context

```ts
ngOnInit(): void {
  const log = rxMethod<number>(tap(console.log), { injector: this.injector });
  log(10);
}
```

## `rxMethod` vs `signalMethod`

- **`rxMethod`**: full RxJS power. Required for race-condition control (`switchMap`, `exhaustMap`), HTTP calls, debouncing, retries.
- **`signalMethod`**: no RxJS dependency, smaller bundle. Use when the only "reactivity" is "do X whenever this signal changes". See [signal-method.md](signal-method.md).

When in doubt for async work, use `rxMethod`.

## Version notes

`rxMethod` is in `@ngrx/signals/rxjs-interop` from the earliest published release, 17.2.0, and this page's shapes hold through 21.

| Detail | Floor |
| ------ | ----- |
| `rxMethod` itself | 17.2.0 |
| `signalMethod`, the RxJS-free alternative below | 19.0.0 |
| `unprotected`, used when testing these methods | 19.1.0 |
| `TestBed.tick()`, the way to flush these in tests | Angular **20** |

On `@ngrx/signals` 17 and 18 there is no `signalMethod`, so `rxMethod` or a plain `effect` are the only options and the "bundle size friendly alternative" advice does not apply. `tapResponse` and `mapResponse` come from `@ngrx/operators`, which is versioned independently of `@ngrx/signals`.

Calling a reactive method with a signal or observable from outside an injection context, with no `{ injector }`, is deprecated and slated to throw. Pass the injector today rather than relying on the current tolerance.

## Gotchas

- Agent calls `store.loadByQuery(store.query())` - passing the value makes it a one-shot. Pass the signal `store.query` to get re-execution on change
- Agent puts the HTTP call in `switchMap` without `tapResponse` - one error unsubscribes the source and the method is dead for the rest of the store's life
- Agent uses `mergeMap` for a search - responses can arrive out of order and a stale result overwrites a newer one
- Agent uses `switchMap` for a submit button - that cancels the in-flight write. `exhaustMap` is the one that ignores repeat clicks
- Agent sets `isLoading: true` in `tap` and clears it in `next` - an error then leaves the spinner on forever. Clear it in `finalize`
- Agent calls the method with a signal from `ngOnInit` without `{ injector }` - deprecated, and the effect's lifetime is then wrong
- Agent adds `takeUntilDestroyed()` inside the pipe - redundant when created in an injection context, and it can complete the source permanently
- Agent wraps the `rxMethod` in an arrow inside `withMethods` - that loses the signal and observable overloads, leaving only the plain value call
- Agent declares `rxMethod` as a field on a class constructed outside an injection context - it runs at field initialisation and needs the context
- Agent expects `finalize` to fire once per method call under `switchMap` - cancellation makes it fire per inner subscription

## Related

- [signal-method.md](signal-method.md) · [signal-store.md](signal-store.md) · [lifecycle-hooks.md](lifecycle-hooks.md) · [events.md](events.md) · [testing.md](testing.md)

