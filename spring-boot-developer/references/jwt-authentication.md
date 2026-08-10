# JWT Authentication

## First: should you issue tokens at all?

If an identity provider is available - Keycloak, Auth0, Okta, Entra, Cognito - use it and make your application a resource server ([oauth2-resource-server.md](oauth2-resource-server.md)). You then write no token code at all.

Self-issuing means owning key management, rotation, revocation, refresh-token reuse detection and account recovery. It is the right answer for a self-contained application with local accounts and no IdP, and the wrong answer whenever an IdP is on the table.

## Use Spring Security's own JWT support

Do **not** add a third-party JWT library and hand-write an `OncePerRequestFilter`. Spring Security already has an encoder, a decoder and a bearer-token filter. Using them removes the dependency, the custom filter, and the entire class of bugs that comes with parsing tokens by hand - expired-token exceptions escaping the filter as a 500, forgetting to clear the security context, accepting a refresh token as an access token.

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security-oauth2-resource-server</artifactId>
</dependency>
```

That name is Boot 4; on 3.5.x it is `spring-boot-starter-oauth2-resource-server`. It brings the Nimbus JOSE support that `JwtEncoder` and `JwtDecoder` need.

## Keys

Prefer **RSA or EC** over a shared secret. With asymmetric keys the private key never leaves the issuer, and you can publish a JWKS endpoint so other services validate without holding a secret.

```java
@Configuration
class JwtKeyConfig {

    @Bean
    JWKSource<SecurityContext> jwkSource(JwtKeyProperties properties) {
        var rsaKey = new RSAKey.Builder(properties.publicKey())
                .privateKey(properties.privateKey())
                .keyID(properties.keyId())
                .build();
        return new ImmutableJWKSet<>(new JWKSet(rsaKey));
    }

    @Bean
    JwtEncoder jwtEncoder(JWKSource<SecurityContext> jwkSource) {
        return new NimbusJwtEncoder(jwkSource);
    }

    @Bean
    JwtDecoder jwtDecoder(JwtKeyProperties properties) {
        return NimbusJwtDecoder.withPublicKey(properties.publicKey()).build();
    }
}
```

```java
@Validated
@ConfigurationProperties("app.jwt")
record JwtKeyProperties(
        @NotNull RSAPublicKey publicKey,
        @NotNull RSAPrivateKey privateKey,
        @NotBlank String keyId,
        @NotNull Duration accessTokenTtl) {
}
```

Spring converts a PEM resource to `RSAPublicKey`/`RSAPrivateKey` directly, so the properties are file references:

```yaml
app:
  jwt:
    public-key: ${JWT_PUBLIC_KEY}     # classpath:/keys/public.pem in local dev
    private-key: ${JWT_PRIVATE_KEY}
    key-id: ${JWT_KEY_ID}
    access-token-ttl: 15m
```

Keys come from the environment or a secret manager - never the repository, never `application.yml`. See [configuration.md](configuration.md).

The `keyID` matters: it goes in the token header as `kid`, which is what lets you rotate. Publish both the old and new key in the JWKS during a rotation window so tokens signed with either still validate.

For HMAC (a single application, no other verifiers), use `NimbusJwtEncoder(new ImmutableSecret<>(secretKey))` and `NimbusJwtDecoder.withSecretKey(secretKey)`. HS256 requires a key of at least 256 bits - a short secret throws at startup, which is the correct behaviour.

## Issuing the access token

```java
@Service
public class AccessTokenIssuer {

    private final JwtEncoder encoder;
    private final JwtKeyProperties properties;

    AccessTokenIssuer(JwtEncoder encoder, JwtKeyProperties properties) {
        this.encoder = encoder;
        this.properties = properties;
    }

