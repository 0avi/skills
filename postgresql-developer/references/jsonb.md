# JSONB

`jsonb` is a genuinely good document store inside a relational database. It is also the most over-used feature in PostgreSQL, because it lets you postpone every modelling decision, and postponed decisions compound.

**Use `jsonb`, never `json`.** `json` stores the original text - whitespace, key order, duplicate keys - and reparses on every access. `jsonb` parses once into a binary form, deduplicates keys, and is indexable. The only reason for `json` is byte-exact round-tripping of a document, which is a document-storage requirement, not a database one.

## When a column earns `jsonb`

**Yes:**

- **Genuinely schemaless data from outside.** Webhook payloads, third-party API responses, raw events. You do not control the shape and it changes without warning.
- **Sparse, per-type attributes.** A product catalogue where books have an ISBN and page count, and shoes have a size and colour, and there are 400 product types. The relational alternative is 400 tables or an EAV table, and `jsonb` beats both.
- **User-defined fields.** Custom fields your customers configure at runtime. The schema genuinely is not known at deploy time.
- **A document you always read whole.** A stored form submission, a rendered configuration snapshot, an API request archived for debugging.

**No:**

- **Core relational data.** Anything joined on, aggregated, or constrained belongs in columns. `orders.customer` as a `jsonb` blob cannot have a foreign key.
- **Avoiding migrations.** This is the most common bad reason. You still have to migrate the data, you just do it in application code without the database's help, without transactions per shape, and without a way to find rows that were missed.
- **A fixed set of fields that happens to be optional.** Nullable columns handle that, with types and constraints intact.
- **Anything needing referential integrity.** A key inside `jsonb` cannot be a foreign key. Ever.

The honest test: **if you know the keys at design time, they should be columns.**

## The hybrid, which is usually right

Structured columns for what you know; `jsonb` for what you do not.

```sql
CREATE TABLE products (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku        text        NOT NULL,
    name       text        NOT NULL,
    price      numeric(12,2) NOT NULL CHECK (price >= 0),
    category   text        NOT NULL REFERENCES product_categories (code),
    attributes jsonb       NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT products_sku_key UNIQUE (sku),
    CONSTRAINT products_attributes_is_object
        CHECK (jsonb_typeof(attributes) = 'object')
);
```

`NOT NULL DEFAULT '{}'` matters: it removes the difference between "no attributes" and "unknown", so no query has to handle both. The `jsonb_typeof` check stops a bare array or string being stored where an object is expected, which is otherwise a runtime surprise in every consumer.

## Operators

| Operator | Returns | Use |
|---|---|---|
| `->` | `jsonb` | Navigate: `data -> 'address' -> 'city'` |
| `->>` | `text` | Extract a value: `data ->> 'name'` |
| `#>` | `jsonb` | Path: `data #> '{address,city}'` |
| `#>>` | `text` | Path, as text: `data #>> '{address,city}'` |
| `@>` | `boolean` | **Containment.** `data @> '{"status":"active"}'` |
| `?` | `boolean` | Key exists: `data ? 'discount'` |
| `?|` `?&` | `boolean` | Any / all of these keys exist |
| `@?` | `boolean` | JSONPath matches: `data @? '$.items[*] ? (@.qty > 5)'` |
| `@@` | `boolean` | JSONPath predicate returns true |
| `-` `#-` | `jsonb` | Delete a key or a path |
| `||` | `jsonb` | Merge, shallow |

**`@>` is the one to reach for**, because it is the only comparison a plain GIN index accelerates well. Prefer `data @> '{"status":"active"}'` over `data ->> 'status' = 'active'` when you want the index to be usable.

Note `->>` returns `text`, so numeric comparison needs a cast, and the cast defeats a plain GIN index:

```sql
WHERE (data ->> 'price')::numeric > 100     -- no GIN index will help this
```

That is what expression indexes and generated columns are for, below.

### JSONPath

For anything involving arrays or conditions, JSONPath (12+) is much clearer than nested operators:

```sql
-- Any line item with quantity over 5
WHERE data @? '$.items[*] ? (@.quantity > 5)'

-- Extract all item names
SELECT jsonb_path_query_array(data, '$.items[*].name') FROM orders;
```

## Modifying

```sql
UPDATE products SET attributes = attributes || '{"colour":"red"}'         WHERE id = $1;
UPDATE products SET attributes = jsonb_set(attributes, '{dims,w}', '30')  WHERE id = $1;
UPDATE products SET attributes = attributes - 'discontinued'              WHERE id = $1;
```

Two traps:

**`jsonb_set` returns `NULL` if any argument is `NULL`.** A single `NULL` wipes the whole column. Guard it, or use `jsonb_set(coalesce(attributes,'{}'), ...)`.

**Updating one key rewrites the entire value.** `jsonb` is not updated in place. A 40 kB document rewritten to change one key writes 40 kB of new tuple plus WAL, and leaves a 40 kB dead tuple. On a hot column this is a serious write-amplification problem, and it is the strongest argument for pulling frequently-updated fields out into real columns. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

## Indexing

This is where `jsonb` decisions have the biggest performance consequence.

### Default GIN

```sql
CREATE INDEX products_attributes_gin ON products USING gin (attributes);
```

Supports `@>`, `?`, `?|`, `?&`, and path containment. Large, because it indexes every key and every value.

### `jsonb_path_ops`

```sql
CREATE INDEX products_attributes_gin ON products USING gin (attributes jsonb_path_ops);
```

Roughly **half to a third the size** and faster for containment, because it hashes whole paths rather than indexing keys separately. The trade: it supports **only `@>`**. No `?`, no `?|`, no `?&`.

If your access pattern is containment - and it usually is - use `jsonb_path_ops`. Check first that nothing relies on key-existence operators.

### The one that actually matters: extract to a column

For equality or range on a specific scalar field, a GIN index is the wrong tool. GIN cannot do range comparisons and cannot provide sorted output. Use a B-tree, via a generated column or an expression index.

```sql
-- Preferred: a real column, typed, constrainable, indexable, visible in \d
ALTER TABLE products ADD COLUMN weight_kg numeric
    GENERATED ALWAYS AS ((attributes ->> 'weight_kg')::numeric) STORED;
CREATE INDEX products_weight_kg_idx ON products (weight_kg);

-- Alternative: expression index, no column added
CREATE INDEX products_weight_kg_idx ON products (((attributes ->> 'weight_kg')::numeric));
```

Write `STORED` explicitly. On **18** the default is `VIRTUAL`, and a virtual generated column **cannot be indexed** - which silently defeats the entire point. See [postgres-versions.md](postgres-versions.md).

With an expression index, the query must use the **identical** expression, including the cast and the parentheses, or the index is not used. See [partial-and-expression-indexes.md](partial-and-expression-indexes.md).

When you find yourself extracting the same key repeatedly, that is the schema telling you it should have been a column.

### Rules of thumb

| Access pattern | Index |
|---|---|
| `@>` containment, varied keys | GIN with `jsonb_path_ops` |
| `?` key existence needed too | Default GIN |
| Equality or range on one known key | Generated column or expression index, B-tree |
| Sorting by a key | Generated column, B-tree. GIN cannot sort |
| Full-text over document text | `to_tsvector` on the extracted text, GIN. See [full-text-search.md](full-text-search.md) |

## Constraining a schemaless column

`jsonb` does not mean unconstrained. Encode what you actually know:

```sql
CHECK (jsonb_typeof(attributes) = 'object'),
CHECK (attributes ? 'unit'),                                    -- required key
CHECK (attributes ->> 'unit' IN ('kg','g','lb')),               -- allowed values
CHECK ((attributes ->> 'weight')::numeric > 0),                 -- typed range
CHECK (NOT attributes ? 'password')                             -- forbidden key
```

Each is a real database-enforced rule that survives a bad deploy.

