# Best Practices Checklist

Every rule in one scannable list. Use it as a review pass over an existing schema, query or migration.

## The eight that cause the most damage

| | Rule | Why it is the worst |
|---|---|---|
| 1 | **`SET LOCAL`, never `SET`, for tenant context** | Pools do not reset custom GUCs. One tenant's data is returned for another's request, with no error, no exception, nothing in the logs |
| 2 | **Never let the application role be superuser or hold `BYPASSRLS`** | Every RLS policy in the database becomes inert, silently. The isolation you built does not exist |
| 3 | **`lock_timeout` on every DDL statement** | A waiting `ACCESS EXCLUSIVE` request blocks every query behind it, including ones that would not conflict. A one-millisecond `ALTER` becomes a total outage |
| 4 | **`NOT EXISTS`, never `NOT IN`, with a subquery** | One NULL makes the query return zero rows. Always. No error |
| 5 | **Index every foreign key column** | PostgreSQL does not. Deleting one parent row then scans the entire child table while holding a lock |
| 6 | **Never open a transaction around a network call** | Holds the vacuum horizon for the whole cluster, so dead tuples accumulate in every table in every database |
| 7 | **Test the restore, not the backup** | The restore path is unverified until the emergency. Roles, extensions and statistics are all commonly missing |
| 8 | **`timestamptz`, never `timestamp`** | `timestamp` stores a wall-clock reading with no reference point. The data is unrecoverably ambiguous |

## Versions and setup

| # | Rule | Reference |
|---|---|---|
| 1 | Establish the server version with `SELECT version()`, never from a client or driver | [postgres-versions.md](postgres-versions.md) |
| 2 | New projects target PostgreSQL 18; 13 and below are end of life | [postgres-versions.md](postgres-versions.md) |
| 3 | Identify the platform - it decides available extensions, superuser and config access | [postgres-versions.md](postgres-versions.md) |
| 4 | Identify any pooler and its mode before recommending session-scoped anything | [connections-and-pooling.md](connections-and-pooling.md) |
| 5 | `REINDEX` text indexes after any OS or collation library change | [index-maintenance.md](index-maintenance.md) |
| 6 | `ANALYZE` after `pg_upgrade` on 17 and earlier | [statistics-and-planner.md](statistics-and-planner.md) |
| 7 | Write `STORED` explicitly on generated columns - 18 defaults to `VIRTUAL`, which cannot be indexed | [postgres-versions.md](postgres-versions.md) |

## Naming and organisation

| # | Rule | Reference |
|---|---|---|
| 8 | `snake_case`, never quoted identifiers | [naming-and-conventions.md](naming-and-conventions.md) |
| 9 | Plural table names, avoiding reserved words like `user` and `order` | [naming-and-conventions.md](naming-and-conventions.md) |
| 10 | Name every constraint - the name is what the application sees on failure | [naming-and-conventions.md](naming-and-conventions.md) |
| 11 | `_at` for timestamps, `_date`/`_on` for dates, `is_`/`has_` for booleans | [naming-and-conventions.md](naming-and-conventions.md) |
| 12 | One database with several schemas, divided by domain, not by layer | [schema-organisation.md](schema-organisation.md) |
| 13 | Separate the schema owner from the application role | [schema-organisation.md](schema-organisation.md) |
| 14 | Qualify object names in migrations - `search_path` differs by client | [schema-organisation.md](schema-organisation.md) |
| 15 | `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` so new tables get grants | [security-and-roles.md](security-and-roles.md) |

## Design

