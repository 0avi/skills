# Partitioning

Partitioning splits one logical table into physical child tables. It is frequently reached for as a performance fix and frequently makes things worse.

**Partitioning is primarily a data-lifecycle tool, not a query-speed tool.** Its strongest benefit is that `DROP TABLE` on a partition is instantaneous, whereas `DELETE` on the equivalent rows is slow, bloats the table, and generates enormous WAL.

## When it helps

- **Time-based retention.** Drop last year's partition instead of deleting a billion rows. This alone justifies it.
- **Bulk replacement.** Load into a fresh table, attach it, detach the old one.
- **Queries that always filter on the partition key**, so pruning eliminates most of the data.
- **Very large tables** where per-partition vacuum and index builds are tractable and a whole-table one is not.
- **Per-partition maintenance** - vacuuming a 50 GB partition is manageable; a 5 TB table is not.

## When it does not

- **Queries that do not filter on the partition key.** Every partition is scanned, plus per-partition planning overhead. This is worse than one table.
- **Tables under about 50 to 100 GB.** A correct index beats partitioning at that size, and adds no complexity.
- **Wanting a smaller index.** A B-tree is `O(log n)`; splitting 100 million rows into ten partitions of 10 million saves roughly one index-node visit.
- **Many small partitions.** Planning cost grows with partition count. Thousands of partitions makes planning slower than the query.

The planner handles up to a few thousand partitions reasonably **provided pruning eliminates almost all of them**. If queries routinely touch hundreds of partitions, planning dominates.

## Declarative partitioning

```sql
CREATE TABLE events (
    id          bigint GENERATED ALWAYS AS IDENTITY,
    occurred_at timestamptz NOT NULL,
    user_id     bigint      NOT NULL,
    payload     jsonb       NOT NULL DEFAULT '{}',
    PRIMARY KEY (id, occurred_at)          -- must include the partition key
) PARTITION BY RANGE (occurred_at);

CREATE TABLE events_2026_08 PARTITION OF events
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE events_default PARTITION OF events DEFAULT;
```

**Never use table inheritance for partitioning.** It predates declarative partitioning, requires triggers for routing, and does not support pruning at execution time. If you meet it in an existing schema, it is legacy.

### The three strategies

| Strategy | Bounds | Use |
|---|---|---|
| `RANGE` | `FROM (a) TO (b)`, lower inclusive, upper **exclusive** | Time series. The common case |
| `LIST` | `IN ('a','b')` | Discrete categories: region, tenant, status |
| `HASH` | `WITH (MODULUS n, REMAINDER r)` | Even distribution with no natural key. Cannot be used for retention |

`HASH` gives balanced partitions and gives up the main benefit - you cannot drop a hash partition to expire data, because rows are scattered across all of them.

### The default partition

A `DEFAULT` partition catches rows matching no other. Without one, an insert outside every range **fails**, which is how a partitioned table stops accepting writes at midnight when nobody created next month's partition.

The trade: attaching a new partition must scan the default partition to prove no rows belong in the new range, taking an `ACCESS EXCLUSIVE` lock on it. On a large default partition that is a long lock.

Best practice: keep a default partition **and** monitor it, so anything landing there is an alert rather than a silent accumulation.

## The real limitations

**Every unique constraint and primary key must include the partition key.** This is the constraint that most often makes partitioning unworkable.

```sql
PRIMARY KEY (id)                -- rejected on a table partitioned by occurred_at
PRIMARY KEY (id, occurred_at)   -- required
```

Because each partition's index enforces uniqueness only within itself, PostgreSQL cannot guarantee global uniqueness unless the partition key is part of the key. So a globally unique `id` is **not enforceable** on a partitioned table unless you partition by `id`. If global uniqueness is genuinely required, partitioning may be the wrong tool.

**Foreign keys, correctly stated:**

- A partitioned table **can** have foreign keys referencing other tables. Supported since PostgreSQL 11.
- Other tables **can** have foreign keys referencing a partitioned table. Supported since PostgreSQL 12.
- Both work on every supported version. Claims that "foreign keys are not supported on partitioned tables, use triggers instead" are years out of date.
- `ATTACH PARTITION` is disallowed if the table being attached has a foreign key referencing the partitioned table it is joining.
- `NOT VALID` foreign keys on partitioned tables arrived in **18**.

**`CREATE INDEX CONCURRENTLY` is not supported on the parent.** Build per partition, then attach. See [index-maintenance.md](index-maintenance.md).

**`BEFORE ROW` triggers on `INSERT` cannot change the destination partition.**

**Partitions must have exactly the same columns as the parent.** No extra columns, unlike inheritance.

## Pruning, not constraint exclusion

Two distinct mechanisms, routinely confused:

| | Partition pruning | Constraint exclusion |
|---|---|---|
| Uses | Partition bounds | `CHECK` constraints |
| Applies to | Declarative partitioning | Legacy inheritance partitioning |
| When | **Plan time and execution time** | Plan time only |
| Setting | `enable_partition_pruning` (default on) | `constraint_exclusion` (default `partition`) |

**Declarative partitioning uses pruning and needs no `CHECK` constraints.** Advice to add `CHECK` constraints to partitions so the planner can prune is about the legacy inheritance approach and does not apply.

Execution-time pruning matters: it handles parameters and subquery results that are unknown at plan time. `EXPLAIN` shows `Subplans Removed: N`.

Pruning only works if the query filters on the **partition key**:

```sql
WHERE occurred_at >= '2026-08-01' AND occurred_at < '2026-09-01'   -- prunes
WHERE user_id = 42                                                 -- scans every partition
WHERE occurred_at::date = '2026-08-15'                             -- may not prune: expression on the key
```

