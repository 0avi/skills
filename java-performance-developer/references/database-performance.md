# Database Access Performance

**This file owns two things: proving the database is the constraint, and the Java-side costs that are yours to fix.** Query plans, indexes, schema design and `EXPLAIN` belong to [`postgresql-developer`](../../postgresql-developer/SKILL.md); Spring Data configuration belongs to [`spring-boot-developer`](../../spring-boot-developer/SKILL.md).

The reason for the split is Oaks' own rule of thumb, and it is a good one: **the database is always the bottleneck.** If it is, no amount of JVM tuning helps, and some of it actively hurts - a more efficient Java tier pushes more load into an already-saturated database and total throughput *falls*.

| Java-side cost | Typical effect | Apply blind? |
| -------------- | -------------- | ------------ |
| **Not batching writes** | **Oaks measured 141×** | Yes, where semantics allow |
| **Autocommit per statement** | **Measured 9.4×** on 400k inserts | Yes |
| Not using / not pooling `PreparedStatement` | Large on repeated SQL | Yes |
| Connection pool mis-sized | Either idle threads or a saturated database | No - measure |
| Fetch size wrong | Memory pressure, or excessive round trips | No - measure |
| Transaction scope too wide | Lock contention, reduced scalability | No - correctness first |
| JPA N+1 selects | Catastrophic - thousands of queries for one operation | Yes, once identified |

---

## First: prove where the constraint is

Do this before any of the fixes below.

```
Is the JVM's CPU saturated?
├─ Yes → the Java tier is the constraint. Profile it.
└─ No  → where are the threads?
         ├─ Blocked in socketRead0 / JDBC driver → the DATABASE or the network
         ├─ Blocked on a connection pool         → pool too small, or leaked connections
         ├─ Blocked on an application lock       → concurrency-performance.md
         └─ Idle, and no work queued             → load generator or upstream limit
```

```bash
# what are threads actually waiting on?
jcmd <pid> Thread.print | grep -A5 "socketRead0\|SocketInputStream\|oracle.jdbc\|org.postgresql"

# with JFR - better, gives duration and call site
jfr print --events jdk.SocketRead recording.jfr | head -40
jfr print --events jdk.JavaMonitorEnter recording.jfr | head -40
```

**Then measure the database's own utilisation** - its CPU, its I/O, its lock waits, its slow query log. A Java-side profile cannot see any of that, and every fix on this page is worthless if the database is at 100% CPU.

**The decisive check: if the database is saturated, stop and hand over.** Say so explicitly rather than continuing to tune the JVM. Optimising the Java tier at that point makes the system slower, which is the counter-intuitive result worth stating plainly to whoever asked.

---

## Batching and transaction boundaries

The largest Java-side lever by a wide margin. Oaks inserted 400,896 rows - 256 stocks × 261 days, one row plus five option rows each - and varied only how the JDBC calls were grouped:

| Programming mode | Time | DB calls | Commits |
| ---------------- | ---- | -------- | ------- |
| Autocommit on, no batching | **537 s** | 400,896 | 400,896 |
| One commit per stock | 57 s | 400,896 | 256 |
| One commit for everything | 56 s | 400,448 | 1 |
| One batch per stock, commit per stock | 4.6 s | 256 | 256 |
| One batch per stock, one commit | 3.9 s | 256 | 1 |
| One batch and one commit for all | **3.8 s** | 1 | 1 |

**537 s to 3.8 s - 141×.** Two independent effects, and the second is bigger:

1. **Turning off autocommit: 537 s → 57 s, about 9.4×.** Each statement was its own transaction, so the database was flushing and fsyncing 400,896 times.
2. **Batching: 57 s → 4.6 s, a further ~12×.** The driver holds statements and ships them in one round trip, so 400,896 network calls become 256.

Note rows 2 and 3, and rows 5 and 6: **going from 256 commits to 1 barely matters** (57 vs 56, 3.9 vs 3.8). Commit cost is only significant at high frequency. So batching matters far more than minimising commits - and that is fortunate, because commit frequency is usually constrained by correctness.

