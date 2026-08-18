# Spring Security as an OIDC Client and Resource Server

Identifiers below were read from the Spring Security **7.1.0** reference documentation and, where noted, the 7.1.0
source at the version tag. The unversioned reference path currently serves 7.1.0, so everything here is 7.1.0.

## What this file owns

**How to configure the client and resource server correctly**: the shape you are building, how a provider is
wired, what the principal is, how authorities are produced, how logout works, and which defaults are absent
rather than safe. It does **not** own attack detail: PKCE, `state`, `nonce`, redirect URI matching, algorithm
confusion, mix-up, token storage, refresh rotation and scope abuse live in
[security-oauth2-oidc.md](security-oauth2-oidc.md), tenancy in [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

## Minimum setup

Spring Security's OAuth 2.0 support is **three** feature sets: OAuth2 Resource Server, OAuth2 Client and OAuth2
Authorization Server. **OAuth2 Login is not a fourth**: it "requires OAuth2 Client in order to function."

| Building | Dependency | Boot starter |
| -------- | ---------- | ------------ |
| Login, or calling an API as a user | `spring-security-oauth2-client` | `spring-boot-starter-security-oauth2-client` |
| Accepting bearer tokens | `spring-security-oauth2-resource-server` | `spring-boot-starter-security-oauth2-resource-server` |

**Use the `security-` prefixed starter names.** The older `spring-boot-starter-oauth2-client` and
`spring-boot-starter-oauth2-resource-server` are **deprecated across the whole Boot 4 line, from 4.0.0
onwards**, each "in favor of" the `spring-boot-starter-security-oauth2-` form. The same rename applies to
the authorization server starter. The deprecation is stated only in the POM `description`, which is where
nobody looks: the 4.0.0 and 4.1.0 POMs read "Starter for using Spring Security's OAuth2/OpenID Connect
client features (deprecated in favor of spring-boot-starter-security-oauth2-client)" while 3.5.16 has the
same sentence without the clause. So on Boot 3.5.x the old names are simply correct, and on any Boot 4.x
they resolve and build without a warning. Almost every tutorial and book still uses them.

## The three shapes

Decide the shape first: choosing wrong yields an application that authenticates and still cannot do its job.

### Shape 1: login client

`oauth2Login()` logs users in, adding two endpoints plus a generated login page at `/login`.

| Endpoint | Default path, and the constant that defines it |
| -------- | --------------------------------------------- |
| Login initiation | `/oauth2/authorization/{registrationId}`, from `OAuth2AuthorizationRequestRedirectFilter.DEFAULT_AUTHORIZATION_REQUEST_BASE_URI + "/{registrationId}"` |
| Redirection (callback) | `/login/oauth2/code/*`, concretely `/login/oauth2/code/{registrationId}`, from `OAuth2LoginAuthenticationFilter.DEFAULT_FILTER_PROCESSES_URI` |

```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .authorizeHttpRequests((authorize) -> authorize.anyRequest().authenticated())
        .oauth2Login(Customizer.withDefaults());
    return http.build();
}
```

### Shape 2: resource server

No browser, no session, no login page: a bearer token arrives and is validated.

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://idp.example.com
          audiences: https://api.example.com
```

`issuer-uri` alone configures issuer and timestamp validation, with 60 second clock skew and
`jws-algorithms` defaulting to `RS256`. A validator passed to `setJwtValidator` must be wrapped in
`DelegatingOAuth2TokenValidator` or it replaces the chain.

**The full property set**, read from `OAuth2ResourceServerProperties.Jwt` at both tags, because half of it
is the half that saves you writing a converter:

| Property | 3.5.16 | 4.1.0 | Purpose |
| -------- | ------ | ----- | ------- |
| `issuer-uri` | yes | yes | Discovery, and the issuer to validate against |
| `jwk-set-uri` | yes | yes | Keys without discovery, so **no issuer validation** |
| `public-key-location` | yes | yes | A single local public key |
| `jws-algorithms` | yes | yes | Algorithm allowlist, defaults to `RS256` |
| `audiences` | yes | yes | Adds audience validation |
| `authorities-claim-name` | yes | yes | Which claim holds authorities |
| `authority-prefix` | yes | yes | Prefix applied to each, default `SCOPE_` |
| `authorities-claim-delimiter` | yes | yes | Split for string-valued claims, default a space |
| `principal-claim-name` | yes | yes | Which claim becomes `Authentication#getName` |
| `authorities-claim-expressions` | **no** | yes | Boot 4 only |

**This is the part that changes what you write.** On a resource server, mapping a provider's non-standard
role claim is usually configuration, not code:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_ABC123
          authorities-claim-name: "cognito:groups"
          authority-prefix: "ROLE_"
```

Boot's `JwtConverterConfiguration` builds a `JwtAuthenticationConverter` from those properties, and
`JwtGrantedAuthoritiesConverter` handles a claim whose value is a JSON array directly, so an array of
group names arrives as `ROLE_`-prefixed authorities with no Java involved. `hasRole('ADMIN')` then works
against a `cognito:groups` entry of `ADMIN`.

**Three limits, and they are why the converter route still exists.** The properties take **one** claim
name, so a provider that splits roles across two claims needs code. They cannot reshape a value, so
Keycloak's `realm_access.roles` is out of reach because the roles are nested inside an object rather than
at the top level. And `JwtConverterConfiguration` is `@ConditionalOnMissingBean(JwtAuthenticationConverter.class)`,
so **defining your own converter bean silently disables every one of these properties**: set both and the
YAML looks live while doing nothing.

**None of this applies to a login client.** Shape 1's authorities come from the access token's scopes via
`OidcUserService`, which these properties do not touch, so there the mapper or `OAuth2UserService` route
below is the only option. Check which shape you are in before reaching for either.

**Two corrections to the way this chain is usually described.** First, it is **not** two validators:
`JwtValidators.createDefaultWithIssuer` delegates to `createDefaultWithValidators`, which also prepends
`JwtTypeValidator.jwt()` and `X509CertificateThumbprintValidator` alongside `JwtTimestampValidator`.
Second, **Boot does not call `createDefaultWithIssuer`**: on Boot 4.1.0 its `JwtDecoderConfiguration`
assembles a validator list and calls `createDefault()` or `createDefaultWithValidators(...)`. So treat
`createDefaultWithIssuer` as the API you use when building a decoder yourself, not as a description of
what Boot did.

### Shape 3: login client that also calls an API as the user

`oauth2Client()` obtains tokens for calling protected resources and provides **no login mechanism**. The
documentation says of its example: "The above example does not provide a way to log users in. You can use
any other login mechanism (such as `formLogin()`)." So pair it with `formLogin()` or with
`oauth2Login()`.

```java
http
    .oauth2Login(Customizer.withDefaults())
    .oauth2Client(Customizer.withDefaults());
```

**The only difference the documentation draws between the three arrangements is `scope`**, which "combines the
standard scopes `openid` and `profile` with the custom scopes `message.read` and `message.write`". One
`ClientRegistration` serves both, so do not create a second one for the API, and do not hard-code its id when
calling: the documented pattern is a `ClientRegistrationIdResolver` returning
`((OAuth2AuthenticationToken) authentication).getAuthorizedClientRegistrationId()` from the current
`SecurityContextHolder` authentication and `null` otherwise, set on `OAuth2ClientHttpRequestInterceptor` through
`setClientRegistrationIdResolver`. The DSLs differ: `oauth2Client()` has `authorizationCodeGrant(...)` where
`oauth2Login()` has `authorizationEndpoint(...)` and `tokenEndpoint(...)`, and **no `userInfoEndpoint`**.

**Running `oauth2ResourceServer()` and `oauth2Login()` in one application is not addressed anywhere in the
OAuth2 sections of the reference.** Any claim about bearer-token versus session precedence, or about needing
separate `SecurityFilterChain` beans or a `securityMatcher` for it, is **not verified**. Split the roles, test
the split, and call the arrangement unattested rather than citing Spring for it.

## Configuring a provider by discovery

**Use discovery**: it is the only route that populates the metadata OIDC logout depends on. The property is
`spring.security.oauth2.client.provider.[providerId].issuer-uri`, under the **provider** block, not the registration
block; it maps to `providerDetails.issuerUri` and triggers OIDC Provider Configuration or RFC 8414 discovery.

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          my-oidc-client:
            provider: my-idp
            client-id: ${OIDC_CLIENT_ID}
            client-secret: ${OIDC_CLIENT_SECRET}
            authorization-grant-type: authorization_code
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
            scope: openid, profile, email
        provider:
          my-idp:
            issuer-uri: https://idp.example.com
```

- **`provider: my-idp`** lets the registration id and provider id differ, so one provider can back several
  registrations.
- **`openid` in `scope` is load-bearing.** It "instructs Spring Security to use OIDC-specific components (such
  as `OidcUserService`)"; without it you get `DefaultOAuth2UserService` and stop being an OIDC client.
