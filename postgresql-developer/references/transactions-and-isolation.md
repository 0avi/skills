# Transactions and Isolation

## The three levels

The SQL standard defines four. PostgreSQL implements three distinct behaviours - `READ UNCOMMITTED` is accepted and behaves as `READ COMMITTED`, because MVCC makes dirty reads impossible.

| Level | Dirty read | Non-repeatable read | Phantom read | Serialisation anomaly |
|---|---|---|---|---|
| `READ COMMITTED` (default) | No | **Possible** | **Possible** | **Possible** |
| `REPEATABLE READ` | No | No | No | **Possible** |
| `SERIALIZABLE` | No | No | No | No |

PostgreSQL is stricter than the standard requires: `REPEATABLE READ` also prevents phantom reads, because it uses a single snapshot for the whole transaction.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;   -- before the first statement
```

The level must be set before the transaction reads or writes anything.

## `READ COMMITTED`

Each **statement** sees a snapshot taken at the moment that statement began. Two identical `SELECT`s in one transaction can return different results.

```sql
BEGIN;
SELECT sum(balance) FROM accounts;   -- 1000
-- another transaction commits a transfer
SELECT sum(balance) FROM accounts;   -- 1200. Non-repeatable read.
COMMIT;
```

There is a subtler behaviour for writes. If an `UPDATE` finds a row that another transaction has modified and committed since the statement started, it **re-evaluates its `WHERE` clause against the new version** and proceeds if it still matches.

```sql
-- Two sessions concurrently:
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
```

The second blocks until the first commits, then re-reads the row and applies the subtraction to the **new** value. So concurrent increments are correct. But:

```sql
-- Session A                          -- Session B
SELECT balance FROM accounts          SELECT balance FROM accounts
 WHERE id = 1;        -- 500           WHERE id = 1;       -- 500
UPDATE accounts SET balance = 400     UPDATE accounts SET balance = 400
 WHERE id = 1;                         WHERE id = 1;   -- blocks, then succeeds
COMMIT;                                COMMIT;
-- Final balance 400. One deduction lost.
```

**Read-modify-write in application code is unsafe at `READ COMMITTED`.** The fix is to do the arithmetic in SQL (`SET balance = balance - 100`), or lock the row with `SELECT ... FOR UPDATE`, or use a higher isolation level.

## `REPEATABLE READ`

One snapshot for the entire transaction, taken at the first statement. Every read sees the same data.

Writes are stricter: if a transaction tries to update a row that another transaction has modified and committed since the snapshot:

```
ERROR: could not serialize access due to concurrent update
SQLSTATE 40001
```

The transaction is aborted and **must be retried**. There is no re-evaluation as at `READ COMMITTED`.

Good for reports that must be internally consistent, and for read-modify-write where a failure is preferable to a silent lost update.

## `SERIALIZABLE`

Guarantees the outcome is equivalent to running the transactions one at a time in some order. PostgreSQL implements this as **Serializable Snapshot Isolation**: it takes predicate locks to track read/write dependencies and aborts a transaction if it detects a cycle that could not occur in any serial order.

It catches anomalies nothing else does. The classic:

```sql
-- Business rule: at least one doctor must remain on call.
-- Session A                                    -- Session B
BEGIN ISOLATION LEVEL SERIALIZABLE;             BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT count(*) FROM doctors                    SELECT count(*) FROM doctors
 WHERE on_call;   -- 2                           WHERE on_call;   -- 2
UPDATE doctors SET on_call = false              UPDATE doctors SET on_call = false
 WHERE name = 'Alice';                           WHERE name = 'Bob';
