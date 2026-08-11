# Extensions

Extensibility is PostgreSQL's defining feature. It is also how a database acquires a dependency that blocks a major upgrade, so install deliberately.

## Managing them

```sql
SELECT * FROM pg_available_extensions ORDER BY name;   -- what can be installed here
SELECT * FROM pg_extension;                            -- what is installed in this database

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;

ALTER EXTENSION pg_trgm UPDATE;                        -- after a server upgrade
```

Three facts that catch people:

1. **Extensions are per database**, not per cluster. A new database has none unless they were installed into `template1`.
2. **Some are cluster-level shared libraries** loaded via `shared_preload_libraries` and requiring a restart - `pg_stat_statements`, `auto_explain`, `pg_cron`. `CREATE EXTENSION` then only creates the views in that database.
3. **Managed platforms restrict the list.** Always check `pg_available_extensions` on the actual target rather than assuming.

Installing into a dedicated `extensions` schema keeps `public` clean and makes dumps easier to reason about. Add it to `search_path` or qualify the operators. See [schema-organisation.md](schema-organisation.md).

## The ones worth installing

### `pg_stat_statements` - install this first

Aggregated execution statistics per normalised query. Without it, "which query is slow" is guesswork.

```
shared_preload_libraries = 'pg_stat_statements'   # requires a restart
```

Needs a restart, so install it before you need it - which is invariably during an incident. See [performance-triage.md](performance-triage.md).

### `pg_trgm`

Trigram matching. Makes `LIKE '%anything%'` indexable, which no B-tree can do, and provides similarity search for typo tolerance.

```sql
CREATE INDEX customers_name_trgm ON customers USING gin (name gin_trgm_ops);
```

Essential for autocomplete, name search and fuzzy matching. See [full-text-search.md](full-text-search.md).

### `btree_gist` and `btree_gin`

Let GiST and GIN indexes handle plain scalar types alongside their native ones.

`btree_gist` is **required** for the most useful form of exclusion constraint - mixing scalar equality with range overlap:

```sql
CREATE EXTENSION btree_gist;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (room_id WITH =, period WITH &&);
```

See [constraints.md](constraints.md).

### `pgcrypto`

Hashing and encryption in the database. `gen_random_uuid()` moved into core in PostgreSQL 13, so that is no longer a reason to install it.

Use it for column-level encryption where the requirement is genuine. Note that an encrypted column cannot be indexed for ranges or sorted meaningfully, and key management becomes your problem - if the key sits in the database, the encryption protects against very little.

For password hashing, prefer doing it in the application with a modern KDF. `pgcrypto`'s `crypt()` with `bf` is bcrypt, which is acceptable, but a database function call means the plaintext password travels to the database and may appear in logs.

### `pg_cron`

Cron inside the database. Refresh materialised views, expire partitions, run maintenance.

```sql
SELECT cron.schedule('refresh-daily', '17 3 * * *',
                     'REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue');
```

Simpler than an external scheduler and available on most managed platforms. The trade-off is that the schedule lives in the database rather than in version control, so keep the `cron.schedule` calls in migrations.

Requires `shared_preload_libraries` and, by default, jobs run in one designated database.

### `pgstattuple`

Measures table and index bloat rather than estimating it. The widely-circulated estimation queries are frequently far off; this reads the actual pages.

```sql
SELECT * FROM pgstattuple('orders');
SELECT * FROM pgstatindex('orders_pkey');
```

It scans the whole relation, so run it off-peak. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

### `pgvector`

Vector similarity search for embeddings. `vector` type, HNSW and IVFFlat indexes, cosine, L2 and inner-product distance.

```sql
CREATE EXTENSION vector;
ALTER TABLE documents ADD COLUMN embedding vector(1536);
CREATE INDEX documents_embedding_hnsw ON documents
    USING hnsw (embedding vector_cosine_ops);
```

