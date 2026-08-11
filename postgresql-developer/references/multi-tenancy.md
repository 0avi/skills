# Multi-Tenancy

The hardest decision in a SaaS schema, and the one most expensive to reverse. Make it before any table exists.

There are three models and one hybrid. The right answer is usually the hybrid, but only if you understand why each pure model fails.

## The three models

| Model | Shape | Isolation | Strongest failure mode |
|---|---|---|---|
| **Shared schema** | One set of tables, every row carries `tenant_id`, RLS enforces isolation | Logical, enforced by policy | Table-wide planner statistics and autovacuum scheduling are shared, so one large or noisy tenant degrades plans and maintenance for every tenant in the table |
| **Schema-per-tenant** | One database, one schema per tenant, identical tables repeated | Logical, enforced by `GRANT` | A DDL change becomes N independent migrations. A mid-batch failure leaves the fleet **partially migrated**, with no cheap rollback |
| **Database-per-tenant** | A separate physical database per tenant | Physical | Same migration problem, **plus** a transaction can never span two databases. Heaviest per-tenant connection and provisioning cost |

## Where the shared-schema fear is mis-located

The usual objection is "a tenant with 10 million rows will slow down the tenant with 3 rows because the table is huge". That is mostly wrong. B-tree lookups are `O(log n)`; going from 10^4 to 10^7 rows adds about three index-node visits. Table size is close to irrelevant to a keyed lookup.

The real risks are elsewhere, and they are subtler:

**Planner statistics are table-wide, not tenant-scoped.** `ANALYZE` samples the whole table and builds one set of statistics. A small tenant's `tenant_id` will not appear in the most-common-values list, so the planner estimates its selectivity as roughly `1/n_distinct`. With 500 tenants, that is "assume 1/500 of the table matches" for a predicate that actually matches 3 rows out of 10 million. That misestimate is harmless for a single-table lookup and destructive once the query has a join, because it flips join order, join method and memory allocation.

Mitigations: raise the statistics target on `tenant_id`, add extended statistics for correlated columns, or partition by tenant so each partition has its own statistics. See [statistics-and-planner.md](statistics-and-planner.md).

**Autovacuum is table-scoped.** The decision to vacuum is driven by the dead-tuple ratio of the entire table. A write-heavy tenant sets the maintenance schedule for every tenant sharing it. Worse, a long-running transaction anywhere in that table - even one touching only one tenant's rows - holds back the vacuum horizon for all of them, so dead tuples from every tenant accumulate. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

Both are real. Both are **mitigable**. Neither is a reason to reject shared schema as the default.

## Why per-tenant migration is the operational landmine

Schema-per-tenant and database-per-tenant share a failure mode that is much worse than it first looks.

A tool rolling `ALTER TABLE ... ADD COLUMN` across 500 tenants runs each tenant's DDL as its own transaction, committing as it goes. If it fails at tenant 247, tenants 1 to 246 are **already committed**. There is no rollback. Undoing them requires a new, explicitly written, forward-running compensating migration - which itself risks data loss if anything has written to the new column in the meantime.

Wrapping all tenants in one transaction does not fix it:

- Across separate **databases** it is architecturally impossible. One connection, one database.
- Across **schemas** in one database it is technically possible, because PostgreSQL DDL is transactional. But it trades many small isolated failures for one all-or-nothing blast radius, holds locks on every tenant's tables simultaneously, and holds back the vacuum horizon for the whole database for as long as it runs.

So per-tenant migration needs: per-tenant bookkeeping of which version each tenant is on, resumability from the point of failure, and forward-only compensating changes. That is a real system to build and operate, and it is the strongest argument against schema-per-tenant.

## Database-per-tenant: the hard limit

A PostgreSQL connection is bound to exactly one database. **A single transaction can never span two databases.** This is architectural, not a tuning problem. `postgres_fdw` and `dblink` let you read across, with no atomicity.

The consequences:

- No cross-tenant reporting query. Aggregate reporting needs a separate warehouse or an ETL process.
- No shared reference data by foreign key. Every tenant database needs its own copy, kept in sync by something you write.
- Connection pools multiply. 500 tenant databases with a modest pool each will exhaust `max_connections` long before the hardware is busy. See [connections-and-pooling.md](connections-and-pooling.md).

Its virtue is that isolation is physical, which is the one thing RLS can never provide.

## The decision

