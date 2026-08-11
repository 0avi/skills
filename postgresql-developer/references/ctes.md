# CTEs and Recursion

A common table expression names a subquery so a complex statement reads top to bottom. Recursive CTEs additionally give SQL iteration, which is how hierarchies and graphs are traversed.

## The PostgreSQL 12 change

Before 12, **every CTE was an optimisation fence**: materialised into a temporary result, always, with no predicate pushdown. That produced a decade of advice to avoid CTEs for performance, which is now wrong and still widely repeated.

From 12 onward, a CTE is **inlined** (treated like a subquery, with predicates pushed into it) when all three hold:

1. It is referenced **exactly once**.
2. It is not recursive.
3. It has no side effects - no `INSERT`/`UPDATE`/`DELETE`/`MERGE`.

Otherwise it is materialised. You can override either way:

```sql
WITH cte AS MATERIALIZED     (SELECT ...)   -- force materialisation
WITH cte AS NOT MATERIALIZED (SELECT ...)   -- force inlining
```

**Prefer CTEs freely for readability on any supported version.** All of 14 to 18 have the inlining behaviour.

### When to force materialisation

```sql
WITH expensive AS MATERIALIZED (
    SELECT id, slow_function(data) AS result FROM big_table WHERE ...
)
SELECT * FROM expensive a JOIN expensive b ON ...;
```

Two references means it is materialised anyway. `MATERIALIZED` is worth writing explicitly when:

- The CTE is referenced once but is expensive and the outer query would cause it to be recomputed through inlining in a bad plan shape.
- You need a stable snapshot of a volatile or non-deterministic expression, so both references see the same values.
- The CTE aggregates a large input down to a small one, and inlining would push the outer filter in and defeat the aggregation's selectivity.

### When to force inlining

```sql
WITH filtered AS NOT MATERIALIZED (SELECT * FROM huge_table)
SELECT * FROM filtered WHERE id = 42;
```

Referenced twice but you want the outer predicate pushed down. Without `NOT MATERIALIZED` this materialises the entire table before filtering.

Do not reach for either hint without comparing `EXPLAIN (ANALYZE, BUFFERS)` both ways.

## Data-modifying CTEs

`INSERT`, `UPDATE`, `DELETE` and `MERGE` can appear in a `WITH` clause, with `RETURNING` feeding the outer query.

```sql
-- Archive and delete in one statement
WITH moved AS (
    DELETE FROM orders WHERE placed_at < '2020-01-01' RETURNING *
)
INSERT INTO orders_archive SELECT * FROM moved;
```

Three semantics that are unlike anything else in SQL and cause real bugs:

**1. All sub-statements see the same snapshot.** A data-modifying CTE's changes are **not visible** to sibling CTEs or to the main query.

```sql
WITH updated AS (
    UPDATE accounts SET balance = balance - 100 WHERE id = 1 RETURNING balance
)
SELECT balance FROM accounts WHERE id = 1;   -- the OLD balance
```

To see the new value, read it from the CTE's `RETURNING`, not from the table.

**2. They execute even if never referenced.**

```sql
WITH logged AS (INSERT INTO audit (msg) VALUES ('ran') RETURNING id)
SELECT 1;                                    -- the INSERT still happens
```

A plain `SELECT` CTE that is not referenced is not evaluated. Data-modifying ones always are.

**3. Execution order between sibling CTEs is unspecified.** Two CTEs updating the same row produce an undefined outcome. Two `INSERT`s targeting the same unique key may or may not conflict. Do not write CTEs whose correctness depends on their order - chain them by reference instead:

```sql
WITH updated AS (
    UPDATE plays SET duration = 160 WHERE id = 12 RETURNING id, duration
),
checked AS (
    SELECT duration FROM updated        -- reads the CTE, so it is ordered after it
)
SELECT * FROM checked;
```

## Recursive CTEs

```sql
WITH RECURSIVE name AS (
    <non-recursive term>          -- runs once, seeds the working table
    UNION [ALL]
    <recursive term>              -- runs repeatedly, referencing `name`
)
SELECT ... FROM name;
```

`RECURSIVE` goes after `WITH`, once, even if only one of several CTEs is recursive. Despite the keyword it is iteration, not recursion.

The algorithm:

1. Evaluate the non-recursive term. Put the result in the working table and in the output.
2. While the working table is not empty: evaluate the recursive term with `name` bound to the **working table only** (not the accumulated result); with `UNION`, discard rows already produced; append to the output; the new rows become the working table.

That the recursive term sees only the previous iteration's rows, not everything so far, is the detail people get wrong when reasoning about these.

### Walking a hierarchy down

