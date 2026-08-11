# Configuration

PostgreSQL's defaults are deliberately conservative so it starts on almost anything. They are not tuned for any real server.

Perhaps a dozen settings account for nearly all the benefit. The rest should be left alone unless a measurement points at them.

## Changing settings

```sql
ALTER SYSTEM SET shared_buffers = '8GB';   -- writes postgresql.auto.conf
SELECT pg_reload_conf();                    -- applies settings that do not need a restart

SHOW shared_buffers;
SELECT name, setting, unit, context, source, pending_restart
FROM   pg_settings WHERE name = 'shared_buffers';
```

`context` tells you what a change requires: `postmaster` needs a restart, `sighup` a reload, `user` can be set per session.

Scope narrowly where you can:

```sql
ALTER ROLE     reporting SET work_mem = '256MB';
ALTER DATABASE analytics SET random_page_cost = 1.1;
SET LOCAL work_mem = '512MB';   -- this transaction only
```

## Memory

### `shared_buffers`

PostgreSQL's own cache. **25% of RAM** is the standard starting point.

Higher is not automatically better: PostgreSQL relies on the OS page cache as a second tier, and a very large `shared_buffers` duplicates data in both and lengthens checkpoints. 25 to 40% covers most cases; above that, measure.

Requires a restart.

### `work_mem`

Memory per **sort, hash or hash join node, per parallel worker**. Not per query and emphatically not per server.

A query with three sorts and four parallel workers can use twelve times the setting. That is why raising it globally is how servers run out of memory.

Default 4MB, which is low for anything analytical. A reasonable global value is 16 to 64MB; raise it per role or per transaction for the queries that need it.

Find out whether it matters before changing it:

```sql
ALTER SYSTEM SET log_temp_files = 0;   -- log every spill
```

Then look for `Sort Method: external merge Disk:` and `Batches: > 1` in plans. See [explain.md](explain.md).

### `maintenance_work_mem`

For `VACUUM`, `CREATE INDEX`, `ALTER TABLE ADD FOREIGN KEY`. Default 64MB is far too low.

**1 to 2GB** on a server of any size. It directly determines how fast vacuum and index builds run, and only a few processes use it at once.

`autovacuum_work_mem` defaults to `-1`, meaning it uses `maintenance_work_mem` - and there can be `autovacuum_max_workers` of those simultaneously. Budget for that.

### `effective_cache_size`

**Allocates nothing.** It tells the planner how much data is likely cached across PostgreSQL and the OS, which makes repeated index access look cheaper.

**50 to 75% of RAM.** Setting it too low discourages index scans, and it is free to set correctly.

## Planner costs

### `random_page_cost`

Default **4.0**, which encodes the seek cost of a spinning disk.

**On SSD or NVMe, set it to 1.1.** On cloud block storage, 1.1 to 2.0.

This single setting fixes more "why is it not using my index" complaints than anything else. At 4.0 the planner systematically prefers sequential scans over index scans, on hardware where random reads are barely more expensive than sequential ones.

```sql
ALTER SYSTEM SET random_page_cost = 1.1;
```

### The rest

`seq_page_cost` stays at 1.0 - it is the unit everything else is relative to. The `cpu_*` costs are rarely worth touching.

`jit` defaults on from PostgreSQL 12, with `jit_above_cost = 100000`. JIT compilation helps long analytical queries and **hurts** short ones, where compiling costs more than it saves. If plans show a large `JIT:` time relative to execution, raise `jit_above_cost` or disable it for that workload. PostgreSQL 19 turns JIT off by default, which tells you how the consensus landed.

## WAL and checkpoints

### `max_wal_size` and checkpoints

Defaults are `max_wal_size = 1GB`, `min_wal_size = 80MB` and `checkpoint_timeout = 5min`. On a write-heavy system that means checkpoints fire constantly - either every five minutes, or far more often once 1 GB of WAL accumulates - and each one flushes dirty buffers in a burst that stalls queries.

```sql
ALTER SYSTEM SET max_wal_size = '16GB';
ALTER SYSTEM SET min_wal_size = '2GB';
ALTER SYSTEM SET checkpoint_timeout = '15min';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;   -- default since 14
```

