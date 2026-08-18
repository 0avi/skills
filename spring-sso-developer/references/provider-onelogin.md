# OneLogin

**Verified against OneLogin developer documentation on 12/08/2026.** Spring identifiers are Spring
Security 7.1.0. See [providers.md](providers.md).

**A note on depth.** The OneLogin OIDC overview page read for this file is a conceptual overview and does
not state the discovery URL, the issuer format, or the claim names for groups and roles. **This file is
therefore short**, and the gaps are named rather than filled. The
[seven onboarding questions](providers.md) are the right tool here: the discovery document answers most
of what this file cannot.

## The flow list is a trap worth naming

OneLogin's overview documents these flows: **the Implicit Flow**, **the Authentication (or Basic)
Flow**, **the Resource Owner Password Grant**, and **the Client Credentials Grant**. A guide for
**Authorization Code with PKCE** also exists, so PKCE is supported.

**Two of those four are excluded by current normative practice**, and a provider documenting a flow is
not an endorsement of using it:

| Flow | Status |
| ---- | ------ |
| Implicit | RFC 9700: clients "SHOULD NOT use the implicit grant (response type `token`) or other response types issuing access tokens in the authorization response" |
| Resource Owner Password Grant | RFC 9700: it "MUST NOT be used. This grant type insecurely exposes the credentials of the resource owner to the client" |

**Use authorization code with PKCE.** OWASP's OAuth2 guidance is that clients "must use the Authorization
Code Grant with PKCE (`response_type=code`) for all client types, including SPAs and native
applications", and OneLogin documents that flow. See
[security-oauth2-oidc.md](security-oauth2-oidc.md).

**This generalises beyond OneLogin.** Several providers still document ROPC and implicit because they
have long-lived customers who use them. **A flow appearing in a provider's documentation says only that
it exists**, and an integration that reaches for ROPC because it is easier than a redirect has adopted a
grant type the current BCP forbids outright.

## What to establish, since the documentation read did not state it

Run these against the tenant, not against the documentation:

1. **Fetch the discovery document** and read `issuer`, `jwks_uri`, `scopes_supported`,
   `id_token_signing_alg_values_supported` and `grant_types_supported` from it. That single request
   replaces items 2, 3 and 4 of the seven questions.
2. **Configure the issuer verbatim from that document.** Do not reconstruct it from the URL you fetched.
   Two providers in this set, Google and the ForgeRock-lineage Ping products, have more than one plausible
   issuer string, and Auth0's ends in a slash.
3. **Decode a real token** and find where groups or roles actually are. Every provider in this set puts
   them somewhere Spring does not read by default, so **assume a converter is needed**.
4. **Check whether custom domains change the issuer**, which they do for several providers. If the
   customer uses one, the issuer in their tokens is the custom domain and your configuration must match.

## Not verified in this pass

- The OIDC **discovery document URL** format.
- The **issuer** format, and whether a custom domain changes it.
- **Group and role claim names**, and whether a scope must be requested for them.
- **SAML** support specifics: metadata, certificate rotation, single logout.
- **SCIM** support and deprovisioning semantics. See [scim-provisioning.md](scim-provisioning.md) for
  what to ask.
- **PKCE for confidential clients** specifically. Its availability is confirmed; whether it is accepted
  for a confidential client is not.
- **Subject identifier** stability and uniqueness scope. Until established, key on `(issuer, sub)`.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | The documented flow list, including Implicit and Resource Owner Password Grant, and that an Authorization Code with PKCE guide exists. OneLogin developer documentation, 12/08/2026 |
| Implicit and ROPC | Documented by the provider, **excluded by RFC 9700**. Availability is not endorsement |
| Everything else | **Not verified.** Use the discovery document and a decoded real token |

## Gotchas

- Agent picks the Resource Owner Password Grant because the provider documents it and it avoids a
  redirect. RFC 9700 says it MUST NOT be used
- Agent picks the implicit flow for a single-page application. Current practice is authorization code
  with PKCE for every client type
- Agent reconstructs the issuer from a documentation example rather than reading it from the discovery
  document
- Agent assumes a group claim exists and is readable by Spring's default converter
- Agent ignores a customer's custom domain, so the configured issuer never matches the tokens
- Agent fills in this file's unverified sections from memory rather than from a discovery document and a
  real token

## Related

- [providers.md](providers.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [spring-security-oidc.md](spring-security-oidc.md) · [scim-provisioning.md](scim-provisioning.md) · [checklist.md](checklist.md)
