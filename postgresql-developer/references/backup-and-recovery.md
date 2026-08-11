# Backup and Recovery

**An untested restore is not a backup.** The only evidence a backup works is a restore that produced a working database, timed, recently.

Start from the two numbers, then choose the method:

- **RPO** (recovery point objective) - how much data may be lost. Nightly dumps mean up to 24 hours.
- **RTO** (recovery time objective) - how long recovery may take. A 2 TB `pg_restore` is hours.

Most teams discover their real RPO and RTO during the incident. Decide them first, then build backwards.

## Logical versus physical

| | Logical (`pg_dump`) | Physical (`pg_basebackup`, PITR) |
|---|---|---|
| What | SQL or an archive of the schema and data | Byte-level copy of the data directory |
| Granularity | Database, schema or table | Whole cluster only |
| Cross-version | Yes, restore to a newer major | **No.** Same major version, same architecture |
| Restore speed | Slow - replays SQL and rebuilds indexes | Fast - copy files and replay WAL |
| Point-in-time | No | **Yes**, with WAL archiving |
| Size | Smaller | Full cluster size |
| Load during backup | Significant | Lower |

**You need both.** Physical for disaster recovery and point-in-time; logical for extracting one table, moving between versions, and long-term archival.

## `pg_dump`

```sql
-- Custom format: compressed, parallel-restorable, selective. The default choice.
pg_dump -Fc -d appdb -f appdb.dump

-- Directory format: supports parallel dump as well as parallel restore
pg_dump -Fd -j 4 -d appdb -f appdb_dir/

-- Plain SQL: readable, only restorable with psql, no parallelism
pg_dump -Fp -d appdb -f appdb.sql
```

```sql
pg_restore -d appdb_new -j 4 appdb.dump
pg_restore -d appdb_new -t orders appdb.dump      -- one table
pg_restore -l appdb.dump > toc.txt                 -- inspect and reorder
```

Use `-Fc` or `-Fd`. Plain SQL cannot be restored selectively or in parallel.

What `pg_dump` does **not** capture:

- **Roles, users and passwords.** They are cluster-wide. Use `pg_dumpall --globals-only`.
- **Tablespace definitions.**
- **Other databases** in the cluster.
- **WAL**, so there is no point-in-time recovery.

A complete logical backup is therefore two commands:

```sql
pg_dumpall --globals-only -f globals.sql
pg_dump -Fc -d appdb -f appdb.dump
```

Forgetting the globals is the classic restore-day discovery: the data is there and nothing can log in.

`pg_dump` runs in a single `REPEATABLE READ` transaction, so the dump is consistent. That also means **it holds a transaction open for its full duration**, blocking the vacuum horizon cluster-wide. A multi-hour dump on a busy database causes real bloat. Take dumps from a replica where possible. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

It also takes `ACCESS SHARE` on every table, which blocks `ACCESS EXCLUSIVE` - so a dump running when a migration starts will block that migration, and the migration will then block everything else.

## Physical backup and PITR

Point-in-time recovery = a base backup + every WAL segment since. Restore to any moment in between, including the second before someone dropped a table.

### WAL archiving

```
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'
archive_timeout = 300
```

`archive_command` must return non-zero on failure, or PostgreSQL believes the segment is safe and recycles it. Use a purpose-built tool rather than `cp`.

**Monitor the archiver.** If it fails, WAL accumulates in `pg_wal` until the disk fills and the database stops:

```sql
SELECT * FROM pg_stat_archiver;   -- failed_count, last_failed_time, last_failed_wal
```

`archive_timeout` forces a segment switch so the RPO does not depend on write volume - a quiet database could otherwise take hours to fill a 16 MB segment.

### Base backup

```sql
pg_basebackup -D /backup/base -Ft -z -P -c fast
pg_basebackup -D /backup/base --incremental=/backup/base/backup_manifest   -- 17+
```

Incremental base backups (17+) copy only changed blocks, reassembled with `pg_combinebackup`. A substantial saving for large clusters.

### Restoring to a point in time

```
# postgresql.conf in the restored data directory
restore_command = 'cp /archive/%f %p'
recovery_target_time = '2026-08-11 14:30:00+01'
recovery_target_action = 'promote'
```

Plus a `recovery.signal` file in the data directory. The `recovery.conf` file was removed in PostgreSQL 12; recovery settings live in `postgresql.conf` with a signal file.

Other targets: `recovery_target_lsn`, `recovery_target_xid`, `recovery_target_name` (set by `pg_create_restore_point()`).

## Tools

Do not write your own. These handle retention, verification, parallelism, compression, encryption and cloud storage:

| Tool | Notes |
|---|---|
| **pgBackRest** | The most capable. Parallel, incremental, encryption, S3/Azure/GCS, backup verification |
| **Barman** | Mature, good for managing many servers centrally |
| **WAL-G** | Lightweight, cloud-native, good compression |
| **pg_probackup** | Incremental at block level, built-in validation |