Larger `max_wal_size` means fewer, larger checkpoints and a longer crash recovery. That is usually the right trade.

Watch for it:

```sql
ALTER SYSTEM SET log_checkpoints = on;   -- default on since 15
SELECT * FROM pg_stat_bgwriter;          -- pg_stat_checkpointer on 17+
```

`checkpoints_req` substantially exceeding `checkpoints_timed` means checkpoints are being forced by WAL volume rather than time - raise `max_wal_size`.

### `wal_compression`

```sql
ALTER SYSTEM SET wal_compression = 'lz4';   -- or 'zstd'
```

Compresses full-page images. Meaningful reduction in WAL volume for a little CPU, which helps replication and archiving. `lz4` is a good default.

### `synchronous_commit`

`on` by default: a commit waits for WAL to reach durable storage.

`off` makes commits much faster and risks losing the last few hundred milliseconds of transactions on a crash. **It does not risk corruption** - the database is still consistent, just missing recent commits.

Reasonable per-transaction for bulk loads and for data you can reproduce:

```sql
SET LOCAL synchronous_commit = off;
```

Never globally on a system holding data that must not be lost.

## Autovacuum

The defaults let a table reach 20% dead tuples before vacuuming, and throttle vacuum for spinning disks.

```sql
ALTER SYSTEM SET autovacuum_max_workers = 5;
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 1000;   -- default 200; far too low on SSD
ALTER SYSTEM SET autovacuum_vacuum_cost_delay = '2ms';
ALTER SYSTEM SET autovacuum_naptime = '30s';
```

And per table for the busy ones:

```sql
ALTER TABLE orders SET (
    autovacuum_vacuum_scale_factor  = 0.02,
    autovacuum_analyze_scale_factor = 0.01
);
```

`autovacuum_vacuum_cost_limit` is the usual bottleneck. The default throttles vacuum far below what modern storage sustains, which is why autovacuum "cannot keep up" on hardware that is barely working. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

## Timeouts

Every default is "wait forever". Set them.

```sql
ALTER SYSTEM SET idle_in_transaction_session_timeout = '60s';
ALTER SYSTEM SET transaction_timeout = '10min';    -- 17+
ALTER SYSTEM SET lock_timeout = '0';               -- set per-statement in migrations instead
ALTER ROLE app_service SET statement_timeout = '30s';
ALTER ROLE reporting   SET statement_timeout = '10min';
```

`statement_timeout` is best set per role - an OLTP service and a reporting user want very different values. Setting it globally either strangles reports or fails to protect the application.

`lock_timeout` is best set per statement in migrations rather than globally, because a global value affects normal queries too. See [migrations.md](migrations.md).

## Parallelism

```sql
ALTER SYSTEM SET max_worker_processes = 16;              -- >= CPU cores
ALTER SYSTEM SET max_parallel_workers = 12;
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;    -- default 2
ALTER SYSTEM SET max_parallel_maintenance_workers = 4;   -- index builds
```

`max_parallel_workers_per_gather = 2` is conservative for an analytical workload and about right for OLTP. Remember `work_mem` is per worker.

A `PARALLEL UNSAFE` function anywhere in a query disables parallelism for the whole query. See [functions-and-triggers.md](functions-and-triggers.md).

## Logging

```sql
ALTER SYSTEM SET log_min_duration_statement = '1000ms';
ALTER SYSTEM SET log_checkpoints = on;
ALTER SYSTEM SET log_lock_waits = on;
ALTER SYSTEM SET log_temp_files = 0;
ALTER SYSTEM SET log_autovacuum_min_duration = '1s';
ALTER SYSTEM SET log_line_prefix = '%m [%p] %q%u@%d app=%a ';
```

All cheap, all high-value. `log_statement = 'all'` is not - it is enormous and logs parameter values including personal data.

`log_line_prefix` including user, database and application name is what makes logs correlatable to a service. Without `%a`, and without the application setting `application_name`, you cannot tell which service issued a slow query.

## Connections

