# Events Plugin (`@ngrx/signals/events`)

The events plugin layers a Flux/NgRx-style dispatch + reducer + effect pipeline on top of SignalStore. Reach for it when:

- Two or more stores need to react to the same trigger.
- You want a clear audit trail of "what happened" decoupled from "how state changed".
- You need scoped event buses for nested feature modules or micro-frontends.

For single-store CRUD, plain `withMethods` + `rxMethod` is simpler. Don't reach for events unnecessarily.

> Requires `@ngrx/signals` v21 or later. The side-effect feature shown here, `withEventHandlers`, was named `withEffects` before v21.

## Defining events

### Individual creators with `event`

```ts
import { type } from '@ngrx/signals';
import { event } from '@ngrx/signals/events';

export const opened = event('[Book Search Page] Opened');
export const queryChanged = event(
  '[Book Search Page] Query Changed',
  type<string>(),
);
```

Calling `queryChanged('signals')` returns `{ type: '[Book Search Page] Query Changed', payload: 'signals' }`.

### Grouping with `eventGroup`

Less repetition when many events share a source:

```ts
import { type } from '@ngrx/signals';
import { eventGroup } from '@ngrx/signals/events';

export const bookSearchEvents = eventGroup({
  source: 'Book Search Page',
  events: {
    opened: type<void>(),
    queryChanged: type<string>(),
  },
});
```

Types are auto-formatted as `'[Source] eventName'`. Convention: use `[Source]` form for clarity.

## State transitions: `withReducer`

`on` maps one or more events to a case-reducer that returns a partial state object, a partial state updater, or an array of either:

```ts
import { signalStore, withState } from '@ngrx/signals';
import { on, withReducer } from '@ngrx/signals/events';

type State = { query: string; books: Book[]; isLoading: boolean };

export const BookSearchStore = signalStore(
  withState<State>({ query: '', books: [], isLoading: false }),
  withReducer(
    on(bookSearchEvents.opened, () => ({ isLoading: true })),
    on(bookSearchEvents.queryChanged, ({ payload: query }) => ({ query, isLoading: true })),
    on(booksApiEvents.loadedSuccess, ({ payload: books }) => ({ books, isLoading: false })),
    on(booksApiEvents.loadedFailure, () => ({ isLoading: false })),
  ),
);
```

## Side-effect handlers: `withEventHandlers`

Handlers are observables that listen for events via the `Events` service and optionally emit new events to be dispatched.

```ts
import { switchMap, tap } from 'rxjs';
import { Events, withEventHandlers } from '@ngrx/signals/events';
import { mapResponse } from '@ngrx/operators';

export const BookSearchStore = signalStore(
  // … withState, withReducer
  withEventHandlers(
    (store, events = inject(Events), booksService = inject(BooksService)) => ({
      loadBooksByQuery$: events
        .on(bookSearchEvents.opened, bookSearchEvents.queryChanged)
        .pipe(
          switchMap(() =>
            booksService.getByQuery(store.query()).pipe(
              mapResponse({
                next: (books) => booksApiEvents.loadedSuccess(books),
                error: (e: { message: string }) => booksApiEvents.loadedFailure(e.message),
              }),
            ),
          ),
        ),
      logError$: events
        .on(booksApiEvents.loadedFailure)
        .pipe(tap(({ payload }) => console.error(payload))),
    }),
  ),
);
```

Returning an event from a handler dispatches it automatically. Use `mapResponse` from `@ngrx/operators` for safe success/error mapping.

### `ReducerEvents` vs `Events`

If a handler must run **before** state transitions for the same event, inject `ReducerEvents` instead of `Events`. `ReducerEvents` fires first and is the recommended escape hatch when `withReducer` is not expressive enough.

## Dispatching

### `Dispatcher.dispatch`

```ts
import { Dispatcher } from '@ngrx/signals/events';

readonly dispatcher = inject(Dispatcher);
this.dispatcher.dispatch(bookSearchEvents.queryChanged(query));
```

### `injectDispatch` (preferred)

```ts
import { injectDispatch } from '@ngrx/signals/events';

readonly dispatch = injectDispatch(bookSearchEvents);

// template/event handlers:
this.dispatch.opened();
this.dispatch.queryChanged(query);
```

`injectDispatch` returns an object mirroring the `eventGroup`'s shape, so each property is a typed dispatch function.

## Scoped events

By default `Dispatcher` and `Events` operate in **global** scope. To isolate a feature/component subtree, provide a local dispatcher:

```ts
import { provideDispatcher } from '@ngrx/signals/events';

@Component({
  providers: [provideDispatcher(), BookSearchStore],
})
export class BookSearch { /* … */ }
```

Then choose the scope per dispatch:

```ts
this.dispatch.opened();                             // self (default)
this.dispatch({ scope: 'parent' }).queryChanged(q); // bubble up one level
this.dispatch({ scope: 'global' }).refresh();       // hop straight to root
```

Visibility rule: a scope's `Events` observes its own events and any events from ancestors (including global); descendants are isolated unless they explicitly forward up.

### Forwarding from handlers

```ts
import { mapToScope, toScope } from '@ngrx/signals/events';

// Inside withEventHandlers
events.on(bookSearchEvents.queryChanged).pipe(
  switchMap(({ payload }) =>
    booksService.getByQuery(payload).pipe(
      mapResponse({
        next: (books) => booksApiEvents.loadedSuccess(books),
        error: (e) => [booksApiEvents.loadedFailure(e.message), toScope('global')],
      }),
    ),
  ),
);

// Or apply to every emitted event in a handler:
events.on(bookSearchEvents.bookSelected).pipe(
  exhaustMap(({ payload: id }) =>
    booksService.getById(id).pipe(
      mapResponse({
        next: (b) => booksApiEvents.loadedByIdSuccess(b),
        error: (e) => booksApiEvents.loadedByIdFailure(e.message),
      }),
      mapToScope('parent'),
    ),
  ),
);
```

## Components stay simple

Reading state doesn't change with the events plugin. Components inject the store and read signals as usual. Only the **write path** moves from "call a method" to "dispatch an event".

