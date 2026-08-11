# MVCC and Vacuum

Every performance problem that appears gradually over weeks traces back to this.

## Tuple versioning

PostgreSQL never updates a row in place. An `UPDATE` writes a **new version** of the row and marks the old one dead; a `DELETE` only marks it dead. Each version carries `xmin` (the transaction that created it) and `xmax` (the transaction that deleted it, if any).

A transaction sees a version if `xmin` is committed and visible to its snapshot, and `xmax` is either unset or not visible. That is the whole of MVCC.

Consequences that matter:

- **Readers never block writers; writers never block readers.** The reason to prefer PostgreSQL's concurrency model.
- **An `UPDATE` costs about as much as a `DELETE` plus an `INSERT`**, including writing new index entries.
- **Dead tuples accumulate** and must be reclaimed.
- **A table can be far larger on disk than its live data.** That is bloat.

## Bloat

```sql
SELECT relname,
       n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       last_autovacuum, last_autoanalyze
FROM   pg_stat_user_tables
WHERE  n_dead_tup > 1000
ORDER  BY n_dead_tup DESC;
```

Above 20% dead is worth investigating. Bloat costs on every axis: more pages to scan, worse cache hit rates, larger indexes, longer vacuums, and degraded index-only scans.

For a measurement rather than an estimate:

```sql
CREATE EXTENSION IF NOT EXISTS pgstattuple;
SELECT * FROM pgstattuple('orders');
```

The commonly circulated `pg_stats`-based bloat queries are approximations and are frequently far off. Use them to shortlist and `pgstattuple` to decide.

## HOT updates

**Heap-Only Tuple** updates are the optimisation that makes update-heavy tables survivable. When an update satisfies both conditions:

1. **No indexed column changes**, and
2. **The new version fits on the same page**

then PostgreSQL writes the new version on the same page and chains it from the old, and **no index needs updating at all**. The index entry still points at the original location, and the chain is followed.

The saving is large: one page write instead of one page write plus an entry in every index on the table.

```sql
SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS hot_pct
FROM   pg_stat_user_tables
WHERE  n_tup_upd > 1000
ORDER  BY n_tup_upd DESC;
```

A low HOT percentage on a heavily updated table is a real finding. The two causes and their fixes:

**An indexed column is being updated.** Often an index nobody needs any more. Check whether it is used at all - a `last_seen_at` column with an index that no query touches is a common example. See [index-maintenance.md](index-maintenance.md).

**No free space on the page.** Lower `fillfactor` so pages are not packed full on insert:

```sql
ALTER TABLE sessions SET (fillfactor = 80);   -- leave 20% for HOT updates
VACUUM FULL sessions;                          -- rewrite to apply it to existing data
```

`fillfactor` only affects newly written pages, so existing data needs a rewrite. Default is 100. Values of 70 to 90 suit update-heavy tables; the cost is a larger table for read-only workloads.

A related design lever: **split hot columns out**. A wide table with one frequently-updated counter rewrites the whole row every time. Moving the counter to a narrow side table makes each update cheap and keeps the main table's pages stable. See [relationships.md](relationships.md).

## Vacuum

`VACUUM` marks dead tuple space reusable **within the table**. It does not return space to the operating system - the file stays the same size, with free space inside it that new rows will use.

That is usually correct: a table at a steady size reuses its own space and never grows.

| Command | Lock | Returns space to OS | Use |
|---|---|---|---|
| `VACUUM` | `SHARE UPDATE EXCLUSIVE` | No | Routine. Autovacuum does this |
| `VACUUM ANALYZE` | Same | No | Vacuum plus refresh statistics |
| `VACUUM FREEZE` | Same | No | Force freezing, before a wraparound risk |
| `VACUUM FULL` | **`ACCESS EXCLUSIVE`** | Yes | Rewrites the table. Blocks everything |

**`VACUUM FULL` blocks all reads and writes for its entire duration** and needs disk space for a full second copy. On a large table that is an outage measured in hours.

