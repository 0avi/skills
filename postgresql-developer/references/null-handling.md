# NULL Handling

`NULL` is not a value. It is the absence of one, and SQL evaluates it under **three-valued logic**: `TRUE`, `FALSE`, `UNKNOWN`. Almost every wrong-answer bug in SQL that is not a join mistake is a NULL mistake, and they are silent - the query succeeds and returns the wrong rows.

## The rule that generates all the others

**Any comparison with `NULL` yields `UNKNOWN`, and `WHERE` keeps only `TRUE`.**

```sql
NULL = NULL      -- UNKNOWN, not TRUE
NULL <> NULL     -- UNKNOWN, not TRUE
NULL = 1         -- UNKNOWN
NULL + 1         -- NULL
'a' || NULL      -- NULL
```

So `WHERE deleted_at = NULL` matches nothing, ever, and does not error. Use `IS NULL` / `IS NOT NULL`, which are the only operators that inspect nullness and return a definite boolean.

Truth tables worth knowing, because they are not symmetric:

| `AND` | TRUE | FALSE | UNKNOWN |
|---|---|---|---|
| **TRUE** | TRUE | FALSE | UNKNOWN |
| **FALSE** | FALSE | FALSE | **FALSE** |
| **UNKNOWN** | UNKNOWN | **FALSE** | UNKNOWN |

| `OR` | TRUE | FALSE | UNKNOWN |
|---|---|---|---|
| **TRUE** | TRUE | **TRUE** | **TRUE** |
| **FALSE** | TRUE | FALSE | UNKNOWN |
| **UNKNOWN** | **TRUE** | UNKNOWN | UNKNOWN |

`FALSE AND UNKNOWN` is `FALSE`, and `TRUE OR UNKNOWN` is `TRUE`. Everything else involving UNKNOWN stays UNKNOWN.

## `NOT IN` with NULLs: the worst one

```sql
SELECT * FROM orders WHERE customer_id NOT IN (SELECT id FROM banned_customers);
```

If `banned_customers` contains a single `NULL` id, this returns **zero rows**. Always. No error.

Why: `x NOT IN (1, 2, NULL)` expands to `x <> 1 AND x <> 2 AND x <> NULL`. That last term is `UNKNOWN`, and `TRUE AND UNKNOWN` is `UNKNOWN`, so no row is ever `TRUE`.

`IN` does not have the problem - `TRUE OR UNKNOWN` is `TRUE` - so a matching row is still found. Only the negation breaks.

**Use `NOT EXISTS`:**

```sql
SELECT * FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM banned_customers b WHERE b.id = o.customer_id);
```

`NOT EXISTS` is null-safe, and on PostgreSQL it usually plans as an anti-join, which is also faster. Prefer it over `NOT IN` unconditionally, even when the column is `NOT NULL` today - the column may not be `NOT NULL` next year. See [joins.md](joins.md).

## Where NULLs are treated as equal

Inconsistently, three places treat NULLs as identical - which is the opposite of the comparison rule and catches people both ways:

| Context | Behaviour |
|---|---|
| `DISTINCT` | NULLs collapse into one |
| `GROUP BY` | All NULLs form one group |
| `UNION` (not `ALL`) | NULLs deduplicate |
| `IS NOT DISTINCT FROM` | NULL matches NULL, returns TRUE |
| `UNIQUE` constraint | NULLs are **distinct** - unlimited NULLs allowed (unless `NULLS NOT DISTINCT`, 15+) |
| `ORDER BY` | NULLs sort last ascending, first descending. Override with `NULLS FIRST`/`NULLS LAST` |

`IS NOT DISTINCT FROM` is the null-safe equality operator, and it is what you want when joining on a nullable column or comparing an old and new value:

```sql
WHERE old.status IS DISTINCT FROM new.status   -- true when one is NULL and the other is not
```

Plain `<>` would return `UNKNOWN` there and miss the change.

## Aggregates skip NULLs

Every aggregate except `count(*)` ignores NULL inputs. This is usually convenient and occasionally wrong.

```sql
SELECT count(*),            -- every row
       count(discount),     -- rows where discount IS NOT NULL
       avg(discount),       -- sum / count of non-null only
       sum(discount)        -- NULL if every input is NULL, not 0
FROM orders;
```

Two consequences that produce wrong numbers:

- **`avg(discount)` is not "average discount across orders"** if some orders have no discount. It is the average across orders that have one. If NULL means "no discount", `avg(coalesce(discount, 0))` is the correct expression.
- **`sum()` over zero non-null rows returns `NULL`, not `0`.** Any query that sums a `LEFT JOIN`ed column needs `coalesce(sum(x), 0)`.

`count(*)` counts rows, `count(column)` counts non-nulls, and `count(1)` is identical to `count(*)`. See [aggregation.md](aggregation.md).

## The functions