For full JSON Schema validation there is the `pg_jsonschema` extension, but that is often a sign the data was structured enough to be columns.

## Querying arrays and expanding

```sql
-- Expand an array of objects into rows
SELECT p.id, item ->> 'name' AS item_name, (item ->> 'qty')::int AS qty
FROM   orders o, jsonb_array_elements(o.data -> 'items') AS item;

-- Expand keys into rows
SELECT key, value FROM jsonb_each_text(attributes);

-- Aggregate rows back into a document
SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name)) FROM products;
```

`jsonb_array_elements` in the `FROM` clause is an implicit `LATERAL` join and multiplies rows. If the array is empty or the key is missing it produces **zero** rows, dropping the parent from the result. Use `LEFT JOIN LATERAL ... ON true` to keep it:

```sql
SELECT o.id, item ->> 'name'
FROM   orders o
LEFT JOIN LATERAL jsonb_array_elements(o.data -> 'items') AS item ON true;
```

See [joins.md](joins.md).

## Size and TOAST

`jsonb` values above roughly 2 kB are compressed and moved out of line into TOAST storage. Consequences:

- A table with large documents does not pay for them during a scan that does not select the column.
- Reading the column pays decompression per row, which `SELECT *` does even for columns you discard.
- The hard limit on a single `jsonb` value is 1 GB. Anything approaching that is the wrong design.
- Updating any part of a large document rewrites and re-TOASTs the whole thing.

## Version notes

- **18** - generated columns default to `VIRTUAL`; a virtual generated column cannot be indexed, so extracted-field columns **must** say `STORED`.
- **17** - `JSON_TABLE`, plus the SQL/JSON constructors `JSON_EXISTS`, `JSON_QUERY`, `JSON_VALUE`. `JSON_TABLE` turns a document into a relational result set and is much cleaner than chained `jsonb_array_elements`.
- **16** - SQL/JSON `IS JSON` predicates.
- **14+** - subscripting syntax: `attributes['colour']` for both read and assignment, which is easier to read than `jsonb_set` for simple cases.
- **12+** - JSONPath (`@?`, `@@`, `jsonb_path_query`).

`jsonb_path_ops`, GIN indexing and TOAST behaviour are unchanged across 14 to 18.

## Gotchas

- Agent uses `json` instead of `jsonb` - reparsed on every access, not indexable
- Agent puts core relational data in `jsonb` to avoid migrations - the migration still happens, just in application code with no transactions and no way to find missed rows
- Agent indexes `jsonb` with GIN and then filters with `->> = ` - a plain GIN index does not accelerate that; use containment, or a B-tree on an extracted expression
- Agent creates a generated column on 18 without `STORED` - it becomes virtual, cannot be indexed, and the optimisation silently does nothing
- Agent writes an expression index and then a query whose expression differs by a cast or parentheses - the index is not used
- Agent uses default GIN when only `@>` is needed - `jsonb_path_ops` is a third the size and faster
- Agent calls `jsonb_set` on a possibly-NULL column - the whole column becomes NULL
- Agent updates one key in a large document on a hot path - the entire value is rewritten, with matching WAL and a dead tuple
- Agent uses `jsonb_array_elements` in `FROM` and loses rows with empty arrays - it produces zero rows; use `LEFT JOIN LATERAL ... ON true`
- Agent leaves a `jsonb` column nullable with no default - queries must then handle NULL and `'{}'` separately
- Agent adds no constraints to a `jsonb` column - `jsonb_typeof`, required keys and value domains are all enforceable
- Agent expects a foreign key on a key inside `jsonb` - not possible in any version
- Agent stores a value approaching the 1 GB limit - that is a signal the design is wrong, not a limit to work around

## Related

- [data-types.md](data-types.md) · [normalisation.md](normalisation.md) · [index-types.md](index-types.md) · [partial-and-expression-indexes.md](partial-and-expression-indexes.md) · [full-text-search.md](full-text-search.md) · [joins.md](joins.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md)
