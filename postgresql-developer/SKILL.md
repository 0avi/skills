---
name: postgresql-developer
description: Designs PostgreSQL schemas from requirements, makes database architecture decisions, writes SQL, and diagnoses and fixes slow queries. Trigger when designing or reviewing a schema, choosing a multi-tenancy model, picking data types and keys, writing constraints, planning a migration, writing or reviewing SQL (joins, aggregation, window functions, CTEs, upserts, pagination, full-text search, JSONB), choosing or fixing indexes, reading an EXPLAIN plan, diagnosing a slow query or high database CPU, tuning autovacuum or dealing with bloat, resolving locks and deadlocks, choosing an isolation level, setting up row-level security, sizing a connection pool, or planning partitioning, replication and backups. Targets PostgreSQL 14 through 18.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# PostgreSQL Developer Guidelines

Covers PostgreSQL as both a design problem and a production system: turning a specification into a schema, choosing between architectures, writing SQL, and making an existing database faster. Baseline is **PostgreSQL 18**; every supported version back to 14 is covered.

1. **Always determine the PostgreSQL major version and where it runs before giving guidance.** 18 made `VIRTUAL` the default for generated columns, turned on data checksums, added skip scans and temporal constraints; 15 added `MERGE` and `NULLS NOT DISTINCT`; managed platforms restrict extensions, superuser and configuration. Advice that is right on 18 silently changes meaning on 14. Read [postgres-versions.md](references/postgres-versions.md).

2. **Never add an index, denormalise, or change a setting without a measurement.** Run `EXPLAIN (ANALYZE, BUFFERS)` before and after, on realistic data volumes. An index guessed at is a permanent write cost that may buy nothing, and a plan on 100 rows tells you nothing about 100 million. Read [explain.md](references/explain.md).

3. **Constraints are the schema, not decoration.** Every column is `NOT NULL` unless nullable means something specific; every foreign key is declared; every domain rule that can be a `CHECK` is one. The database is the only layer that cannot be bypassed by a bad deploy, a background job, or a manual `psql` session. Read [constraints.md](references/constraints.md).

4. **Never generate these types.** `char(n)`, `varchar(n)` as a length guard, `money`, `timestamp` (without time zone), `timetz`, `serial`/`bigserial`, or any float type for money. Each has a specific replacement and a specific way it corrupts data. Read [data-types.md](references/data-types.md).

5. **Every DDL statement states its lock.** Migrations are the most common way to cause an outage: an unqualified `ALTER TABLE` takes `ACCESS EXCLUSIVE` and queues behind every open transaction, then blocks every new one. Give the lock level, the safe rewrite, and a `lock_timeout`. Read [migrations.md](references/migrations.md).

6. **Tenant isolation must fail closed.** An RLS predicate must be written so that a missing or mistyped session variable returns zero rows, never every row. Verify by running as the actual application role, never as superuser or the table owner, both of which bypass RLS. Read [row-level-security.md](references/row-level-security.md).

7. **After writing SQL, run it and read the plan.** Correct-looking SQL silently returns wrong results through `NULL` semantics, join fan-out, and `GROUP BY` scope. Correct-looking DDL silently rewrites a table. Execute against a real instance with representative data.

Every reference carries a **`## Version notes`** section stating what differs across PostgreSQL 14 to 18, and a **`## Gotchas`** list of the specific mistakes agents make in that area. Read the gotchas even when skimming.

## Determining the Version and Platform

**Step 1.** `SELECT version();` and `SHOW server_version_num;`. Never infer the server version from a client (`psql --version`) or a driver.

**Step 2.** Identify the platform. Self-hosted, Amazon RDS or Aurora, Cloud SQL, Azure Flexible Server, Supabase, Neon. This decides whether you have superuser, which extensions exist (`SELECT * FROM pg_available_extensions`), whether you control `postgresql.conf`, and whether a pooler sits in front of you.

**Step 3.** Check for a pooler before recommending anything session-scoped. `SHOW max_connections`, then find out whether PgBouncer, RDS Proxy, Supavisor or pgcat is in the path and in which pool mode. Transaction-mode pooling breaks session state and is the single most common cause of RLS leaks. Read [connections-and-pooling.md](references/connections-and-pooling.md).