| # | Rule | Reference |
|---|---|---|
| 16 | Interrogate the spec before writing DDL - history and cardinality bounds are usually unstated | [requirements-to-schema.md](requirements-to-schema.md) |
| 17 | Decide the tenancy model before any table exists | [multi-tenancy.md](multi-tenancy.md) |
| 18 | Decide what history is kept before the first production `UPDATE` | [temporal-and-history.md](temporal-and-history.md) |
| 19 | Normalise to 3NF; denormalise only against a measurement | [normalisation.md](normalisation.md) |
| 20 | Every denormalised value needs a mechanism - generated column, constraint or trigger. Not application code | [normalisation.md](normalisation.md) |
| 21 | Store snapshot values (price as sold, tax rate applied) - they are separate facts, not duplication | [requirements-to-schema.md](requirements-to-schema.md) |
| 22 | Every table has a primary key, including event and log tables | [keys-and-identifiers.md](keys-and-identifiers.md) |
| 23 | `bigint GENERATED ALWAYS AS IDENTITY` by default; never `serial`, never `integer` for a key | [keys-and-identifiers.md](keys-and-identifiers.md) |
| 24 | UUIDv7 (`uuidv7()`, 18+) not UUIDv4 for keys - v4 scatters inserts and roughly doubles index size | [keys-and-identifiers.md](keys-and-identifiers.md) |
| 25 | Surrogate primary key **plus** a `UNIQUE` on the business identifier | [keys-and-identifiers.md](keys-and-identifiers.md) |
| 26 | Composite key on junction tables, not a surrogate `id` | [relationships.md](relationships.md) |
| 27 | Index both directions of a junction table | [relationships.md](relationships.md) |
| 28 | Never use a polymorphic `type` + `id` pair - no foreign key is possible | [relationships.md](relationships.md) |
| 29 | Adjacency list plus a recursive CTE is the default hierarchy | [relationships.md](relationships.md) |

## Types

| # | Rule | Reference |
|---|---|---|
| 30 | Never `char(n)`, `varchar(n)` as a length guard, `money`, `timestamp`, `timetz`, or `serial` | [data-types.md](data-types.md) |
| 31 | `numeric` for money, never a float type | [data-types.md](data-types.md) |
| 32 | `text` plus a `CHECK` on length, not `varchar(n)` | [data-types.md](data-types.md) |
| 33 | Never specify timestamp precision - `timestamptz(0)` rounds, not truncates | [data-types.md](data-types.md) |
| 34 | `jsonb`, never `json` | [jsonb.md](jsonb.md) |
| 35 | No native `enum` for business values - `text` + `CHECK`, or a lookup table | [data-types.md](data-types.md) |
| 36 | Store a currency alongside every amount in a multi-currency system | [requirements-to-schema.md](requirements-to-schema.md) |
| 37 | `inet` for IP addresses, `interval` for durations, `uuid` for UUIDs - not `text` | [data-types.md](data-types.md) |
| 38 | `[)` range bounds, consistently | [data-types.md](data-types.md) |

## Constraints

| # | Rule | Reference |
|---|---|---|
| 39 | Start from `NOT NULL`; justify each exception | [constraints.md](constraints.md) |
| 40 | `CHECK` plus `NOT NULL` - a check evaluating to NULL passes | [constraints.md](constraints.md) |
| 41 | Choose `ON DELETE` deliberately. `RESTRICT` for records, `CASCADE` only for parts | [constraints.md](constraints.md) |
| 42 | `EXCLUDE USING gist` for overlap rules - application checking cannot be race-free | [constraints.md](constraints.md) |
| 43 | Add constraints to large tables `NOT VALID`, then `VALIDATE` | [constraints.md](constraints.md) |
| 44 | Partial unique index for conditional uniqueness - constraints cannot have `WHERE` | [partial-and-expression-indexes.md](partial-and-expression-indexes.md) |
| 45 | Scope every unique constraint to the tenant in a shared schema | [multi-tenancy.md](multi-tenancy.md) |
| 46 | Composite foreign keys including `tenant_id`, so cross-tenant references are impossible | [multi-tenancy.md](multi-tenancy.md) |
| 47 | Constrain `jsonb` - `jsonb_typeof`, required keys, value domains | [jsonb.md](jsonb.md) |

## Writing SQL

