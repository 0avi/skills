# Partial and Expression Indexes

Two of the highest-value indexing features and two of the most under-used.

## Partial indexes

A partial index covers only the rows matching a `WHERE` clause.

```sql
CREATE INDEX orders_pending_idx ON orders (created_at)
    WHERE status = 'pending';
```

If 2% of orders are pending, this index is 2% of the size of the full one. It is faster to scan, faster to maintain, and cheaper to vacuum. Rows outside the predicate are never touched on write.

### When it applies

The planner uses a partial index only when it can **prove** the query's predicate implies the index's predicate. That proof is syntactic and limited.

```sql
-- index: WHERE status = 'pending'
WHERE status = 'pending'                          -- yes
WHERE status = 'pending' AND created_at > $1      -- yes
WHERE status = $1                                 -- NO. A parameter cannot be proven equal
WHERE status IN ('pending')                       -- yes, this is recognised
WHERE status <> 'shipped'                         -- NO. Does not imply 'pending'
```

The parameter case is the one that bites: an application using a bound parameter for `status` gets no benefit from a partial index on a literal value. The predicate must be a constant in the query text.

### Good uses

**Hot subsets.** A queue table where the interesting rows are a tiny fraction:

```sql
CREATE INDEX jobs_queued_idx ON jobs (priority DESC, created_at)
    WHERE state = 'queued';
```

**Excluding NULLs** on a sparse column:

```sql
CREATE INDEX customers_vat_number_idx ON customers (vat_number)
    WHERE vat_number IS NOT NULL;
```

**Conditional uniqueness** - the main reason partial indexes are indispensable, because a `UNIQUE` *constraint* cannot have a `WHERE` clause:

```sql
-- Exactly one primary address per customer
CREATE UNIQUE INDEX customer_addresses_one_primary_idx
    ON customer_addresses (customer_id) WHERE is_primary;

-- Unique among live rows only, so a deleted user's email can be reused
CREATE UNIQUE INDEX users_email_live_key
    ON users (lower(email)) WHERE deleted_at IS NULL;

-- One in-flight job per key
CREATE UNIQUE INDEX jobs_one_active_idx
    ON jobs (job_key) WHERE state IN ('queued', 'running');
```

These rules are not expressible any other way in the database, and the alternative is application checking with a race condition.

**Soft-delete tables.** On a table that is mostly deleted rows, `WHERE deleted_at IS NULL` on every index removes the dead weight. See [temporal-and-history.md](temporal-and-history.md).

### `ON CONFLICT` with a partial unique index

The predicate must be repeated in the statement, or the arbiter is not found:

```sql
INSERT INTO users (email, name) VALUES ($1, $2)
ON CONFLICT (lower(email)) WHERE deleted_at IS NULL
DO UPDATE SET name = EXCLUDED.name;
```

Omitting `WHERE deleted_at IS NULL` gives "there is no unique or exclusion constraint matching the ON CONFLICT specification". See [upsert-and-merge.md](upsert-and-merge.md).

### Keep predicates stable

A predicate like `WHERE created_at > '2026-01-01'` is legal but becomes progressively less useful and cannot be updated without rebuilding. `now()` is not permitted at all - the predicate must be immutable.

## Expression indexes

Index the result of an expression rather than a column.

```sql
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
```

```sql
SELECT * FROM users WHERE lower(email) = lower($1);   -- uses it
SELECT * FROM users WHERE email = $1;                 -- does not
```

### The expression must match exactly

The planner matches expressions structurally. A cast, a different function, extra parentheses, or a different argument order all defeat it.

```sql
CREATE INDEX t_idx ON t (((data ->> 'price')::numeric));

WHERE (data ->> 'price')::numeric > 100    -- uses it
WHERE (data ->> 'price')::int > 100        -- NO, different cast
WHERE data ->> 'price' > '100'             -- NO, text comparison
```

This is the single most common reason an expression index is silently unused. When one is not being used, print the index definition and the query predicate side by side and compare character by character.

### The function must be `IMMUTABLE`

```
ERROR: functions in index expression must be marked IMMUTABLE
```

An index stores precomputed results. If the function's output could change for the same input, the index becomes silently wrong.

Common cases:

| Not immutable | Why | Fix |
|---|---|---|
| `now()`, `random()` | Volatile | Cannot be indexed |
| `to_tsvector(body)` | Depends on `default_text_search_config` | Use the two-argument form: `to_tsvector('english', body)` |
| `timestamptz::date` | Depends on the session `TimeZone` | Use `(ts AT TIME ZONE 'UTC')::date` |
| `unaccent(x)` | Depends on a mutable dictionary | Wrap in an `IMMUTABLE` SQL function |

