# Indexing Fundamentals

An index is a permanent write cost paid in exchange for a read benefit. Both halves must be real.

**Never add an index without first reading the plan.** `EXPLAIN (ANALYZE, BUFFERS)` may show the index you were about to create already exists, or that the problem is a statistics error, or that a sequential scan is genuinely the right choice.

## What an index costs

- **Storage.** Often 10 to 30% of the table per index. Five indexes can exceed the table itself.
- **Write amplification.** Every `INSERT` writes to the table and to every index. Every `UPDATE` that changes an indexed column writes a new index entry in **every** index, not just the one on that column, because the row's physical location changes. This is what HOT updates avoid, and only when no indexed column changes. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).
- **WAL volume**, which propagates to replicas and backups.
- **Planning time.** Every candidate index is considered for every query.
- **Vacuum time.** Each index must be scanned to clean dead entries.

The book-keeping is real: a table with a dozen indexes can be several times slower to write than the same table with three.

## When an index does not help

**Low selectivity.** If a predicate matches a large fraction of the table, a sequential scan is cheaper - reading pages in order beats random access plus heap fetches. The planner switches somewhere around 5 to 10% of the table, depending on `random_page_cost` and correlation.

This is why "the index exists but is not used" is usually correct behaviour:

```sql
-- Index used: matches 970 of 10,000 rows
WHERE score BETWEEN 5000 AND 6000

-- Sequential scan: matches 2,916 of 10,000 rows. The index would cost more.
WHERE score > 1000
```

A boolean column where 90% of rows are `true` is not worth indexing for the `true` case. It may be very worth indexing for the `false` case, as a partial index. See [partial-and-expression-indexes.md](partial-and-expression-indexes.md).

**Small tables.** Below a few hundred rows the whole table is one or two pages. An index scan is not faster than reading them.

**The predicate is not sargable.** Wrapping the column in a function prevents index use:

```sql
WHERE lower(email) = 'a@b.com'          -- no index on email will help
WHERE created_at::date = '2026-03-14'   -- no
WHERE extract(year from created_at) = 2026   -- no
WHERE price * 1.2 > 100                 -- no

WHERE email = 'a@b.com'                 -- yes
WHERE created_at >= '2026-03-14' AND created_at < '2026-03-15'   -- yes
WHERE price > 100 / 1.2                 -- yes
```

Either rewrite the predicate to leave the column bare, or index the expression.

**Type mismatch.** Comparing a `bigint` column to a `text` parameter forces a cast on the column side and disables the index. This is a common ORM problem and shows up as an inexplicably bad plan. See [application-integration.md](application-integration.md).

**Leading wildcard.** `LIKE '%smith'` cannot use a B-tree, because B-trees are ordered by prefix. `LIKE 'smith%'` can. For infix matching use a trigram index. See [full-text-search.md](full-text-search.md).

Note that `LIKE 'smith%'` only uses an index if the column's collation is `C`, or if the index is declared with `text_pattern_ops`:

```sql
CREATE INDEX customers_name_prefix_idx ON customers (name text_pattern_ops);
```

Under a non-C collation, ordering does not correspond to byte prefixes, so a plain B-tree cannot serve a prefix match. This surprises people constantly.

## How the planner decides

The planner estimates the cost of every viable plan and picks the cheapest. For an index it needs:

1. **A predicate the index can serve** - `=`, ranges, prefix `LIKE` for B-tree; type-specific operators for others.
2. **A selectivity estimate**, from `pg_stats`. If the estimate is wrong, the choice is wrong. See [statistics-and-planner.md](statistics-and-planner.md).
3. **Cost parameters.** `random_page_cost` defaults to `4.0`, which encodes the seek cost of a spinning disk. **On SSDs and cloud storage this is wrong** and biases the planner against index scans. `1.1` is the usual value. This single setting fixes more "why is it not using my index" complaints than anything else. See [configuration.md](configuration.md).

## Scan types

| Node | What it does | Signals |
|---|---|---|
| **Seq Scan** | Reads every page | Correct for low selectivity or small tables. A problem when `Rows Removed by Filter` is huge |
| **Index Scan** | Walks the index, fetches each matching heap row | Good for few rows. Random I/O per row |
| **Index Only Scan** | Answers entirely from the index | Best. Needs the index to cover every referenced column, plus a current visibility map |
| **Bitmap Index Scan** + **Bitmap Heap Scan** | Collects matching row locations into a bitmap, then reads the heap in physical order | The planner's choice for a middling number of rows, and for combining several indexes |

### Bitmap scans, in detail

Worth understanding because they appear constantly and are widely misread.

Phase one, **Bitmap Index Scan**, walks the index and builds a bitmap of the row locations that match - it does not fetch anything. Phase two, **Bitmap Heap Scan**, reads those heap pages **in physical order**, which converts random I/O into something closer to sequential.

The bitmap can be *exact* (specific rows within a page) or *lossy* (just "this page contains matches"), and it degrades to lossy when it grows past `work_mem`. `EXPLAIN` reports both:

```
Heap Blocks: exact=124 lossy=3021
```

For lossy pages, every row on the page is re-checked against the condition - which is why a `Recheck Cond` line appears. A large `lossy` count means the bitmap outgrew `work_mem` and the scan is doing significantly more work than it appears to.

