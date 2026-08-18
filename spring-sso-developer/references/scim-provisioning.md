# SCIM Provisioning

**Verified against RFC 7644 on 12/08/2026.** SCIM is defined by three RFCs: **RFC 7642** (definitions and
requirements), **RFC 7643** (core schema), and **RFC 7644**, "System for Cross-domain Identity Management:
Protocol", September 2015.

This file covers **implementing a SCIM endpoint in your product** so customers' identity providers can
provision into it. That is the direction that matters for B2B SaaS: you are the service provider, and the
customer's IdP is the SCIM client.

## First: do you need SCIM at all

**Just-in-time provisioning** creates the user on first successful login from the assertion or token. It
is a few lines, needs no endpoint, and covers most products.

**SCIM** is a protocol implementation: HTTP endpoints, a schema, filtering, pagination, and a security
boundary you now expose. Choose it when:

- **Deprovisioning must be prompt.** JIT can create users; it cannot remove them, because a removed user
  simply stops logging in and your record stays active. If the customer's requirement is "access ends
  within minutes of offboarding", JIT does not meet it. This is the reason that actually forces SCIM.
- **The customer wants to manage membership centrally**, seeing users in your product appear and
  disappear from their directory without anyone logging in.
- **Procurement asks for it**, which for enterprise deals is common and is a real reason.

**Otherwise start with JIT plus a deprovisioning story**, and see
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md), which covers what deprovisioning
must actually do beyond deleting a row.

## The endpoints

RFC 7644 defines these paths:

| Path | Purpose |
| ---- | ------- |
| `/Users` | User resource management |
| `/Groups` | Group resource management |
| `/ServiceProviderConfig` | What your implementation supports |
| `/Schemas` | Schema definitions |
| `/ResourceTypes` | Resource type discovery |
| `/Me` | Alias for the authenticated subject |
| `/Bulk` | Bulk operations |
| `[prefix]/.search` | POST-based query |

**Implement the discovery three even if you implement nothing else optional.**
`/ServiceProviderConfig`, `/Schemas` and `/ResourceTypes` are how a client discovers what you support, and
some clients probe them before doing anything. Advertising honestly there is cheaper than being asked why
a `PATCH` failed.

**The required media type is `application/scim+json`.** Not `application/json`. A client that sends the
SCIM media type and receives a response typed as plain JSON may reject it, and this is an easy thing to
get wrong in a framework that defaults to `application/json`.

## The deprovisioning ambiguity, which is the most important thing here

**RFC 7644 defines `DELETE` as the deprovisioning mechanism** and nothing more: "DELETE Deletes a
resource."

**It does not make setting an attribute the normative way to deactivate.** The `active` boolean lives in
the core schema (RFC 7643) as an indication of administrative status, but **the protocol RFC contains no
requirement that deactivation happen by setting `active` to false.** That pattern is convention, not
specification.

**And in practice, clients overwhelmingly deprovision by `PATCH`ing `active` to `false` rather than by
`DELETE`**, because directories generally suspend rather than destroy. So:

> **Your SCIM endpoint must handle both, and treat both as "access ends now".**

Concretely:

- **`PATCH` setting `active` to `false`** must terminate access: sessions ended, tokens revoked or
  short-lived enough to be an accepted risk. See
  [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).
- **`DELETE`** must do the same, and should be a soft delete in your storage so the audit record survives.
- **Treating `active: false` as merely a profile update is the classic SCIM implementation bug.** The
  customer's directory reports the user as deprovisioned, your product still has a live session, and
  nobody notices until an access review. This is the single defect a customer's security review is most
  likely to find.
- **`active` returning to `true` is a reprovisioning event**, which needs a decision rather than a
  surprise.

**When integrating with any specific provider, establish which of the two it sends.** That is why the
per-provider files list it as a question rather than assuming.

## Filtering and pagination

**Filtering** uses a `filter` query parameter with its own expression language, for example
`filter=userName eq "bjensen"`.

**Implement at least `userName eq`.** Clients use it to check whether a user already exists before
creating one, so an endpoint that ignores `filter` and returns everything will cause duplicate creates or
a client that gives up.

**Pagination is 1-based and does not use the names you expect:**

| Parameter | Meaning |
| --------- | ------- |
| `startIndex` | **1-based** index, default `1` |
| `count` | Maximum results per page. The RFC specifies no default limit |

And the response carries `totalResults`, `itemsPerPage` and `startIndex`. The specification notes that
pagination behaviour "are derived from the OpenSearch Protocol".

**`startIndex` being 1-based is an off-by-one waiting to happen** if you map it onto a zero-based offset,
and the symptom is one user silently skipped per page rather than an error.

## PATCH semantics

Three operations: **`add`**, **`remove`**, **`replace`**. The RFC's wording is that the `op` member "MAY
be one of 'add', 'remove', or 'replace'".

Two implementation notes that cause real bugs:

- **`add` on a single-valued attribute replaces it**, rather than failing. Treating `add` as
  create-only produces wrong results.
