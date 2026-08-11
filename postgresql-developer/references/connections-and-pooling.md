# Connections and Pooling

## Why connections are expensive

PostgreSQL forks a **process** per connection. Each carries several megabytes of private memory, its own catalogue caches, and a slot in shared structures that every backend scans.

The consequences:

- Establishing a connection is slow - a fork, plus authentication, plus catalogue loading.
- Idle connections consume memory even when doing nothing.
- Beyond a few hundred, throughput **decreases** as concurrency rises. Context switching, lock contention on shared structures, and snapshot computation all scale with the number of backends.

`max_connections` defaults to 100. Raising it to 5000 does not let you serve 5000 concurrent clients - it lets you exhaust the server's memory more thoroughly. The answer is a pooler.

## Sizing the pool

The widely-cited starting point from the PostgreSQL wiki:

```
connections = (core_count * 2) + effective_spindle_count
```

For a 8-core server on SSD, that is around 16 to 20. It is a **starting point**, not a formula - "effective spindle count" is meaningless on NVMe, and workloads that wait on I/O tolerate more concurrency than CPU-bound ones.

The counterintuitive part, which is nonetheless true: **a smaller pool is usually faster under load.** Twenty connections executing sequentially beat 200 thrashing. Queueing in the pool is cheaper than contending in the database.

Size for the **database's** capacity, not the application's concurrency. If 500 requests arrive at once, 480 of them should wait in the pool.

Budget across everything that connects:

```
total ≤ max_connections - superuser_reserved_connections - replication slots - monitoring - migrations
```

With `max_connections = 200`, ten application instances at 20 connections each leaves nothing for anything else, including the emergency `psql` session you need during the incident.

## Pool modes

| Mode | Connection returned | Session state | Use |
|---|---|---|---|
| **Session** | On client disconnect | Preserved | Compatibility. Little pooling benefit |
| **Transaction** | On commit or rollback | **Lost** | The default for web applications |
| **Statement** | After each statement | Lost. Multi-statement transactions banned | Rare |

**Transaction mode is what makes pooling worthwhile** - a connection is held only for the duration of a transaction, so a small pool serves many clients.

### What transaction mode breaks

Anything that assumes session continuity:

| Feature | Why it breaks |
|---|---|
| `SET` (session-scoped) | The next transaction may get a different connection. **Use `SET LOCAL`** |
| Session-scoped advisory locks | Held on a connection returned to the pool, poisoning it |
| `LISTEN` / `NOTIFY` | The listening connection is not yours between transactions |
| `WITH HOLD` cursors | Live beyond a transaction |
| Temporary tables | Session-scoped |
| Session-level prepared statements | See below |

**The one that causes data leaks is `SET`.** A tenant id set with `SET` persists on the physical connection and is handed to the next request. See [row-level-security.md](row-level-security.md) - this is the single most dangerous interaction between pooling and multi-tenancy.

`SET LOCAL`, or `set_config(name, value, true)`, is transaction-scoped and safe.

## Prepared statements through a pooler

This changed and much published advice is out of date.

**Historically**: named prepared statements broke in transaction mode, because the statement was prepared on one backend and executed on another. `ERROR: prepared statement "S_1" does not exist`, or `already exists` on reconnect. The workaround was to disable them - `prepareThreshold=0` in JDBC, `prepare: false` in node-postgres.

**Currently**: **PgBouncer supports protocol-level named prepared statements in transaction mode** via `max_prepared_statements`, added in 1.21 and defaulting to 200 in recent versions. PgBouncer tracks which statements each server connection has prepared and transparently re-prepares as needed.

```ini
[pgbouncer]
pool_mode = transaction
max_prepared_statements = 200
```

So check the deployed pooler and its version before disabling prepared statements. Turning them off costs a parse and plan on every execution, which is a real throughput loss - and on 14 to 17 it also loses the generic-plan benefit entirely.

Two caveats: it applies to **protocol-level** prepared statements (what a driver does), not to SQL-level `PREPARE`/`EXECUTE`, which still breaks. And other poolers differ - check for RDS Proxy, Supavisor and pgcat individually rather than assuming.

## Poolers

| Pooler | Notes |
|---|---|
| **PgBouncer** | The standard. Lightweight, single-threaded per instance (run several behind a load balancer for high throughput). Supports prepared statements in transaction mode since 1.21 |
| **pgcat** | Multi-threaded, load balancing, read/write splitting, sharding |
| **Odyssey** | Multi-threaded, from Yandex |
| **Supavisor** | Supabase's, built for very high connection counts |
| **RDS Proxy** | AWS-managed. Handles failover and IAM. Pins connections for many operations, which reduces the pooling benefit |

### Application pool plus PgBouncer

Both is common and correct:

- **The application pool** (HikariCP, `pg.Pool`) avoids TCP setup per request and gives fast local acquisition.
- **PgBouncer** multiplexes across many application instances, which the application pool cannot see.

Size the application pools so their total does not exceed what PgBouncer can serve, and PgBouncer's server pool for the database's capacity.

## Timeouts

