# Testing

**Test against real PostgreSQL.** H2, SQLite and in-memory substitutes do not have RLS, `jsonb`, arrays, ranges, partial indexes, `ON CONFLICT`, window functions, `LATERAL`, exclusion constraints, or PostgreSQL's NULL and locking semantics. A test suite that passes against H2 has verified that the code compiles.

**Match the version.** Testcontainers pinned to `postgres:16` while production runs 18 silently accepts a schema that behaves differently - generated columns default differently, `MERGE` behaves differently, skip scan changes plans. Pin the image to the production major.

## Testcontainers

```java
@Container
static PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:18-alpine")
        .withReuse(true);
```

`withReuse(true)` plus `testcontainers.reuse.enable=true` keeps the container alive between runs, turning a 5-second startup into nothing. Worth the setup.

Speed up the container itself - durability does not matter for a test database:

```
-c fsync=off -c full_page_writes=off -c synchronous_commit=off
```

This is safe here for exactly the reason it is unsafe in production: nothing needs to survive a crash.

## Isolation between tests

| Strategy | Speed | Notes |
|---|---|---|
| **Transaction rollback** | Fastest | Wrap each test in a transaction, roll back. **Cannot test commit behaviour, triggers on commit, or real concurrency** |
| **`TRUNCATE ... CASCADE`** | Fast | Truncate all tables between tests, reseed reference data |
| **Template database** | Fast | `CREATE DATABASE test_x TEMPLATE test_template` - a clean copy per test |
| **Fresh container** | Slowest | Full isolation. For migration tests |

Transaction rollback is the default choice and has a real blind spot: it cannot test anything involving a second connection, because uncommitted data is invisible to it. Any test of locking, deadlocks, isolation levels or RLS-under-pooling needs committed data and two connections.

The template-database approach is underused and is the best compromise for suites that need committed data.

## What to test

### Constraints

Constraints are code. A `CHECK` with a subtle NULL bug passes every test that only inserts valid rows.

```java
@Test void rejects_negative_total() {
    assertThatThrownBy(() -> insertOrder(-5))
        .hasMessageContaining("orders_total_positive_check");
}

@Test void allows_null_total_which_is_probably_wrong() {
    // A CHECK that evaluates to NULL passes. Assert the intended behaviour.
}
```

Assert on the **constraint name**, which is why naming them matters. See [constraints.md](constraints.md).

Test the boundaries: zero, negative, NULL, the maximum, an empty string, and a duplicate.

### Migrations

- **Forwards on an empty database**, which is what CI usually does.
- **Forwards on a copy with realistic data**, which is what production does. A migration that works on an empty table may take twenty minutes and lock everything on 50 million rows.
- **The rollback**, if one is claimed.
- **The previous application version against the new schema.** During a rolling deploy both run at once. A dropped column the old version still selects is an outage for the old pods.
- **Idempotence**, if the tooling can re-run.

A migration safety linter (`squawk`, `eugene`) in CI catches dangerous DDL before review does - the volatile-default rewrite, the missing `CONCURRENTLY`, the unqualified `SET NOT NULL`. Highest-value single addition to a migration pipeline. See [migrations.md](migrations.md).

### RLS

The one most often untested, and the one where a gap is a data breach.

Test as the **actual application role**, not as superuser and not as the table owner - both bypass policies.

```sql
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('app.tenant_id', '1', true);

-- 1. Sees own rows
SELECT count(*) FROM invoices;                       -- expect only tenant 1

-- 2. Cannot see another tenant's
SELECT count(*) FROM invoices WHERE tenant_id = 2;   -- expect 0

-- 3. Cannot write into another tenant  <- the one people omit
INSERT INTO invoices (tenant_id, ...) VALUES (2, ...);   -- expect rejection

ROLLBACK;
```

Plus the fail-closed case:

```sql
BEGIN;
SET LOCAL ROLE app_user;
-- deliberately set nothing
SELECT count(*) FROM invoices;   -- MUST be 0, not everything
ROLLBACK;
```

That last test is what catches a fail-open predicate, and it is worth writing for every RLS-protected table. See [row-level-security.md](row-level-security.md).

### Concurrency

Needs two real connections and committed data, so transaction-rollback isolation cannot do it.

Worth testing:

- A unique constraint under concurrent insert - does the application handle the violation?
- `ON CONFLICT` under concurrency.
- Deadlock retry - does the retry loop actually fire and succeed?
- `SELECT ... FOR UPDATE SKIP LOCKED` in a queue - do two workers take different jobs?
- Serialisation failure at `SERIALIZABLE` - does `40001` get retried?

```java
@Test void two_workers_claim_different_jobs() throws Exception {
    seedJobs(2);
    var a = supplyAsync(() -> claimJob(dsA));
    var b = supplyAsync(() -> claimJob(dsB));
    assertThat(a.get().id()).isNotEqualTo(b.get().id());
}
```

These tests are fiddly and they find real bugs that no single-connection test can.

### Query correctness

The failure mode is a query that returns plausible wrong numbers.

