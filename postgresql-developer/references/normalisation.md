# Normalisation

Normalise to third normal form. Denormalise only where a measurement demands it, and only with a mechanism that keeps the duplicate true.

Normalisation is not an academic exercise: each normal form removes a specific class of anomaly, where the same fact can be recorded in two places and the two can disagree.

## The forms, concretely

### First normal form: one value per cell

Violated by a comma-separated list, or by repeating groups of columns.

```sql
-- Not 1NF
CREATE TABLE contacts (
    id     bigint PRIMARY KEY,
    name   text,
    phones text          -- '020 7946 0018, 07700 900461'
);

-- Not 1NF either - repeating group
CREATE TABLE contacts (
    id      bigint PRIMARY KEY,
    phone_1 text, phone_2 text, phone_3 text
);
```

Both are unqueryable (`WHERE phone = ?` becomes a `LIKE` over a list, or three `OR`s), unindexable, and cannot express "at most one mobile".

```sql
CREATE TABLE contact_phones (
    contact_id bigint NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
    phone_type text   NOT NULL CHECK (phone_type IN ('landline','mobile','fax')),
    number     text   NOT NULL,
    PRIMARY KEY (contact_id, phone_type)
);
```

**Arrays and `jsonb` are not 1NF violations in PostgreSQL.** A `text[]` of tags is a genuine indexable type with containment operators. The 1NF objection applies to *pretending* a scalar column is a list, not to using a list type. The right question is whether the elements are ever referenced independently or need integrity - if so, a table; if not, an array is fine. See [data-types.md](data-types.md).

### Second normal form: no partial dependency on a composite key

Only relevant when the primary key is composite. Every non-key column must depend on the *whole* key, not part of it.

```sql
-- Key is (order_id, product_id)
CREATE TABLE order_items (
    order_id     bigint,
    product_id   bigint,
    quantity     integer,      -- depends on both. Correct.
    product_name text,         -- depends only on product_id. 2NF violation.
    PRIMARY KEY (order_id, product_id)
);
```

`product_name` is repeated on every line of every order for that product. Renaming the product means updating thousands of rows, and if the update is partial, the same product now has two names.

Move it to `products`.

**The exception that is not a violation**: `unit_price` on an order line looks like it depends only on `product_id`, but it does not - it is the price *as sold*, which is a fact about this line, not about the product. Storing it is correct and mandatory. Confusing these two cases is the most common normalisation mistake in order schemas. See [requirements-to-schema.md](requirements-to-schema.md).

### Third normal form: no transitive dependency

Non-key columns must depend on the key, not on another non-key column.

```sql
CREATE TABLE employees (
    id              bigint PRIMARY KEY,
    name            text,
    department_id   bigint,
    department_name text     -- depends on department_id, not on id. 3NF violation.
);
```

Same anomaly: rename a department and every employee row must change together, or they disagree.

**3NF is the target for transactional schemas.** It removes essentially all update anomalies at a cost most workloads do not notice.

### Boyce-Codd normal form

A stricter 3NF, relevant when a table has overlapping candidate keys. Rare in practice. If you have reached 3NF and every determinant is a candidate key, you are in BCNF.

Fourth and fifth normal forms address multi-valued and join dependencies. They almost never come up in application schemas; when they do, the symptom is a junction table storing the cartesian product of two independent multi-valued facts, which should be two junction tables.

## Denormalisation

Denormalisation is storing a fact twice in exchange for read speed. It is sometimes right. It is far more often applied speculatively, before any measurement, to a query that was never slow.

**Do not denormalise until you have:**

1. A specific slow query, with an `EXPLAIN (ANALYZE, BUFFERS)` plan.
2. Evidence that the join is the cost - not a missing index, not bad statistics, not a bloated table.
3. Tried the cheaper options: an index, extended statistics, a materialised view.

A join to a well-indexed table costs a handful of page reads. Most "the join is slow" diagnoses are actually a missing index on the foreign key. See [query-optimisation.md](query-optimisation.md).

### When it is legitimate

**Counter caches** - `posts.comment_count`. The alternative is `count(*)` per post on every list page, which is genuinely expensive at scale.