| # | Rule | Reference |
|---|---|---|
| 48 | `IS NULL`/`IS NOT NULL`, never `= NULL` | [null-handling.md](null-handling.md) |
| 49 | `IS DISTINCT FROM` when comparing possibly-NULL values | [null-handling.md](null-handling.md) |
| 50 | `coalesce(sum(x), 0)` - `sum()` over no rows returns NULL | [aggregation.md](aggregation.md) |
| 51 | `count(child.id)` not `count(*)` over a `LEFT JOIN` | [aggregation.md](aggregation.md) |
| 52 | Outer-join filters go in `ON`, not `WHERE` | [joins.md](joins.md) |
| 53 | Never aggregate across two independent one-to-many joins - both totals are multiplied | [joins.md](joins.md) |
| 54 | `LEFT JOIN LATERAL ... ON true` to keep rows with no match | [joins.md](joins.md) |
| 55 | `ROWS` not the default `RANGE` in window frames | [window-functions.md](window-functions.md) |
| 56 | Adding `ORDER BY` to a window changes the frame to a running total | [window-functions.md](window-functions.md) |
| 57 | `last_value()` needs a frame extending to `UNBOUNDED FOLLOWING` | [window-functions.md](window-functions.md) |
| 58 | A cycle guard on every recursive CTE | [ctes.md](ctes.md) |
| 59 | Data-modifying CTEs run even when unreferenced, and sibling order is unspecified | [ctes.md](ctes.md) |
| 60 | `INSERT ... ON CONFLICT` for concurrent upserts; `MERGE` is not atomic | [upsert-and-merge.md](upsert-and-merge.md) |
| 61 | `WHERE ... IS DISTINCT FROM` on `DO UPDATE` to avoid pointless writes | [upsert-and-merge.md](upsert-and-merge.md) |
| 62 | Deduplicate before a bulk upsert - "cannot affect row a second time" | [upsert-and-merge.md](upsert-and-merge.md) |
| 63 | Keyset pagination, not `OFFSET` - which is slow **and** returns duplicates | [pagination.md](pagination.md) |
| 64 | A unique tiebreaker in every paginated `ORDER BY` | [pagination.md](pagination.md) |
| 65 | Never `BETWEEN` on a timestamp - use a half-open range | [dates-and-times.md](dates-and-times.md) |
| 66 | `date_trunc(field, source, timezone)` for business-timezone reports | [dates-and-times.md](dates-and-times.md) |
| 67 | `clock_timestamp()` in audit and event rows - `now()` is transaction start | [dates-and-times.md](dates-and-times.md) |
| 68 | Always name the text-search configuration: `to_tsvector('english', ...)` | [full-text-search.md](full-text-search.md) |
| 69 | `websearch_to_tsquery` for user input - `to_tsquery` raises on bad syntax | [full-text-search.md](full-text-search.md) |
| 70 | `coalesce` every column concatenated into a `tsvector` | [full-text-search.md](full-text-search.md) |
| 71 | Never `SELECT *` in application code or a view | [sql-style.md](sql-style.md) |
| 72 | Parameterise, never interpolate; and parameters cannot be identifiers | [sql-style.md](sql-style.md) |
| 73 | List columns explicitly in a view - `SELECT *` freezes at creation | [views.md](views.md) |
| 74 | `security_invoker` on any view over an RLS table (15+) | [views.md](views.md) |
| 75 | `REFRESH MATERIALIZED VIEW CONCURRENTLY`, which needs a unique index | [views.md](views.md) |

## Indexing

