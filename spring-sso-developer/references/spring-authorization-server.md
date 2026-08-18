# Spring Authorization Server: Being the Identity Provider

This file covers running your **own** OAuth2 and OIDC provider. Read the first section before the rest,
because for most products the correct answer is not to.

Verified against **Spring Authorization Server 1.5.8** on 12/08/2026, with default endpoint paths read
from the `AuthorizationServerSettings` source at the 1.5.8 tag rather than from documentation examples.

## Should you run one at all

**Usually not.** Being an OAuth2 client or a SAML service provider is a week of careful work. Being an
identity provider is a permanent commitment to a category of problem you were not previously in.

**Reasons that do not justify it:**

- "We want to control the login page." You can brand a hosted login page at every serious provider.
- "We do not want a vendor dependency." You are replacing a vendor dependency with a rota.
- "Our customers need SSO." That makes you a **service provider**, consuming their identity providers.
  It is the opposite requirement, and confusing the two is the most expensive mistake in this area. See
  [spring-security-oidc.md](spring-security-oidc.md) and
  [spring-security-saml.md](spring-security-saml.md).
- "We already have a user table." A user table is perhaps five per cent of an identity provider.

**Reasons that do justify it:**

- **You have several first-party applications** that must share one login, and you want the session and
  the user record to stay inside your estate.
- **You are issuing tokens to third-party developers** against your own API, so you genuinely are the
  authorization server in the OAuth2 sense.
- **Data residency or regulatory constraints** make an external provider unusable, and you have
  established that rather than assumed it.
- **You need a token shape no provider will issue**, having first tried token customisation at a
  provider.

**What you take on**, none of which Spring Authorization Server does for you: user registration, the
password lifecycle, credential recovery, MFA enrolment and step-up, account lockout and its abuse
paths, an administrative interface, key rotation, an audit trail your compliance reviewer will accept,
and being the component whose outage means nobody can log in to anything.

If you do proceed, be clear that **Spring Authorization Server is an authorization server, not an
identity management product.** The comparison is with Keycloak, which bundles the user lifecycle and
the admin console, not with the specification.

## What it implements

Per the project's own overview: OAuth 2.1 Authorization Framework (draft), OpenID Connect Core 1.0,
Discovery 1.0, RP-Initiated Logout 1.0, and Dynamic Client Registration 1.0, plus PKCE (RFC 7636),
token introspection (RFC 7662), token revocation (RFC 7009), the device authorization grant (RFC 8628),
DPoP (RFC 9449) and token exchange (RFC 8693).

DPoP and token exchange are worth noting: RFC 9700 recommends sender-constraining access tokens, and
DPoP is one of the two mechanisms it names. See [security-oauth2-oidc.md](security-oauth2-oidc.md).

## Dependencies and versions

With Spring Boot, which is the normal case:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security-oauth2-authorization-server</artifactId>
</dependency>
```

**Note the `security-` prefix.** Across the whole Boot 4 line, **from 4.0.0 onwards**, the older
`spring-boot-starter-oauth2-authorization-server` is **deprecated** "in favor of" this name, as are the
client and resource server starters. On Boot 3.5.x the old name is the correct one. The deprecation is
recorded only in the POM `description`, so the old names still resolve on Boot 4 with no warning, and the
project's own getting-started page uses the old one.

Standalone:

```xml
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-oauth2-authorization-server</artifactId>
    <version>1.5.8</version>
