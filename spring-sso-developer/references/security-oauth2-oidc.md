# OAuth 2.0 and OIDC Attack Classes

Each entry gives the vulnerable pattern in plain terms, the Spring-level fix with identifiers read from
the Spring Security 7.1.0 reference documentation, and the normative source. Read
[security-hardening.md](security-hardening.md) first for the two defaults that catch people.

## Authorization code interception

**Vulnerable pattern.** A public client (SPA, mobile, desktop) uses the authorization code grant with
no code challenge. Anything that can observe the redirect, including another application registered for
the same custom URI scheme, replays the code for a token.

**RFC 9700 (BCP 240, January 2025):** "Public clients MUST use PKCE" and, for confidential clients,
"the use of PKCE [RFC7636] is RECOMMENDED, as it provides strong protection against misuse and injection
of authorization codes".
OWASP's OAuth2 sheet goes further: clients "must use the Authorization Code Grant with PKCE
(`response_type=code`) for all client types, including SPAs and native applications."

**The Spring-specific position, and it changed between the versions this skill covers.** The control
point is one flag, `ClientRegistration.clientSettings.requireProofKey`, and its default differs.
Verified from `ClientRegistration.java` at each tag:

| Spring Security | Declaration in `ClientSettings.Builder` | Confidential `authorization_code` client |
| --------------- | --------------------------------------- | ---------------------------------------- |
| **7.1.0**, Boot 4.1.0 | `private boolean requireProofKey = true;` | **PKCE on by default** |
| **6.5.11**, Boot 3.5.16 | `private boolean requireProofKey;`, so `false` | **PKCE off by default** |

In both versions `ClientRegistration.Builder` initialises
`private ClientSettings clientSettings = ClientSettings.builder().build();`, so the builder default is
what every registration gets unless you override it.

**On Boot 4.x, Spring already satisfies RFC 9700's recommendation** for confidential clients, and
writing `requireProofKey(true)` is dead configuration. **On Boot 3.5.x it does not**, and you must set
it. Public clients get PKCE on either version: the documentation states it is applied automatically when
`client-secret` is omitted or empty **and** `client-authentication-method` is `none`
(`ClientAuthenticationMethod.NONE`).

**Two traps remain regardless of version.**

**First, disabling it is a downgrade you must record.** The documentation is explicit that if a provider
does not support PKCE for confidential clients you disable it by setting `requireProofKey` to `false`.
That is sometimes the only way to integrate, and it is a deliberate reduction in protection against code
injection. Record which provider forced it and revisit it, rather than leaving a silent `false` in
configuration.

**Second, the two versions disagree about non-`authorization_code` grants**, which matters when you
share a registration or migrate one:

- **7.1.0** silently forces it off. `validateAuthorizationGrantTypes()` contains
  `this.clientSettings = ClientSettings.builder().requireProofKey(false).build();` when the grant type is
  not `AUTHORIZATION_CODE`.
- **6.5.11** throws instead: `IllegalStateException` with "clientSettings.isRequireProofKey=true is only
  valid with authorizationGrantType=AUTHORIZATION_CODE".

So the same configuration starts on 4.x and fails to start on 3.5.x. PKCE is meaningless for
`client_credentials`, so neither behaviour is wrong, but only one of them tells you.

**If you also run the authorization server**, enforce it there. RFC 9700: "Authorization servers MUST
mitigate PKCE downgrade attacks by ensuring that a token request containing a `code_verifier` parameter
is accepted only if a `code_challenge` parameter was present in the authorization request."

## Authorization code replay, single use, and lifetime

**Vulnerable pattern.** A code that can be redeemed twice turns any leak of it into a full token grant,
even when PKCE is in force, because the second redemption is indistinguishable from the first. Codes leak
through referrer headers, browser history, proxy logs and mis-set `redirect_uri` values, so single use is
what makes the leak survivable rather than fatal.

**ASVS 5.0 V10.4 states three requirements**, all on the authorization server:

| ASVS 5.0 | Requirement | Level |
| -------- | ----------- | ----- |
| **10.4.2** | "Verify that, if the authorization server returns the authorization code in the authorization response, it can be used only once for a token request." | L1 |
| **10.4.3** | "Verify that the authorization code is short-lived. The maximum lifetime can be up to 10 minutes for L1 and L2 applications and up to 1 minute for L3 applications." | L1 |
| **10.4.8** | "Verify that refresh tokens have an absolute expiration, including if sliding refresh token expiration is applied." | L2 |

