# Seam Checklist

Use this for a review pass over an existing Angular and Spring Boot pair. Each rule links to the
reference that explains when it does not apply. Everything here concerns the boundary; for anything
inside one layer, the companion skills own it.

## The five that cause the most damage

These are the ones that fail silently, in production, with no exception anywhere.

| # | Failure | Symptom | Reference |
| - | ------- | ------- | --------- |
| 1 | `Long` or `BigDecimal` on the wire as a JSON number | An id ends in `00`; a total is out by a penny. No error, ever | [type-pipeline.md](type-pipeline.md) |
| 2 | A `LocalDate` parsed into a JavaScript `Date` | A date is one day earlier for users west of UTC, so a tax year boundary lands in the wrong year. Invisible to a UK or Nepal team | [dates-and-times.md](dates-and-times.md) |
| 3 | Each 401 starting its own token refresh | Users logged out at random. Measured: five parallel 401s, five refreshes, four rejected by a rotating server | [auth-flow.md](auth-flow.md) |
| 4 | A client typed only against `ProblemDetail` | Every framework-generated error renders as "undefined", because the default shape is not RFC 9457 | [problem-detail.md](problem-detail.md) |
| 5 | A route guard treated as protection | The endpoint is unprotected and looks fine | [auth-flow.md](auth-flow.md) |

## Contract

| # | Rule | Reference |
| - | ---- | --------- |
| 6 | The OpenAPI document is the source of truth. Generated code is never hand-edited | [openapi-contract.md](openapi-contract.md) |
| 7 | Fix wire types in the document, not with generator flags. `BigDecimal` and `double` are indistinguishable in the document, so no client-side mapping can separate them | [openapi-contract.md](openapi-contract.md) |
| 8 | Do not trust the generated client to match the server. Verified: the generated `ProblemDetail` expects `properties` as a nested map while the server flattens them | [openapi-contract.md](openapi-contract.md) |
| 9 | Declare requiredness on the server. Without it every generated property is optional and the compiler does nothing for you | [openapi-contract.md](openapi-contract.md) |
| 10 | Regenerate in CI and fail on a diff. Review the document diff, not the client diff | [openapi-contract.md](openapi-contract.md) |
| 11 | Keep generated wire types separate from domain types. Map once, at the boundary | [type-pipeline.md](type-pipeline.md) |

## Types and dates

| # | Rule | Reference |
| - | ---- | --------- |
| 12 | Identifiers and money cross as strings. Brand identifier types so `CustomerId` and `InvoiceId` are not interchangeable | [type-pipeline.md](type-pipeline.md) |
| 13 | Never convert money with arithmetic on a parsed number. `1.13 * 100` is `112.99999999999999` | [type-pipeline.md](type-pipeline.md) |
| 14 | Never format money with `toFixed`. It rounds `1.005` to `1.00` | [type-pipeline.md](type-pipeline.md) |
| 15 | A date-only value stays a string end to end. An instant is `Instant`, ISO 8601 with `Z` | [dates-and-times.md](dates-and-times.md) |
| 16 | Never put `LocalDateTime` on the wire. It means a different moment on every machine | [dates-and-times.md](dates-and-times.md) |
| 17 | Format instants with an explicit `timeZone`, which for UK tax dates is `Europe/London`, not the viewer's | [dates-and-times.md](dates-and-times.md) |
| 18 | Test date handling from a timezone west of UTC. London and Kathmandu both hide the bug | [dates-and-times.md](dates-and-times.md) |

## Errors

| # | Rule | Reference |
| - | ---- | --------- |
| 19 | Handle both error shapes. `problemdetails.enabled=true` does not cover unhandled 500s | [problem-detail.md](problem-detail.md) |
| 20 | Switch on `status` and your own `type`, never on `detail`. `type` is absent entirely on Boot 4.1.0 for framework problems | [problem-detail.md](problem-detail.md) |
| 21 | Give every business failure its own `type` URI, and never show `detail` to a user for a 500 | [problem-detail.md](problem-detail.md) |
| 22 | Agree one validation-errors shape and declare it. RFC 9457 has no field for it | [problem-detail.md](problem-detail.md) |
| 23 | Status 0 is a network failure, not an auth failure | [auth-flow.md](auth-flow.md) |
| 24 | Never snapshot-test a response body. Key order and timestamp format both changed between Boot 3.5 and 4.1 | [pagination.md](pagination.md) |

