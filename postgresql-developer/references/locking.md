# Locking

Most locking problems are not lock-mode problems. They are transactions held open too long, or DDL taken without a timeout.

## Table-level locks

Eight modes. The only thing to remember is which conflict with which.

| Mode | Taken by | Conflicts with |
|---|---|---|
| `ACCESS SHARE` | `SELECT` | `ACCESS EXCLUSIVE` only |
| `ROW SHARE` | `SELECT FOR UPDATE/SHARE` | `EXCLUSIVE`, `ACCESS EXCLUSIVE` |
| `ROW EXCLUSIVE` | `INSERT`, `UPDATE`, `DELETE`, `MERGE` | `SHARE` and above |
| `SHARE UPDATE EXCLUSIVE` | `VACUUM`, `ANALYZE`, `CREATE INDEX CONCURRENTLY`, many `ALTER TABLE` variants | Itself and above |
| `SHARE` | `CREATE INDEX` (non-concurrent) | `ROW EXCLUSIVE` and above. **Blocks all writes** |
| `SHARE ROW EXCLUSIVE` | `CREATE TRIGGER`, some `ALTER TABLE` | Almost everything |
| `EXCLUSIVE` | `REFRESH MATERIALIZED VIEW CONCURRENTLY` | Everything except `ACCESS SHARE` |
| `ACCESS EXCLUSIVE` | Most `ALTER TABLE`, `DROP`, `TRUNCATE`, `REINDEX`, `VACUUM FULL`, plain `REFRESH MATERIALIZED VIEW` | **Everything, including `SELECT`** |

The practical takeaways:

- **`ACCESS EXCLUSIVE` blocks reads too.** Any statement taking it on a busy table is an outage for its duration.
- `SHARE UPDATE EXCLUSIVE` is the "safe" DDL lock: normal reads and writes continue.
- Two `SHARE UPDATE EXCLUSIVE` operations conflict with each other, so a `VACUUM` can block an `ALTER TABLE`.

### The lock queue

This is what turns a brief lock into an outage, and it surprises people.

Lock requests **queue in order**. A waiting `ACCESS EXCLUSIVE` request blocks every request behind it, even ones that would not have conflicted with the current holder.

```
1. Long-running SELECT holds ACCESS SHARE
2. ALTER TABLE requests ACCESS EXCLUSIVE  -> waits
3. Every subsequent SELECT               -> waits behind the ALTER
```

The `ALTER TABLE` may complete in a millisecond, but it cannot start until the long `SELECT` finishes, and meanwhile the whole application has stopped.

**Every DDL statement must set `lock_timeout`:**

```sql
SET lock_timeout = '3s';
ALTER TABLE orders ADD COLUMN discount_code text;
```

Fail fast and retry rather than queue behind a long query. See [migrations.md](migrations.md).

## Row-level locks

| Lock | Taken by | Blocks |
|---|---|---|
| `FOR UPDATE` | Explicit | Other `FOR UPDATE`/`FOR SHARE`, and updates or deletes of the row |
| `FOR NO KEY UPDATE` | `UPDATE` not touching a unique key | Weaker: allows `FOR KEY SHARE` |
| `FOR SHARE` | Explicit | Writers, allows other readers |
| `FOR KEY SHARE` | Foreign key checks | Only `FOR UPDATE` |

**Readers never block writers, and writers never block readers.** That is MVCC. Only writers block writers, on the same row.

### `FOR UPDATE` versus `FOR NO KEY UPDATE`

`SELECT ... FOR UPDATE` is stronger than most code needs. If you are not going to change a column referenced by a foreign key, `FOR NO KEY UPDATE` allows concurrent foreign-key checks against the row to proceed.

The common symptom of getting this wrong: inserting child rows blocks because a parent row is locked `FOR UPDATE` by an unrelated transaction.

### Options

```sql
SELECT * FROM jobs WHERE id = $1 FOR UPDATE NOWAIT;       -- error if locked
SELECT * FROM jobs WHERE state = 'queued' FOR UPDATE SKIP LOCKED LIMIT 10;
```

`NOWAIT` errors immediately rather than waiting. `SKIP LOCKED` silently omits locked rows - the basis of a work queue.

## A work queue with `SKIP LOCKED`

The correct way to build a job queue in PostgreSQL, and it is genuinely good:

```sql
WITH next_job AS (
    SELECT id
    FROM   jobs
    WHERE  state = 'queued'
      AND  run_after <= now()
    ORDER  BY priority DESC, run_after
    FOR UPDATE SKIP LOCKED
    LIMIT  1
)
UPDATE jobs j
SET    state = 'running', started_at = now(), attempts = attempts + 1
FROM   next_job n
WHERE  j.id = n.id
RETURNING j.*;
```