HNSW is the default choice: better recall, no training step, slower to build. IVFFlat builds faster but must be created **after** the data is loaded, on representative rows.

Match the operator class to the distance operator used at query time - `vector_cosine_ops` with `<=>`, `vector_l2_ops` with `<->`. A mismatch silently returns poor results. Both index types are approximate and can miss true nearest neighbours. See [index-types.md](index-types.md).

### `postgis`

Comprehensive geospatial support: geometry and geography types, projections, spatial joins, thousands of functions. Far beyond the built-in geometric types.

Large, and it is the extension most likely to complicate a major upgrade, because the PostGIS version must be compatible with the target PostgreSQL. Plan upgrades around it.

### `unaccent`

Makes `café` match `cafe`. Not immutable, so indexing it needs an `IMMUTABLE` wrapper function. A non-deterministic ICU collation is often a cleaner answer. See [partial-and-expression-indexes.md](partial-and-expression-indexes.md).

### `hypopg`

Hypothetical indexes: create one without building it, and see whether the planner would use it.

```sql
SELECT * FROM hypopg_create_index('CREATE INDEX ON orders (customer_id, placed_at)');
EXPLAIN SELECT ... ;   -- the planner considers the hypothetical index
```

Excellent for evaluating an index on a large table before paying to build it. Underused.

### `pg_repack`

Rebuilds a table to remove bloat **without** the `ACCESS EXCLUSIVE` lock that `VACUUM FULL` holds for its entire duration. Brief locks at start and end only.

Needs a primary key or unique index, and disk space for a full copy. The right tool when a table has genuinely and permanently shrunk.

### `auto_explain`

Logs execution plans for slow queries automatically - the only way to capture a plan that is bad only in production, only sometimes.

`log_analyze` adds real overhead to every query, not only logged ones. Use `sample_rate` and treat it as a temporary diagnostic. See [explain.md](explain.md).

### `pgaudit`

Structured, filterable audit logging by object and operation class. The standard answer for regulated environments, and far more usable than `log_statement = 'all'`.

## Ones to think twice about

**`citext`** - a case-insensitive text type. Works, but makes every comparison case-insensitive whether or not you wanted that, and interacts awkwardly with collations. A unique expression index on `lower(col)` is more explicit. `citext` earns its place only when a column needs case-insensitive `UNIQUE` or foreign-key semantics. See [data-types.md](data-types.md).

**`hstore`** - flat key-value. Superseded by `jsonb` for essentially every use. Only in legacy schemas.

**`uuid-ossp`** - `gen_random_uuid()` has been in core since 13, and `uuidv7()` since 18. No longer needed.

**`dblink`** - superseded by `postgres_fdw`, which has a better interface and better pushdown. Neither gives distributed transactions.

**`pg_hint_plan`** - real planner hints. Genuinely useful for a stubborn plan, and it freezes a decision that should adapt as data changes. Fix the statistics first. See [statistics-and-planner.md](statistics-and-planner.md).

## Checking availability on the target

Platform extension catalogues change with every provider release, so **never answer this from memory or from a table in a document.** Ask the server.

```sql
-- Everything this server can install, and what is already installed
SELECT name, default_version, installed_version, comment
FROM   pg_available_extensions
ORDER  BY installed_version NULLS LAST, name;

-- Is a specific set available? Anything missing is a hard blocker to plan around.
SELECT e.wanted,
       a.default_version,
       a.installed_version,
       CASE WHEN a.name IS NULL THEN 'NOT AVAILABLE' ELSE 'ok' END AS status
FROM   unnest(ARRAY['pg_stat_statements','pg_trgm','btree_gist','pgcrypto',
                    'pg_cron','vector','postgis','pgstattuple','hypopg']) AS e(wanted)
LEFT   JOIN pg_available_extensions a ON a.name = e.wanted
ORDER  BY status, e.wanted;

-- Which require a restart because they are preloaded libraries
SHOW shared_preload_libraries;
```

