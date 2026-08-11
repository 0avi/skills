# Query Optimisation

A method, the rewrites that reliably help, and the folklore that does not.

## The method

1. **Identify the query.** Not "the app is slow" - a specific statement, from `pg_stat_statements` ordered by total time, not by mean. See [performance-triage.md](performance-triage.md).
2. **Get the plan.** `EXPLAIN (ANALYZE, BUFFERS)`, on production-like data volumes.
3. **Find the node that costs.** Highest exclusive time, remembering to multiply by `loops`.
4. **Check the estimate there.** Off by 100x or more? That is a statistics problem and nothing else will help until it is fixed. See [statistics-and-planner.md](statistics-and-planner.md).
5. **Change one thing.** Re-plan. Compare.
6. **Verify at scale**, and verify the result is still correct.

Skipping straight to step 5 is how databases accumulate indexes that help nothing.

## Where the time actually goes

Before rewriting anything, work out which of these it is:

| Symptom in the plan | Cause |
|---|---|
| `Seq Scan`, large `Rows Removed by Filter` | Missing or unusable index |
| Estimate far from actual | Statistics, correlated columns, or an unindexed expression |
| `Buffers: read` large | I/O bound. Insufficient cache, or reading more than needed |
| `temp read/written`, `Disk:` in a sort | `work_mem` too small for this query |
| Nested Loop with high `loops` | Misestimate on the outer side, or no index on the inner |
| `Heap Fetches` high on an index-only scan | Stale visibility map. Vacuum |
| Planning time > execution time | Too many partitions or indexes; consider a prepared statement |
| Fast in psql, slow from the app | Generic plan, or a type mismatch on a parameter |
| Fast alone, slow under load | Locking or pool exhaustion, not the plan |

That last row matters. A query that is fine in isolation and terrible in production is usually not a query problem. See [locking.md](locking.md) and [connections-and-pooling.md](connections-and-pooling.md).

## Sargability

A predicate is sargable if an index can be used to satisfy it. The rule: **leave the column bare on one side of the operator.**

```sql
-- Not sargable                          -- Sargable
WHERE lower(email) = $1                  WHERE email = $1  (or index lower(email))
WHERE created_at::date = '2026-03-14'    WHERE created_at >= '2026-03-14'
                                           AND created_at <  '2026-03-15'
WHERE extract(year FROM created_at)=2026 WHERE created_at >= '2026-01-01'
                                           AND created_at <  '2027-01-01'
WHERE price * 1.2 > 100                  WHERE price > 100 / 1.2
WHERE amount + fee > 1000                (index the expression, or store the total)
WHERE id::text = $1                      WHERE id = $1::bigint
WHERE name LIKE '%smith%'                (trigram index)
WHERE coalesce(status,'x') = 'active'    WHERE status = 'active' (make it NOT NULL)
```

If the expression form is genuinely required, index the expression - and then the query must reproduce it exactly. See [partial-and-expression-indexes.md](partial-and-expression-indexes.md).

Type mismatches are the sneakiest of these, because nothing looks wrong. A `bigint` column compared to a string parameter forces a cast on the column and disables the index. This is common with ORMs and with `uuid` columns bound as strings. See [application-integration.md](application-integration.md).

## Rewrites that reliably help

**`NOT IN` to `NOT EXISTS`.** Correctness first - `NOT IN` returns nothing if the subquery yields a NULL - and usually a better plan, because `NOT EXISTS` becomes an anti-join. See [null-handling.md](null-handling.md).

**`OR` across different columns to `UNION ALL`.** A single index cannot serve both sides of an `OR` on different columns; the planner often falls back to a sequential scan.

```sql
-- Often a Seq Scan
WHERE email = $1 OR phone = $1

-- Two index scans
SELECT * FROM users WHERE email = $1
UNION ALL
SELECT * FROM users WHERE phone = $1 AND email IS DISTINCT FROM $1;
```

Sometimes the planner manages a `BitmapOr` and the rewrite is unnecessary. Check the plan first.

**`OFFSET` to keyset pagination.** See [pagination.md](pagination.md).

**Aggregate before joining**, when the join fans out. Aggregating in a CTE and then joining avoids both the row multiplication and the wasted work. This is also the fix for inflated aggregates. See [joins.md](joins.md).

**Window function to `LATERAL`** for top-N per group. A window function ranks everything then discards; `LATERAL` with a matching index stops after N rows per group.

**`DISTINCT` to `EXISTS`.** `SELECT DISTINCT c.* FROM customers c JOIN orders o ...` deduplicates after generating duplicates. `WHERE EXISTS (...)` never generates them.

**Push `LIMIT` inwards.** If only 20 rows are needed, make sure the plan knows before it sorts a million. A `top-N heapsort` in the plan means it did.

**Split a query the planner cannot handle.** Beyond `join_collapse_limit` (default 8) tables, the planner stops exploring all join orders. Materialising an intermediate result into a temporary table is occasionally the pragmatic answer for a large reporting query.

## Folklore that is wrong

**"Comma joins cause a cartesian product that is then filtered."** They do not. `FROM a, b WHERE a.id = b.a_id` plans identically to an inner join. Avoid comma joins for readability, not performance. See [sql-style.md](sql-style.md).

