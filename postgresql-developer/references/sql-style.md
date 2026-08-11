# SQL Style

SQL is read far more often than it is written, and it is usually read during an incident. The goal of a house style is that a diff shows what changed and a plan can be matched to the query that produced it.

## Keyword and identifier case

**Keywords upper case, identifiers lower case.**

```sql
SELECT o.id, o.total_amount
FROM   sales.orders AS o
WHERE  o.status = 'pending'
```

The alternative - all lower case - is defensible and common in tooling-generated SQL. What is not defensible is mixing within a file. Whichever the codebase uses, match it.

Never quote identifiers. See [naming-and-conventions.md](naming-and-conventions.md).

## Layout

One clause per line, leading commas or trailing commas but not both:

```sql
SELECT
    c.id,
    c.name,
    count(o.id) AS order_count,
    coalesce(sum(o.total_amount), 0) AS lifetime_value
FROM customers AS c
LEFT JOIN orders AS o
       ON o.customer_id = c.id
      AND o.status <> 'cancelled'
WHERE c.created_at >= now() - interval '1 year'
GROUP BY c.id, c.name
HAVING count(o.id) > 0
ORDER BY lifetime_value DESC
LIMIT 50;
```

Notes on that shape:

- **Join conditions go in `ON`, filters go in `WHERE`** - and for an outer join this is a correctness rule, not style. Moving `o.status <> 'cancelled'` to `WHERE` turns the `LEFT JOIN` into an inner join. See [joins.md](joins.md).
- **`AS` for column aliases, and for table aliases.** It is optional for tables; including it makes a missing comma in the select list visible instead of silently becoming an alias.
- **Alias every table in a multi-table query**, with a meaningful abbreviation. `c` and `o` are fine; `t1` and `t2` are not.
- **Qualify every column in a multi-table query.** Unqualified columns break the day someone adds a same-named column to the other table, and they break silently, by resolving to the wrong one.

## Explicit joins only

```sql
-- No. Comma joins hide the join condition among the filters.
SELECT * FROM orders o, customers c WHERE o.customer_id = c.id AND c.active;

-- Yes.
SELECT * FROM orders AS o JOIN customers AS c ON c.id = o.customer_id WHERE c.active;
```

This is a readability rule, not a performance one. The planner treats both identically - a comma join is not a cartesian product that gets filtered afterwards, whatever older material claims. The reason to avoid it is that omitting a join condition in the comma form produces a silent cross join, whereas the `JOIN` form makes `ON` mandatory and the omission obvious.

## `SELECT *`

Never in application code, views, or anything stored.

- The column set changes under you when someone alters the table, and the application binds by position or by a mapper that then breaks.
- It transfers columns you discard. On a table with `text`, `jsonb` or `bytea` columns that is real bandwidth and real deserialisation cost, multiplied by every row and every call.
- It defeats index-only scans, because the index cannot cover every column.
- Inside a view it is worse: the view's column list is fixed at creation, so later table columns never appear, and the view now disagrees with the table.

`SELECT *` is fine in `psql` while exploring, and in `EXISTS` subqueries where the select list is never evaluated:

```sql
WHERE EXISTS (SELECT * FROM order_items oi WHERE oi.order_id = o.id)
```

`SELECT 1`, `SELECT *` and `SELECT NULL` are identical there. Do not let a linter push you into pretending otherwise.

`count(*)` is also an exception and is the correct form. It does not fetch any column; it counts rows. `count(1)` is not faster, and `count(column)` means something different - it skips NULLs. See [aggregation.md](aggregation.md).

## Parameters, never interpolation

```sql
-- Never
"SELECT * FROM users WHERE email = '" + email + "'"

-- Always
SELECT id, email FROM users WHERE email = $1
```

This is injection prevention first, but it also matters for performance: parameterised statements share a plan cache entry, while interpolated literals produce a distinct query text each time, flooding `pg_stat_statements` and defeating plan reuse.

The one thing parameters cannot be is an identifier. `ORDER BY $1` binds a constant, not a column, and silently sorts by that constant. Validate a sort column against an allow-list in the application and interpolate the validated value. See [application-integration.md](application-integration.md).

