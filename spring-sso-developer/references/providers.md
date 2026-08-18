# Identity Providers: Index and Comparison

One file per provider, on an identical schema so they can be compared, plus the cross-vendor tables below,
which are the part no single vendor's documentation contains.

**Read the comparison tables before the vendor file.** They tell you what class of problem you are about to
have. The vendor file tells you the specifics.

**Every vendor file states its verification date and carries a "Not verified in this pass" section.**
Depth varies with the quality of each vendor's public documentation, not with the vendor's importance, and
each file says which it is.

## The files

| Provider | Read | The headline |
| -------- | ---- | ------------ |
| **Microsoft Entra ID** | [provider-entra-id.md](provider-entra-id.md) | Multi-tenant metadata returns a literal `{tenantid}` template, so exact-match issuer validation cannot work. Group claims are **omitted entirely** above 150 SAML / 200 JWT |
| **Okta** | [provider-okta.md](provider-okta.md) | Org versus custom authorization server decides everything. On the org server, groups are in the **ID token only**, where Spring never looks |
| **Keycloak** | [provider-keycloak.md](provider-keycloak.md) | Roles are nested two levels deep in `realm_access` and `resource_access`. Realm is the tenant boundary |
| **Auth0** | [provider-auth0.md](provider-auth0.md) | The issuer **ends with a slash**. Management API tokens are not a basis for your own authorisation |
| **Google Workspace** | [provider-google-workspace.md](provider-google-workspace.md) | Without validating the **`hd` claim**, any Google account on earth can sign in. Two valid `iss` forms |
| **Amazon Cognito** | [provider-aws-cognito.md](provider-aws-cognito.md) | Access tokens carry **`client_id`, not `aud`**. `token_use` must be validated or an ID token works as a bearer token |
| **AD FS** | [provider-adfs.md](provider-adfs.md) | OIDC exists only from **2016**. Omitting the resource lands on a default whose **MFA policy cannot be configured** |
| **Ping Identity** | [provider-ping-identity.md](provider-ping-identity.md) | "Ping" is at least five products across two merged lineages. Realm-based issuers with a shorthand form that differs from the canonical one |
| **OneLogin** | [provider-onelogin.md](provider-onelogin.md) | Documents Implicit and ROPC among its flows, both excluded by RFC 9700. Availability is not endorsement |
| **Shibboleth and academic federations** | [provider-shibboleth.md](provider-shibboleth.md) | You join a federation, not an IdP. **Attribute release is the institution's decision**, so you can authenticate and learn nothing |
| **WorkOS** | [provider-workos.md](provider-workos.md) | Inverts the problem. Whether standard OIDC applies is unverified and **decides whether Spring is involved at all** |
| **Azure AD B2C and Entra External ID** | [provider-entra-external-id.md](provider-entra-external-id.md) | Customer identity, not workforce. The **default issuer is not Discovery-compliant**. B2C closed to new customers 1 May 2025 |
| **Anything else** | [provider-others.md](provider-others.md) | The procedure, plus JumpCloud, Zitadel and authentik |

Provisioning is protocol-level rather than per vendor: see [scim-provisioning.md](scim-provisioning.md).

## Where role information actually lives

**This is the table to read first.** Spring builds authorities from the flat `scope` claim, prefixed
`SCOPE_`. Almost nothing arrives there.

| Provider | Where roles or groups are | Spring's default sees it |
| -------- | ------------------------- | ------------------------ |
| **Auth0** | Permissions in **`scope`**, roles in a namespaced custom claim | **Partly.** Auth0's own guidance treats `scope` as the place permissions live, which Spring reads natively. The **claim name and the setting that enables it are unverified**, so confirm from a real token. Roles via a custom claim do not |
| **Okta**, org auth server | `groups`, **ID token only** | No. And it **cannot** be moved to the access token |
| **Okta**, custom auth server | `groups`, ID and access tokens | No. Not a `scope` |
| **Entra ID** | `groups`, or `roles` for app roles | No. And `groups` is **omitted entirely** above the limit |
| **Keycloak** | `realm_access.roles`, `resource_access.{client}.roles` | No. Nested two levels deep |
| **Amazon Cognito** | `cognito:groups`, both tokens | No. Non-standard claim name |
| **Google Workspace** | **Not in the token at all** | No. Directory lookup required |
| **AD FS** | Whatever the customer's claim rules emit | Unknown per customer. Ask for a decoded token |
| **Shibboleth** | SAML attributes, released at the institution's discretion | Not applicable. SAML, and may be absent |
| **WorkOS** | Normalised profile fields | Not applicable if the SDK path applies |
| **Ping**, **OneLogin**, **Entra External ID** | **Unverified** | Assume no. Confirm from a real token |

