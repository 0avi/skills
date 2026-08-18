# SSO Review Checklist

For a review pass over an existing SSO implementation. Each rule links to the reference explaining when
it does not apply. Written for reviewing code that exists, not for generating new code.

**Establish the situation first.** Spring Boot major, Spring Security major, protocol, service provider
or identity provider, and single-tenant or multi-tenant. Several rules below apply to only one of the
answers, and the multi-tenant ones change in severity rather than in applicability.

## The five that cause the most damage

All five pass a successful login, which is why they survive.

| # | Failure | Why it survives review | Reference |
| - | ------- | ---------------------- | --------- |
| 1 | A custom `JwtDecoder` validator installed with `setJwtValidator` | The change looks additive. It **replaces** the default chain, silently dropping issuer and expiry validation | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 2 | SAML metadata fetched without verification credentials | Documented behaviour: "If no credentials are provided, the component will not perform signature validation." Whoever controls that URL chooses your trusted signing key | [security-saml.md](security-saml.md) |
| 3 | Assertions or tokens verified against every configured key rather than the registration's own | Every login succeeds, including one customer's identity provider authenticating as another | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 4 | Tenant read from a request parameter after authentication | Works for every honest request. It is a one-parameter cross-customer breach | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 5 | User records keyed on `sub` alone against a multi-tenant provider | Correct until two tenants issue the same subject, then two customers' users silently become one account. `(issuer, sub)` is right everywhere; on Entra ID workforce it is **`(tid, oid)`**, because Microsoft directs you to `oid` as the database key and says `tid` "must be part of the key" | [providers.md](providers.md) |

## OAuth2 and OIDC client

| # | Rule | Reference |
| - | ---- | --------- |
| 6 | PKCE is applied to every `authorization_code` client, **checked against this project's version**: `requireProofKey` defaults to `true` on Spring Security 7.1.0 and `false` on 6.5.11. Any `requireProofKey(false)` is a recorded decision naming the provider that forced it, not a leftover | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 7 | The callback endpoint is Spring's filter, not hand-written. A hand-written callback owns `state` validation and usually omits it | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 8 | One redirect URI per registration, not one shared callback for all providers, which discards the mix-up countermeasure | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 9 | `redirect-uri` templates resolve correctly behind the proxy, so no redirect goes to `http` or an internal hostname | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 10 | Registered redirect URIs are matched exactly at the provider, with no wildcard, subdomain or subdirectory latitude | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 11 | No open redirect exists anywhere on the redirect URI's host | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 12 | The implicit grant and the resource owner password credentials grant are absent | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 13 | Client authentication prefers `private_key_jwt` or mTLS over a shared secret where the provider supports it | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 14 | Provider configuration uses discovery by issuer where available, rather than hand-copied endpoint URLs | [spring-security-oidc.md](spring-security-oidc.md) |
| 15 | Claims are mapped to authorities in one place at the boundary, not read ad hoc through the application | [spring-security-oidc.md](spring-security-oidc.md) |
| 16 | Granting privileged authority from an identity provider group is a recorded decision, not an accident | [spring-security-saml.md](spring-security-saml.md) |
| 17 | Logout ends the identity provider session as well as the local one, through RP-initiated logout | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |

## Resource server and token validation

| # | Rule | Reference |
| - | ---- | --------- |
| 18 | Any custom validator is wrapped in `DelegatingOAuth2TokenValidator` alongside `JwtValidators.createDefaultWithIssuer` | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 19 | Audience is validated, by the `audiences` property or an explicit validator. It is not validated by default | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 20 | The signature algorithm is pinned. `jws-algorithms` defaults to `RS256`; a hand-built decoder pins nothing | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 21 | Multiple issuers use `JwtIssuerAuthenticationManagerResolver.fromTrustedIssuers`, never an issuer taken from the token | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 22 | Scope or authorization details are checked per request, not treated as descriptive metadata | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 23 | Tokens are audience-restricted to a single resource server where the provider allows it | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 24 | Identity provider fetches, for JWKS and discovery, are constrained by egress policy as well as by an issuer allowlist | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 25 | Refresh tokens rotate **and** reuse is detected. Rotation alone detects nothing | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 26 | No token is in `localStorage`. Prefer a backend-for-frontend, otherwise an `HttpOnly` `Secure` `SameSite` cookie | [security-oauth2-oidc.md](security-oauth2-oidc.md) |