**Single use alone is not the whole control.** RFC 9700's treatment of code injection assumes that a
second presentation is not merely refused but treated as evidence: the same reasoning as refresh token
reuse detection further down this page. If a code is replayed, the tokens already issued against it
should be revoked, because you cannot tell which presentation was the attacker's.

**Where this lands on Spring.** As a client you get this for free, since the authorization server owns
it. It matters when you run [spring-authorization-server.md](spring-authorization-server.md), or when you
assess a provider: ask whether a replayed code revokes the issued tokens or is simply rejected, because
the two answers differ in what an attacker keeps.

**10.4.8 is the one most often missed in a product**, because sliding expiry is the natural way to build
"keep me signed in" and an absolute ceiling has to be added deliberately. Without it, a refresh token
stolen once is a permanent credential for as long as it keeps being used.

## CSRF on the authorization flow, and `state`

**Vulnerable pattern.** No `state`, or a `state` not bound to the user's session, lets an attacker
deliver their own authorization code to a victim's browser and link accounts.

Spring Security's `oauth2Login()` generates and validates `state`, so this is usually **not** where a
Spring application fails. It fails when someone hand-rolls the callback endpoint instead of using the
filter, and then owns `state` validation without implementing it. **A hand-written
`/login/oauth2/code/*` handler is the signal to look for.**

**Do not swap PKCE in for `state` casually.** RFC 9700: "Clients MUST ensure that the authorization
server supports PKCE before using PKCE for CSRF protection. If an authorization server does not support
PKCE, `state` or `nonce` MUST be used for CSRF protection."

## ID token replay, and `nonce`

**Vulnerable pattern.** An ID token obtained in one session is presented in another. Without a `nonce`
bound to the client session, nothing ties the token to this login attempt.

`nonce` is an OIDC concept rather than a plain OAuth2 one, and OWASP lists it as one of three
acceptable CSRF countermeasures alongside PKCE and `state`. The standard `oauth2Login()` flow handles
it; validating ID tokens by hand does not.

## Open redirect through `redirect_uri`

**Vulnerable pattern.** The authorization server matches `redirect_uri` by prefix, wildcard or
substring. The attacker registers `https://app.example.com.evil.test`, or appends a path that redirects
onward, and the code lands on their host.

**Why prefix matching is exploitable, not merely loose.** Richer and Sanso enumerate the three
algorithms authorization servers actually implement, and the taxonomy is what makes the risk concrete
rather than abstract:

| Algorithm | What it compares | Consequence |
| --------- | ---------------- | ----------- |
| **Exact matching** | Simple string comparison of the whole URI | The only safe one |
| **Allowing subdirectory** | Only the start of the URI. Host and port must match, but any path may be appended | Any path on your own host becomes a valid landing point, including one that redirects onward |
| **Allowing subdomain** | Flexibility in the host part; any subdomain of the registered host is accepted | One compromised or user-controlled subdomain compromises the whole registration |

Their conclusion, from *OAuth 2 in Action* section 9.3, is worth quoting because it predates the
normative text by eight years: **"the only consistently safe validation method for the `redirect_uri`
is exact matching. Although other methods offer client developers desirable flexibility in managing
their application's deployment, they are exploitable."** Wildcards and expression languages have the
same effect regardless of syntax, because "several different requests can match against a single
registered value."

**The two theft mechanisms this opens**, named in the same book at section 7.4:

- **Through the `Referer` header.** The code arrives on a page that loads any third-party resource, and
  the full URL including the code goes out in the `Referer`. The landing page does not have to be
  hostile, merely ordinary.
- **Through an open redirector.** The registered host is legitimate but contains an open redirect, so
  the attacker chains through it and the code leaves your origin without any registration rule being
  broken.

That second one is why an open redirect anywhere on the redirect URI's host is an authentication bug,
not a low-severity finding.

**RFC 9700:** "When comparing client redirection URIs against pre-registered URIs, authorization
servers MUST utilize exact string matching except for port numbers in `localhost` redirection URIs of
native apps." OWASP adds that `http` redirect URIs are forbidden except for native clients on loopback
interfaces, and that "Clients and Authorization Server must not expose URLs that forward the user's
browser to arbitrary URIs obtained from a query parameter."

**The Spring-specific hazard.** `redirect-uri` supports the template variables `{baseUrl}`,
`{baseScheme}`, `{baseHost}`, `{basePort}`, `{basePath}` and `{registrationId}`, resolved from the
incoming request. Behind a reverse proxy or ingress they resolve to the internal scheme, host and port
unless forwarded headers are handled. The symptom is a redirect to `http` or to an internal hostname,
and the fix belongs to the proxy and forwarded-header configuration, not to the OAuth2 config.

