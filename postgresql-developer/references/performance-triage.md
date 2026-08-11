# Performance Triage

"The database is slow" is not a diagnosis. This is the order in which to turn it into one.

## The order

1. **Is it the database at all?** Check application-side latency against database-side time. A slow response with fast queries is a connection pool, a network hop, or N+1.
2. **Is it happening now, or did it happen?** Live means `pg_stat_activity`; historical means `pg_stat_statements` and the logs.
3. **One query or everything?** One query is an optimisation problem. Everything at once is resources, locking, or a pool.
4. **What changed?** A deploy, a data volume threshold, a migration, a traffic pattern, an autovacuum that stopped keeping up.

## Live: `pg_stat_activity`

```sql
SELECT pid, usename, application_name, state,
       now() - query_start AS duration,
       wait_event_type, wait_event,
       left(query, 120) AS query
FROM   pg_stat_activity
WHERE  state <> 'idle' AND pid <> pg_backend_pid()
ORDER  BY duration DESC;
```

`state` is the first thing to read:

| State | Meaning |
|---|---|
| `active` | Running a query |
| `idle` | Connected, doing nothing. Normal for a pool |
| **`idle in transaction`** | **In a transaction, not running anything.** Holding locks and blocking vacuum |
| `idle in transaction (aborted)` | Same, after an error. Worse - it will never commit anything |

**`idle in transaction` is the single most damaging state in PostgreSQL.** Such a session holds every lock it has taken and holds back the vacuum horizon for the entire database - so dead tuples accumulate everywhere, not just in the tables it touched. One forgotten `BEGIN` in application code can bloat an entire cluster.

```sql
SELECT pid, now() - state_change AS idle_for, left(query, 200)
FROM   pg_stat_activity
WHERE  state IN ('idle in transaction', 'idle in transaction (aborted)')
ORDER  BY state_change;
```

Set `idle_in_transaction_session_timeout` (say `60s`) so these die automatically. See [configuration.md](configuration.md).

### Wait events

`wait_event_type` says what a backend is waiting on:

| Type | Meaning |
|---|---|
| `Lock` | Waiting on a heavyweight lock. Blocked by another transaction |
| `LWLock` | Internal lock. Usually contention, often `BufferContent` or WAL-related |
| `IO` | Reading or writing. `DataFileRead` is a buffer cache miss |
| `Client` | Waiting for the client. `ClientRead` on an `active` session means the application is slow to send |
| `IPC` | Waiting on another process, often a parallel worker |
| `Timeout` | A deliberate sleep |
| `NULL` | Actually running on CPU |

A screen full of `Lock` waits is a locking problem. A screen full of `IO / DataFileRead` is a cache or query-volume problem. Mostly `NULL` means CPU-bound.

### Who is blocking whom

```sql
SELECT blocked.pid          AS blocked_pid,
       blocked.query        AS blocked_query,
       blocking.pid         AS blocking_pid,
       blocking.state       AS blocking_state,
       now() - blocking.state_change AS blocking_state_duration,
       blocking.query       AS blocking_query
FROM   pg_stat_activity blocked
JOIN   pg_stat_activity blocking
       ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
WHERE  cardinality(pg_blocking_pids(blocked.pid)) > 0;
```

`pg_blocking_pids()` is the direct answer and is much simpler than joining `pg_locks` to itself. Note that the blocker's `query` is the **last** statement it ran, which for an `idle in transaction` session is not the statement holding the lock.

To intervene:

```sql
SELECT pg_cancel_backend(pid);      -- cancel the query, keep the connection
SELECT pg_terminate_backend(pid);   -- kill the connection, rolling back
```

Try cancel first. See [locking.md](locking.md).

## Historical: `pg_stat_statements`

The most valuable extension there is. Enable it before you need it - it requires a restart.

```
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = top
```

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

**Order by total time, not mean.** A query taking 5 ms and running 2 million times an hour costs far more than one taking 8 seconds twice a day, and it is invisible in a slow-query log.

```sql
SELECT calls,
       round(total_exec_time::numeric, 1)               AS total_ms,
       round(mean_exec_time::numeric, 2)                AS mean_ms,
       round(stddev_exec_time::numeric, 2)              AS stddev_ms,
       rows,
       round(100.0 * shared_blks_hit
             / nullif(shared_blks_hit + shared_blks_read, 0), 1) AS hit_pct,
       left(query, 100) AS query
FROM   pg_stat_statements
ORDER  BY total_exec_time DESC
LIMIT  20;
```