- **`redirect-uri` is a template**: `{baseUrl}`, `{baseScheme}`, `{baseHost}`, `{basePort}`, `{basePath}`,
  `{registrationId}`, resolved from the incoming request. Keep one per registration, the RFC 9700 mix-up fallback.
- **PKCE for a confidential client depends on your version.**
  `ClientRegistration.clientSettings.requireProofKey` defaults to `true` on Spring Security 7.1.0 and
  `false` on 6.5.11, so Boot 4.x needs nothing and Boot 3.5.x needs it set. No Boot property for it is
  verified, so set it in code where you need to. See [security-oauth2-oidc.md](security-oauth2-oidc.md).

### Other ways to register

**Explicit endpoints**, when no metadata is published: the provider block also accepts `authorization-uri`,
`token-uri`, `user-info-uri`, `user-name-attribute` and `jwk-set-uri`. A fallback, not a preference, because
`configurationMetadata` is populated only with `issuer-uri`, so this costs you OIDC logout.

**In code**, `ClientRegistrations` has exactly **three** public static factory methods in 7.1.0, all returning
`ClientRegistration.Builder`: `fromIssuerLocation(String)`, `fromOidcIssuerLocation(String)` and
`fromOidcConfiguration(Map<String, Object>)`. `fromIssuerLocation` probes, stopping at the first 200, the issuer plus
`/.well-known/openid-configuration`, then `/.well-known/openid-configuration/{path}` (RFC 8414), then
`/.well-known/oauth-authorization-server/{path}`. `fromOidcIssuerLocation` probes only the first.

