# The Type Pipeline: Postgres to Java to the Wire to TypeScript

`postgresql-developer`'s `application-integration.md` owns the left-hand end of this chain, the
column type to Java type mapping. `java-developer` owns `BigDecimal` semantics.
`typescript-developer` owns branded types. **This page owns the two hops neither of them can
see: Java to JSON, and JSON to TypeScript.** That is where the data is silently lost.

Every number on this page is program output, produced by running the case, not recalled.

## The rule

**A JSON number is an IEEE 754 double.** Anything that does not fit one must cross the wire as
a string. Two categories never fit:

- **Identifiers** above `9007199254740991`, which is `Number.MAX_SAFE_INTEGER`. A Java `long`
  goes to `9223372036854775807`, nineteen digits.
- **Money and any exact decimal**, because a double cannot represent `0.1`.

## What "silently" means

```
Number.MAX_SAFE_INTEGER            9007199254740991

JSON.parse('{"id":9007199254740993}')  ->  9007199254740992     round-trips: false
JSON.parse('{"id":1234567890123456789}') -> 1234567890123456800  round-trips: false
```

No exception, no warning, no `NaN`. A nineteen-digit id loses its last two digits and becomes a
different, valid-looking id. Two adjacent ids can collapse onto the same value, which is how
this reaches production as "the wrong record was updated" rather than as a parse error.

Money is worse, because the error is small enough to look like a rounding preference:

```
0.1 + 0.2                       0.30000000000000004
8.20 - 8.10                     0.09999999999999964
19.99 * 0.2        (VAT at 20%) 3.9979999999999998
0.01 summed 100 times           1.0000000000000007
1.13 * 100         (to pence)   112.99999999999999
6.90 + 6.90 + 6.90 + 12.35      33.050000000000004
Math.round(1.005 * 100) / 100   1        expected 1.01
(1.005).toFixed(2)              "1.00"   expected "1.01"
```

Note the fifth line. "Convert pounds to pence and use integers" is the standard advice, and
**doing that conversion in floating point is itself wrong**: `1.13 * 100` is `112.99999999999999`,
which `Math.trunc` turns into 112 pence. Convert by parsing the string, never by multiplying a
parsed number.

Note the last two lines especially. `toFixed(2)` is what almost every template reaches for to
display money, and it rounds `1.005` **down**. If an invoice total is computed one way in Java
and displayed another way in the browser, the two disagree by a penny and the reconciliation is
someone's afternoon.

## The default configuration is the broken one

This is not a misconfiguration to look out for. A Spring Boot application with no Jackson
customisation, verified on both 3.5.16 and 4.1.0 over real HTTP, serialises a record of
`Long id` and `BigDecimal amount` as:

```json
{"id":9007199254740993,"primitiveLong":1234567890123456789,"amount":10.50}
```

Both are **JSON numbers, by default, in both versions**. The server did nothing wrong by its own
lights; the corruption happens the instant the browser calls `JSON.parse` on that body. So the
fix belongs on the server, in the DTO and the Jackson configuration, and the client cannot repair
it after the fact - by then the digits are gone.

Note also that the server wrote `10.50`, with the scale intact. Scale survives serialisation and
dies on parsing, which is why this looks like a frontend bug in a backend developer's testing and
a backend bug in a frontend developer's.

## Scale is part of the value, and JSON drops it

```
new BigDecimal("10.50").scale()          2
new BigDecimal("10.5").scale()           1
new BigDecimal("10.50").equals(10.5)     false     <- scale participates in equals
new BigDecimal("10.50").compareTo(10.5)  0         <- compareTo does not

JSON.stringify(JSON.parse('{"a":10.50}'))   {"a":10.5}
```

So a value serialised as a JSON number loses its scale on the first round trip. `10.50` becomes
`10.5`, the trailing zero that means "pence, exactly" is gone, and a Java `equals` comparison
against the original now returns false. As a string, `"10.50"` survives unchanged.

While here, the other `BigDecimal` trap, which bites when a wire value is parsed as a double
first:

```
new BigDecimal(0.1)         0.1000000000000000055511151231257827021181583404541015625
BigDecimal.valueOf(0.1)     0.1
```

Never construct a `BigDecimal` from a `double`. If a value arrived as a JSON number, the damage
is already done before Java sees it.

## The mapping to apply

