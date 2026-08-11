# Upsert and Merge

Two mechanisms with different guarantees. Choosing wrongly gives you either an avoidable error under concurrency or a constraint violation you cannot catch.

## `INSERT ... ON CONFLICT`

PostgreSQL's own upsert, available on every supported version, and **atomic under concurrency**.

```sql
INSERT INTO inventory (sku, quantity, updated_at)
VALUES ($1, $2, now())
ON CONFLICT (sku) DO UPDATE
    SET quantity   = EXCLUDED.quantity,
        updated_at = EXCLUDED.updated_at;
```

`EXCLUDED` is the pseudo-table holding the row that would have been inserted. Reference the existing row by its table name:

```sql
ON CONFLICT (sku) DO UPDATE
    SET quantity = inventory.quantity + EXCLUDED.quantity;   -- accumulate
```

### It requires a unique index, exactly matching

The conflict target must correspond to an existing unique index or constraint. `ON CONFLICT (sku)` needs `UNIQUE (sku)` - not `UNIQUE (tenant_id, sku)`, not a plain index.

```
ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

That error means the index does not exist or does not match, not that the syntax is wrong.

**A partial unique index requires its predicate repeated:**

```sql
CREATE UNIQUE INDEX users_email_live_key
    ON users (lower(email)) WHERE deleted_at IS NULL;

INSERT INTO users (email, name) VALUES ($1, $2)
ON CONFLICT (lower(email)) WHERE deleted_at IS NULL
DO UPDATE SET name = EXCLUDED.name;
```

An **expression** index needs the identical expression, parenthesised the same way.

### Two forms

```sql
ON CONFLICT DO NOTHING                    -- any conflict, including a different constraint
ON CONFLICT (sku) DO UPDATE SET ...       -- this constraint only
```

`DO NOTHING` without a target swallows conflicts on **every** constraint, including ones you did not anticipate. That hides bugs. Name the target unless you genuinely mean any conflict.

`DO NOTHING` is also cheaper than `DO UPDATE` when there is nothing to change - it takes no row lock and writes no new tuple.

### Only one arbiter

`ON CONFLICT` can only consider **one** constraint. A table with both `UNIQUE (email)` and `UNIQUE (username)` cannot upsert on whichever conflicts. A conflict on the non-targeted constraint raises an ordinary unique violation, which the application must catch.

### Cannot touch the same row twice

```
ERROR: ON CONFLICT DO UPDATE command cannot affect row a second time
```

Raised when a single statement's `VALUES` list contains two rows with the same conflict key. PostgreSQL will not decide which wins. Deduplicate before inserting:

```sql
INSERT INTO inventory (sku, quantity)
SELECT DISTINCT ON (sku) sku, quantity
FROM   unnest($1::text[], $2::int[]) AS t(sku, quantity)
ORDER  BY sku, quantity DESC
ON CONFLICT (sku) DO UPDATE SET quantity = EXCLUDED.quantity;
```

This bites hardest in batch loads. See [bulk-operations.md](bulk-operations.md).

### It consumes sequence values on conflict

An insert that conflicts has already drawn from the sequence. Heavy upsert traffic burns through identity values fast. Harmless with `bigint`, and a reason not to use `integer`. See [keys-and-identifiers.md](keys-and-identifiers.md).

### Avoid a pointless write

```sql
ON CONFLICT (sku) DO UPDATE
    SET quantity = EXCLUDED.quantity
    WHERE inventory.quantity IS DISTINCT FROM EXCLUDED.quantity;
```

Without the `WHERE`, every upsert writes a new tuple even when nothing changed - dead tuples, WAL, index maintenance, and replication traffic for no reason. `IS DISTINCT FROM` rather than `<>` so NULL transitions are detected. See [null-handling.md](null-handling.md).

## `MERGE` (15+)

SQL-standard, more expressive, and **not a drop-in replacement**.

```sql
MERGE INTO inventory AS t
USING (VALUES ($1, $2)) AS s (sku, quantity)
   ON t.sku = s.sku
WHEN MATCHED AND s.quantity = 0 THEN
    DELETE
WHEN MATCHED THEN
    UPDATE SET quantity = s.quantity, updated_at = now()
WHEN NOT MATCHED THEN
    INSERT (sku, quantity, updated_at) VALUES (s.sku, s.quantity, now());