| # | Rule | Reference |
|---|---|---|
| 76 | Read the plan before adding an index | [indexing-fundamentals.md](indexing-fundamentals.md) |
| 77 | `ANALYZE` after creating an index | [indexing-fundamentals.md](indexing-fundamentals.md) |
| 78 | `CREATE INDEX CONCURRENTLY` on any live table | [index-maintenance.md](index-maintenance.md) |
| 79 | Check for invalid indexes after any failed concurrent build | [index-maintenance.md](index-maintenance.md) |
| 80 | Equality columns before range columns in a composite index | [composite-and-covering-indexes.md](composite-and-covering-indexes.md) |
| 81 | `tenant_id` leads every composite index in a shared schema | [multi-tenancy.md](multi-tenancy.md) |
| 82 | Index direction must match the `ORDER BY`, including mixed directions | [composite-and-covering-indexes.md](composite-and-covering-indexes.md) |
| 83 | Do not create an index that is a prefix of an existing composite | [index-maintenance.md](index-maintenance.md) |
| 84 | Leave the column bare in `WHERE` - no function wrapper, no cast | [query-optimisation.md](query-optimisation.md) |
| 85 | An expression index requires the query to reproduce the expression exactly | [partial-and-expression-indexes.md](partial-and-expression-indexes.md) |
| 86 | Never mark a function `IMMUTABLE` just to satisfy `CREATE INDEX` | [partial-and-expression-indexes.md](partial-and-expression-indexes.md) |
| 87 | `text_pattern_ops` for prefix `LIKE` under a non-C collation | [indexing-fundamentals.md](indexing-fundamentals.md) |
| 88 | `pg_trgm` GIN index for infix `LIKE` and fuzzy matching | [index-types.md](index-types.md) |
| 89 | `jsonb_path_ops` when only `@>` is needed - a third the size | [jsonb.md](jsonb.md) |
| 90 | Check `correlation` in `pg_stats` before creating a BRIN index | [index-types.md](index-types.md) |
| 91 | Audit for unused, duplicate and redundant indexes periodically | [index-maintenance.md](index-maintenance.md) |
| 92 | High `Heap Fetches` is a vacuum problem, not an index problem | [composite-and-covering-indexes.md](composite-and-covering-indexes.md) |

## Performance

| # | Rule | Reference |
|---|---|---|
| 93 | `EXPLAIN (ANALYZE, BUFFERS)` on production-like volumes | [explain.md](explain.md) |
| 94 | Multiply `actual time` by `loops` | [explain.md](explain.md) |
| 95 | Estimate versus actual is the primary signal; 100x off is a statistics problem | [explain.md](explain.md) |
| 96 | `CREATE STATISTICS` with `dependencies`, `ndistinct` and `mcv` for correlated columns | [statistics-and-planner.md](statistics-and-planner.md) |
| 97 | `random_page_cost = 1.1` on SSD | [configuration.md](configuration.md) |
| 98 | `effective_cache_size` to 50-75% of RAM - it allocates nothing | [configuration.md](configuration.md) |
| 99 | Never raise `work_mem` globally - it is per node per worker | [configuration.md](configuration.md) |
| 100 | Order `pg_stat_statements` by total time, not mean | [performance-triage.md](performance-triage.md) |
| 101 | Install `pg_stat_statements` before you need it - it requires a restart | [extensions.md](extensions.md) |
| 102 | Never leave `enable_seqscan` and friends off in production | [query-optimisation.md](query-optimisation.md) |
| 103 | `plan_cache_mode = force_custom_plan` when a query is fast in psql and slow from the app | [statistics-and-planner.md](statistics-and-planner.md) |
| 104 | `COPY` or array-unnest batches, never row-at-a-time inserts | [bulk-operations.md](bulk-operations.md) |
| 105 | `ANALYZE` after every bulk load | [bulk-operations.md](bulk-operations.md) |
| 106 | Batch bulk updates with `SKIP LOCKED`, pausing between batches | [bulk-operations.md](bulk-operations.md) |
| 107 | Partition for data lifecycle, not for query speed | [partitioning.md](partitioning.md) |
| 108 | Every unique constraint on a partitioned table must include the partition key | [partitioning.md](partitioning.md) |
| 109 | Declarative partitioning prunes by bounds - no `CHECK` constraints needed | [partitioning.md](partitioning.md) |
| 110 | Automate partition creation and alert when the next one is missing | [partitioning.md](partitioning.md) |
| 111 | `ANALYZE` partitioned parents explicitly - autovacuum does not | [statistics-and-planner.md](statistics-and-planner.md) |