Verify with `EXPLAIN` that only the expected partitions appear.

## Attaching and detaching

```sql
-- Detach without a long lock (14+)
ALTER TABLE events DETACH PARTITION events_2025_01 CONCURRENTLY;
DROP TABLE events_2025_01;
```

Plain `DETACH` takes `ACCESS EXCLUSIVE` on the parent. `CONCURRENTLY` (14+) does not, but cannot run inside a transaction block and can leave the partition in a transitional state if interrupted - finish with `ALTER TABLE ... DETACH PARTITION ... FINALIZE`.

Attaching validates that existing rows fall within the new bounds, scanning the table. Skip the scan with a matching `CHECK` constraint added `NOT VALID` and validated beforehand:

```sql
ALTER TABLE events_2026_09 ADD CONSTRAINT events_2026_09_range_check
    CHECK (occurred_at >= '2026-09-01' AND occurred_at < '2026-10-01') NOT VALID;
ALTER TABLE events_2026_09 VALIDATE CONSTRAINT events_2026_09_range_check;
ALTER TABLE events ATTACH PARTITION events_2026_09
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');   -- no scan
```

## Creating partitions ahead of time

Nothing creates them automatically. Options:

- **`pg_partman`** - the standard extension. Creates partitions ahead, drops old ones, optionally detaches to archive. Use this unless there is a reason not to.
- **`pg_cron`** plus a function - simpler, one less extension.
- **An external scheduler.**

Whichever, **alert on the absence of the next partition**, not just on failure. A silent scheduler failure means writes start landing in the default partition, or failing, at midnight on the first of the month.

## Indexes

An index created on the parent is a template: PostgreSQL creates a matching index on every existing partition and on every partition created later.

```sql
CREATE INDEX events_user_id_idx ON events (user_id);   -- recurses to all partitions
```

Each partition also gets its own statistics, which is a genuine benefit - per-partition selectivity is far more accurate than whole-table statistics.

But **autovacuum analyses partitions, not the partitioned parent.** The parent's own statistics, used for cross-partition queries, only update when `ANALYZE events` is run explicitly. Schedule it. See [statistics-and-planner.md](statistics-and-planner.md).

## Partitioning by tenant

Tempting in a shared-schema multi-tenant design, and usually wrong. `LIST` partitioning by `tenant_id` needs a partition per tenant, so a thousand tenants is a thousand partitions, and provisioning a tenant becomes DDL.

`HASH` partitioning by `tenant_id` distributes evenly with a fixed partition count, keeps each tenant's rows physically together, and gives per-partition statistics - which addresses the shared-statistics problem in [multi-tenancy.md](multi-tenancy.md). It gives up the ability to drop a tenant's data by dropping a partition.

Partition by tenant only for a small number of very large tenants, as an alternative to promoting them out.

## Version notes

- **18** - `NOT VALID` foreign keys on partitioned tables; dropping constraints `ONLY` on a partitioned table; `VACUUM`/`ANALYZE ... ONLY` to process the parent without children.
- **17+** - `MERGE` and `SPLIT` partition commands; better pruning for some `IN` and `OR` shapes.
- **14+** - `DETACH PARTITION CONCURRENTLY`; faster pruning and faster `COPY` into partitioned tables.
- **12+** - foreign keys may reference a partitioned table; substantial pruning improvements.
- **11+** - a partitioned table may have foreign keys; default partitions; `ON CONFLICT DO UPDATE` on partitioned tables.

Advice written against PostgreSQL 10 or 11 about foreign keys and partitioning is obsolete on every supported version.

## Gotchas

- Agent partitions to make queries faster - the main benefit is cheap data lifecycle; a correct index is usually the answer for speed
- Agent partitions a table under 100 GB - the complexity is not repaid
- Agent partitions on a column the queries do not filter on - every partition is scanned, plus planning overhead
- Agent claims foreign keys are unsupported on partitioned tables - supported since 11 in one direction and 12 in the other
- Agent adds `CHECK` constraints so the planner can prune declarative partitions - pruning uses bounds; that advice is for legacy inheritance
- Agent confuses `constraint_exclusion` with `enable_partition_pruning` - different mechanisms for different partitioning styles
- Agent declares `PRIMARY KEY (id)` on a partitioned table - every unique constraint must include the partition key
- Agent assumes global uniqueness is enforceable on a partitioned table - it is not, unless partitioned by that key
- Agent creates no `DEFAULT` partition and no automation - inserts fail the moment data arrives outside every range
- Agent creates a `DEFAULT` partition and never monitors it - rows accumulate silently, and attaching a new partition then needs a long scan of it
- Agent uses table inheritance for partitioning - legacy; requires trigger routing and has no execution-time pruning
- Agent tries `CREATE INDEX CONCURRENTLY` on the parent - unsupported; build per partition and attach
- Agent relies on autovacuum to analyse the partitioned parent - only partitions are analysed automatically
- Agent creates thousands of partitions - planning time grows with partition count
- Agent uses `HASH` partitioning and expects to drop old data by partition - hash scatters rows across all partitions

## Related

- [bulk-operations.md](bulk-operations.md) · [indexing-fundamentals.md](indexing-fundamentals.md) · [index-maintenance.md](index-maintenance.md) · [statistics-and-planner.md](statistics-and-planner.md) · [multi-tenancy.md](multi-tenancy.md) · [temporal-and-history.md](temporal-and-history.md) · [migrations.md](migrations.md) · [constraints.md](constraints.md)
