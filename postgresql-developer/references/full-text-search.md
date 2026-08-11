# Full-Text Search

PostgreSQL's full-text search is good enough that most applications never need Elasticsearch. It is not as good as a dedicated search engine for relevance tuning, fuzzy matching at scale, or faceting, but the operational saving of not running a second system is substantial.

## The pipeline

Text becomes a `tsvector`: parsed into tokens, tokens normalised into **lexemes** by a dictionary chain, stop words dropped, positions recorded.

```sql
SELECT to_tsvector('english', 'The runners were running quickly through the fields');
-- 'field':8 'quick':6 'run':3,4
```

`the`, `were`, `through` are stop words and vanish. `runners`, `running` and `run` all stem to `run`. Positions are kept for phrase search and ranking.

A `tsquery` is normalised the same way, which is why both sides must use the **same configuration**.

## Always name the configuration

```sql
to_tsvector('english', body)      -- correct
to_tsvector(body)                 -- uses default_text_search_config
```

The one-argument form depends on the `default_text_search_config` setting, which varies by server, by `initdb` locale, and can be changed per session. An index built with one configuration and queried with another silently returns wrong results - not an error, just missing matches.

**Always pass the configuration explicitly, in the index and in the query.** An expression index on `to_tsvector(body)` is not even usable, because the function is not immutable in the one-argument form.

## Storing the vector

Recomputing `to_tsvector` on every query means a sequential scan. Store it.

### Generated column (12+, preferred)

```sql
ALTER TABLE articles ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')),  'A') ||
        setweight(to_tsvector('english', coalesce(body,  '')),  'B')
    ) STORED;

CREATE INDEX articles_search_idx ON articles USING gin (search_vector);
```

Maintained by the database, cannot drift, no trigger to write.

Three details:

- **`STORED` is mandatory here.** On **18** the default became `VIRTUAL`, and a virtual generated column cannot be indexed - which silently defeats the whole thing. See [postgres-versions.md](postgres-versions.md).
- **`coalesce` on every column.** `||` with a NULL operand yields NULL, so one NULL column makes the entire vector NULL and the row unfindable.
- **`setweight`** tags lexemes A to D so ranking can weight a title match above a body match.

### Expression index (no column)

```sql
CREATE INDEX articles_search_idx ON articles
    USING gin (to_tsvector('english', title || ' ' || body));
```

Smaller table, but the query must repeat the **exact** expression to use the index, and `||` with NULL still produces NULL.

### Trigger (pre-12, or when the vector spans tables)

`tsvector_update_trigger` is built in but cannot use `setweight`. A custom trigger can. See [functions-and-triggers.md](functions-and-triggers.md).

## Querying

```sql
SELECT id, title
FROM   articles
WHERE  search_vector @@ websearch_to_tsquery('english', $1);
```

`@@` is the match operator. Four query parsers:

| Function | Input | Use |
|---|---|---|
| `websearch_to_tsquery` | `postgres -mysql "full text"` | **User input.** Never raises on bad syntax |
| `plainto_tsquery` | `postgres database` | All terms ANDed. Ignores operators |
| `phraseto_tsquery` | `full text search` | Terms must be adjacent, in order |
| `to_tsquery` | `postgres & !mysql & (index \| search)` | Programmatic. **Raises a syntax error on bad input** |

**Use `websearch_to_tsquery` for anything a user types.** It understands quoted phrases, `or`, and `-` for exclusion, and it never throws - so a stray quote does not become a 500. Passing raw user input to `to_tsquery` is a reliable source of production errors.

Operators inside a `tsquery`: `&` and, `|` or, `!` not, `<->` followed by, `<N>` within N positions, `:*` prefix.

```sql
to_tsquery('english', 'quick <-> brown')     -- phrase
to_tsquery('english', 'postg:*')             -- prefix, matches postgres, postgresql
```

## Ranking

```sql
SELECT id, title, ts_rank(search_vector, query) AS rank
FROM   articles, websearch_to_tsquery('english', $1) AS query
WHERE  search_vector @@ query
ORDER  BY rank DESC
LIMIT  20;
```

Putting the query in `FROM` computes it once rather than per row.

- `ts_rank` - frequency-based.
- `ts_rank_cd` - cover density, rewards terms appearing close together. Usually better for phrase-like queries.

Both take an optional weights array `{D,C,B,A}` (note the order) and a normalisation bitmask, most usefully `32` to divide by rank+1 so scores land in 0..1, and `1` or `2` to penalise long documents.

```sql
ts_rank('{0.1, 0.2, 0.4, 1.0}', search_vector, query, 32)
```

**Ranking cannot use the index for ordering.** The GIN index finds matching rows; the ranking is computed on each one and then sorted. A query matching 500,000 rows computes 500,000 ranks. Narrow the candidate set with other predicates first, and always `LIMIT`.

For a leaderboard-style search, a two-stage approach - cheap filter, then rank the top candidates - is much faster than ranking everything.

## Highlighting

```sql
SELECT ts_headline('english', body, query,
                   'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15')
FROM articles, websearch_to_tsquery('english', $1) AS query
WHERE search_vector @@ query
LIMIT 20;
```