**So the rule is: assume the claim needs mapping. Whether that costs you code depends on the shape of the
claim and on which side you are.**

| Situation | What it takes |
| --------- | ------------- |
| **Resource server**, flat claim of role names: `cognito:groups`, Entra `roles`, Okta custom-server `groups` | **Two properties, no code.** `authorities-claim-name` plus `authority-prefix`, wired by Boot's `JwtConverterConfiguration` |
| **Resource server**, nested claim: Keycloak's `realm_access.roles` | **Code.** The properties read one top-level claim and cannot reach inside an object |
| **Resource server**, roles split across claims | **Code.** One claim name only |
| **Login client**, any claim | **Code.** A `GrantedAuthoritiesMapper` or an `OidcUserService` delegate. The resource server properties do not apply here at all |

**Check which side you are on before writing anything.** A resource server taking a flat claim is the
common case and the one where a converter is wasted work. Worked converter examples, for the cases that
genuinely need them, are in [provider-keycloak.md](provider-keycloak.md) and
[provider-aws-cognito.md](provider-aws-cognito.md); the property route and its silent failure mode, where
declaring a converter bean disables the properties, are in
[spring-security-oidc.md](spring-security-oidc.md).

## Issuer strings, and why you must never construct one

**Take `issuer` verbatim from the discovery document.** Verified variations:

| Provider | The surprise |
| -------- | ------------ |
| **Auth0** | **Ends with a slash.** `https://{tenant}.auth0.com/` |
| **Google** | **Two valid forms**: `https://accounts.google.com` and `accounts.google.com` |
| **Entra ID**, multi-tenant | A literal template, `https://login.microsoftonline.com/{tenantid}/v2.0`, which never matches a token |
| **Entra ID** | v1.0 and v2.0 differ in host: `sts.windows.net` versus `login.microsoftonline.com` |
| **Azure AD B2C** | Default omits the policy while metadata is per policy, so it is **not Discovery-compliant**. Also trailing slash. **Entra External ID unverified**, including whether it has the same compatibility setting |
| **Ping**, ForgeRock lineage | Nested realm path, `.../am/oauth2/realms/root/realms/alpha`, plus a shorthand that differs |
| **Keycloak** | Older deployments include an `/auth` segment, current ones do not |
| **Okta** | Differs between org and custom authorization server |
| **Cognito** | Region and user pool id, `https://cognito-idp.{Region}.amazonaws.com/{userPoolId}` |

Spring's `JwtIssuerValidator` compares strings. Every row above is a way for a valid token to be rejected,
or worse, for someone to disable issuer validation to make the error go away. See
[security-oauth2-oidc.md](security-oauth2-oidc.md).

## What to use as a primary key

**The wrong choice merges two people into one account**, and it is invisible until two records collide.

| Provider | Key on |
| -------- | ------ |
| **Google** | **`sub` alone is safe.** "unique among all Google Accounts and never reused... never changed" |
| **Azure AD B2C** | **`sub` is safe.** "immutable and can't be reassigned or reused". Verified for **B2C only**; Entra External ID was not established in this pass, so use `(issuer, sub)` there |
| **Entra ID**, workforce | **`(tid, oid)`.** Microsoft directs you to `oid` and says `tid` "must be part of the key". **Never `email` or `upn`** |
| **Keycloak** | Realm-scoped subject, so `(issuer, sub)` |
| **Everything unverified** | **`(issuer, sub)`** |