## SAML configuration

| # | Rule | Reference |
| - | ---- | --------- |
| 27 | The Shibboleth repository is present in the build and in any internal Maven mirror | [spring-security-saml.md](spring-security-saml.md) |
| 28 | Metadata is consumed with verification credentials supplied, or the certificate is stored locally out of band | [security-saml.md](security-saml.md) |
| 29 | Metadata URLs are HTTPS to a WebPKI certificate, and a customer-supplied metadata URL is reviewed before use | [security-saml.md](security-saml.md) |
| 30 | Every registration has `signing.credentials`, and `sign-request: false` appears only with a recorded reason. The default is `true`, so unset means signed, and Boot fails context refresh when signing is required and credentials are empty | [spring-security-saml.md](spring-security-saml.md) |
| 31 | Startup does not depend on every customer's identity provider being reachable | [spring-security-saml.md](spring-security-saml.md) |
| 32 | Certificate expiry is tracked and alerted per registration, ahead of the two-year practical maximum | [security-saml.md](security-saml.md) |
| 33 | The signing key is a PKCS#8 key with an X.509 certificate, and every property path was checked against `Saml2RelyingPartyProperties` rather than copied from an example, since a mis-nested property is silently ignored | [spring-security-saml.md](spring-security-saml.md) |
| 34 | Single logout preconditions are confirmed on the provider side before it is promised to a customer: SLO supported, `<SingleLogoutService>` published, requests and responses signed and posted | [spring-security-saml.md](spring-security-saml.md) |
| 35 | The SLO path given to the customer is `/logout/saml2/slo`, with no registration id unless one was configured deliberately. It does not mirror the ACS path, which does carry `{registrationId}` | [spring-security-saml.md](spring-security-saml.md) |

## SAML validation

| # | Rule | Reference |
| - | ---- | --------- |
| 36 | Assertions are signed, and unsigned assertions are rejected. The documentation does not state that they are | [security-saml.md](security-saml.md) |
| 37 | The signature covers the assertion actually being trusted, checked through `<ds:Reference URI>` | [security-saml.md](security-saml.md) |
| 38 | Element selection uses absolute XPath, not `getElementsByTagName` | [security-saml.md](security-saml.md) |
| 39 | In-document `KeyInfo` is ignored, so the attacker cannot supply the verifying key | [security-saml.md](security-saml.md) |
| 40 | Schema validation is strict and against local schemas, with no external fetching | [security-saml.md](security-saml.md) |
| 41 | `InResponseTo`, `Destination`, `Recipient`, `Audience`, `NotBefore` and `NotOnOrAfter` are all validated, and the five-minute default clock skew is accepted deliberately rather than widened by copying the documentation's ten-minute example | [security-saml.md](security-saml.md) |
| 42 | Replay detection exists and its store is shared across instances, not a local cache | [security-saml.md](security-saml.md) |
| 43 | Signature algorithms are at least RSA-SHA-256, with SHA-1 rejected | [security-saml.md](security-saml.md) |
| 44 | IdP-initiated SSO is enabled deliberately or confirmed unreachable. Spring supports it by default | [security-saml.md](security-saml.md) |
| 45 | `RelayState` is validated against an allowlist if it carries a URL | [security-saml.md](security-saml.md) |

## Sessions, logout and deprovisioning

| # | Rule | Reference |
| - | ---- | --------- |
| 46 | Session fixation protection is not set to `none()`. The default is `changeSessionId` | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 47 | The pre-authentication session is not reused after login. Keep the redirect target, not the session | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 48 | Both session lifetimes, identity provider and application, are written down and chosen | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 49 | Logout ends the local session, ends the provider session, and addresses issued tokens. All three | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 50 | Access token lifetimes are short enough that an unpropagated logout has a bounded window | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 51 | Single logout is not presented to customers as a guarantee | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 52 | Accounts are keyed on the provider's stable subject identifier, not on an email address | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 53 | Deprovisioned identifiers are reserved rather than freed for reuse | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 54 | Deprovisioning terminates access, resets any local credential, preserves the audit record, and has a reprovisioning story | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 55 | Frame protection is intact on the login and consent routes specifically | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 56 | CORS uses an origin allowlist, never reflection with credentials, and no token-returning endpoint is CORS-reachable | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |

## Multi-tenant SSO as a feature

| # | Rule | Reference |
| - | ---- | --------- |
| 57 | Tenant context is resolved at authentication time and held server-side in the session | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 58 | Every authorization check includes the tenant | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 59 | Home-realm discovery input is treated as hostile, rate-limited, and cannot select a signing key | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 60 | Any claim used for tenant routing is inside the signature | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 61 | An organisation with SSO enforced cannot log in by password, including through reset | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 62 | A break-glass path exists that does not depend on the customer's identity provider, is tightly restricted, and is logged | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 63 | Deprovisioning is per tenant, not global for a human who belongs to two | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 64 | One registration per customer, with credentials bound to that registration | [spring-security-saml.md](spring-security-saml.md) |

## If you run your own authorization server

| # | Rule | Reference |
| - | ---- | --------- |
| 65 | Running one is justified by a reason on the short list, not by wanting to control the login page | [spring-authorization-server.md](spring-authorization-server.md) |
| 66 | Signing keys are loaded from outside the application, never generated at startup | [spring-authorization-server.md](spring-authorization-server.md) |
| 67 | Rotation publishes overlapping keys with distinct `keyID` values, and has been rehearsed | [spring-authorization-server.md](spring-authorization-server.md) |
| 68 | Clients and authorizations are persisted, not in memory | [spring-authorization-server.md](spring-authorization-server.md) |
| 69 | No default `user` / `password` account and no `{noop}` client secret survive | [spring-authorization-server.md](spring-authorization-server.md) |
| 70 | The issuer is set explicitly and has not changed since tokens were issued | [spring-authorization-server.md](spring-authorization-server.md) |
| 71 | PKCE downgrade is mitigated: a `code_verifier` is accepted only if a `code_challenge` was sent. Enforcement is per client through `ClientSettings.builder().requireProofKey(true)`, which **defaults to `false`**, the opposite of the client-side default on Spring Security 7.1.0 | [spring-authorization-server.md](spring-authorization-server.md) |
| 72 | Consent is required for third-party clients and not for first-party ones | [spring-authorization-server.md](spring-authorization-server.md) |
| 73 | Multiple issuers, off by default, are enabled only with the resolution path established | [spring-authorization-server.md](spring-authorization-server.md) |

## Process

| # | Rule | Reference |
| - | ---- | --------- |
| 74 | No example in the codebase derives from material predating Spring Security 6. `WebSecurityConfigurerAdapter` and `authorizeRequests()` were removed | [security-hardening.md](security-hardening.md) |
| 75 | The configuration has been run against a real identity provider, not only compiled | [security-hardening.md](security-hardening.md) |
| 76 | Dependency scanning covers Spring Security, the XML security stack and the identity provider, against vendor advisories | [security-hardening.md](security-hardening.md) |
| 77 | On any Boot 4.x, starter names use the `spring-boot-starter-security-oauth2-` form. The `spring-boot-starter-oauth2-` names are deprecated from **4.0.0** onwards, in the POM description only, and still resolve, so nothing warns you. On Boot 3.5.x the old names are correct | [spring-security-oidc.md](spring-security-oidc.md) |
| 78 | The resolved `spring-security-saml2-service-provider` version is at or above 7.0.6 or 6.5.11, per CVE-2026-40988. Check the resolved version, not the Boot line | [security-saml.md](security-saml.md) |

## Authentication strength and session lifecycle

Added from the OWASP ASVS 5.0 cross-check, chapters V6 and V7.