</dependency>
```

**Java 17 or higher** is required. The **required Spring Boot and Spring Security versions are not
stated** on the getting-started page, so let the Boot starter manage the version rather than pinning it
yourself, and treat any hand-pinned combination as unverified until it builds and starts.

## The default endpoints

Read from the `AuthorizationServerSettings` source at the 1.5.8 tag. **These are the real defaults**;
paths that appear in the documentation's configurer examples are illustrating customisation, not
stating defaults, which is an easy and consequential thing to misread.

| Endpoint | Default path | Builder method |
| -------- | ------------ | -------------- |
| Authorization | `/oauth2/authorize` | `authorizationEndpoint()` |
| Token | `/oauth2/token` | `tokenEndpoint()` |
| JWK Set | `/oauth2/jwks` | `jwkSetEndpoint()` |
| Token introspection | `/oauth2/introspect` | `tokenIntrospectionEndpoint()` |
| Token revocation | `/oauth2/revoke` | `tokenRevocationEndpoint()` |
| Pushed authorization request | `/oauth2/par` | `pushedAuthorizationRequestEndpoint()` |
| Device authorization | `/oauth2/device_authorization` | `deviceAuthorizationEndpoint()` |
| Device verification | `/oauth2/device_verification` | `deviceVerificationEndpoint()` |
| OIDC UserInfo | `/userinfo` | `oidcUserInfoEndpoint()` |
| OIDC logout | `/connect/logout` | `oidcLogoutEndpoint()` |
| OIDC client registration | `/connect/register` | `oidcClientRegistrationEndpoint()` |

**The issuer has no default and must be set** with `issuer(String)`. Get it right first time: the
issuer value ends up inside every token you have issued, and every resource server validates against
it, so changing it later invalidates the estate.

Each endpoint has its own configurer, and the names follow one pattern:
`OAuth2AuthorizationEndpointConfigurer`, `OAuth2TokenEndpointConfigurer`,
`OAuth2TokenIntrospectionEndpointConfigurer`, `OAuth2TokenRevocationEndpointConfigurer`,
`OAuth2AuthorizationServerMetadataEndpointConfigurer`, `OidcProviderConfigurationEndpointConfigurer`,
`OidcUserInfoEndpointConfigurer`, `OidcLogoutEndpointConfigurer`,
`OidcClientRegistrationEndpointConfigurer`, `OAuth2DeviceAuthorizationEndpointConfigurer`,
`OAuth2DeviceVerificationEndpointConfigurer` and
`OAuth2PushedAuthorizationRequestEndpointConfigurer`.

## The beans you must supply

The getting-started configuration needs seven beans, and knowing what each is for tells you what to
replace for production:

| Bean | Getting-started form | Production concern |
| ---- | -------------------- | ------------------ |
| `SecurityFilterChain` for the server | `OAuth2AuthorizationServerConfigurer.authorizationServer()`, with `.oidc(Customizer.withDefaults())` to enable OIDC, applied through `.with(...)` and scoped by `.securityMatcher(...)` | Keep the server chain separate from your application chain |
| `SecurityFilterChain` for login | `formLogin(Customizer.withDefaults())` | Your real login page, and where MFA lands |
| `UserDetailsService` | `InMemoryUserDetailsManager` | Your user store |
| `RegisteredClientRepository` | `InMemoryRegisteredClientRepository` | Persistent, and administrable |
| `JWKSource<SecurityContext>` | `ImmutableJWKSet` over an `RSAKey` | External key material and rotation |
| `KeyPair` | `KeyPairGenerator.getInstance("RSA")`, 2048 bits, generated at startup | Never generate at startup. See below |
| `JwtDecoder` | `OAuth2AuthorizationServerConfiguration.jwtDecoder(jwkSource)` | Fine as is |
| `AuthorizationServerSettings` | `AuthorizationServerSettings.builder().build()` | Set the issuer explicitly |

A client is registered with `RegisteredClient.withId(...)` and then `clientId`, `clientSecret`,
`clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)`,
`authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)` and
`AuthorizationGrantType.REFRESH_TOKEN`, `redirectUri`, `postLogoutRedirectUri`,
`scope(OidcScopes.OPENID)` and `scope(OidcScopes.PROFILE)`, and
`clientSettings(ClientSettings.builder().requireAuthorizationConsent(true).build())`.

## The quickstart is not production, and the documentation does not say so

This matters enough to enumerate, because the getting-started page **does not carry a production
warning**. It says only that "most users will want to customize the default configuration". Everything
in the following list is in that sample and must not survive into production:

- **`InMemoryUserDetailsManager` with a `user` / `password` account.** A default credential pair in an
  identity provider is the highest-value default credential in your estate.
- **`InMemoryRegisteredClientRepository`.** Clients vanish on restart, and cannot be administered.
- **`{noop}` on the client secret.** Plaintext, and it means the secret is in configuration or in a
  repository.
- **An RSA key pair generated at startup.** This is the important one. **Every restart produces a new
  signing key, so every previously issued token becomes unverifiable**, and in a multi-instance
  deployment each instance signs with a different key, so validation fails at random depending on which
  instance minted the token. It works perfectly on one developer machine and fails immediately behind a
  load balancer.
- **`requireAuthorizationConsent(true)` for a first-party client**, which produces a consent screen your
  own users do not need. Correct for third-party clients, wrong for your own.

## Keys, and the rotation you have to design

You are now the thing whose signing key matters. Three requirements:

- **Key material lives outside the application** and survives restarts: a keystore, a secret manager, or
  a hardware module. Load it, do not generate it.
- **Publish more than one key when rotating.** The JWK Set endpoint can serve several keys, each with a
  `keyID`, so a resource server can validate tokens signed by the outgoing key while new tokens use the
  incoming one. Rotation without overlap invalidates every live token at the moment of the switch.
- **Rotation is a scheduled operation with a rehearsal.** Design it before you need it, because the
  first time you rotate under incident conditions is the worst time to discover the overlap window is
  missing.

## Persistence

Move both the client repository and the authorization store to a database before anything real depends
on this. `RegisteredClientRepository` and `OAuth2AuthorizationService` are the interfaces; JDBC-backed
implementations exist for both. Authorizations include issued tokens and consents, so in-memory storage
means restarting the server signs everyone out and forgets every consent.

Where the schema lives and how it migrates is ordinary application concern; if you have
`postgresql-developer` installed, its Flyway and schema material applies unchanged.

## PKCE and per-client settings

RFC 9700 requires that authorization servers **must** support PKCE, and **must** mitigate PKCE
downgrade attacks "by ensuring that a token request containing a `code_verifier` parameter is accepted
only if a `code_challenge` parameter was present in the authorization request". PKCE (RFC 7636) is
listed among the implemented specifications.

**Enforcement is per client, and it is off by default.** `ClientSettings.builder()` at the 1.5.8 tag
reads:

```java
public static Builder builder() {
    return new Builder().requireProofKey(false).requireAuthorizationConsent(false);
}
```

So `requireProofKey` is `false` for every client you register unless you say otherwise:

```java
RegisteredClient.withId(UUID.randomUUID().toString())
        .clientId("acme-spa")
        .clientSettings(ClientSettings.builder().requireProofKey(true).build())
        // ...
        .build();
