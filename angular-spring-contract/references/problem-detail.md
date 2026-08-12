# RFC 9457 ProblemDetail, End to End

`spring-boot-developer`'s `error-handling.md` owns the server side: `ProblemDetail`,
`@ExceptionHandler`, `ResponseEntityExceptionHandler`. **This page owns what the client actually
receives** - which is not one shape but two, and the second one is the one nobody handles.

Every body below was captured over real HTTP from a Spring Boot application, on 3.5.16 and 4.1.0.

## There are two error shapes, and only one is RFC 9457

A handler that returns a `ProblemDetail` produces what you expect, with
`Content-Type: application/problem+json`:

```json
{"type":"https://errors.example.com/duplicate-client",
 "title":"Duplicate client","status":422,
 "detail":"Client reference already exists","instance":"/problem",
 "clientRef":"R-1001","violations":["reference must be unique"]}
```

A **framework-generated** error, on a default application, produces this instead, with
`Content-Type: application/json`:

```json
{"timestamp":"2026-08-11T11:41:34.982+00:00","status":500,
 "error":"Internal Server Error","path":"/thrown"}
```

Different keys, different media type, no `type`, no `detail`. That is the default for a 404, a
400 and a 500 on both 3.5.16 and 4.1.0. **A client written only against `ProblemDetail` shows
"undefined" for every error it did not cause itself.**

## The opt-in does not cover the case you care about most

Setting `spring.mvc.problemdetails.enabled=true` converts the errors Spring's own exception
handling knows about:

```json
404  {"type":"about:blank","title":"Not Found","status":404,
      "detail":"No static resource nope.","instance":"/nope"}
400  {"type":"about:blank","title":"Bad Request","status":400,
      "detail":"Required parameter 'size' is not present.","instance":"/validated"}
400  {"type":"about:blank","title":"Bad Request","status":400,
      "detail":"Failed to convert 'size' with value: 'abc'","instance":"/validated"}
```

But an **unhandled exception still returns the legacy shape**, on both versions, with the flag on:

```json
500  {"timestamp":"2026-08-11T11:42:38.536+00:00","status":500,
      "error":"Internal Server Error","path":"/thrown"}     Content-Type: application/json
```

So the flag is necessary and not sufficient. A raw `IllegalStateException` escapes to the servlet
error dispatch, which is served by the error controller rather than by Spring MVC's exception
resolution, and that path is unchanged by the property. **The client must handle both shapes**, or
it must handle the legacy shape specifically for 500, which is the error it is least able to
predict and most needs to report.

## Two version differences that will bite a client

**`type` is absent on Boot 4.1.0 for framework problems.** Same request, same flag:

| Boot | 404 body |
| ---- | -------- |
| 3.5.16 | `{"type":"about:blank","title":"Not Found","status":404,"detail":"...","instance":"/nope"}` |
| 4.1.0 | `{"detail":"...","instance":"/nope","status":404,"title":"Not Found"}` |

A client that switches on `problem.type` gets the string `"about:blank"` on 3.5 and `undefined`
on 4.1. Handle both, and never treat `type` as guaranteed present.

**Key order and timestamp format differ.** Boot 4.1.0 emits keys alphabetically where 3.5.16 uses
declaration order, and the legacy `timestamp` is `2026-08-11T11:41:34.982+00:00` on 3.5.16 versus
`2026-08-11T11:42:09.099Z` on 4.1.0. Both parse as the same instant, but a string comparison or a
snapshot test over either does not survive the upgrade.

## What to agree, and what the client does

- **Give every business failure its own `type` URI** and switch on that, never on `detail`.
  `detail` is prose for a human, it changes freely, and it is often the wrong thing to show a user
  anyway. Note that the framework's own 404 detail above is `"No static resource nope."`, which
  leaks routing internals into a user-facing string.
- **Custom properties are flattened to the top level**, not nested under a `properties` object.
  `pd.setProperty("clientRef", ...)` appears as a sibling of `status`. So a client type is
  `ProblemDetail & { clientRef?: string }`, and any property name that collides with an RFC 9457
  field is a problem you have created for yourself.
- **Validation failures need a declared array shape.** RFC 9457 has no field for field-level
  errors, so this is a joint decision, not a standard. Agree one property name, agree whether the
  field path is dotted or bracketed, and declare it in the OpenAPI document. Do not let each
  handler invent its own.
- **In the Angular interceptor**, branch on the media type first: `application/problem+json` means
  the body is a problem, anything else means it is not, and `HttpErrorResponse.error` may be a
  parsed object, a string, or `null` for a network failure. All three reach the same handler.
- **Never show `detail` to a user for a 500.** It is either absent or a stack-trace-adjacent
  string. Show a generic message plus a correlation id the user can quote to support.

## Version notes

| Concern | 3.5.16 | 4.1.0 |
| ------- | ------ | ----- |
| Default framework error shape | `{timestamp,status,error,path}` as `application/json` | Same |
| `spring.mvc.problemdetails.enabled=true` on 4xx from Spring's own handling | `ProblemDetail`, `application/problem+json` | Same |
| Same flag, unhandled 500 | **Legacy shape**, `application/json` | **Legacy shape**, `application/json` |
| `type` on framework problems | `"about:blank"` | **Omitted** |
| Key order | Declaration order | Alphabetical |
| Legacy `timestamp` offset | `+00:00` | `Z` |

The flag name above is the Spring MVC one. A WebFlux application has its own property, and
`spring-boot-developer` owns which is which.

## Gotchas

- Agent types the client against `ProblemDetail` only - every framework-generated error then
  renders as "undefined". Handle the legacy shape too
- Agent sets `problemdetails.enabled=true` and assumes all errors are now RFC 9457 - unhandled
  500s are not, on either version
- Agent switches on `problem.type` - absent on Boot 4.1.0 for framework problems, and
  `"about:blank"` on 3.5.16. Switch on `status` plus your own `type` where you set one
- Agent switches on `detail` - it is prose, it is unstable, and for framework errors it leaks
  internals
- Agent expects custom properties under a `properties` key - they are flattened to the top level
- Agent names a custom property `status`, `type`, `title`, `detail` or `instance` - it collides
  with the RFC field
- Agent assumes `HttpErrorResponse.error` is always the parsed problem - it is a string for a
  non-JSON body and `null` for a network failure or a CORS rejection
- Agent treats a 0 status as a server error - status 0 in the browser means the request never
  completed: offline, CORS, or a cancelled request
- Agent shows `detail` for a 500 - generic message plus a trace id instead
- Agent invents a validation-errors shape per handler - agree one and declare it
- Agent writes a snapshot test over an error body - key order and the timestamp format both
  changed between 3.5 and 4.1

## Related

- [pagination.md](pagination.md) · [type-pipeline.md](type-pipeline.md)
