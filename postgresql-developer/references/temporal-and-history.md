# Temporal and History

Decide what history the system must keep **before the first `UPDATE` runs in production**. Retrofitting history means backfilling data that no longer exists.

## Four different questions

These get conflated, and they have different answers:

| Question | Mechanism |
|---|---|
| Who changed what, and when? | Audit log |
| What did this row look like on 3 March? | Versioned rows with validity periods |
| Why is this row deleted, and can we get it back? | Soft delete, or an archive table |
| What is the sequence of things that happened? | Event table |

A system usually needs more than one. Building an audit log and calling it version history, or soft-deleting and calling it an audit trail, produces something that answers neither question.

## Soft delete, and its real cost

```sql
deleted_at timestamptz    -- NULL means live
```

Widely used, and the cost is consistently underestimated. Before adopting it globally, know what it does to the schema:

**Every query needs the filter.** Miss it once and deleted rows appear in a report, a total, an export. This is not hypothetical - it is the normal failure mode. The mitigation is to never expose the table directly:

```sql
CREATE VIEW live_customers AS SELECT * FROM customers WHERE deleted_at IS NULL;
```

Or enforce it with RLS, which cannot be forgotten. See [row-level-security.md](row-level-security.md).

**Every unique constraint must become partial.** Otherwise a deleted user's email blocks re-registration forever:

```sql
CREATE UNIQUE INDEX users_email_live_key
    ON users (lower(email)) WHERE deleted_at IS NULL;
```

**Foreign keys stop meaning what they say.** A live order can reference a soft-deleted customer, and the database will not object, because the row is still there. Referential integrity now depends on application discipline again - which is the thing constraints existed to remove.

**Indexes carry dead weight.** On a table that is 80% soft-deleted, every index is five times the size it needs to be. Partial indexes with `WHERE deleted_at IS NULL` fix this and should be the default on such tables.

**"Delete everything about this user" becomes contradictory** with an erasure request. Decide this up front, not when the request arrives.

### The alternative: archive tables

Move the row rather than flagging it:

```sql
WITH moved AS (
    DELETE FROM orders WHERE id = $1 RETURNING *
)
INSERT INTO orders_archive SELECT *, now() AS archived_at FROM moved;
```

The live table stays clean, queries need no filter, unique constraints work normally, and indexes stay small. The cost is that restoring is manual and cross-table queries must `UNION`.

Prefer archive tables when deletion is rare and permanent; prefer soft delete when "deleted" is really a reversible state - in which case call it what it is, a `status`, and model it as one.

## Audit logging

The question "who changed what" is answered by a separate log, not by the table itself.

### Trigger-based, one table for everything

```sql
CREATE TABLE audit_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name  text        NOT NULL,
    row_id      text        NOT NULL,
    operation   char(1)     NOT NULL CHECK (operation IN ('I','U','D')),
    old_row     jsonb,
    new_row     jsonb,
    changed_by  text        NOT NULL DEFAULT current_setting('app.user_id', true),
    changed_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    txid        bigint      NOT NULL DEFAULT txid_current()
);

CREATE FUNCTION audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    INSERT INTO public.audit_log (table_name, row_id, operation, old_row, new_row)
    VALUES (
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id)::text,
        LEFT(TG_OP, 1),
        CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
    );
    RETURN NULL;   -- AFTER trigger; return value is ignored
END $$;

CREATE TRIGGER orders_audit
AFTER INSERT OR UPDATE OR DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

Points that matter:

- **`clock_timestamp()`, not `now()`.** `now()` returns the transaction start time, so every row in a long transaction gets an identical timestamp and their order is lost. `txid_current()` groups them back into transactions.
- **`current_setting('app.user_id', true)`** carries the application user. The database role is usually a shared service account and tells you nothing. The second argument `true` returns NULL rather than erroring when unset. Set it with `SET LOCAL` per transaction, with the same pooling discipline as tenancy. See [multi-tenancy.md](multi-tenancy.md).
- **`SECURITY DEFINER` with a pinned `search_path`**, so the application role can write audit rows without being able to modify them directly. Grant `INSERT` only, never `UPDATE` or `DELETE`.
- Storing `old_row` and `new_row` as `jsonb` means the audit table survives schema changes on the audited table.

The cost is real: every write now writes twice, the audit table grows without bound, and the trigger runs inside the writing transaction, so audit-table contention becomes write contention. Partition it by month and drop old partitions. See [partitioning.md](partitioning.md).

### The alternative: logical decoding

Read the WAL instead of writing triggers. Tools built on logical decoding (`wal2json`, Debezium) capture every change with no trigger overhead and no risk of a code path bypassing the audit.

Better for high write volume and for feeding a separate system. Worse for capturing the *application* user, because the WAL records the database role. The usual fix is to write a marker row at the start of each transaction that the decoder can correlate by transaction id.

## Versioned rows: "as at" queries

When the question is "what did this look like on 3 March", flags and audit logs do not answer it. You need validity periods.

```sql
CREATE TABLE price_list (
    id         bigint GENERATED ALWAYS AS IDENTITY,
    product_id bigint    NOT NULL REFERENCES products (id),
    price      numeric(12,2) NOT NULL,
    valid_from timestamptz NOT NULL,
    valid_to   timestamptz,          -- NULL means "still current"
    PRIMARY KEY (id)
);
```

The `NULL`-terminated form is common and awkward: every query needs `(valid_to IS NULL OR valid_to > $1)`, and nothing prevents two overlapping rows for the same product.

The range form fixes both:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE price_list (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id bigint    NOT NULL REFERENCES products (id),
    price      numeric(12,2) NOT NULL,
    validity   tstzrange NOT NULL,
    CONSTRAINT price_list_no_overlap
        EXCLUDE USING gist (product_id WITH =, validity WITH &&)
);
```

