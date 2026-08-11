# Views

A view is a stored query. A materialised view is a stored **result**. They solve different problems and are routinely confused.

## Views

```sql
CREATE VIEW active_customers AS
SELECT id, name, email
FROM   customers
WHERE  deleted_at IS NULL;
```

No storage, no staleness. The query is expanded into whatever references it, and the planner optimises the combined statement - so a view is not a barrier and predicates push through it:

```sql
SELECT * FROM active_customers WHERE id = 42;
-- plans as: SELECT ... FROM customers WHERE deleted_at IS NULL AND id = 42
```

Good uses:

- **A stable interface** over a schema you intend to change. Rename a column in the table, keep the old name in the view, migrate consumers gradually.
- **Encapsulating a filter that must never be forgotten** - the soft-delete case above. Grant on the view, revoke on the table.
- **Naming a complex join** that appears in many queries.
- **A security boundary**, exposing a subset of columns or rows.

### `SELECT *` in a view is a trap

The column list is resolved and **frozen at creation**. Add a column to the table and the view will never show it. Worse, `CREATE OR REPLACE VIEW` cannot change or reorder existing columns, so fixing it means `DROP` and recreate - which cascades to every dependent view and every grant.

Always list columns explicitly.

### Updatable views

A **simple** view - one table, no aggregates, no `DISTINCT`, no `GROUP BY`, no set operations, no window functions - is automatically updatable.

```sql
INSERT INTO active_customers (name, email) VALUES ('A', 'a@example.com');
```

Note that without `WITH CHECK OPTION`, you can insert a row through the view that the view itself will not show:

```sql
CREATE VIEW active_customers AS
SELECT id, name, email FROM customers WHERE deleted_at IS NULL
WITH CASCADED CHECK OPTION;
```

Now an insert or update that would produce an invisible row is rejected. `LOCAL` checks only this view's condition; `CASCADED` also checks underlying views.

For complex views, `INSTEAD OF` triggers make them writable. That is a lot of machinery and usually a sign that the application should write to the tables.

### `security_invoker` (15+)

By default a view executes with the **owner's** privileges. That is why a view can expose a subset of a table the caller cannot read - the classic use.

It is also a hazard with RLS: policies on the underlying table are evaluated as the **view owner**, so a view over an RLS-protected table can leak every tenant's rows.

```sql
CREATE VIEW my_orders WITH (security_invoker = true) AS
SELECT * FROM orders;
```

With `security_invoker`, permissions and RLS policies are evaluated as the **caller**. **Any view over an RLS-protected table should be `security_invoker`** unless you have deliberately decided otherwise. On 14 and earlier this option does not exist, and the only safe approach is to apply RLS to the view's underlying access path by other means, or to avoid the view. See [row-level-security.md](row-level-security.md).

### `security_barrier`

A separate mechanism for a separate leak. Normally the planner may push a user-supplied `WHERE` into a view, and a cheap, non-leakproof function in that predicate can run **before** the view's own filter - leaking values through an error message or a log:

```sql
SELECT * FROM active_customers WHERE leaky_function(email);
```

```sql
CREATE VIEW active_customers WITH (security_barrier = true) AS ...
```

The barrier prevents that reordering, at a performance cost - predicates no longer push through freely. Use it on views whose purpose is to restrict which rows a caller can see. `security_invoker` and `security_barrier` are orthogonal; a security view over an RLS table often wants both.

### Dependency rigidity

You cannot drop or retype a column that a view depends on:

```
ERROR: cannot alter type of a column used by a view or rule
```

Deep view chains make schema migration genuinely painful - you must drop dependents, alter, and recreate them in order, restoring grants. Keep view chains shallow; two levels is plenty. See [migrations.md](migrations.md).

## Materialised views

```sql
CREATE MATERIALIZED VIEW monthly_revenue AS
SELECT date_trunc('month', placed_at, 'Europe/London') AS month,
       count(*)     AS order_count,
       sum(total)   AS revenue
FROM   orders
GROUP  BY 1
WITH DATA;
```

The result is computed once and stored. Queries read the stored rows. **It never refreshes itself.**

Use for an expensive aggregate over data that changes more slowly than it is read: dashboards, reports, leaderboards, precomputed search corpora.

### Refreshing

