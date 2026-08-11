# EXPLAIN

The plan is the only reliable statement of what PostgreSQL actually does. Reading it properly is the single highest-leverage database skill.

## The options

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

That is the default incantation. `ANALYZE` **executes the query** and reports real timings; without it, everything is an estimate.

| Option | Effect |
|---|---|
| `ANALYZE` | Executes and reports actual rows and time. **The query really runs** |
| `BUFFERS` | Shared/local/temp block hits, reads, writes. Automatic on 18 |
| `VERBOSE` | Output columns per node, schema-qualified names |
| `SETTINGS` | Non-default settings that affected planning |
| `WAL` | WAL generated. For write statements |
| `SERIALIZE` | Cost of converting the result for the wire (17+) |
| `MEMORY` | Planner memory use (17+) |
| `COSTS OFF` | Hides estimates. Compact, and used for stable test output |
| `FORMAT JSON` | Machine-readable |

**`EXPLAIN ANALYZE` on an `INSERT`, `UPDATE` or `DELETE` performs the write.** Wrap it:

```sql
BEGIN;
EXPLAIN (ANALYZE, BUFFERS) DELETE FROM orders WHERE id = 42;
ROLLBACK;
```

## Reading a plan

Plans are trees, printed with children indented under parents. **Read from the innermost, most-indented node outwards** - that is execution order.

```
Limit  (cost=1834.19..1834.24 rows=20 width=48) (actual time=42.311..42.318 rows=20 loops=1)
  Buffers: shared hit=1893 read=412
  ->  Sort  (cost=1834.19..1859.44 rows=10100 width=48) (actual time=42.309..42.312 rows=20 loops=1)
        Sort Key: o.placed_at DESC
        Sort Method: top-N heapsort  Memory: 28kB
        ->  Hash Join  (cost=331.00..1565.25 rows=10100 width=48) (actual time=8.201..38.417 rows=9847 loops=1)
              Hash Cond: (o.customer_id = c.id)
              ->  Seq Scan on orders o  (cost=0.00..1084.00 rows=10100 width=32) (actual time=0.011..12.402 rows=9847 loops=1)
                    Filter: (status = 'pending'::text)
                    Rows Removed by Filter: 40153
              ->  Hash  (cost=206.00..206.00 rows=10000 width=24) (actual time=8.150..8.151 rows=10000 loops=1)
                    ->  Seq Scan on customers c  (cost=0.00..206.00 rows=10000 width=24)
Planning Time: 0.284 ms
Execution Time: 42.401 ms
```

Per node:

- **`cost=start..total`** - arbitrary units, not milliseconds. The first is the cost to produce the *first* row, the second to produce all rows. The difference matters: a node with a low start cost suits a `LIMIT`.
- **`rows`** - estimated rows. **`actual ... rows=`** - real rows.
- **`width`** - estimated average row size in bytes.
- **`actual time=first..total`** - milliseconds to first row and to last, **per loop**.
- **`loops`** - how many times this node ran.

**Times and rows are per loop.** A node showing `actual time=0.5..0.6 rows=1 loops=8000` took roughly 4.8 seconds in total, not 0.6 ms. This is the most commonly misread number in any plan. Costs are cumulative and include children; actual time is too.

## The primary signal: estimate versus actual

Compare `rows=` against `actual ... rows=` at every node.

- **Within about 10x**: fine.
- **100x or more off**: the planner is choosing based on a fiction. Everything above that node is likely wrong.

```
->  Seq Scan on orders  (cost=0.00..1084.00 rows=1 width=32)
                        (actual time=0.011..12.402 rows=48920 loops=1)
```

Estimated 1, got 48,920. The planner picked a nested loop because it expected one row; it now runs 48,920 times.

**A large misestimate is a statistics problem, not an index problem.** Adding an index will not fix it. Go to [statistics-and-planner.md](statistics-and-planner.md).

## Node types

### Scans

