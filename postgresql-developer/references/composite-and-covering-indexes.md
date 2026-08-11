# Composite and Covering Indexes

A composite index sorts by its first column, then by the second within each value of the first, and so on. Everything about column order follows from that.

## The leftmost-prefix rule

An index on `(a, b, c)` can serve a query that constrains:

- `a`
- `a, b`
- `a, b, c`

It cannot efficiently serve `b` alone, or `c` alone, or `(b, c)` - because the index is sorted by `a` first, and the rows for a given `b` are scattered across the whole index.

```sql
CREATE INDEX player_stats_region_score_wins_idx
    ON player_stats (region, score DESC, win_count DESC);

WHERE region = 'NA'                                      -- uses it
WHERE region = 'NA' AND score > 5000                     -- uses it
WHERE region = 'NA' AND score > 5000 AND win_count > 10  -- uses it fully
WHERE score > 5000                                       -- does not (except via skip scan)
```

### What PG18 skip scan changes

PostgreSQL 18 can **skip** through a composite index when a leading column is unconstrained, by iterating its distinct values and doing a range scan under each. That makes `WHERE score > 5000` usable against the index above.

It is only worthwhile when the leading column has **few distinct values**. With three regions, skipping is three range scans and is a large win. With a leading `customer_id` of a million values it is a million range scans, and the planner will not choose it.

**Do not design around skip scan.** Order columns as if the leftmost-prefix rule were absolute; treat skip scan as a bonus that rescues some queries you did not plan for.

## Column order

Ordering rules, in priority:

**1. Equality columns before range columns.**

```sql
WHERE tenant_id = $1 AND status = $2 AND created_at > $3
```

Index `(tenant_id, status, created_at)`. Once the scan hits a range predicate, columns after it can no longer narrow the scan - they can only filter rows already read. Putting `created_at` earlier wastes the columns after it.

**2. Among equality columns, most selective first** - usually. This is the traditional rule, and it matters less than it is claimed to, because a B-tree descends to the matching range either way. What it genuinely affects is index size under deduplication, and how useful shorter prefixes of the index are. Where it matters most: put the column that appears **alone** in other queries first, so one index serves several.

**3. `tenant_id` first, always**, in a shared-schema multi-tenant design. Every query is tenant-scoped. See [multi-tenancy.md](multi-tenancy.md).

**4. Then `ORDER BY` columns**, so the index can supply order without a sort.

## Matching `ORDER BY`

An index can eliminate a sort only if the requested order matches the index order - either forward or fully reversed.

```sql
CREATE INDEX ... ON player_stats (region, score DESC, win_count DESC);

ORDER BY region, score DESC, win_count DESC   -- forward scan, no sort
ORDER BY region DESC, score, win_count        -- backward scan, no sort
ORDER BY region, win_count DESC, score DESC   -- NO. Different column order -> full sort
ORDER BY region, score DESC, win_count ASC    -- NO. Mixed directions -> full sort
```

The third and fourth cases fall back to a sequential scan plus sort, and the plan looks completely different for what seems like a trivial change. This surprises people whenever a UI adds a secondary sort option.

For **mixed** directions you need an index declared exactly that way:

```sql
CREATE INDEX ... ON t (a ASC, b DESC);
```

Neither a forward nor a backward scan of `(a, b)` produces `a ASC, b DESC`.

`NULLS FIRST`/`NULLS LAST` must match too. Ascending defaults to `NULLS LAST`, descending to `NULLS FIRST`.

This is central to keyset pagination. See [pagination.md](pagination.md).

## Covering indexes and `INCLUDE`

An **index-only scan** answers the query from the index, never touching the table. For that, the index must contain every column the query references - in `SELECT`, `WHERE` and `ORDER BY`.

`INCLUDE` adds payload columns that are stored in the leaf pages but are **not** part of the search key:

```sql
CREATE INDEX orders_customer_id_idx
    ON orders (customer_id) INCLUDE (status, total_amount);
```

```sql
SELECT status, total_amount FROM orders WHERE customer_id = $1;   -- index-only scan
```

`INCLUDE` versus adding the column as a key column:

| | Key column `(a, b)` | `(a) INCLUDE (b)` |
|---|---|---|
| Can filter on `b` | Yes | No |
| Can sort by `b` | Yes | No |
| Counts toward uniqueness | Yes | **No** |
| Stored in internal pages | Yes, making the tree wider | No, only in leaves |
| Type must be indexable | Yes | No |

Two things `INCLUDE` uniquely enables:

**Uniqueness on a subset while covering more:**

```sql
CREATE UNIQUE INDEX users_email_key ON users (email) INCLUDE (display_name);
-- unique on email alone, but display_name comes free
```

**Covering with a non-indexable type.** A `jsonb` or `point` column can be `INCLUDE`d in a B-tree even though B-tree cannot index it.