```sql
REFRESH MATERIALIZED VIEW monthly_revenue;               -- ACCESS EXCLUSIVE: blocks all readers
REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_revenue;  -- readers continue
```

**`CONCURRENTLY` requires a unique index** on the view:

```sql
CREATE UNIQUE INDEX monthly_revenue_month_key ON monthly_revenue (month);
```

Without it you get an error, and the plain refresh takes an `ACCESS EXCLUSIVE` lock for its entire duration - which on a heavy view is an outage of that dashboard.

`CONCURRENTLY` is slower overall (it computes the new result then diffs it against the old) and cannot be used on an empty view, but it is what you want in production.

### Indexes

A materialised view is a real table and can be indexed:

```sql
CREATE INDEX monthly_revenue_revenue_idx ON monthly_revenue (revenue DESC);
```

Indexes survive `REFRESH` and are maintained during it.

### Scheduling the refresh

Nothing built in. Options:

- **`pg_cron`** - runs inside the database, simple, and available on most managed platforms.
- **An external scheduler** - more visible, and can alert on failure.
- **A trigger on the source table** - almost always wrong. It puts the refresh cost in the write path and serialises writers behind it.

Whatever you choose, expose the staleness. A dashboard showing numbers from a refresh that failed six hours ago is worse than one showing an error:

```sql
ALTER MATERIALIZED VIEW monthly_revenue OWNER TO app_owner;
-- and record the refresh time
CREATE TABLE mv_refresh_log (view_name text PRIMARY KEY, refreshed_at timestamptz NOT NULL);
```

### `WITH NO DATA`

`CREATE MATERIALIZED VIEW ... WITH NO DATA` creates it unpopulated and unreadable until refreshed. Useful in migrations, where you want the DDL to be fast and the population to happen separately.

## Choosing

| Need | Use |
|---|---|
| Stable interface over a changing schema | View |
| A filter that must never be forgotten | View, plus grants |
| Row or column security | View with `security_invoker` and `security_barrier`, or RLS |
| Expensive aggregate, read often, changes slowly | Materialised view |
| Must always be current | View, or a trigger-maintained summary table |
| Refresh must be incremental | A summary table with triggers, or a rollup job. PostgreSQL has no incremental refresh |

**PostgreSQL has no incremental materialised view refresh.** Every refresh recomputes the whole query. For a view over a large table refreshed frequently, that is the constraint that decides the design - at which point a real summary table updated by triggers or by a periodic job over a watermark is the answer, despite being more work. See [normalisation.md](normalisation.md).

## Version notes

- **15+** - `security_invoker` views. This is the correct default for any view over an RLS-protected table, and its absence on 14 is a genuine security consideration.
- **16+** - `REFRESH MATERIALIZED VIEW CONCURRENTLY` performance improvements.
- **14+** - materialised views can be accessed in parallel plans.

`security_barrier`, `WITH CHECK OPTION`, automatic updatability rules and the absence of incremental refresh are identical across 14 to 18.

## Gotchas

- Agent uses `SELECT *` in a view - the column list is frozen at creation, and fixing it requires dropping every dependent object
- Agent creates a view over an RLS-protected table without `security_invoker` - policies are evaluated as the view owner, which can expose every tenant's rows
- Agent expects a materialised view to refresh itself - it never does
- Agent uses `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY` in production - `ACCESS EXCLUSIVE` blocks every reader for the whole refresh
- Agent uses `CONCURRENTLY` without creating a unique index first - it errors
- Agent refreshes a materialised view from a trigger on the source table - puts the full recomputation in the write path
- Agent presents materialised-view data without exposing its age - a failed refresh silently serves stale numbers
- Agent expects incremental refresh - PostgreSQL recomputes the entire query every time
- Agent creates an updatable view without `WITH CHECK OPTION` - rows can be inserted that the view will not show
- Agent builds deep chains of views - a column type change then requires dropping and recreating the whole chain with its grants
- Agent adds `security_barrier` reflexively - it blocks predicate pushdown and can badly slow a view
- Agent uses a materialised view where the data must be current - it is stale between refreshes by definition

## Related

- [row-level-security.md](row-level-security.md) · [normalisation.md](normalisation.md) · [aggregation.md](aggregation.md) · [migrations.md](migrations.md) · [security-and-roles.md](security-and-roles.md) · [temporal-and-history.md](temporal-and-history.md) · [extensions.md](extensions.md)