The wrapper pattern:

```sql
CREATE FUNCTION immutable_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE INDEX customers_name_unaccent_idx ON customers (immutable_unaccent(name));
```

**Marking a function `IMMUTABLE` is a promise.** If it is not actually immutable, indexes built on it return wrong results with no error, and only a `REINDEX` fixes it. Never mark a function `IMMUTABLE` merely to satisfy the error.

### Good uses

**Case-insensitive lookup and uniqueness**, preferred over `citext`:

```sql
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
```

**Extracting a `jsonb` field for B-tree comparison** - GIN cannot do ranges or ordering:

```sql
CREATE INDEX orders_priority_idx ON orders (((data ->> 'priority')::int));
```

Prefer a `STORED` generated column plus a plain index: it is visible in `\d`, can be constrained, and the query does not have to reproduce the expression. See [jsonb.md](jsonb.md).

**Normalised comparison:**

```sql
CREATE INDEX products_sku_normalised_idx
    ON products (upper(replace(sku, '-', '')));
```

**Full-text search**, where the expression form avoids a stored column. See [full-text-search.md](full-text-search.md).

**Sorting by a computed value:**

```sql
CREATE INDEX orders_total_desc_idx ON orders ((quantity * unit_price) DESC);
```

Note the double parentheses: `CREATE INDEX ... ON t ((expression))`. A single set is a syntax error for anything but a bare column name.

## Combining both

```sql
CREATE UNIQUE INDEX users_email_live_key
    ON users (lower(email))
    WHERE deleted_at IS NULL;
```

Case-insensitive uniqueness among live rows only. Both mechanisms, three lines, and it is not expressible as a constraint at all.

## Statistics

PostgreSQL collects statistics on **expression index results**, which improves estimates for queries using that expression. This is a real secondary benefit: without the index, the planner has no idea how selective `lower(email) = $1` is and falls back to a default guess.

Run `ANALYZE` after creating an expression index so those statistics exist. See [statistics-and-planner.md](statistics-and-planner.md).

## Finding candidates

Partial index candidates are columns with a heavily skewed distribution:

```sql
SELECT attname, n_distinct, most_common_vals, most_common_freqs
FROM   pg_stats
WHERE  tablename = 'orders' AND attname = 'status';
```

If one value accounts for 95% of rows, the other values are excellent partial index candidates and a full index on the column is mostly wasted space.

## Version notes

- **18** - virtual generated columns cannot be indexed, so the generated-column alternative to an expression index must be `STORED`.
- **14+** - improved statistics handling for expression indexes.
- **12+** - `STORED` generated columns provide an alternative to expression indexes that is more visible and constrainable.

Partial index predicate proving, the exact-match requirement, and the `IMMUTABLE` requirement are identical across 14 to 18.

## Gotchas

- Agent creates a partial index with a literal predicate, then queries with a bound parameter - the planner cannot prove the implication and the index goes unused
- Agent writes a query whose expression differs from the index by a cast or parentheses - silently unused
- Agent marks a function `IMMUTABLE` just to make `CREATE INDEX` succeed - the index is then silently wrong whenever the function's output changes
- Agent indexes `to_tsvector(body)` with one argument - not immutable, and depends on a server setting
- Agent indexes `some_timestamptz::date` - depends on the session timezone and is not immutable
- Agent uses a `UNIQUE` constraint where the rule is conditional - constraints cannot have `WHERE`; use a partial unique index
- Agent targets a partial unique index in `ON CONFLICT` without repeating the predicate - no matching arbiter
- Agent writes `CREATE INDEX ... ON t (expression)` with single parentheses - syntax error for anything but a bare column
- Agent creates a partial index with a date literal predicate - it decays over time and needs rebuilding
- Agent tries `WHERE created_at > now()` in an index predicate - not permitted, `now()` is not immutable
- Agent forgets `ANALYZE` after creating an expression index - the useful statistics on the expression do not exist yet
- Agent indexes a whole column when 95% of rows share one value - a partial index on the minority is far smaller and just as useful

## Related

- [indexing-fundamentals.md](indexing-fundamentals.md) · [composite-and-covering-indexes.md](composite-and-covering-indexes.md) · [index-types.md](index-types.md) · [constraints.md](constraints.md) · [upsert-and-merge.md](upsert-and-merge.md) · [jsonb.md](jsonb.md) · [full-text-search.md](full-text-search.md) · [statistics-and-planner.md](statistics-and-planner.md)