Only B-tree, GiST and SP-GiST support `INCLUDE`.

### The visibility-map dependency

An index-only scan **must still verify visibility**, and visibility lives in the heap. The visibility map marks pages where all rows are visible to everyone.

```
Index Only Scan using orders_customer_id_idx on orders
  Heap Fetches: 0        <- working
  Heap Fetches: 92831    <- not working
```

Every heap fetch is a random read - exactly the cost the index-only scan existed to avoid. High counts mean the visibility map is stale, which means autovacuum is not keeping up on that table. **The fix is vacuum tuning, not the index.** See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

Do not `INCLUDE` a wide column speculatively. It is stored in every leaf entry, and a large payload can double the index size for no benefit if index-only scans do not actually happen.

## Expression indexes and index-only scans

The planner has a known limitation here:

```sql
CREATE INDEX t_lower_email_idx ON users (lower(email));
SELECT lower(email) FROM users WHERE lower(email) = $1;
```

This will **not** use an index-only scan, because the planner considers `email` to be required even though only `lower(email)` is used. The workaround is to include the base column:

```sql
CREATE INDEX t_lower_email_idx ON users (lower(email)) INCLUDE (email);
```

## One composite or several single-column?

PostgreSQL can combine separate indexes with a `BitmapAnd`:

```
Bitmap Heap Scan on orders
  ->  BitmapAnd
        ->  Bitmap Index Scan on orders_status_idx
        ->  Bitmap Index Scan on orders_customer_id_idx
```

That works, and it is genuinely slower than one composite index - two index scans, a bitmap intersection, then a heap scan that may be lossy.

| Situation | Choose |
|---|---|
| Columns are queried together consistently | One composite index |
| Columns are queried in arbitrary combinations | Separate single-column indexes |
| One column is almost always present | Composite, with it leading |

A composite `(a, b, c)` also serves `(a)` and `(a, b)`, so it frequently replaces three indexes. Look for that consolidation - it is the main lever against over-indexing. See [index-maintenance.md](index-maintenance.md).

## Size

Every key column is stored in every leaf entry, and in internal pages. A composite over three `text` columns can be enormous. Check:

```sql
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid))
FROM   pg_stat_user_indexes WHERE relname = 'orders'
ORDER  BY pg_relation_size(indexrelid) DESC;
```

If an index approaches the size of its table, reconsider: fewer columns, a partial index, or `INCLUDE` instead of key columns (payload is not stored in internal pages, so the tree stays shallower).

B-tree **deduplication** (13+) stores a repeated key once with a list of pointers, which helps enormously on low-cardinality leading columns.

## Version notes

- **18** - skip scan lets a composite index serve queries with an unconstrained low-cardinality leading column. Treat it as a bonus, not a design assumption.
- **14+** - incremental sort can use an index covering a **prefix** of the `ORDER BY` and sort only within groups, which reduces the penalty of a partially-matching index.
- **13+** - B-tree deduplication.
- **11+** - `INCLUDE`. Available on every supported version.

The leftmost-prefix rule, `ORDER BY` matching and the visibility-map dependency are identical across 14 to 18.

## Gotchas

- Agent puts a range column before an equality column - columns after the range can no longer narrow the scan
- Agent creates `(a)` when `(a, b)` already exists - redundant; the composite already serves `a`
- Agent creates `(b)` expecting it to help `(a, b)` queries - it does not; order matters
- Agent assumes PG18 skip scan removes the need for correct column order - it only helps low-cardinality leading columns
- Agent changes the `ORDER BY` column order or a single direction and expects the index still to apply - it falls back to a full sort
- Agent creates `(a, b)` for `ORDER BY a ASC, b DESC` - mixed directions need the index declared that way
- Agent ignores `NULLS FIRST`/`NULLS LAST` mismatches - they prevent the index supplying order
- Agent adds a column as a key column when `INCLUDE` would do - key columns widen internal pages and affect uniqueness
- Agent puts a column in `INCLUDE` and then filters on it - `INCLUDE` columns cannot be searched or sorted
- Agent expects `INCLUDE` to extend a unique constraint - it does not; uniqueness covers key columns only
- Agent adds a wide `INCLUDE` payload speculatively - it is stored in every leaf entry
- Agent sees high `Heap Fetches` and adds more `INCLUDE` columns - the problem is a stale visibility map, so tune vacuum
- Agent creates an expression index and wonders why there is no index-only scan - include the base column
- Agent creates many single-column indexes where one composite would serve - `BitmapAnd` works but is slower, and each index costs writes

## Related

- [indexing-fundamentals.md](indexing-fundamentals.md) · [index-types.md](index-types.md) · [partial-and-expression-indexes.md](partial-and-expression-indexes.md) · [index-maintenance.md](index-maintenance.md) · [pagination.md](pagination.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [explain.md](explain.md) · [multi-tenancy.md](multi-tenancy.md)