## Concurrency

| # | Rule | Reference |
|---|---|---|
| 112 | Do arithmetic in SQL (`SET x = x - 1`), not read-modify-write | [transactions-and-isolation.md](transactions-and-isolation.md) |
| 113 | Retry `40001` and `40P01` with backoff, outside the transaction boundary | [transactions-and-isolation.md](transactions-and-isolation.md) |
| 114 | `SERIALIZABLE` for cross-row invariants; `REPEATABLE READ` does not stop write skew | [transactions-and-isolation.md](transactions-and-isolation.md) |
| 115 | Prefer a constraint to an isolation level where one exists | [constraints.md](constraints.md) |
| 116 | `idle_in_transaction_session_timeout`, and `transaction_timeout` on 17+ | [configuration.md](configuration.md) |
| 117 | No savepoint in a loop - over 64 subtransactions degrades the whole cluster | [transactions-and-isolation.md](transactions-and-isolation.md) |
| 118 | `SKIP LOCKED` for queues; claim and commit before doing the work | [locking.md](locking.md) |
| 119 | Acquire locks in a consistent order - sort ids before batch updates | [locking.md](locking.md) |
| 120 | `pg_advisory_xact_lock`, not the session-scoped form, under a pool | [locking.md](locking.md) |
| 121 | `log_lock_waits = on` | [locking.md](locking.md) |
| 122 | Tune `autovacuum_vacuum_scale_factor` down on large tables - 20% is far too late | [mvcc-and-vacuum.md](mvcc-and-vacuum.md) |
| 123 | Raise `autovacuum_vacuum_cost_limit` on SSD - the default throttles for spinning disks | [mvcc-and-vacuum.md](mvcc-and-vacuum.md) |
| 124 | Check what holds the vacuum horizon before diagnosing bloat | [mvcc-and-vacuum.md](mvcc-and-vacuum.md) |
| 125 | `max_slot_wal_keep_size`, or an abandoned slot fills the disk and stops the primary | [replication-and-scaling.md](replication-and-scaling.md) |
| 126 | Monitor `age(datfrozenxid)` - wraparound ends with the database refusing transactions | [mvcc-and-vacuum.md](mvcc-and-vacuum.md) |
| 127 | Lower `fillfactor` on update-heavy tables to enable HOT updates | [mvcc-and-vacuum.md](mvcc-and-vacuum.md) |
| 128 | `pg_repack`, not `VACUUM FULL`, on a live table | [mvcc-and-vacuum.md](mvcc-and-vacuum.md) |

## Server-side code

| # | Rule | Reference |
|---|---|---|
| 129 | `RETURN NEW` in every `BEFORE ROW` trigger - returning NULL discards the write | [functions-and-triggers.md](functions-and-triggers.md) |
| 130 | `SET search_path` on every `SECURITY DEFINER` function, with `pg_temp` last | [functions-and-triggers.md](functions-and-triggers.md) |
| 131 | `REVOKE EXECUTE ... FROM PUBLIC` on every new function | [security-and-roles.md](security-and-roles.md) |
| 132 | Declare volatility - `VOLATILE` is the default and blocks optimisation | [functions-and-triggers.md](functions-and-triggers.md) |
| 133 | `LANGUAGE sql` for single-query functions so they can be inlined | [functions-and-triggers.md](functions-and-triggers.md) |
| 134 | `INTO STRICT`, not bare `INTO` | [functions-and-triggers.md](functions-and-triggers.md) |
| 135 | `format()` with `%I` and `%L` for dynamic SQL | [functions-and-triggers.md](functions-and-triggers.md) |
| 136 | Prefix function parameters to avoid column-name collisions | [naming-and-conventions.md](naming-and-conventions.md) |
| 137 | No HTTP calls inside a function | [functions-and-triggers.md](functions-and-triggers.md) |