```sql
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET superuser_reserved_connections = 5;
ALTER SYSTEM SET reserved_connections = 5;              -- 16+, for pg_use_reserved_connections
```

Use a pooler rather than a large `max_connections`. See [connections-and-pooling.md](connections-and-pooling.md).

## Managed platforms

RDS, Cloud SQL, Azure and Supabase set many of these from an instance-size template, block `ALTER SYSTEM`, and expose a parameter group instead. The defaults are usually reasonable but not workload-aware - `random_page_cost` in particular is often left at 4.0 despite SSD storage.

Check what is actually in effect rather than what you set:

```sql
SELECT name, setting, unit, source, boot_val
FROM   pg_settings
WHERE  source NOT IN ('default', 'override')
ORDER  BY name;
```

`source` shows where each value came from.

## A starting point

For a general OLTP server with 32 GB RAM and SSD:

```
shared_buffers = 8GB
effective_cache_size = 24GB
work_mem = 32MB
maintenance_work_mem = 2GB

random_page_cost = 1.1
effective_io_concurrency = 200

max_wal_size = 16GB
min_wal_size = 2GB
checkpoint_timeout = 15min
wal_compression = lz4

autovacuum_max_workers = 5
autovacuum_vacuum_cost_limit = 1000

max_connections = 200
idle_in_transaction_session_timeout = 60s

log_min_duration_statement = 1000ms
log_checkpoints = on
log_lock_waits = on
log_temp_files = 0
```

A starting point, not a prescription. Measure before and after.

## Version notes

- **18** - data checksums on by default; asynchronous I/O with `io_method`, `io_combine_limit`; `EXPLAIN ANALYZE` includes buffers by default.
- **17+** - `transaction_timeout`; `pg_stat_checkpointer` replaces checkpoint counters in `pg_stat_bgwriter`.
- **16+** - `reserved_connections` and `pg_use_reserved_connections`; `pg_stat_io`.
- **15+** - `log_checkpoints` defaults on; `wal_compression` accepts `lz4` and `zstd`.
- **14+** - `checkpoint_completion_target` defaults to 0.9.
- **19 (beta)** - JIT disabled by default; `default_toast_compression` defaults to `lz4`; autovacuum can use parallel workers.

Memory semantics, planner costs and autovacuum triggering are otherwise identical across 14 to 18.

## Gotchas

- Agent raises `work_mem` globally - it is per node per worker, so total usage is a large multiple of the setting
- Agent leaves `random_page_cost` at 4.0 on SSD - biases the planner against every index scan
- Agent believes `effective_cache_size` allocates memory - it is a planner hint only
- Agent leaves `maintenance_work_mem` at 64MB - directly slows every vacuum and index build
- Agent sets `shared_buffers` very high - PostgreSQL relies on the OS cache as a second tier; beyond about 40% of RAM it duplicates and lengthens checkpoints
- Agent leaves `max_wal_size` at 1GB on a write-heavy system - constant forced checkpoints and stalls
- Agent sets `synchronous_commit = off` globally - recent commits are lost on a crash
- Agent leaves `autovacuum_vacuum_cost_limit` at 200 on SSD - throttles vacuum far below the hardware's capability
- Agent sets `statement_timeout` globally - either strangles reports or fails to protect the application; set it per role
- Agent sets `lock_timeout` globally - affects normal queries; set it per statement in migrations
- Agent enables `log_statement = 'all'` - enormous, and logs parameter values including personal data
- Agent omits `application_name` from `log_line_prefix` - logs cannot be attributed to a service
- Agent tunes a managed instance without checking `pg_settings.source` - the platform may be overriding the change
- Agent changes a `postmaster`-context setting and expects `pg_reload_conf()` to apply it - it needs a restart

## Related

- [connections-and-pooling.md](connections-and-pooling.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [statistics-and-planner.md](statistics-and-planner.md) · [performance-triage.md](performance-triage.md) · [explain.md](explain.md) · [backup-and-recovery.md](backup-and-recovery.md) · [replication-and-scaling.md](replication-and-scaling.md) · [migrations.md](migrations.md)