| # | Rule | Reference |
| - | ---- | --------- |
| 79 | Where a factor is required, it is verified from the assertion or token via `acr`, `amr` or `AuthnContextClassRef`, not assumed from the customer's provider settings (V6.8.4) | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 80 | Sensitive actions check authentication recentness through `auth_time` or `AuthnInstant`, not merely an unexpired session (V7.5.1, V7.5.3) | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 81 | Step-up re-asks the provider for the stronger context and verifies the response, rather than setting a local flag | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 82 | Every authentication pathway is documented and enforces the same strength: legacy password login, API tokens, impersonation, break-glass (V6.3.4) | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 83 | Administrators can terminate sessions for one user or for all users (V7.4.5) | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 84 | Disabling or deleting an account terminates its active sessions, and addresses tokens in flight (V7.4.2) | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 85 | Users can view and terminate their own active sessions (V7.5.2) | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 86 | Idle timeout and absolute maximum lifetime are two separate documented numbers (V7.1.1, V7.3.1, V7.3.2) | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 87 | Concurrent session policy is documented, with the behaviour at the limit (V7.1.2) | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |
| 88 | The federated session topology is documented: which systems create and manage sessions (V7.1.3) | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |

## Onboarding a provider

| # | Rule | Reference |
| - | ---- | --------- |
| 89 | The exact product is established, not just the brand. Okta, Cognito, Ping and Microsoft each ship more than one thing under one name | [providers.md](providers.md) |
| 90 | The issuer is taken **verbatim from the discovery document**, never constructed from a documentation example or from the URL fetched | [providers.md](providers.md) |
| 91 | A real token from the real tenant has been decoded, and role location, identifier stability and token size confirmed from it rather than from documentation | [provider-others.md](provider-others.md) |
| 92 | Group and role mapping was tested with a realistic user, not a test account. Several providers change behaviour or omit claims entirely at scale | [provider-entra-id.md](provider-entra-id.md) |
| 93 | No vendor-published Spring adapter is in use | [providers.md](providers.md) |
| 94 | If SCIM is implemented, both `DELETE` and `PATCH` setting `active` to `false` terminate access | [scim-provisioning.md](scim-provisioning.md) |

## Token and code lifecycle

Added from the OWASP ASVS 5.0 cross-check, chapters **V9 Self-contained Tokens** and **V10 OAuth and
OIDC**. Rules 95 to 97 and 106 apply only if you run the authorization server; the rest apply to any
resource server.

| # | Rule | Reference |
| - | ---- | --------- |
| 95 | Authorization codes are single use, and a second presentation revokes the tokens already issued against that code rather than merely failing (10.4.2) | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 96 | Authorization code lifetime is at most 10 minutes, and at most 1 minute where L3 is the target (10.4.3) | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 97 | Refresh tokens have an absolute expiration as well as any sliding expiry (10.4.8) | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 98 | Self-contained tokens are accepted only from an algorithm allowlist, and the key material is bound to the issuer rather than merely configured, which is what `jwk-set-uri` without `issuer-uri` fails (9.1.2, 9.1.3) | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 99 | Token type is validated and not only the signature. `JwtTypeValidator.jwt()` is in the chain, which a bare `setJwtValidator` removes along with everything else (9.2.2) | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| 100 | Where one signing key serves several audiences, every token carries an audience restriction identifying the intended audience (9.2.3, 9.2.4) | [security-oauth2-oidc.md](security-oauth2-oidc.md) |

## Logout propagation

| # | Rule | Reference |
| - | ---- | --------- |
| 101 | If back-channel logout is enabled, the `OidcSessionRegistry` is shared across instances. The default is in-memory, so otherwise it reaches one instance out of *n* | [spring-security-oidc.md](spring-security-oidc.md) |
| 102 | The back-channel logout endpoint is rate-limited and monitored, and the logout token is validated as a logout token, since the endpoint ends sessions on request (10.5.5) | [spring-security-oidc.md](spring-security-oidc.md) |
| 103 | The session cookie name matches what `OidcBackChannelLogoutHandler` expects: `JSESSIONID`, or `setSessionCookieName("SESSION")` where Spring Session is in use | [spring-security-oidc.md](spring-security-oidc.md) |
| 104 | RP-initiated logout was tested behaviourally, by signing in again and asserting the provider prompts. A 302 proves nothing, because a missing `end_session_endpoint` degrades to local-only in silence | [spring-security-oidc.md](spring-security-oidc.md) |
| 105 | On a resource server, a flat role claim is mapped with `authorities-claim-name` and `authority-prefix` rather than a hand-written converter, and both are not configured at once, since a converter bean disables the properties | [spring-security-oidc.md](spring-security-oidc.md) |
| 106 | If you run the authorization server, users can review, modify and revoke the consents they have granted. Nothing in Spring Authorization Server provides this (10.7.3) | [spring-authorization-server.md](spring-authorization-server.md) |