The default repository is `InMemoryClientRegistrationRepository`, a Boot-registered `@Bean` read through
`findByRegistrationId(String)`. **Replace it and you must also implement `Iterable<ClientRegistration>`**, which
`DefaultLoginPageGeneratingFilter` needs "to show links for configured OAuth Clients". A bare one starts fine and
renders a login page with no provider links.

## The principal, and reading claims

After OIDC login the `Authentication` is an `OAuth2AuthenticationToken` and its principal is an `OidcUser`, an
interface extending `OAuth2User` and `IdTokenClaimAccessor` that declares exactly three methods.

```java
OidcUser user = (OidcUser) authentication.getPrincipal();
Map<String, Object> claims = user.getClaims();   // the claim map
OidcIdToken idToken = user.getIdToken();         // the ID token
OidcUserInfo userInfo = user.getUserInfo();      // @Nullable: null check it
```

`getUserInfo()` is `@Nullable` in the 7.1.0 source, so **null-check it every time**: a UserInfo request does not
always happen, and code that dereferences it blindly works against one provider and throws against the next.
Read named claims from `getClaims()` unless you have confirmed the typed accessor name inherited from
`IdTokenClaimAccessor`. `@AuthenticationPrincipal OidcUser` is **not verified** against the OAuth2 Login pages,
which document claim access only through `OidcUser`, `OidcUserAuthority` and `OAuth2UserAuthority`.

ID token signatures are verified by `OidcIdTokenDecoderFactory`, a `JwtDecoderFactory<ClientRegistration>`
`@Bean`, default **RS256**, changed with `setJwsAlgorithmResolver(Function<ClientRegistration, JwsAlgorithm>)`.
For MAC algorithms such as `HS256` the `client-secret` is the symmetric verification key.

## Mapping claims to authorities

**This is where most login integrations are declared finished and are not.** `OidcUser.getAuthorities()` holds
authorities "populated from `OAuth2UserRequest.getAccessToken().getScopes()` and prefixed with `SCOPE_`", and
`OAuth2AuthenticationToken.getAuthorities()` "is used for authorizing requests". So **the access token's scopes
become authorities and no ID token claim does**: a `groups` claim is invisible to `hasRole('ADMIN')` with no
warning, so login works while every role rule denies. There are exactly **two** documented routes.

