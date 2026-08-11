# Application Integration

Most "database problems" are integration problems. The database is fine; the application opens too many connections, holds transactions open, fetches everything, or issues one query per row.

## N+1

The most common and most damaging pattern in any ORM-backed application.

```java
List<Order> orders = repo.findAll();          // 1 query
for (Order o : orders) {
    o.getCustomer().getName();                // N queries, lazily
}
```

101 round trips instead of one. Each is fast in `pg_stat_statements` and the total is catastrophic. The signature is a query with an enormous `calls` count and a tiny `mean_exec_time`.

Fixes, per stack:

- **JPA/Hibernate**: `JOIN FETCH` in JPQL, `@EntityGraph`, or `@BatchSize` to turn N queries into N/batch. Never rely on the default fetch mode.
- **Spring Data**: `@EntityGraph(attributePaths = {"customer"})` on the repository method.
- **Prisma / TypeORM / Drizzle**: the `include` or `with` option, which generates a join or a batched second query.
- **Anything**: a DataLoader-style batching layer.

Detect it by counting queries per request in tests. A test that asserts "this endpoint issues at most 3 queries" catches the regression the day it is introduced, which no amount of production monitoring does as cheaply.

## Transactions

**A transaction must not span anything slow.** Not an HTTP call, not a message publish, not user interaction, not a file upload.

An open transaction holds its locks and holds back the vacuum horizon **for the entire cluster**. One request waiting 30 seconds on a payment gateway inside a transaction means 30 seconds of unreclaimable dead tuples across every table in every database. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

```java
@Transactional
public void placeOrder(Order o) {
    repo.save(o);
    paymentGateway.charge(o);   // WRONG. Network call inside the transaction.
    repo.markPaid(o);
}
```

Split it: commit the order, call the gateway, commit the result in a second transaction. The state machine gets a "pending payment" state, which it needed anyway.

In Spring:

- `@Transactional` only applies through a proxy, so **a call from within the same class bypasses it entirely** - the annotation silently does nothing. This is the single most common Spring transaction bug.
- `readOnly = true` sets the JDBC connection read-only and lets Hibernate skip dirty checking. Use it on queries.
- Default propagation is `REQUIRED`, joining an existing transaction. `REQUIRES_NEW` suspends and opens another - which means **two connections held simultaneously**, and a pool of size N can deadlock with N/2 concurrent such calls.

## Retries

Any application using `REPEATABLE READ` or `SERIALIZABLE`, or that can deadlock, **must retry**.

```java
for (int attempt = 0; attempt < 3; attempt++) {
    try {
        return transactionTemplate.execute(status -> doWork());
    } catch (DataAccessException e) {
        String state = extractSqlState(e);
        if (!"40001".equals(state) && !"40P01".equals(state)) throw e;
        Thread.sleep(backoffWithJitter(attempt));
    }
}
```

- Retry `40001` (serialisation failure) and `40P01` (deadlock). Both are transient.
- **The retry must wrap the transaction**, not sit inside it. Once a transaction has failed it is aborted and nothing further can run in it. `@Retryable` on a `@Transactional` method does not work for this reason - the retry runs inside the failed transaction.
- Exponential backoff with jitter. Immediate retry reproduces the contention.
- Reset any application state mutated inside the transaction.

See [transactions-and-isolation.md](transactions-and-isolation.md).

## Type mapping

Get these right or the plan silently degrades.

| PostgreSQL | Java | TypeScript / node-postgres |
|---|---|---|
| `bigint` | `long` / `Long` | **`string`** by default - `bigint` exceeds `Number.MAX_SAFE_INTEGER` |
| `numeric` | `BigDecimal` | `string` by default. **Never `number`** |
| `timestamptz` | `OffsetDateTime` / `Instant` | `Date` |
| `timestamp` | `LocalDateTime` | `Date`, with no zone information |
| `date` | `LocalDate` | `Date`, or a string |
| `uuid` | `UUID` | `string` |
| `jsonb` | `String` or a mapped type | `object`, parsed automatically |
| `text[]` | `String[]` via `createArrayOf` | `string[]` |

Two that cause real bugs:

**`numeric` to a floating-point type.** `numeric` is exact; `double` is not. Mapping money to `double` reintroduces exactly the error `numeric` exists to prevent. In JavaScript, node-postgres returns `numeric` as a string precisely so it is not silently truncated - do not "fix" that by parsing it to `Number`.

**Binding the wrong type in a comparison.** A `bigint` column compared against a string parameter forces a cast on the column side and **disables the index**. The query looks correct and the plan is a sequential scan. This is common with UUIDs bound as strings and with `bigint` ids from JSON. See [query-optimisation.md](query-optimisation.md).

Java specifics: `setObject(n, value, Types.OTHER)` for `jsonb`; `OffsetDateTime` rather than `Timestamp` for `timestamptz`; and set `stringtype=unspecified` only if you understand what it defers to the server.

## Prepared statements and plan caching

The JDBC driver switches to server-side prepared statements after `prepareThreshold` executions (default 5), and PostgreSQL may then switch to a **generic plan** planned without knowing the parameter values.

Usually good. Occasionally terrible: if `status = 'pending'` matches 0.1% and `status = 'complete'` matches 95%, one plan cannot suit both.

**A query that is fast in `psql` and slow from the application is very often this** - `psql` with literals always gets a custom plan.

```sql
SET plan_cache_mode = force_custom_plan;
```

Set per session, per role, or via the connection string. See [statistics-and-planner.md](statistics-and-planner.md).

