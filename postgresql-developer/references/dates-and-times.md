# Dates and Times

## `timestamptz`, always

Despite the name, **`timestamptz` does not store a timezone**. It stores a UTC instant (microseconds since 2000-01-01), converts the input to UTC on write using the session's `TimeZone`, and converts back to the session's `TimeZone` on read.

`timestamp` (without time zone) stores a wall-clock reading with **no reference point**. "2026-03-14 09:00:00" in a `timestamp` column is not a moment in time - it is a number that means different instants depending on who wrote it.

```sql
SET TimeZone = 'Europe/London';
SELECT '2026-03-14 09:00:00+00'::timestamptz;   -- 2026-03-14 09:00:00+00
SET TimeZone = 'Pacific/Auckland';
SELECT '2026-03-14 09:00:00+00'::timestamptz;   -- 2026-03-14 22:00:00+13
```

Same stored instant, rendered in the caller's zone. That is what you want for every "when did this happen".

Use `date` for a calendar date with no time - a birth date, an invoice date. A birth date is not an instant and putting it in a `timestamptz` introduces a spurious midnight that shifts across zones.

Never specify precision. `timestamptz(0)` **rounds** rather than truncating, so `23:59:59.7` becomes the next day.

### When the original zone matters

Sometimes you need to know not just the instant but the local wall-clock time and place it happened - a meeting at 9am local, which stays 9am local if the timezone rules change. Store both:

```sql
starts_at     timestamptz NOT NULL,
starts_at_tz  text        NOT NULL   -- 'Europe/London', an IANA name
```

Store the IANA name, never a fixed offset. Offsets change twice a year; the zone name is stable and encodes the rules.

## Converting

`AT TIME ZONE` is overloaded and this catches everyone:

```sql
-- timestamptz -> timestamp: "what was the wall clock in that zone?"
SELECT now() AT TIME ZONE 'Europe/London';       -- returns timestamp

-- timestamp -> timestamptz: "this wall clock was in that zone"
SELECT '2026-03-14 09:00'::timestamp AT TIME ZONE 'Europe/London';   -- returns timestamptz
```

The direction depends on the input type. Applying it twice round-trips.

## Current time: three functions

| Function | Returns | Frozen within a transaction? |
|---|---|---|
| `now()`, `current_timestamp`, `transaction_timestamp()` | Transaction start | **Yes** |
| `statement_timestamp()` | Statement start | Per statement |
| `clock_timestamp()` | Actual wall clock | No |

**`now()` returns the transaction's start time.** Every row inserted in one transaction gets an identical `now()`. That is correct for `created_at` (they were all created in one atomic act) and wrong for anything measuring elapsed time or ordering events within a transaction.

For an audit log or an event table, use `clock_timestamp()`. See [temporal-and-history.md](temporal-and-history.md).

`now()` is **stable**, so it can appear in an index predicate context; `clock_timestamp()` is **volatile** and cannot. Neither can appear in a `CHECK` constraint - a constraint must give the same answer on re-validation. See [functions-and-triggers.md](functions-and-triggers.md).

## `date_trunc` and the timezone trap

```sql
date_trunc('month', placed_at)     -- truncates in UTC
```

For a UK business, "June" runs from 00:00 London time on 1 June. British Summer Time is in force then, so that instant is **23:00 UTC on 31 May**. Truncating in UTC puts an hour of June into May - so monthly revenue is quietly wrong by one hour's takings, every month from late March to late October.

The three-argument form (12+) truncates in a named zone:

```sql
date_trunc('day', placed_at, 'Europe/London')
```

Verified on 18:

```sql
SELECT date_trunc('month', '2026-06-01 00:30+01'::timestamptz)                 AS utc_trunc,
       date_trunc('month', '2026-06-01 00:30+01'::timestamptz,'Europe/London') AS london_trunc;
--      utc_trunc        |      london_trunc
-- 2026-06-01 00:00:00+00 | 2026-05-31 23:00:00+00
```

The London-truncated value renders as `2026-05-31 23:00 UTC`, which **is** midnight on 1 June in London. That is the correct month boundary; the UTC one is an hour late. Note that the difference only appears inside BST - truncating a January or March date gives the same answer either way, which is exactly why this bug survives testing.

**Any report grouped by a time period in a business timezone must specify the zone.** This is one of the most common silent reporting bugs.

`date_bin` (14+) buckets into arbitrary intervals:

```sql
date_bin('15 minutes', reading_at, timestamptz '2026-01-01')
```

## Intervals

`interval` stores three independent fields - months, days, microseconds - deliberately, because they are not interchangeable.

```sql
SELECT interval '1 month';   -- not 30 days; depends on which month
SELECT interval '1 day';     -- not 24 hours; DST days are 23 or 25
```

```sql
SELECT '2026-01-31'::date + interval '1 month';   -- 2026-02-28, clamped
SELECT '2026-03-29 00:30+00'::timestamptz + interval '1 day';   -- adds a calendar day
SELECT '2026-03-29 00:30+00'::timestamptz + interval '24 hours'; -- adds exactly 24h
```

Across a DST boundary those last two differ by an hour. Pick the one that matches the requirement: "same time tomorrow" is `1 day`; "24 hours from now" is `24 hours`.

`justify_interval()` normalises 30 days to 1 month, which is usually not what you want. `extract(epoch from interval)` gives seconds, assuming 30-day months, so avoid it for month-bearing intervals.

## Range queries

```sql
-- Wrong: BETWEEN is inclusive at both ends, so 2026-03-31 23:59:59.5 is excluded
WHERE placed_at BETWEEN '2026-03-01' AND '2026-03-31'

-- Right: half-open
WHERE placed_at >= '2026-03-01' AND placed_at < '2026-04-01'
```

