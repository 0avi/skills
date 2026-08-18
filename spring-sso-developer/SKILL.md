---
name: spring-sso-developer
description: Implements Single Sign-On in Java and Spring applications, both internal organisational SSO and SSO-as-a-feature in multi-tenant SaaS products. Trigger when integrating an external identity provider over OIDC or SAML, when acting as an OAuth2 or OIDC client or resource server, when running your own authorization server, when configuring a SAML service provider, when choosing between OIDC and SAML for a customer, when per-organisation identity provider configuration or home-realm discovery is needed, when provisioning or deprovisioning users from an identity provider, when reviewing a Spring Security configuration for vulnerabilities, or when an SSO login, logout or token validation is failing. Covers Spring Boot 4.x and 3.5.x with Spring Security 7 and 6.5, and drops into legacy, in-progress and greenfield work alike.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# Single Sign-On in Java and Spring

SSO fails in production for two reasons, and neither is protocol ignorance. The first is that
**frameworks validate less by default than everyone assumes**, so a configuration that authenticates
correctly is not the same as one that authenticates safely. The second is that **an integration is
only as good as the least capable identity provider you have to support**, which is decided by your
customers rather than by you.

This skill is production-oriented throughout. Where a quickstart shortcut exists, it is named as a
shortcut and the production form is given instead.