**"Filter in a subquery before joining, to reduce rows."**

```sql
-- No faster than the plain join. The planner flattens this.
FROM (SELECT * FROM users WHERE created_at > $1) u JOIN orders o ON ...
```

The planner pushes predicates down on its own. This rewrite adds noise and no benefit.

**"`count(1)` is faster than `count(*)`."** Identical. `count(*)` fetches no columns.

**"Smaller data types are always faster."** Row alignment means a `smallint` beside a `bigint` usually occupies the same space an `integer` would. Type choice matters for correctness far more than for speed.

**"CTEs are always an optimisation fence."** True before PostgreSQL 12, false on every supported version. See [ctes.md](ctes.md).

**"`SELECT *` is fine, the planner only reads what it needs."** It does not. Every column is fetched, de-TOASTed, serialised and transferred. It also prevents index-only scans.

**"Adding an index can only help reads."** It also slows every write to the table, and prevents HOT updates when the indexed column changes.

**"`UNION` is like `UNION ALL`."** `UNION` deduplicates, which requires a sort or hash over the whole result. Use `UNION ALL` unless duplicates are actually possible and unwanted.

## `work_mem`

Sorts, hashes and hash joins that exceed `work_mem` spill to disk, often an order of magnitude slower.

```
Sort Method: external merge  Disk: 84320kB
Buckets: 1024  Batches: 8  Memory Usage: 4097kB
```

`Batches: > 1` means the hash spilled.

`work_mem` is allocated **per sort or hash node, per parallel worker** - not per query and certainly not per server. A query with three sorts and four workers can use twelve times the setting. Raising it globally is how servers run out of memory.

Raise it for the specific query or role:

```sql
SET LOCAL work_mem = '256MB';   -- inside the transaction that needs it
ALTER ROLE reporting SET work_mem = '512MB';
```

See [configuration.md](configuration.md).

## When the planner is wrong

Occasionally the plan is bad and the statistics are right. Options, in order:

1. **Extended statistics** for correlated columns. This solves most genuine misestimates. See [statistics-and-planner.md](statistics-and-planner.md).
2. **Raise `default_statistics_target`** for a specific column with a skewed distribution.
3. **Rewrite** to give the planner a shape it handles better - `LATERAL`, a materialised CTE, or splitting the query.
4. **`SET LOCAL enable_seqscan = off`** and friends, scoped to one transaction. A blunt instrument and a last resort. `enable_*` settings are not hints - they add a large constant to that node type's cost rather than forbidding it.
5. `pg_hint_plan`, an extension providing real hints. Widely used in some shops, and it freezes decisions that should adapt as data changes.

**Never leave `enable_*` off globally.** If turning one off makes a query faster, you have learned the cost model is wrong for your hardware - which usually means `random_page_cost` is still at its spinning-disk default of 4.0.

## Verify at scale

An optimisation validated on 10,000 rows can be worthless or harmful at 10 million. Plans change qualitatively as data grows: a nested loop that is optimal for 100 outer rows is catastrophic for 100,000, and the planner switches from index scan to sequential scan as selectivity drops.

Test with representative volumes and a representative distribution. Uniformly generated test data will not reproduce the skew that causes real misestimates.

## Version notes

- **18** - skip scan makes some previously unusable composite indexes viable; `EXPLAIN ANALYZE` includes buffers by default; asynchronous I/O improves sequential and bitmap heap scans.
- **17+** - substantially faster vacuum, which indirectly improves index-only scan rates.
- **16+** - more parallelism, including `FULL` hash joins.
- **14+** - `Memoize` caches inner results in nested loops, which changes when a nested loop is a good plan.

Sargability rules, `work_mem` semantics and the `enable_*` mechanism are identical across 14 to 18.

## Gotchas

- Agent optimises without a plan - the fix usually addresses something that was not the cost
- Agent adds an index when the estimate is off by 100x - that is a statistics problem
- Agent wraps a column in a function in `WHERE` - defeats the index
- Agent compares columns of different types - the implicit cast disables the index, and nothing looks wrong
- Agent rewrites a join as a filtered subquery expecting a gain - the planner already pushes predicates down
- Agent claims comma joins produce a cartesian product - they plan identically to explicit joins
- Agent uses `count(1)` for speed - identical to `count(*)`
- Agent uses `UNION` where `UNION ALL` is correct - forces a deduplication pass over the whole result
- Agent raises `work_mem` globally - it is per node per worker, so the total is a large multiple
- Agent leaves `enable_seqscan = off` in place - it distorts every plan and hides the real problem
- Agent leaves `random_page_cost` at 4.0 on SSD - biases every plan against index scans
- Agent tests an optimisation on a small dataset - plans change qualitatively with volume
- Agent generates uniformly distributed test data - real misestimates come from skew, which uniform data does not have
- Agent optimises a query that is slow only under load - that is locking or pooling, not the plan

## Related

- [explain.md](explain.md) · [statistics-and-planner.md](statistics-and-planner.md) · [indexing-fundamentals.md](indexing-fundamentals.md) · [performance-triage.md](performance-triage.md) · [joins.md](joins.md) · [null-handling.md](null-handling.md) · [pagination.md](pagination.md) · [configuration.md](configuration.md) · [locking.md](locking.md)
