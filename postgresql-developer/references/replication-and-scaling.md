# Replication and Scaling

Scale in this order: fix the queries, fix the indexes, fix the configuration, get a bigger machine, add read replicas, and only then shard. Most systems that reach for sharding needed an index.

A single well-tuned PostgreSQL instance on modern hardware handles far more than people expect - tens of thousands of transactions per second, terabytes of data. Exhaust vertical scaling first; it is cheaper than the operational cost of a distributed system.

## Streaming (physical) replication

The primary ships WAL to standbys, which replay it byte for byte. The standby is an exact copy of the entire cluster and is read-only.

```
# Primary
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
```

```
pg_basebackup -h primary -D /var/lib/postgresql/data -U replicator -R -P
```

`-R` writes the connection settings and creates `standby.signal`.

Characteristics:

- **Whole cluster.** Cannot replicate one database or one table.
- **Same major version**, same architecture.
- **Read-only** standby, and DDL replicates automatically.
- **Low overhead**, close to zero on the primary.

### Replication slots

A slot makes the primary retain WAL until the standby has consumed it, so a standby can disconnect and catch up.

**An inactive slot retains WAL forever.** The disk fills and the primary stops. This is the most common self-inflicted replication outage.

```sql
SELECT slot_name, active, wal_status,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM   pg_replication_slots ORDER BY restart_lsn;
```

Set `max_slot_wal_keep_size` (13+) so a dead slot is invalidated rather than filling the disk:

```sql
ALTER SYSTEM SET max_slot_wal_keep_size = '100GB';
```

The standby then has to be rebuilt, which is much better than the primary stopping. **Always set this.**

An inactive slot also holds back the **vacuum horizon**, so dead tuples accumulate cluster-wide. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

### Synchronous replication

```sql
ALTER SYSTEM SET synchronous_standby_names = 'ANY 1 (standby1, standby2)';
ALTER SYSTEM SET synchronous_commit = 'on';
```

Commits wait for a standby to confirm. Zero data loss on primary failure, at the cost of commit latency equal to the round trip - and **if every synchronous standby is down, commits block indefinitely**. With one synchronous standby you have made availability worse, not better: two machines must now be up. Use `ANY 1` of two or more.

`synchronous_commit` levels: `off`, `local`, `remote_write`, `on`, `remote_apply`. `remote_apply` guarantees a read on the standby sees the commit, and is the slowest.

## Logical replication

Publishes row-level changes decoded from WAL, per table.

```sql
-- Publisher
CREATE PUBLICATION app_pub FOR TABLE orders, customers;
CREATE PUBLICATION tenant_42 FOR TABLE orders WHERE (tenant_id = 42);   -- 15+

-- Subscriber
CREATE SUBSCRIPTION app_sub
    CONNECTION 'host=primary dbname=appdb user=repl'
    PUBLICATION app_pub;
```

Characteristics:

- **Selective**: specific tables, specific rows (15+), specific columns (15+).
- **Cross-version**, so it is the standard mechanism for near-zero-downtime major upgrades.
- **Writable subscriber**, which is what makes it usable for migrations.
- Higher overhead than streaming.

### What it does not replicate

This list is the source of most logical replication surprises:

- **DDL.** Schema changes must be applied to both sides manually, subscriber first for additive changes.
- **Sequences.** Their values do not advance on the subscriber. Advance them at cutover or the first insert collides.
- **`TRUNCATE`**, unless included in the publication.
- **Large objects.**
- Tables need a **replica identity** - the primary key by default. A table with none cannot replicate `UPDATE` or `DELETE`, and needs `REPLICA IDENTITY FULL`, which ships the whole old row. See [keys-and-identifiers.md](keys-and-identifiers.md).

Conflicts (a duplicate key on the subscriber) **stop replication** until resolved manually. Monitor `pg_stat_subscription`.

### Uses

- **Major version upgrades** with seconds of downtime.
- **Migrating a tenant** to a dedicated database. See [multi-tenancy.md](multi-tenancy.md).
- **Feeding a data warehouse or search index.**
- **Consolidating** several databases into one.

## Read replicas

The first real scaling step for a read-heavy workload.

### Lag

```sql
-- Primary
SELECT client_addr, state, sync_state,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_lag_bytes
FROM   pg_stat_replication;

-- Replica
SELECT now() - pg_last_xact_replay_timestamp() AS replay_lag;
```

Lag is normal. Handling it is the application's job:

- **Read-your-own-writes.** A user who just saved something must see it. Either route that user's reads to the primary for a window, or capture the commit LSN and wait for the replica to reach it.
- **Route by tolerance**, not by statement type. Analytics tolerate a minute; a checkout page does not.
- **Monitor and alert** on lag. A replica hours behind is serving data nobody expects.

### Conflicts

A long query on a replica conflicts with WAL replay that would remove rows it is reading. The replica either delays replay or cancels the query:

```
ERROR: canceling statement due to conflict with recovery
```

Two levers:

- `max_standby_streaming_delay` - how long replay may be delayed for a query. Raising it increases lag.
- `hot_standby_feedback = on` - the replica tells the primary its oldest snapshot, so the primary does not remove rows still needed. This **holds back the primary's vacuum horizon**, so a long query on a replica causes bloat on the primary.

Both trade availability of one thing for another. For a reporting replica, `hot_standby_feedback = on` with monitoring on the primary's bloat is usually right.

## Failover

Replication is not high availability. Something must detect failure, promote a standby, and repoint clients.

| Tool | Notes |
|---|---|
| **Patroni** | The de facto standard. Uses etcd/Consul/Kubernetes for consensus |
| **repmgr** | Simpler, less automatic |
| **pg_auto_failover** | Microsoft's, straightforward for small setups |
| Managed (RDS Multi-AZ, Cloud SQL HA) | Handled for you |

**Split brain** - two nodes accepting writes - is the failure that loses data irrecoverably. Proper fencing needs a consensus store, which is why Patroni exists and why hand-rolled failover scripts are a bad idea.

Clients need to follow the promotion: a virtual IP, a proxy such as HAProxy or PgBouncer, service discovery, or libpq's multi-host connection string with `target_session_attrs=read-write`.

**Test failover.** A promotion path that has never been exercised does not work.

## Scaling writes

Replicas do not help writes. In order:

1. **Reduce the write volume.** Batch, remove unused indexes (each is a write amplifier), avoid updating indexed columns so HOT updates apply. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).
2. **Tune WAL and checkpoints.** `max_wal_size`, `wal_compression`. See [configuration.md](configuration.md).
3. **Faster storage.** Write throughput is usually I/O bound.
4. **Partition** to make maintenance tractable and cut index depth. See [partitioning.md](partitioning.md).
5. **Vertical scaling.** Still the cheapest answer at most scales.
6. **Shard.**

### Sharding

The last resort, and it gives up cross-shard transactions, cross-shard joins, and global uniqueness.

| Approach | Notes |
|---|---|
| **Application-level** | Full control, full responsibility. Routing, rebalancing, cross-shard queries all yours |
| **Citus** | Extension turning PostgreSQL into a distributed database. Mature. Best for multi-tenant, where the tenant is a natural shard key |
| **postgres_fdw** | Federate across servers. No distributed transactions, and pushdown is limited |

For a multi-tenant SaaS, sharding by tenant is the natural key and Citus is designed for exactly that shape. Before committing, confirm the workload genuinely does not need cross-tenant queries - because after sharding it cannot have them.

## Version notes

- **18** - asynchronous I/O improves replay throughput on standbys.
- **17+** - failover slots survive a switchover, so logical subscribers do not need reconfiguring after promotion. `pg_createsubscriber` converts a physical standby into a logical subscriber, which makes upgrade paths much easier.
- **16+** - logical replication **from a standby**, offloading decoding from the primary; parallel apply of large transactions.
- **15+** - publication row filters and column lists, which make single-tenant replication practical.
- **14+** - streaming of in-progress transactions, reducing apply latency for large transactions.
- **13+** - `max_slot_wal_keep_size`, without which an abandoned slot fills the disk. Set it.

Streaming replication, replica identity requirements and standby conflict handling are otherwise identical across 14 to 18.

## Gotchas

- Agent adds read replicas to solve a write bottleneck - replicas do not help writes
- Agent shards before exhausting indexing, configuration and vertical scaling - most systems that reach for sharding needed an index
- Agent creates a replication slot without `max_slot_wal_keep_size` - an abandoned slot retains WAL until the disk fills and the primary stops
- Agent forgets an inactive slot also holds back the vacuum horizon - bloat accumulates cluster-wide
- Agent configures one synchronous standby - commits block if it is down, so availability is worse than with none
- Agent routes reads to a replica without handling lag - a read after a write may not see it
- Agent expects logical replication to carry DDL - it does not; apply schema changes to both sides
- Agent migrates with logical replication and forgets sequences - the first insert on the target collides
- Agent replicates a table with no primary key - `UPDATE` and `DELETE` cannot replicate without `REPLICA IDENTITY FULL`
- Agent does not monitor `pg_stat_subscription` - a conflict stops replication until resolved manually
- Agent enables `hot_standby_feedback` without monitoring primary bloat - a long replica query holds the primary's vacuum horizon
- Agent treats streaming replication as high availability - something must detect failure and promote
- Agent builds hand-rolled failover without a consensus store - split brain loses data irrecoverably
- Agent never tests failover - an unexercised promotion path does not work
- Agent tries to restore a physical backup to a different major version - use logical replication or a dump

## Related

- [backup-and-recovery.md](backup-and-recovery.md) · [configuration.md](configuration.md) · [connections-and-pooling.md](connections-and-pooling.md) · [multi-tenancy.md](multi-tenancy.md) · [partitioning.md](partitioning.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [performance-triage.md](performance-triage.md) · [postgres-versions.md](postgres-versions.md)