1. **Establish the whole picture before giving guidance.** Spring Boot major, Spring Security major,
   protocol, whether you are the service provider or the identity provider, and single-tenant or
   multi-tenant. Advice correct for one combination is wrong for another, and the multi-tenant answer
   differs most. See [Establishing the situation](#establishing-the-situation).

2. **The customer's identity provider decides the protocol, not you.** Selling SSO to enterprises
   means supporting what they already run, and a large share of that estate still does SAML properly
   and OIDC poorly or not at all. See [Choosing OIDC or SAML](#choosing-oidc-or-saml).

3. **Never invent a property name, class name, endpoint path or claim name.** On an authentication
   surface a plausible-but-wrong identifier does not fail loudly, it fails open or silently. If you
   cannot confirm something against the current reference documentation, say so and stop rather than
   filling the gap.

4. **Establish what the framework validates by default before reporting anything as secure or
   insecure, and never state a default without naming the version.** Two examples that set the
   standard. Spring's own documentation says `OpenSaml5AuthenticationProvider` "performs minimal
   validation on SAML 2.0 Assertions", so SAML validation is largely yours to add. And the PKCE
   default for confidential clients **flipped** between the versions this skill covers: on in Spring
   Security 7.1.0, off in 6.5.11. A confident statement about either, made without checking, is how
   this goes wrong. Read [security-hardening.md](references/security-hardening.md) before writing any
   configuration.

5. **Running your own identity provider is a decision, usually the wrong one.** Being an OAuth2 client
   or a SAML service provider is a week of work. Being an identity provider means user lifecycle, MFA,
   recovery, key rotation and an audit trail, indefinitely. See
   [spring-authorization-server.md](references/spring-authorization-server.md), which is honest about
   when to say no.

6. **In a multi-tenant product, every SSO defect is a cross-customer defect.** Tenant context is
   resolved at authentication time and bound to the session, and an assertion is verified with that
   tenant's key alone, never against the union of configured keys. See
   [security-sessions-and-tenancy.md](references/security-sessions-and-tenancy.md).

7. **Compile it and run it.** Starter renames, the Spring Security 6 API removals and provider metadata
   differences all fail at build or at first redirect. A configuration that has never been executed
   against a real identity provider is a draft.

Every reference carries a **`## Version notes`** section stating what differs across Spring Boot 4.x
and 3.5.x and across provider versions, and a **`## Gotchas`** list of the specific mistakes agents
make in that area. Read the gotchas even when skimming. Spring identifiers throughout were read from
the Spring Security 7.1.0 reference documentation rather than recalled, and protocol requirements are
attributed to the RFC, OASIS specification or OWASP sheet they come from.

## Establishing the situation

**Step 1. The versions.** Boot version from the build file, not the toolchain. Boot 4.x carries Spring
Security 7.x; Boot 3.5.x carries the 6.5.x line. This matters more here than in most areas, because
`WebSecurityConfigurerAdapter` and `authorizeRequests()` were **removed** in Spring Security 6, so any
example built on them predates every supported version. Most SSO tutorials and books still use them.

**Step 2. Which side are you.** Service provider, consuming a customer's identity provider, is the
normal B2B SaaS shape. Identity provider, issuing your own tokens, is a different problem with a much
larger surface. Some products are both.

**Step 3. The protocol, and who chose it.** If the answer is "OIDC, because it is nicer", check whether
the customer's identity provider agrees. See below.

**Step 4. One tenant or many.** A single corporate integration and a multi-tenant SaaS feature share a
protocol and share almost no architecture. Multi-tenant needs per-organisation registration, tenant
binding, home-realm discovery and per-tenant key isolation.

**Step 5. What already exists.** Dropping into existing work, find: the filter chain configuration, any
`ClientRegistrationRepository` or `RelyingPartyRegistrationRepository` bean, hand-written callback
endpoints, and any custom `JwtDecoder` or validator. **A hand-written callback or a replaced validator
is where the vulnerabilities are**, because both take over checks the framework was doing.

## Choosing OIDC or SAML

Pick on evidence about the customer's identity provider, never on preference.

| Choose | When |
| ------ | ---- |
| **OIDC** | The identity provider supports it well, which covers Entra ID, Okta, Auth0, Google Workspace and Keycloak. You need mobile or SPA clients, where SAML is genuinely unsuitable. You want JSON, JWTs and discovery documents rather than XML and signed assertions. You control both ends |
| **SAML 2.0** | The customer mandates it, and large enterprises frequently do. The identity provider is ADFS or an older on-premises product where OIDC support is partial or absent. Procurement or a security questionnaire names it. An existing estate of service providers already federates this way |
| **Both** | You are selling SSO as a feature to enterprises. This is the realistic answer, because you do not choose your customers' identity providers and you will meet both within the first handful of deals |

Three points that decide this more often than the table:

- **SAML is not legacy in the sense of being unsupported.** It is the incumbent in large enterprises,
  it is well specified, and it will be in procurement documents for years. Treating it as an
  afterthought is the most common architectural mistake in a B2B SSO feature, because retrofitting a
  second protocol into a design shaped around one is expensive.
- **OIDC is materially easier to operate.** Key rotation happens through a JWKS endpoint rather than
  through a certificate exchange with a customer's IT department, and certificate expiry is the single
  most common cause of SSO outages.
- **Do not offer a choice you cannot support well.** Two half-implemented protocols is worse than one
  correct one plus an honest roadmap.

## Topics

### Protocols and Spring integration

- **OIDC and OAuth2 with Spring Security**: client and resource server, provider configuration by
  discovery, the authenticated principal, mapping claims to authorities, logout, and multiple trusted
  issuers. Read [spring-security-oidc.md](references/spring-security-oidc.md)
- **SAML 2.0 service provider**: dependencies including the mandatory Shibboleth repository, relying
  party registration, metadata in both directions, signing and decryption credentials, attribute
  mapping, and single logout with its real-world unreliability. Read
  [spring-security-saml.md](references/spring-security-saml.md)
- **Being the identity provider**: Spring Authorization Server, when to run one at all, the endpoints
  it exposes, token customisation, and what it deliberately does not do. Read
  [spring-authorization-server.md](references/spring-authorization-server.md)
- **Identity providers**: start at the index for the cross-vendor tables no single vendor documents -
  **where role information actually lives**, the issuer strings you must never construct, and what to key
  on - then the **13 vendor files**, each verified against that vendor's own documentation and each
  stating what it could not verify. Read [providers.md](references/providers.md)
- **The frontend half, Angular and React**: why a backend-for-frontend removes most of the problem, why
  starting the flow with `fetch` cannot work, why logout must be a navigation rather than a request, home
  realm discovery as an unauthenticated endpoint, and arriving already authenticated from an
  IdP-initiated flow. Read [frontend-integration.md](references/frontend-integration.md)
- **Provisioning with SCIM**: whether you need SCIM at all rather than just-in-time provisioning, the
  endpoints RFC 7644 defines, and the deprovisioning ambiguity that decides your implementation, since
  the RFC defines `DELETE` while clients overwhelmingly send `PATCH` setting `active` to `false`. Read
  [scim-provisioning.md](references/scim-provisioning.md)

### Security

- **Hardening index**: the two defaults that catch people, the order to review in, and the policy on
  CVEs. Start here. Read [security-hardening.md](references/security-hardening.md)
- **OAuth2 and OIDC attacks**: PKCE, `state`, `nonce`, redirect URI matching, algorithm confusion,
  missing `iss` and `aud`, mix-up, token storage, refresh rotation, scope and the confused deputy.
  Read [security-oauth2-oidc.md](references/security-oauth2-oidc.md)
- **SAML attacks**: XML Signature Wrapping, XXE, unsigned assertions, the validation checklist Spring
  does not fully cover, IdP-initiated flows, `RelayState`, and certificate handling. Read
  [security-saml.md](references/security-saml.md)
- **Sessions, logout and tenant isolation**: session fixation across the handoff, why logout is three
  jobs, CORS, and the tenant-isolation rules specific to SaaS. Read
  [security-sessions-and-tenancy.md](references/security-sessions-and-tenancy.md)

## Symptom index

| Symptom | Read |
| ------- | ---- |
| Choosing between OIDC and SAML for a customer | [Choosing OIDC or SAML](#choosing-oidc-or-saml) |
| Redirect after login goes to `http`, or to an internal hostname | [security-oauth2-oidc.md](references/security-oauth2-oidc.md) |
| Login works but no roles or authorities are populated | [providers.md](references/providers.md) for where your provider puts them, then [spring-security-oidc.md](references/spring-security-oidc.md) |
| Issuer validation fails against strings that look identical | [providers.md](references/providers.md) |
| Groups arrive for test users and not for a customer's administrator | [provider-entra-id.md](references/provider-entra-id.md) |
| Any Google account can sign in to a customer's tenant | [provider-google-workspace.md](references/provider-google-workspace.md) |
| A deprovisioned user still has a working session | [scim-provisioning.md](references/scim-provisioning.md) |
| Starting login from the SPA gives a CORS error | [frontend-integration.md](references/frontend-integration.md) |
| Logout succeeds but the next sign-in is silent | [frontend-integration.md](references/frontend-integration.md) |
| The sign-in screen lists our customers by name | [frontend-integration.md](references/frontend-integration.md) |
| A token verifies but was minted for a different service | [security-oauth2-oidc.md](references/security-oauth2-oidc.md) |
| Tokens from more than one identity provider must be accepted | [security-oauth2-oidc.md](references/security-oauth2-oidc.md) |
| The build cannot resolve the SAML dependency | [spring-security-saml.md](references/spring-security-saml.md) |
| The application will not start, complaining that signing credentials must not be empty | [spring-security-saml.md](references/spring-security-saml.md) |
| A user who signed out at the identity provider is still signed in here | [spring-security-oidc.md](references/spring-security-oidc.md) |
| SAML login succeeds and you are not sure what was validated | [security-saml.md](references/security-saml.md) |
| An assertion from one customer is accepted for another | [security-sessions-and-tenancy.md](references/security-sessions-and-tenancy.md) |
| Single logout does not log the user out everywhere | [security-sessions-and-tenancy.md](references/security-sessions-and-tenancy.md) |
| Every user at one customer lost access at once | [security-saml.md](references/security-saml.md) |
| Reviewing an inherited Spring Security config for vulnerabilities | [security-hardening.md](references/security-hardening.md) |
| A book or tutorial example will not compile | [Establishing the situation](#establishing-the-situation) |
| Deciding whether to run your own identity provider | [spring-authorization-server.md](references/spring-authorization-server.md) |
| A customer's users must be created and removed automatically | [security-sessions-and-tenancy.md](references/security-sessions-and-tenancy.md) |

## Checklist

- **SSO review checklist**: rules for a review pass over an existing SSO implementation, the most
  damaging first, each linked to its reference. Read [checklist.md](references/checklist.md)