Prefer **`pg_repack`**, an extension that achieves the same compaction with only brief locks at the start and end. It needs the table to have a primary key or unique index, and disk space for the copy.

Only reach for either when the table has genuinely shrunk permanently - after a one-off bulk delete, or after the workload changed. A table with steady churn does not need it.

## Autovacuum

Autovacuum triggers on a table when:

```
dead tuples > autovacuum_vacuum_threshold
            + autovacuum_vacuum_scale_factor × reltuples
```

Defaults: threshold 50, scale factor **0.2**. So **20% of the table must be dead** before vacuum starts. On a 100-million-row table that is 20 million dead tuples - by which time the damage is done.

The analyse trigger uses `autovacuum_analyze_scale_factor`, default 0.1.

**Tune the scale factor down on large or busy tables.** This is the single most valuable autovacuum adjustment:

```sql
ALTER TABLE orders SET (
    autovacuum_vacuum_scale_factor  = 0.02,   -- 2% instead of 20%
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay    = 2       -- ms; lower means faster, more I/O
);
```

For a very large table, a flat threshold with a zero scale factor is more predictable:

```sql
ALTER TABLE events SET (
    autovacuum_vacuum_scale_factor = 0,
    autovacuum_vacuum_threshold    = 50000
);
```

Global settings worth reviewing (18 defaults):

| Setting | Default | Note |
|---|---|---|
| `autovacuum_max_workers` | 3 | Raise on a server with many large tables |
| `autovacuum_vacuum_cost_limit` | -1 (uses `vacuum_cost_limit`, 200) | Raise substantially on SSD - often to 1000 or more |
| `autovacuum_vacuum_cost_delay` | 2ms | Lower means faster vacuum, more I/O |
| `autovacuum_naptime` | 1min | How often the launcher checks |
| `maintenance_work_mem` | 64MB | Raise to 1GB or more; directly speeds vacuum |

The cost limit is the usual bottleneck. The defaults were set for spinning disks and throttle vacuum far below what modern storage can sustain, which is why autovacuum "cannot keep up" on hardware that is barely working.

## Why vacuum cannot reclaim

Dead tuples cannot be removed if **any** transaction might still need to see them. The oldest such transaction sets the horizon, and it is **cluster-wide**, not per table.

Four things hold it back:

1. **Long-running transactions**, including `idle in transaction`. The most common cause by far.
2. **Replication slots** that are not being consumed. An inactive logical slot holds the horizon indefinitely and also accumulates WAL until the disk fills.
3. **Prepared transactions** left uncommitted by a two-phase commit that never resolved.
4. **`hot_standby_feedback = on`** on a replica with long queries - the replica's oldest query holds the primary's horizon.

Find the culprit:

```sql
SELECT pid, state, now() - xact_start AS xact_age, left(query, 80)
FROM   pg_stat_activity WHERE xact_start IS NOT NULL ORDER BY xact_start LIMIT 5;

SELECT slot_name, active, restart_lsn,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM   pg_replication_slots ORDER BY restart_lsn;

SELECT * FROM pg_prepared_xacts;
```

**A table can show 90% dead tuples and vacuum will remove none of them**, because one session in another database has been idle in a transaction since yesterday. Diagnosing bloat without checking the horizon leads to endless pointless vacuuming.

## Freezing and wraparound

Transaction ids are 32-bit and wrap around after about 4 billion. To keep old rows visible after a wrap, vacuum **freezes** them - marking them as visible to everyone, permanently.

If freezing falls too far behind, PostgreSQL escalates:

- Warnings in the log from 40 million transactions remaining.
- At 3 million, it **refuses new transactions** and the database stops until a vacuum completes.

This is one of the few ways a PostgreSQL cluster stops entirely. It is entirely preventable.