| Node | Meaning |
|---|---|
| **Seq Scan** | Read every page. Correct for low selectivity or small tables |
| **Index Scan** | Walk the index, fetch each heap row. Random I/O per row |
| **Index Only Scan** | Answered from the index. Watch `Heap Fetches` |
| **Bitmap Index Scan** + **Bitmap Heap Scan** | Build a bitmap of locations, then read the heap in physical order |
| **CTE Scan** | Reading a materialised CTE |
| **Function Scan** | A set-returning function |
| **Values Scan** | An inline `VALUES` list |

A `Seq Scan` is not automatically bad. It is bad when `Rows Removed by Filter` is large relative to rows returned - reading 50,000 rows to return 20 is what an index is for.

`Heap Fetches` on an Index Only Scan should be near zero. High means a stale visibility map, which means vacuum. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

`Heap Blocks: exact=N lossy=M` on a Bitmap Heap Scan: a large `lossy` count means the bitmap outgrew `work_mem`, so whole pages are rechecked row by row.

### Joins

| Node | Watch for |
|---|---|
| **Nested Loop** | High `loops` on the inner side with no index beneath it. Usually a misestimate |
| **Hash Join** | `Batches: > 1` means the hash spilled to disk; `work_mem` is too small |
| **Merge Join** | An expensive `Sort` feeding it that an index could remove |

See [joins.md](joins.md).

### Other

| Node | Watch for |
|---|---|
| **Sort** | `Sort Method: external merge Disk: NNNkB` means it spilled. `top-N heapsort` is the efficient `LIMIT` form |
| **HashAggregate** | `Disk Usage` means it spilled |
| **GroupAggregate** | Requires sorted input; an index may remove the sort |
| **Materialize** | Caching a subplan's result for repeated scans |
| **Memoize** (14+) | Caching inner-side results in a nested loop. `Hits`/`Misses` show effectiveness |
| **Gather** / **Gather Merge** | Parallel query. `Workers Launched` may be fewer than planned |
| **Incremental Sort** | Input is partly sorted; only sorting within groups |
| **Subquery Scan** | Often a sign a subquery could not be flattened |

## Buffers

`BUFFERS` is what turns a plan from a guess into a diagnosis. It is automatic on 18 and must be requested on 14 to 17.

```
Buffers: shared hit=1893 read=412 dirtied=12 written=0
```

- **`hit`** - found in shared buffers. Fast.
- **`read`** - read from outside shared buffers. May be the OS page cache or actual disk; PostgreSQL cannot tell them apart.
- **`dirtied`** - pages modified.
- **`written`** - pages flushed by this query.
- **`temp read/written`** - **spill to disk.** This is the number to look for. Non-zero means a sort, hash or materialise exceeded `work_mem`.

A block is 8 kB, so `read=412` is about 3.2 MB.

Buffers make it possible to distinguish "slow because it read a lot" from "slow because it computed a lot". Two plans with identical timings and wildly different buffer counts behave completely differently under cache pressure and on a bigger dataset.

## The rest

```
Planning Time: 0.284 ms
Execution Time: 42.401 ms
```

Planning time exceeding execution time means either a trivially fast query (fine), or a very complex one where planning is genuinely expensive - many partitions, many indexes, many joins. Consider a prepared statement so the plan is reused.

`JIT:` appears when just-in-time compilation kicked in. On short queries JIT compilation can cost more than it saves; if the JIT time is a large fraction of execution time, lower `jit_above_cost` or disable it for that workload. PostgreSQL 19 disables JIT by default for this reason.

## A method

1. **Get the real plan.** `EXPLAIN (ANALYZE, BUFFERS)` on production-like data. A plan over 100 rows tells you nothing about 100 million.
2. **Find the expensive node.** Highest `actual total time` minus children's, remembering to multiply by `loops`.
3. **Check the estimate at that node.** Badly wrong? Statistics problem. Go fix that first.
4. **Check the buffers.** Large `read`? I/O bound. Non-zero `temp`? `work_mem` too small.
5. **Check the scan.** `Seq Scan` with a large `Rows Removed by Filter`? Index candidate.
6. **Change one thing. Re-plan. Compare.**

