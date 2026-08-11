# PostgreSQL Versions

PostgreSQL ships one major version a year, in September or October, and supports each for **five years**. Minor releases arrive quarterly and contain only bug and security fixes. Upgrading a minor version is a restart; upgrading a major version is a project.

## Support matrix

As of August 2026:

| Major | Released | End of life | Status |
|---|---|---|---|
| **18** | Sep 2025 | Sep 2030 | **Current. Use for new projects.** |
| 17 | Sep 2024 | Nov 2029 | Supported |
| 16 | Sep 2023 | Nov 2028 | Supported |
| 15 | Oct 2022 | Nov 2027 | Supported |
| 14 | Sep 2021 | **12 Nov 2026** | Supported, expiring within months |
| 13 and older | - | Nov 2025 or earlier | **End of life. No security fixes.** |
| 19 | ~Sep/Oct 2026 | - | Beta 2 as of Jul 2026. Not for production. |

A cluster on 13 or older receives no security patches. Treat that as a finding and raise it, whatever the question you were asked.

Get the real version before advising:

```sql
SELECT version();
SHOW server_version_num;   -- 180004 = 18.4. Easier to compare numerically.
```

Never infer the server version from `psql --version` or from a driver. Clients connect across versions routinely.

## What each version changed

Only the changes that alter how you should write schemas and queries. Full lists are in the release notes.

### 18 (current)

- **`VIRTUAL` is now the default for generated columns.** Previously `STORED` was the only option and the keyword was mandatory. Omitting the keyword on 18 silently produces a virtual column, which is computed on read, occupies no storage, cannot use user-defined functions or types, and is not logically replicated. Always write the keyword explicitly.

  Verified on 18.4: a column declared `GENERATED ALWAYS AS (a*2)` with no keyword reports `attgenerated = 'v'`, and
  ```
  CREATE INDEX ON t (b);   -- ERROR: indexes on virtual generated columns are not supported
  PRIMARY KEY (b)          -- ERROR: primary keys on virtual generated columns are not supported
  ```
  So a virtual column cannot be indexed, made unique, or used as a key. If the column exists to be looked up, it must be `STORED`.
- `uuidv7()` and `uuidv4()` functions. `uuidv7()` is timestamp-ordered and index-friendly. See [keys-and-identifiers.md](keys-and-identifiers.md).
- **B-tree skip scan**: a multicolumn index can now be used when the leading column is unconstrained, provided that column has few distinct values. This softens, but does not repeal, the leftmost-prefix rule. See [composite-and-covering-indexes.md](composite-and-covering-indexes.md).
- **`EXPLAIN ANALYZE` includes `BUFFERS` by default.** On 17 and below you must ask for it.
- **Data checksums enabled by default** in `initdb`. `pg_upgrade` requires both clusters to match, so an old cluster without checksums needs `--no-data-checksums` on the new one.
- Asynchronous I/O subsystem (`io_method`), improving sequential scans, bitmap heap scans and vacuum.
- Temporal constraints: `PRIMARY KEY`/`UNIQUE ... WITHOUT OVERLAPS` and `FOREIGN KEY ... PERIOD`. See [temporal-and-history.md](temporal-and-history.md).
- `NOT ENFORCED` for `CHECK` and foreign key constraints.
- `NOT NULL` constraints are stored in `pg_constraint`, so they can be named and marked `NOT VALID`. This makes adding `NOT NULL` to a large table safe. See [migrations.md](migrations.md).
- `OLD`/`NEW` aliases in `RETURNING` for `INSERT`/`UPDATE`/`DELETE`/`MERGE`.
- `NOT VALID` foreign keys on partitioned tables.
- OAuth authentication method.

### 17

- `MERGE` gained `RETURNING` and `WHEN NOT MATCHED BY SOURCE`.
- `COPY ... ON_ERROR ignore` to skip malformed rows during bulk load.
- Substantially faster vacuum, using far less memory for dead-tuple tracking.
- `pg_stat_checkpointer`, and `EXPLAIN (SERIALIZE)` and `MEMORY` options.
- Incremental backup via `pg_basebackup --incremental`.

### 16

- Parallelised `FULL` and internal-right hash joins.
- Logical replication from a standby, and parallel apply of large transactions.
- `pg_stat_io` for per-backend-type I/O statistics.
- `ANY_VALUE()` aggregate.

### 15