```java
try (Connection c = dataSource.getConnection()) {
  c.setAutoCommit(false);                                   // effect 1
  try (PreparedStatement ps = c.prepareStatement(INSERT_STOCK);
       PreparedStatement ps2 = c.prepareStatement(INSERT_OPTION)) {
    for (StockPrice sp : prices) {
      ps.clearParameters();
      ps.setBigDecimal(1, sp.getClosingPrice());
      ps.addBatch();                                        // effect 2
      for (int j = 0; j < 5; j++) { ps2.clearParameters(); /* ... */ ps2.addBatch(); }
    }
    ps.executeBatch();
    ps2.executeBatch();
  }
  c.commit();
}
```

**Two practical limits.** Drivers cap batch size, and a batch consumes client memory, so flush periodically for very large loads rather than accumulating millions. And **a batch is one transaction**, which is why row 4 shows one commit per database call.

---

## Prepared statements and statement pooling

`PreparedStatement` lets the database reuse the parse and plan. It also parameterises properly, which is the security argument and the more important one.

**The benefit comes entirely from reuse.** The *first* execution is slower than a plain `Statement` because the database sets up and caches state. For a statement executed once, `Statement` is faster. For anything executed repeatedly - which is every server and most batch jobs - `PreparedStatement` wins decisively.

**Prepared statements pool per connection.** Each pooled connection builds its own cache of every statement the application uses. Two consequences:

- **The connection pool must exist for statement pooling to work at all.** A standalone application creating connections ad hoc gets no reuse.
- **The memory multiplies: pool size × distinct statements.** Statement caches are frequently large, and this is a real and often-missed heap cost. A large pool with many distinct statements can drive GC on its own.

Where pooling happens is not standardised, and this is a genuine trap: some drivers pool statements, some expect the container to; some containers pool, some expect the driver to. **Configure exactly one of them.** As a rule the driver does it better, being database-specific - Oracle needs explicit implicit/explicit caching properties, MySQL needs `cachePrepStmts=true`, and `setMaxStatements(0)` disables pooling in the `ConnectionPoolDataSource` API.

---

## Connection pool sizing

**Start with one connection per application thread**, then adjust in the direction the evidence points.

That default means no thread waits for a connection, and it is right when the database has capacity. The trade-offs run both ways:

| Symptom | Meaning | Action |
| ------- | ------- | ------ |
| Threads blocked waiting for a connection | Pool too small for the offered load | Enlarge - if the database can take it |
| Database CPU or I/O saturated | Pool too large; you are overloading it | **Shrink the pool** |
| Connections idle, heap pressure high | Statement caches consuming memory | Shrink the pool |

**A pool smaller than demand is a throttle, and that is a feature.** If the database cannot handle 100 concurrent connections, giving it 100 makes everything slower. Threads queueing for one of 20 connections yields higher total throughput than a saturated database - the same principle as bounding a queue in [concurrency-performance.md](concurrency-performance.md).

**On Java 21+ this needs restating.** Virtual threads remove the reason application threads were scarce, so "one connection per thread" becomes meaningless when there are a million threads. The database's capacity is now the *only* thing that sets the pool size - and the pool becomes the primary throttle protecting it. See [concurrency-performance.md](concurrency-performance.md).

---

## Transaction isolation and locking

Correctness first. A transaction needing repeatable reads is slower than one needing read-committed, and knowing that is no help if the application cannot tolerate non-repeatable reads. **Never trade correctness for speed here.**

| Isolation | Locks | Anomaly permitted |
| --------- | ----- | ----------------- |
| `TRANSACTION_SERIALIZABLE` | All accessed data, plus range locks | None |
| `TRANSACTION_REPEATABLE_READ` | All accessed data | Phantom reads |
| `TRANSACTION_READ_COMMITTED` | Only written rows | Non-repeatable reads |
| `TRANSACTION_READ_UNCOMMITTED` | None | Dirty reads |

