# Index Types

PostgreSQL separates **what** you index (single column, composite, partial, expression, covering) from **how** it is stored (the access method). This file is about the access method: `USING btree`, `USING gin`, and the rest.

`CREATE INDEX` defaults to B-tree, which is right the overwhelming majority of the time.

## The table

| Method | Operators | Index-only scan | Multicolumn | Use for |
|---|---|---|---|---|
| **B-tree** | `<` `<=` `=` `>=` `>` `BETWEEN` `IN` `IS NULL`, prefix `LIKE` | Yes | Yes | **Default.** Equality, ranges, sorting, uniqueness |
| **Hash** | `=` only | No | No | Equality on large values, where index size matters |
| **GIN** | `@>` `?` `&&` `@@`, containment and membership | No | Yes | `jsonb`, arrays, full-text search, trigrams |
| **GiST** | Overlap, containment, nearest-neighbour, `&&` `<->` | Some opclasses | Yes | Ranges, geometry, exclusion constraints, KNN |
| **SP-GiST** | Partitioned search structures | Some opclasses | No | Non-balanced data: quadtrees, radix trees, IP prefixes |
| **BRIN** | Range operators, on naturally ordered data | No | Yes | Very large tables physically correlated with the indexed column |
| **Bloom** (extension) | `=` on many columns | No | Yes | Wide tables queried by arbitrary combinations of columns |

## B-tree

The default and the one to reach for. Balanced tree, `O(log n)` lookup, leaf nodes linked in order so range scans and ordered output come free.

Serves:

- Equality and all range operators.
- `ORDER BY` without a sort, in either direction (a backward scan is nearly as cheap as forward).
- `MIN`/`MAX` as a single-row lookup at either end.
- Uniqueness enforcement, which is how `PRIMARY KEY` and `UNIQUE` are implemented.
- Prefix `LIKE 'abc%'`, but **only** under the `C` collation or with `text_pattern_ops`.

Declare direction and NULL placement when the query needs a specific ordering:

```sql
CREATE INDEX orders_placed_at_desc_idx ON orders (placed_at DESC NULLS LAST);
```

For a single column this rarely matters, because PostgreSQL can scan backwards. It matters for **composite** indexes with mixed directions, where no scan direction produces the required order. See [composite-and-covering-indexes.md](composite-and-covering-indexes.md).

**Deduplication** (13+) stores repeated key values once with a list of row pointers, dramatically shrinking indexes on low-cardinality columns. It is on by default. This removed most of the historical argument for using hash indexes on duplicate-heavy columns.

## Hash

`O(1)` equality lookup. Genuinely useful in one narrow case: **equality-only lookups on large values**, where the hash is 4 bytes but the value is a long string, so the index is much smaller than the equivalent B-tree.

Otherwise B-tree wins, because hash cannot:

- Serve ranges or sorting.
- Support `UNIQUE` constraints.
- Support multicolumn indexes.
- Support index-only scans.

Hash indexes became crash-safe and WAL-logged in PostgreSQL 10; the old "never use hash indexes" advice predates that. The current advice is narrower: **use B-tree unless the values are large and you only ever test equality.**

## GIN

Generalised Inverted Index. Stores one entry per **element** inside a composite value, pointing at the rows containing it. Built for "does this value contain that element".

```sql
CREATE INDEX articles_search_idx  ON articles USING gin (search_vector);
CREATE INDEX products_attrs_idx   ON products USING gin (attributes jsonb_path_ops);
CREATE INDEX posts_tags_idx       ON posts    USING gin (tags);
CREATE INDEX customers_name_trgm  ON customers USING gin (name gin_trgm_ops);
```

Characteristics:

- Very fast lookups, larger than B-tree, and **slow to update** - one row insert may touch many index entries.
- **`fastupdate`** (on by default) buffers new entries in a pending list, making inserts fast. The pending list is scanned linearly by every query until merged, so a query can be unexpectedly slow, and the merge itself can be a latency spike. `gin_pending_list_limit` bounds it; consider `fastupdate = off` for a search-heavy table with steady writes.
- **No index-only scans**, ever - GIN stores fragments, not whole values.

Operator classes matter here more than anywhere:

| Opclass | For | Notes |
|---|---|---|
| `jsonb_ops` (default) | `jsonb` | Supports `@>`, `?`, `?|`, `?&` |
| `jsonb_path_ops` | `jsonb` | **Only `@>`**, but a third the size and faster |
| `gin_trgm_ops` | `text` | Trigrams: `LIKE '%x%'`, `ILIKE`, similarity |
| `array_ops` (default) | arrays | `@>`, `<@`, `&&`, `=` |

See [jsonb.md](jsonb.md) and [full-text-search.md](full-text-search.md).

## GiST

Generalised Search Tree - a framework rather than one structure, with the semantics supplied by the operator class. Lossy: it can return false positives, which are rechecked against the heap.

Use for:

