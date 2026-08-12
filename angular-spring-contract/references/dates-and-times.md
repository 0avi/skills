# Dates and Times Across the Wire

`postgresql-developer`'s `dates-and-times.md` owns the column decision, `timestamptz` versus
`timestamp` versus `date`. `java-developer` owns `java.time` as a language matter. **This page
owns what each Java time type actually serialises to, and what the browser does with that
string** - which is where a correct column and a correct Java type still produce the wrong day
on someone's screen.

Every output below is program output from JDK 25 and Node 24, not recollection.

## The rule

There are **three different kinds of value** here, and collapsing them is the entire problem:

| Kind | Means | Java | Wire | TypeScript |
| ---- | ----- | ---- | ---- | ---------- |
| An instant | A moment in time, the same moment everywhere | `Instant` | ISO 8601 with `Z` | `Date` |
| A local date | A calendar day with no time and no zone: an invoice date, a year end, a tax year start | `LocalDate` | `"2026-04-06"` | **`string`**, never `Date` |
| A wall-clock time | 09:30 in whatever zone the reader is in: opening hours, a reminder | `LocalTime` | `"09:30"` | **`string`** |

A `Date` in JavaScript is an instant. It is a count of milliseconds. It has **no** date-only
mode and no wall-clock mode, so using it for the second or third kind means inventing a
timezone, and the invented one will be wrong for someone.

## What actually goes on the wire, and what the browser does with it

**Jackson does not use `toString()`, and the difference matters.** Both columns below were
captured from a running Spring Boot application over real HTTP, on 3.5.16 and 4.1.0, which
produced byte-identical output for every row.

| Java type | Jackson sends | `toString()` would send | `new Date(Jackson value)` |
| --------- | ------------- | ----------------------- | ------------------------- |
| `Instant` | `2026-04-06T00:00:00Z` | `2026-04-06T00:00:00Z` | correct |
| `OffsetDateTime` | `2026-04-06T01:00:00+01:00` | `2026-04-06T01:00+01:00` | correct, same instant |
| `ZonedDateTime` | `2026-04-06T01:00:00+01:00` | `2026-04-06T01:00+01:00[Europe/London]` | correct - **Jackson drops the zone id** |
| `LocalDate` | `2026-04-06` | `2026-04-06` | `2026-04-06T00:00:00.000Z`, parsed as **UTC** |
| `LocalDateTime` | `2026-04-06T00:00:00` | `2026-04-06T00:00` | parsed as **local** time, so machine-dependent |
| `LocalTime` | `09:30:00` | `09:30` | **`Invalid Date`** |
| `Duration` | `PT1H30M` | `PT1H30M` | **`Invalid Date`** |

Five things to take from that table:

- **`ZonedDateTime` survives Jackson but not `toString()`.** Jackson emits an offset and drops
  the `[Europe/London]` suffix, so the browser parses it. `toString()` keeps the suffix, which
  is a Java extension rather than ISO 8601, and the browser returns `Invalid Date` for it. So the
  danger is not the type, it is any path that stringifies by hand: a log line, a concatenated
  URL, a custom serialiser, a `String.valueOf`. **The zone id is lost either way**, so if the
  reader needs to know the zone, send it as its own field.
- **Jackson always writes seconds; `toString()` omits them when zero.** Client-side string
  comparison or regex over a timestamp must tolerate both `T00:00` and `T00:00:00`, because the
  two representations of the same moment appear in different places in the same system.
- **`LocalDate` and `LocalDateTime` are parsed under different rules.** A bare date is UTC; a
  date with a time and no offset is local. So the same `LocalDateTime` string becomes a different
  instant on every machine, which is why it produces bugs that reproduce on one laptop only.
- **`LocalTime` and `Duration` are not `Date` values at all.** Both are `Invalid Date`. Keep them
  as strings and parse them yourself.
- **Nanoseconds are lost.** An `Instant` carrying `2026-04-06T00:00:00.123456789Z` arrives in the
  browser as `2026-04-06T00:00:00.123Z`. A `timestamptz(6)` column and a JS `Date` do not have
  the same precision, so do not round-trip a timestamp through the browser and write it back
  expecting equality.

## The date-only shift

This is the one that reaches users. The server sends a `LocalDate` of `2026-04-06`, the first
day of UK tax year 2026/27. The client does `new Date('2026-04-06')`, which is the instant
`2026-04-06T00:00:00Z`. Rendered as a date:

```
Europe/London         06/04/2026
UTC                   06/04/2026
Asia/Kathmandu        06/04/2026
America/New_York      05/04/2026   <- previous tax year
America/Los_Angeles   05/04/2026   <- previous tax year
Pacific/Honolulu      05/04/2026   <- previous tax year
```

**A tax year boundary moves into the wrong tax year for every viewer west of UTC.** Any
date-only value that sits on a boundary behaves the same way: a year end, a filing deadline, a
period start.

