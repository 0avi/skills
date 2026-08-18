# Any other identity provider

**Written 12/08/2026.** Spring identifiers are Spring Security 7.1.0. See [providers.md](providers.md).

This file covers providers without a file of their own, and it is deliberately a **procedure** rather than
a set of guesses. Its content is the pattern learned from verifying twelve providers: what to establish,
in what order, and which surprises recur often enough to expect.

**Why a procedure beats a thin vendor page.** For several providers the public documentation is
overview-oriented, and a page of "not verified" entries per vendor would be padding. The procedure below
answers more, faster, than any vendor page could, because it derives the answers from the provider itself
rather than from its documentation.

## The procedure

**Two artefacts answer almost everything: the discovery document, and one real decoded token.**

### Step 1: fetch the discovery document

```bash
curl -s https://{issuer}/.well-known/openid-configuration | jq
```

Extract and record:

| Field | Why |
| ----- | --- |
| `issuer` | **Use this string verbatim.** Do not reconstruct it from the URL you fetched |
| `jwks_uri` | Confirms key location and that rotation is possible |
| `authorization_endpoint`, `token_endpoint` | For the rare case discovery is not usable |
| `scopes_supported` | Tells you what you may request |
| `grant_types_supported` | Confirms `authorization_code`; note anything alarming, see below |
| `id_token_signing_alg_values_supported` | Confirms `RS256` or better, and lets you pin |
| `code_challenge_methods_supported` | **Whether PKCE is supported, and with `S256`** |
| `end_session_endpoint` | **Whether RP-initiated logout is possible at all.** Absent means logout is local-only |
| `claims_supported` | A hint about identity and role claims, though often incomplete |

**If there is no discovery document**, you are configuring endpoints by hand, you lose
`end_session_endpoint`, and OIDC logout degrades silently. See
[spring-security-oidc.md](spring-security-oidc.md).

### Step 2: decode one real token from the real tenant

**A real token beats documentation**, because it shows what this deployment does rather than what the
product can do. Sign in against the customer's actual tenant and decode both the ID token and the access
token. Establish:

1. **The exact `iss` string.** Compare it character by character with the discovery document's `issuer`.
2. **Where roles and groups actually are.** Assume they are not where Spring looks. See below.
3. **Which claim is a stable identifier**, and whether it is unique beyond this tenant or realm.
4. **Whether `aud` is present** on the access token, and what it contains.
5. **Whether `amr`, `acr` or `auth_time` appear**, if you need to verify authentication strength for
   ASVS V6.8.4. See [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).
6. **The token's size**, with a realistic user. Large group lists break headers, not code.

### Step 3: apply the checklist

[checklist.md](checklist.md) rules 6 to 26 cover the client and resource server. Rules 57 to 64 cover
multi-tenant binding.

## Six surprises that recurred across twelve providers

**Expect these rather than discovering them.**

**1. Role information is almost never where Spring looks.** Spring builds authorities from the flat
`scope` claim. **One verified provider puts permissions there** and works natively; every other one
verified puts role information somewhere else: a different token, a nested object, a non-standard claim
name, a namespaced custom claim, or not in the token at all. **Assume you will write a converter**, and
see the comparison table in [providers.md](providers.md).

**2. The issuer string is rarely what you would have guessed.** Verified variations: a trailing slash
that must be present; two equally valid forms, one with a scheme and one without; a literal `{tenantid}`
template that never matches a token; a nested realm path; and a default that is deliberately not
Discovery-compliant. **Always take `issuer` from the discovery document verbatim.**

**3. Subject uniqueness scope varies, and it decides your primary key.** One provider's `sub` is globally
unique and immutable; another's is interpreted within a tenant so the same value means different people;
another's is realm-scoped. **`(issuer, sub)` is the shape that is correct everywhere**, so use it unless
the provider's documentation directs you elsewhere.

**4. "One product" is often several.** Verified cases: an org versus a custom authorization server; user
pools versus identity pools; five products under one brand across two merged lineages; a workforce
product and a customer-identity product with the same company name. **Establish the exact product before
anything else.**

**5. Things work until scale.** Group claims omitted entirely above a limit rather than truncated;
filtering that stops applying above a threshold; token size growing with a feature flag. **The user who
breaks it is the administrator at your largest customer**, because they are in the most groups. Test with
realistic data, not a test account.

**6. A documented feature is not a recommended feature.** Providers document the implicit grant and the
resource owner password credentials grant because they have long-lived customers using them. RFC 9700 says
implicit SHOULD NOT be used and ROPC MUST NOT be used. **Check `grant_types_supported` against current
practice, not against convenience.** See [security-oauth2-oidc.md](security-oauth2-oidc.md).

## Notes on specific providers

**Nothing below was verified against the vendor's documentation in this pass.** These are the questions
to ask, not answers.

### JumpCloud

A directory and device-management platform that also acts as an identity provider, common in
small-to-medium organisations, often replacing on-premises Active Directory. **The API documentation page
consulted was a navigation stub with nothing extractable**, so no facts are asserted.

Establish: whether the customer is using SAML or OIDC; the issuer format; where group membership appears;
and whether SCIM provisioning is offered, since JumpCloud's directory positioning makes provisioning a
likely requirement. See [scim-provisioning.md](scim-provisioning.md).

### Zitadel and authentik

Modern self-hostable identity providers, increasingly chosen instead of Keycloak for a lighter operational
footprint. Both are OIDC-first with SAML support.

Because they are **self-hosted, treat them as you would Keycloak**: the customer chooses the version and
the configuration, so capability is a question rather than a constant, and expect a range of versions
across your customer base. See [provider-keycloak.md](provider-keycloak.md), whose realm-per-customer
reasoning and version-in-the-field caution transfer directly.

Establish: the issuer and realm or organisation path shape; where roles arrive, which for OIDC-first
products is often a custom claim; and whether the deployment is reachable from your infrastructure at
startup rather than only at login.

### Anything else

Run the procedure. If the provider becomes load-bearing for your product, promote it to its own file
**with a real integration as the evidence**, not with its documentation. Every high-value finding in the
twelve vendor files came from a primary source that contradicted or completed the marketing description.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | Nothing vendor-specific in this file. The procedure and the six patterns are synthesised from the twelve verified vendor files in this skill |
| JumpCloud | **No facts asserted.** The documentation page consulted contained nothing extractable |
| Zitadel, authentik | **No facts asserted.** Treated by analogy with self-hosted Keycloak, which is a reasoning aid and not a verification |
| Discovery fields | Names are from OIDC Discovery 1.0 and are stable across providers |

## Gotchas

- Agent writes vendor guidance from memory because no file exists for that provider
- Agent reconstructs the issuer from the URL it fetched rather than reading `issuer` from the document
- Agent assumes roles will arrive in a claim Spring reads. Twelve of twelve providers do not do that
- Agent keys on `sub` alone without establishing its uniqueness scope
- Agent tests with an account in three groups and ships to a customer whose administrator is in three
  hundred
- Agent reads `grant_types_supported`, sees ROPC, and uses it
- Agent treats a self-hosted provider as a fixed version
- Agent skips the discovery document because the vendor's quickstart gave endpoint URLs to paste
- Agent concludes there is no `end_session_endpoint` problem because logout appears to work locally
- Agent promotes a provider to its own file on the strength of its documentation rather than an
  integration

## Related

- [providers.md](providers.md) · [provider-keycloak.md](provider-keycloak.md) · [spring-security-oidc.md](spring-security-oidc.md) · [scim-provisioning.md](scim-provisioning.md) · [checklist.md](checklist.md)