| Postgres | Java | On the wire | TypeScript | Why |
| -------- | ---- | ----------- | ---------- | --- |
| `bigint` | `Long` | **string** | `string` | Exceeds `Number.MAX_SAFE_INTEGER` |
| `integer`, `smallint` | `Integer`, `Short` | number | `number` | Fits a double exactly |
| `numeric`, `money` | `BigDecimal` | **string** | `string` | Exactness and scale |
| `double precision`, `real` | `Double`, `Float` | number | `number` | Already inexact by definition |
| `uuid` | `UUID` | string | `string` | Consider a branded type |
| `boolean` | `boolean` | boolean | `boolean` | |
| `text`, `varchar` | `String` | string | `string` | |
| `bytea` | `byte[]` | base64 string | `string` | Never a JSON array of numbers |
| enum or check-constrained `text` | enum | string | literal union | `typescript-developer` bans `enum`; use a union |
| `jsonb` | a record, or `JsonNode` | object | a declared type | Type it at the boundary or it spreads as `any` |
| `date`, `timestamptz` | see the dates page | | | [dates-and-times.md](dates-and-times.md) |

**Identifiers deserve a branded type**, not a bare `string`. Once every id is a `string`, a
`CustomerId` and an `InvoiceId` are mutually assignable and the compiler stops helping. See
`typescript-developer`'s branded types guidance for the mechanism.

## Parse once, at the boundary

A string on the wire is correct. A string threaded through the whole application is not: the
arithmetic has to happen somewhere, and if the type stays `string` the arithmetic happens in a
template with `+`, which concatenates.

- Map the generated DTO into a domain type at the edge, in the same place that handles the
  failure shape.
- For money, parse into a decimal library or into integer minor units. Do the parsing from the
  **string**, never from a number that has already been through a double.
- Keep the wire type and the domain type as separate declarations. The generated type is not
  your domain model, and treating it as one couples every component to the generator's output.

## Version notes

**Version-agnostic in the sense that matters.** `Number.MAX_SAFE_INTEGER` and IEEE 754 double
behaviour are properties of ECMAScript and will not change on any Angular or Spring Boot
upgrade. The verified outputs above were produced on Node 24 and JDK 25, and the same values
hold on every version either project supports.

What does change by version is the configuration that determines whether you get strings:

| Concern | Where it is decided |
| ------- | ------------------- |
| Whether `Long` and `BigDecimal` serialise as strings | Jackson configuration on the server. Jackson 3 in Boot 4, Jackson 2 in Boot 3.5; `spring-boot-developer` owns the difference |
| Whether the generated TS type is `string` or `number` | The OpenAPI generator's type mappings, plus whether the document declares `type: string` with `format: int64` |
| Whether `BigInt` is an option in the browser | ES2020 and later. It is exact for integers but has no decimal support, does not survive `JSON.stringify`, and mixes with `number` only by explicit conversion. Prefer `string` plus a branded type |

## Gotchas

- Agent maps `bigint` to `number` because the generator did - the generator followed the
  document, and the document is what needs fixing
- Agent maps `numeric` to `number` and calls the difference a rounding issue - it is a
  representation issue, and no amount of rounding fixes it
- Agent converts pounds to pence with `value * 100` - `1.13 * 100` is `112.99999999999999`.
  Parse the string
- Agent formats money with `toFixed(2)` - it rounds `1.005` to `1.00`. Format from an exact type
- Agent uses `parseFloat` on a `numeric` string, then does arithmetic - that is the same double,
  reached by a different route
- Agent constructs `new BigDecimal(someDouble)` on the server - use `valueOf`, or better, never
  let the value be a double
- Agent compares two `BigDecimal`s with `equals` and is surprised - scale participates. Use
  `compareTo`
- Agent types every id as `string` and stops - now `CustomerId` and `InvoiceId` are
  interchangeable. Brand them
- Agent sends `byte[]` as a JSON array of numbers - correct, enormous, and slow. Base64
- Agent keeps money as a `string` all the way into the template and adds with `+` - string
  concatenation, so `"10.50" + "5.00"` is `"10.505.00"`
- Agent reaches for `BigInt` for ids - no `JSON.stringify` support, no decimals, and it does not
  mix with `number`. A branded `string` is less trouble
- Agent trusts that a round trip proves correctness - a value that survives one round trip can
  still be a value that was already corrupted identically on both sides

## Related

- [dates-and-times.md](dates-and-times.md)