All of them do things a shell script will not: verify checksums, detect a broken archive before you need it, and expire old backups correctly.

## Managed platforms

RDS, Cloud SQL and Azure provide automated backups and PITR, typically with 7 to 35 days of retention.

Three things they do not do:

- **Protect against account compromise or accidental instance deletion.** Backups usually live in the same account. Take periodic logical dumps to separate storage.
- **Exceed their retention window.** Long-term or regulatory retention needs your own dumps.
- **Let you test a restore cheaply.** They do, but nobody does it - and the platform's restore path is exactly as untested as anyone else's until you run it.

## Testing restores

The part that is skipped, and the part that is the entire point.

**Monthly, and after any significant change:**

1. Restore to a fresh instance, from the actual backup artefact.
2. **Time it.** That number is your real RTO.
3. Verify: row counts on key tables, the latest timestamps, a handful of application queries.
4. Confirm roles and permissions came across - restore the globals too.
5. Run `ANALYZE`. On 17 and earlier, statistics are not carried across, and a restored database with no statistics performs terribly. See [statistics-and-planner.md](statistics-and-planner.md).
6. Document the actual steps as a runbook, with the commands.

Automate it. A restore test in CI against last night's backup is entirely achievable and catches everything a monitoring check cannot.

## The failure modes

**A backup that has been failing for weeks.** Nothing alerts because nothing checks. Monitor backup **success**, backup **age**, and backup **size** - a backup that suddenly halves in size is a signal.

**Backups on the same disk, host or account as the database.** A backup that dies with the primary is not a backup. Off-host, and ideally off-account.

**No test of the restore path.** Roles missing, extensions absent, a version mismatch, a `restore_command` that never worked.

**WAL archiving broken while base backups succeed.** The base backup is useless for PITR without continuous WAL. Check `pg_stat_archiver`.

**A `pg_dump` that never completes** on a growing database, so the last usable backup is older than anyone thinks.

**Extensions.** A restore into a cluster without the same extensions fails partway. Record which extensions and versions are needed. See [extensions.md](extensions.md).

## Retention

```
Daily   -> keep 7
Weekly  -> keep 4
Monthly -> keep 12
Yearly  -> keep as regulation requires
```

Plus continuous WAL for the PITR window. Retention is a compliance question as much as a technical one - and personal data in old backups is within scope of a deletion request, which is worth deciding before one arrives.

## Version notes

- **18** - `pg_upgrade` can carry statistics across; data checksums on by default, so `pg_basebackup` and `pg_verifybackup` detect corruption more readily. Checksum settings must match between clusters for `pg_upgrade`.
- **17+** - incremental base backups via `pg_basebackup --incremental` and `pg_combinebackup`.
- **15+** - `pg_basebackup` server-side compression, reducing network transfer.
- **14+** - `pg_verifybackup`.
- **12+** - `recovery.conf` removed; recovery settings moved to `postgresql.conf` plus a `recovery.signal` file. Any guide mentioning `recovery.conf` predates every supported version.

Logical and physical backup semantics are otherwise identical across 14 to 18.

## Gotchas

- Agent sets up backups and never tests a restore - the restore path is unverified until it is used in an emergency
- Agent uses `pg_dump` without `pg_dumpall --globals-only` - roles and passwords are cluster-wide and are not in the dump
- Agent uses plain SQL format - cannot be restored selectively or in parallel
- Agent relies on `pg_dump` alone - no point-in-time recovery, so the RPO is the dump interval
- Agent runs a long `pg_dump` on the primary - it holds a transaction open, blocking the vacuum horizon cluster-wide
- Agent does not monitor `pg_stat_archiver` - a failing archiver fills `pg_wal` until the disk is full and the database stops
- Agent uses `cp` as `archive_command` without checking the exit status - PostgreSQL then recycles WAL that was never archived
- Agent stores backups on the same host or cloud account as the database - they die together
- Agent monitors backup jobs but not backup age or size - a job that succeeds while producing nothing looks healthy
- Agent restores and does not run `ANALYZE` - on 17 and earlier statistics are not carried across
- Agent restores without the required extensions installed - the restore fails partway
- Agent assumes a physical backup can be restored to a different major version - it cannot; that needs a logical dump
- Agent references `recovery.conf` - removed in 12; recovery settings live in `postgresql.conf` with a signal file
- Agent relies solely on a managed platform's backups - they do not survive account compromise or instance deletion, and retention is capped

## Related

- [replication-and-scaling.md](replication-and-scaling.md) · [configuration.md](configuration.md) · [postgres-versions.md](postgres-versions.md) · [extensions.md](extensions.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [statistics-and-planner.md](statistics-and-planner.md) · [testing.md](testing.md) · [security-and-roles.md](security-and-roles.md)
