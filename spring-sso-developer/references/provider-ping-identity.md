# Ping Identity

**Verified against Ping Identity documentation on 12/08/2026.** Spring identifiers are Spring Security
7.1.0. See [providers.md](providers.md).

## "Ping" is at least five products

**This is the first and most consequential thing to establish**, and it is not pedantry. Ping Identity and
ForgeRock merged, so the estate now spans two product lineages with different architectures, different
issuer formats and separate documentation sets. A customer saying "we use Ping" has told you almost
nothing.

| Product | Lineage | Shape |
| ------- | ------- | ----- |
| **PingFederate** | Ping | Self-hosted federation server. Long-established in large enterprises |
| **PingOne** | Ping | SaaS identity platform |
| **PingOne for Enterprise** | Ping | Earlier SaaS generation. Documented separately |
| **PingOne Advanced Identity Cloud** | ForgeRock | SaaS, ForgeRock AM lineage. Realm-based |
| **PingAM** | ForgeRock | Self-hosted AM. Same realm model as Advanced Identity Cloud |

**Ask which one, and ask for the discovery URL.** The discovery document settles issuer, endpoints and
supported algorithms in one request, and it works identically across all of them. That single question
replaces most of this file.

## Issuer formats, and a two-form hazard

**The discovery URI is the issuer plus the well-known path**, as the OIDC Discovery specification
requires: `<OpenID Provider's issuer value>/.well-known/openid-configuration`, and the URL "must start
with `https://`".

**For the ForgeRock lineage the issuer is realm-based and verbose.** A documented issuer value takes the
form:

```
https://<tenant-env-fqdn>/am/oauth2/realms/root/realms/alpha
```

Note `realms/root/realms/alpha`: realms nest, and the path reflects the nesting. Documentation also shows
a **shorthand** discovery path of the form `/am/oauth2/alpha/.well-known/openid-configuration`.

**So two forms exist for what is conceptually the same realm**, and this is the same class of hazard as
Google's two `iss` values:

- **Configure the issuer exactly as the tokens carry it**, which is the long form in the documented
  example, not the shorthand you may have used to fetch the discovery document.
- **Read `issuer` out of the discovery document and use that string verbatim.** Do not reconstruct it from
  the URL you fetched, because the shorthand and the canonical issuer differ.

Spring's `JwtIssuerValidator` compares strings, so a mismatch here rejects every valid token while both
strings look plausible. See [security-oauth2-oidc.md](security-oauth2-oidc.md).

**The realm is the tenant boundary** in the ForgeRock lineage, in the same way Keycloak's realm is. That
makes realm-per-customer the natural multi-tenant shape, with the same consequence: separate issuer,
separate keys, separate subject scope. See
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

## Working with a self-hosted deployment

**PingFederate and PingAM are customer-operated**, which puts them in the same category as Keycloak and
AD FS rather than with the SaaS providers:

- **The customer chooses the version**, so treat capability as a question rather than a constant, and
  expect a range of versions across your customer base.
- **The customer chooses the configuration**, including which claims are released, which is a per-customer
  negotiation rather than a product default.
- **Ask for a decoded sample token** from the actual deployment. It answers more questions than the
  documentation does, and it is the only way to learn what their configuration actually emits.
- **Network reachability is theirs**, so a discovery or JWKS fetch may cross a boundary you do not
  control. Consider what happens to your login path when it is slow, and see the startup-dependency
  discussion in [spring-security-saml.md](spring-security-saml.md), which applies to any
  fetch-at-startup pattern.

## SAML

PingFederate in particular is a federation server with deep SAML support, and in a large enterprise it is
frequently the SAML identity provider in front of everything else. **Treat SAML as a first-class
possibility here rather than a fallback**, and see [spring-security-saml.md](spring-security-saml.md) and
[security-saml.md](security-saml.md).

**Ping's SAML specifics were not verified in this pass**: metadata URL shapes, certificate rotation
behaviour and single logout support all differ per product and were not established.

## Not verified in this pass

Named precisely, and the list is longer than for the providers with a single product:

- **PingOne SaaS issuer format**, which is a different lineage from the ForgeRock realm paths above.
- **PingFederate issuer and endpoint shapes**, which are deployment-configured.
- **Where roles and groups arrive** in any Ping product, and under what claim names. Given every other
  provider in this set puts them somewhere Spring does not read by default, **assume a converter is
  needed** and confirm the claim from a real token.
- **PKCE support for confidential clients**, per product.
- **SCIM support** and its event semantics. See [scim-provisioning.md](scim-provisioning.md) for the
  protocol-level questions to ask.
- **Subject identifier** stability and uniqueness scope, per product. Until established, key on
  `(issuer, sub)`.
- Token lifetimes and refresh behaviour.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | That the discovery URI is the issuer plus the well-known path and must be `https`; the ForgeRock-lineage realm-based issuer form `https://<tenant-env-fqdn>/am/oauth2/realms/root/realms/alpha`; that a shorthand discovery path also exists. Ping Identity documentation, 12/08/2026 |
| Product identification | **The first question.** Five documented products, two lineages, different issuer formats |
| Issuer | **Take it verbatim from the discovery document**, not from the URL you fetched |
| Self-hosted products | Version and configuration are the customer's. Treat as questions |
| Everything under "Not verified" | Unverified. Do not fill in from memory |

## Gotchas

- Agent treats "Ping" as one product and applies guidance from the wrong lineage
- Agent reconstructs the issuer from the shorthand discovery path rather than reading `issuer` from the
  discovery document, and issuer validation rejects every valid token
- Agent assumes a realm path is flat. The ForgeRock lineage nests, as `realms/root/realms/alpha`
- Agent assumes roles will arrive in a claim Spring reads. No provider in this set does that by default
- Agent treats a self-hosted PingFederate or PingAM as a fixed version when the customer controls upgrades
- Agent designs an OIDC-only integration for an enterprise whose PingFederate deployment is the SAML
  identity provider for everything else
- Agent describes Ping's SAML behaviour from memory. None of it was verified here
- Agent puts a customer-network discovery fetch in the startup path

## Related

- [providers.md](providers.md) · [spring-security-oidc.md](spring-security-oidc.md) · [spring-security-saml.md](spring-security-saml.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [checklist.md](checklist.md)