Run it more than once. The first execution may be reading cold pages, and its timings will not be representative.

## Tools

Pasting a plan into a visualiser is genuinely worth it for anything non-trivial - they compute per-node exclusive time and multiply by `loops` for you, which is exactly what people get wrong by hand. `explain.depesz.com` and `explain.dalibo.com` both do this. Note that both are third-party services, so treat the plan text as data leaving your organisation: query text, table names and sometimes literal values are included. Sanitise or self-host if that matters.

`auto_explain` logs plans of slow queries automatically, which is the only way to catch a plan that is bad only in production, only sometimes:

```sql
LOAD 'auto_explain';
SET auto_explain.log_min_duration = '500ms';
SET auto_explain.log_analyze = on;
SET auto_explain.log_buffers = on;
```

`log_analyze` adds real overhead to every query, not just logged ones. Enable it deliberately, and consider `auto_explain.sample_rate`. See [performance-triage.md](performance-triage.md).

## Generic versus custom plans

A prepared statement or a PL/pgSQL query may switch to a **generic plan** - one planned without knowing the parameter values - after five executions. That is normally good (planning is skipped) and occasionally terrible, when the values vary enormously in selectivity.

```sql
SET plan_cache_mode = force_custom_plan;   -- or force_generic_plan
```

A query that is fast in `psql` and slow from the application, with the same parameters, is very often this. `EXPLAIN (ANALYZE)` in `psql` will not reproduce it, because `psql` plans with the literal values. See [application-integration.md](application-integration.md).

## Version notes

- **18** - `BUFFERS` is included in `EXPLAIN ANALYZE` by default; index lookups per index scan node are reported; fractional row counts are shown; disabled nodes are indicated.
- **17+** - `SERIALIZE` and `MEMORY` options.
- **16+** - `Gather` reports per-worker detail more usefully.
- **14+** - `Memoize` nodes appear in nested-loop plans.

Plan structure, the per-loop convention and cost units are identical across 14 to 18. Costs are not comparable between servers with different `random_page_cost` or hardware.

## Gotchas

- Agent reads `actual time` without multiplying by `loops` - a node at 0.6 ms with 8000 loops took nearly 5 seconds
- Agent treats `cost` as milliseconds - the units are arbitrary and only comparable within one plan on one server
- Agent runs `EXPLAIN` without `ANALYZE` and reasons about performance - those are estimates, and the estimate being wrong is usually the problem
- Agent runs `EXPLAIN ANALYZE` on an `INSERT`/`UPDATE`/`DELETE` outside a transaction - the write happens
- Agent ignores the estimate-versus-actual gap and adds an index - a 100x misestimate is a statistics problem and the index will not fix it
- Agent concludes a `Seq Scan` is the problem without checking `Rows Removed by Filter` - for low selectivity it is the right plan
- Agent ignores `Heap Fetches` on an index-only scan - that is a vacuum problem
- Agent ignores `temp read/written` or `Disk:` in a sort - the query is spilling past `work_mem`
- Agent omits `BUFFERS` on 14 to 17 - cannot then distinguish I/O-bound from CPU-bound
- Agent explains a query on a development dataset - plans change qualitatively with data volume
- Agent uses the first `EXPLAIN ANALYZE` run - cold caches make the timings unrepresentative
- Agent cannot reproduce an application's slow query in `psql` - `psql` plans with literals; the application may be on a generic plan
- Agent pastes a production plan into a public visualiser without considering that table names and literals leave the organisation

## Related

- [statistics-and-planner.md](statistics-and-planner.md) · [query-optimisation.md](query-optimisation.md) · [performance-triage.md](performance-triage.md) · [indexing-fundamentals.md](indexing-fundamentals.md) · [joins.md](joins.md) · [configuration.md](configuration.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [application-integration.md](application-integration.md)