`ts_headline` works on the **original text**, not the vector, so it must re-parse each document. It is expensive. Apply it after `LIMIT`, never to the whole match set - typically in a subquery or CTE that has already been limited.

## Indexing: GIN or GiST

| | GIN | GiST |
|---|---|---|
| Lookup speed | Faster, often 3x | Slower |
| Build and update | Slower | Faster |
| Size | Larger | Smaller |
| False positives | No | Yes, requires a recheck |

**Use GIN.** GiST is for write-heavy tables where index maintenance dominates, or where the same index also covers ranges or geometry.

GIN has a `fastupdate` mechanism that buffers new entries in a pending list and merges them later. It makes inserts fast and makes an occasional query slow while it flushes, and the pending list is scanned linearly by every query until merged. `gin_pending_list_limit` controls the size. For a search-heavy table with steady writes, consider `fastupdate = off`.

## `pg_trgm`: fuzzy and substring matching

Full-text search matches whole normalised words. It cannot do typo tolerance or infix matching. `pg_trgm` breaks strings into three-character sequences and indexes those.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops);
```

This makes leading-wildcard `LIKE` indexable, which no B-tree can do:

```sql
SELECT * FROM customers WHERE name ILIKE '%smith%';        -- uses the trigram index
SELECT * FROM customers WHERE name % 'jonhson'             -- similarity match
ORDER BY similarity(name, 'jonhson') DESC LIMIT 10;
```

`%` is the similarity operator, thresholded by `pg_trgm.similarity_threshold` (default 0.3). `<->` is the distance operator and supports index-assisted `ORDER BY` with a GiST index.

The common architecture is **both**: full-text for content, trigram for names, SKUs and autocomplete.

## `unaccent`

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Makes `café` match `cafe`. To use it in an index it must be wrapped, because `unaccent` is not immutable (it depends on a dictionary that could change):

```sql
CREATE FUNCTION immutable_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
```

Marking it `IMMUTABLE` is a promise you are making. If the dictionary is ever changed, indexes built on it are silently wrong and must be rebuilt.

Better, where the requirement is broader: a **non-deterministic ICU collation** handles accent and case insensitivity at the collation level, without extensions or wrapper functions.

## When to reach for a search engine

PostgreSQL FTS is the right default. Move when you need:

- Relevance tuning beyond weights - BM25, learning to rank, synonyms managed by non-developers.
- Faceted search with counts across many dimensions at low latency.
- Very large corpora, tens of millions of documents with sub-100ms multi-term queries.
- Fuzzy matching across a whole corpus rather than one column.
- Aggregations over search results that are themselves the product.

Do not move for "we might need it later". A GIN index over a `tsvector` on a few million rows is fast, and the second system has to be kept in sync forever.

## Version notes

- **18** - generated columns default to `VIRTUAL`; the `tsvector` column **must** say `STORED` or it cannot be indexed.
- **14+** - `websearch_to_tsquery` and multirange types available on all supported versions.
- **12+** - generated columns, so the stored-vector pattern needs no trigger. Also the `tsquery` phrase operators are stable from well before this.

GIN/GiST behaviour, ranking functions and `pg_trgm` operators are identical across 14 to 18. Dictionary and stop-word files come from the server installation and can differ between environments - a real source of "works locally" search discrepancies.

## Gotchas

- Agent uses the one-argument `to_tsvector(body)` - depends on a server setting, and is not immutable so it cannot be indexed
- Agent uses a different configuration in the index and the query - silently returns no matches
- Agent creates the `tsvector` generated column on 18 without `STORED` - it becomes virtual and cannot be indexed
- Agent concatenates columns without `coalesce` - one NULL makes the whole vector NULL and the row unfindable
- Agent passes raw user input to `to_tsquery` - a stray quote or operator raises a syntax error; use `websearch_to_tsquery`
- Agent computes `to_tsvector` in the `WHERE` clause instead of storing it - forces a sequential scan
- Agent expects ranking to use the index for ordering - it ranks every matching row then sorts; narrow the set first and always `LIMIT`
- Agent applies `ts_headline` before `LIMIT` - it re-parses every matched document
- Agent puts `websearch_to_tsquery(...)` in the `WHERE` clause rather than `FROM` - recomputed per row
- Agent uses GiST by default - GIN is faster for lookups and is the right default for search
- Agent expects full-text search to handle typos or substrings - it matches whole normalised words; use `pg_trgm`
- Agent uses `unaccent` directly in an index expression - it is not immutable and the index cannot be created
- Agent reaches for Elasticsearch before measuring PostgreSQL FTS - a GIN index on a few million rows is fast, and the second system needs permanent synchronisation

## Related

- [index-types.md](index-types.md) · [partial-and-expression-indexes.md](partial-and-expression-indexes.md) · [jsonb.md](jsonb.md) · [extensions.md](extensions.md) · [data-types.md](data-types.md) · [functions-and-triggers.md](functions-and-triggers.md) · [query-optimisation.md](query-optimisation.md)