**Step 4.** Read the existing schema before proposing changes: `\d+ tablename`, `pg_indexes`, `pg_constraint`. Match existing naming and modelling conventions, and raise the conflict rather than silently mixing styles.

**Step 5.** New projects: **PostgreSQL 18**. Read [postgres-versions.md](references/postgres-versions.md) for the upgrade path and the per-version feature gates.

## Designing a Schema From a Spec, In Order

Do not write DDL from the first description. Work these in order; each one changes the output of the next.

| # | Step | Read |
|---|---|---|
| 0 | Interrogate the spec: entities, cardinalities, lifecycles, access patterns, volumes, retention | [requirements-to-schema.md](references/requirements-to-schema.md) |
| 1 | Decide the tenancy model before any table exists - it is the hardest decision to reverse | [multi-tenancy.md](references/multi-tenancy.md) |
| 2 | Normalise to 3NF, then denormalise only where a measurement demands it | [normalisation.md](references/normalisation.md) |
| 3 | Model the relationships, including hierarchies and the polymorphic-association trap | [relationships.md](references/relationships.md) |
| 4 | Choose keys: surrogate vs natural, `bigint` identity vs UUIDv7 | [keys-and-identifiers.md](references/keys-and-identifiers.md) |
| 5 | Choose column types, and reject the six banned ones | [data-types.md](references/data-types.md) |
| 6 | Decide what history the system must keep before you allow the first `UPDATE` | [temporal-and-history.md](references/temporal-and-history.md) |
| 7 | Write every constraint the domain implies | [constraints.md](references/constraints.md) |
| 8 | Decide what stays relational and what earns `jsonb` | [jsonb.md](references/jsonb.md) |
| 9 | Name everything consistently, and lay out schemas and roles | [naming-and-conventions.md](references/naming-and-conventions.md) · [schema-organisation.md](references/schema-organisation.md) |
| 10 | Index for the access patterns from step 0, not speculatively | [indexing-fundamentals.md](references/indexing-fundamentals.md) |
| 11 | Ship it as a reversible, lock-aware migration | [migrations.md](references/migrations.md) |

## Optimising a Slow Query, In Order

Never start by adding an index. Start by finding out what is actually slow and why.

| # | Step | Read |
|---|---|---|
| 0 | Establish what "slow" means and which query - measure, do not guess | [performance-triage.md](references/performance-triage.md) |
| 1 | Get the plan: `EXPLAIN (ANALYZE, BUFFERS)`, and compare estimated against actual rows | [explain.md](references/explain.md) |
| 2 | A large estimate/actual gap is a statistics problem, not an index problem | [statistics-and-planner.md](references/statistics-and-planner.md) |
| 3 | Fix the query shape before touching the schema | [query-optimisation.md](references/query-optimisation.md) |
| 4 | Only now consider an index, and check the ones that already exist first | [indexing-fundamentals.md](references/indexing-fundamentals.md) · [index-types.md](references/index-types.md) |
| 5 | If the table is bloated, no index will save it | [mvcc-and-vacuum.md](references/mvcc-and-vacuum.md) |
| 6 | If it is slow only under load, it is locking or pooling, not the plan | [locking.md](references/locking.md) · [connections-and-pooling.md](references/connections-and-pooling.md) |
| 7 | Structural last resorts: partitioning, materialised views, replicas | [partitioning.md](references/partitioning.md) · [views.md](references/views.md) · [replication-and-scaling.md](references/replication-and-scaling.md) |

## Foundations

- **PostgreSQL Versions**: The 14-18 support matrix, what each version added and changed, the PG18 defaults that alter existing DDL, PG19 in beta, and the upgrade path. Read [postgres-versions.md](references/postgres-versions.md)
- **Naming and Conventions**: `snake_case` and why unquoted identifiers fold to lower case, singular vs plural, and naming schemes for constraints, indexes and enum-like values. Read [naming-and-conventions.md](references/naming-and-conventions.md)
- **Schema Organisation**: Databases vs schemas, `search_path` and its security implications, where extensions belong, and the `public` schema change in PG15. Read [schema-organisation.md](references/schema-organisation.md)
- **SQL Style**: Formatting that survives review and diffs, keyword case, join layout, and why generated SQL still needs a house style. Read [sql-style.md](references/sql-style.md)