COMMIT;   -- succeeds                            COMMIT;   -- ERROR 40001
```

Each transaction checked the rule and each was correct at the time. Serially, the second would have seen one doctor and refused. Only `SERIALIZABLE` catches this - it is a **write skew** anomaly, and `REPEATABLE READ` permits it because the two transactions touch different rows.

Costs:

- Predicate-lock tracking overhead, roughly 1 to 10% depending on workload.
- **Every transaction must have a retry loop.** Non-negotiable.
- `SERIALIZABLE` on a read-only transaction still participates; mark it `READ ONLY DEFERRABLE` to get a snapshot guaranteed not to abort, at the cost of possibly waiting for one.

## Retry loops

**Any application using `REPEATABLE READ` or `SERIALIZABLE` must retry on `40001`.** Without it, isolation is not a safety feature - it is an unhandled-error generator.

```java
for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try (Connection c = pool.getConnection()) {
        c.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
        c.setAutoCommit(false);
        doWork(c);
        c.commit();
        return;
    } catch (SQLException e) {
        // 40001 serialization_failure, 40P01 deadlock_detected
        if (!"40001".equals(e.getSQLState()) && !"40P01".equals(e.getSQLState())) throw e;
        sleepWithJitter(attempt);
    }
}
throw new RetriesExhaustedException();
```

Points that matter:

- Retry `40001` **and** `40P01` (deadlock). Both are transient and both mean "try again".
- **Exponential backoff with jitter.** Immediate retry of contending transactions reproduces the contention.
- **The whole transaction is retried**, from the beginning. Any application state mutated inside must be reset, which is why the retry has to wrap the transaction boundary and not sit inside it.
- Cap the attempts and surface the failure.

In Spring, `@Retryable` on the `@Transactional` method does not work - the retry must be **outside** the transaction boundary. Wrap it in an outer non-transactional method. See [application-integration.md](application-integration.md).

## Choosing

| Situation | Level |
|---|---|
| Normal OLTP | `READ COMMITTED` |
| Arithmetic on a single row | `READ COMMITTED` with `SET x = x - 1` in SQL |
| Read-modify-write across statements | `READ COMMITTED` with `SELECT ... FOR UPDATE` |
| A report that must be internally consistent | `REPEATABLE READ` |
| A business invariant across rows the transaction does not write | `SERIALIZABLE` |
| Financial ledgers, booking systems, anything with a cross-row rule | `SERIALIZABLE` |

Prefer a constraint to an isolation level where one exists. "No overlapping bookings" is an `EXCLUDE` constraint, which is cheaper and cannot be bypassed. See [constraints.md](constraints.md).

## Long transactions

The most damaging thing an application does to a PostgreSQL database.

An open transaction holds back the **vacuum horizon** for the entire cluster. Dead tuples created anywhere, by anyone, cannot be reclaimed while a transaction older than them exists - because that transaction might still need to see them.

One session sitting `idle in transaction` for an hour means an hour of dead tuples across every table, in every database, unreclaimable. Tables bloat, index-only scans stop working, and query plans degrade - and the cause is a forgotten `BEGIN` somewhere unrelated.

```sql
SELECT pid, state, now() - xact_start AS xact_age, left(query, 100)
FROM   pg_stat_activity
WHERE  xact_start IS NOT NULL
ORDER  BY xact_start;
```

Defences:

```sql
ALTER SYSTEM SET idle_in_transaction_session_timeout = '60s';
ALTER SYSTEM SET statement_timeout = '30s';           -- per role is better
ALTER SYSTEM SET transaction_timeout = '5min';        -- 17+
```

`transaction_timeout` (17+) is the one that closes the gap: `statement_timeout` limits one statement and `idle_in_transaction_session_timeout` limits idling, but before 17 a transaction alternating short statements with short idles could run forever.

Never open a transaction and then wait on a network call, a user, or a queue. See [performance-triage.md](performance-triage.md).

## Savepoints

```sql
BEGIN;
INSERT INTO orders ...;
SAVEPOINT before_items;
INSERT INTO order_items ...;   -- fails
ROLLBACK TO SAVEPOINT before_items;
INSERT INTO order_items ...;   -- corrected
COMMIT;
```

In PostgreSQL, **any error aborts the whole transaction** unless a savepoint is available to roll back to. There is no "continue after error".

Savepoints are not free: each consumes a subtransaction id, and more than 64 subtransactions in one transaction overflows a per-backend cache and can cause severe cluster-wide performance degradation as other backends fall back to reading `pg_subtrans` from disk. Do not put a savepoint in a loop.

JDBC drivers and some ORMs create implicit savepoints - Hibernate does, and `autosave=conservative` in the JDBC driver creates one per statement. Both can trigger this. See [application-integration.md](application-integration.md).

## Read-only and deferrable

```sql
BEGIN TRANSACTION READ ONLY;
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE, READ ONLY, DEFERRABLE;
```

`READ ONLY` documents intent and lets PostgreSQL skip some work. `DEFERRABLE`, with `SERIALIZABLE READ ONLY`, waits until it can take a snapshot guaranteed never to abort - ideal for a long report that must be consistent and must not fail.

## Version notes

- **17+** - `transaction_timeout`, which bounds total transaction duration.
- **16+** - logical replication can run from a standby, reducing the need for long transactions on the primary.
- **14+** - reduced overhead for `SERIALIZABLE` in some workloads.

Isolation semantics, `READ COMMITTED` re-evaluation, SSI and the subtransaction cache limit of 64 are identical across 14 to 18.

## Gotchas

- Agent does read-modify-write at `READ COMMITTED` - the update is lost silently; do the arithmetic in SQL or lock the row
- Agent uses `REPEATABLE READ` or `SERIALIZABLE` without a retry loop - `40001` becomes an unhandled error under load
- Agent retries `40001` but not `40P01` - deadlocks are equally transient
- Agent retries immediately without backoff - reproduces the contention
- Agent puts the retry inside the transaction boundary - the transaction is already aborted; the retry must wrap it
- Agent uses `@Retryable` on a `@Transactional` method - the retry runs inside the failed transaction
- Agent assumes `REPEATABLE READ` prevents write skew - it does not; that needs `SERIALIZABLE`
- Agent uses `SERIALIZABLE` where an `EXCLUDE` constraint would do - the constraint is cheaper and cannot be bypassed
- Agent opens a transaction and then makes a network call - holds the vacuum horizon for the whole cluster
- Agent leaves sessions `idle in transaction` with no timeout - one forgotten `BEGIN` bloats every table in the cluster
- Agent relies on `statement_timeout` to bound transaction length - it bounds one statement; use `transaction_timeout` on 17+
- Agent uses savepoints in a loop - over 64 subtransactions overflows a shared cache and degrades the whole cluster
- Agent expects a failed statement to leave the transaction usable - any error aborts it unless a savepoint exists

## Related

- [locking.md](locking.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [constraints.md](constraints.md) · [upsert-and-merge.md](upsert-and-merge.md) · [performance-triage.md](performance-triage.md) · [application-integration.md](application-integration.md) · [configuration.md](configuration.md)
