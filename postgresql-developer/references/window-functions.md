# Window Functions

A window function computes across a set of rows related to the current row, **without collapsing them**. That is the whole distinction from an aggregate: `GROUP BY` returns one row per group; a window function returns every row, with the computed value attached.

```sql
SELECT
    name,
    department,
    salary,
    avg(salary) OVER (PARTITION BY department) AS dept_avg,
    salary - avg(salary) OVER (PARTITION BY department) AS diff_from_avg
FROM employees;
```

Every employee row survives, each carrying its department average. Doing this with `GROUP BY` requires aggregating and joining back.

## Anatomy

```sql
function() OVER (
    PARTITION BY expr    -- split into groups. Omit for one window over everything
    ORDER BY expr        -- ordering within the partition
    frame_clause         -- which rows within the partition
)
```

Reuse a window definition with `WINDOW`:

```sql
SELECT name,
       rank()       OVER w,
       sum(salary)  OVER w
FROM   employees
WINDOW w AS (PARTITION BY department ORDER BY salary DESC);
```

## The frame, and its default

The single most misunderstood part. When you add `ORDER BY` to a window, the frame defaults to:

```
RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
```

That is a **running** total, not a partition total. Without `ORDER BY`, the frame is the whole partition.

```sql
sum(amount) OVER (PARTITION BY customer_id)                        -- partition total, repeated
sum(amount) OVER (PARTITION BY customer_id ORDER BY placed_at)     -- running total
```

Adding `ORDER BY` for readability silently converts one into the other. This is a real and frequent bug.

Worse, the default frame is `RANGE`, not `ROWS`, and with `RANGE` **all peer rows - rows with the same `ORDER BY` value - are included together**. Two orders with an identical timestamp both get the total including both. `ROWS` counts physical rows and does not do this:

```sql
sum(amount) OVER (ORDER BY placed_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
```

**Use `ROWS` unless you specifically want peer grouping.**

Frame bounds:

| Clause | Meaning |
|---|---|
| `UNBOUNDED PRECEDING` | Start of partition |
| `n PRECEDING` | n rows (or values, under `RANGE`) back |
| `CURRENT ROW` | This row, or all its peers under `RANGE` |
| `n FOLLOWING` | n forward |
| `UNBOUNDED FOLLOWING` | End of partition |

`GROUPS` (11+) is a third mode that counts peer groups rather than rows.

## Ranking

```sql
row_number()   OVER (ORDER BY score DESC)   -- 1,2,3,4 - always unique
rank()         OVER (ORDER BY score DESC)   -- 1,2,2,4 - gaps after ties
dense_rank()   OVER (ORDER BY score DESC)   -- 1,2,2,3 - no gaps
percent_rank() OVER (ORDER BY score DESC)   -- 0 to 1
ntile(4)       OVER (ORDER BY score DESC)   -- quartile bucket
```

Choosing among the first three is a product decision: does a tie consume the next position? `row_number()` breaks ties arbitrarily, which makes it non-deterministic unless the `ORDER BY` is unique - add a tiebreaker column.

## Offset functions

```sql
lag(amount)      OVER (PARTITION BY customer_id ORDER BY placed_at)  -- previous row
lead(amount)     OVER (...)                                           -- next row
lag(amount, 1, 0) OVER (...)                                          -- default 0 instead of NULL
first_value(amount) OVER (...)
last_value(amount)  OVER (...)
nth_value(amount, 3) OVER (...)
```

**`last_value` is a trap.** With the default frame ending at `CURRENT ROW`, `last_value` returns the current row. To get the partition's last value:

```sql
last_value(amount) OVER (
    PARTITION BY customer_id ORDER BY placed_at
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
)
```

`first_value` happens to work with the default frame, which is why the asymmetry surprises people.

## Common patterns

**Running total**

```sql
SELECT placed_at, amount,
       sum(amount) OVER (ORDER BY placed_at, id
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
FROM orders;
```

Include a tiebreaker (`id`) so the order is deterministic.

**Change from the previous row**

```sql
SELECT reading_at, value,
       value - lag(value) OVER (ORDER BY reading_at) AS delta
FROM sensor_readings;
```

**Top N per group**

```sql
SELECT * FROM (
    SELECT o.*,
           row_number() OVER (PARTITION BY customer_id ORDER BY placed_at DESC) AS rn
    FROM orders o
) t WHERE rn <= 3;
```