**`FACTOR_AUTHORIZATION_CODE` lives on the `Authentication`, not on the user**, and the distinction has
consequences. `OAuth2LoginAuthenticationProvider` on 7.1.0 does this:

```java
Collection<GrantedAuthority> mappedAuthorities = new LinkedHashSet<>(
        this.authoritiesMapper.mapAuthorities(authorities));
mappedAuthorities.add(FactorGrantedAuthority.fromAuthority(AUTHORITY));
```

The factor authority is added **after** your `GrantedAuthoritiesMapper` has run and is passed to the
`OAuth2LoginAuthenticationToken`, so a mapper cannot see it, cannot suppress it, and code reading
`((OidcUser) principal).getAuthorities()` will never find it. Read authorities from the `Authentication`
when you need the complete set. The constant is
`FactorGrantedAuthority.AUTHORIZATION_CODE_AUTHORITY`, whose value is `"FACTOR_AUTHORIZATION_CODE"`.

### Route 1: a GrantedAuthoritiesMapper

The mapper is handed `OidcUserAuthority` with the authority string `OIDC_USER`, or `OAuth2UserAuthority` with `OAUTH2_USER`.

```java
private GrantedAuthoritiesMapper userAuthoritiesMapper() {
    return (authorities) -> {
        Set<GrantedAuthority> mapped = new HashSet<>(authorities);
        for (GrantedAuthority authority : authorities) {
            if (authority instanceof OidcUserAuthority oidc) {
                mapped.addAll(authoritiesFrom(oidc.getIdToken(), oidc.getUserInfo()));
            }
            else if (authority instanceof OAuth2UserAuthority oauth2) {
                mapped.addAll(authoritiesFrom(oauth2.getAttributes()));
            }
        }
        return mapped;
    };
}
```

Wire it with `.oauth2Login((oauth2) -> oauth2.userInfoEndpoint((userInfo) ->
userInfo.userAuthoritiesMapper(this.userAuthoritiesMapper())))`. The documentation's explicit example uses a
**private method**; registering a `GrantedAuthoritiesMapper` `@Bean` is a **separate** arrangement, "automatically
applied to the configuration" with `oauth2Login(Customizer.withDefaults())` and no `userInfoEndpoint` call at
all. Pick one. Whether the bean must be named `userAuthoritiesMapper` or is resolved by type is **not stated**, so
name it as the documentation does if the `@Bean` route has no effect. Map onto **your** authority names, never a
customer's raw group names.

### Route 2: delegate to an OAuth2UserService

Use this when the mapping needs more than the claims present, such as a local role lookup keyed on `sub`. Inside
`userInfoEndpoint`, `oidcUserService(...)` takes `OAuth2UserService<OidcUserRequest, OidcUser>` and
`userService(...)` takes `OAuth2UserService<OAuth2UserRequest, OAuth2User>`. `OidcUserService` "leverages the
`DefaultOAuth2UserService` when requesting the user attributes at the UserInfo Endpoint", so delegate rather than
reimplement, then rebuild the principal preserving the user-name attribute:

```java
ProviderDetails providerDetails = userRequest.getClientRegistration().getProviderDetails();
String userNameAttributeName = providerDetails.getUserInfoEndpoint().getUserNameAttributeName();
if (StringUtils.hasText(userNameAttributeName)) {
    oidcUser = new DefaultOidcUser(mappedAuthorities, oidcUser.getIdToken(), oidcUser.getUserInfo(), userNameAttributeName);
}
else {
    oidcUser = new DefaultOidcUser(mappedAuthorities, oidcUser.getIdToken(), oidcUser.getUserInfo());
}
```

**Do not skip the branch**: dropping the four-argument form when `user-name-attribute` is configured changes which
claim identifies the user, a silent identity bug.

To change UserInfo request or response handling, give `OidcUserService.setOauth2UserService()` a configured
`DefaultOAuth2UserService`, whose customisation points are `setRequestEntityConverter(...)`, default
`OAuth2UserRequestEntityConverter`, and `setRestOperations(...)`, default a `RestTemplate` with
`OAuth2ErrorResponseErrorHandler`. **Keep that error handler if you replace the `RestOperations`**, or provider
errors stop becoming `OAuth2Error`.