Defaults differ by vendor - MySQL repeatable-read, Oracle and Db2 read-committed - and vendors do not support every level: Oracle has neither read-uncommitted nor repeatable-read. So an isolation level is not portable, and a driver may silently upgrade to the next strictest level it supports.

### Mixed isolation within one transaction

Usually the right shape. Updating my salary needs my employee row locked; the office-name lookup in the same transaction does not. Locking both is needless contention.

JPA expresses this per entity, which is why it is easier there. In plain JDBC, set a permissive default and lock explicitly:

```java
c.setTransactionIsolation(Connection.TRANSACTION_READ_UNCOMMITTED);
// lock only what must be locked - syntax is vendor-specific
try (var ps = c.prepareStatement("SELECT * FROM employee WHERE e_id = ? FOR UPDATE")) { ... }
// and read the rest without locking
try (var ps = c.prepareStatement("SELECT * FROM office WHERE office_id = ?")) { ... }
```

`FOR UPDATE` is **pessimistic locking** - it prevents others touching the row for the transaction's duration.

### Optimistic locking

A version column, checked on write:

```sql
SELECT first_name, last_name, version FROM employee WHERE e_id = 5058;   -- version 1012
UPDATE employee SET version = 1013 WHERE e_id = 5058 AND version = 1012; -- fails if changed
```

Much faster when collisions are rare - no locks held. **But a failure cannot be retried transparently**, and that is the critical difference from Java's CAS-based atomics ([concurrency-performance.md](concurrency-performance.md)). The JVM retries a failed CAS in a loop; a failed database transaction gives you `SQLException` on commit, or `OptimisticLockException` in JPA, and the application must decide what to do. Automatic retry risks an endless spiral, and it is usually impossible to know what to re-run.

**Use optimistic locking where collisions are genuinely rare** - a joint account where two people occasionally withdraw at once, and asking one to retry is acceptable. Do not use it for hot rows: high-frequency data would fail constantly, which is why real trading systems often use no locking for price data and lock only actual trades.

---

## Result set fetch size

A query returning 400,896 rows must live somewhere. Fetch everything and the heap holds it all; fetch one row per round trip and the network dominates.

```java
ps.setFetchSize(1000);   // rows per round trip - a HINT
```