- **Range types and overlap.** `&&`, `@>`, and the backing index for `EXCLUDE` constraints.
- **Geometry**, both built-in types and PostGIS.
- **Nearest-neighbour** search - `ORDER BY point <-> target LIMIT 10` is index-assisted, which B-tree cannot do.
- **Full-text search** on write-heavy tables, where its cheaper updates outweigh slower lookups. GIN is otherwise better for search.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- to mix scalar equality with a range

ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (room_id WITH =, period WITH &&);
```

`btree_gist` is what lets a GiST index handle the plain-equality column alongside the range one. Without it that constraint cannot be created. See [constraints.md](constraints.md).

## SP-GiST

Space-partitioned GiST, for data that partitions naturally into non-overlapping regions - quadtrees, k-d trees, radix trees. Practically: **IP address prefixes (`inet`), text prefix matching, and point data.** Rarely the answer unless you have one of those shapes.

## BRIN

Block Range INdex. Stores only the min and max of the indexed column per range of blocks (128 pages by default).

Extraordinarily small - a BRIN index on a billion-row table can be a few megabytes, against gigabytes for a B-tree - and correspondingly imprecise: a scan reads every block range whose min/max bracket the value.

**BRIN only works when physical row order correlates with the indexed column.** That means append-only time-series, log tables, event tables - anything inserted in roughly ascending order of the indexed column.

```sql
CREATE INDEX events_occurred_at_brin ON events USING brin (occurred_at);
CREATE INDEX events_occurred_at_brin ON events USING brin (occurred_at)
    WITH (pages_per_range = 32);        -- more precise, still tiny
```

Check the correlation before creating one:

```sql
SELECT attname, correlation FROM pg_stats
WHERE tablename = 'events' AND attname = 'occurred_at';
```

Close to 1.0 or -1.0: BRIN will work well. Near 0: it will read most of the table and be useless. Random-UUID primary keys have correlation near zero, which is one more reason UUIDv4 keys hurt. See [keys-and-identifiers.md](keys-and-identifiers.md).

Correlation degrades as rows are updated and reinserted elsewhere. `CLUSTER` restores physical order but takes an `ACCESS EXCLUSIVE` lock and is not maintained afterwards.

## Bloom

An extension. A probabilistic index over many columns at once, returning false positives that are rechecked.

The niche: a wide table queried by many **different arbitrary combinations** of columns, where a B-tree per combination is impractical.

```sql
CREATE EXTENSION bloom;
CREATE INDEX big_bloom ON big_table USING bloom (c1, c2, c3, c4, c5, c6);
```

Rare, but genuinely the right answer for that shape.

## Vector indexes (pgvector)

For embedding similarity search:

| Type | Build | Query | Recall | Notes |
|---|---|---|---|---|
| **HNSW** | Slow, memory-hungry | Fast | High | Default choice. No training step |
| **IVFFlat** | Faster | Slower | Tunable | Must be built **after** data is loaded, on a representative sample |

```sql
CREATE INDEX items_embedding_hnsw ON items
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

Both are **approximate** - they can miss true nearest neighbours. Match the operator class to the distance metric used at query time (`vector_cosine_ops` with `<=>`, `vector_l2_ops` with `<->`); a mismatch silently returns poor results. See [extensions.md](extensions.md).

## Choosing

```
Equality / range / sort / unique              -> B-tree
Equality only, on large values                -> Hash
jsonb containment, arrays, full-text, trigram -> GIN
Ranges, geometry, EXCLUDE, nearest-neighbour  -> GiST
IP prefixes, text prefixes, points            -> SP-GiST
Huge table, physically ordered by the column  -> BRIN
Wide table, arbitrary column combinations     -> Bloom
Embeddings                                    -> HNSW
```

When unsure: B-tree.

## Version notes

- **18** - B-tree skip scan.
- **16+** - parallel B-tree index builds are faster; `pg_stat_io` exposes per-method I/O.
- **14+** - substantial GiST and BRIN improvements; BRIN `minmax_multi` and `bloom` opclasses, which make BRIN usable on data with moderate rather than near-perfect correlation.
- **13+** - B-tree deduplication, which shrank indexes on duplicate-heavy columns and removed most of the case for hash indexes there.

GIN `fastupdate`, GiST lossiness and the operator-class model are identical across 14 to 18. pgvector is an extension with its own version cadence - check what the platform provides.

## Gotchas

- Agent reaches for a non-default access method without a reason - B-tree is correct the large majority of the time
- Agent uses a hash index for anything but pure equality on large values - it cannot range, sort, enforce uniqueness, or be multicolumn
- Agent creates a BRIN index without checking `correlation` in `pg_stats` - on uncorrelated data it reads most of the table
- Agent creates a BRIN index on a table keyed by random UUIDs - correlation is near zero by construction
- Agent uses default `jsonb_ops` when only `@>` is needed - `jsonb_path_ops` is a third the size and faster
- Agent expects an index-only scan from a GIN index - GIN stores fragments and can never do one
- Agent creates an `EXCLUDE` constraint mixing `=` and `&&` without `btree_gist` - it cannot be created
- Agent tries to back an exclusion constraint with GIN - GIN does not support the required access pattern; GiST or SP-GiST only
- Agent expects `LIKE 'abc%'` to use a plain B-tree under a non-C collation - it needs `text_pattern_ops`
- Agent ignores GIN `fastupdate` on a search-heavy table - the pending list is scanned by every query until merged
- Agent builds an IVFFlat index on an empty table - it needs representative data to build its lists
- Agent mismatches the pgvector operator class and the query distance operator - silently poor recall, no error
- Agent forgets that approximate vector indexes can miss true nearest neighbours

## Related

- [indexing-fundamentals.md](indexing-fundamentals.md) · [composite-and-covering-indexes.md](composite-and-covering-indexes.md) · [partial-and-expression-indexes.md](partial-and-expression-indexes.md) · [jsonb.md](jsonb.md) · [full-text-search.md](full-text-search.md) · [constraints.md](constraints.md) · [extensions.md](extensions.md) · [partitioning.md](partitioning.md)