## CTEs over nested subqueries

A three-level nested subquery and a chain of CTEs are usually the same plan on PostgreSQL 12 and later, because a CTE referenced once with no side effects is inlined. Prefer the CTE chain for anything non-trivial: each step gets a name, and the query reads top to bottom.

```sql
WITH recent_orders AS (
    SELECT customer_id, total_amount
    FROM orders
    WHERE created_at >= date_trunc('month', now())
),
per_customer AS (
    SELECT customer_id, sum(total_amount) AS spent
    FROM recent_orders
    GROUP BY customer_id
)
SELECT c.name, pc.spent
FROM per_customer AS pc
JOIN customers AS c ON c.id = pc.customer_id
ORDER BY pc.spent DESC;
```

Know the two cases where a CTE is not free: it is materialised if referenced more than once, and it is always materialised if it modifies data or is marked `MATERIALIZED`. See [ctes.md](ctes.md).

## Comments

Comment the **why**, never the what. `-- join to customers` adds nothing next to `JOIN customers`.

```sql
-- Cancelled orders keep their rows for the finance export, so every
-- revenue query has to exclude them explicitly. See FIN-2231.
WHERE o.status <> 'cancelled'
```

Use `--` for line comments. Reserve `/* */` for temporarily disabling a block, and do not leave it in.

## Formatting migrations

Migrations are read under pressure, during an incident, by someone deciding whether to roll forward. Each statement gets its own line, terminated, with the lock level noted where it is not obvious:

```sql
-- ACCESS EXCLUSIVE, but metadata-only: no table rewrite on 11+.
ALTER TABLE orders ADD COLUMN discount_code text;

-- SHARE UPDATE EXCLUSIVE. Cannot run inside a transaction block.
CREATE INDEX CONCURRENTLY orders_discount_code_idx ON orders (discount_code);
```

See [migrations.md](migrations.md).

## Automated formatting

`pgFormatter` is the usual choice and can run in CI. `sqlfluff` supports a PostgreSQL dialect and lints as well as formats. Either is better than an argued style guide, because the argument stops.

Whatever you pick, apply it to the whole repository in one commit so the formatting change is not tangled with logic changes in later diffs.

## Version notes

Version-agnostic style. One behavioural dependency: the advice to prefer CTEs freely rests on the PostgreSQL 12 change that inlines a single-reference CTE. On 11 and earlier every CTE was an optimisation fence, which made the readability/performance trade-off real. Every supported version is 14 or later, so this is only relevant when reading old code written defensively against the fence.

## Gotchas

- Agent generates `SELECT *` in application code or in a view - the column set drifts, index-only scans are defeated, and a view freezes its column list at creation
- Agent moves an outer-join filter from `ON` to `WHERE` while reformatting - that converts a `LEFT JOIN` to an inner join and silently changes the result
- Agent leaves columns unqualified in a multi-table query - resolution silently changes when a same-named column is added elsewhere
- Agent interpolates a value into SQL instead of parameterising - injection, and a distinct plan-cache entry per call
- Agent parameterises an identifier, such as `ORDER BY $1` - that binds a constant and sorts every row identically
- Agent writes `count(1)` believing it is faster than `count(*)` - identical plan; and `count(column)` is different again because it skips NULLs
- Agent avoids `SELECT *` inside `EXISTS` - the select list is never evaluated there, so it costs nothing
- Agent claims comma joins cause a cartesian product that is filtered afterwards - the planner treats them identically to explicit joins; the real reason to avoid them is the silent cross join when a condition is missed
- Agent comments what the SQL does rather than why - restating the syntax adds nothing
- Agent reformats a whole file while making a one-line change - the real change disappears into the diff

## Related

- [naming-and-conventions.md](naming-and-conventions.md) · [joins.md](joins.md) · [ctes.md](ctes.md) · [aggregation.md](aggregation.md) · [migrations.md](migrations.md) · [application-integration.md](application-integration.md)