## Design and Architecture

- **Requirements to Schema**: The questions to ask before writing DDL, turning a spec into entities and cardinalities, capturing access patterns and volumes, and the modelling decisions that are expensive to reverse. Read [requirements-to-schema.md](references/requirements-to-schema.md)
- **Multi-Tenancy**: Shared schema with `tenant_id` and RLS, schema-per-tenant, database-per-tenant, and the hybrid. Where each actually breaks, the decision matrix, and promoting a tenant out. Read [multi-tenancy.md](references/multi-tenancy.md)
- **Normalisation**: 1NF to BCNF worked concretely, what each normal form prevents, and the narrow, measured cases for denormalising. Read [normalisation.md](references/normalisation.md)
- **Data Types**: The selection guide by category, the six banned types and their replacements, `numeric` for money, `timestamptz` always, arrays, ranges, domains, and TOAST. Read [data-types.md](references/data-types.md)
- **Keys and Identifiers**: Surrogate vs natural keys, `bigint GENERATED ALWAYS AS IDENTITY` vs UUID, why UUIDv4 hurts B-tree locality and UUIDv7 fixes it, and composite keys. Read [keys-and-identifiers.md](references/keys-and-identifiers.md)
- **Constraints**: `NOT NULL`, `CHECK`, `UNIQUE` and `NULLS NOT DISTINCT`, foreign keys and their actions, `EXCLUDE`, `DOMAIN`, deferrable constraints, and validating without a long lock. Read [constraints.md](references/constraints.md)
- **Relationships**: One-to-one, one-to-many, many-to-many, self-references and hierarchies, why polymorphic associations defeat foreign keys, and the alternatives. Read [relationships.md](references/relationships.md)
- **Temporal and History**: Audit trails, soft deletes and the damage they do, slowly changing dimensions, range types with `WITHOUT OVERLAPS`, and system-versioned patterns. Read [temporal-and-history.md](references/temporal-and-history.md)
- **JSONB**: When a column earns `jsonb` and when it is a modelling failure, `json` vs `jsonb`, operators and path expressions, indexing strategies, and constraining a schemaless column. Read [jsonb.md](references/jsonb.md)

## Writing SQL

- **NULL Handling**: Three-valued logic, why `= NULL` never matches, `NOT IN` with NULLs, `DISTINCT` and `GROUP BY` treating NULLs as equal, aggregates skipping them, and `COALESCE` vs `NULLIF`. Read [null-handling.md](references/null-handling.md)
- **Joins**: Inner, outer, semi and anti joins, `LATERAL`, `EXISTS` vs `IN` vs `JOIN`, join fan-out silently multiplying aggregates, and why join order is the planner's job. Read [joins.md](references/joins.md)
- **Aggregation**: `GROUP BY` scope rules, `HAVING` vs `WHERE`, `FILTER`, `GROUPING SETS`/`ROLLUP`/`CUBE`, `DISTINCT ON`, ordered-set aggregates, and counting correctly. Read [aggregation.md](references/aggregation.md)
- **Window Functions**: Frames and the default frame trap, ranking functions, running totals, `LAG`/`LEAD`, and where a window beats a self-join. Read [window-functions.md](references/window-functions.md)
- **CTEs and Recursion**: `MATERIALIZED` vs `NOT MATERIALIZED` and the PG12 behaviour change, data-modifying CTEs and their snapshot semantics, and recursive queries over hierarchies and graphs. Read [ctes.md](references/ctes.md)
- **Upsert and Merge**: `INSERT ... ON CONFLICT` and the exact index it requires, `MERGE` from PG15, when each is correct, and the concurrency hazards of both. Read [upsert-and-merge.md](references/upsert-and-merge.md)
- **Pagination**: Why `OFFSET` degrades and duplicates rows, keyset pagination with row comparison, the matching index, and paginating an unstable sort. Read [pagination.md](references/pagination.md)
- **Dates and Times**: `timestamptz` semantics and what it does not store, `AT TIME ZONE`, intervals, `date_trunc` in a target zone, `generate_series` for gap filling, and range types. Read [dates-and-times.md](references/dates-and-times.md)
- **Full-Text Search**: `tsvector` and `tsquery`, always specifying a configuration, the generated-column pattern, ranking, highlighting, GIN vs GiST, and `pg_trgm` for fuzzy and substring matching. Read [full-text-search.md](references/full-text-search.md)
- **Views**: Views as an interface, updatable views, `security_barrier` and `security_invoker`, materialised views, `REFRESH ... CONCURRENTLY` and its unique-index requirement. Read [views.md](references/views.md)