Every layer needs one, and every default is "wait forever".

```sql
-- Database side
ALTER ROLE app_service SET statement_timeout = '30s';
ALTER SYSTEM SET idle_in_transaction_session_timeout = '60s';
ALTER SYSTEM SET transaction_timeout = '5min';        -- 17+
```

```ini
# PgBouncer
query_wait_timeout = 20      # give up waiting for a server connection
server_idle_timeout = 600
client_idle_timeout = 0
```

Application side: connection timeout, acquisition timeout, socket timeout, and a validation query interval.

**`idle_in_transaction_session_timeout` is the most valuable of these.** A session idle in a transaction holds its locks and holds back the vacuum horizon **for the entire cluster** - so one forgotten `BEGIN` bloats every table in every database. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

## Diagnosing

```sql
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;

SELECT usename, application_name, client_addr, count(*)
FROM   pg_stat_activity GROUP BY 1,2,3 ORDER BY count(*) DESC;

SELECT pid, now() - state_change AS idle_for, left(query, 100)
FROM   pg_stat_activity
WHERE  state IN ('idle in transaction', 'idle in transaction (aborted)')
ORDER  BY state_change;
```

`FATAL: sorry, too many clients already` means `max_connections` is reached. Before raising it, work out which is true:

1. The pool is oversized - most connections are idle. Shrink it.
2. Connections are leaking - the application is not returning them. Fix the leak.
3. There genuinely is more concurrency than the database can serve. Add a pooler, or a read replica.

Raising `max_connections` is almost never the right first response, and it makes options 1 and 2 harder to notice.

**Set `application_name`** in every connection string. Without it, `pg_stat_activity` cannot tell you which service is holding connections, and that is the first question during an incident.

In PgBouncer:

```sql
SHOW POOLS;    -- cl_waiting > 0 means clients are queueing for a server connection
SHOW CLIENTS;
SHOW SERVERS;
```

`cl_waiting` persistently above zero means the server pool is too small or transactions are too long.

## Read replicas

Routing reads to a replica multiplies read capacity, and adds two problems:

- **Replication lag.** A read immediately after a write may not see it. Read-your-own-writes requires routing that user's reads to the primary for a window, or waiting for the LSN.
- **Separate pools.** Each replica needs its own, and each competes for the same total connection budget.

See [replication-and-scaling.md](replication-and-scaling.md).

## Serverless and short-lived clients

Lambda-style functions and edge runtimes are pathological for PostgreSQL: each invocation may open a connection, and concurrency is unbounded.

Options:

- A pooler in front, sized for the database rather than the invocation count.
- A serverless-oriented pooler - RDS Proxy, Supavisor, Neon's built-in pooler.
- An HTTP-based data API, which avoids a database connection entirely.

Do not connect directly from a function that can scale to hundreds of concurrent invocations.

## Version notes

- **17+** - `transaction_timeout` bounds total transaction duration, closing the gap left by `statement_timeout` and `idle_in_transaction_session_timeout`.
- **16+** - `pg_use_reserved_connections` and `reserved_connections`, letting a monitoring role connect when the pool is exhausted.
- **14+** - reduced per-connection memory overhead, and faster snapshot computation with many backends, which raises the practical ceiling somewhat.

The process-per-connection model and the pool-mode trade-offs are identical across 14 to 18. **PgBouncer's prepared-statement support is a PgBouncer version question, not a PostgreSQL one.**

## Gotchas

- Agent raises `max_connections` in response to connection exhaustion - throughput falls as backends multiply; use a pooler
- Agent sizes the pool for application concurrency rather than database capacity - a smaller pool is usually faster under load
- Agent does not budget connections across all instances, replicas, monitoring and migrations - the emergency `psql` session is the one that fails
- Agent uses `SET` for session state under transaction pooling - the value leaks to the next request on that connection
- Agent uses session-scoped advisory locks under a pool - the lock is held on a connection handed to someone else
- Agent uses `LISTEN`/`NOTIFY` or temporary tables under transaction pooling - both are session-scoped
- Agent disables prepared statements citing PgBouncer - modern PgBouncer supports them in transaction mode via `max_prepared_statements`
- Agent assumes all poolers behave like PgBouncer - RDS Proxy pins connections for many operations, and others differ
- Agent leaves `idle_in_transaction_session_timeout` unset - one forgotten transaction holds the vacuum horizon for the whole cluster
- Agent sets no `statement_timeout` - a runaway query holds resources indefinitely
- Agent does not set `application_name` - `pg_stat_activity` cannot attribute connections to a service
- Agent connects directly to PostgreSQL from serverless functions - unbounded concurrency, one connection per invocation
- Agent routes reads to a replica without handling lag - a read after a write may not see it

## Related

- [configuration.md](configuration.md) · [row-level-security.md](row-level-security.md) · [multi-tenancy.md](multi-tenancy.md) · [performance-triage.md](performance-triage.md) · [transactions-and-isolation.md](transactions-and-isolation.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [replication-and-scaling.md](replication-and-scaling.md) · [application-integration.md](application-integration.md)
