---
name: angular-spring-contract
description: Owns the contract between an Angular frontend and a Spring Boot backend, and nothing inside either. Trigger when an identifier or a money value loses precision in the browser, when a date shifts by a day between server and client, when an OpenAPI document or a generated client is involved, when RFC 9457 ProblemDetail must be consumed by Angular, when JWT storage, HTTP interceptors, silent refresh, route guards or a 401 mid-request are in play, when pagination, optimistic concurrency or file upload crosses the wire, when a trace id must survive from click to SQL, or when a Playwright storageState token expires mid-suite. Install angular-developer, spring-boot-developer, java-developer, typescript-developer, postgresql-developer and ngrx-signal-store-developer alongside it; this skill defers everything inside a single layer to them.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# Angular and Spring Boot: the Contract Between Them

This skill owns **the seam** between an Angular client and a Spring Boot server, and only the
seam. Full-stack defects concentrate there because no single-technology skill can see both
sides of a wire format at once.

## What this skill does not own

| Ask about | Use instead |
| --------- | ----------- |
| Components, signals, forms, routing, DI, SSR, ARIA, Tailwind, Angular testing | the official `angular-developer` skill |
| Controllers, `ProblemDetail` on the server, Spring Security, JPA, Actuator | `spring-boot-developer` |
| Records, sealed types, `Optional`, `BigDecimal` semantics | `java-developer` |
| tsconfig, strictness, branded types, discriminated unions | `typescript-developer` |
| Column types, keys, constraints, indexes | `postgresql-developer` |
| SignalStore shape, `rxMethod`, entity collections | `ngrx-signal-store-developer` |
| Writing or running e2e tests, browser driving | Microsoft's `playwright-cli` skill |

1. **Establish both halves before giving guidance.** The Angular major, the Spring Boot major,
   the OpenAPI generator and its configuration, and the database types in play. Advice correct
   for Angular 21 and Boot 4 is wrong on Angular 17 and Boot 3.5.

2. **This skill owns only what neither side owns alone.** The test: a claim belongs here only
   if it is false, absent, or misleading when either side is read on its own. Never restate a
   companion; name it and its file, as in "spring-boot-developer's `error-handling.md`". If a
   companion is not installed, say which one is missing and what is therefore unverified, then
   answer the seam question anyway under a stated assumption. **Do not fill the gap by
   reproducing its content.**

3. **The OpenAPI document is the source of truth and generated code is never hand-edited.**
   A hand-edit survives until the next generation and then vanishes, usually in someone else's
   branch. Change the server, regenerate, commit the generated output or generate in CI, but
   never patch it.

4. **Every identifier and every money value crosses the wire as a string.** A JSON number is
   an IEEE 754 double. It silently corrupts any integer above 9 007 199 254 740 991 and cannot
   represent `0.1`. This is not a style preference; the corrupted values are in
   [type-pipeline.md](references/type-pipeline.md) with the exact outputs.

5. **A date-only value is not an instant, and an instant is not a local time.** `LocalDate`
   must not become a JavaScript `Date`. See [dates-and-times.md](references/dates-and-times.md).

6. **The server is the sole authority on authorisation.** A route guard is a UX affordance that
   stops a user seeing a broken page. It protects nothing, and anyone can skip it.

7. **After changing anything on the seam, regenerate the client and typecheck both halves.**
   The contract is only proven by a clean compile on both sides, not by either alone.

Every reference carries a **`## Version notes`** section stating what differs across Angular
19 to 21 and Spring Boot 3.5 to 4.x, and a **`## Gotchas`** list of the specific mistakes
agents make in that area. Read the gotchas even when skimming. Where a claim is executable it
has been executed: the numbers and timezone results in the references are program output, not
recollection.

## Determining the versions and configuration

**Step 1.** Server: `pom.xml` or `build.gradle.kts` for the `spring-boot-starter-parent` or
plugin version, and the Java release. Client: `package.json` for `@angular/core`.

**Step 2.** Find the contract. Look for a committed `openapi.json` or `openapi.yaml`, a
`springdoc` dependency, or an `openapi-generator` invocation in `package.json` scripts or the
build. If there is no document, say so plainly: without one, the contract is whatever the two
sides currently happen to agree on, and every claim below is an assumption.

**Step 3.** Find the generator and its config. The generated client's shape, its date handling
and its enum handling all follow generator options, and those options are where most seam
defects are configured in rather than coded in.

**Step 4.** Identify the database types behind the endpoint. `bigint`, `numeric`, `timestamptz`
and `uuid` each have a wire decision attached, and the column type is where the chain starts.

## Adding an Endpoint, End to End, In Order

| # | Step | Watch for |
| - | ---- | --------- |
| 1 | Decide the wire types before writing the DTO | `bigint` and `numeric` become strings. [type-pipeline.md](references/type-pipeline.md) |
| 2 | Write the server DTO and endpoint | `spring-boot-developer` owns this |
| 3 | Decide the failure shape | RFC 9457, one `type` URI per failure mode |
| 4 | Regenerate the OpenAPI document, then the client | Never hand-edit the output |
| 5 | Typecheck the client against the regenerated types | A red compile here is the contract working |
| 6 | Map the response at the boundary, once | Parse strings into domain types at the edge, not in templates |
| 7 | Handle the failure shape, not just the happy path | An unhandled `ProblemDetail` reaches the user as "undefined" |