## Version notes

Every rule holds against **Spring Security 7.1.0** and **Spring Authorization Server 1.5.8**, as read on
12/08/2026. Version dependence:

| Rule | Depends on |
| ---- | ---------- |
| 6, 18, 19, 20, 21 | Spring Security 7.1.0 behaviour. Re-check the 6.5.x reference for a Boot 3.5.x project |
| 27 to 45 | A SAML integration. Irrelevant to an OIDC-only deployment |
| 36 | The documentation not stating that unsigned assertions are rejected. If a later version states it, this becomes a confirmation rather than a check |
| 46 | Default `changeSessionId`, verified in the 7.1.0 source as unconditional |
| 65 to 73 | Running your own authorization server. Most products should not be |
| 71 | `ClientSettings.builder().requireProofKey(boolean)`, defaulting to **`false`**, read from the source at the 1.5.8 tag |
| 74 | Boot 4.x on Spring Security 7.x, Boot 3.5.16 on 6.5.11 |
| 77 | Deprecation of the `spring-boot-starter-oauth2-` names begins at Boot **4.0.0**, not 4.1.0. On 3.5.x those names are correct |
| 78 | CVE-2026-40988, from the Spring advisory. **Six of its eight** fixed versions are enterprise-support only, including 7.0.5.1 and 6.5.10.2 |
| 79 to 88 | **ASVS 5.0.0**, chapters V6 and V7. ASVS 5.0 renumbered these from 4.x's V2 and V3, so a review against a 4.x checklist uses different identifiers |
| 95 to 106 | **ASVS 5.0.0**, chapters V9 and V10, both **new in 5.0** with no 4.x equivalent. 96 and 102 name assurance levels, so they depend on the level being targeted |
| 101 to 104 | Back-channel logout on Spring Security 7.1.0. Not applicable to a SAML-only integration, which has its own SLO rules at 34 and 35 |
| 105 | `authorities-claim-expressions` is Boot 4.x only. The other four authority properties exist on both lines |

**The ASVS cross-check ran in two passes**, and the second one exists because the first was incomplete:
V6 and V7 produced rules 79 to 88, then V9 Self-contained Tokens and V10 OAuth and OIDC produced 95 to
106. V10 is the chapter most specific to this skill's subject, and its seven sections split requirements by
role, so read the section matching what you are: client, resource server, authorization server, OIDC
relying party, OpenID provider, or consent. The CVE pass produced exactly one citation, CVE-2026-40988,
verified against the vendor advisory; nothing else is cited, deliberately.

## Gotchas

- Agent reviews without establishing the versions, the protocol, the role and the tenancy model, then
  applies rules that do not apply
- Agent reports all findings at equal weight. The first five outrank the rest combined
- Agent treats this as a generation guide. It is written for a review pass over existing code
- Agent checks that a feature is configured and never checks what is validated **by default**, which is
  where both protocols fail
- Agent verifies the happy path only. Rules 3, 4, 5, 36 and 39 all pass a successful login
- Agent reviews single-tenant severity in a multi-tenant product, where the same gap is a cross-customer
  breach
- Agent accepts "we rotate refresh tokens" without asking whether reuse is detected
- Agent accepts "we have SSO enforced" without checking the password reset path
- Agent marks rule 71 as passing by reading the client-side default. Same method name on both sides,
  different class, and **opposite defaults**: `true` on a 7.1.0 client registration, `false` on a 1.5.8
  registered client
- Agent passes rule 104 on a 302 response. A silently degraded logout returns 302 too
- Agent reports a hand-written authority converter as correct on a resource server without asking whether
  two properties would have done it, or notices the properties and misses that a converter bean disables
  them

## Related

- [security-hardening.md](security-hardening.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [security-saml.md](security-saml.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [spring-security-oidc.md](spring-security-oidc.md) · [spring-security-saml.md](spring-security-saml.md) · [spring-authorization-server.md](spring-authorization-server.md)
