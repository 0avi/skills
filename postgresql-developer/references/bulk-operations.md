# Bulk Operations

Row-at-a-time is the default failure mode. A million single-row inserts is not a million times slower than one bulk load - it is worse, because each pays a round trip, a transaction commit, and a WAL flush.

## Loading data

Ranked by speed, fastest first:

| Method | Relative speed | Use |
|---|---|---|
| `COPY` from a file or stream | Fastest by a wide margin | Any load of more than a few thousand rows |
| Multi-row `INSERT ... VALUES (...), (...)` | Good | Moderate batches from application code |
| `INSERT ... SELECT unnest($1, $2)` | Good | Parameterised batches from a driver |
| Single-row `INSERT` in one transaction | Slow | Small numbers |
| Single-row `INSERT`, autocommit | Catastrophic | Never for bulk |

### `COPY`

```sql
COPY orders (customer_id, placed_at, total)
FROM '/path/to/orders.csv' WITH (FORMAT csv, HEADER true);
```

Server-side `COPY FROM` reads a file on the **server** and requires superuser or the `pg_read_server_files` role. From a client, use `\copy` in `psql`, or the driver's copy API - `CopyManager` in JDBC, `pg-copy-streams` in Node - which streams from the client.

Options worth knowing:

```sql
COPY orders FROM stdin WITH (
    FORMAT csv, HEADER true,
    NULL '\N',
    FREEZE,                -- mark rows frozen: skips future vacuum work
    ON_ERROR ignore        -- 17+: skip malformed rows instead of aborting
);
```

`FREEZE` requires that the table was created or truncated in the same transaction, and avoids a later freeze pass. `ON_ERROR ignore` (17+) is a substantial operational improvement over the previous behaviour, where one bad row in ten million aborted the whole load.

### Batching from application code

```sql
INSERT INTO events (user_id, event_type, occurred_at)
SELECT * FROM unnest($1::bigint[], $2::text[], $3::timestamptz[]);
```

One statement, one round trip, arrays bound as parameters. This is the right shape when a driver's copy API is unavailable or awkward.

Batch size: 1,000 to 10,000 rows per statement is the usual sweet spot. Larger batches hold locks longer, use more memory, and make a failure more expensive to retry.

## Making a large load fast

For a load into a table you control:

**1. Drop indexes and constraints first, recreate after.** Building an index once over the finished data is far faster than maintaining it per row.

```sql
BEGIN;
ALTER TABLE staging_orders DROP CONSTRAINT staging_orders_customer_id_fkey;
DROP INDEX staging_orders_placed_at_idx;
COMMIT;

-- load

CREATE INDEX CONCURRENTLY staging_orders_placed_at_idx ON staging_orders (placed_at);
ALTER TABLE staging_orders ADD CONSTRAINT staging_orders_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers (id) NOT VALID;
ALTER TABLE staging_orders VALIDATE CONSTRAINT staging_orders_customer_id_fkey;
```

Only do this on a table not being read concurrently. Dropping an index on a live table is a self-inflicted outage.

**2. `UNLOGGED` for staging.** Skips WAL entirely, which is a large saving. The table is truncated on crash and is not replicated - fine for data you can reload.

```sql
CREATE UNLOGGED TABLE staging_orders (LIKE orders INCLUDING ALL);
-- load into it, transform, then:
INSERT INTO orders SELECT * FROM staging_orders;
```

`ALTER TABLE ... SET LOGGED` afterwards rewrites the whole table and writes all of it to WAL, so it is not a shortcut.

**3. Raise `maintenance_work_mem`** for the index builds:

```sql
SET maintenance_work_mem = '2GB';
```

**4. One transaction**, or a small number. Each commit is a WAL flush.

**5. `ANALYZE` afterwards.** Non-negotiable. Without it the planner works from statistics describing the table as it was before the load, and every subsequent query gets a bad plan. See [statistics-and-planner.md](statistics-and-planner.md).

**6. Consider `synchronous_commit = off`** for the loading session only. Commits stop waiting for WAL to reach disk. The risk is losing recently committed transactions on a crash - acceptable for a reloadable bulk load, never for general traffic.

```sql
SET LOCAL synchronous_commit = off;
```

## Bulk updates and deletes

A single `UPDATE` over ten million rows is one transaction that:

- Holds row locks on every row it touches, for its full duration.
- Creates ten million dead tuples, which autovacuum then has to clean.
- Generates enormous WAL, which propagates to every replica.
- Blocks vacuum across the database for its duration, because it is a long-running transaction.
- Rolls back entirely on failure, wasting all the work.

**Batch it.** Loop over ranges, committing each:

```sql
-- Repeat until zero rows affected
WITH batch AS (
    SELECT id FROM orders
    WHERE  status = 'legacy'
    ORDER  BY id
    LIMIT  10000
    FOR UPDATE SKIP LOCKED
)
UPDATE orders o
SET    status = 'archived'
FROM   batch b
WHERE  o.id = b.id;
```