Defaults are small (Oracle's is 10). **It is only a hint** - a driver may ignore, round or override it. Set it on the `Statement` *before* executing, not on the `ResultSet`, since that is more likely to be honoured.

**The signal that it is too small: `next()`, or the first getter, is intermittently slow** - every *n*th call makes a network round trip. Raise it when processing large result sets and watch heap in exchange.

---

## JPA

Everything above still applies - JPA runs on JDBC. Additional considerations follow.

### Bytecode enhancement is a prerequisite

JPA implementations rewrite entity bytecode to implement lazy loading and dirty tracking. **In a Java SE environment, if enhancement is not configured, performance is unpredictable** - fields expected to load lazily load eagerly, data written redundantly, cached data refetched. Servers do it transparently; standalone applications must do it at build time (Hibernate's Maven/Gradle plugin) or via an agent (`-javaagent:.../eclipselink.jar`). **Verify enhancement is happening before analysing anything else.**

### Batching and statement caching

Not exposed in the JPA API - configure in `persistence.xml`. EclipseLink:

```xml
<property name="eclipselink.jdbc.batch-writing" value="JDBC"/>
<property name="eclipselink.jdbc.batch-writing.size" value="10000"/>
<property name="eclipselink.jdbc.cache-statements" value="true"/>
```

Oaks measured writing the same dataset through JPA:

| Mode | Time |
| ---- | ---- |
| No batching, no statement pool | 83 s |
| No batching, statement pool | 64 s |
| **Batching**, no statement pool | **10 s** |
| Batching + statement pooling | 10 s |

**Batching is worth 8×; statement pooling adds nothing once batching is on.** Note also that JDBC drivers cannot batch automatically, so this property is always worth setting. Prefer statement caching in the *driver* over the JPA layer when both offer it.

`flush()` executes pending batched statements, so it is the programmatic alternative to a size limit.

### Reading less, and reading more

```java
@Lob @Basic(fetch = FetchType.LAZY)         // large fields: load only if asked
private byte[] imageData;

@OneToMany(mappedBy = "stock", fetch = FetchType.EAGER)   // related data always needed
private Collection<StockOptionPrice> optionsPrices;
```

`@OneToOne` and `@ManyToOne` are **eager by default** - so the useful optimisation there is often marking them `LAZY`. `@OneToMany` and `@ManyToMany` are lazy by default.

**Both are hints; the provider may ignore them.** And the common expectation that eager fetching produces a `JOIN` is **wrong** for typical providers: they issue one query for the primary entity and then **one query per related collection**. That is the N+1 problem, and it is why eager fetching often disappoints.

### N+1 and `JOIN FETCH`

```java
// one query for stocks, then one per stock for its options - the N+1 problem
em.createQuery("SELECT s FROM StockPriceImpl s");

// one query total
em.createQuery("SELECT s FROM StockOptionImpl s JOIN FETCH s.optionsPrices");
```

Oaks measured the difference over 256 stocks × 261 days: the default path issued **66,817 SQL statements** and took 22.7 s; a `JOIN FETCH` issued **1** and took 9.0 s.

**But `JOIN FETCH` interacts badly with the L2 cache**, and this is the counter-intuitive part below.

### The L2 cache changes the arithmetic

Two caches. The **L1** cache is per `EntityManager`, per transaction, always on, nothing to tune. The **L2** cache is shared across the application - on by default in EclipseLink, off by default in Hibernate.

**The rule that drives everything: the L2 cache holds entities loaded by primary key - via `find()` or relationship navigation - and *not* entities returned by a query.**

Oaks measured the same loop repeatedly:

| Approach | First execution | Subsequent executions |
| -------- | --------------- | --------------------- |
| Lazy relationship (default) | 22.7 s, 66,817 SQL | **1.1 s, 1 SQL** |
| Eager relationship | 23 s, 66,817 SQL | 1.0 s, 1 SQL |
| **`JOIN FETCH`** | **9.0 s, 1 SQL** | **5.6 s, 1 SQL** |
| `JOIN FETCH` + query cache | 5.8 s | **0.001 s, 0 SQL** |
| No query at all - `find()` only | 35 s, 133,632 SQL | **0.28 s, 0 SQL** |

Read the last two columns together, because they invert the obvious conclusion:

- `JOIN FETCH` is **2.5× faster on the first run** (9.0 s against 22.7 s) and **5× slower on every run after** (5.6 s against 1.1 s). Its single query is never cached, so it re-fetches 400,000 rows every time, while the lazy version finds its option prices in the L2 cache and needs one query.
- **Avoiding queries entirely is worst at first and best thereafter** - 35 s cold, then 0.28 s with *no SQL at all*, because everything is reachable by primary key.

**So hand-writing better SQL can make a long-running application slower.** Before optimising a query, ask what the L2 cache would have done with it. And when warming a cache, navigate relationships rather than fetching related entities one by one - the five option prices for a symbol and date arrive in one call through the relationship, which is why 66,816 statements suffice for 334,080 rows.

Named queries (`createNamedQuery`) are usually faster than ad hoc ones, because providers reliably use a `PreparedStatement` with bind parameters for them and often do not for `createQuery`.

Paging with `setFirstResult`/`setMaxResults` pushes the range into SQL rather than fetching and discarding.

**Size the L2 cache.** It is an object pool, with all the consequences from [object-lifecycle.md](object-lifecycle.md): 400,000 cached entities is a large permanent live set that lengthens every full GC. Configure a bound per entity, or use soft references - but note weak references make a poor cache ([object-lifecycle.md](object-lifecycle.md)), and a soft-reference cache needs `SoftRefLRUPolicyMSPerMB` tuning to behave.

---

## Version notes

This material is driver- and provider-specific rather than JDK-specific; the JDK-level notes:

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| `jdk.SocketRead` / `jdk.SocketWrite` JFR events | ✗ | ✓ | ✓ | ✓ | ✓ |
| `jdk.JavaMonitorEnter` for pool contention | ✗ | ✓ | ✓ | ✓ | ✓ |
| Virtual threads change pool sizing logic | ✗ | ✗ | ✗ | ✓ | ✓ |
| Blocking JDBC pins a carrier inside `synchronized` | - | - | - | **✓ (≤23)** | ✗ |
| JDBC type 1 (ODBC bridge) | removed in 8 | - | - | - | - |

Two notes:

- **On Java 21-23, a blocking JDBC call inside a `synchronized` block pins its carrier thread**, capping concurrency at the carrier count. Connection pools and drivers that synchronise around I/O were a real source of this. Fixed in 24 (JEP 491); on 21-23 prefer `ReentrantLock`, and check driver and pool versions for the same fix. See [concurrency-performance.md](concurrency-performance.md).
- **Driver type is not a performance predictor.** Type 2 (native) and type 4 (pure Java) both perform well and neither has an inherent advantage; likewise "thin" versus "thick" drivers just move work between client and server, so the better one depends on which side has spare capacity. A small client against a large well-tuned database wants a thin driver; a hundred departments against one shared database want thick. **Be suspicious of vendor benchmarks** - it is easy to pick an environment that flatters either. Test in yours.

## Gotchas

- Agent tunes the JVM when the database is saturated - this makes the whole system slower; measure the database first
- Agent optimises Java-side code without checking where threads are blocked - `socketRead0` means the database or the network
- Agent leaves autocommit on for bulk work - measured 9.4× penalty over 400k inserts
- Agent does not batch - measured a further 12×, and 141× combined with autocommit off
- Agent focuses on reducing commit count - 256 commits against 1 was 57 s against 56 s; batching matters far more
- Agent accumulates an unbounded batch - drivers cap it and it consumes client memory; flush periodically
- Agent uses `PreparedStatement` for a statement executed once - plain `Statement` is faster for genuinely one-off SQL
- Agent enables statement pooling in both the driver and the container - configure exactly one
- Agent ignores that statement caches multiply by pool size - a real and frequently missed heap cost
- Agent enlarges the connection pool because threads are waiting - if the database is saturated, shrink it instead
- Agent keeps "one connection per thread" on Java 21+ with virtual threads - meaningless with a million threads; size to the database's capacity
- Agent lowers the isolation level for speed without checking correctness - never trade correctness here
- Agent assumes an isolation level is portable - vendors differ, and some silently upgrade
- Agent retries a failed optimistic transaction automatically - cannot be retried transparently; the application must decide
- Agent uses optimistic locking on hot rows - collisions become constant
- Agent sets `setFetchSize` on the `ResultSet` - set it on the `Statement` before executing
- Agent analyses JPA performance without verifying bytecode enhancement - behaviour is unpredictable until it is configured
- Agent expects eager fetching to produce a `JOIN` - typical providers issue N+1 queries instead
- Agent adds `JOIN FETCH` to fix N+1 without considering the L2 cache - measured 5× *slower* on repeat executions because query results are not cached
- Agent warms an L2 cache by fetching related entities individually - navigate the relationship and get them in one call
- Agent leaves the L2 cache unbounded - a large permanent live set that lengthens every full GC
- Agent picks a JDBC driver on vendor benchmark claims - type and thin/thick are not performance predictors; test in your environment

## Related

- [triage.md](triage.md) · [concurrency-performance.md](concurrency-performance.md) · [object-lifecycle.md](object-lifecycle.md) · [heap-analysis.md](heap-analysis.md) · [server-performance.md](server-performance.md) · [gc-tuning.md](gc-tuning.md) · [tooling.md](tooling.md) · [`postgresql-developer`](../../postgresql-developer/SKILL.md) · [`spring-boot-developer`](../../spring-boot-developer/SKILL.md)