    public IssuedToken issue(UserAccount account) {
        var now = Instant.now();
        var expiresAt = now.plus(properties.accessTokenTtl());

        var claims = JwtClaimsSet.builder()
                .issuer("https://api.example.com")
                .subject(account.id().value().toString())
                .issuedAt(now)
                .expiresAt(expiresAt)
                .id(UUID.randomUUID().toString())          // jti, for revocation lists
                .claim("scope", String.join(" ", account.scopes()))
                .build();

        var token = encoder.encode(JwtEncoderParameters.from(claims)).getTokenValue();
        return new IssuedToken(token, expiresAt);
    }
}
```

- **Short TTL** - 15 minutes or less. A JWT cannot be revoked, so its lifetime *is* your revocation window.
- **`subject` is the stable user id**, not the email. Emails change.
- **Never put anything secret in the payload.** A JWT is signed, not encrypted - anyone holding it can read every claim.
- **Keep it small.** The token travels on every request; a list of fifty permissions in it is a permanent bandwidth cost.
- Include `jti` if you may ever need a revocation list.

## Validating: no custom filter

Point the resource-server configuration at your decoder and Spring Security's `BearerTokenAuthenticationFilter` does the rest:

```java
@Bean
SecurityFilterChain apiFilterChain(HttpSecurity http) throws Exception {
    return http
            .securityMatcher("/api/**")
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                    .requestMatchers("/api/auth/**").permitAll()
                    .anyRequest().authenticated())
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
            .exceptionHandling(ex -> ex
                    .authenticationEntryPoint(problemDetailEntryPoint())
                    .accessDeniedHandler(problemDetailAccessDeniedHandler()))
            .build();
}
```

Signature, expiry and issuer are validated for you; a bad token produces a 401 through the entry point rather than a 500 from inside a filter. Scope claims map to `SCOPE_*` authorities automatically - see [oauth2-resource-server.md](oauth2-resource-server.md) for custom claim mapping.

Reading the caller in a controller:

```java
@GetMapping("/me")
AccountResponse me(@AuthenticationPrincipal Jwt jwt) {
    return accountService.getById(AccountId.of(jwt.getSubject()));
}
```

## Refresh tokens

**A refresh token should not be a JWT.** It is long-lived, must be revocable, and must support reuse detection - all things a stateless signed token cannot do. Use an opaque random value, store its hash, and treat the row as the source of truth:

```java
@Transactional
public TokenPair refresh(String presentedToken) {
    var hash = sha256(presentedToken);
    var stored = refreshTokens.findByTokenHash(hash)
            .orElseThrow(() -> new InvalidRefreshTokenException());

    if (stored.isRevoked()) {
        // The token was already used. Either it was stolen and replayed, or the
        // legitimate client replayed it. Assume compromise and kill the family.
        refreshTokens.revokeFamily(stored.familyId());
        throw new RefreshTokenReuseException();
    }
    if (stored.isExpired()) {
        throw new InvalidRefreshTokenException();
    }

    stored.revoke();                                            // rotate: single use
    var next = RefreshToken.issue(stored.accountId(), stored.familyId());
    refreshTokens.save(next);

    return new TokenPair(accessTokenIssuer.issue(stored.account()), next.plaintext());
}
```

- **Rotate on every use** and revoke the previous one.
- **Reuse of a revoked token means compromise** - revoke the whole family, forcing re-authentication.
- **Store only a hash.** A leaked database should not yield usable tokens.
- Generate with `SecureRandom`, at least 256 bits, Base64-URL encoded.

## Where the client keeps tokens

| Storage | Verdict |
|---|---|
| `httpOnly`, `Secure`, `SameSite=Strict` cookie | Best. JavaScript cannot read it, so XSS cannot steal it - but you must then handle CSRF |
| In-memory (a JS variable) | Acceptable for the access token; lost on refresh, which the refresh token covers |
| `localStorage` | Readable by any script on the page. One XSS is total account compromise |

Do not suggest `localStorage`, even in an example.

## Logout and revocation

A JWT stays valid until it expires. "Logout" means:

1. Revoke the refresh token (server-side, effective immediately).
2. Discard the access token client-side.
3. Accept that the access token remains technically valid until expiry - which is why the TTL is short.

If you need immediate revocation, check a `jti` denylist in Redis on each request. That reintroduces the per-request lookup JWTs exist to avoid, so only do it where the requirement is real.

## Testing

Do not generate real tokens in tests. Use the JWT post-processor:

```java
@Test
void allowsCallerWithScope() {
    mockMvc.perform(get("/api/orders")
            .with(jwt().jwt(builder -> builder.subject(accountId.toString()))
                       .authorities(new SimpleGrantedAuthority("SCOPE_orders:read"))))
            .andExpect(status().isOk());
}
```

Test that an **expired** token gives 401 and that a token missing the scope gives 403. Those are the paths that break silently.

## If on Boot 3.5.x

Starter name is `spring-boot-starter-oauth2-resource-server` (no `security-` prefix). `JwtEncoder`, `NimbusJwtEncoder`, `JwtDecoder`, `JwtClaimsSet` and `oauth2ResourceServer(…)` are all present in Spring Security 6 and behave identically. The DSL removals in [security-fundamentals.md](security-fundamentals.md) are the only real difference.

## Gotchas

- Agent adds a third-party JWT library and writes a custom `OncePerRequestFilter` - Spring Security has an encoder, a decoder and a bearer filter already
- Agent lets a parsing exception escape a custom filter - expired token becomes a 500 instead of a 401; another reason not to write the filter
- Agent hardcodes the signing secret - environment or secret manager only
- Agent uses a short HMAC secret - HS256 needs ≥256 bits and throws otherwise
- Agent uses HMAC when other services must verify - use RSA/EC and publish a JWKS
- Agent omits `kid` - key rotation becomes a flag-day outage
- Agent puts sensitive data in claims - a JWT is signed, not encrypted
- Agent gives the access token a multi-hour TTL - a JWT cannot be revoked; the TTL is the revocation window
- Agent uses the email as `subject` - use a stable id
- Agent issues a JWT as the refresh token - it must be revocable; use an opaque stored value
- Agent does not rotate refresh tokens - a leaked token is then valid until expiry
- Agent stores refresh tokens in plaintext - store a hash
- Agent ignores refresh-token reuse - reuse means compromise; revoke the family
- Agent accepts a refresh token at the bearer endpoint - separate the two token types
- Agent suggests `localStorage` - one XSS is full account compromise
- Agent claims logout invalidates the access token - it does not; only the refresh token is revoked
- Agent tests with real generated tokens - use `jwt()` post-processor; test 401 and 403 explicitly

## Related

- [security-fundamentals.md](security-fundamentals.md) · [oauth2-resource-server.md](oauth2-resource-server.md) · [configuration.md](configuration.md) · [error-handling.md](error-handling.md) · [caching.md](caching.md)