- **`replace` on a non-existent path behaves as an add.** So `replace` is not a guarantee that something
  was already there.

Both mean you cannot infer intent from the operation name alone; apply the semantics the spec defines.

## Concurrency, which SCIM actually specifies

**ETags are part of the protocol**, and this is unusually well specified for a provisioning API:

- Responses carry an `ETag`, for example `ETag: W/"e180ee84f0671b1"`.
- Resources carry the same value as `meta.version`.
- **`PUT` and `PATCH` support `If-Match`** for optimistic locking, for example
  `If-Match: W/"a330bc54f0671c9"`.

**Implement it.** A directory sync that retries, or two administrators acting at once, is exactly the
lost-update scenario `If-Match` exists to prevent. If you have `angular-spring-contract` installed, its
optimistic concurrency material covers the same mechanism on the application's own API.

## Multi-tenant SCIM: the credential is the tenant

**The bearer token the customer's directory presents is the only thing identifying which tenant is being
provisioned.** There is no user session and no interactive login, so every rule from
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) applies in a stricter form:

- **One credential per customer connection**, never a shared token, so a leaked credential is bounded to
  one tenant.
- **The tenant is derived from the credential, never from the payload.** An `externalId` or a
  tenant-looking field in the request body is attacker-controlled input in this context.
- **Scope the credential to SCIM only.** It should not be a general API token, because it lives in a
  third-party system's configuration indefinitely.
- **Rotation must be possible without downtime**, since the customer's administrator has to change it on
  their side. Support two valid credentials during a rotation window.
- **Log every operation with the tenant and the credential used.** Provisioning changes who has access,
  which is exactly what an audit will ask about.

## Implementing it in Spring

**Spring provides no SCIM support**, so these are ordinary `@RestController` endpoints. Three specifics:

**The error format conflicts with this repo's default.** `spring-boot-developer`'s rule is that errors are
RFC 9457 `ProblemDetail`. **SCIM defines its own error response shape**, and a SCIM client will not
understand `ProblemDetail`. So a SCIM controller is a deliberate, documented exception to the
project-wide error convention. Isolate it rather than weakening the global rule.

**Content type must be `application/scim+json`**, which means setting it explicitly on the
`@RequestMapping` produces and consumes values rather than relying on defaults.

**Authentication is a separate filter chain.** SCIM is bearer-token, machine-to-machine, stateless, and
has no login page or session. That is a different `SecurityFilterChain` with its own matcher, which
`spring-boot-developer`'s multiple-chains material covers. Do not let SCIM traffic inherit the browser
chain's CSRF and session behaviour.

## Not verified in this pass

- **RFC 7643's exact attribute list** for the `User` and `Group` resources, including the precise
  definition of `active` and the required versus optional attributes. Read RFC 7643 before defining your
  schema.
- **RFC 7642's** requirements text.
- The exact **SCIM error response schema** and its status code mappings.
- Whether any specific provider sends `DELETE` or `PATCH active: false`. Per-provider, and listed as a
  question in each vendor file.
- **`/Bulk` and `.search` semantics** in detail, both of which are commonly not implemented.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Specifications | **RFC 7642**, **RFC 7643**, **RFC 7644**. The protocol RFC is September 2015 and SCIM 2.0 has been stable since |
| Verified here | Endpoint paths, media type, `DELETE` as the defined deprovisioning method, PATCH operation names, `filter`, `startIndex` and `count`, response fields, ETag and `If-Match`. RFC 7644 |
| `active` | In the **core schema**, RFC 7643. **Not** made the normative deactivation mechanism by RFC 7644. Handle both it and `DELETE` |
| Spring | No SCIM support. Hand-written controllers, own filter chain, own error format |

## Gotchas

- Agent implements SCIM when just-in-time provisioning plus a deprovisioning story would do
- Agent treats `PATCH` setting `active` to `false` as a profile update, so a deprovisioned user keeps a
  live session and valid tokens
- Agent implements only `DELETE` because that is what the RFC defines, and misses how clients actually
  deprovision
- Agent maps `startIndex` onto a zero-based offset and silently skips one user per page
- Agent ignores the `filter` parameter, causing duplicate creates
- Agent returns `application/json` rather than `application/scim+json`
- Agent returns RFC 9457 `ProblemDetail` from a SCIM endpoint, which the client cannot interpret
- Agent treats `add` as create-only, when `add` replaces a single-valued attribute
- Agent assumes `replace` implies the value existed. On a non-existent path it behaves as an add
- Agent skips ETag and `If-Match`, then loses updates when a sync retries
- Agent shares one bearer token across customers, so a leak is unbounded
- Agent derives the tenant from the request body rather than from the credential
- Agent puts SCIM endpoints in the browser filter chain and inherits CSRF and session handling
- Agent provides no way to rotate a customer's SCIM credential without downtime

## Related

- [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [providers.md](providers.md) · [provider-workos.md](provider-workos.md) · [checklist.md](checklist.md)
