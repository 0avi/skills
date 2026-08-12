# One Trace, From Click to SQL

`spring-boot-developer`'s `observability.md` owns Micrometer, Actuator and the server's tracing
configuration. `postgresql-developer` owns `pg_stat_statements` and `application_name`. **This page
owns the two ends nobody else does**: whether the browser starts the trace, and whether the id ever
becomes visible to a human.

## The header

W3C Trace Context defines one header, and this is its shape:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             ^^ ^                              ^ ^              ^ ^^
             |  32 hex trace id                  16 hex span id   flags
             version
```

Measured on Boot 3.5.16 with `spring-boot-starter-actuator`,
`micrometer-tracing-bridge-brave` and `management.tracing.sampling.probability=1.0`:

| Request | Server's trace id |
| ------- | ----------------- |
| No inbound header | `6a7b1249cbc0c5368aeb62959d6b286b` - newly generated |
| `traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-...` | `4bf92f3577b34da6a3ce929d0e0e4736` - **inbound id continued** |

So the propagation works: send a `traceparent` and the server adopts your trace id, creating a
child span rather than a new trace. The span id differs, which is correct - the server's work is a
child of the browser's request.

That is the whole mechanism, and it means **the browser is where a full trace has to start.** If
the client sends nothing, the server generates a trace id, and the frontend half of the request -
the click, the render, the time spent waiting - is outside it forever. An interceptor that generates
a `traceparent` per request is a few lines and it is the only way to get a trace that spans both
halves.

## The id is invisible to the client

Measured, both versions: **no response header carries the trace id.** Nothing named `traceparent`,
`b3`, or `x-request-id` comes back.

So by default the id exists in the server's logs and nowhere the user or the frontend can reach it.
That defeats the main day-to-day use: a user reports a failure, and nobody can connect their report
to a log line.

Two ways to fix it, and they are both contract decisions:

- **Return the id in the error body**, as a property of your problem payload. This is the option
  worth taking, because the moment you need the id is the moment something failed, and
  [problem-detail.md](problem-detail.md) already says custom properties are flattened to the top
  level of a `ProblemDetail`.
- **Return it in a response header** on every response, which is simpler but means the frontend has
  to read headers it otherwise ignores, and it leaks the id into every successful response too.

Then show it to the user on the error screen. A support ticket quoting a trace id is worth more
than a screenshot.

## Reaching the database

The trace does not reach Postgres by itself. Spring's tracing covers the application; the database
sees a connection, not a span. To connect a slow query back to a request:

- Set `application_name` on the connection so `pg_stat_activity` shows which service is running the
  query. `postgresql-developer` owns the column and the pooling implications.
- Tag the span with the statement identity rather than the statement text. Query text in a span is
  a data-leak risk and it defeats aggregation; `pg_stat_statements` already normalises statements
  and is the right tool for the query side.
- Accept the seam: you get "this request took 800ms in the repository layer" from the application
  and "this normalised statement is slow" from Postgres, and you join them by hand. Full
  span-to-statement correlation needs deliberate instrumentation and is rarely worth it.

## Version notes

**Verified on Boot 3.5.16.** With `spring-boot-starter-actuator`,
`micrometer-tracing-bridge-brave` and `management.tracing.sampling.probability=1.0`, inbound W3C
`traceparent` is honoured and the trace id appears in the MDC as `traceId`.

**Not working in the equivalent Boot 4.1.0 setup, and the cause is unresolved.** With the same
dependencies and the same property, the MDC held no `traceId`, with or without an inbound header.
Two plausible causes were tested and **both eliminated**:

| Hypothesis | Result |
| ---------- | ------ |
| The Boot 4 module split means the auto-configuration is missing, as it is for the pagination property in [pagination.md](pagination.md). Added `spring-boot-micrometer-tracing`, which declares every `management.tracing.*` property including `propagation.type` | No change. MDC still empty |
| The wrong bridge. `spring-boot-developer`'s `observability.md` recommends `micrometer-tracing-bridge-otel`, not `-brave`. Swapped it | No change. MDC still empty |

So the missing piece is something else again: an additional module, a change in how log correlation
is enabled, or a configuration key that moved.

Do not carry the 3.5 recipe to a Boot 4 project and assume it works. **Verify against your own
application**: send a known `traceparent` and check that the id appears in a log line, exactly as
the table above does. `spring-boot-developer` owns the configuration, and this is a gap to raise
with it rather than to solve here.

The header format itself is a W3C specification and does not change with either framework.

## Gotchas

- Agent assumes the trace starts at the server - then the browser half of every request is
  permanently outside the trace
- Agent generates a new trace id per request in the Angular interceptor **and** on retry, so a
  retried request looks like an unrelated trace. Keep the id for the logical operation
- Agent expects the trace id in a response header - nothing returns it by default, measured
- Agent puts the trace id only in the logs and then asks users for screenshots
- Agent copies a working Boot 3.5 tracing setup to Boot 4 and assumes parity - it did not work here,
  and the cause is unresolved
- Agent believes adding a dependency is enough - sampling probability defaults below 1.0 in most
  configurations, so most traces are never recorded
- Agent leaves sampling at 1.0 in production because it worked in development
- Agent puts SQL text or personal data in a span tag - use `pg_stat_statements` for statements and
  keep identifiers out of tags
- Agent expects the trace to appear in Postgres - it does not. Use `application_name` and join by
  hand
- Agent uses B3 headers on one side and W3C on the other - both exist, and a mismatch produces two
  unconnected traces rather than an error

## Related

- [problem-detail.md](problem-detail.md) · [auth-flow.md](auth-flow.md)
