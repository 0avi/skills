# Constraints

The database is the only layer that cannot be bypassed. Application validation is bypassed by a background job, a data fix run in `psql`, a second service, a bug in a new code path, or a migration. A constraint holds against all of them.

Every business rule that can be expressed as a constraint should be one.

## `NOT NULL`

**Start from `NOT NULL` and justify each exception.** The default in SQL is nullable, which is the wrong default: most columns have a value, and `NULL` propagating through comparisons and aggregates is a persistent source of wrong answers. See [null-handling.md](null-handling.md).

`NULL` should mean exactly one of "genuinely unknown" or "not applicable to this row". It should never mean "empty", "zero", "false", or "we have not backfilled it yet".

Adding `NOT NULL` to a large existing table used to require a full scan under `ACCESS EXCLUSIVE`. On **18** it does not, because `NOT NULL` is now a real catalogued constraint (`contype = 'n'`) that accepts `NOT VALID`:

```sql
-- 18+. Two statements, no trailing SET NOT NULL.
ALTER TABLE orders ADD CONSTRAINT orders_ref_not_null
    NOT NULL reference NOT VALID;            -- instant, no scan
ALTER TABLE orders VALIDATE CONSTRAINT orders_ref_not_null;   -- scans, SHARE UPDATE EXCLUSIVE
```

Verified behaviour on 18: the `ADD ... NOT VALID` succeeds even when existing rows are NULL, and **new NULLs are rejected immediately** - `attnotnull` becomes true at once, so `NOT VALID` skips the historical scan without leaving the column unprotected. `VALIDATE` then fails if any existing row still violates, which is your signal to backfill first. `\d` shows the column as `not null` throughout, and no separate `SET NOT NULL` is needed.

On **14 to 17** there is no native `NOT NULL ... NOT VALID`, so use the proven-check route instead - three statements:

```sql
ALTER TABLE orders ADD CONSTRAINT orders_ref_not_null
    CHECK (reference IS NOT NULL) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_ref_not_null;
ALTER TABLE orders ALTER COLUMN reference SET NOT NULL;   -- instant; the check proves it (12+)
ALTER TABLE orders DROP CONSTRAINT orders_ref_not_null;   -- now redundant
```

That route still works on 18, and `SET NOT NULL` there creates the catalogued constraint for you. See [migrations.md](migrations.md).

## `CHECK`

Row-local rules. The expression may reference any column of the same row and nothing else - no subqueries, no other tables, no volatile functions.

```sql
CONSTRAINT orders_total_positive_check   CHECK (total_amount > 0),
CONSTRAINT orders_dates_ordered_check    CHECK (shipped_at IS NULL OR shipped_at >= placed_at),
CONSTRAINT orders_discount_bounded_check CHECK (discount_amount <= total_amount),
```

**A `CHECK` passes when it evaluates to `NULL`.** This is three-valued logic and it is the most common mistake with check constraints:

```sql
price numeric CHECK (price > 0)            -- NULL price is ACCEPTED
price numeric NOT NULL CHECK (price > 0)   -- what you meant
```

Multi-column checks are where constraints earn their keep, because they encode rules the application scatters across several code paths:

```sql
-- The status and the timestamp cannot disagree.
CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
```

Name every check. The name is what the application sees on failure, and `orders_check1` identifies nothing. See [naming-and-conventions.md](naming-and-conventions.md).

### `NOT ENFORCED` (18+)

`CHECK` and foreign key constraints can be declared `NOT ENFORCED`. The database records the rule and does not check it. This documents an invariant whose enforcement is genuinely too expensive, and the planner may still assume it holds. Use it rarely and deliberately - an unenforced constraint that turns out to be false gives the planner licence to return wrong results.

## `UNIQUE`

Creates a B-tree index, which is how it is enforced.

**Nulls are distinct by default**, so `UNIQUE (email)` permits unlimited rows with `NULL` email. That is standard SQL and usually right.

When it is not, PostgreSQL 15+ has `NULLS NOT DISTINCT`:

```sql
CONSTRAINT users_email_key UNIQUE NULLS NOT DISTINCT (email)
```

Do not reach for this reflexively. If a column is unique and mandatory, `NOT NULL` plus a plain `UNIQUE` says so more clearly. `NULLS NOT DISTINCT` is for the genuine case where `NULL` is a meaningful value that may occur at most once.