The filter must be in an outer query - **window functions cannot appear in `WHERE`**, because they are evaluated after it.

For top-N-per-group this is often **slower** than `LATERAL`, because it ranks every row in every partition before discarding. `LATERAL` with a matching index stops after N rows per group. Compare both plans. See [joins.md](joins.md).

**Moving average**

```sql
avg(value) OVER (ORDER BY reading_at ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
```

**Deduplicate, keeping one row per key**

```sql
DELETE FROM staging s USING (
    SELECT ctid, row_number() OVER (PARTITION BY email ORDER BY created_at) AS rn
    FROM staging
) d WHERE s.ctid = d.ctid AND d.rn > 1;
```

**Gaps and islands** - grouping consecutive runs. The trick is that `row_number()` minus a sequence is constant within a run:

```sql
SELECT user_id, min(day) AS run_start, max(day) AS run_end, count(*) AS length
FROM (
    SELECT user_id, day,
           day - (row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS grp
    FROM daily_activity
) t
GROUP BY user_id, grp;
```

## Evaluation order

Window functions are evaluated **after** `FROM`, `WHERE`, `GROUP BY` and `HAVING`, and **before** `ORDER BY` and `LIMIT`.

Consequences:

- Cannot be used in `WHERE` or `HAVING`. Wrap in a subquery or CTE.
- **Can** be combined with `GROUP BY`, and they operate on the grouped rows:
  ```sql
  SELECT department, sum(salary) AS total,
         rank() OVER (ORDER BY sum(salary) DESC) AS rank_by_total
  FROM employees GROUP BY department;
  ```
- The window's `ORDER BY` is independent of the query's final `ORDER BY`. Specify both if you want a particular output order.

## Performance

A window function needs its input sorted by `PARTITION BY` then `ORDER BY`. An index on exactly those columns in that order eliminates the sort:

```sql
CREATE INDEX orders_customer_placed_idx ON orders (customer_id, placed_at DESC);
```

`EXPLAIN` shows a `WindowAgg` node above a `Sort` or an `Index Scan`. If it is a `Sort` on a large input, that is the cost. Watch for `Sort Method: external merge Disk:` which means it spilled past `work_mem`.

Multiple window functions **sharing the same window definition** are computed in one pass. Different definitions each need their own sort, so consolidate where you can.

## Version notes

- **16+** - better parallelisation of some window plans.
- **14+** - incremental sort is used more aggressively to feed `WindowAgg`, which reduces the cost of a partially-matching index.
- **11+** - `GROUPS` frame mode, `RANGE` with offsets, and frame exclusion (`EXCLUDE CURRENT ROW`, `EXCLUDE TIES`, `EXCLUDE GROUP`). All available on every supported version.

Frame defaults and the evaluation order are SQL-standard and identical across 14 to 18.

## Gotchas

- Agent adds `ORDER BY` to a window for readability - that silently changes the frame from the whole partition to a running total
- Agent uses the default `RANGE` frame with non-unique ordering values - all peer rows are included together, which is rarely intended. Use `ROWS`
- Agent uses `last_value()` with the default frame - it returns the current row; the frame must extend to `UNBOUNDED FOLLOWING`
- Agent puts a window function in `WHERE` or `HAVING` - not permitted; they are evaluated later. Wrap in a subquery
- Agent uses `row_number()` with a non-unique `ORDER BY` - ties break arbitrarily and the result is not reproducible
- Agent confuses `rank()` and `dense_rank()` - one leaves gaps after ties, the other does not
- Agent uses a window function for top-N-per-group on a large table - it ranks everything first; `LATERAL` with an index stops after N
- Agent writes several window functions with slightly different definitions - each needs its own sort; consolidate with `WINDOW`
- Agent omits a tiebreaker from a running total's `ORDER BY` - the result changes between runs when values tie
- Agent expects the window `ORDER BY` to order the output - it does not; add a query-level `ORDER BY`
- Agent computes a window over an unsorted large input without a matching index - the sort spills to disk

## Related

- [aggregation.md](aggregation.md) · [joins.md](joins.md) · [ctes.md](ctes.md) · [composite-and-covering-indexes.md](composite-and-covering-indexes.md) · [explain.md](explain.md) · [pagination.md](pagination.md)
