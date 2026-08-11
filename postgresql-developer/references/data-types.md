# Data Types

The type is the first constraint on a column and the cheapest one to get right. PostgreSQL has an unusually rich type system, and most schemas use about six of it.

## The banned types

Six types should never appear in new DDL. Each has a specific replacement and a specific way it causes harm. These derive from the PostgreSQL wiki's "Don't Do This" page and are close to universal among practitioners.

| Never | Instead | Why |
|---|---|---|
| `char(n)` | `text` | Pads with trailing spaces to `n`, then strips them inconsistently in comparisons and concatenation. No performance advantage over `text`; often slower |
| `varchar(n)` as a length guard | `text` + `CHECK (length(col) <= n)` | Changing `n` is an `ALTER TABLE`; changing a `CHECK` is too, but the check can be added `NOT VALID` and validated without a long lock, and it can express the real rule |
| `money` | `numeric(p,s)` | Precision and the currency symbol depend on the server's `lc_monetary`, so the same value means different things on different servers. No currency is stored. Fractional handling is fixed |
| `timestamp` (without time zone) | `timestamptz` | Stores a wall-clock reading with no reference point. Two rows written in London and Auckland are indistinguishable and cannot be ordered correctly |
| `timetz` | `timestamptz`, or `time` plus a separate zone | A time of day with an offset is meaningless without a date, because the offset depends on the date through daylight saving |
| `serial` / `bigserial` | `bigint GENERATED ALWAYS AS IDENTITY` | Not standard SQL. The sequence ownership and permissions are surprising, `ALTER` behaviour is inconsistent, and the column does not prevent explicit inserts. Identity columns are the SQL-standard replacement and have been available since PostgreSQL 10 |

Also avoid **any float type for money**. `real` and `double precision` are binary floating point: `0.1 + 0.2 <> 0.3`, and errors accumulate across a sum. Use `numeric`.

`varchar(n)` is not banned outright - it is banned as a reflexive length guard. When an external standard genuinely fixes the width (`char(3)` for ISO 4217 currency codes, `char(2)` for ISO country codes) a fixed-width type is honest. The test is whether the length is a property of the domain or a guess.

## Choosing a type

### Numbers

| Need | Type | Notes |
|---|---|---|
| Surrogate key | `bigint` | Always. `integer` runs out at 2.1 billion and the migration is painful. The 4 extra bytes are nothing |
| General integer | `integer` | Fine for counts, quantities, small ranges |
| Money, or anything requiring exact decimals | `numeric(p,s)` | `numeric(12,2)` handles up to 10 billion to 2 decimal places. Exact, arbitrary precision, slower than integers |
| Scientific or statistical values | `double precision` | Inexact but fast. Correct when the data is already approximate |
| Very small range, in a very wide table | `smallint` | Only worth it when the row count makes alignment padding worth reasoning about |

`numeric` without a precision is legal and means unconstrained. Prefer specifying `(p,s)` - it documents the range and rejects nonsense.

A note on "smaller types are faster": rows are aligned, so a `smallint` next to a `bigint` usually costs the same as an `integer` would after padding. Order columns from widest to narrowest if you are genuinely optimising row width; otherwise ignore it.

### Text

**Use `text`.** It is the same storage and the same performance as `varchar` with no length, and it does not embed a guess in the type.

```sql
email  text NOT NULL CONSTRAINT users_email_length_check CHECK (length(email) <= 320),
```

For case-insensitive matching, prefer a **unique expression index on `lower(col)`** over `citext`:

```sql
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
```

`citext` works and is convenient, but it is an extension, it makes every comparison case-insensitive whether you wanted that or not, and it interacts awkwardly with collations. The expression index is explicit about where the behaviour applies. Use `citext` when a column needs case-insensitive `UNIQUE`, `PRIMARY KEY` or foreign-key semantics, where an expression index cannot help.