```sql
WITH RECURSIVE subtree AS (
    SELECT id, parent_id, name, 1 AS depth, ARRAY[id] AS path
    FROM   categories
    WHERE  id = 7
  UNION ALL
    SELECT c.id, c.parent_id, c.name, s.depth + 1, s.path || c.id
    FROM   categories c
    JOIN   subtree s ON c.parent_id = s.id
    WHERE  s.depth < 50            -- cycle guard
      AND  NOT c.id = ANY(s.path)  -- stronger cycle guard
)
SELECT * FROM subtree ORDER BY path;
```

### Walking up to the root

Swap the join direction:

```sql
    JOIN categories c ON c.id = s.parent_id
```

### Cycle protection is mandatory

An adjacency list has no constraint preventing `A -> B -> A`. A recursive CTE over a cycle **runs forever**, consuming memory until the server kills it. `UNION` instead of `UNION ALL` deduplicates and stops some cycles, but not all, and it costs a deduplication pass on every iteration.

Two reliable guards, both shown above: carry an array of visited ids and test `NOT id = ANY(path)`, and impose a depth limit.

PostgreSQL 14+ has explicit syntax:

```sql
WITH RECURSIVE subtree AS (...)
    CYCLE id SET is_cycle USING path
SELECT * FROM subtree WHERE NOT is_cycle;
```

`SEARCH BREADTH FIRST BY id SET ordercol` / `SEARCH DEPTH FIRST BY id SET ordercol` (14+) generates an ordering column so results come out in traversal order.

### Other uses

**Generate a series** without `generate_series`, or where each step depends on the last:

```sql
WITH RECURSIVE months AS (
    SELECT date_trunc('month', now()) - interval '11 months' AS m
  UNION ALL
    SELECT m + interval '1 month' FROM months WHERE m < date_trunc('month', now())
)
SELECT m FROM months;
```

For plain sequences `generate_series` is simpler and faster. See [dates-and-times.md](dates-and-times.md).

**Bill of materials** - exploding a component tree with quantity multiplication - and **graph traversal** with a shortest-path guard are the other standard uses.

## Performance

- A recursive CTE is always materialised and cannot be inlined.
- The recursive term runs once per iteration, so the join inside it must be indexed. Traversing an adjacency list needs an index on `parent_id`; without it every iteration is a sequential scan.
- Depth matters more than breadth: 20 iterations over 50 rows each is cheaper than 5000 iterations over 2.
- `EXPLAIN` shows a `Recursive Union` node with `CTE Scan` beneath. The `loops` count on the recursive term is the iteration count.

If a recursive query over a stable hierarchy is on a hot path, consider `ltree` or a closure table instead. See [relationships.md](relationships.md).

## Version notes

- **14+** - `CYCLE` and `SEARCH` clauses for recursive CTEs.
- **12+** - single-reference non-recursive CTEs without side effects are inlined; `MATERIALIZED` / `NOT MATERIALIZED` added. Every supported version has this, so the "CTEs are always an optimisation fence" advice is obsolete.
- **15+** - `MERGE` may appear in a data-modifying CTE.

The recursive algorithm, snapshot semantics and unspecified sibling ordering are identical across 14 to 18.

## Gotchas

- Agent avoids CTEs citing the optimisation fence - that ended in PostgreSQL 12; single-reference CTEs are inlined
- Agent assumes a CTE is always materialised and relies on it for a stable snapshot - write `MATERIALIZED` explicitly if you need that
- Agent reads a table in the main query expecting to see a sibling CTE's `UPDATE` - all parts see the same snapshot; read the `RETURNING` output instead
- Agent writes an unreferenced data-modifying CTE assuming it will not run - it always runs
- Agent writes two sibling CTEs that modify the same rows - execution order is unspecified and the result is undefined
- Agent writes a recursive CTE with no cycle guard - a cycle in the data loops until the server runs out of memory
- Agent relies on `UNION` alone to stop cycles - it deduplicates but does not reliably terminate all cycles, and costs a pass per iteration
- Agent assumes the recursive term sees all rows accumulated so far - it sees only the previous iteration's output
- Agent writes `RECURSIVE` on each CTE - it goes once, after `WITH`
- Agent traverses an adjacency list without an index on `parent_id` - every iteration becomes a sequential scan
- Agent uses `MATERIALIZED` or `NOT MATERIALIZED` without comparing plans - both can make things worse

## Related

- [relationships.md](relationships.md) · [sql-style.md](sql-style.md) · [joins.md](joins.md) · [window-functions.md](window-functions.md) · [upsert-and-merge.md](upsert-and-merge.md) · [explain.md](explain.md) · [dates-and-times.md](dates-and-times.md)