**Never use `BETWEEN` on a timestamp.** The upper bound is inclusive, and a date literal means midnight, so the last day is almost entirely excluded. Half-open intervals `[)` compose without gaps or overlaps and are always correct.

With a business timezone:

```sql
WHERE placed_at >= timestamptz '2026-03-01 00:00 Europe/London'
  AND placed_at <  timestamptz '2026-04-01 00:00 Europe/London'
```

**Do not wrap the column in a function**, which prevents an index scan:

```sql
WHERE date_trunc('day', placed_at) = '2026-03-14'         -- no index scan
WHERE placed_at >= '2026-03-14' AND placed_at < '2026-03-15'   -- index scan
```

The same applies to `extract(year from placed_at) = 2026` and `placed_at::date = '2026-03-14'`. If you genuinely need the expression form, index the expression. See [partial-and-expression-indexes.md](partial-and-expression-indexes.md).

## Generating series and filling gaps

```sql
SELECT generate_series(
    date_trunc('day', now() - interval '29 days'),
    date_trunc('day', now()),
    interval '1 day'
) AS day;
```

Reports that group by day are missing rows for days with no data. `LEFT JOIN` against a generated series to fill them:

```sql
SELECT d.day, coalesce(count(o.id), 0) AS orders
FROM   generate_series(
           date_trunc('day', now() - interval '29 days'),
           date_trunc('day', now()),
           interval '1 day'
       ) AS d(day)
LEFT JOIN orders o
       ON o.placed_at >= d.day
      AND o.placed_at <  d.day + interval '1 day'
GROUP  BY d.day
ORDER  BY d.day;
```

`coalesce(count(...), 0)` is unnecessary here because `count` returns 0, but `sum` would need it. See [aggregation.md](aggregation.md).

## Ranges

`tstzrange` and `daterange` handle periods properly, with `EXCLUDE` constraints preventing overlap:

```sql
period tstzrange NOT NULL,
EXCLUDE USING gist (room_id WITH =, period WITH &&)
```

Default bounds are `[)`. Keep them. Operators: `@>` contains, `&&` overlaps, `-|-` adjacent, `*` intersection.

Multiranges (14+) represent a set of disjoint periods - availability with gaps - in a single value.

See [temporal-and-history.md](temporal-and-history.md) and [constraints.md](constraints.md).

## Age and differences

```sql
SELECT age(timestamp '2026-08-11', timestamp '1990-03-14');   -- 36 years 4 mons 28 days
SELECT '2026-08-11'::date - '1990-03-14'::date;               -- 13299 (integer days)
SELECT now() - created_at;                                     -- interval
```

`age()` gives human-readable years/months/days. Date subtraction gives an integer. Timestamp subtraction gives an interval in days and microseconds.

For "is this over 18", compare dates rather than counting days:

```sql
WHERE birth_date <= current_date - interval '18 years'
```

## Storage and infinity

`timestamptz` and `timestamp` are both 8 bytes; `date` is 4; `interval` is 16. There is no storage saving in `timestamp` over `timestamptz`.

`'infinity'` and `'-infinity'` are valid values and sort correctly, which makes them a clean alternative to `NULL` for an open-ended period:

```sql
valid_to timestamptz NOT NULL DEFAULT 'infinity'
```

Every comparison then works without a null check. Note that many client drivers map infinity awkwardly, so check before adopting it in an API-facing column.

## Version notes

- **16+** - `AT LOCAL` as shorthand for `AT TIME ZONE current_setting('TimeZone')`.
- **14+** - `date_bin()` for arbitrary-interval bucketing; multirange types.
- **12+** - three-argument `date_trunc(field, source, timezone)`. On earlier versions you must convert manually with `AT TIME ZONE` on both sides.

`timestamptz` semantics, `now()` versus `clock_timestamp()`, interval field independence and `BETWEEN` inclusivity are identical across 14 to 18.

The IANA timezone database is updated by minor releases and by the OS. A zone's rules can change, which is why an offset must never be stored in place of a zone name.

## Gotchas

- Agent uses `timestamp` instead of `timestamptz` - stores a wall-clock reading with no reference point
- Agent writes `timestamptz(0)` - rounds rather than truncating, moving values into the next second or day
- Agent uses `BETWEEN` on a timestamp range - the inclusive upper bound plus midnight semantics excludes almost the whole final day
- Agent uses `date_trunc` without a timezone for a business report - months and days are cut in UTC, so an hour lands in the wrong period
- Agent uses `now()` in an audit trigger or event table - it returns transaction start time, so ordering within the transaction is lost
- Agent uses `clock_timestamp()` for `created_at` - rows created atomically then have different timestamps
- Agent wraps a timestamp column in `date_trunc`, `extract` or `::date` in a `WHERE` clause - prevents an index scan; use a half-open range
- Agent treats `interval '1 month'` as 30 days or `interval '1 day'` as 24 hours - both are wrong across month ends and DST boundaries
- Agent stores a fixed UTC offset instead of an IANA zone name - offsets change twice a year
- Agent stores a birth date as `timestamptz` - introduces a midnight that shifts across zones
- Agent reports by day without filling gaps - days with no rows silently vanish from the series
- Agent uses `extract(epoch from interval)` on a month-bearing interval - months are assumed to be 30 days

## Related

- [data-types.md](data-types.md) · [temporal-and-history.md](temporal-and-history.md) · [constraints.md](constraints.md) · [aggregation.md](aggregation.md) · [partial-and-expression-indexes.md](partial-and-expression-indexes.md) · [query-optimisation.md](query-optimisation.md) · [functions-and-triggers.md](functions-and-triggers.md)
