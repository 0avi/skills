# Aggregation

## `GROUP BY` scope

Every column in the select list must either appear in `GROUP BY` or be inside an aggregate. PostgreSQL enforces this, unlike MySQL's historical default, and the error is a real bug being caught.

The exception is **functional dependency**: if you group by a table's primary key, you may select any column of that table, because the key determines them.

```sql
-- Legal: grouping by the PK functionally determines c.name and c.email
SELECT c.id, c.name, c.email, count(o.id)
FROM   customers c LEFT JOIN orders o ON o.customer_id = c.id
GROUP  BY c.id;
```

This only works with a real primary key, not a unique constraint on a nullable column, and not across a join to a different table's columns.

`ANY_VALUE(col)` (16+) says "any row's value, I do not care which" explicitly, which is clearer than adding a column to `GROUP BY` just to satisfy the parser.

## `WHERE` versus `HAVING`

`WHERE` filters rows **before** grouping; `HAVING` filters groups **after**. The order of evaluation is `FROM` → `WHERE` → `GROUP BY` → `HAVING` → `SELECT` → `ORDER BY` → `LIMIT`.

```sql
SELECT customer_id, count(*) AS n
FROM   orders
WHERE  placed_at >= '2026-01-01'   -- which rows to consider
GROUP  BY customer_id
HAVING count(*) > 5;               -- which groups to keep
```

Putting a row-level condition in `HAVING` works but forces the aggregate over rows that are then discarded. Putting an aggregate condition in `WHERE` is an error - the aggregate does not exist yet.

Because `SELECT` is evaluated after `HAVING`, a select-list alias cannot be used in `WHERE` or `HAVING`. It **can** be used in `GROUP BY` and `ORDER BY`, which is a PostgreSQL extension worth using for readability.

## Counting

```sql
count(*)              -- rows in the group
count(col)            -- rows where col IS NOT NULL
count(DISTINCT col)   -- distinct non-null values. Expensive: needs a sort or hash
count(1)              -- identical to count(*). Not faster.
```

`count(*)` does not fetch any column; the planner knows it only needs to count rows, which is why it can use an index-only scan. `count(1)` is not an optimisation and never has been.

**`count(*)` on a whole large table is slow** - MVCC means visibility must be checked per row, so there is no stored row count. An index-only scan helps if the visibility map is current, which requires a recent vacuum.

For an approximate count:

```sql
SELECT reltuples::bigint FROM pg_class WHERE oid = 'orders'::regclass;
```

That is as fresh as the last `ANALYZE` or `VACUUM` and can be badly stale on a table that has just been bulk-loaded. It is fine for "about how many rows", and unfit for anything a user sees as exact.

## `FILTER`

The clean way to aggregate subsets, and much clearer than `CASE` inside an aggregate:

```sql
SELECT
    count(*)                                    AS total,
    count(*) FILTER (WHERE status = 'paid')     AS paid,
    count(*) FILTER (WHERE status = 'refunded') AS refunded,
    sum(amount) FILTER (WHERE status = 'paid')  AS revenue
FROM orders;
```

The `CASE` equivalent (`count(CASE WHEN status='paid' THEN 1 END)`) works because `count` skips NULLs, but it relies on that indirectly and it is easy to write `ELSE 0` by mistake, which counts everything. `FILTER` says what it means.

`FILTER` also works on window functions.

## `DISTINCT ON`

A PostgreSQL extension that returns the first row of each group by some ordering. It is the cleanest "one row per group" in SQL.

```sql
-- The most recent order per customer, whole row
SELECT DISTINCT ON (customer_id) *
FROM   orders
ORDER  BY customer_id, placed_at DESC;
```

Two rules:

1. `ORDER BY` **must start with** the `DISTINCT ON` expressions.
2. What follows decides which row wins. Without it, you get an arbitrary row.

An index on `(customer_id, placed_at DESC)` lets this run as a single index scan with no sort. Note that the index's direction must match the `ORDER BY`: an index on `(region, score DESC, win_count DESC)` serves `ORDER BY region, score DESC, win_count DESC` but **not** `ORDER BY region, win_count DESC, score DESC`, which falls back to a full scan and sort. See [composite-and-covering-indexes.md](composite-and-covering-indexes.md).

For top-N per group rather than top-1, use `LATERAL` or a window function. See [joins.md](joins.md).

## `GROUPING SETS`, `ROLLUP`, `CUBE`

Multiple aggregation levels in one pass, instead of `UNION ALL` over several queries.

```sql
SELECT region, product_category, sum(amount)
FROM   sales
GROUP  BY ROLLUP (region, product_category);
-- (region, category), (region), () - a subtotal per region and a grand total
```

- `ROLLUP (a, b)` - hierarchical: `(a,b)`, `(a)`, `()`.
- `CUBE (a, b)` - every combination: `(a,b)`, `(a)`, `(b)`, `()`.
- `GROUPING SETS ((a,b), (a), ())` - exactly the ones you list.