Note which rows are correct. A team in London and an offshore team in Kathmandu are both at or
east of UTC, so **the defect is invisible to everyone building it** and appears only for a user
further west. That is the worst possible distribution of a bug.

It also travels back. Sending the value to the server:

```
instant.toISOString().slice(0, 10)              2026-04-06   survives, because it is UTC
built from local parts in America/New_York      2026-04-05   sends the wrong day back
```

So an application that reads the date correctly by accident can still write it back wrong,
depending on which of those two the code happens to use.

## What to do

- **Keep a date-only value as a `string` end to end.** `"2026-04-06"` in the DTO, `string` in
  TypeScript, formatted for display by splitting the string or with `Intl.DateTimeFormat` on
  parts you construct explicitly. Never hand it to `new Date`.
- **Use `Instant` for anything that is a real moment** - created, updated, submitted, logged.
  Serialise with `Z`. The browser handles it correctly with no ceremony.
- **Never put `LocalDateTime` on the wire.** It carries no offset, so it means a different moment
  on every machine that reads it. `ZonedDateTime` is safe through Jackson but arrives without its
  zone id, so where the zone is part of the meaning, send an `Instant` plus an explicit zone
  field.
- Format instants for display with `Intl.DateTimeFormat` and an **explicit** `timeZone`. For a
  UK accountancy application that zone is `Europe/London`, not the viewer's, because
  `05/04/2026` and `06/04/2026` are different tax years regardless of where the reader is
  sitting.
- Use UK format for display, `en-GB` and `DD/MM/YYYY`, and ISO 8601 on the wire. They are
  different jobs.
- If your browser targets support the Temporal API, `Temporal.PlainDate` is the correct type for
  a date-only value and removes this whole class of defect. Check your targets before relying on
  it; until then, a `string` is the safe representation.

## Version notes

**The browser behaviour is version-agnostic.** `Date` parsing rules and millisecond precision
are ECMAScript properties and do not change with an Angular upgrade. The Java `toString()`
formats above have been stable across every release `java.time` has existed in, Java 8 onward,
and were confirmed on JDK 25.

What changes by version is the configuration deciding which type reaches the wire at all:

| Concern | Where it is decided |
| ------- | ------------------- |
| Whether an `Instant` serialises as ISO 8601 or as an epoch number | ISO 8601 with `Z` is the **verified default** on both Boot 3.5.16 and 4.1.0, with no configuration. It becomes an epoch number only if `WRITE_DATES_AS_TIMESTAMPS` is switched on; `spring-boot-developer` owns Jackson configuration |
| Whether the generated TypeScript type is `Date` or `string` | The generator. **Measured: `typescript-angular` 7.24.0 maps both `format: date` and `format: date-time` to `string`**, which is the correct mapping, and it has no date option in `config-help`. Do not assume this of another generator or another version: one that maps `format: date` to `Date` reintroduces the shift above, so check the emitted types after any generator upgrade |
| Whether the document can even distinguish an instant from a local date-time | It cannot. springdoc emits `string/date-time` for `Instant`, `LocalDateTime`, `OffsetDateTime` **and** `ZonedDateTime` alike, so the generated client cannot tell which it received. See [openapi-contract.md](openapi-contract.md) |
| Whether `Temporal` is available | Browser support, not framework version. Check your targets |

## Gotchas

- Agent maps `LocalDate` to `Date` in TypeScript because the generator did - that is the shift
  above. Override the generator's `format: date` mapping to `string`
- Agent tests the date handling in London or Kathmandu and concludes it is correct - both are at
  or east of UTC. Test with an explicit `America/New_York` formatter
- Agent puts `LocalDateTime` on the wire - no offset, so the same string is a different instant
  per machine
- Agent believes `ZonedDateTime` cannot go on the wire - through Jackson it is fine, and the
  zone id is silently dropped. The failure is any hand-rolled `toString()` path, where the
  `[Europe/London]` suffix makes the browser return `Invalid Date`
- Agent relies on the zone id surviving a `ZonedDateTime` round trip - it does not. Send the zone
  as its own field
- Agent formats an instant with `toLocaleDateString()` and no `timeZone` - that renders in the
  viewer's zone, which for a UK tax date is the wrong question
- Agent regexes or string-compares an ISO timestamp and misses that seconds are omitted when zero
- Agent round-trips a `timestamptz` through the browser and writes it back - milliseconds only,
  so the microseconds are silently dropped
- Agent builds a date string from `getFullYear()`, `getMonth()` and `getDate()` - those are local
  parts, so the wrong day goes back to the server
- Agent uses `getMonth()` without adding 1 - it is zero-based, and this is still the most common
  date bug in JavaScript
- Agent stores a date-only value as `timestamptz` on the server to "keep it simple" - now it has
  a time and a zone it never had, and `postgresql-developer` has the column guidance
- Agent adds a day to compensate for the shift - that fixes one timezone and breaks the rest.
  Do not send an instant for a date

## Related

- [type-pipeline.md](type-pipeline.md)