## Migrations

| # | Rule | Reference |
|---|---|---|
| 138 | `SET lock_timeout` in every migration | [migrations.md](migrations.md) |
| 139 | Never a volatile `DEFAULT` on `ADD COLUMN` - it rewrites the table | [migrations.md](migrations.md) |
| 140 | `SET NOT NULL` via a validated `CHECK` first, or 18's `NOT VALID` route | [migrations.md](migrations.md) |
| 141 | Foreign keys and checks `NOT VALID`, then `VALIDATE` | [migrations.md](migrations.md) |
| 142 | `CREATE INDEX CONCURRENTLY` outside a transactional migration | [migrations.md](migrations.md) |
| 143 | Expand and contract for renames and type changes - never one step | [migrations.md](migrations.md) |
| 144 | Every migration must be safe against the previous application version | [migrations.md](migrations.md) |
| 145 | Backfill in resumable batches, outside the migration transaction | [migrations.md](migrations.md) |
| 146 | Migrations are immutable once applied - fix forward | [migrations.md](migrations.md) |
| 147 | Run migrations as the schema owner, not the application role | [security-and-roles.md](security-and-roles.md) |
| 148 | A migration safety linter in CI | [testing.md](testing.md) |
| 149 | Time migrations against a production-scale copy | [testing.md](testing.md) |

## Security

| # | Rule | Reference |
|---|---|---|
| 150 | Application role: not superuser, no `BYPASSRLS`, owns nothing | [security-and-roles.md](security-and-roles.md) |
| 151 | `ENABLE` **and** `FORCE ROW LEVEL SECURITY` | [row-level-security.md](row-level-security.md) |
| 152 | Explicit `WITH CHECK` - `USING` alone hides bad writes rather than blocking them | [row-level-security.md](row-level-security.md) |
| 153 | RLS predicates must fail closed on a missing session variable | [row-level-security.md](row-level-security.md) |
| 154 | Wrap function calls in policies as `(SELECT f(...))` | [row-level-security.md](row-level-security.md) |
| 155 | Index every column used in a policy | [row-level-security.md](row-level-security.md) |
| 156 | Test RLS as the application role, including cross-tenant writes and the no-variable case | [testing.md](testing.md) |
| 157 | `USAGE` on the schema before table grants has any effect | [security-and-roles.md](security-and-roles.md) |
| 158 | `REVOKE CONNECT ON DATABASE ... FROM PUBLIC` | [security-and-roles.md](security-and-roles.md) |
| 159 | `scram-sha-256`, and re-set passwords after changing the setting | [security-and-roles.md](security-and-roles.md) |
| 160 | `sslmode=verify-full`, not `require` | [security-and-roles.md](security-and-roles.md) |

## Operations

| # | Rule | Reference |
|---|---|---|
| 161 | Use a pooler; do not raise `max_connections` | [connections-and-pooling.md](connections-and-pooling.md) |
| 162 | Size the pool for the database's capacity, not the application's concurrency | [connections-and-pooling.md](connections-and-pooling.md) |
| 163 | Budget connections across every instance, replica, monitor and migration | [connections-and-pooling.md](connections-and-pooling.md) |
| 164 | Set `application_name` on every connection | [connections-and-pooling.md](connections-and-pooling.md) |
| 165 | `statement_timeout` per role | [configuration.md](configuration.md) |
| 166 | `pg_dumpall --globals-only` alongside `pg_dump` - roles are cluster-wide | [backup-and-recovery.md](backup-and-recovery.md) |
| 167 | Monitor `pg_stat_archiver` - a failing archiver fills the disk | [backup-and-recovery.md](backup-and-recovery.md) |
| 168 | Backups off-host and off-account | [backup-and-recovery.md](backup-and-recovery.md) |
| 169 | Monitor backup age and size, not just job success | [backup-and-recovery.md](backup-and-recovery.md) |
| 170 | Handle replication lag explicitly for read-your-own-writes | [replication-and-scaling.md](replication-and-scaling.md) |
| 171 | Advance sequences at cutover after logical replication | [replication-and-scaling.md](replication-and-scaling.md) |
| 172 | Never one synchronous standby - use `ANY 1` of two or more | [replication-and-scaling.md](replication-and-scaling.md) |
| 173 | Test failover; an unexercised promotion path does not work | [replication-and-scaling.md](replication-and-scaling.md) |
| 174 | Exhaust indexing, configuration and vertical scaling before sharding | [replication-and-scaling.md](replication-and-scaling.md) |
| 175 | Record required extensions and versions next to the migrations | [extensions.md](extensions.md) |