```sql
SELECT datname, age(datfrozenxid),
       round(100.0 * age(datfrozenxid)
             / current_setting('autovacuum_freeze_max_age')::numeric, 1) AS pct_to_forced
FROM   pg_database ORDER BY age(datfrozenxid) DESC;

SELECT relname, age(relfrozenxid)
FROM   pg_class WHERE relkind = 'r' ORDER BY age(relfrozenxid) DESC LIMIT 10;
```

`autovacuum_freeze_max_age` defaults to 200 million; an anti-wraparound vacuum is forced at that point and **cannot be cancelled** without cancelling the whole session, and it will run even on tables where autovacuum is disabled.

Highest risk: very large, mostly-static tables that never accumulate enough dead tuples to trigger a normal vacuum, so their `relfrozenxid` ages quietly until an anti-wraparound vacuum kicks in and scans the entire table at the worst possible moment.

Alert on `age(datfrozenxid)` well before it matters.

## The visibility map

A bitmap marking pages where every tuple is visible to all transactions. Vacuum maintains it, and two things depend on it:

- **Index-only scans.** A page not marked all-visible forces a heap fetch, which is exactly the cost the index-only scan existed to avoid. High `Heap Fetches` in a plan is a vacuum symptom, not an index symptom.
- **Vacuum itself** skips all-visible pages, so a well-maintained table vacuums quickly.

See [composite-and-covering-indexes.md](composite-and-covering-indexes.md).

## Version notes

- **18** - asynchronous I/O improves vacuum throughput; `VACUUM`/`ANALYZE ... ONLY` processes a partitioned parent without children.
- **17+** - substantially rewritten dead-tuple storage in vacuum: much less memory and faster on large tables. The most significant vacuum improvement in years.
- **16+** - `pg_stat_io` shows vacuum I/O separately.
- **14+** - autovacuum reacts faster to wraparound risk; better handling of a large number of dead tuples.
- **19 (beta)** - parallel autovacuum workers via `autovacuum_max_parallel_workers`.

MVCC semantics, HOT requirements, `fillfactor` and the wraparound mechanism are identical across 14 to 18.

## Gotchas

- Agent diagnoses bloat without checking what holds the vacuum horizon - one idle transaction anywhere in the cluster makes vacuum unable to reclaim anything
- Agent forgets an inactive replication slot holds the horizon and retains WAL until the disk fills
- Agent leaves autovacuum at defaults on a large table - 20% dead before it starts is far too late
- Agent leaves `autovacuum_vacuum_cost_limit` at its default on SSD - throttles vacuum far below what the hardware can do
- Agent runs `VACUUM FULL` on a live table - `ACCESS EXCLUSIVE` for the whole rewrite, blocking reads as well as writes
- Agent uses `VACUUM FULL` routinely - plain vacuum makes space reusable, which is normally what is wanted
- Agent expects `VACUUM` to shrink the file - it does not; it makes space reusable inside it
- Agent trusts an estimated-bloat query - measure with `pgstattuple` before acting
- Agent ignores a low HOT update percentage - it means an indexed column is changing, or pages are full
- Agent sets `fillfactor` and expects existing data to change - it applies only to newly written pages
- Agent keeps an unused index on a frequently updated column - it prevents HOT updates on every update
- Agent ignores `age(datfrozenxid)` until warnings appear - the escalation ends with the database refusing transactions
- Agent disables autovacuum on a table to reduce load - anti-wraparound vacuum runs anyway, later, and much worse
- Agent treats high `Heap Fetches` on an index-only scan as an index problem - it is a stale visibility map

## Related

- [transactions-and-isolation.md](transactions-and-isolation.md) · [locking.md](locking.md) · [performance-triage.md](performance-triage.md) · [configuration.md](configuration.md) · [index-maintenance.md](index-maintenance.md) · [bulk-operations.md](bulk-operations.md) · [replication-and-scaling.md](replication-and-scaling.md) · [composite-and-covering-indexes.md](composite-and-covering-indexes.md)
