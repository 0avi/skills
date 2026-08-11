# Migrations

Migrations are the most common way to cause a database outage. Not because the DDL is wrong, but because of the lock it takes and how long it waits for it.

## The lock queue is the whole problem

Lock requests **queue in order**. A statement waiting for `ACCESS EXCLUSIVE` blocks every request behind it, including ones that would not have conflicted with the current holder.

```
1. A reporting SELECT holds ACCESS SHARE for 45 seconds
2. ALTER TABLE requests ACCESS EXCLUSIVE       -> waits
3. Every subsequent SELECT and INSERT          -> waits behind the ALTER
```

The `ALTER TABLE` itself might take a millisecond. The outage lasts 45 seconds and takes down everything touching that table.

**Every migration sets `lock_timeout`.** Fail fast, retry, rather than queue:

```sql
SET lock_timeout = '3s';
SET statement_timeout = '30s';
ALTER TABLE orders ADD COLUMN discount_code text;
```

If it times out, retry with backoff. A migration that fails three times is telling you there is a long-running transaction to deal with first.

## Lock levels of common DDL

| Statement | Lock | Rewrites table? |
|---|---|---|
| `ADD COLUMN` (nullable, no default) | ACCESS EXCLUSIVE | No, metadata only |
| `ADD COLUMN ... DEFAULT <constant>` | ACCESS EXCLUSIVE | **No** (11+) |
| `ADD COLUMN ... DEFAULT <volatile>` | ACCESS EXCLUSIVE | **Yes** |
| `ADD COLUMN ... GENERATED ... STORED` | ACCESS EXCLUSIVE | **Yes** |
| `DROP COLUMN` | ACCESS EXCLUSIVE | No, marks it dropped |
| `ALTER COLUMN TYPE` | ACCESS EXCLUSIVE | **Usually yes** |
| `ALTER COLUMN SET NOT NULL` | ACCESS EXCLUSIVE | No, but **full scan** unless a proven check exists |
| `ADD CONSTRAINT ... NOT NULL c NOT VALID` (18+) | ACCESS EXCLUSIVE | No scan. Enforces on new rows at once |
| `ALTER COLUMN DROP NOT NULL` | ACCESS EXCLUSIVE | No |
| `SET DEFAULT` / `DROP DEFAULT` | ACCESS EXCLUSIVE | No |
| `ADD CONSTRAINT ... CHECK` | ACCESS EXCLUSIVE | No, but full scan |
| `ADD CONSTRAINT ... CHECK ... NOT VALID` | ACCESS EXCLUSIVE | No, no scan |
| `VALIDATE CONSTRAINT` | **SHARE UPDATE EXCLUSIVE** | No, scans but does not block |
| `ADD FOREIGN KEY` | SHARE ROW EXCLUSIVE on both | No, but full scan |
| `ADD FOREIGN KEY ... NOT VALID` | SHARE ROW EXCLUSIVE | No scan |
| `CREATE INDEX` | SHARE | Blocks **writes** |
| `CREATE INDEX CONCURRENTLY` | SHARE UPDATE EXCLUSIVE | Does not block |
| `DROP INDEX` | ACCESS EXCLUSIVE | - |
| `DROP INDEX CONCURRENTLY` | SHARE UPDATE EXCLUSIVE | - |
| `RENAME` | ACCESS EXCLUSIVE | No, instant |
| `TRUNCATE` | ACCESS EXCLUSIVE | - |
| `CLUSTER`, `VACUUM FULL` | ACCESS EXCLUSIVE | Yes |

**Even a metadata-only `ACCESS EXCLUSIVE` operation is dangerous**, not because it is slow but because of the queue. The distinction that matters is: how long will it hold the lock (rewrite versus metadata), and how long might it wait for it (always, unless `lock_timeout`).

## Safe patterns

### Adding a column

```sql
ALTER TABLE orders ADD COLUMN discount_code text;                    -- safe
ALTER TABLE orders ADD COLUMN status text NOT NULL DEFAULT 'new';    -- safe on 11+
ALTER TABLE orders ADD COLUMN uid uuid NOT NULL DEFAULT gen_random_uuid();  -- REWRITES
```

A **constant** default is stored in the catalogue and materialised lazily as rows are updated. A **volatile** default must produce a different value per row, so every row is rewritten.

For a volatile default on a large table: add the column nullable, backfill in batches, then set the default and `NOT NULL`.

### Adding `NOT NULL`

On **18**, use the native form. `NOT NULL` is a catalogued constraint that accepts `NOT VALID`, so this is two statements and no table scan under a strong lock:

```sql
-- 1. Instant. No scan. New NULLs are rejected from this moment.
ALTER TABLE orders ADD CONSTRAINT orders_ref_not_null
    NOT NULL reference NOT VALID;

-- 2. Scans existing rows under SHARE UPDATE EXCLUSIVE, so reads and writes continue.
ALTER TABLE orders VALIDATE CONSTRAINT orders_ref_not_null;
```

If step 2 fails with `column "reference" of relation "orders" contains null values`, backfill in batches and re-run it. Nothing is left half-applied.

On **14 to 17** there is no native `NOT NULL ... NOT VALID`, so use the proven-check route:

```sql
-- 1. Add a check that does not scan
ALTER TABLE orders ADD CONSTRAINT orders_ref_not_null
    CHECK (reference IS NOT NULL) NOT VALID;

-- 2. Validate it. SHARE UPDATE EXCLUSIVE, so reads and writes continue.
ALTER TABLE orders VALIDATE CONSTRAINT orders_ref_not_null;

-- 3. Now SET NOT NULL is instant: the check already proves it (12+)
ALTER TABLE orders ALTER COLUMN reference SET NOT NULL;

-- 4. Optionally drop the now-redundant check
ALTER TABLE orders DROP CONSTRAINT orders_ref_not_null;
```

### Adding a foreign key

```sql
ALTER TABLE orders ADD CONSTRAINT orders_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers (id) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_customer_id_fkey;
CREATE INDEX CONCURRENTLY orders_customer_id_idx ON orders (customer_id);
```

`NOT VALID` skips checking existing rows; new and modified rows are checked from the moment it is added. Do not forget the index - see [keys-and-identifiers.md](keys-and-identifiers.md).

### Changing a column type

Most type changes rewrite the table under `ACCESS EXCLUSIVE`. A few are free because the binary representation is compatible - `varchar(50)` to `varchar(100)`, `varchar(n)` to `text`, `numeric` to a wider `numeric`.

`integer` to `bigint` is **not** free and rewrites. For a large table, use expand/contract:

```sql
-- 1. New column
ALTER TABLE orders ADD COLUMN id_new bigint;
-- 2. Keep it in sync
CREATE TRIGGER orders_sync_id BEFORE INSERT OR UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION sync_id_new();
-- 3. Backfill in batches
-- 4. Add constraints and indexes on the new column concurrently
-- 5. Swap in a single short transaction
BEGIN;
SET lock_timeout = '3s';
ALTER TABLE orders RENAME COLUMN id TO id_old;
ALTER TABLE orders RENAME COLUMN id_new TO id;
COMMIT;
-- 6. Later, drop id_old and the trigger
```

### Renaming

A rename is instant, and it **breaks every client** that has not deployed yet. Use expand/contract instead:

1. Add the new column.
2. Write to both (trigger or application).
3. Backfill.
4. Migrate readers to the new column.
5. Stop writing the old.
6. Drop the old, after a deploy cycle has confirmed nothing uses it.

Six steps across several deploys. That is what zero-downtime costs.

## Backfilling

Never one statement over millions of rows. That holds locks, creates mass dead tuples, generates enormous WAL, and rolls everything back on failure.

```sql
-- Repeat until zero rows affected
WITH batch AS (
    SELECT id FROM orders
    WHERE  status IS NULL
    ORDER  BY id
    LIMIT  5000
    FOR UPDATE SKIP LOCKED
)
UPDATE orders o SET status = 'legacy'
FROM   batch b WHERE o.id = b.id;
```

Pause between batches so autovacuum can reclaim. Make it resumable - the `WHERE status IS NULL` above is naturally resumable, which is a good property to design in. See [bulk-operations.md](bulk-operations.md).

Run the backfill **outside** the migration if the tool wraps migrations in a transaction. A long transaction blocks vacuum cluster-wide.

## Transactional DDL

PostgreSQL's DDL is transactional, which is genuinely rare and genuinely valuable:

```sql
BEGIN;
ALTER TABLE orders ADD COLUMN a text;
CREATE INDEX orders_a_idx ON orders (a);
ROLLBACK;   -- both undone, cleanly
```

Two things that cannot participate:

- `CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY`
- `ALTER TABLE ... DETACH PARTITION CONCURRENTLY`
- `VACUUM`, `CREATE DATABASE`, `ALTER SYSTEM`

Migration tools wrap each migration in a transaction by default, so these need an explicit escape: Flyway `-- executeInTransaction=false` or the config property, Liquibase `runInTransaction="false"`, Rails `disable_ddl_transaction!`, Alembic `with op.get_context().autocommit_block()`.

**Do not put many DDL statements in one long transaction.** Each takes its lock at execution and holds it until commit, so a ten-statement migration holds all ten locks by the end.

## Expand and contract

The general shape for any breaking change:

| Phase | Database | Application |
|---|---|---|
| **Expand** | Add the new structure, nullable, no constraints | Deploy code writing to both, reading from the old |
| **Migrate** | Backfill in batches | - |
| **Switch** | Add constraints and indexes | Deploy code reading from the new |
| **Contract** | Drop the old structure | Deploy code writing only to the new |

Each phase is independently deployable and reversible. Never combine phases to save a deploy - that is precisely how a rollback becomes impossible.

**Every migration must be safe against the previous version of the application**, because during a rolling deploy both versions run at once. Dropping a column the old version still selects is an outage for the old pods.

## Tooling

| Tool | Notes |
|---|---|
| **Flyway** | Plain SQL, versioned files. Simple, predictable, widely used with Spring Boot |
| **Liquibase** | XML/YAML/SQL, rollback support, database-agnostic. Heavier |
| **Alembic** | Python/SQLAlchemy. Autogeneration needs review |
| **Atlas**, **Sqitch** | Declarative and dependency-based respectively |
| **squawk**, **eugene** | **Linters for migration safety.** Catch dangerous DDL in CI. Worth adding |

Whatever the tool:

- **Migrations are immutable once applied.** Fix forward with a new migration.
- **Every migration has a tested rollback**, or an explicit note that it cannot be rolled back.
- **Migrations run as a role that owns the schema**, not as the application role. See [security-and-roles.md](security-and-roles.md).
- **Test against a restored copy of production**, at production scale. A migration that takes two seconds on 10,000 rows takes twenty minutes on 50 million.

A migration safety linter in CI is the highest-value single addition here - it catches the volatile-default rewrite, the missing `CONCURRENTLY`, and the unqualified `NOT NULL` before review does.

## A migration template

```sql
-- Add discount_code to orders.
-- Locks: ACCESS EXCLUSIVE, metadata only, no rewrite.
-- Rollback: ALTER TABLE orders DROP COLUMN discount_code;

SET lock_timeout = '3s';
SET statement_timeout = '30s';

ALTER TABLE orders ADD COLUMN discount_code text;

-- Index built separately, non-transactionally:
--   CREATE INDEX CONCURRENTLY orders_discount_code_idx
--       ON orders (discount_code) WHERE discount_code IS NOT NULL;
```

## Version notes

- **18** - `NOT NULL` constraints are catalogued and support `NOT VALID`, so adding `NOT NULL` to a large table no longer needs the check-constraint dance. `NOT VALID` foreign keys are permitted on partitioned tables.
- **17+** - faster `ALTER TABLE` for several forms.
- **14+** - `DETACH PARTITION CONCURRENTLY`; `REINDEX CONCURRENTLY` on partitioned tables.
- **12+** - `SET NOT NULL` can use a proven `CHECK` to skip its scan. This is what makes the safe pattern work on 14 to 17.
- **11+** - `ADD COLUMN` with a **constant** default no longer rewrites the table. A volatile default still does.

Lock levels and transactional DDL behaviour are otherwise identical across 14 to 18.

## Gotchas

- Agent writes DDL without `lock_timeout` - it queues behind a long query and blocks everything behind it
- Agent assumes a metadata-only `ALTER TABLE` is safe - the danger is the wait for the lock, not the hold
- Agent adds a column with a volatile default such as `gen_random_uuid()` or `now()` - rewrites the whole table
- Agent runs `SET NOT NULL` directly on a large table - a full scan under `ACCESS EXCLUSIVE`
- Agent adds a foreign key or check without `NOT VALID` - validates every existing row while holding a lock
- Agent adds `NOT VALID` and never runs `VALIDATE` - the planner cannot rely on the constraint
- Agent puts `CREATE INDEX CONCURRENTLY` in a transactional migration - it cannot run in a transaction block
- Agent does not check for invalid indexes after a failed concurrent build - they cost writes and serve nothing
- Agent renames a column in one step - breaks every client that has not deployed
- Agent drops a column the previous application version still selects - an outage for the old pods during a rolling deploy
- Agent backfills in one statement - long lock, mass dead tuples, huge WAL, and a full rollback on failure
- Agent runs a long backfill inside the migration transaction - blocks vacuum cluster-wide for its duration
- Agent puts many DDL statements in one transaction - all their locks are held until commit
- Agent tests a migration only on a small dataset - the timing is qualitatively different at production scale
- Agent edits an already-applied migration - fix forward with a new one
- Agent runs migrations as the application role - that role should not own the schema or hold DDL rights

## Related

- [locking.md](locking.md) · [constraints.md](constraints.md) · [index-maintenance.md](index-maintenance.md) · [bulk-operations.md](bulk-operations.md) · [security-and-roles.md](security-and-roles.md) · [schema-organisation.md](schema-organisation.md) · [testing.md](testing.md) · [partitioning.md](partitioning.md) · [postgres-versions.md](postgres-versions.md)