```

Note the asymmetry with the client side. `org.springframework.security.oauth2.server.authorization.settings.ClientSettings`
here and `ClientRegistration.ClientSettings` there are genuinely different classes in different modules,
but the method on both is `requireProofKey`, and their **defaults point in opposite directions**: `true`
on a Spring Security 7.1.0 client registration, `false` on a 1.5.8 registered client. Reading one and
inferring the other gets you the wrong answer either way round.

**Require PKCE for every public client, and prefer it for confidential ones.** RFC 9700's downgrade
mitigation quoted above is the reason: an authorization server that accepts a `code_verifier` without
having required a `code_challenge` lets an attacker strip PKCE from a flow that was meant to have it. With
`requireProofKey` at its default, every client you register is one whose PKCE is optional, so the mitigation
is a per-client checkbox rather than a server-wide property. The client-side default behaviour is in
[security-oauth2-oidc.md](security-oauth2-oidc.md).

## What ASVS asks of an authorization server and you have to build

Running your own provider inherits requirements a client never sees. These are the OWASP ASVS 5.0 V10.4,
V10.6 and V10.7 items that are **your** responsibility once you own the server, with the state of play on
1.5.8 as far as this pass established it:

| ASVS 5.0 | Requirement | Where it lands |
| -------- | ----------- | -------------- |
| **10.4.2** (L1) | Authorization code "can be used only once for a token request" | Establish what a second presentation does, and whether it revokes the tokens already issued against that code |
| **10.4.3** (L1) | Code lifetime up to 10 minutes for L1 and L2, up to 1 minute for L3 | A token time-to-live setting per client. Confirm the default before assuming it meets L3 |
| **10.4.8** (L2) | "Verify that refresh tokens have an absolute expiration, including if sliding refresh token expiration is applied." | Sliding expiry is the natural build; the absolute ceiling has to be added deliberately |
| **10.4.12** (L3) | "Verify that for a given client, the authorization server only allows the 'response_mode' value that this client needs to use." | Not a `ClientSettings` field this pass found. Treat as your own validation if you are targeting L3 |
| **10.4.13** (L3) | "Verify that grant type 'code' is always used together with pushed authorization requests (PAR)." | The PAR endpoint exists at `/oauth2/par`. Requiring it per client is a separate question this pass did not answer |
| **10.6.2** (L2) | Mitigate denial of service through forced logout, "By obtaining explicit confirmation from the end-user or, if present, validating parameters in the logout request." | The `/connect/logout` endpoint is the surface |
| **10.7.3** (L2) | "Verify that the user can review, modify, and revoke consents which the user has granted through the authorization server." | **Nothing here provides this.** Consent can be required and recorded; a user-facing screen to review and revoke is yours to build |

**10.7.3 belongs on the "deliberately does not do" list below**, and it is the one most often discovered
late, because consent looks finished the moment the approval screen works. An authorization server that
can grant consent and cannot revoke it fails an L2 assessment on a feature nobody scoped.

## Multi-tenancy and multiple issuers

Multiple issuers **are** supported and **are off by default**. The setting is
`MULTIPLE_ISSUERS_ALLOWED`, defaulting to `false`, changed with `multipleIssuersAllowed(boolean)`.

Two cautions before reaching for it:

- **Enabling multiple issuers means the issuer is derived per request.** Anything derived from the
  request is attacker-influenced until proven otherwise, and the issuer is the value every resource
  server trusts. Establish exactly how it is resolved and constrained before enabling this.
- **Per-tenant issuers are not per-tenant isolation.** Tenant separation still has to be enforced in
  the user store, in consents, in scopes and in the tokens themselves. See
  [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

For a B2B SaaS product whose customers bring their own identity providers, this is very likely the wrong
tool entirely: you want to be a service provider with a registration per customer, not an authorization
server with an issuer per customer.

## What it deliberately does not do

Confirming the boundary, because the gap is where projects stall three months in:

| Not provided | Where it has to come from |
| ------------ | ------------------------- |
| User registration, profile, password reset | Your application, or a user-management product |
| MFA, step-up authentication, WebAuthn | Your login chain, on top of Spring Security |
| Administrative console for clients and users | You build it |
| Account lockout, abuse and bot handling | You build it |
| A compliance-grade audit trail | You build it, from Spring Security events |
| Consent review and revocation by the user | You build it. Consent can be required and recorded, but ASVS 5.0 **10.7.3** wants the user able to review, modify and revoke, and that screen does not exist |
| SAML identity provider | Not in scope at all. It is an OAuth2 and OIDC server |

That last row is worth stating twice. If a customer demands SAML and you have built an OIDC provider,
this project does not close that gap.

## Version notes

**Verified against Spring Authorization Server 1.5.8 on 12/08/2026.** Endpoint defaults come from the
`AuthorizationServerSettings` source at the 1.5.8 tag.

| Concern | Detail |
| ------- | ------ |
| Versions available | 1.5.8 is current stable. 1.4.8, 1.3.7 and 1.2.7 are also maintained lines, and **2.0.0-M2** is a preview. Do not build production on the milestone |
| Java floor | 17 or higher |
| Boot and Security version requirements | **Not stated** on the getting-started page. Let the Boot starter manage them |
| `MULTIPLE_ISSUERS_ALLOWED` | Defaults to `false` |
| Issuer | No default. Must be set with `issuer(String)` |
| `ClientSettings` PKCE | Method is `requireProofKey(boolean)`, and `ClientSettings.builder()` initialises it to **`false`**, read from the source at the 1.5.8 tag. Opposite default to the client side on Spring Security 7.1.0 |
| `response_mode` restriction per client, and requiring PAR per client | **Not verified in this pass.** Both are ASVS L3 items; establish them before claiming L3 |
| OAuth 2.1 | Implemented against a **draft**. Draft-tracking means behaviour can change between minors; read release notes before upgrading |
| Documentation paths | The configurer examples show customised paths such as `/oauth2/v1/authorize`. **Those are not defaults** |

## Gotchas

- Agent builds an authorization server when the requirement was to consume customers' identity
  providers, which is the opposite role
- Agent reads a path from a documentation configurer example and states it as a default. The defaults are
  in `AuthorizationServerSettings`
- Agent ships the getting-started configuration, including a `user` / `password` account in an identity
  provider
- Agent leaves the RSA key pair generated at startup, so every restart invalidates every issued token and
  a multi-instance deployment fails validation at random
- Agent rotates a signing key without an overlap window and invalidates every live token at once
- Agent leaves clients and authorizations in memory, so a restart signs everyone out and forgets consents
- Agent leaves `{noop}` on a client secret
- Agent enables `requireAuthorizationConsent` for first-party clients and shows users a consent screen for
  their own product
- Agent changes the issuer after tokens have been issued, invalidating them everywhere
- Agent enables multiple issuers without establishing how the issuer is resolved from the request
- Agent treats per-tenant issuers as tenant isolation
- Agent registers a client and assumes PKCE is enforced. `requireProofKey` defaults to `false` here, the
  opposite of the client-side default on Spring Security 7.1.0
- Agent reads the client-side `requireProofKey` default and infers the server-side one, or the reverse.
  Same method name, different class, opposite defaults
- Agent ships consent without any way for a user to review or revoke it, and fails ASVS 10.7.3 on a
  feature that was never scoped
- Agent expects user management, MFA or an admin console to be included
- Agent builds this and tells a SAML-only customer it satisfies them

## Related

- [spring-security-oidc.md](spring-security-oidc.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [security-hardening.md](security-hardening.md) · [checklist.md](checklist.md)