The columns are **`total_exec_time`** and **`mean_exec_time`**. They were renamed from `total_time`/`mean_time` in PostgreSQL 13, so any query using the old names fails on every supported version. Planning time is tracked separately in `total_plan_time` and only when `pg_stat_statements.track_planning` is on (it is off by default).

What to look for:

- **High `total_exec_time`, low `mean_exec_time`** - called constantly. Often N+1. See [application-integration.md](application-integration.md).
- **High `stddev_exec_time`** - sometimes fast, sometimes slow. Parameter-dependent plans, lock waits, or cache variance.
- **Low `hit_pct`** - reading from outside shared buffers.
- **`rows / calls` very large** - fetching far more than the application uses.

Reset the baseline before an experiment:

```sql
SELECT pg_stat_statements_reset();
```

`pg_stat_statements.max` defaults to 5000 distinct statements; beyond that the least-used are evicted. Applications that interpolate literals instead of using parameters generate a distinct entry per call and blow this out entirely - which is one more reason to parameterise.

## Slow query logging

```sql
ALTER SYSTEM SET log_min_duration_statement = '1000ms';
ALTER SYSTEM SET log_lock_waits = on;             -- logs waits over deadlock_timeout
ALTER SYSTEM SET log_temp_files = 0;              -- logs every spill to disk
ALTER SYSTEM SET log_autovacuum_min_duration = '1s';
ALTER SYSTEM SET log_checkpoints = on;            -- default on since 15
SELECT pg_reload_conf();
```

`log_temp_files = 0` logs every temporary file, which directly identifies queries exceeding `work_mem`.

`log_lock_waits` is essential and cheap - it names the blocked query, the blocker, and the lock.

### `auto_explain`

Logs the **plan** of slow queries, which is the only way to see a plan that is bad only in production:

```sql
ALTER SYSTEM SET session_preload_libraries = 'auto_explain';
ALTER SYSTEM SET auto_explain.log_min_duration = '3s';
ALTER SYSTEM SET auto_explain.log_analyze = on;
ALTER SYSTEM SET auto_explain.log_buffers = on;
ALTER SYSTEM SET auto_explain.log_nested_statements = on;
```

`log_analyze` adds instrumentation overhead to **every** query, not only the logged ones - on some workloads more than 10%. Use `auto_explain.sample_rate` to limit it, and treat it as a temporary diagnostic rather than a permanent setting.

## Table and index statistics

```sql
SELECT relname,
       seq_scan, seq_tup_read,
       idx_scan, idx_tup_fetch,
       n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       last_autovacuum, last_autoanalyze
FROM   pg_stat_user_tables
ORDER  BY seq_tup_read DESC
LIMIT  20;
```

- **High `seq_scan` with high `seq_tup_read` on a big table** - a missing index candidate. On a small table it is fine and correct.
- **`dead_pct` above 20%** - vacuum is not keeping up. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).
- **`last_autovacuum` old on a churning table** - autovacuum is starved or blocked by a long transaction.

Cache hit ratio:

```sql
SELECT sum(heap_blks_hit) * 100.0
       / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) AS cache_hit_pct
FROM   pg_statio_user_tables;
```

Below about 95% on an OLTP workload suggests `shared_buffers` is too small - but read it carefully, because a "read" may have been served by the OS page cache. It is a directional signal, not a measurement.

## Connections

```sql
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
SHOW max_connections;
```

Near the limit means either the pool is oversized or connections are leaking. `FATAL: sorry, too many clients already` is the visible symptom. See [connections-and-pooling.md](connections-and-pooling.md).

## Replication lag

```sql
-- On the primary
SELECT client_addr, state, sent_lsn, replay_lsn,
       pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes
FROM   pg_stat_replication;

-- On a replica
SELECT now() - pg_last_xact_replay_timestamp() AS replay_lag;
```

Growing lag means reads on a replica are returning stale data, and it also delays WAL cleanup on the primary. See [replication-and-scaling.md](replication-and-scaling.md).