## Logout

Clearing your own session is one of three jobs; alone, the next click at the provider logs the user back in.
RP-initiated logout is `OidcClientInitiatedLogoutSuccessHandler`, set as `logout().logoutSuccessHandler(...)`.

```java
private LogoutSuccessHandler oidcLogoutSuccessHandler(ClientRegistrationRepository clients) {
    OidcClientInitiatedLogoutSuccessHandler handler =
            new OidcClientInitiatedLogoutSuccessHandler(clients);
    handler.setPostLogoutRedirectUri("{baseUrl}");   // destination after logout at the provider
    return handler;
}
```

`setPostLogoutRedirectUri` takes the same template variables as `redirect-uri`: `{baseScheme}`, `{baseHost}`,
`{basePort}`, `{basePath}`, `{baseUrl}`. **The operative coupling**: the handler reads the literal metadata key
`end_session_endpoint`, which lives in `configurationMetadata`, populated only when `issuer-uri` is configured.

**And it fails silently.** In the 7.1.0 source it falls back to `super.determineTargetUrl()`, the ordinary logout
success URL, when `end_session_endpoint` is absent **or** when the `Authentication` is not an
`OAuth2AuthenticationToken` whose principal is an `OidcUser`. No exception, no log: the user is logged out locally
and still logged in at the provider, which reads to them as logout being broken and to you as logout working. It
appends `id_token_hint`, and `post_logout_redirect_uri` when configured. **Test it as a behaviour**: log out,
return to `/oauth2/authorization/{registrationId}`, and assert the provider prompts for credentials again.

### Back-channel logout, which 7.1.0 does implement

RP-initiated logout above depends on the browser completing a redirect chain. Back-channel logout does
not: the provider calls your application server to server when a session ends anywhere in its estate,
which is the only mechanism that propagates a logout the user performed at the provider or at a sibling
application. Spring Security documents it as "OpenID Connect 1.0 Back-Channel Logout":

```java
@Bean
OidcBackChannelLogoutHandler oidcLogoutHandler() {
    return new OidcBackChannelLogoutHandler();
}

@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests((authorize) -> authorize.anyRequest().authenticated())
        .oauth2Login(Customizer.withDefaults())
        .oidcLogout((logout) -> logout.backChannel(Customizer.withDefaults()))
        .build();
}
```

That stands up `/logout/connect/back-channel/{registrationId}`, which the provider requests to invalidate
a session. **Register that URL with the provider**; nothing discovers it for you.

**Four preconditions, three of which fail silently.**

| Precondition | Documented as | What happens if you miss it |
| ------------ | ------------- | --------------------------- |
| `oauth2Login` also configured | "`oidcLogout` requires that `oauth2Login` also be configured." | Configuration error |
| Session cookie named `JSESSIONID` | "`oidcLogout` requires that the session cookie be called `JSESSIONID` in order to correctly log out each session through a backchannel." | Sessions are not invalidated |
| `HttpSessionEventPublisher` bean | Needed so `HttpSession#invalidate` removes the session from the registry | Stale `OidcSessionInformation` accumulates |
| A shared `OidcSessionRegistry` | Default stores the provider-to-client session links **in memory** | Logout tokens invalidate nothing across instances |

**On Spring Session the cookie name is wrong by default**, since Spring Session names it `SESSION`, so the
two features silently disagree until you say so:

```java
@Bean
OidcBackChannelLogoutHandler oidcLogoutHandler(OidcSessionRegistry oidcSessionRegistry) {
    OidcBackChannelLogoutHandler logoutHandler = new OidcBackChannelLogoutHandler(oidcSessionRegistry);
    logoutHandler.setSessionCookieName("SESSION");
    return logoutHandler;
}
```

**The in-memory registry is the production trap**, and it is the same shape as SAML replay detection: a
logout token delivered to instance B cannot invalidate a session held by instance A, so behind a load
balancer back-channel logout appears to work in testing and propagates to roughly one instance in *n*.
Implement `OidcSessionRegistry` over shared storage, whose three methods are `saveSessionInformation`,
`removeSessionInformation(String clientSessionId)` and `removeSessionInformation(OidcLogoutToken token)`,
the last resolving by session id when present and by subject otherwise.