**`(issuer, sub)` is correct everywhere** and is the right default in a product supporting several
providers, because uniqueness within one provider is not uniqueness among your users. Never key on an
email address: it is mutable, reassignable, and two providers explicitly warn against it. See the
identifier-reuse hazard in [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

## Protocol reality

**The customer's provider decides, not you.** See the decision guide in the router.

| Expect SAML first | Expect either | Expect OIDC |
| ----------------- | ------------- | ----------- |
| AD FS before 2016, Shibboleth and academic federations | Keycloak, Ping, AD FS 2016+, and most enterprise suites | Cognito, Auth0, B2C and External ID |

**Google Workspace can act as a SAML identity provider**; that was not verified here, so do not assume it
is OIDC-only. **PingFederate is frequently the SAML identity provider** in front of a whole enterprise
estate.

## The seven questions for onboarding any provider

1. **Which protocols does this customer's provider actually support well?** Not what the vendor markets.
2. **Is there a discovery document?** Without one you lose `end_session_endpoint`, and OIDC logout
   silently degrades to local-only.
3. **What is the exact `iss` value, and does it vary per tenant?** See the table above.
4. **Is the subject unique globally, or only within a tenant or realm?** It determines your primary key.
5. **Where do groups and roles actually arrive?** See the table above. Assume a converter.
6. **Does it support PKCE for confidential clients?** Spring Security 7.1.0 requires it by default, so a
   provider that rejects it fails at the token request.
7. **How is provisioning and deprovisioning done?** SCIM, JIT, or manually. See
   [scim-provisioning.md](scim-provisioning.md).

**Two artefacts answer most of these**: the discovery document and one decoded token from the real tenant.
The procedure is in [provider-others.md](provider-others.md), and **a real token beats documentation**
because it shows what the deployment does rather than what the product can do.

## Never use a vendor-specific Spring adapter

Use Spring Security's own OAuth2 client and SAML support with the vendor's issuer, not a vendor-published
Spring integration library. Vendor adapters have historically lagged Spring releases and then been
deprecated. Keycloak's own documentation calls its Java adapters "legacy"; the specific deprecation
timeline was not verified, and the rule does not depend on it.

**This applies to material as much as to dependencies.** Documentation written around a vendor adapter
describes a configuration model that no longer exists, in the same way anything using
`WebSecurityConfigurerAdapter` does.

## Build or buy

**Building it yourself** means: per-customer registration storage and an administration interface,
home-realm discovery, **both protocols** because you do not choose your customers' providers, SCIM or JIT
plus deprovisioning, certificate expiry tracking per customer, a break-glass path, and a support function
that can debug someone else's identity provider.

**Buying it** means one integration, with the vendor absorbing per-customer variability. The cost is a
dependency in your authentication path and a per-connection price.

**The honest rule:** if SSO is a feature you sell, the **per-customer operational surface dominates the
protocol work**, and that surface is what a vendor actually removes. If SSO is one corporate integration
for your own staff, buying is overkill and the two Spring files are the whole job.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verification dates | Each vendor file states its own. All were read on 12/08/2026 |
| Depth varies | With each vendor's public documentation quality. Files with thinner coverage say so and list what is missing |
| Unverified rows | Ping, OneLogin and Entra External ID role claims, and most of JumpCloud, Zitadel and authentik. Treat as questions |
| Spring identifiers | Spring Security 7.1.0 throughout. Boot 3.5.16 carries Security 6.5.11, so re-check against the 6.5.x reference |
| The comparison tables | Synthesised from the vendor files. Where a vendor file says unverified, the table says unverified |

## Gotchas

- Agent reads the vendor file and skips the comparison tables, so it does not know which class of problem
  it is about to meet
- Agent constructs an issuer string from a documentation example instead of reading it from the discovery
  document
- Agent expects role information in `scope`. One verified provider does that; the rest do not
- Agent keys accounts on an email address, or on `sub` alone against a tenant-scoped provider
- Agent treats a provider's marketing protocol list as its actual capability
- Agent assumes one brand is one product. Okta, Cognito, Ping and Microsoft all fail that assumption
- Agent adopts a vendor-published Spring adapter
- Agent tests with a small account and ships to a customer whose administrator is in hundreds of groups
- Agent fills an unverified row from memory rather than from a discovery document and a real token
- Agent estimates multi-tenant SSO as protocol work when the cost is per-customer operations

## Related

- [spring-security-oidc.md](spring-security-oidc.md) · [spring-security-saml.md](spring-security-saml.md) · [scim-provisioning.md](scim-provisioning.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [checklist.md](checklist.md)