- **`MERGE`**. Before 15, `INSERT ... ON CONFLICT` is the only upsert. See [upsert-and-merge.md](upsert-and-merge.md).
- **`UNIQUE NULLS NOT DISTINCT`**. Before 15, a unique constraint always permits unlimited NULLs.
- **`CREATE` on the `public` schema is revoked from `PUBLIC`.** A migration that worked on 14 by creating objects in `public` as a non-owner fails on 15. See [schema-organisation.md](schema-organisation.md).
- `security_invoker` views. See [views.md](views.md).
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` performance improvements.

### 14

- Multirange types.
- `date_bin()`.
- Reduced B-tree bloat from index tuple cleanup.

Anything at or below 13 is out of support, but for reading old code: `NOT MATERIALIZED` CTEs and the change that lets the planner inline single-reference CTEs arrived in **12** ([ctes.md](ctes.md)); generated columns in **12**; `gen_random_uuid()` without `pgcrypto` in **13**; B-tree deduplication in **13**; `pg_stat_statements` renamed `total_time`/`mean_time` to `total_exec_time`/`mean_exec_time` in **13** ([performance-triage.md](performance-triage.md)).

### 19 (beta, not for production)

Announced so far: JIT disabled by default, `default_toast_compression` defaults to `lz4`, parallel autovacuum workers, self-tuning async I/O workers, and the `pg_plan_advice` extension for stabilising plans. Do not write code against it, and do not cite it as available.

## Choosing a version

**New projects: 18.** It is a year old, on 18.4, and carries the generated-column, UUIDv7 and skip-scan work that meaningfully changes schema design.

Do not adopt a major version in its first two or three minor releases for anything that matters. The `.0` of any major release has historically carried bugs found only under production load.

Match the version across development, CI and production. Testcontainers pinned to `postgres:16` while production runs 18 will silently pass a schema that behaves differently. See [testing.md](testing.md).

## Upgrading

| Method | Downtime | Use when |
|---|---|---|
| `pg_dump` / `pg_restore` | Hours on a large database | Small databases, or when you also want to change encoding or collation |
| `pg_upgrade --link` | Minutes | The default for most upgrades. Hard-links data files instead of copying |
| Logical replication | Seconds, at cutover | Large databases with a low downtime budget. Most operational work |

Three things that catch upgrades regardless of method:

1. **Collation changes.** A glibc or ICU version change alters text sort order, which silently corrupts every B-tree index on a text column. Indexes must be rebuilt. This is the single most common way an upgrade produces wrong query results rather than an error, because nothing fails loudly. `REINDEX` text indexes after any OS or collation library upgrade.
2. **Extension versions.** Extensions must exist and be compatible on the target. `ALTER EXTENSION ... UPDATE` after upgrading. See [extensions.md](extensions.md).
3. **Statistics are not carried over** by `pg_upgrade` before 18. Run `ANALYZE` across the whole database immediately after cutover, or the first production queries will run on no statistics at all and pick terrible plans. PostgreSQL 18's `pg_upgrade` can carry statistics across, which removes this step.

Always rehearse against a restored copy of production, and time it.

## Version notes

This file is the version reference. Every other reference states its own version dependencies in the same section.

When advice in this skill is version-bound, it says so inline. Where a reference says nothing about versions, the behaviour is the same across 14 to 18.

## Gotchas

- Agent gives advice without establishing the version - the generated-column default, `MERGE`, `NULLS NOT DISTINCT` and skip scan all change the correct answer
- Agent reads the version from `psql --version` or a driver - that is the client, which is routinely a different major version from the server
- Agent writes `GENERATED ALWAYS AS (...)` without `STORED` on 18 - that is now a virtual column, which cannot be indexed and is not replicated
- Agent recommends `MERGE` on 14 - it does not exist before 15
- Agent recommends `NULLS NOT DISTINCT` on 14 - it does not exist before 15
- Agent assumes the leading-column rule is repealed by PG18 skip scan - skip scan helps only when the leading column has low cardinality; column order still matters
- Agent uses `total_time`/`mean_time` in a `pg_stat_statements` query - renamed in 13, so that query fails on every supported version
- Agent treats PostgreSQL 19 features as available - it is in beta with no GA date reached
- Agent plans a major upgrade without rebuilding text indexes - a collation change silently corrupts them and produces wrong results with no error
- Agent runs `pg_upgrade` and hands over without `ANALYZE` - before 18 statistics are not carried over, so production starts with none
- Agent recommends a version that is end of life because it is common in the wild - 13 and below receive no security fixes

## Related

- [migrations.md](migrations.md) · [configuration.md](configuration.md) · [extensions.md](extensions.md) · [testing.md](testing.md) · [backup-and-recovery.md](backup-and-recovery.md)