Now overlapping prices for one product are impossible, and the "as at" query is one operator:

```sql
SELECT price FROM price_list
WHERE product_id = $1 AND validity @> $2::timestamptz;
```

Use `[)` bounds throughout - inclusive lower, exclusive upper - so adjacent periods meet exactly. `tstzrange(a, b)` defaults to `[)`. An unbounded upper is `tstzrange(a, NULL)`, which reads better than a `NULL` column.

### Temporal constraints (18+)

PostgreSQL 18 adds SQL-standard syntax for the same thing:

```sql
CREATE TABLE price_list (
    product_id bigint    NOT NULL,
    validity   tstzrange NOT NULL,
    price      numeric(12,2) NOT NULL,
    PRIMARY KEY (product_id, validity WITHOUT OVERLAPS)
);
```

`WITHOUT OVERLAPS` on the last column makes the primary key temporal: duplicate `product_id` is allowed as long as the periods do not overlap. It is implemented as an exclusion constraint underneath, so it is the same mechanism with better syntax. There is also `FOREIGN KEY (...) REFERENCES ... PERIOD ...` for temporal referential integrity.

Use it on 18. Use the explicit `EXCLUDE` form on 14 to 17, and note that the migration between the two is straightforward.

### Bitemporal

Two independent time dimensions: when the fact was true in the world (**valid time**) and when the database recorded it (**transaction time**). Needed for regulated reporting where you must reproduce what you believed on a past date, including corrections made later.

Two ranges, and the exclusion constraint covers both. It roughly doubles the complexity of every query. Do not build it unless a regulator requires it - and when one does, do not try to fake it with a single time dimension.

## Event tables

When the sequence of things is the model rather than a derived record:

```sql
CREATE TABLE order_events (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id   bigint      NOT NULL REFERENCES orders (id),
    event_type text        NOT NULL,
    payload    jsonb       NOT NULL DEFAULT '{}',
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX order_events_order_id_id_idx ON order_events (order_id, id);
```

Append-only, so no `UPDATE`, no dead tuples, no vacuum pressure, and it partitions cleanly by time.

Order events by the **primary key**, not by the timestamp. Two events in the same transaction share a `now()` value, and `clock_timestamp()` values can appear out of order across concurrent transactions. The sequence-backed id is monotonic per insert.

Note that ids can *commit* out of order, so a reader tailing the table by id can miss rows that were assigned earlier but committed later. If something consumes this table as a stream, that matters - use a logical replication slot or a dedicated queue rather than polling by id. See [locking.md](locking.md) for the `SKIP LOCKED` queue pattern.

## Choosing

| Requirement | Build |
|---|---|
| "Who changed this?" | Audit log, trigger-based or from logical decoding |
| "Undo a deletion" | Soft delete, or an archive table |
| "What was the price on 3 March?" | Range-versioned rows with an exclusion constraint |
| "Reproduce the report as we ran it in March, including later corrections" | Bitemporal |
| "What happened to this order?" | Event table |
| "Regulator requires immutable records" | Append-only event table, `INSERT`-only grants, WORM storage for backups |

Most systems need an audit log plus one of the others. Very few need bitemporal.

## Version notes

- **18** - `PRIMARY KEY`/`UNIQUE ... WITHOUT OVERLAPS` and `FOREIGN KEY ... PERIOD`. This is the SQL-standard form of what `EXCLUDE USING gist` has always done, and is the preferred syntax on 18.
- **14+** - multirange types, useful when a validity period has gaps.
- **15+** - `MERGE` simplifies "close the current version and open a new one" into one statement.

`EXCLUDE USING gist`, range types, `clock_timestamp()` and `to_jsonb()` behave identically across 14 to 18.

## Gotchas

- Agent adds history after the system is live - the historical data no longer exists to backfill
- Agent builds an audit log and treats it as version history - an audit log answers "who changed it", not "what was it on a given date"
- Agent uses `now()` in an audit trigger - it returns transaction start time, so every row in one transaction gets the same timestamp and their order is lost
- Agent records the database role as the audit user - that is a shared service account; carry the application user in a session variable
- Agent soft-deletes without making unique constraints partial - a deleted user's email blocks re-registration forever
- Agent soft-deletes and leaves the table directly queryable - the filter will be forgotten, and deleted rows will appear in a total
- Agent soft-deletes and assumes foreign keys still hold - a live row can reference a soft-deleted parent and nothing objects
- Agent versions rows with `valid_from`/`valid_to` columns and no exclusion constraint - overlapping versions become possible and the "as at" query returns two rows
- Agent mixes range bound conventions - use `[)` or adjacent periods overlap or leave gaps
- Agent orders an event table by timestamp - events in one transaction share a timestamp; order by the sequence-backed key
- Agent tails an event table by id as a stream - ids commit out of order, so rows can be missed
- Agent builds bitemporal without a regulatory requirement - it roughly doubles query complexity
- Agent audits with a trigger and grants the application role `UPDATE` on the audit table - the audit is then editable by the thing being audited

## Related

- [constraints.md](constraints.md) · [data-types.md](data-types.md) · [functions-and-triggers.md](functions-and-triggers.md) · [partitioning.md](partitioning.md) · [dates-and-times.md](dates-and-times.md) · [jsonb.md](jsonb.md) · [row-level-security.md](row-level-security.md) · [locking.md](locking.md)
