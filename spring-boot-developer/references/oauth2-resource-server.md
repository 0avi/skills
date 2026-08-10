# OAuth2 Resource Server

Your API validates tokens issued by someone else - Keycloak, Auth0, Okta, Entra ID, Cognito. You write no token code: no signing, no key storage, no refresh flow, no password handling. **This is the preferred option** whenever an identity provider exists; see [jwt-authentication.md](jwt-authentication.md) for the self-issuing case.

## Dependency

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security-oauth2-resource-server</artifactId>
</dependency>
```

Boot 4 name. On 3.5.x it is `spring-boot-starter-oauth2-resource-server` - the `security-` prefix was added in the Boot 4 starter rename ([boot-versions.md](boot-versions.md)).

## Configuration

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://id.example.com/realms/production
          audiences: https://api.example.com
```

`issuer-uri` alone is enough. Spring fetches the provider's OpenID configuration, discovers the JWKS endpoint, caches the keys and refreshes them when an unknown `kid` appears - so provider key rotation needs no action from you.

**Always set `issuer-uri`, not just `jwk-set-uri`.** With only the JWKS URL, Spring validates the signature but not the `iss` claim, so a correctly-signed token minted for a different tenant or realm on the same provider is accepted. Use `jwk-set-uri` on its own only when the provider has no discovery endpoint, and then validate the issuer explicitly.

**Set `audiences`.** Without it, any token the provider issued for any of its clients is valid against your API. The `aud` claim is what scopes a token to *your* service.

`issuer-uri` is resolved at startup by default, so the application will not start if the provider is unreachable. In an environment where that ordering is not guaranteed, configure `jwk-set-uri` alongside it to defer the fetch.

## Filter chain

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
class ResourceServerConfig {

    @Bean
    SecurityFilterChain apiFilterChain(HttpSecurity http) throws Exception {
        return http
                .securityMatcher("/api/**")
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(authoritiesConverter())))
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(problemDetailEntryPoint())
                        .accessDeniedHandler(problemDetailAccessDeniedHandler()))
                .build();
    }
}
```

No `UserDetailsService`, no `PasswordEncoder`, no `AuthenticationProvider` - the token is the authentication. See [security-fundamentals.md](security-fundamentals.md) for the chain rules and the JSON 401/403 handlers.

## Mapping claims to authorities

By default Spring reads the `scope` (or `scp`) claim and prefixes each value with `SCOPE_`. A token with `"scope": "orders:read orders:write"` yields `SCOPE_orders:read` and `SCOPE_orders:write`.

```java
@PreAuthorize("hasAuthority('SCOPE_orders:read')")
```

**Scopes are not roles.** `hasRole('ADMIN')` looks for `ROLE_ADMIN`; a scope has no `ROLE_` prefix added. Mixing the two is the most common failure here.

Providers put roles wherever they like, so the converter is usually where the real work is. Keycloak nests realm roles inside `realm_access.roles`:

```java
@Bean
JwtAuthenticationConverter authoritiesConverter() {
    var scopes = new JwtGrantedAuthoritiesConverter();     // keeps the default SCOPE_ mapping

    var converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(jwt -> {
        var authorities = new ArrayList<GrantedAuthority>(scopes.convert(jwt));

        Map<String, Object> realmAccess = jwt.getClaimAsMap("realm_access");
        if (realmAccess != null && realmAccess.get("roles") instanceof Collection<?> roles) {
            roles.stream()
                    .map(String::valueOf)
                    .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                    .forEach(authorities::add);
        }
        return authorities;
    });
    converter.setPrincipalClaimName("sub");
    return converter;
}
```

Compose with `JwtGrantedAuthoritiesConverter` rather than replacing it, or you silently lose scope-based authorities. Guard the cast - a token without the claim must not throw a `ClassCastException` from inside the filter, where it becomes a 500.

| Provider | Roles live in |
|---|---|
| Keycloak | `realm_access.roles`, and `resource_access.<client>.roles` for client roles |
| Auth0 | A namespaced custom claim, e.g. `https://example.com/roles` |
| Okta | `groups`, when the claim is configured on the authorization server |
| Entra ID | `roles` for app roles; `groups` carries object IDs, not names |

Check an actual decoded token from your provider rather than assuming. Entra's `groups` claim in particular contains GUIDs, and it is omitted entirely above a certain group count.

## Reading the caller

```java
@GetMapping("/me/orders")
List<OrderResponse> myOrders(@AuthenticationPrincipal Jwt jwt) {
    return orderService.findByCustomer(CustomerId.of(jwt.getSubject()));
}
```

`getSubject()` is the stable user identifier. Do not key your data on the email claim - it changes, and on some providers it is not unique.

Keep `Jwt` out of the service layer. The controller extracts what the service needs and passes a domain type; a service taking a `Jwt` cannot be tested or called from a batch job.

