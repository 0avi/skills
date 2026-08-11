# Pagination

`LIMIT ... OFFSET` is the obvious approach and it is wrong in two independent ways: it degrades linearly with depth, and it silently returns duplicate and missing rows when the data changes underneath.

## Why `OFFSET` degrades

```sql
SELECT * FROM orders ORDER BY placed_at DESC LIMIT 20 OFFSET 100000;
```

PostgreSQL must produce and discard 100,000 rows before returning 20. There is no shortcut - the offset is defined in terms of the result set, so the rows must be materialised to be counted. Page 1 is instant; page 5000 reads 100,020 rows.

The plan shows it: `Limit` above a node whose `actual rows` is the offset plus the limit.

## Why `OFFSET` is also incorrect

This is the more serious problem, and it is silent.

Page 1 returns rows 1 to 20. Before the user clicks "next", a new order is inserted at the top. Page 2 now returns rows 21 to 40 **of the new ordering** - so the row that was number 20 is now number 21 and appears again. Delete a row instead, and a row is skipped entirely.

Any paginated list over data that changes has this. Users see duplicates; exports miss records.

## Keyset pagination

Remember where the last page ended and filter from there.

```sql
-- First page
SELECT id, placed_at, total
FROM   orders
ORDER  BY placed_at DESC, id DESC
LIMIT  20;

-- Subsequent pages: pass the last row's (placed_at, id)
SELECT id, placed_at, total
FROM   orders
WHERE  (placed_at, id) < ($1, $2)
ORDER  BY placed_at DESC, id DESC
LIMIT  20;
```

`(placed_at, id) < ($1, $2)` is **row comparison**, not shorthand for two `AND`ed comparisons. It compares lexicographically: first `placed_at`, and only where equal, `id`. PostgreSQL can drive an index scan directly from it.

The expanded form is equivalent but longer and easier to get wrong:

```sql
WHERE placed_at < $1 OR (placed_at = $1 AND id < $2)
```

Prefer the row-comparison form. It is clearer and reliably uses the index.

Every page costs the same, and rows inserted above the cursor do not shift the window.

### Three requirements

**1. The sort must be unique.** Append a tiebreaker - normally the primary key. `ORDER BY placed_at DESC` alone is ambiguous when two orders share a timestamp, and rows at the boundary will be duplicated or skipped.

**2. A matching index.** The index must match the `ORDER BY` columns, in order, with matching direction:

```sql
CREATE INDEX orders_placed_at_id_desc_idx ON orders (placed_at DESC, id DESC);
```

An index on `(placed_at, id)` ascending also serves this, because PostgreSQL can scan an index backwards. What does not work is a **mixed** direction - `ORDER BY placed_at DESC, id ASC` needs an index declared exactly that way, because neither a forward nor a backward scan of `(placed_at, id)` produces it.

**3. Directions must be consistent** across every column in the row comparison. `(a, b) < ($1, $2)` implies both descending. A mixed sort cannot be written as a single row comparison and needs the expanded `OR` form.

### Paginating backwards

Reverse the comparison and the sort, then reverse the result in the application:

```sql
SELECT * FROM (
    SELECT id, placed_at, total
    FROM   orders
    WHERE  (placed_at, id) > ($1, $2)
    ORDER  BY placed_at ASC, id ASC
    LIMIT  20
) t ORDER BY placed_at DESC, id DESC;
```

## Cursor encoding

Do not expose raw column values - they leak the sort key and let a client craft arbitrary positions. Encode them:

```
base64({"placed_at":"2026-03-14T09:00:00Z","id":48213})
```

Sign or encrypt it if it must not be tampered with. Include the sort specification in the cursor so a client cannot combine a cursor from one sort order with a different `ORDER BY`, which returns nonsense.

## What keyset cannot do

**Jump to page 47.** There is no cursor for a page the user has not visited. This is a genuine product constraint, not an implementation gap.

If arbitrary page numbers are required, the honest options are:

- Change the interface to infinite scroll or next/previous, which is what most products do and what keyset supports natively.
- Keep `OFFSET`, cap the maximum offset (page 500 is nobody's real need), and accept the drift.
- Precompute page boundaries into a table for a dataset that changes rarely.

## Total counts

`SELECT count(*)` for "showing 1-20 of 4,391" costs a full scan or index-only scan of everything matching. On a large filtered set this is often more expensive than the page query itself.

Options, in order of preference:

**Do not show a total.** "Next" is enabled when the page query returns `LIMIT + 1` rows. Most interfaces do not need the number.

**Estimate.** Ask the planner:

```sql
EXPLAIN (FORMAT JSON) SELECT * FROM orders WHERE status = 'pending';
```

Read `Plan.Plan Rows`. Accurate enough for "about 4,000 results", and costs a plan rather than a scan.

**Count up to a limit.** "1000+ results":

```sql
SELECT count(*) FROM (SELECT 1 FROM orders WHERE status='pending' LIMIT 1001) t;
```

**Cache it**, refreshed periodically, if an exact number is genuinely required.

## Pagination with `DISTINCT` or `GROUP BY`

Keyset pagination requires the cursor columns to be in the output and to be unique per row. With `GROUP BY`, the grouping key serves:

```sql
SELECT customer_id, sum(total) AS spent
FROM   orders
GROUP  BY customer_id
HAVING customer_id > $1
ORDER  BY customer_id
LIMIT  20;
```

Paginating by an **aggregate** value (`ORDER BY spent DESC`) is not reliably keyset-able, because `spent` is not unique and can change between pages. Materialise the ranking into a table or materialised view, then paginate that by its own key. See [views.md](views.md).

## Version notes

- **14+** - incremental sort can help when an index covers a prefix of the `ORDER BY`, reducing but not eliminating the cost of a partially-matching index.
- **18** - skip scan may let a composite index serve a keyset query whose leading column is unconstrained, if that column has low cardinality. Do not design around it.

Row comparison, backward index scans and `LIMIT`/`OFFSET` semantics are identical across 14 to 18.

## Gotchas

- Agent uses `LIMIT ... OFFSET` for deep pagination - cost grows linearly with the offset
- Agent uses `OFFSET` on data that changes and does not mention that rows will be duplicated and skipped - this is silent and affects exports as well as UIs
- Agent writes keyset pagination without a unique tiebreaker - rows at a tie boundary are duplicated or skipped
- Agent expands the row comparison into `AND`ed conditions incorrectly - `(a,b) < ($1,$2)` is lexicographic, not `a < $1 AND b < $2`
- Agent writes a keyset query with mixed sort directions and a single row comparison - that is not expressible; use the expanded `OR` form
- Agent creates an index whose direction does not match a mixed-direction `ORDER BY` - a backward scan cannot produce it
- Agent exposes raw cursor values - leaks the sort key and lets clients craft positions
- Agent lets a cursor be used with a different `ORDER BY` - encode the sort in the cursor
- Agent adds `count(*)` for a total on every page - often more expensive than the page itself; estimate or omit
- Agent offers keyset pagination where the product requires jumping to an arbitrary page - state the constraint rather than silently changing the behaviour
- Agent paginates by a non-unique aggregate value - the ordering is unstable between pages

## Related

- [composite-and-covering-indexes.md](composite-and-covering-indexes.md) · [indexing-fundamentals.md](indexing-fundamentals.md) · [aggregation.md](aggregation.md) · [window-functions.md](window-functions.md) · [views.md](views.md) · [explain.md](explain.md) · [null-handling.md](null-handling.md)
