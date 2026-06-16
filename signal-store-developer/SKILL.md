---
name: signal-store-developer
description: Generates and refactors `@ngrx/signals` SignalStore code and provides architectural guidance. Trigger when creating or migrating Angular stores; when working with `signalStore`, `withState`, `withComputed`, `withMethods`, `withProps`, `withHooks`, `withLinkedState`, `withEntities`, `withReducer`, or `withEventHandlers`; when handling async side effects with `rxMethod` / `signalMethod`; when defining reusable `signalStoreFeature`s; when wiring `Events` / `Dispatcher` / `injectDispatch`; or when testing stores with `TestBed`, `unprotected`, and `patchState`.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# SignalStore Developer Guidelines

These guidelines apply to any Angular code that uses `@ngrx/signals` (the NgRx Signals library). The skill is **fully usable on its own**, but it pairs best with the [`angular-developer`](https://github.com/angular/skills) skill. When both are installed, follow Angular's signal, component, accessibility, and testing rules first, then layer these SignalStore patterns on top.

1. **Always colocate state with the domain.** A `signalStore` is just an Angular service. Place the store next to the feature it serves (`feature/foo.store.ts`) and never inside the component file.

2. **Prefer SignalStore over adhoc `signal()` + `inject(HttpClient)` patterns.** If a component is calling `HttpClient` directly through `firstValueFrom` and tracking `loading` / `error` with raw `signal()`, that logic belongs in a `signalStore`. Components should consume signals and methods, not orchestrate I/O.

3. **`rxMethod` is the default for async side effects.** Promise based `withMethods` are acceptable for one shot fire and forget work that does not need cancellation, retry, debouncing, or reactive reexecution. Anything that:
   - reacts to a signal/observable changing,
   - benefits from `switchMap` / `exhaustMap` / `concatMap` cancellation semantics,
   - needs debouncing, retry, or polling,
   - or returns multiple emissions
   MUST use `rxMethod` from `@ngrx/signals/rxjs-interop`. Wrap response handling with `tapResponse` (or `mapResponse` for the events plugin) from `@ngrx/operators` to guarantee the stream never errors out.

4. **`signalMethod` is the bundle size friendly alternative** when the side effect does not need RxJS operators. Use it for things like "log this signal", "navigate when this signal becomes true", "sync a signal to `localStorage`".

5. **Do NOT disable `protectedState`.** Default behaviour (state cannot be mutated from outside) is mandatory. All mutations go through `withMethods` / `withReducer` and the `patchState` helper.

6. **Naming conventions:**
   - Store class identifier: `PascalCase` ending in `Store` (e.g. `PatientStore`, `NoticeStore`).
   - File: `kebab-case.store.ts` (e.g. `patient.store.ts`).
   - Custom features: `withXxx` factory functions in `with-xxx.ts`.
   - Event groups: `xxxEvents` exported from `xxx-events.ts`.

7. **Provisioning:**
   - Cross feature / app wide stores → `{ providedIn: 'root' }`.
   - Stores whose lifetime should match a route or component (e.g. a wizard, a form) → omit `providedIn` and list the store in the component's `providers: [...]`.
   - Never reprovide a `providedIn: 'root'` store in a component.

8. **Always run your project's build or typecheck after generating or modifying a store** (`ng build`, `npm run build`, or `tsc --noEmit`, whichever your repo uses). SignalStore has heavy generic types, so a clean compile is the only proof the types compose correctly.

## Installation

This skill targets `@ngrx/signals` v21 or later (Angular 21, TypeScript 5.9, RxJS 7). It relies on v21 APIs such as `withEventHandlers` (called `withEffects` before v21), plus `withLinkedState` and `withFeature` from v20 and `withProps` and `signalMethod` from v19, so several examples will not compile on older NgRx versions.

Read [install.md](references/install.md) for the install steps. Verify `@ngrx/signals` is installed (and add it if it is not). For `rxMethod` + safe response handling, also install `@ngrx/operators`.

## Creating a Store

When designing a SignalStore, consult these references in order:

- **Anatomy of a SignalStore**: `signalStore`, `withState`, `withComputed`, `withMethods`, `patchState`, providing the store, and the `protectedState` rule. Read [signal-store.md](references/signal-store.md)
- **Lifecycle Hooks (`withHooks`)**: Run initialization logic on store creation; cleanup on destroy; use `takeUntilDestroyed`. Read [lifecycle-hooks.md](references/lifecycle-hooks.md)
- **Custom Store Properties (`withProps`)**: Group injected dependencies, expose `toObservable` views, store static metadata. Read [custom-store-properties.md](references/custom-store-properties.md)
- **Linked State (`withLinkedState`)**: Derive writable state from existing signals; the SignalStore version of `linkedSignal`. Read [linked-state.md](references/linked-state.md)
- **State Tracking**: `getState`, `watchState`, for synchronous and reactive observation for logging, undo/redo, persistence. Read [state-tracking.md](references/state-tracking.md)
- **Private Store Members**: Use the `_` prefix to hide state, computed signals, props, and methods from consumers. Read [private-store-members.md](references/private-store-members.md)

## Async Side Effects

When the store needs to talk to a service, route the call through one of these:

- **`rxMethod` (PREFERRED for async)**: Reactive methods built from RxJS pipes. Auto tracks signal inputs, auto cleans up via injection context, supports observables, `switchMap`, `tapResponse`, retry, debounce. Read [rx-method.md](references/rx-method.md)
- **`signalMethod`**: RxJS free side effects for value tracking. Smaller bundle. Read [signal-method.md](references/signal-method.md)
- **Async methods (`async/await` in `withMethods`)**: Acceptable only for simple one shot operations with no cancellation/race semantics. If you find yourself writing `firstValueFrom(http.get(...))` inside a store method, replace it with `rxMethod` and `tapResponse`.

## Sharing Behaviour Across Stores

When the same shape of state or behaviour appears in two or more stores, factor it into a custom feature:

- **Custom Store Features (`signalStoreFeature`)**: Bundle state + computed + methods + hooks into a reusable feature. Supports typed input requirements (`{ state: type<...>(), props: type<...>(), methods: type<...>() }`) and the `withFeature` escape hatch for runtime-dependent features. Read [custom-store-features.md](references/custom-store-features.md)
- **Entity Management (`withEntities`)**: Standardise collection storage with `entityMap`, `ids`, `entities` plus the `addEntity` / `setAllEntities` / `updateEntity` / `removeEntity` updater family. Read [entity-management.md](references/entity-management.md)

## Event Driven Stores

For inter store coordination or when a Flux style audit trail is valuable:

- **Events Plugin**: `event` / `eventGroup`, `withReducer`, `withEventHandlers`, `Dispatcher`, `injectDispatch`, scoped events via `provideDispatcher()`. Read [events.md](references/events.md)

Note: The events plugin is opt-in. Default to method-based stores; reach for events when at least two stores need to react to the same trigger or when a feature genuinely benefits from a dispatch/handler split.

## Testing

When writing or updating tests for a SignalStore:

- Use `TestBed.inject(MyStore)` (never `new MyStore()`) so injection context, `rxMethod`, and `signalMethod` work.
- Assert on the public API (state signals, computed signals, method side-effects on state).
- Use `unprotected(store)` from `@ngrx/signals/testing` when a test must `patchState` directly.
- For `rxMethod` / `signalMethod` tests, drive inputs with signals or observables and flush with `TestBed.tick()` (Angular 20+, works in any test runner). `expect.poll` is Vitest only; under Jasmine or Jest reach for `fakeAsync` and `tick()`.
- Read [testing.md](references/testing.md)

## Forbidden Patterns

Never generate these, even if asked indirectly:

- Direct state mutation (calling `.set()` on a state signal, or pushing into an array signal). Every write goes through `patchState`.
- Derived data kept as its own state slice. Derive it with `withComputed` or `withLinkedState`.
- God stores: one store holding unrelated feature state. Split by domain.
- Side effects inside `computed()`. Never put `patchState`, HTTP, or logging in a computed.
- Manual or nested `.subscribe()`. Use `rxMethod`; if you must subscribe, pipe `takeUntilDestroyed()`.
- Exposing a `WritableSignal` to consumers. Expose read only signals and keep writes inside methods.
- Disabling state protection with `signalStore({ protectedState: false })`.

## When NOT to Use SignalStore

- **Pure UI local ephemeral state** (open/closed flag for a single accordion, hover state, focus tracking). Keep that in plain `signal()` inside the component.
- **Fully dynamic schemas** where shape is server-driven and unknown at compile time. A plain `WritableSignal<Record<string, unknown>>` is often clearer than fighting `withState` generics (this is common for runtime-defined forms).
- **Single-shot navigation/route data** that fits into Angular's `ResolveFn` or `httpResource`. Use those instead of materialising a one-off store.

