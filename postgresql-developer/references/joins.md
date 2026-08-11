# Joins

Join *type* is a correctness decision. Join *method* and join *order* are the planner's job, and trying to control them by rewriting the query is almost always wasted effort.

## The types

| Type | Returns |
|---|---|
| `INNER JOIN` | Rows matching on both sides |
| `LEFT JOIN` | All left rows; NULLs where the right has no match |
| `RIGHT JOIN` | The mirror. Rewrite as `LEFT` for readability |
| `FULL JOIN` | All rows from both, NULLs where either side is missing |
| `CROSS JOIN` | Cartesian product. Deliberate only |
| `LATERAL` | Right side may reference left-side columns |

`USING (customer_id)` is shorthand for `ON a.customer_id = b.customer_id` and merges the column into one output column. Convenient when the names match; `ON` is clearer when they do not.

## `ON` versus `WHERE`

For an **inner** join these are equivalent, and the planner treats them identically. For an **outer** join they are completely different, and confusing them is the most common join bug.

```sql
-- All customers, with their 2026 orders. Customers with none show NULL.
SELECT c.name, o.id
FROM   customers c
LEFT JOIN orders o ON o.customer_id = c.id
                  AND o.placed_at >= '2026-01-01';

-- Only customers who HAVE a 2026 order. The LEFT JOIN is now an inner join.
SELECT c.name, o.id
FROM   customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE  o.placed_at >= '2026-01-01';
```

The second is not wrong syntax - it is a different query. The rule: **a condition on the outer table's columns in `WHERE` cancels the outerness**, because the manufactured NULLs fail it. See [null-handling.md](null-handling.md).

The one safe `WHERE` condition on the outer side is `IS NULL`, which is the anti-join idiom below.

## Semi-joins and anti-joins

A **semi-join** returns left rows that have at least one match, without duplicating them. An **anti-join** returns left rows with no match. PostgreSQL has no keyword for either; you express them and the planner recognises them.

```sql
-- Semi-join: customers with at least one order. One row per customer.
SELECT c.* FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);

-- Anti-join: customers with no orders.
SELECT c.* FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);
```

The `LEFT JOIN ... WHERE right.id IS NULL` form is an equivalent anti-join and plans the same way. `NOT EXISTS` reads better and is harder to get wrong.

### `EXISTS` vs `IN` vs `JOIN`

| Want | Use | Why |
|---|---|---|
| Left rows that have a match, no duplication | `EXISTS` | Semi-join. Stops at the first match |
| Left rows with no match | `NOT EXISTS` | Anti-join, and **null-safe** |
| Columns from both sides | `JOIN` | You need the data |
| Match against a small literal list | `IN (1,2,3)` | Clearest |

**Never use `NOT IN` with a subquery.** A single NULL in the subquery makes it return zero rows, silently. `NOT EXISTS` has no such trap. See [null-handling.md](null-handling.md).

`EXISTS` and `IN` with a subquery generally plan identically on modern PostgreSQL - the planner converts both to semi-joins. Choose on readability, not on a performance belief.

**Using an inner `JOIN` where you meant `EXISTS` duplicates rows.** If a customer has five orders, joining produces five customer rows. That is fine if you want the orders, and a bug if you were filtering.

## Join fan-out and inflated aggregates

The most damaging silent join bug.

```sql
-- WRONG. Both sums are multiplied.
SELECT o.id,
       sum(oi.quantity)   AS items,
       sum(p.amount)      AS paid
FROM   orders o
JOIN   order_items oi ON oi.order_id = o.id
JOIN   payments    p  ON p.order_id  = o.id
GROUP  BY o.id;
```

An order with 3 items and 2 payments produces 6 rows. `sum(oi.quantity)` counts each item twice; `sum(p.amount)` counts each payment three times. The query succeeds and the numbers are wrong.

Any time you join **two independent one-to-many relationships** to the same parent and aggregate, you have this bug.

Three fixes:

```sql
-- 1. Aggregate separately, then join the results. Clearest.
WITH item_totals AS (
    SELECT order_id, sum(quantity) AS items FROM order_items GROUP BY order_id
),
payment_totals AS (
    SELECT order_id, sum(amount) AS paid FROM payments GROUP BY order_id
)
SELECT o.id, coalesce(i.items, 0), coalesce(p.paid, 0)
FROM   orders o
LEFT JOIN item_totals    i ON i.order_id = o.id
LEFT JOIN payment_totals p ON p.order_id = o.id;

-- 2. Scalar subqueries. Fine for a handful of aggregates.
SELECT o.id,
       (SELECT sum(quantity) FROM order_items WHERE order_id = o.id) AS items,
       (SELECT sum(amount)   FROM payments    WHERE order_id = o.id) AS paid
FROM   orders o;

-- 3. DISTINCT inside the aggregate. Works only for sums over distinct values,
--    and is wrong if two items legitimately have the same quantity.
SELECT o.id, sum(DISTINCT oi.quantity) FROM ...   -- usually a bug, not a fix
```

Option 3 is listed because it is commonly reached for and is usually incorrect. Use 1 or 2.

## `LATERAL`

A `LATERAL` subquery may reference columns from tables to its left. It runs once per left row, which makes "top N per group" expressible:

```sql
-- The three most recent orders for each customer
SELECT c.name, o.id, o.placed_at
FROM   customers c
LEFT JOIN LATERAL (
    SELECT o.id, o.placed_at
    FROM   orders o
    WHERE  o.customer_id = c.id
    ORDER  BY o.placed_at DESC
    LIMIT  3
) o ON true;
```

`LEFT JOIN LATERAL ... ON true` is the idiom that keeps customers with no orders. A plain `CROSS JOIN LATERAL` drops them, because the subquery returns zero rows.

`LATERAL` is also implicit when a set-returning function in `FROM` references an earlier table:

```sql
SELECT o.id, item ->> 'name'
FROM   orders o, jsonb_array_elements(o.data -> 'items') AS item;
```

That drops orders whose array is empty. Use `LEFT JOIN LATERAL ... ON true` to keep them. See [jsonb.md](jsonb.md).

For top-N-per-group, `LATERAL` with a supporting index is usually faster than a window function, because it stops after N rows per group instead of ranking everything. Compare both. See [window-functions.md](window-functions.md).

## Join methods, and why not to fight them

The planner picks one of three, and the choice is shown in `EXPLAIN`:

| Method | How it works | Best when |
|---|---|---|
| **Nested Loop** | For each outer row, probe the inner | Outer side is small and the inner has a usable index |
| **Hash Join** | Build a hash table on the smaller side, probe with the larger | Large unsorted inputs, equality conditions |
| **Merge Join** | Sort both sides, walk them together | Both inputs already sorted, typically by index order |

Nested Loop is `O(n × m)` without an index on the inner side. A Nested Loop with a high `loops` count and no index underneath is a classic slow plan - but the *cause* is the missing index or a bad row estimate, not the join method.

`enable_hashjoin = off` and friends exist for diagnosis, not for production. If turning one off makes the query faster, you have learned that the planner's cost estimate is wrong - now find out why, which is nearly always a statistics problem. See [statistics-and-planner.md](statistics-and-planner.md).

**Join order is chosen by the planner**, not by the order you write. With up to `join_collapse_limit` (default 8) tables it considers all orderings; beyond that it partly follows your syntax. A 12-table join can therefore be sensitive to how it is written, which is a reason to break large queries into CTEs rather than to hand-tune the order.

## Joining on the wrong type

```sql
JOIN accounts a ON a.id = e.account_id     -- a.id bigint, e.account_id text
```

PostgreSQL will cast to make it work, and the cast usually prevents an index scan on one side. It also produces a plan that looks inexplicably bad. Check the types when a join is unexpectedly slow, and fix the column type rather than adding a cast to the query.

## Practical rules

1. **Alias every table** and **qualify every column** in a multi-table query. Unqualified columns silently change meaning when a same-named column is added elsewhere.
2. **Filter as early as the semantics allow.** For inner joins the planner does this for you; for outer joins the placement is yours and it is a correctness decision.
3. **Index both sides of the join condition.** Primary keys are indexed; foreign keys are not, and that is the most commonly missing index in any schema. See [keys-and-identifiers.md](keys-and-identifiers.md).
4. **Do not use `SELECT *` in a join.** Duplicate column names across tables produce ambiguous output that clients handle inconsistently.
5. **Comma joins are not slower**, contrary to a persistent myth. They are just easier to get wrong, because omitting the condition silently yields a cross join.

## Version notes

- **16** - `FULL JOIN` and internal-right hash joins can be parallelised.
- **14+** - improvements to incremental sort make merge joins viable in more cases.

Join semantics, `LATERAL`, and semi/anti-join recognition are identical across 14 to 18. `join_collapse_limit` and `from_collapse_limit` default to 8 on every supported version.

## Gotchas

- Agent puts an outer-side filter in `WHERE` after a `LEFT JOIN` - silently converts it to an inner join
- Agent joins two independent one-to-many tables and aggregates - both aggregates are multiplied by the other's row count, with no error
- Agent adds `DISTINCT` to fix an inflated aggregate - it hides the fan-out and gives wrong answers whenever two child rows share a value
- Agent uses `NOT IN` with a subquery - a single NULL returns zero rows
- Agent uses an inner `JOIN` to filter and gets duplicate parent rows - use `EXISTS`
- Agent uses `CROSS JOIN LATERAL` where rows with no match must be kept - use `LEFT JOIN LATERAL ... ON true`
- Agent uses a set-returning function in `FROM` and loses rows with empty input - same fix
- Agent disables a join method to "fix" a plan - that masks a bad estimate; find why the estimate is wrong
- Agent rewrites join order to influence the planner - the planner reorders anyway below `join_collapse_limit`
- Agent joins columns of different types - the implicit cast usually disables an index scan
- Agent leaves columns unqualified in a multi-table query - resolution changes silently when a column is added elsewhere
- Agent uses a window function for top-N-per-group when `LATERAL` with an index would stop after N rows

## Related

- [null-handling.md](null-handling.md) · [aggregation.md](aggregation.md) · [window-functions.md](window-functions.md) · [explain.md](explain.md) · [statistics-and-planner.md](statistics-and-planner.md) · [keys-and-identifiers.md](keys-and-identifiers.md) · [query-optimisation.md](query-optimisation.md) · [jsonb.md](jsonb.md)
