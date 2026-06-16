# Entity Management (`@ngrx/signals/entities`)

The `entities` plugin standardises managing collections of records. Use it whenever a store holds a list keyed by id: patients, notices, chart records, schedules, etc.

## `withEntities`

```ts
import { signalStore } from '@ngrx/signals';
import { withEntities } from '@ngrx/signals/entities';

type Todo = { id: number; text: string; completed: boolean };

export const TodosStore = signalStore(withEntities<Todo>());
```

Adds three members to the store:

- `ids: Signal<EntityId[]>`: state
- `entityMap: Signal<EntityMap<Todo>>`: state
- `entities: Signal<Todo[]>`: computed in id order

`EntityId` is `string | number`. The default identifier is the `id` field. For other keys, see "Custom id selector" below.

## Updater functions

All updaters are standalone functions designed to be passed to `patchState`:

```ts
import { patchState, signalStore, withMethods } from '@ngrx/signals';
import {
  addEntity, addEntities, prependEntity, prependEntities,
  setEntity, setEntities, setAllEntities,
  updateEntity, updateEntities, updateAllEntities,
  upsertEntity, upsertEntities,
  removeEntity, removeEntities, removeAllEntities,
  withEntities,
} from '@ngrx/signals/entities';

export const TodosStore = signalStore(
  withEntities<Todo>(),
  withMethods((store) => ({
    add(todo: Todo): void {
      patchState(store, addEntity(todo));
    },
    setAll(todos: Todo[]): void {
      patchState(store, setAllEntities(todos));
    },
    toggle(id: number): void {
      patchState(
        store,
        updateEntity({ id, changes: (t) => ({ completed: !t.completed }) }),
      );
    },
    completeAll(): void {
      patchState(store, updateAllEntities({ completed: true }));
    },
    remove(id: number): void {
      patchState(store, removeEntity(id));
    },
    clear(): void {
      patchState(store, removeAllEntities());
    },
  })),
);
```

### Quick reference

| Updater                 | Semantics                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `addEntity` / `addEntities` | Insert; **skip** if id exists. No error on duplicates.                                                  |
| `prependEntity` / `prependEntities` | Insert at front; skip duplicates.                                                              |
| `setEntity` / `setEntities` | Insert OR replace.                                                                                     |
| `setAllEntities`        | Replace the entire collection.                                                                            |
| `updateEntity({ id, changes })` | Partial update by id. `changes` may be a partial object or `(entity) => partial`. Silent if missing. |
| `updateEntities({ ids, changes })` / `updateEntities({ predicate, changes })` | Partial bulk update.                       |
| `updateAllEntities(changes)` | Partial update across all.                                                                            |
| `upsertEntity` / `upsertEntities` | Merge instead of replace on update.                                                              |
| `removeEntity(id)` / `removeEntities(idsOrPredicate)` / `removeAllEntities()` | Removal.                              |

## Custom id selector

If the identifier field isn't called `id`, pass a `selectId` in the second argument to every `add*`/`set*`/`update*` updater. Removal updaters never need it.

```ts
import { addEntities, SelectEntityId, updateAllEntities } from '@ngrx/signals/entities';

type Todo = { key: number; text: string; completed: boolean };
const selectId: SelectEntityId<Todo> = (t) => t.key;

patchState(store, addEntities(todos, { selectId }));
patchState(store, updateAllEntities({ completed: true }, { selectId }));
```

## Named collections: multiple lists in one store

Pass `{ entity: type<T>(), collection: 'name' }` to `withEntities`. The state/computed signals are prefixed with the collection name (`bookIds`, `bookEntityMap`, `bookEntities`). Updaters require `{ collection: 'name' }`:

```ts
import { signalStore, type } from '@ngrx/signals';
import { addEntity, withEntities } from '@ngrx/signals/entities';

export const LibraryStore = signalStore(
  withEntities({ entity: type<Book>(), collection: 'book' }),
  withEntities({ entity: type<Author>(), collection: 'author' }),
  withMethods((store) => ({
    addBook(book: Book): void {
      patchState(store, addEntity(book, { collection: 'book' }));
    },
  })),
);
```

Prefer one dedicated store per entity type unless the entities are tightly coupled and always loaded together.

## `entityConfig`: DRY config

Reduce repetition when you have custom id + collection by passing a single config:

```ts
import { entityConfig, addEntity, removeEntity, withEntities } from '@ngrx/signals/entities';

const todoConfig = entityConfig({
  entity: type<Todo>(),
  collection: 'todo',
  selectId: (t) => t.key,
});

export const TodosStore = signalStore(
  withEntities(todoConfig),
  withMethods((store) => ({
    add(t: Todo) { patchState(store, addEntity(t, todoConfig)); },
    remove(t: Todo) { patchState(store, removeEntity(t.key, todoConfig)); },
  })),
);
```

## Private collections

Prefix the collection name with `_` to keep raw state private; expose a curated public view via `withComputed`:

```ts
const todoConfig = entityConfig({
  entity: type<Todo>(),
  collection: '_todo',
});

export const TodosStore = signalStore(
  withEntities(todoConfig),
  withComputed(({ _todoEntities }) => ({
    todos: _todoEntities,                 // public
  })),
);
```

See [private-store-members.md](private-store-members.md).