```
Does a contract, regulator or certification require physical data separation?
├── Yes, for all tenants  ->  database-per-tenant. The cost is the price of the requirement.
└── No
    │
    Do you need cross-tenant queries (reporting, admin, analytics, marketplace)?
    ├── Yes  ->  shared schema. The alternatives make this impossible or an ETL project.
    └── No / rarely
        │
        Tenant count?
        ├── Thousands+     ->  shared schema. Per-tenant DDL does not scale to this.
        ├── Tens to low hundreds, with genuinely per-tenant customisation
        │                  ->  schema-per-tenant is defensible, if you build migration tooling first
        └── Otherwise      ->  shared schema
```

**Default to shared schema plus RLS**, with an explicit escape hatch to promote an individual tenant to a dedicated database.

### What actually triggers promotion

Not row count. In practice the trigger is **contractual or compliance-driven** - a client requiring a physical guarantee of separation, which no amount of correct RLS satisfies, because the requirement is about storage, not access control.

A performance-driven promotion is a real but softer secondary trigger, and it must be backed by monitoring data rather than a guessed threshold. Row count alone predicts nothing: a huge append-only table that is rarely queried behaves completely differently from a smaller, heavily updated one. See [performance-triage.md](performance-triage.md).

The hybrid means running **both** patterns in the steady state, not just during a migration. Application code and connection routing must know which tenants live where, from day one.

## Implementing shared schema

`tenant_id` goes on **every** tenant-scoped table. Not just the roots - every one. Deriving a child row's tenant by joining to its parent means the RLS policy needs a subquery, which is slow and easy to get wrong.

```sql
CREATE TABLE invoices (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id  bigint      NOT NULL REFERENCES tenants (id),
    number     text        NOT NULL,
    total      numeric(14,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Scope every uniqueness rule to the tenant. Invoice numbers
    -- collide across tenants and that is correct.
    CONSTRAINT invoices_tenant_number_key UNIQUE (tenant_id, number)
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY invoices_tenant_isolation ON invoices
    USING      (tenant_id = current_setting('app.tenant_id', true)::bigint)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::bigint);
```

Five rules that follow, each of which is a real bug when missed:

1. **`tenant_id` leads every composite index.** Every query is tenant-scoped, so it is the most selective available prefix and belongs first. See [composite-and-covering-indexes.md](composite-and-covering-indexes.md).
2. **Every unique constraint includes `tenant_id`.** A global `UNIQUE (email)` means one tenant's user blocks another tenant's. Almost always wrong.
3. **Composite foreign keys prevent cross-tenant references.** A plain `FOREIGN KEY (customer_id)` permits an invoice in tenant A to reference a customer in tenant B. Adding `tenant_id` to both sides of the key makes it impossible:
   ```sql
   -- Requires UNIQUE (tenant_id, id) on customers.
   FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)
   ```
   This is belt and braces over RLS, and it is worth it: RLS is a session-state mechanism and session state can be wrong.
4. **`FORCE ROW LEVEL SECURITY`**, or the table owner silently bypasses every policy.
5. **The application role must not be superuser and must not have `BYPASSRLS`.** Either makes every policy inert. See [row-level-security.md](row-level-security.md).

### The landmine: session variables under pooling

This is the single most dangerous failure mode of shared-schema multi-tenancy, and it is silent.

`SET app.tenant_id = '...'` is **session-scoped**. It persists on the physical connection until something changes it, across transaction boundaries. Connection pools - PgBouncer in transaction mode, HikariCP, any pool - hand the same physical connection to unrelated requests over time and do **not** reset custom GUCs on return.

The result is one tenant's context leaking into another tenant's request. No error, no exception, no empty result. Just the wrong customer's data, returned successfully.

```sql
-- Wrong under any pool.
SET app.tenant_id = '42';

-- Correct: transaction-scoped, reverts on COMMIT or ROLLBACK
-- regardless of what happens to the connection afterwards.
SET LOCAL app.tenant_id = '42';
```

`SET LOCAL` only works **inside a transaction block**. In autocommit mode it does not survive to the next statement, which fails closed - an empty result rather than a leak - but is still broken.

In Spring, the pattern is an interceptor ordered to run *after* `@Transactional` has opened the transaction, issuing `SET LOCAL` as the first statement, with the tenant taken from the authenticated principal. Setting it in a `ThreadLocal` and hoping is not sufficient; the value has to reach the database inside the same transaction.

Prefer passing the tenant as a **parameter** to a `SET LOCAL` executed via a parameterised call, and never build it by string concatenation - `SET` does not accept placeholders directly, so use `set_config('app.tenant_id', $1, true)`, whose third argument means transaction-local:

```sql
SELECT set_config('app.tenant_id', $1, true);
```

Verify the isolation with a test that opens two transactions on the same pooled connection in sequence. See [testing.md](testing.md).

## Implementing schema-per-tenant

Routing is by `search_path`, set per transaction with the same `SET LOCAL` discipline and the same pooling hazard:

```sql
SET LOCAL search_path TO tenant_00247, shared;
```

Isolation is enforced by `GRANT`/`REVOKE` at the schema level rather than by policy, which is simpler to reason about than RLS and coarser.

What you must build before adopting this:

- **Per-tenant migration bookkeeping.** A table recording each tenant's schema version, updated in the same transaction as that tenant's DDL.
- **A resumable runner** that skips already-migrated tenants and can restart from a failure.
- **Forward-only compensating migrations.** No rollback.
- **A template schema** and automated provisioning, so a new tenant is not a manual DDL run.

Practical limits: several thousand schemas each with dozens of tables produces hundreds of thousands of rows in `pg_class`, which slows catalogue lookups, `pg_dump`, and connection startup. It works, but it stops being comfortable somewhere in the low thousands of tenants.

## Promoting a tenant to a dedicated database

The realistic mechanism is **logical replication**, because it moves a subset of rows with low downtime.

1. Provision the target database with the same schema.
2. Create a publication on the source filtered to the tenant - `CREATE PUBLICATION ... FOR TABLE invoices WHERE (tenant_id = 42)` (row filters require **15+**).
3. Subscribe from the target and let it catch up.
4. At cutover: stop writes for that tenant, wait for the subscription to drain, flip routing, resume.
5. Leave the source rows in place until the new database is verified, then delete them.

Sequences do not replicate. Advance them on the target before cutover or the first insert collides. See [replication-and-scaling.md](replication-and-scaling.md).

## Version notes

- **15+** - row filters and column lists on publications, which is what makes single-tenant logical replication practical. Before 15, a publication is whole-table and promotion needs a bespoke copy process.
- **15+** - `CREATE` on `public` is revoked from `PUBLIC`, which affects schema-per-tenant provisioning scripts written against 14.
- **18** - `uuidv7()` matters if tenants generate identifiers client-side. See [keys-and-identifiers.md](keys-and-identifiers.md).
- **14+** - `ALTER TABLE ... DETACH PARTITION CONCURRENTLY` makes partition-per-tenant extraction feasible without a long lock.

RLS itself, `FORCE ROW LEVEL SECURITY`, `BYPASSRLS` and `set_config` behave identically across 14 to 18.

## Gotchas

- Agent picks a tenancy model without asking about compliance requirements or cross-tenant reporting - those two answers decide it
- Agent rejects shared schema on "noisy neighbour" grounds citing table size - B-tree lookups are near-flat in table size; the real risks are shared statistics and shared autovacuum
- Agent proposes schema-per-tenant without building migration bookkeeping first - the first partial failure leaves the fleet in an unknown state with no rollback
- Agent proposes cross-tenant reporting on database-per-tenant - a transaction cannot span databases, and this cannot be worked around
- Agent uses `SET app.tenant_id` instead of `SET LOCAL` - pools do not reset custom GUCs, so one tenant's context silently leaks into another's request
- Agent uses `SET LOCAL` outside a transaction block - it does not survive to the next statement
- Agent omits `tenant_id` from child tables and derives it by joining - the policy needs a subquery and is slow and fragile
- Agent writes `UNIQUE (email)` in a shared-schema design - one tenant's value then blocks every other tenant's
- Agent writes single-column foreign keys in a shared schema - nothing prevents tenant A's invoice referencing tenant B's customer
- Agent omits `FORCE ROW LEVEL SECURITY` - the table owner bypasses every policy
- Agent uses a superuser or `BYPASSRLS` role for the application - every policy becomes inert with no error
- Agent leaves `tenant_id` out of the leading position of composite indexes - every query is tenant-scoped, so it belongs first
- Agent promotes a tenant by logical replication and forgets sequences - they do not replicate, and the first insert on the target collides

## Related

- [row-level-security.md](row-level-security.md) · [schema-organisation.md](schema-organisation.md) · [connections-and-pooling.md](connections-and-pooling.md) · [migrations.md](migrations.md) · [partitioning.md](partitioning.md) · [replication-and-scaling.md](replication-and-scaling.md) · [statistics-and-planner.md](statistics-and-planner.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md)