- **NULL handling.** A row with NULLs in every nullable column, in every fixture. `NOT IN`, outer joins and aggregates all behave differently in its presence. See [null-handling.md](null-handling.md).
- **Join fan-out.** A parent with two children in one table and three in another. If an aggregate is inflated, this fixture catches it and no other does. See [joins.md](joins.md).
- **Empty results.** Zero rows, and aggregates over zero rows - `sum()` returns NULL, not 0.
- **Ordering.** If a test depends on row order, the query needs a deterministic `ORDER BY` including a tiebreaker. Otherwise it passes locally and fails in CI when the plan changes.

### Performance

Not on every commit, but worth having:

- **Query count per endpoint.** Assert an upper bound. This catches N+1 the day it is introduced, which production monitoring does not do as cheaply.
- **Plan shape on critical queries.** Assert no `Seq Scan` on a large table, or that a specific index is used. Brittle if over-applied; valuable on the three queries that matter.
- **Realistic volumes for critical paths.** Plans change qualitatively with data size, so a test on 100 rows proves nothing about 100 million.

```java
@Test void order_lookup_uses_the_index() {
    var plan = jdbc.queryForObject(
        "EXPLAIN (FORMAT JSON) SELECT * FROM orders WHERE customer_id = ?",
        String.class, 1L);
    assertThat(plan).contains("Index Scan").doesNotContain("Seq Scan");
}
```

## Fixtures

**Realistic distributions, not uniform ones.** Uniformly generated data has none of the skew that causes real misestimates, so a plan validated against it can be completely different in production. If 5% of customers hold 80% of orders, the fixtures should reflect that.

**Anonymise, do not invent, for volume tests.** A masked copy of production has the right cardinality, the right skew and the right correlations. Generated data has none of them. Mask personal data on extraction, never after loading.

Reference data - lookup tables, statuses, currencies - belongs in a migration, not in test fixtures. It is part of the schema.

## Testing database code

Functions and triggers are the least-tested part of most schemas and the most invisible when wrong.

**`pgTAP`** provides SQL-level assertions and runs inside the database:

```sql
SELECT plan(3);
SELECT has_table('public', 'orders', 'orders table exists');
SELECT col_not_null('orders', 'customer_id', 'customer_id is NOT NULL');
SELECT throws_ok(
    $$ INSERT INTO orders (total) VALUES (-1) $$,
    '23514', NULL, 'negative totals are rejected');
SELECT finish();
```

Otherwise test through the application - but for a trigger, write **directly to the table** rather than through the code path that normally does. The whole point of a trigger is that it works regardless of path, so a test that goes through the service layer does not test the trigger's guarantee.

## CI

```
1. Start PostgreSQL, pinned to the production major
2. Run migrations from scratch
3. Lint the migrations (squawk / eugene)
4. Run the test suite
5. Run migrations against a restored anonymised snapshot, and time them
6. Assert query counts on key endpoints
```

Step 5 is the one usually missing and the one that catches the migration that takes twenty minutes.

## Version notes

- **18** - generated columns default to `VIRTUAL`, which changes behaviour if tests run on 18 and production on 17, or the reverse. The strongest current argument for pinning the test image to the production major.
- **17+** - `COPY ... ON_ERROR ignore` simplifies loading imperfect fixture data.
- **15+** - `MERGE` and `security_invoker` views exist. Tests exercising either fail on 14.

Test isolation strategies and Testcontainers behaviour are otherwise the same across 14 to 18.

## Gotchas

- Agent tests against H2, SQLite or an in-memory substitute - none has RLS, `jsonb`, arrays, ranges, partial indexes or PostgreSQL's NULL semantics
- Agent uses a Testcontainers image of a different major version from production - generated columns, `MERGE` and plan shapes all differ
- Agent uses transaction-rollback isolation and tries to test concurrency - uncommitted data is invisible to a second connection
- Agent tests RLS as superuser or as the table owner - both bypass policies entirely
- Agent tests RLS reads but not cross-tenant **writes** - that is what `WITH CHECK` guards
- Agent does not test the no-session-variable case - that is what catches a fail-open policy
- Agent tests migrations only on an empty database - production has data, and the timing is qualitatively different
- Agent does not test the previous application version against the new schema - both run during a rolling deploy
- Agent writes fixtures with uniform distributions - real misestimates come from skew, which uniform data does not have
- Agent generates volume data instead of anonymising a production copy - the cardinality and correlations are wrong
- Agent omits NULLs from fixtures - `NOT IN`, outer joins and aggregates all behave differently with them
- Agent omits a fan-out fixture - an inflated aggregate from a double join passes every other test
- Agent depends on row order without a deterministic `ORDER BY` - passes locally, fails when the plan changes
- Agent tests a trigger only through the service layer - the trigger's guarantee is that it works regardless of path
- Agent asserts on an error message rather than a constraint name or SQLSTATE - messages change between versions

## Related

- [migrations.md](migrations.md) · [row-level-security.md](row-level-security.md) · [constraints.md](constraints.md) · [application-integration.md](application-integration.md) · [transactions-and-isolation.md](transactions-and-isolation.md) · [locking.md](locking.md) · [null-handling.md](null-handling.md) · [explain.md](explain.md) · [functions-and-triggers.md](functions-and-triggers.md)