**ASVS 5.0 adds a requirement that the mechanism creates**, and it cuts against enabling this
thoughtlessly: **10.5.5** (L2) "Verify that, when using OIDC back-channel logout, the relying party
mitigates denial of service through forced logout and cross-JWT confusion." An endpoint that terminates
sessions on request is an availability surface, and the logout token must be validated as a logout token
specifically, not merely as a well-signed JWT from a trusted issuer. Treat the endpoint as
security-relevant input handling, rate limit it, and do not exempt it from monitoring.

**Which to use.** Back-channel where the provider supports it and you can give it shared session storage,
because it is the only one that propagates logout you did not initiate. RP-initiated as well, not
instead, because it is what a user clicking "sign out" in your application expects. Neither removes the
argument for short session lifetimes in
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

## Multi-issuer resource server

```java
JwtIssuerAuthenticationManagerResolver resolver =
        JwtIssuerAuthenticationManagerResolver.fromTrustedIssuers(
                "https://idp.example.org/issuerOne",
                "https://idp.example.org/issuerTwo");

http.oauth2ResourceServer((oauth2) -> oauth2.authenticationManagerResolver(resolver));
```

`fromTrustedIssuers` is an allowlist and that is the whole point: resolving the issuer from the token's own `iss`
claim lets the attacker choose the signing key, and choose a URL your server will fetch. Accepting a token is not
authorising it either: in a multi-tenant product the issuer identifies the tenant, so bind it and check per request.

## What you do not get out of the box

| Assumed present | Reality |
| --------------- | ------- |
| Roles from an ID token claim | On a **login client**, authorities are `SCOPE_`-prefixed access token scopes, with `FACTOR_AUTHORIZATION_CODE` added to the `Authentication` on 7.1.0. Without a mapper, `anyRequest().authenticated()` is the only rule that can pass, which is authentication mistaken for authorization. On a **resource server**, `authorities-claim-name` plus `authority-prefix` often does the whole job with no code |
| PKCE for a confidential client | **Version-dependent.** `requireProofKey` defaults to `true` on 7.1.0 and `false` on 6.5.11, read from `ClientRegistration.java` at both tags. Public clients get it either way when the secret is omitted or empty and `client-authentication-method` is `none` |
| Audience validation on the resource server | Set `audiences`, or wrap a validator in `DelegatingOAuth2TokenValidator` |
| Provider metadata | `configurationMetadata` is populated only with `issuer-uri`, so without it there is no `end_session_endpoint` and logout degrades to local-only in silence |
| Provider agreement with changed paths | A new callback needs the `redirectionEndpoint` `baseUri`, `ClientRegistration.redirectUri` **and** re-registration at the provider |

## What the quickstart does that production must not

| Quickstart | Production |
| ---------- | ---------- |
| `client-secret` inline in `application.yml` | Inject from the environment or a secret manager, and prefer `private_key_jwt` or mTLS where the provider supports it |
| One in-memory registration | Right for a single corporate integration, wrong for per-customer SSO, which resolves registrations per tenant |
| The generated `/login` page | It lists every configured provider by client name to anonymous visitors, leaking who your customers are. Use `loginPage` plus home-realm discovery |
| `{baseUrl}` with no forwarded-header handling | Correct on `localhost`, and behind an ingress it yields a redirect to `http` or an internal hostname |
| Whatever scopes come back | Scope is an authorization input: assert the ones you require |

## Version notes

Boot 4.1.0 manages Spring Security 7.1.0, Boot 4.0.0 manages 7.0.0, Boot 4.0.7 manages 7.0.6 and Boot 3.5.16
manages 6.5.11, so the 3.5.x line is on 6.5.x. Spring Security 7.1.0 requires Java 17 or higher.

