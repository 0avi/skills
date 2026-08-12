# File Upload Across the Wire

`spring-boot-developer` owns multipart configuration and `MultipartFile`. The official
`angular-developer` skill owns `HttpClient` and its progress events. **This page owns what the
client sees when a limit is hit**, which is less than you would expect, and the two places where
the limits disagree with the UI.

Captured over real HTTP from a Spring Boot application with
`spring.servlet.multipart.max-file-size=64KB` and `max-request-size=128KB`, on 3.5.16 and 4.1.0.

## What actually comes back

```
POST /upload  1KB file    ->  200  application/json  {"name":"small.bin","contentType":"application/octet-stream","size":1000}
POST /upload  200KB file  ->  413  (no content type, empty body)
```

**A rejected upload has an empty body**, on both versions. The client gets a status code and
nothing else: no limit, no actual size, no field name, no indication of which of the two limits was
exceeded. `max-file-size` and `max-request-size` produce the same 413 with the same empty body, so
the client cannot tell "this file is too big" from "these files together are too big" - which are
different messages to show a user.

So if the UI needs to say anything useful, the numbers have to come from somewhere other than the
error. That means either the client knows the limit independently, or the server publishes it.

## The limits must be stated three times, and they will drift

The same number lives in at least three places, and nothing keeps them in step:

| Where | What it does |
| ----- | ------------ |
| `spring.servlet.multipart.max-file-size` | Rejects with 413 and an empty body |
| The reverse proxy or ingress | Rejects before Spring sees it, with **its own** error page, usually HTML |
| The client's own pre-flight check | The only one that can produce a good message |

The proxy row is the one that bites. If nginx's `client_max_body_size` is lower than Spring's
limit, the client gets nginx's HTML error rather than a 413 from your application, and the
interceptor tries to parse HTML as JSON. That failure looks nothing like an upload problem in the
logs.

**Check the size client-side before uploading.** Not as validation - it is trivially bypassed - but
because it is the only place that can say "that file is 4.2 MB and the limit is 2 MB" before the
user waits for a failed upload. Then treat the server's 413 as the backstop it is.

## The contract details worth agreeing

- **Publish the limit.** Put the maximum size in the OpenAPI document, or in a small configuration
  endpoint the client reads at startup. A hard-coded number in the frontend drifts the first time
  the server's is changed.
- **`contentType` is client-supplied and untrusted.** Measured above: a random binary file arrived
  as `application/octet-stream` because that is what curl said. The browser will say whatever the
  OS told it. Validate the content server-side if it matters, and never branch on it for security.
- **Decide where large files go.** Streaming a large upload through the application server occupies
  a request thread for the duration. A pre-signed URL directly to object storage does not, and it
  changes the contract: the client asks your API for a URL, uploads elsewhere, then tells your API
  it finished. That is three round trips and a different failure model, and it is the right answer
  above some size.
- **Progress needs an explicit request.** Angular reports upload progress only when asked for
  events rather than a body; the mechanism is `angular-developer`'s. The seam decision is whether
  the UI needs progress at all, because a small upload with a spinner is simpler than a progress
  bar with three states.
- **Filenames are attacker-controlled.** Never use the client's filename as a path. That is a
  server-side rule, but it belongs in the contract discussion because the client is where the name
  comes from.

## Version notes

**Identical on Boot 3.5.16 and 4.1.0**: the 200 shape, the 413 status, and the empty 413 body. The
only difference observed was JSON key order in the success body, which is the general Boot 4
ordering change described in [pagination.md](pagination.md).

| Concern | Where it is decided |
| ------- | ------------------- |
| Whether the 413 carries a body at all | Nothing in this configuration produced one. Add an exception handler for `MaxUploadSizeExceededException` if the client needs detail; `spring-boot-developer` owns the mechanism |
| Whether the proxy rejects first | Infrastructure, not either framework. Keep the proxy limit above the application limit so your error wins |
| Whether uploads go through the application at all | An architecture decision, not a framework one |

## Gotchas

- Agent parses the 413 body to show the user a limit - it is empty
- Agent distinguishes "file too large" from "request too large" in the UI - the responses are
  identical, so it cannot
- Agent sets Spring's limit and forgets the proxy - the client then receives the proxy's HTML and
  the interceptor fails parsing it
- Agent hard-codes the limit in the frontend - it drifts the first time the server's changes
- Agent relies on a client-side size check as the enforcement
- Agent trusts the uploaded `contentType` for a security or routing decision - it is whatever the
  client said
- Agent uses the client-supplied filename as a storage path
- Agent streams a very large file through the application because that is the simple code - it
  holds a request thread for the whole transfer
- Agent sets `Content-Type` manually on a multipart request - the boundary parameter must be
  generated, so setting the header by hand breaks the request
- Agent expects an upload to appear in a request log with its size when it was rejected before the
  handler ran

## Related

- [problem-detail.md](problem-detail.md) · [concurrency.md](concurrency.md) · [openapi-contract.md](openapi-contract.md)