`FOR UPDATE SKIP LOCKED` lets the batch run alongside normal traffic without blocking on rows another transaction holds. Ordering by the primary key keeps progress monotonic.

Between batches, pause briefly. Autovacuum needs a chance to reclaim the dead tuples, or the table bloats faster than it can be cleaned. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

Track progress with a watermark column or a marker table so the job is resumable.

### Deleting most of a table

When deleting more than roughly half the rows, rewriting is usually cheaper than deleting:

```sql
BEGIN;
CREATE TABLE orders_new (LIKE orders INCLUDING ALL);
INSERT INTO orders_new SELECT * FROM orders WHERE placed_at >= '2025-01-01';
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
COMMIT;
```

This takes an `ACCESS EXCLUSIVE` lock at the rename and needs the foreign keys and sequences reattached, so it is a maintenance-window operation. But it leaves no bloat and no vacuum debt.

`TRUNCATE` is instant for the whole table, reclaims space immediately, and cannot be filtered. It takes `ACCESS EXCLUSIVE` and, unlike `DELETE`, does not fire row triggers.

**If deletion is periodic and by time, partition instead.** `DROP TABLE` on a partition is instantaneous and produces no dead tuples at all. This is the single strongest argument for partitioning. See [partitioning.md](partitioning.md).

## Bulk upsert

```sql
INSERT INTO inventory (sku, quantity)
SELECT * FROM unnest($1::text[], $2::int[])
ON CONFLICT (sku) DO UPDATE
    SET quantity = EXCLUDED.quantity
    WHERE inventory.quantity IS DISTINCT FROM EXCLUDED.quantity;
```

Two things that bite in bulk:

- **Duplicate conflict keys within one statement** raise `ON CONFLICT DO UPDATE command cannot affect row a second time`. Deduplicate the input first with `DISTINCT ON`.
- **The `WHERE` on `DO UPDATE`** avoids writing a new tuple when nothing changed. In a bulk sync where most rows are unchanged, this is the difference between a small write and rewriting the entire table.

See [upsert-and-merge.md](upsert-and-merge.md).

## Exporting

```sql
COPY (SELECT * FROM orders WHERE placed_at >= '2026-01-01')
TO STDOUT WITH (FORMAT csv, HEADER true);
```

`COPY ... TO` streams and holds no large result in memory. A plain `SELECT` through a driver may buffer the entire result client-side unless a cursor or fetch size is set - which is how an export of a large table exhausts application memory. See [application-integration.md](application-integration.md).

## Locks and timeouts

Any bulk operation should protect the rest of the system:

```sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';
```

Without `lock_timeout`, a bulk operation waiting on a lock queues behind it every other transaction wanting that table - turning a slow job into a total outage. See [migrations.md](migrations.md).

## Version notes

- **17+** - `COPY ... ON_ERROR ignore` and `LOG_VERBOSITY`, so a malformed row does not abort the load. Also significantly faster `COPY`.
- **16+** - `COPY FROM` performance improvements for large loads.
- **14+** - `COPY FROM` supports `WHERE` to filter rows during load; faster `COPY` into partitioned tables.
- **18** - asynchronous I/O improves the scan side of large `INSERT ... SELECT`.

`FREEZE`, `UNLOGGED` semantics and `SKIP LOCKED` batching are identical across 14 to 18.

## Gotchas

- Agent loops single-row inserts - each pays a round trip, a commit and a WAL flush
- Agent inserts in autocommit mode - the worst case, one transaction per row
- Agent uses `COPY FROM '/path'` from a client - that reads a file on the server and needs elevated privileges; use `\copy` or the driver's copy API
- Agent does not run `ANALYZE` after a bulk load - every subsequent query plans against statistics from before the load
- Agent runs one giant `UPDATE` over millions of rows - long lock hold, huge WAL, mass dead tuples, blocks vacuum cluster-wide, and rolls back everything on failure
- Agent batches an update without `SKIP LOCKED` or an ordering - it blocks on contended rows and can revisit the same rows
- Agent batches without pausing - autovacuum cannot keep up and the table bloats faster than it is cleaned
- Agent uses `DELETE` to remove most of a table - rewriting or dropping a partition is far cheaper
- Agent deletes periodically by date on a non-partitioned table - partitioning turns it into an instant `DROP TABLE`
- Agent uses `ALTER TABLE ... SET LOGGED` expecting it to be cheap - it rewrites the table and WAL-logs all of it
- Agent bulk-upserts without deduplicating - "cannot affect row a second time"
- Agent omits the `WHERE` on `DO UPDATE` in a sync - rewrites every row even when unchanged
- Agent runs a bulk operation without `lock_timeout` - it queues every other transaction behind its lock wait
- Agent exports a large table through a driver without a cursor or fetch size - the client buffers the whole result

## Related

- [upsert-and-merge.md](upsert-and-merge.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [migrations.md](migrations.md) · [partitioning.md](partitioning.md) · [locking.md](locking.md) · [statistics-and-planner.md](statistics-and-planner.md) · [configuration.md](configuration.md) · [application-integration.md](application-integration.md)