Many workers can run this concurrently. Each takes a different job; none blocks. Without `SKIP LOCKED` they would all queue on the same highest-priority row and the queue would be serial.

Supporting index:

```sql
CREATE INDEX jobs_queue_idx ON jobs (priority DESC, run_after)
    WHERE state = 'queued';
```

A partial index keeps it tiny regardless of how many completed jobs accumulate. See [partial-and-expression-indexes.md](partial-and-expression-indexes.md).

### Why a database queue at all

The decisive argument is **atomicity**, not cost. If the business operation and the message it produces must both happen or neither, a queue in the same database makes that one transaction:

```sql
BEGIN;
INSERT INTO orders (...) VALUES (...);          -- the business operation
INSERT INTO jobs (job_key, payload)             -- the message it produces
     VALUES ('send-confirmation', ...);
COMMIT;                                          -- both, or neither
```

With an external broker you do the insert, commit, then publish - and if the publish fails you have an order with no confirmation job and no record of the gap. Recovering that correctly means building a transactional outbox, which is a queue table in PostgreSQL anyway.

The other two reasons are weaker but real: the volume fits comfortably on one instance, and you already run PostgreSQL and do not want another system to monitor, back up, upgrade and staff. Below a few thousand jobs a second, PostgreSQL is genuinely fine.

Reach for a dedicated broker when the volume will not fit on one primary, when you need fan-out to many independent consumer groups, or when you need delivery semantics PostgreSQL does not model.

### Points that queue implementations get wrong

- **The claim must commit** before the work starts. Claim and commit, then work, then mark done in a second transaction. Holding the transaction open for the whole job holds the row lock and the vacuum horizon for its duration.
- **A crashed consumer leaves a message stuck.** Once the claim has committed, the row says `running` and nothing will ever reset it. You need a reaper - a scheduled job that resets rows sitting in `running` past a threshold:
  ```sql
  UPDATE jobs SET state = 'queued'
  WHERE state = 'running' AND started_at < now() - interval '15 minutes';
  ```
  This is what a broker's **visibility timeout** does for you, and forgetting it is the single most common defect in a hand-built queue. `pgmq` implements it properly.
- **Cap the attempts and dead-letter.** Without it, a permanently failing message is retried forever:
  ```sql
  UPDATE jobs SET state = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END
  WHERE state = 'running' AND started_at < now() - interval '15 minutes';
  ```
- **A `state` column plus a partial index beats a separate queue table** for most volumes, and keeps the job with its data.
- **Deleted and updated rows both leave dead tuples.** Every status transition is an `UPDATE`, so a queue table churns far harder than its row count suggests and needs aggressive per-table autovacuum settings. At high volume, **partitioning by `created_at` and dropping whole partitions** avoids the vacuum problem entirely rather than tuning around it. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md) and [partitioning.md](partitioning.md).
- **`pgmq`** gives you visibility timeouts, read counts, archiving and partitioning ready-made, with an API close to SQS. Worth preferring over a hand-built queue once you need more than `SKIP LOCKED`.

### `LISTEN` / `NOTIFY`

Complements a queue for wake-up without polling. Three limitations:

- **Not durable.** No backlog is kept, so a consumer that is not connected at the moment of the `NOTIFY` never learns of it. Use it to reduce polling latency, never as the queue itself.
- **Not available on replicas.** Listeners must connect to the primary. If reads are load-balanced across replicas, the application needs a dedicated primary connection just for `LISTEN`.
- **Delivered on commit**, and `psql` only prints a notification when the next statement runs, because it has no event loop. Real drivers deliver asynchronously; `psql` behaviour is not representative.

## Advisory locks

Application-defined locks that PostgreSQL tracks but does not associate with any row.

```sql
SELECT pg_advisory_xact_lock(hashtext('nightly-billing-run'));   -- released at commit
SELECT pg_try_advisory_lock(12345);                              -- non-blocking, session-scoped
SELECT pg_advisory_unlock(12345);
```

Use `pg_advisory_xact_lock` - the transaction-scoped variant - almost always. The session-scoped form must be released explicitly, and a connection returned to a pool while still holding one poisons that connection for the next user.

Good uses: ensuring a single instance of a scheduled job runs across many application nodes; serialising a rare operation that has no natural row to lock; guarding a migration.

Note the key is a `bigint` (or two `int`s). `hashtext()` gives a stable key from a string, with a small collision risk - two unrelated jobs hashing to the same key will serialise against each other.

Advisory locks are **not** visible to the deadlock detector in the same way row locks are - actually they are, but the deadlock will name a lock nobody can find in `pg_locks` by relation. Check `pg_locks WHERE locktype = 'advisory'`.

## Deadlocks

Two transactions each holding a lock the other wants. PostgreSQL detects the cycle after `deadlock_timeout` (default 1s) and aborts one:

```
ERROR: deadlock detected
DETAIL: Process 123 waits for ShareLock on transaction 456; blocked by process 789.
SQLSTATE 40P01
```

The classic cause is inconsistent ordering:

```sql
-- Session A                          -- Session B
UPDATE accounts SET .. WHERE id = 1;  UPDATE accounts SET .. WHERE id = 2;
UPDATE accounts SET .. WHERE id = 2;  UPDATE accounts SET .. WHERE id = 1;
-- deadlock
```

Prevention:

1. **Always acquire locks in a consistent order.** Sort ids before updating a batch. This eliminates the majority of deadlocks.
2. **Keep transactions short.** Less time holding locks means less chance of a cycle.
3. **Take the strongest lock first**, rather than upgrading a shared lock to exclusive later.
4. **Retry on `40P01`** with backoff. It is a transient error. See [transactions-and-isolation.md](transactions-and-isolation.md).

Missing foreign key indexes cause deadlocks that look inexplicable, because a foreign key check locks the parent row and a full scan of the child holds locks far longer than expected. See [keys-and-identifiers.md](keys-and-identifiers.md).

Turn on `log_lock_waits` so waits over `deadlock_timeout` are logged with both queries - it is cheap and it is the only way to diagnose these after the fact.

## Diagnosing

```sql
SELECT blocked.pid AS blocked_pid, left(blocked.query, 80) AS blocked_query,
       blocking.pid AS blocking_pid, blocking.state,
       now() - blocking.state_change AS blocking_for,
       left(blocking.query, 80) AS blocking_query
FROM   pg_stat_activity blocked
JOIN   pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
WHERE  cardinality(pg_blocking_pids(blocked.pid)) > 0;
```

`pg_blocking_pids()` is far simpler than self-joining `pg_locks`. Remember the blocker's `query` is its **last** statement, which for an `idle in transaction` session is not the one holding the lock.

```sql
SELECT pg_cancel_backend(pid);      -- try this first
SELECT pg_terminate_backend(pid);   -- if cancel does not work
```

## Timeouts

Set these; the defaults are all "wait forever".

```sql
SET lock_timeout = '3s';                              -- per DDL statement
ALTER ROLE app_readwrite SET statement_timeout = '30s';
ALTER SYSTEM SET idle_in_transaction_session_timeout = '60s';
ALTER SYSTEM SET deadlock_timeout = '1s';             -- detection interval, leave alone
ALTER SYSTEM SET log_lock_waits = on;
```

`deadlock_timeout` also controls when `log_lock_waits` fires. Lowering it makes detection more aggressive but runs the check more often.

## Version notes

- **17+** - `transaction_timeout` bounds total transaction duration, closing the gap `statement_timeout` and `idle_in_transaction_session_timeout` leave open.
- **16+** - improved reporting of lock waits in `pg_stat_activity`.
- **14+** - `ALTER TABLE ... DETACH PARTITION CONCURRENTLY` avoids an `ACCESS EXCLUSIVE` lock on the parent.

Lock modes, the queue behaviour, `SKIP LOCKED` and advisory locks are identical across 14 to 18.

## Gotchas

- Agent runs DDL without `lock_timeout` - a waiting `ACCESS EXCLUSIVE` request blocks every query behind it, including ones that would not conflict
- Agent assumes `ACCESS EXCLUSIVE` only blocks writes - it blocks `SELECT` too
- Agent builds a work queue without `SKIP LOCKED` - every worker queues on the same row and the queue becomes serial
- Agent claims a job and does the work in the same transaction - the lock is held for the whole job
- Agent uses `FOR UPDATE` where `FOR NO KEY UPDATE` would do - blocks foreign key checks from unrelated inserts
- Agent uses session-scoped `pg_advisory_lock` in a pooled application - a connection returned while holding one poisons it for the next user
- Agent updates rows in an order that varies between code paths - the classic deadlock; sort the ids
- Agent treats a deadlock as a bug to eliminate entirely - retry with backoff is part of the design
- Agent does not retry on `40P01` - deadlock is transient and retryable
- Agent leaves `log_lock_waits` off - lock waits are then undiagnosable after the fact
- Agent reads the blocker's `query` as the statement holding the lock - it is the last statement run
- Agent uses `LISTEN`/`NOTIFY` as a durable queue - notifications are lost if nobody is listening
- Agent forgets a high-churn queue table needs aggressive autovacuum - it bloats faster than the default settings clean it

## Related

- [transactions-and-isolation.md](transactions-and-isolation.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [migrations.md](migrations.md) · [performance-triage.md](performance-triage.md) · [partial-and-expression-indexes.md](partial-and-expression-indexes.md) · [bulk-operations.md](bulk-operations.md) · [keys-and-identifiers.md](keys-and-identifiers.md) · [configuration.md](configuration.md)
