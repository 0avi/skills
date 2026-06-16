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

## Configuration

There is no `provideSignalStore()` to register globally. Stores are either declared with `{ providedIn: 'root' }` or added to a component's `providers: [...]` array. No `app.config.ts` change is required to start using the library.

