# Optimistic Concurrency Across the Wire

`postgresql-developer` owns row versioning and isolation levels. `spring-boot-developer` owns
`@Version` and JPA's optimistic locking. **This page owns the HTTP half**: how a version reaches
the client, what the client must send back, and what it actually receives when it loses a race.

Captured over real HTTP from a Spring Boot application, on 3.5.16 and 4.1.0, which behaved
identically.

## The mechanism

The server publishes the current version as an `ETag` on the read, and requires it back as
`If-Match` on the write. If they disagree, someone else has written since the client read, and the
write is refused rather than silently overwriting.

```
GET /client            ->  200,  ETag: "1"       body {"name":"Acme","version":1}
PUT /client            ->  428   (no If-Match sent)
PUT If-Match: "99"     ->  412   (stale)
PUT If-Match: "1"      ->  200,  ETag: "2"       body {"name":"B","version":2}
```

The alternative is a `version` field in the request body, checked by the server. That works and is
easier to see in a payload, but it puts the concurrency token in the domain model, so every DTO
carries it and every client has to remember to round-trip it. The `ETag` route keeps it in the
transport where it belongs. Pick one per API, not per endpoint.

## Three things the client gets wrong

**The quotes are part of the value.** An `ETag` is `"1"`, with the quote characters. Measured: a
client sending `If-Match: 1` gets **412**, because it does not match `"1"`.

```
PUT If-Match: "1"   ->  200
PUT If-Match: 1     ->  412        same version, wrong syntax
```

So the client must echo the header value **verbatim**, never parse it, never trim it, never
`Number()` it. Treat it as an opaque token, which is exactly what it is. Anything that stores the
ETag in a typed model and re-serialises it will eventually drop the quotes.

**A 412 has an empty body.** Measured on both versions: status 412, no content type, nothing to
parse. So the client cannot show the user why, cannot show which field changed, and cannot show
who changed it. If you want any of that, the server has to return it deliberately, and then it is
your schema, not the framework's. See [problem-detail.md](problem-detail.md) for why a client that
assumes every error has a parseable body breaks here.

**412 is not retryable.** Retrying the same write with the same `If-Match` fails identically, and
retrying with a re-read ETag silently overwrites the other person's change, which is the exact
thing the mechanism existed to prevent. The only correct responses are to show the conflict, or to
merge deliberately.

## What to do on a conflict

- **Re-read, then show the difference.** The user needs to know what changed, not just that
  something did. That requires a fresh GET and a comparison in the UI.
- **Never auto-retry a write on 412.** Distinguish it from 409, from 428, and from 5xx in the
  interceptor, and let 412 through to the component that can ask the user.
- **Return 428 when the precondition is missing**, rather than accepting the write. A client that
  forgot `If-Match` is a client with a lost-update bug, and answering 200 hides it. Note that 428
  above is a deliberate choice in the handler, not a framework default.
- **Decide whether reads are cacheable.** The same `ETag` also drives `If-None-Match` and 304, so
  the header you added for concurrency changes caching behaviour too. That is usually welcome, and
  it is a decision rather than a side effect.

## Version notes

**Identical on Boot 3.5.16 and 4.1.0** for everything on this page: the `ETag` format, the 412 and
428 statuses, and the empty 412 body. The only difference observed anywhere in the responses was
JSON key order in the 200 body, which is the general Boot 4 ordering change described in
[pagination.md](pagination.md).

| Concern | Where it is decided |
| ------- | ------------------- |
| Whether the ETag is strong (`"1"`) or weak (`W/"1"`) | Whoever sets it. A weak ETag is not usable for `If-Match`, so set strong ones for concurrency |
| Whether `@Version` on an entity maps to the ETag | Your controller. JPA's optimistic locking and HTTP preconditions are separate mechanisms that you are choosing to connect; `spring-boot-developer` owns the JPA half |
| Whether a JPA `OptimisticLockException` becomes a 409 or a 412 | Your exception handling. They mean different things to a client: 412 is "your precondition failed", 409 is "the request conflicts with current state" |

## Gotchas

- Agent sends `If-Match: 1` without the quotes - 412, every time, measured
- Agent parses the ETag into a number or strips the quotes to store it in a model
- Agent expects a body on a 412 - it is empty, so there is nothing to display
- Agent retries a 412 automatically - either it fails identically or it overwrites the other
  person's change
- Agent re-reads and immediately re-submits with the new ETag - that is a silent lost update with
  extra steps
- Agent returns 200 when `If-Match` is absent, so a client with a lost-update bug looks healthy
- Agent uses a weak ETag (`W/"1"`) for `If-Match` - weak validators are for caching, not for
  preconditions
- Agent puts the version in the body for some endpoints and in the ETag for others - pick one per
  API
- Agent maps a JPA `OptimisticLockException` to 500 - it is a normal outcome of a race, not a fault
- Agent assumes 409 and 412 are interchangeable - a client should treat them differently

## Related

- [problem-detail.md](problem-detail.md) · [openapi-contract.md](openapi-contract.md) · [pagination.md](pagination.md)