Long values are transparently moved out of line into **TOAST** storage above roughly 2 kB per row, and compressed. This is automatic and usually correct. Two consequences worth knowing: a `text` column holding large documents does not bloat the main table's scan cost, and `SELECT *` on such a table pays de-TOASTing cost per row for columns you discard.

### Time

**`timestamptz` for every point in time.** Despite the name, it stores no timezone: it stores a UTC instant, and converts to the session's `TimeZone` on output. That is exactly what you want. `timestamp` stores a wall-clock reading with no reference point, which is almost never what you want.

| Need | Type |
|---|---|
| A point in time | `timestamptz` |
| A calendar date with no time | `date` |
| A duration | `interval` |
| A time of day with no date (opening hours) | `time` |
| A period between two instants | `tstzrange` |

Do not specify precision - `timestamptz(0)` silently rounds rather than truncating, which can move a value into the next second, day or year. Store full precision and round on output.

See [dates-and-times.md](dates-and-times.md).

### Booleans

`boolean NOT NULL`. A nullable boolean is three-valued and almost always means the column should have been an enumeration of three states with names. If you find yourself writing `WHERE flag IS NOT FALSE`, the design is wrong.

### Identifiers

`bigint GENERATED ALWAYS AS IDENTITY` by default; `uuid` when identifiers must be generated outside the database. Full treatment in [keys-and-identifiers.md](keys-and-identifiers.md).

### Enumerations

**Do not use `CREATE TYPE ... AS ENUM` for business-domain values.** The reasons are practical:

- Removing a value is impossible. There is no `ALTER TYPE ... DROP VALUE` in any version.
- Reordering requires recreating the type and every column that uses it.
- `ADD VALUE` could not run inside a transaction block before PostgreSQL 12, and even now cannot be used in the same transaction that then uses the new value.
- No way to attach a label, a sort order, a description, or an `active` flag - all of which business enumerations acquire.

Two acceptable choices:

**`text` plus a `CHECK`** - for small, genuinely fixed sets where no metadata is needed:

```sql
status text NOT NULL DEFAULT 'pending'
    CONSTRAINT orders_status_check
    CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
```

Adding a value is `ALTER TABLE ... DROP CONSTRAINT` then `ADD CONSTRAINT ... NOT VALID` followed by `VALIDATE`, which takes only a `SHARE UPDATE EXCLUSIVE` lock.

**A lookup table with a foreign key** - once the set has metadata, needs to be listed in a dropdown, or changes without a deploy:

```sql
CREATE TABLE order_statuses (
    code       text PRIMARY KEY,
    label      text NOT NULL,
    sort_order smallint NOT NULL,
    is_terminal boolean NOT NULL DEFAULT false
);
ALTER TABLE orders ADD CONSTRAINT orders_status_fkey
    FOREIGN KEY (status) REFERENCES order_statuses (code);
```

A native `enum` is defensible only for a set fixed by an external standard that will not change - days of the week, card suits. Even then the benefit is small.

### JSON

`jsonb`, never `json`. `json` stores the original text including whitespace, key order and duplicate keys, and reparses on every access. `jsonb` is parsed once into a binary form, is indexable with GIN, and deduplicates keys.

The only reason to choose `json` is if you must round-trip a document byte-for-byte, including key order - which is a document-storage requirement, not a database one.

See [jsonb.md](jsonb.md).

### Arrays

`text[]`, `bigint[]` and friends are real types with GIN index support for containment (`@>`) and overlap (`&&`).

Use an array for an **ordered list of scalars that belongs to the row and is never referenced independently**: tags, a set of flags, a sequence of steps.

Do not use an array as a substitute for a junction table. `post.tag_ids bigint[]` cannot have a foreign key, cannot be joined efficiently in both directions, and cannot carry attributes on the relationship. See [relationships.md](relationships.md).

### Ranges

`daterange`, `tstzrange`, `numrange`, `int4range`, and the multirange variants (14+). These pair with `EXCLUDE` constraints to make overlap impossible:

```sql
CREATE TABLE bookings (
    room_id bigint NOT NULL REFERENCES rooms (id),
    period  tstzrange NOT NULL,
    EXCLUDE USING gist (room_id WITH =, period WITH &&)
);
```

That constraint prevents double-booking at the database level, which no amount of application checking can do correctly under concurrency.

Pick a bounds convention and hold it. **`[)` - inclusive lower, exclusive upper - is the default and the right one**, because adjacent ranges meet without gaps or overlaps.

### Other types worth knowing

| Type | Use |
|---|---|
| `inet`, `cidr` | IP addresses and networks, with containment operators. Not `text` |
| `macaddr` | MAC addresses |
| `uuid` | 16 bytes, not the 36-character text form |
| `bytea` | Binary data. Not base64 in a `text` column |
| `tsvector`, `tsquery` | Full-text search. See [full-text-search.md](full-text-search.md) |
| `interval` | Durations. Not an integer number of seconds with the unit in the column name |
| `vector` (pgvector) | Embeddings, with HNSW and IVFFlat index support |

### Domains

A `DOMAIN` is a reusable named type with constraints attached, applied consistently everywhere it is used:

```sql
CREATE DOMAIN email AS text
    CHECK (VALUE ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
```

Useful when the same validated type appears in many tables. Two caveats: a domain constraint is not re-checked on existing rows when you `ALTER DOMAIN ... ADD CONSTRAINT` unless you say so, and some client drivers report the base type rather than the domain, which can confuse ORM mapping.

## Version notes

- **18** - `uuidv7()` and `uuidv4()` functions. Virtual generated columns became the default, which affects any computed column derived from a typed value. See [postgres-versions.md](postgres-versions.md).
- **14+** - multirange types (`datemultirange`, `tstzmultirange`).
- **13+** - `gen_random_uuid()` is built in; before that it needed `pgcrypto`.
- **12+** - generated columns (`STORED` only until 18).
- `ALTER TYPE ... ADD VALUE` has been permitted inside a transaction block since **12**, but the new value still cannot be used in that same transaction.

The banned-type list applies identically across every supported version.

## Gotchas

- Agent uses `varchar(255)` reflexively - 255 is an artefact of other databases and means nothing here; use `text` with a `CHECK` that states the real rule
- Agent uses `char(n)` - it pads with spaces and strips them inconsistently
- Agent uses `money` - the meaning depends on the server's locale setting and no currency is stored
- Agent uses `timestamp` instead of `timestamptz` - stores a wall-clock reading with no reference point
- Agent writes `timestamptz(0)` - it rounds rather than truncates, moving values into the next second
- Agent uses `serial` - superseded by `GENERATED ALWAYS AS IDENTITY` since PostgreSQL 10
- Agent uses `float`/`double precision` for money - binary floating point cannot represent decimal fractions exactly and errors accumulate
- Agent uses `integer` for a surrogate key - 2.1 billion arrives, and the migration to `bigint` rewrites the table
- Agent creates a native `enum` for order status or similar - values cannot be removed or reordered, and no label or sort order can be attached
- Agent uses `json` instead of `jsonb` - reparsed on every access and not indexable
- Agent stores an array of foreign keys instead of a junction table - no referential integrity, no efficient reverse lookup
- Agent stores an IP address as `text` - loses the containment and comparison operators of `inet`
- Agent stores a duration as an integer with the unit in the column name - `interval` exists
- Agent adds a nullable `boolean` - that is three states; name them
- Agent picks inconsistent range bounds - use `[)` throughout or adjacent ranges will overlap or leave gaps

## Related

- [keys-and-identifiers.md](keys-and-identifiers.md) · [constraints.md](constraints.md) · [jsonb.md](jsonb.md) · [dates-and-times.md](dates-and-times.md) · [relationships.md](relationships.md) · [full-text-search.md](full-text-search.md) · [naming-and-conventions.md](naming-and-conventions.md)
