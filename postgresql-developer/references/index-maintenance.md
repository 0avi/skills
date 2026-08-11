# Index Maintenance

Indexes accumulate. Somebody adds one for a query that is later deleted; a migration creates one that duplicates another; a `CREATE INDEX CONCURRENTLY` fails at 3am and leaves an invalid index that costs writes and serves nothing.

Audit periodically. It is one of the highest-value, lowest-risk maintenance jobs there is.

## Building without blocking

```sql
CREATE INDEX orders_customer_id_idx ON orders (customer_id);
```

Takes a `SHARE` lock: reads continue, **all writes block** for the entire build. On a large table that is an outage.

```sql
CREATE INDEX CONCURRENTLY orders_customer_id_idx ON orders (customer_id);
```

Takes `SHARE UPDATE EXCLUSIVE`: reads and writes both continue.

The rules for `CONCURRENTLY`:

- **Cannot run inside a transaction block.** Most migration tools wrap each migration in a transaction, so this needs an explicit escape hatch. Flyway needs the migration marked as non-transactional; Liquibase needs `runInTransaction="false"`; Rails needs `disable_ddl_transaction!`. See [migrations.md](migrations.md).
- **Two table scans**, so it takes roughly twice as long.
- **It waits for existing transactions.** A long-running transaction anywhere in the database - including an idle-in-transaction session - blocks the build indefinitely at the start and again before it completes.
- **On failure it leaves an invalid index.** Which is where the next section comes in.
- **Not supported on partitioned parents.** Build on each partition individually, then create the parent index with `ON ONLY`.

## Invalid indexes

If `CREATE INDEX CONCURRENTLY` fails - a deadlock, a unique violation, a cancelled session - it leaves an index marked invalid. That index is **ignored by queries but still maintained on every write**: pure cost, zero benefit.

```sql
SELECT indexrelid::regclass AS index_name, indrelid::regclass AS table_name
FROM   pg_index WHERE NOT indisvalid;
```

```sql
DROP INDEX CONCURRENTLY orders_customer_id_idx;
CREATE INDEX CONCURRENTLY orders_customer_id_idx ON orders (customer_id);
```

Check for these after any failed migration, and include the check in routine health checks. They are easy to leave behind for years.

A related state is `indisready = false, indisvalid = false`, which means the build did not get far enough to be maintained at all. Same fix.

## Unused indexes

```sql
SELECT s.schemaname, s.relname AS table_name, s.indexrelname AS index_name,
       s.idx_scan, pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM   pg_stat_user_indexes s
JOIN   pg_index i ON i.indexrelid = s.indexrelid
WHERE  s.idx_scan = 0
AND    NOT i.indisunique                    -- unique indexes enforce constraints
AND    NOT i.indisprimary
ORDER  BY pg_relation_size(s.indexrelid) DESC;
```

Four cautions before dropping anything:

1. **Statistics are cumulative since the last reset.** `SELECT stats_reset FROM pg_stat_database WHERE datname = current_database();` A counter of zero over two days means nothing; over two months it means something.
2. **Check the replicas.** A read replica has its own `pg_stat_user_indexes`. An index unused on the primary may serve every reporting query on a replica.
3. **Never drop a unique index** without confirming it does not back a constraint. The query above excludes them.
4. **Seasonal queries exist.** A quarter-end report runs four times a year.

Drop with `CONCURRENTLY` so it does not block:

```sql
DROP INDEX CONCURRENTLY orders_old_idx;
```

If you are nervous, make it invisible first by other means - or simply record the exact `CREATE INDEX` statement from `pg_indexes` before dropping, so it can be recreated immediately.

## Duplicate and redundant indexes

Exact duplicates:

```sql
SELECT indrelid::regclass AS table_name,
       array_agg(indexrelid::regclass) AS duplicates,
       pg_size_pretty(sum(pg_relation_size(indexrelid))) AS total_size
FROM   pg_index
GROUP  BY indrelid, indkey, indclass, indexprs, indpred
HAVING count(*) > 1;
```

More common and less obvious: an index that is a **prefix** of another. `(customer_id)` is redundant when `(customer_id, placed_at)` exists, because the composite serves every query the single-column one does.

This query is verified against PostgreSQL 18:

```sql
WITH idx AS (
    SELECT i.indexrelid, i.indrelid, i.indisunique, i.indisprimary,
           i.indpred, i.indexprs, i.indnkeyatts, am.amname,
           -- A slice re-bases the lower bound to 1, so every key_cols is 1-based.
           (i.indkey::smallint[])[0:i.indnkeyatts - 1] AS key_cols
    FROM   pg_index i
    JOIN   pg_class ic ON ic.oid = i.indexrelid
    JOIN   pg_am    am ON am.oid = ic.relam
    WHERE  i.indisvalid AND i.indislive
)
SELECT a.indexrelid::regclass AS redundant,
       b.indexrelid::regclass AS covered_by
FROM   idx a
JOIN   idx b
  ON   a.indrelid = b.indrelid
 AND   a.indexrelid <> b.indexrelid
 AND   a.amname = b.amname                              -- a btree is not covered by a gin
 AND   a.indnkeyatts <= b.indnkeyatts
 AND   (b.key_cols)[1:a.indnkeyatts] = a.key_cols        -- genuine prefix on the column array
 AND   (a.indnkeyatts < b.indnkeyatts                    -- one row per duplicate pair,
        OR a.indexrelid < b.indexrelid)                  -- not two
WHERE  NOT a.indisunique AND NOT a.indisprimary
AND    a.indpred  IS NULL AND b.indpred  IS NULL
AND    a.indexprs IS NULL AND b.indexprs IS NULL
ORDER  BY 1;
```

Three traps this avoids, all of which the commonly-circulated version of this query falls into:

- **Never compare `indkey::text` with `LIKE`.** `'11' LIKE '1%'` is true, so an index on column 11 is reported as covering an index on column 1. Acting on that drops a needed index. Compare the column arrays.
- **`indkey::smallint[]` is 0-based, but a slice of it is 1-based.** So `(indkey::smallint[])` and `(indkey::smallint[])[0:0]` both containing `{2}` are **not equal** - PostgreSQL array equality compares bounds. Slice both sides, or neither.
- **`indnkeyatts`, not `array_length(indkey)`.** `indkey` also contains `INCLUDE` columns, which are not part of the search key and must not participate in the prefix test.

Two exceptions the query already handles, worth knowing about: a **unique** index that is a prefix of a composite is not redundant, because it enforces a constraint the composite does not; and a **partial or expression** index is excluded, because its predicate or expression changes what it covers.

One judgement call it cannot make: a narrow prefix index is genuinely cheaper to scan than a wide composite, so on a very hot lookup it can be worth keeping both. That is a measured decision, not a default.

A prefix index is also legitimately narrower and therefore cheaper to scan, so on a very hot lookup it can be worth keeping both. That is a measured decision, not a default.

## Bloat

Index bloat comes from the same MVCC mechanism as table bloat: dead index entries accumulate as rows are updated and deleted. B-tree pages that empty out are reused, but a page that is only partly empty stays partly empty. Random-UUID keys make this much worse, because page splits happen mid-page rather than at the end. See [keys-and-identifiers.md](keys-and-identifiers.md).

Estimate it with the `pgstattuple` extension, which measures rather than guesses:

```sql
CREATE EXTENSION IF NOT EXISTS pgstattuple;
SELECT * FROM pgstatindex('orders_customer_id_idx');
```

`avg_leaf_density` well below 90 and a high `leaf_fragmentation` indicate bloat worth acting on. `pgstattuple` reads the whole index, so run it off-peak.

The widely-circulated bloat-estimate queries based on `pg_stats` are approximations and frequently wrong by a wide margin. Use them for a first pass, `pgstattuple` for a decision.

## Rebuilding

```sql
REINDEX INDEX CONCURRENTLY orders_customer_id_idx;
REINDEX TABLE CONCURRENTLY orders;
```

`REINDEX ... CONCURRENTLY` (12+) rebuilds without blocking writes. It needs disk space for both copies simultaneously, and on failure it can leave an index named with a `_ccnew` suffix that must be dropped manually:

```sql
SELECT indexrelid::regclass FROM pg_index
WHERE NOT indisvalid AND indexrelid::regclass::text LIKE '%_ccnew%';
```

Rebuild when:

- Measured bloat is significant.
- **After any change to collation** - an OS upgrade, a glibc change, an ICU version change. This is not optional. Collation determines B-tree ordering, so a changed collation means the index is silently mis-sorted and queries return wrong results with no error. It is the most dangerous maintenance omission there is. See [postgres-versions.md](postgres-versions.md).
- After a bulk delete that removed most of a table.

Do **not** rebuild on a schedule for its own sake. A healthy B-tree does not need periodic reindexing, and the operation is expensive.

## Indexes on partitioned tables

An index on a partitioned parent is a template: PostgreSQL creates a matching index on every partition, and on every partition created later.

`CONCURRENTLY` is not supported on the parent. The non-blocking route:

```sql
-- 1. Create on each partition, concurrently
CREATE INDEX CONCURRENTLY events_2026_01_occurred_at_idx
    ON events_2026_01 (occurred_at);
-- ... repeat for every partition

-- 2. Create the parent index without recursing. It is marked invalid.
CREATE INDEX events_occurred_at_idx ON ONLY events (occurred_at);

-- 3. Attach each partition index. The parent becomes valid on the last one.
ALTER INDEX events_occurred_at_idx
    ATTACH PARTITION events_2026_01_occurred_at_idx;
```

See [partitioning.md](partitioning.md).

## A maintenance routine

Quarterly, or after any significant schema change:

1. Invalid indexes - drop and rebuild.
2. Duplicate and prefix-redundant indexes - drop the redundant one.
3. Unused indexes, with a long enough statistics window and the replicas checked - drop.
4. Missing foreign key indexes - add. See [keys-and-identifiers.md](keys-and-identifiers.md).
5. Index-to-table size ratio - investigate anything where indexes exceed the table.
6. Bloat on the largest indexes - `pgstattuple`, then rebuild if warranted.

```sql
SELECT relname,
       pg_size_pretty(pg_table_size(relid))   AS table_size,
       pg_size_pretty(pg_indexes_size(relid)) AS indexes_size,
       round(pg_indexes_size(relid)::numeric / nullif(pg_table_size(relid), 0), 2) AS ratio
FROM   pg_catalog.pg_statio_user_tables
ORDER  BY pg_indexes_size(relid) DESC LIMIT 20;
```

## Version notes

- **18** - `EXPLAIN ANALYZE` reports index lookups per index scan node, which helps identify indexes doing more work than expected.
- **14+** - `REINDEX` improvements, and reduced B-tree bloat from more aggressive cleanup of dead index tuples.
- **12+** - `REINDEX CONCURRENTLY`. Before that, rebuilding without blocking meant creating a new index concurrently, dropping the old and renaming.

`CREATE INDEX CONCURRENTLY` semantics, invalid-index behaviour and the partitioned-table index workflow are identical across 14 to 18.

## Gotchas

- Agent uses `CREATE INDEX` without `CONCURRENTLY` on a live table - all writes block for the whole build
- Agent puts `CREATE INDEX CONCURRENTLY` in a transactional migration - it cannot run in a transaction block
- Agent does not check for invalid indexes after a failed concurrent build - they cost writes and serve no queries, indefinitely
- Agent drops an index based on `idx_scan = 0` without checking when statistics were last reset
- Agent drops an index based on primary statistics only - replicas have their own, and may depend on it
- Agent drops a unique index believing it is unused - it may be enforcing a constraint
- Agent keeps an index that is a prefix of an existing composite - redundant write cost
- Agent treats a unique prefix index as redundant - it enforces something the composite does not
- Agent trusts an estimated-bloat query - those estimates are frequently far off; measure with `pgstattuple`
- Agent reindexes on a schedule - a healthy B-tree does not need it, and the operation is expensive
- Agent skips `REINDEX` after an OS or collation library upgrade - text indexes are then silently mis-sorted and queries return wrong results with no error
- Agent runs `REINDEX CONCURRENTLY` and leaves `_ccnew` leftovers after a failure
- Agent tries `CREATE INDEX CONCURRENTLY` on a partitioned parent - unsupported; build per partition and attach

## Related

- [indexing-fundamentals.md](indexing-fundamentals.md) · [composite-and-covering-indexes.md](composite-and-covering-indexes.md) · [migrations.md](migrations.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [partitioning.md](partitioning.md) · [performance-triage.md](performance-triage.md) · [postgres-versions.md](postgres-versions.md)
