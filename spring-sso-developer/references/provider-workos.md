# WorkOS

**Verified against WorkOS documentation on 12/08/2026.** Spring identifiers are Spring Security 7.1.0.
See [providers.md](providers.md).

**A note on depth.** Two WorkOS documentation pages were read and both were overview level: the SSO page
describes SDK method calls rather than HTTP endpoints, and the Directory Sync page describes the product
rather than its event schema. So the API specifics below are thin and the gaps are named precisely. The
**architectural** content, which is the part that decides whether you use WorkOS at all, is the more
useful half anyway.

## It inverts the problem

Every other provider in this set is one identity provider you integrate with. WorkOS is a **layer that
integrates with many on your behalf**, so the shape of the work changes rather than the amount of protocol
knowledge required.

| | Direct integration | Via WorkOS |
| --- | ------------------ | ---------- |
| Protocols you implement | OIDC **and** SAML, because you do not choose your customers' providers | One integration with WorkOS |
| Per-customer configuration | Yours to store, administer and support | Theirs |
| Certificate expiry per customer | Your alerting problem | Theirs |
| Debugging a customer's misconfigured IdP | Your support burden | Largely theirs |
| Cost | Engineering time, indefinitely | Per connection, plus a dependency in your auth path |

**The honest trade** is the one in [providers.md](providers.md): if SSO is a feature you sell, the
per-customer operational surface dominates the protocol work, and that surface is exactly what this kind
of vendor removes. If SSO is one corporate integration for your own staff, it is overkill.

**The cost to weigh is not the licence.** It is that your authentication path now depends on a third party
you do not operate, which is a real availability and blast-radius consideration, and that migrating away
later means building the per-customer layer you avoided building now.

## Selecting the customer's identity provider

Three parameters, verified, and which one you use is an architectural choice:

| Parameter | Use |
| --------- | --- |
| `organization` | "Use the `organization` parameter when authenticating a user by their specific organization" |
| `connection` | Selects a specific SAML or OIDC connection |
| `provider` | For OAuth connections. Verified values include `GoogleOAuth`, `MicrosoftOAuth`, `GitHubOAuth`, `AppleOAuth` |

Organization identifiers are prefixed, in the form `org_...`.

**Prefer `organization`.** It is the tenant-shaped identifier, it survives a customer changing which
identity provider they use, and it means your home-realm discovery resolves to an organisation rather
than to a connection. See [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

## The one security instruction WorkOS gives you, and it is the important one

The returned profile carries `organizationId`, and WorkOS's own guidance is:

> "Validate that this profile belongs to the organization used for authentication"

**Do not skip this.** It is the tenant-confusion defence, stated by the vendor: you initiated
authentication for organisation A, and you must confirm the profile that came back belongs to
organisation A rather than trusting the round trip. Without it, a broker that normalises many customers
becomes a single place where one customer's authentication could be accepted as another's.

This is the same rule as every other provider's tenant binding, and it is easier to overlook here because
the broker feels like it has already handled tenancy for you.

## Normalised and raw attributes

WorkOS describes the profile as containing "normalized and raw attributes" from the upstream provider.

**That normalisation is the product**, and it is also the thing to understand precisely:

- **Normalised attributes** are why one integration serves many providers. They are also a lowest common
  denominator, so anything provider-specific may only exist in the raw attributes.
- **Raw attributes are where per-customer surprises live.** If you build authorisation on a raw attribute,
  you have reintroduced the per-provider variability you were paying to avoid, one customer at a time.
- **So decide deliberately which side you depend on.** Depending only on normalised attributes keeps the
  benefit; reaching into raw attributes for one important customer is how the abstraction erodes.

## The Spring integration question

**This is the significant unverified item, and it changes the code.** The documentation read describes
SDK calls, `getAuthorizationUrl()` and `getProfileAndToken()`, returning a `Profile`. It does **not**
state whether WorkOS issues standard OIDC ID tokens with a JWKS endpoint.

**Why that matters:** if WorkOS is a standard OIDC provider, you use Spring Security's `oauth2Login()`
with an `issuer-uri` and everything in [spring-security-oidc.md](spring-security-oidc.md) applies
unchanged. If the flow is an SDK call returning a proprietary profile, **none of Spring's OAuth2 client
machinery is involved**, and you are writing a callback endpoint that exchanges a code via their SDK and
then establishes the session yourself.

**That second shape has consequences worth stating**, because it is the case where Spring stops helping:

- **You own `state` validation.** Spring's filter is not in the path, so the CSRF protection it provides
  for free is now yours to implement. See [security-oauth2-oidc.md](security-oauth2-oidc.md).
- **You own session establishment**, including changing the session identifier at the privilege change.
  See [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).
- **You own the tenant binding**, which is the `organizationId` check above.

**Establish which shape applies before writing anything.** Check whether WorkOS publishes a discovery
document and a JWKS; if it does, prefer the standard Spring path.

## Not verified in this pass

- **Whether WorkOS issues standard OIDC ID tokens**, and whether a discovery document and JWKS exist.
  This is the most consequential gap because it decides the integration shape.
- The **HTTP authorization endpoint URL**, as opposed to the SDK method.
- The **full `Profile` field list**. Only `organizationId` was confirmed.
- **Directory Sync event names and payloads**, including whether deprovisioning arrives as a delete event
  or as an update setting an active flag to false. **This is the field that decides what your endpoint
  must implement**, so read their API reference rather than guessing.
- The **SCIM version** implemented.
- Any statement about **event ordering, replay or eventual consistency** for webhooks, which matters
  because a provisioning webhook you process out of order can resurrect a deprovisioned user.
- **Whether SAML and OIDC upstream differences leak** into normalised attributes.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | The `organization`, `connection` and `provider` selection parameters and sample `provider` values; the `org_` identifier prefix; `organizationId` on the profile and the instruction to validate it; that profiles carry normalised and raw attributes. WorkOS documentation, 12/08/2026 |
| Integration shape | **Unverified whether standard OIDC applies.** Establish this first |
| SCIM | Directory Sync is described as implementing SCIM; **the version and event schema were not verified**. Protocol-level material is in [scim-provisioning.md](scim-provisioning.md) |
| Dependency | A third party in your authentication path. Weigh availability and blast radius, not only licence cost |

## Gotchas

- Agent assumes Spring's `oauth2Login()` applies without establishing whether WorkOS is a standard OIDC
  provider, and writes configuration for a flow that is an SDK call
- Agent writes a hand-rolled callback and omits `state` validation, because Spring's filter used to do it
- Agent skips the `organizationId` check, on the assumption that the broker has handled tenancy
- Agent selects the customer by `connection` rather than `organization`, so the binding breaks when the
  customer changes identity provider
- Agent builds authorisation on raw attributes for one important customer, reintroducing the
  per-provider variability the vendor was removing
- Agent guesses the Directory Sync deprovisioning event shape. Whether it is a delete or an active flag
  decides the implementation
- Agent processes provisioning webhooks without considering ordering, and a late event resurrects a
  deprovisioned user
- Agent presents a broker as removing the need to understand the protocols. It removes the need to
  *implement* them; the failure modes still reach you through it

## Related

- [providers.md](providers.md) · [scim-provisioning.md](scim-provisioning.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [spring-security-oidc.md](spring-security-oidc.md) · [checklist.md](checklist.md)