Subtotal rows carry NULL in the columns not being grouped, which is ambiguous when the data itself contains NULLs. `GROUPING(col)` returns 1 for a subtotal NULL and 0 for a data NULL:

```sql
SELECT
    CASE WHEN GROUPING(region) = 1 THEN 'ALL REGIONS' ELSE region END AS region,
    sum(amount)
FROM sales GROUP BY ROLLUP (region);
```

## Ordered-set and array aggregates

```sql
percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms)   AS median
percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)   AS p95
percentile_disc(0.5)  WITHIN GROUP (ORDER BY duration_ms)   AS median_actual_value
mode()                WITHIN GROUP (ORDER BY category)      AS most_common
```

`percentile_cont` interpolates between values; `percentile_disc` returns an actual value from the data. For latency percentiles you usually want `_cont`.

```sql
array_agg(name ORDER BY name)                 -- ordered array
string_agg(name, ', ' ORDER BY name)          -- delimited string
jsonb_agg(jsonb_build_object('id', id))       -- JSON array
jsonb_object_agg(key, value)                  -- JSON object
```

`ORDER BY` **inside** the aggregate is what makes the output deterministic. Without it the order is whatever the plan happened to produce, which changes when the plan changes - a classic source of tests that pass locally and fail in CI.

`array_agg` includes NULLs; `string_agg` skips them.

## Aggregating over a `LEFT JOIN`

```sql
SELECT c.id, c.name,
       count(o.id)                  AS order_count,   -- 0 for customers with none
       coalesce(sum(o.amount), 0)   AS total
FROM   customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP  BY c.id;
```

Two things must be right:

- **`count(o.id)`, not `count(*)`.** For a customer with no orders the join produces one row with NULLs, so `count(*)` returns 1 and `count(o.id)` returns 0. The second is correct.
- **`coalesce(sum(...), 0)`.** `sum()` over no non-null rows is NULL, not 0.

And if a second one-to-many table is joined, both aggregates are inflated. See [joins.md](joins.md).

## Performance

`GROUP BY` is executed as either **HashAggregate** (build a hash table of groups) or **GroupAggregate** (sort, then aggregate adjacent rows). `EXPLAIN` shows which.

- HashAggregate is usually faster but needs the groups to fit in `work_mem`. If they do not, it spills to disk (PostgreSQL 13+ handles this gracefully; before that it could overrun memory).
- GroupAggregate needs sorted input, so an index on the grouping columns can eliminate the sort entirely.
- `Sort Method: external merge Disk: NNNkB` in `EXPLAIN (ANALYZE)` means the sort spilled. Raising `work_mem` for that query may help - but `work_mem` is per sort node per parallel worker, so a large global value is dangerous. Set it per session or per role. See [configuration.md](configuration.md).

For aggregates that are recomputed constantly over data that changes slowly, a materialised view is usually the answer. See [views.md](views.md).

## Version notes

- **16+** - `ANY_VALUE()`.
- **14+** - improvements to parallel aggregation and to incremental sort feeding GroupAggregate.
- **13+** - HashAggregate spills to disk instead of exceeding `work_mem`. On 12 and earlier a misestimate could cause memory exhaustion.

`FILTER`, `DISTINCT ON`, `GROUPING SETS`, ordered-set aggregates and functional-dependency `GROUP BY` are identical across 14 to 18.

## Gotchas

- Agent uses `count(*)` over a `LEFT JOIN` - returns 1 for parents with no children; use `count(child.id)`
- Agent uses `sum()` and expects 0 for an empty group - it returns NULL
- Agent uses `avg()` on a column where NULL means zero - the average is over non-null rows only
- Agent writes `count(1)` believing it is faster than `count(*)` - identical
- Agent uses `count(*)` on a large table for an exact live figure - MVCC means it scans; use `reltuples` if approximate is acceptable
- Agent puts a row-level filter in `HAVING` - it aggregates rows that are then thrown away
- Agent uses a select-list alias in `WHERE` or `HAVING` - `SELECT` is evaluated after both
- Agent writes `DISTINCT ON` without an `ORDER BY` starting with the same expressions - the row returned is arbitrary
- Agent writes `DISTINCT ON` whose `ORDER BY` direction does not match the index - falls back to a full sort
- Agent uses `array_agg` or `string_agg` without an inner `ORDER BY` - output order follows the plan and changes when the plan does
- Agent uses `CASE WHEN ... THEN 1 ELSE 0 END` inside `count()` - counts every row, because `count` skips only NULLs. Use `FILTER`
- Agent uses `ROLLUP` and cannot distinguish subtotal NULLs from data NULLs - use `GROUPING()`
- Agent raises `work_mem` globally to stop a sort spilling - it is per sort node per worker, so the total is a multiple of what was intended

## Related

- [joins.md](joins.md) · [null-handling.md](null-handling.md) · [window-functions.md](window-functions.md) · [views.md](views.md) · [explain.md](explain.md) · [configuration.md](configuration.md) · [composite-and-covering-indexes.md](composite-and-covering-indexes.md)