## Topics

- **The OpenAPI document and the generated client**: what springdoc actually emits, what the
  generator makes of it, and the three places the generated client contradicts the server that
  produced it. Read [openapi-contract.md](references/openapi-contract.md)
- **Type pipeline**: Postgres to Java to the wire to TypeScript, for every type where the naive
  mapping silently loses data: `bigint`, `numeric`, `uuid`, `bytea`, enums. Read
  [type-pipeline.md](references/type-pipeline.md)
- **Dates and times**: `timestamptz` versus `date`, `Instant` versus `LocalDate`, ISO 8601 on
  the wire, and why a `Date` in the browser is the wrong type for a date. Read
  [dates-and-times.md](references/dates-and-times.md)
- **ProblemDetail**: the two error shapes a Spring application actually emits, why the RFC 9457
  opt-in does not cover unhandled 500s, and what the Angular interceptor must branch on. Read
  [problem-detail.md](references/problem-detail.md)
- **Pagination**: what a `Page<T>` puts on the wire, why the default envelope publishes Spring
  Data's internals, and the one property that works on Boot 3.5 and silently does nothing on
  Boot 4. Read [pagination.md](references/pagination.md)
- **Auth end to end**: where the token lives and what that costs under SSR, the measured refresh
  stampede and the trap in its usual fix, 401 mid-request, why a guard protects nothing, and what
  a `storageState` token does to an e2e suite. Read [auth-flow.md](references/auth-flow.md)
- **Optimistic concurrency**: `ETag` and `If-Match`, why the quotes matter, and what a 412 does
  and does not tell the client. Read [concurrency.md](references/concurrency.md)
- **File upload**: what a rejected upload actually returns, why the limit has to be published, and
  where the proxy's limit beats yours. Read [uploads.md](references/uploads.md)
- **Tracing**: the `traceparent` header, why the trace has to start in the browser, and why the id
  is invisible to the client unless you return it. Read [tracing.md](references/tracing.md)
- **Checklist**: all 40 seam rules in one scannable list, with the five that cause the most damage
  first. Use this for a review pass. Read [checklist.md](references/checklist.md)

## Symptom index

| Symptom | Read |
| ------- | ---- |
| An id ends in `00` that should not, or two records collide | [type-pipeline.md](references/type-pipeline.md) |
| A total is out by `0.01`, or by `0.000000000000004` | [type-pipeline.md](references/type-pipeline.md) |
| `10.50` displays as `10.5` | [type-pipeline.md](references/type-pipeline.md) |
| A date is one day earlier for some users and not others | [dates-and-times.md](references/dates-and-times.md) |
| A date is correct in the UK and Nepal but wrong in the US | [dates-and-times.md](references/dates-and-times.md) |
| `toFixed(2)` rounds `1.005` down to `1.00` | [type-pipeline.md](references/type-pipeline.md) |
| An error renders as "undefined" in the UI | [problem-detail.md](references/problem-detail.md) |
| `problem.type` is `undefined` after a Boot upgrade | [problem-detail.md](references/problem-detail.md) |
| A 500 is not shaped like the other errors | [problem-detail.md](references/problem-detail.md) |
| `pageable`, `paged` or `unpaged` appear in the generated client | [pagination.md](references/pagination.md) |
| A snapshot test of a response body fails after a Boot upgrade | [pagination.md](references/pagination.md) · [problem-detail.md](references/problem-detail.md) |
| A `spring.*` property stopped working after upgrading to Boot 4 | [pagination.md](references/pagination.md) |
| `problem.properties.x` is `undefined` but `problem.x` will not compile | [openapi-contract.md](references/openapi-contract.md) |
| Every field in the generated client is optional | [openapi-contract.md](references/openapi-contract.md) |
| `--type-mappings` appears to do nothing | [openapi-contract.md](references/openapi-contract.md) |
| Users are logged out at random, or one refresh succeeds and the rest fail | [auth-flow.md](references/auth-flow.md) |
| Every request 401s and nothing tries to refresh | [auth-flow.md](references/auth-flow.md) |
| The first render is logged out and flips after hydration | [auth-flow.md](references/auth-flow.md) |
| An e2e test passes alone and fails eighth in the suite | [auth-flow.md](references/auth-flow.md) |
| A page hangs on a 403 | [auth-flow.md](references/auth-flow.md) |
| A write silently overwrote someone else's change | [concurrency.md](references/concurrency.md) |
| `If-Match` always returns 412 | [concurrency.md](references/concurrency.md) |
| A 412 or 413 arrives with nothing to display | [concurrency.md](references/concurrency.md) · [uploads.md](references/uploads.md) |
| An upload fails and the interceptor cannot parse the response | [uploads.md](references/uploads.md) |
| A user reports a failure and nothing links it to a log line | [tracing.md](references/tracing.md) |

## Checklist

- **Seam checklist**: all 40 rules in one list, the five most damaging first, each linked to its
  reference. Use it for a review pass over an existing pair. Read
  [checklist.md](references/checklist.md)