## JWT algorithm confusion and `alg: none`

**Vulnerable pattern.** The verifier accepts whatever algorithm the token header names. Two classic
outcomes: `alg: none` with no signature, and an RS256 verifier that accepts HS256, where the attacker
signs with the public key as the HMAC secret.

**Pin the algorithm; never trust the header.**
`spring.security.oauth2.resourceserver.jwt.jws-algorithms` takes a list of trusted algorithms and
**defaults to `RS256`**, which is a safe default. Programmatically:

```java
NimbusJwtDecoder jwtDecoder = NimbusJwtDecoder.withIssuerLocation(this.issuer)
        .jwsAlgorithm(SignatureAlgorithm.RS512)
        .build();
```

The exposure is rarely Spring's default. It is a hand-written verifier, or a decoder built from a raw
secret with nothing constraining the algorithm.

**ASVS 5.0 V9 covers this as an allowlist question rather than a per-algorithm one**, which is the more
durable framing: **9.1.2** "Verify that only algorithms on an allowlist can be used to create and verify
self-contained tokens, for a given context", and **9.1.3** "Verify that key material that is used to
validate self-contained tokens is from trusted pre-configured sources for the token issuer". The second
is the reason `jwk-set-uri` without an issuer is weak: the key source is configured, but nothing ties it
to the issuer whose tokens it validates.

**9.2.2 is the requirement Spring satisfies in a way most engineers never notice**: "Verify that the
service receiving a token validates the token to be the correct type and is meant for the intended
purpose before accepting the token's contents." That is `JwtTypeValidator.jwt()`, which
`JwtValidators.createDefaultWithValidators` prepends for you and which a bare `setJwtValidator` removes
along with everything else.

## Missing `iss` and `aud` validation

**Vulnerable pattern.** A token from a different issuer, or intended for a different resource server,
is accepted because only the signature was checked. In a multi-tenant deployment that is a
tenant-crossing bug rather than a hygiene issue.

**What Spring gives by default.** Setting
`spring.security.oauth2.resourceserver.jwt.issuer-uri` configures `JwtTimestampValidator` plus
`JwtIssuerValidator`, assembled by `JwtValidators.createDefaultWithIssuer(issuerUri)`. Documented
default clock skew is **60 seconds**: "By default, Resource Server configures a clock skew of 60
seconds."

**Audience is not validated by default.** Either set the property:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://idp.example.com
          audiences: https://my-resource-server.example.com
```

or add a validator and **delegate to the defaults**:

```java
OAuth2TokenValidator<Jwt> audience =
        new JwtClaimValidator<List<String>>(JwtClaimNames.AUD, aud -> aud.contains("messaging"));
OAuth2TokenValidator<Jwt> withIssuer = JwtValidators.createDefaultWithIssuer(this.issuerUri);
jwtDecoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(withIssuer, audience));
```

**The trap.** Calling `setJwtValidator` with a bare custom validator **replaces** the default chain, so
issuer and expiry validation are silently dropped. The change looks additive and is subtractive. Always
wrap with `DelegatingOAuth2TokenValidator`.

OWASP puts the obligation on the resource server every time, and the wording is worth reading in full
because it assigns two separate duties:

> "Access tokens are restricted to certain Resource Servers (audience restriction), preferably to a
> single Resource Server. The Authorization Server should associate the access token with certain
> Resource Servers and every Resource Server is obliged to verify, for every request, whether the access
> token sent with that request was meant to be used for that particular Resource Server. If not, the
> Resource Server must refuse to serve the respective request."

The authorization server scopes the token; **the resource server still has to check**, on every request,
and may not delegate that to the issuer. `JwtValidators.createDefaultWithIssuer` does not add an audience
validator, so on Spring this duty is yours by default.

ASVS 5.0 states the same requirement twice, once generically for self-contained tokens and once for
resource servers: **9.2.3** "Verify that the service only accepts tokens which are intended for use with
that service (audience)", and **9.2.4** "Verify that, if a token issuer uses the same private key for
issuing tokens to different audiences, the issued tokens contain an audience restriction that uniquely
identifies the intended audiences." The second is the multi-tenant case: one signing key across
audiences makes the audience claim the only thing separating them.

## Mix-up attacks across multiple authorization servers

**Vulnerable pattern.** A client talking to more than one authorization server receives a code on a
shared callback, cannot tell which server issued it, sends it to the wrong token endpoint, and leaks it.

**RFC 9700** requires one of: the `iss` parameter per **RFC 9207**, an equivalent `iss` value in the
authorization response, or as a fallback "distinct redirection URIs to identify authorization endpoints
and token endpoints."

**Spring gives the fallback for free**, because the default callback path is per registration and
`{registrationId}` is a supported template variable. A single shared callback for every provider throws
that protection away. **Keep one redirect URI per registration.**

## Multiple trusted issuers

For a resource server accepting tokens from several issuers, use an allowlist:

```java
JwtIssuerAuthenticationManagerResolver resolver =
        JwtIssuerAuthenticationManagerResolver.fromTrustedIssuers(
                "https://idp.example.org/issuerOne",
                "https://idp.example.org/issuerTwo");