## Application integration

| # | Rule | Reference |
|---|---|---|
| 176 | Assert a query-count bound per endpoint to catch N+1 | [application-integration.md](application-integration.md) |
| 177 | `@Transactional` does not apply to a call from within the same class | [application-integration.md](application-integration.md) |
| 178 | Map `numeric` to `BigDecimal` or a string, never a float | [application-integration.md](application-integration.md) |
| 179 | Bind parameters as the column's type - a cast disables the index | [application-integration.md](application-integration.md) |
| 180 | `setFetchSize` requires autocommit off | [application-integration.md](application-integration.md) |
| 181 | Check the pooler version before disabling prepared statements | [connections-and-pooling.md](connections-and-pooling.md) |
| 182 | Read the SQL the ORM generates | [application-integration.md](application-integration.md) |

## Testing

| # | Rule | Reference |
|---|---|---|
| 183 | Test against real PostgreSQL, pinned to the production major version | [testing.md](testing.md) |
| 184 | Fixtures with NULLs, with fan-out, and with realistic skew | [testing.md](testing.md) |
| 185 | Assert on constraint names and SQLSTATEs, not error messages | [testing.md](testing.md) |
| 186 | Two connections and committed data for any concurrency test | [testing.md](testing.md) |
| 187 | A deterministic `ORDER BY` in any test that depends on row order | [testing.md](testing.md) |
| 188 | Write directly to the table when testing a trigger | [testing.md](testing.md) |

## Version notes

Rules referring to a specific version state it inline. The ones most likely to change an answer:

- **`STORED` on generated columns** matters from 18, where `VIRTUAL` became the default and cannot be indexed.
- **`uuidv7()`** requires 18. On 14 to 17, generate UUIDv7 in the application.
- **`MERGE`** requires 15, `MERGE ... RETURNING` requires 17.
- **`NULLS NOT DISTINCT`** requires 15.
- **`security_invoker` views** require 15, and their absence on 14 is a real constraint alongside RLS.
- **`transaction_timeout`** requires 17.
- **The `NOT VALID` route for `NOT NULL`** is native on 18; on 14 to 17 use the validated-`CHECK` route.
- **`max_slot_wal_keep_size`** exists on every supported version and should always be set.

See [postgres-versions.md](postgres-versions.md).

## Gotchas

- Agent treats this checklist as a substitute for reading the plan - most rules here are defaults, and a measurement overrides a default
- Agent applies every rule to a small internal tool - partitioning, replication and pooling advice is scaled to systems that need it
- Agent changes a working schema to satisfy a naming rule - match the existing convention and raise the conflict instead
- Agent uses the checklist to justify an index without checking what already exists
- Agent skips the version notes and recommends `MERGE`, `uuidv7()` or `security_invoker` on a version that lacks them

## Related

- [postgres-versions.md](postgres-versions.md) · [requirements-to-schema.md](requirements-to-schema.md) · [multi-tenancy.md](multi-tenancy.md) · [explain.md](explain.md) · [migrations.md](migrations.md) · [row-level-security.md](row-level-security.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [testing.md](testing.md)
