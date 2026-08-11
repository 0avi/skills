# Requirements to Schema

A specification describes what a system does. A schema encodes what is **true** about the data, and what must remain true no matter which code path writes it. The translation is not mechanical, and the parts a spec leaves out are usually the parts that decide the design.

**Do not write DDL from the first description.** Interrogate the spec first. The questions below are ordered by how expensive the answer is to change later.

## Interrogate the spec

### 1. Entities and identity

- What are the nouns, and which are genuinely distinct entities rather than states of one entity? `Quote`, `Order` and `Invoice` are often one entity with a lifecycle, or three entities, and the choice shapes everything.
- **How is each entity identified by the business?** An email, a VAT number, an ISBN, a reference the user types into a support call. This is not the same as the primary key, and it usually needs a `UNIQUE` constraint whether or not it is the key.
- Is that business identifier stable? Email addresses change. Company registration numbers do not.
- Does an identifier need to be shown, typed, or read aloud? That rules out UUIDs in the user interface and implies a separate human-facing reference.

### 2. Cardinality, and the two questions per relationship

For every relationship, ask both directions and both bounds:

- Can an `Order` have zero `Payments`? Can it have more than one?
- Can a `Payment` belong to zero `Orders`? More than one?

"A customer has an address" is four different schemas depending on the answers. The one-to-many case where the many side is optional needs a nullable foreign key or none at all; the many-to-many case needs a junction table. See [relationships.md](relationships.md).

### 3. Lifecycle and history

The question the spec almost never answers, and the one most expensive to retrofit:

- **When a row changes, does the old value need to survive?** For audit, for reporting on "as at" dates, for undo, for a regulator.
- **When a row is deleted, does it need to survive?** A deleted customer with historical invoices cannot simply vanish.
- Does anything need to be reconstructed as it was at a past date, or is a change log enough?

Retrofitting history means backfilling data that no longer exists. Decide before the first `UPDATE` runs in production. See [temporal-and-history.md](temporal-and-history.md).

### 4. Access patterns

A schema optimised for writes and one optimised for reads differ. Get the actual queries:

- What are the three or four highest-frequency queries? By what are they filtered, and in what order do they sort?
- What is the largest result set anyone will ask for? Is it paginated, and by what?
- Which queries are interactive (must be under 100 ms) and which are reports (seconds are fine)?
- Is anything aggregated across the whole table? That is the query that stops working at scale.

You cannot index sensibly without this. See [indexing-fundamentals.md](indexing-fundamentals.md).

### 5. Volume and growth

- How many rows per table after one year, and after five? Order of magnitude is enough. The difference between 10^5 and 10^9 changes the design; the difference between 10^5 and 3×10^5 does not.
- What is the write rate, and is it uniform or bursty?
- What is the read/write ratio?
- **Is any table append-only?** Events, logs, ledger entries. These partition well and never need `UPDATE`.

### 6. Retention and deletion

- How long is each kind of data kept?
- Is there a legal right to erasure, and what exactly must it erase? This interacts badly with append-only audit tables and needs deciding up front.
- Is old data deleted, archived, or aggregated and then deleted? Bulk deletion from a large table is painful; dropping a partition is instant. See [partitioning.md](partitioning.md).

### 7. Concurrency

- Can two users act on the same row at once? What should happen - last write wins, an error, or a merge?
- Is there anything that must not be double-processed? Payments, stock allocation, job dispatch. That needs a uniqueness constraint or a lock strategy, not application checking. See [locking.md](locking.md).
- Is there a counter or balance that multiple writers update? That is a contention hotspot by construction.

### 8. Tenancy and access control

- Is this multi-tenant? Decide the model before any table exists. See [multi-tenancy.md](multi-tenancy.md).
- Who may see which rows? If the answer is row-dependent, that is RLS, and `tenant_id` or its equivalent must be on every table from the start. See [row-level-security.md](row-level-security.md).

### 9. Money, time and units

- What currency, and can it vary per row? Multi-currency means storing the currency code alongside every amount, and never summing across currencies.
- Are amounts ever divided? Rounding rules need stating and encoding.
- What timezone is authoritative for business dates? "Orders placed today" means something different in London and Auckland. See [dates-and-times.md](dates-and-times.md).

## Turning answers into DDL

Work in this order. Each step constrains the next.

**1. One table per entity.** Resist combining entities that merely share columns, and resist splitting an entity across tables because it has optional fields.

**2. Give every table a primary key.** Including join tables, including event tables. See [keys-and-identifiers.md](keys-and-identifiers.md).

**3. Make every column `NOT NULL` unless nullable carries meaning.** Start from `NOT NULL` and justify each exception. `NULL` should mean "genuinely unknown or not applicable", never "we did not get round to it". See [null-handling.md](null-handling.md).

**4. Declare every foreign key.** Then decide `ON DELETE` deliberately for each - `RESTRICT`, `CASCADE`, `SET NULL`. The default is `NO ACTION`, which is rarely what anyone reasoned about.

**5. Turn each business rule into a constraint** if it can be expressed as one. "A discount cannot exceed the total", "an end date must follow a start date", "only one primary address per customer" are all `CHECK`, `UNIQUE` or `EXCLUDE` constraints. See [constraints.md](constraints.md).

**6. Only then choose types.** By this point you know the ranges, the units and the nullability. See [data-types.md](data-types.md).

**7. Index for the access patterns from step 4**, and nothing else.

## A worked example

> "Customers place orders. An order has line items. We need to see each customer's total spend, and we must never lose an order even if a customer closes their account."

What the spec does not say, and what to ask:

| Question | Why it changes the schema |
|---|---|
| Can an order exist without a customer? | Decides whether `orders.customer_id` is nullable, and whether `ON DELETE SET NULL` is even legal |
| "Never lose an order" - so what happens to the customer row? | Almost certainly soft-delete or anonymise the customer, `ON DELETE RESTRICT` the order. Deleting a customer must fail loudly |
| Does the item price change after the order is placed? | Yes, always. The line item must store the price **as sold**, not join to the product for it. This is the single most common modelling error in this shape of schema |
| Is "total spend" live or as-at? | Live is a query. As-at needs the historical prices, which the previous answer already gives you |
| One currency? | If not, `total` is meaningless without a currency column, and cannot be summed across rows |
| How many line items per order, realistically? | Decides whether this is ever a `jsonb` document instead of a table. Almost always it is a table |

The resulting schema, with the reasoning visible:

```sql
CREATE TABLE customers (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         text        NOT NULL,
    display_name  text        NOT NULL,
    status        text        NOT NULL DEFAULT 'active'
                  CONSTRAINT customers_status_check
                  CHECK (status IN ('active', 'closed')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    closed_at     timestamptz,   -- NULL means not closed. Meaningful null.
    CONSTRAINT customers_email_key UNIQUE (email),
    CONSTRAINT customers_closed_at_check
        CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE TABLE orders (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- RESTRICT: closing an account must not delete orders. It must fail,
    -- forcing the application to soft-close the customer instead.
    customer_id   bigint      NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
    placed_at     timestamptz NOT NULL DEFAULT now(),
    currency      char(3)     NOT NULL,   -- ISO 4217. Fixed width is genuine here.
    CONSTRAINT orders_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);
CREATE INDEX orders_customer_id_placed_at_idx ON orders (customer_id, placed_at DESC);

CREATE TABLE order_items (
    order_id      bigint   NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    line_no       smallint NOT NULL,
    -- RESTRICT, not CASCADE: deleting a product must not rewrite order history.
    product_id    bigint   NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity      integer  NOT NULL CHECK (quantity > 0),
    -- Price as sold. Never join to products for this.
    unit_price    numeric(12,2) NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY (order_id, line_no)
);
```

Three things that example demonstrates and a mechanical translation would have missed:

- `ON DELETE CASCADE` from order to items, `ON DELETE RESTRICT` everywhere else. Cascade is right when the child cannot exist alone and carries no independent record; it is wrong when the child is the record.
- `unit_price` is stored, not derived. The spec did not say so; the business reality did.
- The `closed_at` check ties two columns together so the pair cannot disagree. Most specs contain several of these and name none of them.

`char(3)` for a currency code is the rare defensible fixed-width case: ISO 4217 codes are exactly three characters by definition. Everywhere else, see the ban in [data-types.md](data-types.md).

## When the spec is wrong

Specs routinely ask for things that are contradictory or that the database should refuse:

- **"Users can have multiple emails, and email is the login."** Then email is not the identifier of a user; it is a separate entity with a flag for which one is the login.
- **"Soft delete everything."** Then every query needs a filter, every unique constraint needs to become partial, and foreign keys stop meaning what they say. Push back and ask what actually needs to survive deletion. See [temporal-and-history.md](temporal-and-history.md).
- **"Store the totals so we do not have to recalculate."** Ask whether the total can ever disagree with its components, and what happens when it does. Sometimes denormalising is right, but it must come with a constraint or a trigger that keeps it true. See [normalisation.md](normalisation.md).
- **"Make it flexible - use a key/value table so we can add fields without migrations."** This is entity-attribute-value, and it discards types, constraints, foreign keys and any hope of a decent plan. If the flexibility is real, `jsonb` is the right answer, not EAV. See [jsonb.md](jsonb.md).

State the concern in a sentence, propose the alternative, and if the answer stands, build what was asked and note the trade-off in the migration.

## Version notes

Version-agnostic as a method.

Two version-dependent choices appear in the output: `bigint GENERATED ALWAYS AS IDENTITY` is available on every supported version and should always replace `serial`; and UUIDv7 via `uuidv7()` requires **18**, which changes the surrogate-key recommendation for distributed writes. See [keys-and-identifiers.md](keys-and-identifiers.md).

## Gotchas

- Agent writes DDL from the first description without asking anything - the unstated parts, particularly history and cardinality bounds, are what decide the design
- Agent derives a stored value from another table at query time when the business needs it as at the transaction - order line prices are the canonical case
- Agent models a lifecycle as separate entities, or several entities as one lifecycle, without checking which it is
- Agent defaults every foreign key to `ON DELETE CASCADE` - cascade is right only when the child has no independent record; for order history it destroys the audit trail
- Agent leaves columns nullable by default - start from `NOT NULL` and justify each exception
- Agent adds a money column without a currency in a system that has more than one - amounts then cannot legitimately be summed
- Agent indexes speculatively before the access patterns are known - every index is a permanent write cost
- Agent accepts "soft delete everything" without asking what must survive - it forces partial unique constraints and a filter on every query
- Agent implements entity-attribute-value when asked for flexible fields - `jsonb` gives the same flexibility while keeping types and indexes
- Agent skips the tenancy question - `tenant_id` cannot be added cheaply to a populated schema
- Agent treats "how many rows" as unanswerable - order of magnitude is enough and always obtainable

## Related

- [multi-tenancy.md](multi-tenancy.md) · [normalisation.md](normalisation.md) · [relationships.md](relationships.md) · [constraints.md](constraints.md) · [keys-and-identifiers.md](keys-and-identifiers.md) · [data-types.md](data-types.md) · [temporal-and-history.md](temporal-and-history.md) · [indexing-fundamentals.md](indexing-fundamentals.md)