| Concern | Detail |
| ------- | ------ |
| `FACTOR_AUTHORIZATION_CODE` | A Spring Security **7.x** factor authority granted once OAuth2 login completes. It did not exist in 6.5.x, so Boot 3.5.x guidance must not mention it |
| Defaults | `OidcIdTokenDecoderFactory` and resource server `jws-algorithms` both default to `RS256`; resource server clock skew is 60 seconds. `redirect-uri` has a documented template, `"{baseUrl}/login/oauth2/code/{registrationId}"`, not a quotable default |
| `ClientRegistrations` | **Three** factory methods in 7.1.0, including `fromOidcConfiguration(Map)`. Material naming only two is out of date |
| Removed APIs | `WebSecurityConfigurerAdapter` and `authorizeRequests()` were removed in Spring Security 6, so any example using them predates every supported version |
| Back-channel logout | **Implemented on 7.1.0.** `OidcBackChannelLogoutHandler`, the `oidcLogout().backChannel(...)` DSL and the endpoint `/logout/connect/back-channel/{registrationId}`, all from the logout reference page. Requires `oauth2Login`, a `JSESSIONID` session cookie unless `setSessionCookieName` says otherwise, an `HttpSessionEventPublisher` bean, and a shared `OidcSessionRegistry` to work on more than one instance |
| Client-side `ClientSettings` | `ClientRegistration.Builder.clientSettings(ClientSettings)`, where `ClientSettings` is a **nested class of `ClientRegistration`**. Same simple name as Spring Authorization Server's `ClientSettings` and a different class, but the method on both is `requireProofKey` |
| Resource server authority properties | `authorities-claim-name`, `authority-prefix`, `authorities-claim-delimiter` and `principal-claim-name` on both versions; `authorities-claim-expressions` on 4.1.0 only. Wired by `JwtConverterConfiguration`, which is `@ConditionalOnMissingBean(JwtAuthenticationConverter.class)` |
| `CommonOAuth2Provider` | **Five members on 7.1.0**: `GOOGLE`, `GITHUB`, `FACEBOOK`, `X`, `OKTA`. **Four on 6.5.11**, without `X`. No enterprise provider is among them, so Entra ID, Keycloak, Auth0, Cognito and Ping all need `issuer-uri`. Its internal default redirect template is `"{baseUrl}/{action}/oauth2/code/{registrationId}"`, with `{action}`, which is not the `login`-fixed form the property documentation shows |
| Not verified in this pass | `@AuthenticationPrincipal` on an `OidcUser` parameter, and a kebab-case property for the UserInfo authentication method |

## Gotchas

- Agent configures `oauth2Client()` and expects users to log in. It provides no login mechanism
- Agent puts `issuer-uri` under the registration block. It belongs under the provider block
- Agent drops `openid` from `scope`, silently swapping `OidcUserService` for `DefaultOAuth2UserService`
- Agent expects a `groups` or `roles` claim to satisfy `hasRole(...)` with no mapper configured
- Agent merges the two authority-mapping routes into a `@Bean`-plus-DSL example that is nowhere in the docs
- Agent calls `getUserInfo()` with no null check. It is `@Nullable`
- Agent omits the `userNameAttributeName` branch when rebuilding `DefaultOidcUser`, changing user identity
- Agent replaces `DefaultOAuth2UserService`'s `RestOperations` and loses `OAuth2ErrorResponseErrorHandler`
- Agent configures OIDC logout with no `issuer-uri`, shipping logout that silently degrades to local-only
- Agent replaces the `ClientRegistrationRepository` without implementing `Iterable<ClientRegistration>`
- Agent passes a bare validator to `setJwtValidator` and silently drops the issuer and expiry checks
- Agent claims the reference describes bearer-token versus session precedence. It does not
- Agent resolves the issuer from the token's own `iss` claim instead of `fromTrustedIssuers`
- Agent writes a `JwtAuthenticationConverter` for a flat role claim on a resource server, where
  `authorities-claim-name` and `authority-prefix` would have done it
- Agent sets those properties **and** declares a converter bean, so the properties silently do nothing
- Agent reads `FACTOR_AUTHORIZATION_CODE` from `OidcUser.getAuthorities()`, where it never appears, or
  expects a `GrantedAuthoritiesMapper` to be able to remove it
- Agent enables back-channel logout on a clustered deployment with the default in-memory
  `OidcSessionRegistry`, so logout propagates to one instance out of *n*
- Agent enables back-channel logout alongside Spring Session and leaves the cookie name at `JSESSIONID`,
  so nothing is invalidated

## Related

- [security-oauth2-oidc.md](security-oauth2-oidc.md) · [security-hardening.md](security-hardening.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [spring-security-saml.md](spring-security-saml.md) · [spring-authorization-server.md](spring-authorization-server.md) · [checklist.md](checklist.md)