**Snapshot data** - the order line price, a customer's address at the time of shipping, the VAT rate applied. This is not denormalisation at all: it is recording a different fact, one that is true as at a moment. Always store these.

**Precomputed aggregates for reporting** - daily rollups, running balances. Usually better as a materialised view than as columns. See [views.md](views.md).

**Hierarchy paths** - a materialised path or closure table to avoid recursive queries on a deep tree that is read constantly and written rarely. See [relationships.md](relationships.md).

### Keeping the duplicate true

Every denormalised value needs a mechanism, and the mechanism must be stated. Ranked by reliability:

| Mechanism | Reliability | Cost |
|---|---|---|
| Generated column (`STORED`) | Total. Cannot disagree | Same-row expressions only |
| `EXCLUDE`/`CHECK` constraint tying the values | Total, where expressible | Rarely expressible for cross-table |
| Trigger on the source table | High, if written correctly | Write amplification, lock contention, hidden control flow |
| Materialised view, refreshed on a schedule | Data is stale by design | Refresh cost; `CONCURRENTLY` needs a unique index |
| Application code updating both | **Low.** It will drift | None, until it drifts |

Application-maintained denormalisation drifts. Not might - will. A second service, a background job, a data fix, a bug in an untested path. If you take that route, ship a reconciliation query that detects the drift and run it on a schedule.

A generated column is the best case and is free of drift because it is not really duplication:

```sql
ALTER TABLE order_items ADD COLUMN line_total numeric(14,2)
    GENERATED ALWAYS AS (quantity * unit_price) STORED;
```

Write `STORED` explicitly. On **18** the default became `VIRTUAL`, which is computed on read and cannot be indexed. See [postgres-versions.md](postgres-versions.md).

For a cross-table counter, a trigger is the usual mechanism, and it has a cost that must be stated: every insert into `comments` now updates a row in `posts`, so all comments on one popular post serialise behind that row lock. At high write rates that is a hotspot. See [functions-and-triggers.md](functions-and-triggers.md) and [locking.md](locking.md).

## Read models

The alternative to denormalising the transactional schema is keeping it normalised and building a separate read model - a materialised view, a summary table refreshed on a schedule, or a replica shaped for reporting.

This is usually the better trade. The write path stays correct and constrained; the read path is allowed to be stale, and staleness is explicit rather than accidental. Reporting queries also stop competing with transactional ones for locks and buffers.

## Version notes

- **18** - generated columns default to `VIRTUAL`. Always write `STORED` explicitly for a denormalised value that needs indexing or replication.
- **12+** - generated columns exist at all. Before that, the equivalent is a trigger.
- **15+** - `MERGE` makes reconciliation of a denormalised table against its source expressible in one statement.

The normal forms themselves are relational theory and version-independent.

## Gotchas

- Agent denormalises before measuring - most "slow join" diagnoses are a missing index on the foreign key
- Agent stores a derived value with no mechanism to keep it true - application-maintained duplicates drift, without exception
- Agent treats a snapshot value as denormalisation and removes it - order line prices and applied tax rates are separate facts and must be stored
- Agent stores a lookup table's name alongside its id - renaming then requires updating every referencing row, and a partial update creates two names
- Agent writes `GENERATED ALWAYS AS (...)` without `STORED` on 18 - that is a virtual column, which cannot be indexed
- Agent treats an array or `jsonb` column as a 1NF violation - they are genuine indexable types; the test is whether elements need independent identity or integrity
- Agent normalises past 3NF on a transactional schema - BCNF and above rarely change anything and add joins
- Agent adds a trigger-maintained counter to a high-write table without noting the hotspot - every child insert serialises on the parent row lock
- Agent proposes entity-attribute-value in the name of flexibility - it discards types, constraints and plans; `jsonb` provides the flexibility without that
- Agent denormalises into the transactional schema when a materialised view would do - that puts staleness in the write path instead of making it explicit

## Related

- [requirements-to-schema.md](requirements-to-schema.md) · [relationships.md](relationships.md) · [jsonb.md](jsonb.md) · [views.md](views.md) · [functions-and-triggers.md](functions-and-triggers.md) · [query-optimisation.md](query-optimisation.md) · [data-types.md](data-types.md)
