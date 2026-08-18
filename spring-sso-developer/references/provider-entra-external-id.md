# Azure AD B2C and Microsoft Entra External ID

**Verified against Microsoft's Azure AD B2C documentation on 12/08/2026.** Spring identifiers are Spring
Security 7.1.0. See [providers.md](providers.md).

**This is customer identity, not workforce SSO.** It is for *your* end users signing up to your product,
not for an enterprise customer federating their staff. Workforce Entra ID is a different product with
different rules, in [provider-entra-id.md](provider-entra-id.md). Confusing them is common and wastes
days.

**Product status, quoted:** "Effective May 1, 2025, Azure AD B2C will no longer be available to purchase
for new customers." So **B2C is closed to new customers and Entra External ID is the successor**, while a
great many B2C tenants remain in production. **The facts below are verified for B2C**; External ID
specifics were **not verified in this pass** and must not be assumed identical.

## The policy is part of the URL, and that is the whole architecture

B2C's organising concept is the **user flow** or **custom policy**, and it appears in the endpoint paths:

```
https://<tenant-name>.b2clogin.com/<tenant-name>.onmicrosoft.com/<policy-name>/oauth2/v2.0/authorize
https://<tenant-name>.b2clogin.com/<tenant-name>.onmicrosoft.com/<policy-name>/oauth2/v2.0/token
```

**There is a separate metadata document per policy**, for example:

```
https://contoso.b2clogin.com/contoso.onmicrosoft.com/b2c_1_signupsignin1/v2.0/.well-known/openid-configuration
```

and a per-policy key set at `.../discovery/v2.0/keys`.

**Nothing else in this set works this way.** Sign-up, sign-in, password reset and profile editing are
separate policies with separate endpoints, so "the login URL" is not one URL. Which policy ran is
carried in the token by the **`tfp`** claim, holding the policy name such as `b2c_1_signupsignin1`. The
`acr` claim is "only provided for backward-compatibility" and is "Used only with older policies".

## The default issuer is not OIDC Discovery compliant

**This is the finding that breaks a standard Spring configuration**, and Microsoft states it as a
compatibility setting rather than as a warning.

The issuer has two possible forms, and it is configurable:

| Setting | Issuer value |
| ------- | ------------ |
| **Default** | `https://<domain>/{B2C tenant GUID}/v2.0/` |
| Compatibility option | `https://<domain>/tfp/{B2C tenant GUID}/{Policy ID}/v2.0/` |

And the operative sentence:

> "If your application or library needs Azure AD B2C to be compliant with the OpenID Connect Discovery
> 1.0 spec, use this value."

**Read what that implies.** The default issuer does **not** include the policy, while the discovery
document **is** per policy. So under the default, the issuer and the location of its metadata do not
correspond in the way OIDC Discovery requires, and a library that derives metadata from the issuer, or
validates that the issuer matches its discovery source, is working against a provider that is
deliberately non-compliant by default.

**Spring resolves metadata from the issuer.** So the sane configuration is:

1. **Switch the tenant to the compliant issuer form**, the one including `/tfp/` and the policy, which is
   what Microsoft's own sentence directs you to do for a spec-compliant library. This is a tenant
   setting, so it is a conversation with whoever administers B2C, not a code change.
2. **Or configure the policy's discovery URL explicitly** and accept that you are pinning per policy.

**Either way, one Spring `ClientRegistration` corresponds to one policy**, not to the tenant. Sign-in and
password reset are two registrations if you route to both.

Note the issuer also **ends with a slash** in both forms, which is the same exact-match hazard as Auth0's.
See [security-oauth2-oidc.md](security-oauth2-oidc.md).

## Identity, and it is clean

> "**Subject** `sub` ... This value is immutable and can't be reassigned or reused. It can be used to
> perform authorization checks safely... By default, the subject claim is populated with the object ID of
> the user in the directory."

**So `sub` is safe to key on here**, unlike workforce Entra ID where Microsoft directs you to `oid` and
the tenant. There is a compatibility setting whose other value is "Not supported", provided only for
backward compatibility, and Microsoft recommends switching to **ObjectID** as soon as possible. **If a
tenant is on the legacy setting, fix that before designing your user model.**

`aud` is the application ID, and `azp` carries "the **application ID** of the client application that
initiated the request".

## `auth_time` is weaker than it looks

B2C emits `auth_time`, but with a caveat that matters if you were planning to use it for step-up or
recentness:

> "There's no discrimination between that authentication being a fresh sign-in, a single sign-on (SSO)
> session, or another sign-in type. The `auth_time` is the last time the application (or user) initiated
> an authentication attempt against Azure AD B2C. The method used to authenticate isn't differentiated."

**So `auth_time` here tells you when an authentication attempt happened, not that credentials were freshly
entered, and it says nothing about the method.** If you need genuine re-authentication for a sensitive
action, that is a policy design problem in B2C rather than a claim you can read. This weakens what ASVS
5.0 V6.8.4 and V7.5.1 can be satisfied with; see
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

## Token lifetimes are configurable, with one fixed exception

| Setting | Default | Range |
| ------- | ------- | ----- |
| Access and ID token lifetime | 60 minutes | 5 to 1,440 minutes |
| Refresh token lifetime | 14 days | 1 to 90 days |
| Refresh token sliding window | 90 days | 1 to 365 days, or no expiry |

**The exception:** "Single-page applications using the authorization code flow with PKCE always have a
refresh token lifetime of 24 hours." That is not configurable, and it is the correct behaviour given the
token is in a browser. See the token-storage discussion in
[security-oauth2-oidc.md](security-oauth2-oidc.md), which argues for a backend-for-frontend precisely so
this question does not arise.

**These settings are not available for password reset user flows.**

## Keys and identity provider pass-through

**Key rotation:** check for updated public keys every 24 hours, and "to handle unexpected key changes,
your application should be written to re-retrieve the public keys if it receives an unexpected `kid`
value". Spring caches JWKS, so confirm your cache honours an unknown `kid` by refreshing rather than
failing.

**Upstream token pass-through is narrow.** B2C can pass an upstream identity provider's access token
through as a claim, but "currently only supports passing the access token of OAuth 2.0 identity
providers, which include Facebook and Google. For all other identity providers, the claim is returned
blank." **A blank claim rather than an error** is the failure mode to design against.

## Not verified in this pass

- **Microsoft Entra External ID specifics.** Issuer format, endpoint shapes, whether the policy-in-URL
  model carries over, and how it differs from B2C. **This is the biggest gap**, and it matters because
  External ID is the product for new work.
- Whether External ID has the same issuer compatibility setting.
- Group and role claims, and whether custom attributes reach tokens by default.
- SCIM support. See [scim-provisioning.md](scim-provisioning.md).
- PKCE for confidential clients.
- Custom domain effects on the issuer.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | Endpoint and metadata URL shapes with the policy in the path, both issuer forms and the compliance statement, `tfp` versus `acr`, `sub` immutability and the ObjectID setting, `auth_time`'s caveat, token lifetime defaults and ranges, the 24-hour SPA refresh token, key rotation guidance, pass-through limits. Azure AD B2C documentation, 12/08/2026 |
| Product status | **B2C closed to new customers from 1 May 2025.** Entra External ID is the successor |
| Default issuer | **Not OIDC Discovery compliant.** Switch to the `/tfp/` form for a compliant library |
| `sub` | Immutable, not reassigned or reused. Safe to key on, unlike workforce Entra ID |
| `acr` | Backward compatibility only. `tfp` is current |
| External ID | **Not verified.** Do not assume parity with B2C |

## Gotchas

- Agent confuses this with workforce Entra ID and applies the `(tid, oid)` keying rule, or the multi-tenant
  issuer template, neither of which belongs here
- Agent configures one `ClientRegistration` for the tenant. Registrations correspond to **policies**
- Agent points `issuer-uri` at the tenant and finds metadata resolution fails, because the default issuer
  does not include the policy while the metadata document does
- Agent leaves the tenant on the default issuer setting while using a spec-compliant library
- Agent omits the trailing slash from the issuer
- Agent uses `acr` for the policy name. It is backward compatibility only; `tfp` is current
- Agent treats `auth_time` as proof of fresh credential entry. It does not discriminate a fresh sign-in
  from an SSO session, and says nothing about method
- Agent designs a long-lived refresh token for a single-page application. It is fixed at 24 hours
- Agent expects an upstream identity provider token to be passed through for a provider other than an
  OAuth 2.0 one, and gets a blank claim rather than an error
- Agent starts new work on B2C, which has been closed to new customers since 1 May 2025
- Agent assumes Entra External ID behaves like B2C. That was not established here

## Related

- [providers.md](providers.md) · [provider-entra-id.md](provider-entra-id.md) · [spring-security-oidc.md](spring-security-oidc.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [checklist.md](checklist.md)