http.oauth2ResourceServer((oauth2) -> oauth2.authenticationManagerResolver(resolver));
```

The reference documentation states the risk in words worth quoting: **"It would be unsafe to simply
take any issuer and construct an `AuthenticationManager` from it. The issuer should be one that the
code can verify from a trusted source like a list of allowed issuers."**

Dynamic resolution from the token's own `iss` claim with no allowlist means the attacker chooses the
issuer and therefore the signing key. That is a full authentication bypass, not a hardening gap.

## Token leakage, and where tokens live

**Deprecated by design.** RFC 9700: clients "SHOULD NOT use the implicit grant (response type `token`)
or other response types issuing access tokens in the authorization response". Tokens in the URL
fragment leak through browser history, `Referer` headers and server logs.

**Resource owner password credentials is not a fallback.** RFC 9700: it "MUST NOT be used. This grant
type insecurely exposes the credentials of the resource owner to the client." OWASP repeats it.

**Browser storage.** Where the frontend holds a token, `localStorage` is readable by any script on the
origin, so one XSS becomes account takeover with no expiry. The alternatives are an `HttpOnly` `Secure`
`SameSite` cookie, or a backend-for-frontend that keeps tokens server-side and gives the browser only a
session cookie. **Prefer the BFF shape for a new build**, because it removes the token from the browser
entirely rather than protecting it there.

**Sender-constraining.** RFC 9700: "Authorization and resource servers SHOULD use mechanisms for
sender-constraining access tokens, such as mutual TLS for OAuth 2.0 [RFC8705] or OAuth 2.0 Demonstrating
Proof of Possession (DPoP) [RFC9449]". Spring Security 7.1 documents DPoP-bound access token support in
its resource server section.

## Refresh token rotation and reuse detection

**RFC 9700:** "Refresh tokens for public clients MUST be sender-constrained or use refresh token rotation
as described in Section 4.14." For confidential clients, RFC 6749 already binds the refresh token to the
issuing client.

**Rotation without reuse detection achieves little.** The value of rotation is that presenting a
*superseded* refresh token is evidence of theft, which should invalidate the entire token family and
force re-authentication. Rotation that issues a new token and forgets the old one detects nothing.

On the Spring client side refresh is automatic: when
`OAuth2AuthorizedClient.getRefreshToken()` is present and the access token has expired,
`RefreshTokenOAuth2AuthorizedClientProvider` refreshes it using
`RestClientRefreshTokenTokenResponseClient`. **Rotation and reuse detection are the authorization
server's responsibility**, so if you consume a third-party IdP, confirm it does them rather than
assuming.

## Scope, least privilege, and the confused deputy

**Vulnerable pattern.** One broad-scoped token used everywhere, and a resource server that accepts any
token from a trusted issuer without checking what it is for. A token minted for a low-value service is
replayed against a high-value one.

OWASP: privileges "should be restricted to the minimum required"; tokens should be audience-restricted
to a specific resource server, preferably a single one; and resource servers must verify scope or
authorization details per request. In multi-tenant SaaS this is the route by which one customer's token
reaches another customer's data, so **treat audience, scope and tenant claims as authorization inputs,
not as metadata**.

## Client authentication

OWASP: "It is recommended to use asymmetric (public-key based) methods for client authentication such
as mTLS or `private_key_jwt`." A shared `client_secret` in configuration is the weakest acceptable
option, and it is the one every quickstart uses. Where a provider supports `private_key_jwt`, prefer it,
because a leaked configuration file then does not hand over the client identity.

## SSRF through JWKS and discovery fetching

**Vulnerable pattern.** The application fetches a JWKS URI or a discovery document derived from
attacker-influenced input, from inside your network.

This is the same requirement as the issuer allowlist above, seen from the network rather than the token:
**if an attacker chooses the issuer, they choose a URL your server will fetch.** Pair the issuer
allowlist with egress restrictions so identity-provider fetches can only reach known hosts.

**Provenance:** the issuer-allowlist requirement is quoted from Spring's documentation above. The
egress-control recommendation is engineering judgement here, not a quotation, and is marked as such.

## Consent phishing and scope creep

**Vulnerable pattern.** A third-party application requests scopes far beyond its function behind a
consent screen that looks official. The user grants it and the attacker holds a legitimate token.

OWASP: authorization servers must not let clients influence `client_id`, `sub`, or claims that could
impersonate resource owners. Beyond that this is a product problem: show the requesting client's
verified identity, keep scope descriptions specific and human-readable, and give administrators a path
to block or pre-approve applications for the whole organisation.

## Version notes

**Read from the Spring Security 7.1.0 reference documentation on 12/08/2026.** Specifications: RFC 9700
(BCP 240, January 2025), RFC 6749, RFC 7636, RFC 9207, RFC 8705, RFC 9449, plus the OWASP OAuth2 cheat
sheet.

| Concern | Detail |
| ------- | ------ |
| **PKCE for confidential clients** | **Default flipped between the covered versions.** `requireProofKey` is `true` in 7.1.0 and `false` in 6.5.11, both read from `ClientRegistration.java`. Never state this default without naming the version |
| Non-`authorization_code` grant with `requireProofKey` set | 7.1.0 silently forces it off; 6.5.11 throws `IllegalStateException` |
| `jws-algorithms` default | `RS256` |
| JWT clock skew default | 60 seconds, documented |
| Default JWT validator chain | Richer than the two validators commonly cited. `JwtValidators.createDefaultWithIssuer` delegates to `createDefaultWithValidators`, which also prepends `JwtTypeValidator.jwt()` and `X509CertificateThumbprintValidator` alongside `JwtTimestampValidator`. **And Boot 4.1.0 does not call `createDefaultWithIssuer` at all**: its `JwtDecoderConfiguration` builds a validator list and calls `createDefault()` or `createDefaultWithValidators(...)`. The practical rule is unchanged, wrap with `DelegatingOAuth2TokenValidator`, but do not describe the default chain as two validators |
| Token response clients | `RestClient`-based in current versions: `RestClientRefreshTokenTokenResponseClient`, `RestClientClientCredentialsTokenResponseClient`. Older names in pre-6.4 material differ |
| DPoP | Documented for Spring Security 7.1's resource server. Do not assume it on 6.5.x without checking |
| RFC 9700 | Supersedes the earlier OAuth 2.0 Security BCP drafts. If a source predates January 2025, its PKCE and mix-up guidance may be weaker than current normative text |

## Gotchas

- Agent states the PKCE default without establishing the version. It is on for confidential clients on
  Spring Security 7.x and off on 6.5.x
- Agent writes `requireProofKey(true)` on Boot 4.x, which is dead configuration, and reports it as a fix
- Agent sets `requireProofKey(false)` to make a provider work and leaves no record that protection was
  deliberately reduced
- Agent moves a registration with `requireProofKey(true)` to a non-`authorization_code` grant. On 7.1.0
  it is silently forced off; on 6.5.11 the application fails to start
- Agent hand-writes the OAuth2 callback endpoint and thereby owns `state` validation, then omits it
- Agent adds a custom `JwtValidator` through `setJwtValidator` and silently removes issuer and expiry
  validation, believing the change was additive
- Agent leaves audience validation off because the signature verifies, so a token minted for another
  service is accepted
- Agent constructs an `AuthenticationManager` from the token's own `iss` claim, letting the attacker
  choose the signing key
- Agent configures one shared callback URI for every provider, discarding the mix-up countermeasure
  Spring provides through `{registrationId}`
- Agent relies on `redirect-uri` templates behind a proxy and ships a redirect to `http` or an internal
  host
- Agent pins no algorithm on a hand-built decoder, leaving algorithm confusion open
- Agent implements refresh rotation with no reuse detection, so a stolen refresh token is never noticed
- Agent stores tokens in `localStorage`, turning any XSS into a durable account takeover
- Agent reaches for the implicit grant or the password grant for a legacy client. Both are excluded by
  current normative text
- Agent treats scope as descriptive metadata rather than as an authorization decision

## Related

- [security-hardening.md](security-hardening.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [spring-security-oidc.md](spring-security-oidc.md) · [spring-authorization-server.md](spring-authorization-server.md) · [checklist.md](checklist.md)