```

What it can do that `ON CONFLICT` cannot:

- `DELETE` as an action.
- Multiple conditional branches.
- Join against an arbitrary source query, not just a `VALUES` list.
- Match on any condition, not only a unique constraint.
- `WHEN NOT MATCHED BY SOURCE` (17+) for rows in the target with no source row - the "full sync" case.

### `MERGE` is not concurrency-safe

This is the critical difference and it is easy to miss.

`MERGE` evaluates the match under the current snapshot. Under `READ COMMITTED`, two concurrent `MERGE`s can both see no match and both attempt the insert. One gets a **unique violation**.

`INSERT ... ON CONFLICT` does not have this problem: conflict detection happens at index-insertion time, under the index's own locking, so it is atomic.

So:

| Situation | Use |
|---|---|
| Concurrent upserts on the same keys | `INSERT ... ON CONFLICT` |
| Single-writer batch sync, ETL, nightly load | `MERGE` |
| Need `DELETE` or several conditional branches | `MERGE`, plus a retry loop or `SERIALIZABLE` |
| Target of PostgreSQL 14 or earlier | `INSERT ... ON CONFLICT` |

If you need `MERGE`'s expressiveness under concurrency, run it at `SERIALIZABLE` and retry on serialisation failure, or take an advisory lock on the key first. See [transactions-and-isolation.md](transactions-and-isolation.md) and [locking.md](locking.md).

### `RETURNING`

`MERGE ... RETURNING` arrived in **17**. Before that, `MERGE` returns nothing, which rules it out where the caller needs the affected rows. On 17+, `merge_action()` reports which branch fired:

```sql
MERGE INTO inventory AS t USING ... 
WHEN MATCHED THEN UPDATE SET ...
WHEN NOT MATCHED THEN INSERT ...
RETURNING merge_action(), t.sku, t.quantity;
```

## Bulk upsert

Do not loop. Send the whole batch as arrays and unnest:

```sql
INSERT INTO inventory (sku, quantity)
SELECT * FROM unnest($1::text[], $2::int[])
ON CONFLICT (sku) DO UPDATE
    SET quantity = EXCLUDED.quantity
    WHERE inventory.quantity IS DISTINCT FROM EXCLUDED.quantity;
```

One statement, one round trip, one transaction. Remember to deduplicate the arrays first.

For very large loads, `COPY` into an unlogged staging table and then upsert from it in batches is faster still. See [bulk-operations.md](bulk-operations.md).

## Insert-if-not-exists, and the race that is not obvious

```sql
-- WRONG under concurrency, despite looking careful
INSERT INTO tags (name)
SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM tags WHERE name = $1);
```

Two sessions both find no row and both insert. One fails on the unique constraint - if there is one. If there is not, you get a duplicate and no error at all.

```sql
-- Right
INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;
```

To get the id whether or not it was inserted, `DO NOTHING` returns no row on conflict, so it needs a second step:

```sql
WITH inserted AS (
    INSERT INTO tags (name) VALUES ($1)
    ON CONFLICT (name) DO NOTHING
    RETURNING id
)
SELECT id FROM inserted
UNION ALL
SELECT id FROM tags WHERE name = $1
LIMIT 1;
```

A common shortcut is `DO UPDATE SET name = EXCLUDED.name RETURNING id`, which always returns a row - at the cost of a pointless write and a dead tuple every time.

## Version notes

- **17+** - `MERGE ... RETURNING`, `merge_action()`, and `WHEN NOT MATCHED BY SOURCE`.
- **15+** - `MERGE` exists at all. Not available on 14.
- **18** - `RETURNING` supports `OLD`/`NEW` aliases, so an upsert can return both the previous and new values.

`INSERT ... ON CONFLICT`, `EXCLUDED`, partial-index arbiters and the "cannot affect row a second time" error behave identically across 14 to 18.

## Gotchas

- Agent uses `MERGE` for concurrent upserts - it is not atomic and raises unique violations under concurrency; use `INSERT ... ON CONFLICT`
- Agent recommends `MERGE` on PostgreSQL 14 - it does not exist before 15
- Agent uses `MERGE ... RETURNING` before 17 - not supported
- Agent writes `ON CONFLICT (col)` with no matching unique index - the error names the ON CONFLICT specification, not the missing index
- Agent targets a partial unique index without repeating its `WHERE` predicate - no matching arbiter is found
- Agent uses bare `ON CONFLICT DO NOTHING` - swallows conflicts on every constraint, hiding unrelated bugs
- Agent batches rows containing duplicate conflict keys - "cannot affect row a second time"; deduplicate first
- Agent omits the `WHERE` on `DO UPDATE` - every upsert writes a new tuple even when nothing changed
- Agent uses `<>` instead of `IS DISTINCT FROM` in that `WHERE` - NULL transitions are missed
- Agent writes `INSERT ... WHERE NOT EXISTS` for insert-if-missing - two sessions race, and without a unique constraint there is no error at all
- Agent loops over rows issuing one upsert each - use arrays and `unnest`
- Agent expects `DO NOTHING ... RETURNING` to return a row on conflict - it returns nothing
- Agent assumes conflicting inserts do not consume sequence values - they do

## Related

- [constraints.md](constraints.md) · [transactions-and-isolation.md](transactions-and-isolation.md) · [locking.md](locking.md) · [bulk-operations.md](bulk-operations.md) · [null-handling.md](null-handling.md) · [partial-and-expression-indexes.md](partial-and-expression-indexes.md) · [keys-and-identifiers.md](keys-and-identifiers.md)