## Symptom to cause

| Symptom | Look at |
|---|---|
| One query slow, always | `EXPLAIN (ANALYZE, BUFFERS)`, statistics |
| One query slow, sometimes | Parameter-dependent plans, lock waits, cache variance |
| Everything slow at once | Locking, connection saturation, CPU, I/O, a checkpoint storm |
| Slow after a deploy | New query, new index, a migration still running |
| Gradually slower over weeks | Bloat, stale statistics, data volume crossing a plan threshold |
| Slow only at a specific time | A batch job, autovacuum, a backup, a materialised view refresh |
| Writes slow, reads fine | Too many indexes, WAL/checkpoint pressure, synchronous replication |
| High CPU, low I/O | Bad plans, sequential scans in memory, JIT compilation |
| High I/O, low CPU | Undersized cache, bloat, spilling to disk |
| Fast in psql, slow from the app | Generic plan, type mismatch on a parameter, or N+1 |

## A first-response checklist

```sql
-- 1. What is running, and what is it waiting on?
SELECT pid, state, wait_event_type, wait_event,
       now() - query_start AS dur, left(query,80)
FROM pg_stat_activity WHERE state <> 'idle' ORDER BY dur DESC LIMIT 20;

-- 2. Is anything blocked?
SELECT pid, pg_blocking_pids(pid), left(query,80)
FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;

-- 3. Any long idle-in-transaction sessions?
SELECT pid, now() - state_change AS idle_for, left(query,80)
FROM pg_stat_activity WHERE state LIKE 'idle in transaction%' ORDER BY state_change;

-- 4. Connection headroom?
SELECT count(*) FILTER (WHERE state='active') AS active, count(*) AS total,
       current_setting('max_connections')::int AS max FROM pg_stat_activity;

-- 5. What has cost the most since the last reset?
SELECT calls, round(total_exec_time::numeric) AS total_ms, left(query,80)
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;

-- 6. Any table drowning in dead tuples?
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables WHERE n_dead_tup > 100000 ORDER BY n_dead_tup DESC LIMIT 10;
```

## Version notes

- **18** - `pg_aios` exposes asynchronous I/O activity; `EXPLAIN ANALYZE` includes buffers by default.
- **17+** - `pg_stat_checkpointer`; `pg_stat_statements` tracks local and temp block I/O timing separately.
- **16+** - `pg_stat_io`, which is the best view of I/O by backend type and context.
- **15+** - `log_checkpoints` defaults to on.
- **13+** - `pg_stat_statements` columns renamed to `total_exec_time`/`mean_exec_time`, with planning tracked separately.

`pg_stat_activity`, wait events and `pg_blocking_pids()` are consistent across 14 to 18, with new wait event names added each release.

## Gotchas

- Agent optimises before establishing which query is slow - `pg_stat_statements` ordered by total time answers this in one query
- Agent orders `pg_stat_statements` by `mean_exec_time` - misses the 5 ms query running two million times an hour
- Agent uses `total_time`/`mean_time` column names - renamed in 13; the query fails on every supported version
- Agent ignores `idle in transaction` sessions - they hold locks and block vacuum across the whole database
- Agent reads the blocker's `query` column as the statement holding the lock - it is the last statement run, which for an idle transaction is not it
- Agent kills a backend with `pg_terminate_backend` first - try `pg_cancel_backend`
- Agent enables `auto_explain.log_analyze` permanently - it instruments every query, not only the logged ones
- Agent expects `pg_stat_statements` to exist without `shared_preload_libraries` and a restart
- Agent trusts the cache hit ratio as a measurement - a "read" may have been served by the OS page cache
- Agent treats high `seq_scan` as always bad - on a small table a sequential scan is correct
- Agent looks only at the database when the application reports slow responses - N+1 and pool waits do not appear as slow queries
- Agent forgets that `pg_stat_statements.max` defaults to 5000 and that unparameterised SQL evicts everything useful

## Related

- [explain.md](explain.md) · [query-optimisation.md](query-optimisation.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [locking.md](locking.md) · [connections-and-pooling.md](connections-and-pooling.md) · [configuration.md](configuration.md) · [statistics-and-planner.md](statistics-and-planner.md) · [replication-and-scaling.md](replication-and-scaling.md)