## Auth

| # | Rule | Reference |
| - | ---- | --------- |
| 25 | One shared in-flight refresh, **reset when it settles**. Sharing without resetting caches the stale token forever | [auth-flow.md](auth-flow.md) |
| 26 | Prove the reset with two waves of requests. One wave cannot detect the missing reset | [auth-flow.md](auth-flow.md) |
| 27 | Retry once, then surface. Never refresh on a failed refresh, never retry a 403 | [auth-flow.md](auth-flow.md) |
| 28 | Only replay idempotent requests after a refresh | [auth-flow.md](auth-flow.md) |
| 29 | Decide token storage against SSR. The server cannot read `localStorage`, so the first render is logged out | [auth-flow.md](auth-flow.md) |
| 30 | Never trust a decoded JWT claim client-side. Decoding is not verifying | [auth-flow.md](auth-flow.md) |
| 31 | An e2e `storageState` has no expiry for `localStorage` entries, so a long suite starts tests with a dead token | [auth-flow.md](auth-flow.md) |

## Pagination, concurrency, uploads, tracing

| # | Rule | Reference |
| - | ---- | --------- |
| 32 | Return `PagedModel<T>`, not `Page<T>`. The default envelope publishes Spring Data's internals | [pagination.md](pagination.md) |
| 33 | Prefer an explicit return type over a property. `serialization-mode=VIA_DTO` is silently ignored on Boot 4 without `spring-boot-data-commons` | [pagination.md](pagination.md) |
| 34 | After a Boot 4 upgrade, a `spring.*` property that stopped working is probably in a module you no longer depend on. Binding is silent | [pagination.md](pagination.md) |
| 35 | Echo an `ETag` verbatim, quotes included. `If-Match: 1` fails against `"1"` | [concurrency.md](concurrency.md) |
| 36 | Never auto-retry a 412, and expect no body on one | [concurrency.md](concurrency.md) |
| 37 | Publish the upload limit. A 413 has an empty body and cannot tell the client which limit was hit | [uploads.md](uploads.md) |
| 38 | Keep the proxy's body limit above the application's, so your 413 wins rather than the proxy's HTML | [uploads.md](uploads.md) |
| 39 | Start the trace in the browser, or the frontend half is outside it forever | [tracing.md](tracing.md) |
| 40 | Return the trace id in the error payload. No response header carries it by default | [tracing.md](tracing.md) |

## Version notes

Every rule above holds on Angular 19 to 21 and Spring Boot 3.5.x to 4.1.x, with these exceptions,
all measured rather than assumed:

| Rule | Version dependence |
| ---- | ------------------ |
| 20 | `type` is `"about:blank"` on Boot 3.5.16 and **omitted** on 4.1.0 |
| 24 | Key order is declaration order on 3.5.16 and alphabetical on 4.1.0; the legacy `timestamp` is `+00:00` then `Z` |
| 33 | Works on 3.5.16; needs `spring-boot-data-commons` on 4.1.0 |
| 39, 40 | Propagation verified on Boot 3.5.16. **Not working in the equivalent 4.1.0 setup and the cause is unresolved** - see [tracing.md](tracing.md) |

Everything in the type and date rules is a property of ECMAScript and `java.time`, not of either
framework, so those do not move with a version at all.

## Gotchas

- Agent reviews with this list without establishing both versions first - four rules above are
  version-dependent and the findings will be wrong
- Agent treats every rule as a defect - each links to the reference that says when it does not apply
- Agent applies a rule that belongs to a companion skill. If a claim is true with only one side of
  the wire in view, it is not in this skill's scope
- Agent reports a rule as passing because one test passes. Rules 26 and 18 exist specifically
  because the obvious test cannot detect the failure
- Agent fixes a symptom on the client when the document is wrong - rules 7 and 8

## Related

- [openapi-contract.md](openapi-contract.md) · [type-pipeline.md](type-pipeline.md) · [dates-and-times.md](dates-and-times.md) · [problem-detail.md](problem-detail.md) · [auth-flow.md](auth-flow.md) · [pagination.md](pagination.md) · [concurrency.md](concurrency.md) · [uploads.md](uploads.md) · [tracing.md](tracing.md)
