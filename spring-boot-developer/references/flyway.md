# Flyway

The database schema is version-controlled, forward-only, and owned by migration scripts - never by `ddl-auto`. Set `spring.jpa.hibernate.ddl-auto=validate` so Hibernate checks the schema matches the entities and refuses to start when it does not.

## Dependencies

On **Boot 4**, Flyway is no longer pulled in transitively by the JDBC or JPA starters. Without the starter, migrations silently never run and the application starts against whatever schema happens to exist:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-flyway</artifactId>
</dependency>
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-database-postgresql</artifactId>
</dependency>
```

The second is also required. Flyway 10 split database support into per-database modules; with only `flyway-core` on the classpath, startup fails with "Unsupported Database".

## Naming

```
src/main/resources/db/migration/
    V1__create_customers.sql
    V2__create_orders.sql
    V2_1__add_orders_status_index.sql
    V3__add_orders_cancelled_at.sql
    R__order_summary_view.sql
```

| Prefix | Meaning |
|---|---|
| `V` | Versioned - runs once, in version order |
| `R` | Repeatable - runs whenever its checksum changes, after all versioned migrations |
| `U` | Undo - Flyway Teams only. Treat undo as unavailable |

**Two underscores** between version and description; single underscores inside the description. `V1_create_customers.sql` is not a valid migration and is silently ignored.

Repeatable migrations are for objects you can safely recreate wholesale - views, functions, stored procedures. Write them idempotently (`CREATE OR REPLACE`).

## The rule that matters

**Never modify a migration that has run anywhere.** Flyway stores a checksum per applied migration; changing the file makes `validate` fail on every environment that already applied it, and your local database no longer matches production's history.

Wrong in production? Write `V4__fix_the_thing.sql`. The history is an append-only log.

The only exception is a migration that exists nowhere but your own working copy, uncommitted.

## Expand and contract

Migrations run while the previous version of the application is still serving traffic. Any change that breaks the running code is an outage.

```sql
-- ❌ breaks the running application the instant it commits
ALTER TABLE orders RENAME COLUMN user_id TO customer_id;
```

Split it across releases:

```sql
-- V5: expand - add the new column, nullable
ALTER TABLE orders ADD COLUMN customer_id UUID;
UPDATE orders SET customer_id = user_id WHERE customer_id IS NULL;
ALTER TABLE orders ALTER COLUMN customer_id SET NOT NULL;
```

Deploy code that writes **both** columns and reads the new one. Then, in a later release, once nothing references the old column:

```sql
-- V6: contract
ALTER TABLE orders DROP COLUMN user_id;
```

The same shape applies to narrowing a type, splitting a column, or making a column required. Three steps, at least two deployments, and each intermediate state must be one the running code tolerates.

## Safe and unsafe operations

```sql
-- ✅ safe
ALTER TABLE orders ADD COLUMN notes TEXT;                       -- nullable
ALTER TABLE orders ADD COLUMN priority INT NOT NULL DEFAULT 0;  -- NOT NULL with a default
CREATE TABLE order_notes (…);
```

```sql
-- ❌ fails if any row exists
ALTER TABLE orders ADD COLUMN priority INT NOT NULL;

-- ❌ rewrites and exclusively locks the whole table on most engines
ALTER TABLE orders ALTER COLUMN description TYPE VARCHAR(100);
```

On PostgreSQL 11+, adding a `NOT NULL` column *with a constant default* no longer rewrites the table. A **volatile** default still does.

### CREATE INDEX CONCURRENTLY

`CONCURRENTLY` avoids locking the table for writes - and cannot run inside a transaction. Flyway wraps every migration in one, so it fails. Opt that script out with a sidecar config file:

```
V7__add_orders_email_index.sql
V7__add_orders_email_index.sql.conf     →  executeInTransaction=false
```

```sql
CREATE INDEX CONCURRENTLY idx_orders_email ON orders (customer_email);
```

Keep the `CONCURRENTLY` statement alone in its own migration. Without a transaction there is no rollback, so a failure leaves a partially-built invalid index that you must drop by hand before retrying.

## Indexes

Index every foreign key, and every column used in `WHERE` or `ORDER BY` on a large table. PostgreSQL indexes the primary key automatically but **not** foreign keys, so an un-indexed FK makes deletes on the parent scan the child table.

Match the index to the query, including sort direction, for keyset pagination:

```sql
CREATE INDEX idx_orders_status_placed ON orders (status, placed_at DESC, id DESC);
```

See [spring-data-jpa.md](spring-data-jpa.md).

## Configuration

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    validate-on-migrate: true
    out-of-order: false
    baseline-on-migrate: false
    clean-disabled: true
  jpa:
    hibernate:
      ddl-auto: validate
```

