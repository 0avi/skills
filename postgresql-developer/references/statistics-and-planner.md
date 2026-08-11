# Statistics and the Planner

The planner is a cost model fed by statistics. When a plan is bad, the statistics are usually why - and no index will fix a bad estimate.

## What the planner knows

`ANALYZE` samples each table (300 × `statistics_target` rows, so 30,000 by default) and stores per-column:

- `null_frac` - fraction of NULLs
- `n_distinct` - distinct values, or a negative number meaning a fraction of the table
- `most_common_vals` / `most_common_freqs` - the MCV list and their frequencies
- `histogram_bounds` - equi-depth buckets for everything outside the MCV list
- `correlation` - how well physical row order matches column order. Decides whether an index scan is sequential-ish or random, and whether BRIN is viable

```sql
SELECT attname, null_frac, n_distinct, correlation,
       most_common_vals, most_common_freqs
FROM   pg_stats
WHERE  schemaname = 'public' AND tablename = 'orders';
```

Selectivity comes from these: an MCV hit uses its recorded frequency; otherwise the planner interpolates from the histogram, or falls back to `1/n_distinct`.

## Autovacuum runs ANALYZE

Autovacuum triggers an analyse when changed rows exceed:

```
autovacuum_analyze_threshold + autovacuum_analyze_scale_factor × reltuples
```

Defaults: 50 and 0.1, so **10% of the table must change**. On a 100-million-row table that is 10 million rows - statistics can be badly stale for a long time while looking healthy.

```sql
SELECT relname, n_live_tup, n_mod_since_analyze, last_analyze, last_autoanalyze
FROM   pg_stat_user_tables ORDER BY n_mod_since_analyze DESC;
```

Lower the scale factor on large tables:

```sql
ALTER TABLE orders SET (autovacuum_analyze_scale_factor = 0.01);
```

**Run `ANALYZE` explicitly after any bulk load, after a major upgrade, and after creating an expression index.** A `pg_upgrade` before 18 does not carry statistics across, so the first production queries run with none at all. See [postgres-versions.md](postgres-versions.md).

## Diagnosing a misestimate

Compare estimated and actual rows at every node in `EXPLAIN (ANALYZE)`. Within 10x is fine; 100x means the plan above it is built on a fiction.

The causes, in the order they occur in practice:

### 1. Stale statistics

`last_analyze` is old, or the table has changed heavily since. Run `ANALYZE` and re-plan. Free, and fixes a surprising proportion.

### 2. Correlated columns

**The single most common genuine cause.** PostgreSQL assumes columns are independent:

```sql
WHERE city = 'London' AND country = 'United Kingdom'
```

If 5% of rows are London and 8% are the UK, it estimates 0.4%. The reality is 5% - every London row is a UK row. On a 10-million-row table it expects 40,000 and gets 500,000, and picks a nested loop that runs 500,000 times.

**Extended statistics** fix this:

```sql
CREATE STATISTICS orders_city_country (dependencies, ndistinct, mcv)
    ON city, country FROM orders;
ANALYZE orders;
```

Three kinds, and they do different jobs:

| Kind | Fixes |
|---|---|
| `dependencies` | Functional dependencies: knowing `city` largely determines `country` |
| `ndistinct` | Distinct-count estimates for **groups** of columns, so `GROUP BY a, b` is estimated properly |
| `mcv` | Most-common **combinations**, which handles skewed pairs that `dependencies` alone misses |

Create all three unless you have a reason not to. They cost a little at `ANALYZE` time and nothing at plan time.

Extended statistics also work over **expressions** (14+):

```sql
CREATE STATISTICS orders_month_stats ON date_trunc('month', placed_at) FROM orders;
```

Check what exists:

```sql
SELECT * FROM pg_stats_ext;
```

### 3. Skewed distribution beyond the MCV list

The default MCV list holds 100 entries. A column with 5,000 values where 200 of them are common leaves 100 outside the list, estimated from the histogram and badly wrong.

```sql
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 1000;
ANALYZE orders;
```

This raises the target for one column only. `default_statistics_target` (default 100) raises it globally, at the cost of longer `ANALYZE` and longer planning. Prefer per-column.

Maximum is 10,000.

### 4. Bad `n_distinct`

`n_distinct` is estimated from a sample and is unreliable for high-cardinality columns in large tables - it is frequently far too low, which makes `GROUP BY` and join estimates wrong.

Override it when you know better:

```sql
ALTER TABLE events ALTER COLUMN session_id SET (n_distinct = -0.8);
ANALYZE events;
```

A negative value is a fraction of the table: `-0.8` means "distinct values are 80% of rows". `-1` means unique.

This is a manual override that does not adapt. Use it when the estimate is provably wrong and extended statistics do not apply.

### 5. Function calls in predicates

The planner has no statistics for `my_function(col) = $1` and falls back to a fixed guess. Options:

- Index the expression - PostgreSQL then collects statistics on the expression's results.
- `CREATE STATISTICS` on the expression (14+).
- Set the function's `ROWS` and `COST` if it is set-returning.

### 6. Correlated subqueries and joins across many tables

Estimation error compounds through a plan. Each join multiplies the error of its inputs, which is why a 10-table query can produce an estimate that is off by six orders of magnitude at the top. Breaking the query up is sometimes the only practical fix.

## Cost parameters

The planner converts estimated work into arbitrary cost units:

| Setting | Default | Meaning |
|---|---|---|
| `seq_page_cost` | 1.0 | Sequential page read. The unit everything else is relative to |
| `random_page_cost` | **4.0** | Random page read |
| `cpu_tuple_cost` | 0.01 | Processing one row |
| `cpu_index_tuple_cost` | 0.005 | Processing one index entry |
| `cpu_operator_cost` | 0.0025 | One operator or function call |
| `effective_cache_size` | 4GB | **Planner hint only.** Total cache assumed available, including the OS page cache |

**`random_page_cost = 4.0` assumes a spinning disk.** On SSD or NVMe the ratio of random to sequential access is closer to 1.1. Leaving it at 4.0 systematically biases the planner away from index scans, and it is the most common cause of "why is it not using my index" on modern hardware.

```sql
ALTER SYSTEM SET random_page_cost = 1.1;
SELECT pg_reload_conf();
```

**`effective_cache_size` allocates nothing.** It tells the planner how much data is likely cached, which makes repeated index access look cheaper. Set it to roughly 50 to 75% of system RAM. Under-setting it discourages index scans.

See [configuration.md](configuration.md).

## Generic versus custom plans

A prepared statement is planned with its actual parameter values (a **custom plan**) for the first five executions. After that PostgreSQL compares costs and may switch to a **generic plan**, planned once without values and reused.

Usually a win. Occasionally a disaster: if `status = 'pending'` matches 0.1% and `status = 'complete'` matches 95%, one plan cannot suit both. The generic plan uses an average selectivity and is wrong for both.

```sql
SET plan_cache_mode = force_custom_plan;    -- always re-plan
SET plan_cache_mode = force_generic_plan;   -- never re-plan
SET plan_cache_mode = auto;                 -- default
```

**A query that is fast in `psql` and slow from the application is very often this**, because `psql` with literals always gets a custom plan. See [application-integration.md](application-integration.md).

## Statistics on partitioned tables

Each partition has its own statistics, and the parent has its own set covering the whole hierarchy. Autovacuum analyses **partitions** automatically but **not the partitioned parent** - the parent's statistics only update when someone runs `ANALYZE` on it explicitly.

That matters for any query that cannot be pruned to a single partition. Schedule a periodic `ANALYZE` on partitioned parents. See [partitioning.md](partitioning.md).

## Version notes

- **18** - `EXPLAIN` shows fractional row counts, making small estimates readable; `pg_upgrade` can carry statistics across, removing the mandatory post-upgrade `ANALYZE`.
- **17+** - faster `ANALYZE` on large tables.
- **14+** - extended statistics over **expressions**, not just column lists.
- **13+** - extended statistics can be used for `OR` clauses and `IN` lists.

`pg_stats` structure, cost parameters and `plan_cache_mode` are identical across 14 to 18.

## Gotchas

- Agent adds an index when the estimate is off by orders of magnitude - the plan choice is the problem, not the access path
- Agent does not run `ANALYZE` after a bulk load - the planner works from statistics describing an empty table
- Agent does not run `ANALYZE` after `pg_upgrade` on 17 or earlier - statistics are not carried across
- Agent relies on autovacuum for statistics on a very large table - the 10% default scale factor means millions of rows change first
- Agent ignores correlated columns - PostgreSQL assumes independence and multiplies selectivities, which is the most common genuine misestimate
- Agent creates extended statistics and does not run `ANALYZE` - they are not populated until then
- Agent creates only `dependencies` extended statistics - `ndistinct` and `mcv` fix different problems
- Agent raises `default_statistics_target` globally - longer `ANALYZE` and longer planning for every query; set it per column
- Agent leaves `random_page_cost` at 4.0 on SSD - systematically biases against index scans
- Agent believes `effective_cache_size` allocates memory - it is a planner hint only
- Agent overrides `n_distinct` without evidence - a manual value does not adapt as the data changes
- Agent cannot reproduce an application's slow query in `psql` - `psql` uses literals and gets a custom plan
- Agent relies on autovacuum to analyse a partitioned parent - it does not; only the partitions are analysed

## Related

- [explain.md](explain.md) · [query-optimisation.md](query-optimisation.md) · [indexing-fundamentals.md](indexing-fundamentals.md) · [configuration.md](configuration.md) · [mvcc-and-vacuum.md](mvcc-and-vacuum.md) · [partitioning.md](partitioning.md) · [multi-tenancy.md](multi-tenancy.md) · [application-integration.md](application-integration.md)