Bitmap scans are also how PostgreSQL **combines multiple indexes**: two bitmap index scans `BitmapAnd`ed or `BitmapOr`ed together. This is why separate single-column indexes are not useless for multi-column predicates - but a composite index is still much faster when the combination is common. See [composite-and-covering-indexes.md](composite-and-covering-indexes.md).

### Index-only scans

An index-only scan avoids the heap entirely, but **it must still check visibility**, and visibility lives only in the heap. PostgreSQL uses the **visibility map** - a bitmap marking pages where every row is visible to all transactions.

- Bit set: return the row from the index, no heap access.
- Bit not set: fetch the heap row anyway. This is a **Heap Fetch**.

```
Index Only Scan using orders_pkey on orders
  Heap Fetches: 0        <- ideal
  Heap Fetches: 48210    <- the optimisation is not working
```

High `Heap Fetches` means the visibility map is stale, which means **vacuum has not run recently enough**. On a write-heavy table an index-only scan can be no better than an index scan. The fix is vacuum tuning, not an index change. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

GIN indexes cannot do index-only scans at all - they store only fragments of the value.

## What to index

Start from the access patterns, not the schema:

1. **Every foreign key column.** PostgreSQL does not create these. Without them, deleting a parent scans the whole child table under a lock. This is the most commonly missing index in any schema. See [keys-and-identifiers.md](keys-and-identifiers.md).
2. **Columns in `WHERE` on your highest-frequency queries.**
3. **Columns in `ORDER BY`** when combined with `LIMIT` - an index can supply order without a sort.
4. **Join columns on both sides.**
5. **`tenant_id` first** in every composite index in a shared-schema multi-tenant design. See [multi-tenancy.md](multi-tenancy.md).

And a check: **before adding an index, look at what already exists.**

```sql
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'orders';
```

A new index that is a prefix of an existing composite index is redundant - `(customer_id)` adds nothing when `(customer_id, placed_at)` exists.

## After creating an index

```sql
CREATE INDEX CONCURRENTLY orders_customer_id_idx ON orders (customer_id);
ANALYZE orders;
```

`ANALYZE` updates the statistics so the planner will actually consider the new index. Skipping it is why a newly created index sometimes appears to be ignored.

Use `CONCURRENTLY` on any table with traffic. A plain `CREATE INDEX` blocks all writes for its duration. See [index-maintenance.md](index-maintenance.md).

## Under-indexing and over-indexing

Both are real failure modes and the balance is workload-specific.

**Under-indexed** shows as sequential scans with large `Rows Removed by Filter` on tables that keep growing. The fix is cheap: an index costs far less than the larger machine that would otherwise be bought.

**Over-indexed** shows as slow writes, a table whose indexes exceed it in size, and long vacuums. Symptoms are diffuse and the cause is rarely diagnosed, because nobody attributes slow inserts to an index added a year ago for a query that has since been deleted.

The discipline is to have an indexing **strategy** per table - look at the handful of queries that actually run against it and design the smallest set of indexes that serves them - rather than adding one index per slow query as it appears. A single well-ordered composite index frequently replaces three single-column ones.

Find the unused ones periodically. See [index-maintenance.md](index-maintenance.md).

## Version notes

- **18** - B-tree **skip scan** lets a composite index be used when the leading column is unconstrained, if that column has low cardinality. This changes some "the index cannot be used" conclusions, but does not repeal the leftmost-prefix rule.
- **18** - `EXPLAIN ANALYZE` includes `BUFFERS` by default, and reports index lookups per index scan node.
- **13+** - B-tree deduplication substantially shrinks indexes on columns with many duplicate values.

Bitmap scans, index-only scans, the visibility map and sargability are identical across 14 to 18.

## Gotchas

- Agent adds an index without reading the plan first - the plan often shows a statistics problem or an existing index
- Agent adds an index and does not run `ANALYZE` - the planner may keep ignoring it
- Agent concludes an index is broken because a sequential scan is chosen - for low selectivity that is the correct choice
- Agent leaves `random_page_cost` at 4.0 on SSD storage - biases the planner against every index scan
- Agent wraps a column in a function in `WHERE` - defeats the index; rewrite or index the expression
- Agent expects `LIKE 'abc%'` to use a plain B-tree under a non-C collation - it needs `text_pattern_ops`
- Agent expects `LIKE '%abc%'` to use a B-tree - it cannot; use a trigram index
- Agent compares columns of different types - the implicit cast disables the index
- Agent does not index foreign key columns - deleting a parent then scans the entire child table under a lock
- Agent adds an index that is a prefix of an existing composite index - redundant, pure write cost
- Agent ignores a high `Heap Fetches` count on an index-only scan - that is a vacuum problem, not an index problem
- Agent ignores `lossy` heap blocks in a bitmap scan - the bitmap outgrew `work_mem` and every row on those pages is rechecked
- Agent adds one index per slow query - a table accumulates indexes nobody reviews, and writes slow down invisibly
- Agent uses `CREATE INDEX` without `CONCURRENTLY` on a live table - blocks all writes for the duration

## Related

- [index-types.md](index-types.md) · [composite-and-covering-indexes.md](composite-and-covering-indexes.md) · [partial-and-expression-indexes.md](partial-and-expression-indexes.md) · [index-maintenance.md](index-maintenance.md) · [explain.md](explain.md) · [statistics-and-planner.md](statistics-and-planner.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [configuration.md](configuration.md)