| Setting | Why |
|---|---|
| `clean-disabled: true` | `flyway:clean` **drops every object in the schema**. Flyway disables it by default now; keep it explicit so nobody re-enables it |
| `out-of-order: false` | A migration numbered below the current version is rejected. Turning this on hides merge mistakes |
| `baseline-on-migrate` | Only for adopting Flyway on an existing database. Turn it off again once baselined - it otherwise masks an empty-database mistake |
| `validate-on-migrate: true` | Checksums are verified at startup |

## Seed data

Reference data the application requires in every environment - countries, currencies, roles - is schema, and belongs in a migration.

Development and demo data is not. Use a profile-scoped runner:

```java
@Component
@Profile("local")
class DevDataSeeder implements ApplicationRunner {

    private final CustomerRepository customers;

    DevDataSeeder(CustomerRepository customers) {
        this.customers = customers;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (customers.count() == 0) {
            customers.save(Customer.create(EmailAddress.of("dev@example.com")));
        }
    }
}
```

Seed data in a migration ends up in production, and it cannot be changed afterwards without another migration.

## Working in a team

Two developers both writing `V8__` is the normal failure, and it surfaces as a checksum or ordering error on whichever branch merges second.

- Number by a timestamp - `V20260810_1430__add_orders_index.sql` - and collisions effectively stop.
- Run `flyway validate` in CI on a database restored to the previous release's state. This catches a modified migration before it reaches an environment.
- Review migrations like production changes, because that is what they are.

## Batch metadata

If you use Spring Batch, its `BATCH_*` tables are schema too. Set `spring.batch.jdbc.initialize-schema=never` and ship the DDL as a migration - the canonical scripts are inside `spring-batch-core`. Batch 6 renamed `BATCH_JOB_SEQ` to `BATCH_JOB_INSTANCE_SEQ`, so an existing Boot 3 database needs a migration for that rename. See [spring-batch.md](spring-batch.md).

Spring Modulith's event publication table is the same story - see [spring-modulith.md](spring-modulith.md).

## Testing migrations

Migrations run against a real database in tests, so they are covered by the same Testcontainers setup as everything else - a persistence slice test that starts is already proof the migrations apply cleanly and that Hibernate's `validate` agrees with them. That is one of the strongest arguments against H2: migrations written in PostgreSQL dialect will not even run on it. See [testing-slices-persistence.md](testing-slices-persistence.md).

For a destructive migration, test the **data**, not just the schema: seed the old shape, migrate, assert the new shape.

## If on Boot 3.5.x

Flyway arrives transitively with the JDBC and JPA starters, so `spring-boot-starter-flyway` is not needed - though `flyway-database-postgresql` still is on Flyway 10+. Everything else is identical.

## Gotchas

- Agent adds `spring-boot-starter-data-jpa` and expects migrations to run on Boot 4 - add `spring-boot-starter-flyway` explicitly
- Agent adds only `flyway-core` - database support lives in `flyway-database-<db>`; startup fails with "Unsupported Database"
- Agent edits an applied migration - checksum validation fails everywhere it already ran; write a new one
- Agent uses a single underscore - `V1_create_users.sql` is silently ignored
- Agent renames a column in one migration - breaks the running application; expand and contract
- Agent adds `NOT NULL` with no default to a populated table - the migration fails
- Agent puts `CREATE INDEX CONCURRENTLY` in a normal migration - it cannot run in a transaction; needs a `.sql.conf` sidecar with `executeInTransaction=false`, in its own file
- Agent seeds demo data in a migration - use a `@Profile` runner; migrations reach production
- Agent leaves `ddl-auto` at `update` alongside Flyway - two things own the schema and they will disagree
- Agent enables `out-of-order` to fix a merge conflict - that hides the ordering bug; renumber instead
- Agent leaves `baseline-on-migrate: true` after adoption - it silently baselines an empty database
- Agent skips indexes on foreign keys - deletes on the parent scan the child table
- Agent lets Spring Batch or Modulith create their tables in production - ship them as migrations

## Related

- [spring-data-jpa.md](spring-data-jpa.md) · [testing-slices-persistence.md](testing-slices-persistence.md) · [spring-batch.md](spring-batch.md) · [configuration.md](configuration.md)