## Ownership checks

Scopes say what a caller may do, not which rows they may touch. `SCOPE_orders:read` does not mean "read *this* order".

```java
@PreAuthorize("hasAuthority('SCOPE_orders:read') and @orderAccess.isOwner(#id, authentication)")
public OrderResponse getById(OrderId id) { … }
```

Or check inside the service, which is easier to test:

```java
public OrderResponse getById(OrderId id, CustomerId caller) {
    var order = orderRepository.getById(id);
    if (!order.customerId().equals(caller)) {
        throw new OrderNotFoundException(id);   // 404, not 403 - do not confirm it exists
    }
    return OrderResponse.from(order);
}
```

Returning 404 rather than 403 for someone else's resource avoids confirming that the id exists. Use 403 only where the caller is already entitled to know the resource is there.

## Opaque tokens

Some providers issue reference tokens rather than JWTs:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        opaquetoken:
          introspection-uri: https://id.example.com/oauth2/introspect
          client-id: ${INTROSPECTION_CLIENT_ID}
          client-secret: ${INTROSPECTION_CLIENT_SECRET}
```

Every request costs a network round trip to the provider, so cache introspection results for a few seconds. Configure `jwt` or `opaquetoken`, never both.

## Multi-tenancy

For several issuers, use `JwtIssuerAuthenticationManagerResolver` with an explicit allowlist:

```java
var resolver = JwtIssuerAuthenticationManagerResolver
        .fromTrustedIssuers("https://id.example.com/realms/eu", "https://id.example.com/realms/us");

http.oauth2ResourceServer(oauth2 -> oauth2.authenticationManagerResolver(resolver));
```

Never derive the issuer from the token itself without an allowlist - that accepts tokens from any issuer the attacker names.

## Testing

No real provider, no real tokens:

```java
@Test
void rejectsTokenWithoutScope() {
    mockMvc.perform(get("/api/orders").with(jwt()))
            .andExpect(status().isForbidden());
}

@Test
void allowsTokenWithScope() {
    mockMvc.perform(get("/api/orders")
            .with(jwt().authorities(new SimpleGrantedAuthority("SCOPE_orders:read"))))
            .andExpect(status().isOk());
}

@Test
void mapsKeycloakRealmRoles() {                        // test the converter directly
    var jwt = Jwt.withTokenValue("t").header("alg", "none")
            .claim("realm_access", Map.of("roles", List.of("admin")))
            .build();
    assertThat(authoritiesConverter().convert(jwt).getAuthorities())
            .extracting(GrantedAuthority::getAuthority)
            .contains("ROLE_admin");
}
```

The converter is the part with real logic in it, so test it as a unit. For a full end-to-end check against a real provider, run Keycloak in a Testcontainer - see [testing-integration.md](testing-integration.md).

## If on Boot 3.5.x

Starter is `spring-boot-starter-oauth2-resource-server`. All configuration properties, `JwtAuthenticationConverter`, `JwtGrantedAuthoritiesConverter`, `JwtIssuerAuthenticationManagerResolver` and the `jwt()` test post-processor are identical on Spring Security 6. Only the DSL removals in [security-fundamentals.md](security-fundamentals.md) differ.

## Gotchas

- Agent adds `spring-boot-starter-oauth2-resource-server` on Boot 4 - it is `spring-boot-starter-security-oauth2-resource-server`
- Agent configures only `jwk-set-uri` - the `iss` claim is then unvalidated; set `issuer-uri`
- Agent omits `audiences` - any token from that provider, for any client, is accepted
- Agent uses `hasRole('ADMIN')` for a scope - scopes are `hasAuthority('SCOPE_...')` with no prefix added
- Agent replaces `JwtGrantedAuthoritiesConverter` instead of composing with it - scope authorities are silently lost
- Agent assumes roles are in a top-level `roles` claim - Keycloak nests them under `realm_access.roles`; check a real token
- Agent casts a claim without guarding - a missing claim becomes a 500 from inside the filter
- Agent adds a `UserDetailsService` or `PasswordEncoder` - a resource server authenticates by token
- Agent keys data on the email claim - use `sub`
- Agent passes `Jwt` into the service layer - extract at the controller
- Agent treats a scope as an ownership check - a scope is a capability, not a row-level permission
- Agent returns 403 for another user's resource - 404 avoids confirming it exists
- Agent configures both `jwt` and `opaquetoken` - pick one
- Agent trusts the issuer from the token in a multi-tenant setup - use an allowlist
- Agent writes integration tests against the live provider - use the `jwt()` post-processor, or Keycloak in a container

## Related

- [security-fundamentals.md](security-fundamentals.md) · [jwt-authentication.md](jwt-authentication.md) · [error-handling.md](error-handling.md) · [http-clients.md](http-clients.md) · [testing-integration.md](testing-integration.md)