```sql
coalesce(a, b, c)     -- first non-null argument
nullif(a, b)          -- NULL if a = b, else a
greatest(a, b)        -- ignores NULLs in PostgreSQL
least(a, b)           -- ignores NULLs in PostgreSQL
num_nonnulls(a, b, c) -- how many arguments are not null
num_nulls(a, b, c)
```

`nullif` is the neat fix for division by zero:

```sql
SELECT wins::numeric / nullif(wins + losses, 0) AS win_rate FROM players;
```

Zero games gives `NULL` rather than an error, which is the honest answer.

`num_nonnulls` makes exclusive-arc constraints readable:

```sql
CHECK (num_nonnulls(post_id, photo_id, video_id) = 1)
```

Note that `greatest`/`least` ignoring NULLs is PostgreSQL-specific and differs from the SQL standard and from other databases. Do not rely on it in portable SQL.

## NULLs and outer joins

An outer join **manufactures** NULLs for unmatched rows. That interacts with the rules above in a way that silently converts an outer join to an inner one:

```sql
-- Intended: all customers, with their 2026 orders
SELECT c.name, o.id
FROM   customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE  o.placed_at >= '2026-01-01';       -- BUG
```

For a customer with no orders, `o.placed_at` is NULL, the `WHERE` yields UNKNOWN, and the row is dropped. The `LEFT JOIN` has become an inner join.

The filter belongs in `ON`:

```sql
LEFT JOIN orders o
       ON o.customer_id = c.id
      AND o.placed_at >= '2026-01-01'
```

The only `WHERE` condition on the outer side that is safe is `IS NULL`, which is the anti-join idiom:

```sql
WHERE o.id IS NULL     -- customers with no matching orders
```

See [joins.md](joins.md).

## NULLs and indexes

- B-tree indexes **do** store NULLs, so `WHERE x IS NULL` can use an index.
- `NOT NULL` on a column lets the planner discard `IS NULL` branches entirely and improves selectivity estimates.
- A partial index `WHERE col IS NOT NULL` is much smaller when a column is mostly NULL, and is the right index for a sparse column.
- A unique index permits unlimited NULLs, which is how "unique among live rows" is expressed with a partial index. See [partial-and-expression-indexes.md](partial-and-expression-indexes.md).

## Design: minimise them

Every nullable column pushes a three-valued case into every query that touches it. Reduce the surface:

- **Default to `NOT NULL`** and justify each exception. See [constraints.md](constraints.md).
- **`NOT NULL DEFAULT ''`** for text where empty is meaningful and distinct from unknown. But do not conflate them if they differ - "no middle name" and "we did not ask" are different facts.
- **`NOT NULL DEFAULT '{}'`** for `jsonb` and arrays. Removes the empty-versus-unknown distinction entirely.
- **`NOT NULL DEFAULT 0`** for counters, never NULL.
- When a NULL means a state, model the state: a nullable `cancelled_at` plus a `status` column, tied by a check so they cannot disagree.

The columns that should stay nullable are the ones where the absence is genuinely part of the domain: a middle name, an optional end date, an unresolved foreign key.

## Version notes

- **15+** - `UNIQUE NULLS NOT DISTINCT`, letting a unique constraint treat NULLs as equal.
- **14+** - `num_nonnulls`/`num_nulls` are available on all supported versions.

Three-valued logic, `NOT IN` behaviour, aggregate NULL-skipping and `IS DISTINCT FROM` are identical across 14 to 18 and are SQL-standard.

## Gotchas

- Agent writes `= NULL` or `<> NULL` - always UNKNOWN, matches nothing, no error
- Agent uses `NOT IN` with a subquery over a nullable column - one NULL makes the whole query return zero rows, silently. Use `NOT EXISTS`
- Agent puts an outer-side filter in `WHERE` after a `LEFT JOIN` - converts it to an inner join
- Agent uses `avg()` on a column where NULL means zero - the average is taken over the non-null rows only
- Agent uses `sum()` without `coalesce` and expects 0 - it returns NULL when every input is NULL
- Agent compares old and new values with `<>` in a trigger or a change detector - misses transitions to and from NULL. Use `IS DISTINCT FROM`
- Agent expects a `UNIQUE` constraint to block duplicate NULLs - NULLs are distinct by default
- Agent expects `GROUP BY` to split NULLs - all NULLs form one group, opposite to the comparison rule
- Agent forgets NULLs sort last ascending and first descending - a paginated `ORDER BY` over a nullable column then behaves inconsistently at the boundary
- Agent writes `CHECK (x > 0)` on a nullable column and believes NULL is rejected - a check that evaluates to NULL passes
- Agent leaves `jsonb` or array columns nullable - every query must then handle both NULL and empty
- Agent uses `greatest`/`least` NULL-skipping in SQL intended to be portable - PostgreSQL differs from the standard here

## Related

- [constraints.md](constraints.md) · [joins.md](joins.md) · [aggregation.md](aggregation.md) · [data-types.md](data-types.md) · [partial-and-expression-indexes.md](partial-and-expression-indexes.md) · [pagination.md](pagination.md)