Run the second query as the first step of any design that depends on an extension, and record the output next to the migrations.

What is safe to assume, and what is not:

| | Extensions |
|---|---|
| **Effectively universal.** Present on self-hosted and on every major managed platform | `pg_stat_statements`, `pg_trgm`, `btree_gist`, `btree_gin`, `pgcrypto`, `unaccent`, `citext`, `hstore`, `pgstattuple`, `postgis`, `pgvector` |
| **Usually available, but confirm** - version lags and per-tier restrictions are common | `pg_cron`, `pgaudit`, `pg_repack` |
| **Frequently unavailable on managed platforms.** Plan for the possibility that you cannot have these at all | `hypopg`, `timescaledb`, `citus`, `pg_hint_plan`, anything requiring a custom C library |

Two structural constraints that hold regardless of platform:

- **A preloaded library needs a restart**, and on a managed platform that means a parameter-group change and a maintenance window. `pg_stat_statements`, `pg_cron`, `auto_explain` and `pgaudit` are all in this category.
- **Managed platforms rarely grant superuser**, so extensions that require it are unavailable even when the files are present.

## Extensions and upgrades

An extension is a dependency and can block a major upgrade:

- The extension must exist and be compatible on the target version.
- `pg_upgrade` requires the same extension versions to be **available** on both sides.
- Run `ALTER EXTENSION ... UPDATE` after upgrading the server.
- A restore into a cluster without the same extensions fails partway.

Record which extensions and versions the schema needs, in the repository, next to the migrations. `PostGIS` and `TimescaleDB` in particular need their upgrade sequenced with the server's. See [postgres-versions.md](postgres-versions.md) and [backup-and-recovery.md](backup-and-recovery.md).

## Version notes

- **18** - `uuidv7()` and `uuidv4()` in core, removing the last common reason to install a UUID extension.
- **16+** - more predefined roles reduce the need for extensions that granted elevated capabilities.
- **13+** - `gen_random_uuid()` in core; `uuid-ossp` and `pgcrypto` no longer needed for UUIDs.

`CREATE EXTENSION` semantics and the per-database scope are identical across 14 to 18. Extension **versions** move independently of PostgreSQL and are the thing to pin and check.

## Gotchas

- Agent assumes an extension installed in one database is available in others - they are per database
- Agent installs `pg_stat_statements` during an incident - it needs `shared_preload_libraries` and a restart, so install it beforehand
- Agent recommends an extension without checking `pg_available_extensions` on the target - managed platforms restrict the list
- Agent installs everything into `public` - clutters the schema and complicates dumps
- Agent creates an exclusion constraint mixing `=` and `&&` without `btree_gist` - it cannot be created
- Agent installs `uuid-ossp` or `pgcrypto` for UUIDs - `gen_random_uuid()` has been in core since 13
- Agent uses `citext` reflexively for case-insensitivity - a unique expression index on `lower(col)` is more explicit
- Agent uses `hstore` in a new schema - superseded by `jsonb`
- Agent uses `unaccent` directly in an index expression - it is not immutable and the index cannot be created
- Agent builds an IVFFlat index on an empty table - it needs representative data
- Agent mismatches the pgvector operator class and the query distance operator - silently poor recall
- Agent adds `pg_hint_plan` before fixing statistics - it freezes a decision that should adapt
- Agent plans a major upgrade without checking extension compatibility - PostGIS and TimescaleDB in particular can block it
- Agent does not run `ALTER EXTENSION ... UPDATE` after a server upgrade - the extension stays on the old version
- Agent does not record which extensions the schema requires - a restore into a clean cluster then fails partway

## Related

- [performance-triage.md](performance-triage.md) · [index-types.md](index-types.md) · [full-text-search.md](full-text-search.md) · [constraints.md](constraints.md) · [schema-organisation.md](schema-organisation.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [backup-and-recovery.md](backup-and-recovery.md) · [postgres-versions.md](postgres-versions.md)