## Indexing

- **Indexing Fundamentals**: How the planner decides to use an index, selectivity, why a correct index is ignored, the cost of every index on writes, and when not to index at all. Read [indexing-fundamentals.md](references/indexing-fundamentals.md)
- **Index Types**: B-tree, hash, GIN, GiST, SP-GiST, BRIN and the vector index types, what each is for, and the operator classes that matter. Read [index-types.md](references/index-types.md)
- **Composite and Covering Indexes**: Column order and the leftmost-prefix rule, PG18 skip scans, `INCLUDE`, index-only scans and the visibility map, and how many indexes a table needs. Read [composite-and-covering-indexes.md](references/composite-and-covering-indexes.md)
- **Partial and Expression Indexes**: Indexing a hot subset, the exact-match requirement for expression indexes, case-insensitive lookup, enforcing conditional uniqueness, and immutability. Read [partial-and-expression-indexes.md](references/partial-and-expression-indexes.md)
- **Index Maintenance**: Finding unused, duplicate and invalid indexes, bloat, `REINDEX CONCURRENTLY`, and building indexes without locking out writes. Read [index-maintenance.md](references/index-maintenance.md)

## Performance

- **EXPLAIN**: Reading a plan properly, the options worth using, estimated vs actual rows as the primary signal, `loops` and per-loop costs, every scan and join node, and the numbers that mislead. Read [explain.md](references/explain.md)
- **Query Optimisation**: The systematic method, anti-patterns that genuinely cost, the folklore that does not, sargability, and rewrites that reliably help. Read [query-optimisation.md](references/query-optimisation.md)
- **Statistics and the Planner**: `ANALYZE`, what `pg_stats` holds, `default_statistics_target`, extended statistics for correlated columns, and the cost settings that are wrong by default on SSDs. Read [statistics-and-planner.md](references/statistics-and-planner.md)
- **Performance Triage**: The diagnostic order, `pg_stat_statements`, `pg_stat_activity` and wait events, slow-query logging, `auto_explain`, and the table and index statistics views. Read [performance-triage.md](references/performance-triage.md)
- **Bulk Operations**: `COPY`, multi-row inserts, batching updates and deletes without long transactions, loading into a fresh table, and unlogged staging. Read [bulk-operations.md](references/bulk-operations.md)
- **Partitioning**: When partitioning helps and when it just adds complexity, range/list/hash, pruning vs constraint exclusion, the real constraint limitations, attach and detach, and retention. Read [partitioning.md](references/partitioning.md)

## Concurrency

- **Transactions and Isolation**: The three isolation levels Postgres implements, the anomalies each allows, serialisation failures and the mandatory retry loop, and why long transactions damage the whole database. Read [transactions-and-isolation.md](references/transactions-and-isolation.md)
- **Locking**: Table and row lock modes and what conflicts with what, `FOR UPDATE` vs `FOR NO KEY UPDATE`, `SKIP LOCKED` queues, advisory locks, deadlocks, and `lock_timeout`. Read [locking.md](references/locking.md)
- **MVCC and Vacuum**: Tuple versioning and visibility, HOT updates and `fillfactor`, bloat and how to measure it, autovacuum tuning, freezing and transaction ID wraparound. Read [mvcc-and-vacuum.md](references/mvcc-and-vacuum.md)

## Server-Side Code

- **Functions and Triggers**: When logic belongs in the database and when it does not, function volatility and why it changes plans, PL/pgSQL, trigger types and ordering, and the maintainability cost. Read [functions-and-triggers.md](references/functions-and-triggers.md)

## Production