Through a pooler: PgBouncer in transaction mode historically broke named prepared statements, which is why so much advice says to set `prepareThreshold=0`. **Modern PgBouncer supports them** via `max_prepared_statements`. Check the pooler version before disabling. See [connections-and-pooling.md](connections-and-pooling.md).

## Fetching

By default many drivers **buffer the entire result set** in client memory. A query returning ten million rows exhausts the heap.

- **JDBC**: `setFetchSize(1000)` **and** autocommit off. Fetch size is ignored in autocommit mode, which is the part people miss.
- **node-postgres**: use `pg-cursor` or `pg-query-stream`.
- **psycopg**: a named (server-side) cursor.

For exports, `COPY ... TO STDOUT` streams and is far faster than a `SELECT` through the driver. See [bulk-operations.md](bulk-operations.md).

## Session state under pooling

Anything set with `SET` persists on the physical connection and is handed to the next user of that connection.

```sql
SELECT set_config('app.tenant_id', $1, true);   -- transaction-scoped. Safe.
SET app.tenant_id = '42';                       -- session-scoped. Leaks.
```

For multi-tenant RLS this is a **data leak**, silent and without error. The Spring pattern is an interceptor ordered to run **after** `@Transactional` has opened the transaction, issuing `set_config` as the first statement, with the tenant from the authenticated principal. A `ThreadLocal` alone is not enough - the value has to reach the database inside the same transaction.

See [row-level-security.md](row-level-security.md) and [multi-tenancy.md](multi-tenancy.md).

## What to set on every connection

```
application_name=orders-api
```

Without it, `pg_stat_activity` cannot tell you which service holds a connection or issued a slow query - and that is the first question during an incident. It costs nothing.

Also worth setting per role rather than per connection: `statement_timeout`, and `search_path` if the application should not see everything.

## ORM boundaries

An ORM is good at loading and persisting object graphs, and bad at reporting, bulk operations and anything using a window function, `LATERAL`, or a CTE.

Use the ORM for the transactional path and drop to SQL for the rest. In Spring that is `JdbcTemplate` or a native query; in TypeScript, the raw-SQL escape hatch every ORM provides.

Two ORM behaviours worth checking explicitly:

- **`SELECT *`** by default. Fetches every column including large `text` and `jsonb`, and defeats index-only scans. See [sql-style.md](sql-style.md).
- **Implicit savepoints.** Hibernate creates them, and the JDBC driver's `autosave=conservative` creates one per statement. More than 64 subtransactions in one transaction overflows a shared cache and degrades the whole cluster. See [transactions-and-isolation.md](transactions-and-isolation.md).

Read the SQL the ORM generates. Enabling SQL logging in development for a week reveals more than any amount of reading its documentation.

## Migrations from the application

Migrations should run as a role that **owns** the schema, separate from the role the application uses at runtime. The application role should not hold DDL rights.

Running migrations at application startup is convenient and races when several instances start together. Use an advisory lock, or run migrations as a separate deployment step. Flyway and Liquibase both take a lock by default - confirm it is enabled rather than assuming. See [migrations.md](migrations.md) and [security-and-roles.md](security-and-roles.md).

## Version notes

- **18** - `RETURNING` supports `OLD`/`NEW`, which removes some round trips for read-after-write; OAuth authentication.
- **17+** - `MERGE ... RETURNING`.
- **16+** - improved libpq load balancing across multiple hosts in a connection string.
- **14+** - `target_session_attrs` accepts `read-write`, `read-only`, `primary`, `standby` and `prefer-standby`, so a driver can find the writable node after a failover without a proxy.

Driver behaviour, plan caching and pooler interactions are otherwise the same across 14 to 18. **Driver and pooler versions matter more here than the PostgreSQL version.**

## Gotchas

- Agent leaves N+1 in place - many fast queries cost more than one slow one and look healthy per query
- Agent makes a network call inside a transaction - holds locks and the vacuum horizon for the duration of the call
- Agent calls a `@Transactional` method from within the same class - the proxy is bypassed and the annotation does nothing
- Agent uses `REQUIRES_NEW` without accounting for two simultaneous connections - the pool can deadlock against itself
- Agent uses `REPEATABLE READ` or `SERIALIZABLE` without a retry loop - `40001` becomes an unhandled error under load
- Agent puts the retry inside the transaction - the transaction is already aborted; the retry must wrap it
- Agent maps `numeric` to `double` or `Number` - reintroduces exactly the rounding error `numeric` prevents
- Agent binds a `bigint` or `uuid` column against a string parameter - the cast disables the index and the query looks correct
- Agent sets `setFetchSize` but leaves autocommit on - fetch size is ignored and the whole result is buffered
- Agent uses `SET` rather than `set_config(..., true)` for tenant context - the value leaks to the next request on that connection
- Agent does not set `application_name` - connections cannot be attributed to a service during an incident
- Agent disables prepared statements citing PgBouncer - modern PgBouncer supports them in transaction mode
- Agent cannot reproduce a slow application query in `psql` - `psql` uses literals and gets a custom plan
- Agent lets the ORM emit `SELECT *` - fetches every column and defeats index-only scans
- Agent leaves Hibernate or driver-level implicit savepoints on - over 64 subtransactions degrades the whole cluster
- Agent runs migrations at startup across several instances with no lock - concurrent migration attempts race

## Related

- [connections-and-pooling.md](connections-and-pooling.md) · [transactions-and-isolation.md](transactions-and-isolation.md) · [row-level-security.md](row-level-security.md) · [statistics-and-planner.md](statistics-and-planner.md) · [data-types.md](data-types.md) · [query-optimisation.md](query-optimisation.md) · [bulk-operations.md](bulk-operations.md) · [migrations.md](migrations.md) · [testing.md](testing.md)
