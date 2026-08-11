# Installing `@ngrx/signals`

These notes target `@ngrx/signals` v21 or later (Angular 21, TypeScript 5.9, RxJS 7). They cover (1) what `@ngrx/signals` ships, (2) the secondary entry points you will import from, and (3) the optional companion packages.

## Verify the install

Check whether the package is already a dependency:

```sh
npm ls @ngrx/signals    # pnpm list @ngrx/signals  |  yarn why @ngrx/signals
```

If it is missing, add it with your project's package manager:

```sh
npm install @ngrx/signals    # pnpm add @ngrx/signals  |  yarn add @ngrx/signals
```

## Secondary entry points

`@ngrx/signals` is split into focused subpaths. Import from the most specific one, never from a deep relative path.

| Import path                          | When to use                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `@ngrx/signals`                      | `signalStore`, `signalState`, `withState`, `withComputed`, `withMethods`, `withProps`, `withHooks`, `withLinkedState`, `patchState`, `getState`, `watchState`, `signalStoreFeature`, `signalMethod`, `type`. |
| `@ngrx/signals/rxjs-interop`         | `rxMethod`: RxJS-powered reactive methods.                                                   |
| `@ngrx/signals/entities`             | `withEntities`, `entityConfig`, `addEntity`, `setAllEntities`, `updateEntity`, `removeEntity`, etc. |
| `@ngrx/signals/events`               | `event`, `eventGroup`, `withReducer`, `withEventHandlers`, `Dispatcher`, `injectDispatch`, `provideDispatcher`. |
| `@ngrx/signals/testing`              | `unprotected` helper used in tests.                                                          |

## Optional companions

- **`@ngrx/operators`**: provides `tapResponse` and `mapResponse`. **Strongly recommended** for any `rxMethod` that performs an HTTP call. Without it you must hand-write the error/finalize branches.

  ```sh
  npm install @ngrx/operators    # pnpm add @ngrx/operators  |  yarn add @ngrx/operators
  ```

## Packages you do not need

`@ngrx/signals` is standalone. It does not depend on the Redux-style NgRx packages and is not configured through them. For a SignalStore feature, do not install or import any of these:

| Package | What it actually is | SignalStore equivalent |
| ------- | ------------------- | ---------------------- |
| `@ngrx/store` | The Redux-style global store: `createAction`, `createReducer`, `createSelector`, `provideStore`. | `signalStore` with `withState` / `withMethods`, or `withReducer` from `@ngrx/signals/events`. |
| `@ngrx/effects` | Side effects for `@ngrx/store`: `createEffect`, `provideEffects`. | `rxMethod`, or `withEventHandlers` when using the events plugin. |
| `@ngrx/entity` | The entity adapter for `@ngrx/store`. | `withEntities` from `@ngrx/signals/entities`, already inside `@ngrx/signals`. |
| `@ngrx/component-store` | The pre-signals per-component store. | `signalStore` listed in the component's `providers`. |
| `@ngrx/store-devtools` | Devtools for `@ngrx/store`. | No `@ngrx/signals` entry point provides this. Use `getState` / `watchState` for logging, per [state-tracking.md](state-tracking.md). |

`@ngrx/operators` is the exception: `tapResponse` and `mapResponse` are used by both libraries, so finding it in `package.json` is not evidence that a project uses `@ngrx/store`. Check for `@ngrx/store` itself.

If both libraries are present, the project is mid-migration. Read which features are on which before generating anything, and keep each feature wholly on one library.

## Configuration

There is no `provideSignalStore()` to register globally. Stores are either declared with `{ providedIn: 'root' }` or added to a component's `providers: [...]` array. No `app.config.ts` change is required to start using the library.

## Version notes

This skill targets `@ngrx/signals` 21. The entry-point table above is the v21 surface; on earlier versions parts of it are missing. Every floor below was read from the `.d.ts` files of the published packages, from 17.2.0 to 21.1.0.

| Entry point | Present from | Notes |
| ----------- | ------------ | ----- |
| `@ngrx/signals` | 17.2.0 | Grew over time: `watchState` 18.0.0, `deepComputed` 18.1.0, `withProps` and `signalMethod` 19.0.0, `withFeature` 19.1.0, `withLinkedState` 20.0.0 |
| `@ngrx/signals/rxjs-interop` | 17.2.0 | `rxMethod` throughout |
| `@ngrx/signals/entities` | 17.2.0 | `entityConfig` and `SelectEntityId` 18.0.0; `prepend*` and `upsert*` 19.1.0 |
| `@ngrx/signals/events` | **19.2.0** | `withEffects` 19.2.0 and removed in 21.0.0, replaced by `withEventHandlers`; `provideDispatcher`, `mapToScope`, `toScope` all 21.0.0 |
| `@ngrx/signals/testing` | **19.1.0** | `unprotected` |

The latest published stable release is 21.1.1, with 22.0.0 in pre-release. There is no devtools entry point at any version, which is why [state-tracking.md](state-tracking.md) is the logging story.

`@ngrx/signals` follows Angular's major version line, so 21 expects Angular 21. Check `@angular/core` before assuming a `@ngrx/signals` upgrade is available.

## Gotchas

- Agent installs `@ngrx/store` alongside, or instead of, `@ngrx/signals` - see the table above. They are different libraries
- Agent installs `@ngrx/entity` for collections - the SignalStore equivalent ships inside `@ngrx/signals` as `@ngrx/signals/entities`
- Agent treats `@ngrx/operators` in `package.json` as evidence of `@ngrx/store` - it is shared by both. Check for `@ngrx/store` itself
- Agent bumps `@ngrx/signals` without checking `@angular/core` - the majors track each other
- Agent imports from a deep path such as `@ngrx/signals/src/...` - use the published entry points only
- Agent writes `withEventHandlers` on 20, or `withEffects` on 21 - the rename is a hard break in both directions. See [events.md](events.md)
- Agent adds `provideSignalStore()` or an `app.config.ts` provider by analogy with `provideStore()` - there is nothing to register
- Agent assumes the events plugin is available because `@ngrx/signals` is installed - the entry point only exists from 19.2.0
- Agent skips `@ngrx/operators` and hand-writes the error and finalize branches around every HTTP call

## Related

- [signal-store.md](signal-store.md) · [events.md](events.md) · [entity-management.md](entity-management.md) · [testing.md](testing.md) · [state-tracking.md](state-tracking.md)