- **Migrations**: The lock level of every common DDL statement, safe rewrites, expand/contract for zero downtime, `lock_timeout` and retry, backfilling large tables, and migration tooling. Read [migrations.md](references/migrations.md)
- **Security and Roles**: Role design and least privilege, `GRANT` and default privileges, ownership, `SECURITY DEFINER` and the `search_path` attack, and what the application role must never have. Read [security-and-roles.md](references/security-and-roles.md)
- **Row-Level Security**: Policies, `USING` vs `WITH CHECK`, `FORCE`, the unconditional superuser and `BYPASSRLS` bypass, the session-variable-under-pooling landmine, performance, and testing that isolation actually holds. Read [row-level-security.md](references/row-level-security.md)
- **Connections and Pooling**: Why connections are expensive, sizing a pool, PgBouncer pool modes, what transaction mode breaks, prepared statements through a pooler, and timeouts. Read [connections-and-pooling.md](references/connections-and-pooling.md)
- **Configuration**: The settings that actually matter and how to size them, memory, WAL and checkpoints, planner costs, autovacuum, timeouts, and what not to touch. Read [configuration.md](references/configuration.md)
- **Backup and Recovery**: Logical vs physical backups, `pg_dump` and its limits, PITR and WAL archiving, defining RPO and RTO, and why an untested restore is not a backup. Read [backup-and-recovery.md](references/backup-and-recovery.md)
- **Replication and Scaling**: Streaming vs logical replication, read replicas and replication lag, synchronous commit, what to scale first, and the honest limits of a single primary. Read [replication-and-scaling.md](references/replication-and-scaling.md)
- **Extensions**: The extensions worth installing, what each replaces, trust and availability on managed platforms, and version management. Read [extensions.md](references/extensions.md)

## Integration and Testing

- **Application Integration**: How Postgres surfaces through JDBC, JPA/Hibernate and TypeScript clients, N+1 and how to see it, transaction boundaries, connection lifecycle, type mapping, and error handling with retries. Read [application-integration.md](references/application-integration.md)
- **Testing**: Testing against real PostgreSQL rather than a substitute, Testcontainers, fixtures and isolation, testing migrations forwards and backwards, testing RLS, and performance regression tests. Read [testing.md](references/testing.md)

## Symptom Index

Start here when there is a concrete failure rather than a design question.

| Symptom | Read |
|---|---|
| Query got slow after data grew | [explain.md](references/explain.md) · [statistics-and-planner.md](references/statistics-and-planner.md) |
| Planner ignores an index that clearly matches | [indexing-fundamentals.md](references/indexing-fundamentals.md) |
| Estimated rows wildly different from actual | [statistics-and-planner.md](references/statistics-and-planner.md) |
| Table much larger on disk than its data | [mvcc-and-vacuum.md](references/mvcc-and-vacuum.md) |
| `ERROR: deadlock detected` | [locking.md](references/locking.md) |
| `ERROR: could not serialize access` | [transactions-and-isolation.md](references/transactions-and-isolation.md) |
| Migration hangs and blocks the application | [migrations.md](references/migrations.md) |
| `FATAL: sorry, too many clients already` | [connections-and-pooling.md](references/connections-and-pooling.md) |
| `ERROR: prepared statement "S_1" already exists` | [connections-and-pooling.md](references/connections-and-pooling.md) |
| A tenant can see another tenant's rows | [row-level-security.md](references/row-level-security.md) |
| RLS query returns zero rows unexpectedly | [row-level-security.md](references/row-level-security.md) |
| `ON CONFLICT` says no matching unique constraint | [upsert-and-merge.md](references/upsert-and-merge.md) |
| Aggregate totals inflated after adding a join | [joins.md](references/joins.md) |
| `NOT IN` returns nothing | [null-handling.md](references/null-handling.md) |
| Pagination repeats or skips rows | [pagination.md](references/pagination.md) |
| `functions in index expression must be marked IMMUTABLE` | [partial-and-expression-indexes.md](references/partial-and-expression-indexes.md) |
| Autovacuum cannot keep up / wraparound warnings | [mvcc-and-vacuum.md](references/mvcc-and-vacuum.md) |
| Replica lag growing | [replication-and-scaling.md](references/replication-and-scaling.md) |
| Timestamps shifted by hours | [dates-and-times.md](references/dates-and-times.md) |

## Checklist

- **Best Practices Checklist**: Every rule in one scannable list, plus the ones that cause the most damage. Use this for a review pass over an existing schema or query. Read [checklist.md](references/checklist.md)