**Conditional uniqueness** needs a partial unique index, not a constraint - constraints cannot have a `WHERE` clause:

```sql
-- One primary address per customer, any number of non-primary ones.
CREATE UNIQUE INDEX customer_addresses_one_primary_idx
    ON customer_addresses (customer_id) WHERE is_primary;

-- Soft delete: unique among live rows only.
CREATE UNIQUE INDEX users_email_active_key
    ON users (lower(email)) WHERE deleted_at IS NULL;
```

A partial unique index cannot be used as an `ON CONFLICT` arbiter by column name; you must repeat the predicate. See [upsert-and-merge.md](upsert-and-merge.md).

## Foreign keys

```sql
FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
```

The referenced columns must carry a `UNIQUE` or `PRIMARY KEY` constraint, because PostgreSQL enforces the reference by index lookup.

### Choose `ON DELETE` deliberately

The default is `NO ACTION`, which almost nobody chose on purpose.

| Action | Behaviour | Use when |
|---|---|---|
| `NO ACTION` | Error, checked at end of statement (or end of transaction if deferred) | Default. Rarely the considered answer |
| `RESTRICT` | Error, checked immediately, cannot be deferred | The parent must not be deletable while children exist. **The right default for anything that is a record** |
| `CASCADE` | Delete the children too | The child cannot exist alone and carries no independent record - order lines, entity attributes |
| `SET NULL` | Null the referencing column | The relationship is optional and its loss is meaningful. Requires a nullable column |
| `SET DEFAULT` | Set to the column default | Rare. The default must itself exist in the parent |

`CASCADE` is over-used. Ask what the child row *is*: if it is part of the parent, cascade; if it is a record of something that happened, restrict. Deleting a customer should not delete their invoices - it should fail, and force the application to close the account instead.

`CASCADE` also deletes rows the deleting statement never mentioned, which can be a very large, very slow, lock-holding operation triggered by a one-row delete.

### Index the referencing column

PostgreSQL does **not** create it. Without it, deleting a parent row scans the entire child table. See [keys-and-identifiers.md](keys-and-identifiers.md).

### Adding one without a long lock

`ADD CONSTRAINT ... FOREIGN KEY` validates every existing row while holding `SHARE ROW EXCLUSIVE` on both tables. Split it:

```sql
ALTER TABLE orders ADD CONSTRAINT orders_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers (id) NOT VALID;   -- fast
ALTER TABLE orders VALIDATE CONSTRAINT orders_customer_id_fkey;      -- slow, weak lock
```

`NOT VALID` means "do not check existing rows"; new and modified rows are checked from the moment it is added.

### Deferrable constraints

```sql
FOREIGN KEY (a_id) REFERENCES a (id) DEFERRABLE INITIALLY DEFERRED
```

Checked at `COMMIT` rather than per statement. This is what makes circular references possible - two tables that reference each other cannot both be populated with immediate checking.

Deferring has a cost: violations surface at `COMMIT` with no indication of which statement caused them, and the list of pending checks is held in memory. Use `DEFERRABLE INITIALLY IMMEDIATE` and defer explicitly with `SET CONSTRAINTS ... DEFERRED` where needed, rather than deferring everything always.

## `EXCLUDE`

The constraint most people do not know exists, and the only correct way to prevent overlapping ranges under concurrency.

```sql
CREATE TABLE room_bookings (
    id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id bigint    NOT NULL REFERENCES rooms (id),
    period  tstzrange NOT NULL,
    CONSTRAINT room_bookings_no_overlap
        EXCLUDE USING gist (room_id WITH =, period WITH &&)
);
```

Read as: no two rows may have the same `room_id` **and** overlapping `period`.

Application-level checking cannot do this. "Select overlapping bookings, and insert if none" has a race between the select and the insert that no isolation level below `SERIALIZABLE` closes, and `SERIALIZABLE` only closes it by aborting one transaction, which you then have to retry.

Requirements: a GiST or SP-GiST index (GIN cannot back an exclusion constraint), and `btree_gist` if you mix a scalar equality column with a range column:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

If all operators are `=`, use `UNIQUE` instead - it is faster and simpler.

## `DOMAIN`

A named, reusable type with constraints attached:

```sql
CREATE DOMAIN positive_amount AS numeric(14,2) CHECK (VALUE > 0);
CREATE DOMAIN iso_currency    AS char(3)       CHECK (VALUE ~ '^[A-Z]{3}$');
```

Worth it when the same validated type appears across many tables. Two caveats: `ALTER DOMAIN ... ADD CONSTRAINT` validates existing data across every table using it, which can be a long lock in several places at once; and some drivers report the base type rather than the domain, confusing ORM mapping.

## What constraints cannot do

- **Reference other tables** (except foreign keys). A `CHECK` with a subquery is rejected. The workaround people reach for is a trigger, which is not equivalent: a trigger sees a snapshot and another transaction can invalidate its conclusion before commit. The correct tools are a foreign key, an `EXCLUDE` constraint, or `SERIALIZABLE` isolation.
- **Enforce cross-row rules** other than uniqueness and exclusion. "At most three active subscriptions per customer" is not a constraint; it needs a trigger with explicit locking, or a redesign.
- **Use volatile functions.** `CHECK (created_at <= now())` is rejected, because a constraint must give the same answer on re-validation.

## Inspecting constraints

```sql
\d+ orders

SELECT conname, contype, pg_get_constraintdef(oid), convalidated
FROM   pg_constraint
WHERE  conrelid = 'orders'::regclass
ORDER  BY contype, conname;
```

`contype`: `p` primary key, `f` foreign key, `u` unique, `c` check, `x` exclusion, `n` not null (18+). `convalidated = false` marks a `NOT VALID` constraint that was never validated - a common leftover that leaves the planner unable to trust the constraint.

## Version notes

- **18** - `NOT NULL` constraints are stored in `pg_constraint`, so they can be named, marked `NOT VALID`, and have inheritance controlled. This makes adding `NOT NULL` to a large table straightforward. `NOT ENFORCED` added for `CHECK` and foreign keys. `NOT VALID` foreign keys permitted on partitioned tables.
- **15+** - `UNIQUE NULLS NOT DISTINCT`.
- **12+** - `SET NOT NULL` can use an existing validated `CHECK (col IS NOT NULL)` to skip its scan.

`EXCLUDE`, `NOT VALID`/`VALIDATE`, deferrable constraints and domains behave identically across 14 to 18.

## Gotchas

- Agent writes `CHECK (price > 0)` without `NOT NULL` - a NULL price passes, because a check that evaluates to NULL is accepted
- Agent leaves constraints unnamed - the application reports `orders_check1`, which identifies nothing
- Agent relies on application validation for a rule the database could enforce - a background job or a manual fix bypasses it
- Agent uses `ON DELETE CASCADE` by default - it silently deletes rows the statement never mentioned, and destroys records that should have blocked the delete
- Agent leaves `ON DELETE` unspecified - `NO ACTION` is a default, not a decision
- Agent adds a foreign key or `NOT NULL` to a large table without `NOT VALID` - a full validating scan under a strong lock
- Agent adds `NOT VALID` and never runs `VALIDATE` - the constraint holds for new rows but the planner cannot rely on it
- Agent writes a `CHECK` containing a subquery - not permitted; use a foreign key or `EXCLUDE`
- Agent writes a `CHECK` using `now()` or another volatile function - rejected, because re-validation must give the same answer
- Agent enforces "no overlapping bookings" in application code - the select-then-insert race is not closable below `SERIALIZABLE`; use `EXCLUDE`
- Agent creates an `EXCLUDE` constraint mixing `=` and `&&` without `btree_gist` - GiST cannot index the scalar column without it
- Agent uses `UNIQUE` and expects NULLs to collide - nulls are distinct by default; `NULLS NOT DISTINCT` needs 15+
- Agent writes a plain `UNIQUE` where the rule is conditional - conditional uniqueness needs a partial unique index
- Agent marks constraints `DEFERRABLE INITIALLY DEFERRED` everywhere - violations then surface at commit with no indication of which statement caused them

## Related

- [data-types.md](data-types.md) · [keys-and-identifiers.md](keys-and-identifiers.md) · [null-handling.md](null-handling.md) · [migrations.md](migrations.md) · [relationships.md](relationships.md) · [temporal-and-history.md](temporal-and-history.md) · [partial-and-expression-indexes.md](partial-and-expression-indexes.md) · [transactions-and-isolation.md](transactions-and-isolation.md)
