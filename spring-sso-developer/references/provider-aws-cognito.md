# Amazon Cognito user pools

**Verified against AWS's Cognito developer guide on 12/08/2026.** Spring identifiers are Spring Security
7.1.0. See [providers.md](providers.md).

Cognito is the provider whose token shape departs most from what a Spring resource server expects, in two
ways that both fail quietly.

## Issuer and keys

| | |
| --- | --- |
| Issuer | `https://cognito-idp.{Region}.amazonaws.com/{userPoolId}` |
| JWKS URI | `https://cognito-idp.{Region}.amazonaws.com/{userPoolId}/.well-known/jwks.json` |
| Signing algorithm | `RS256`, with a 2048-bit RSA key |
| Tenant boundary | The user pool |

**Cognito uses two key pairs per user pool.** Quoted: "Amazon Cognito generates two pairs of RSA
cryptographic keys for each user pool. One private key signs access tokens, and the other signs ID
tokens." Both appear in the same JWKS, distinguished by `kid`, so nothing special is required, but it
explains why the key set has more entries than you expect.

**Keys rotate.** AWS says to cache public keys using `kid` as the cache key and refresh periodically, and
gives the diagnostic: "If you receive a token with the correct issuer but a different `kid`, Amazon
Cognito might have rotated the signing key." Spring's decoders cache JWKS, so an over-cached key set fails
at rotation rather than at deploy.

## The access token has no `aud`

**This is the finding that breaks a standard Spring configuration.** Quoted:

> "In an ID token, the claims include user attributes and information about the user pool, `iss`, and app
> client, `aud`. In an access token, the payload includes scopes, group membership, your user pool as
> `iss`, and your app client as `client_id`."

And the validation instruction:

> "The `aud` claim in an ID token and the `client_id` claim in an access token must match the app client ID
> that was created in the Amazon Cognito user pool."

**So an access token carries `client_id`, not `aud`.** The obvious Spring configuration is:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_EXAMPLE
          audiences: 1example23456789          # WRONG for Cognito access tokens
```

`audiences` validates the `aud` claim, which a Cognito access token does not have. Validate `client_id`
instead, delegating to the defaults so issuer and expiry survive:

```java
@Bean
JwtDecoder jwtDecoder(@Value("${cognito.issuer}") String issuer,
                      @Value("${cognito.client-id}") String clientId) {
    NimbusJwtDecoder decoder = NimbusJwtDecoder.withIssuerLocation(issuer).build();
    OAuth2TokenValidator<Jwt> clientIdValidator =
            new JwtClaimValidator<String>("client_id", clientId::equals);
    OAuth2TokenValidator<Jwt> tokenUse =
            new JwtClaimValidator<String>("token_use", "access"::equals);
    decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
            JwtValidators.createDefaultWithIssuer(issuer), clientIdValidator, tokenUse));
    return decoder;
}
```

**Why this is dangerous rather than merely inconvenient:** if you set `audiences` and it rejects
everything, you notice immediately and that is fine. The bad outcome is setting **no** audience validation
at all, concluding that Cognito "does not do audiences", and accepting any token from the user pool
regardless of which app client requested it. In a user pool with several app clients, that is a
confused-deputy problem. See [security-oauth2-oidc.md](security-oauth2-oidc.md).

## `token_use` must be validated, or an ID token becomes an access token

AWS states the check plainly:

> "Check the `token_use` claim. If you are only accepting the access token in your web API operations, its
> value must be `access`. If you are only using the ID token, its value must be `id`. If you are using both
> ID and access tokens, the `token_use` claim must be either `id` or `access`."

**Nothing else distinguishes them to a naive validator.** Both tokens come from the same user pool, so
both carry the same `iss`; both are signed with keys published in the same JWKS, so both verify. A resource
server that checks signature, issuer and expiry and stops **will accept an ID token as a bearer token**.

That matters because the two tokens are for different audiences in the ordinary sense: the ID token
describes the user and is meant for the client, and it typically carries more personal attributes. AWS
names both risks: "A modified access token creates a risk of privilege escalation. A modified ID token
creates a risk of impersonation."

**`token_use` is not a Cognito quirk to work around; it is a required check**, and Spring will not perform
it for you because it is not a standard claim.

## Groups

**`cognito:groups` appears in both the access token and the ID token**, which is unusually convenient
compared with the other providers in this set. Quoted: "The access and ID tokens both include a
`cognito:groups` claim that contains your user's group membership in your user pool."

**It is a flat list of strings, not nested, and on a resource server that means no code at all.** Spring
maps the `scope` claim by default and not `cognito:groups`, but which claim it reads is a property:

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

Boot's `JwtConverterConfiguration` builds a `JwtAuthenticationConverter` from those, and
`JwtGrantedAuthoritiesConverter` takes a claim whose value is a JSON array as-is, so a group named `ADMIN`
becomes `ROLE_ADMIN` and `hasRole('ADMIN')` passes. **Cognito is the easiest provider in this set on this
point**, precisely because the claim is flat and in both tokens.

Write a converter only when you need something the properties cannot express, such as filtering groups,
combining them with another claim, or renaming rather than prefixing:

```java
private Collection<GrantedAuthority> authorities(Jwt jwt) {
    List<String> groups = jwt.getClaimAsStringList("cognito:groups");
    return groups == null ? List.of()
            : groups.stream().map((g) -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + g)).toList();
}
```

**Two cautions.** Declaring your own `JwtAuthenticationConverter` bean disables the properties entirely,
because Boot's is `@ConditionalOnMissingBean`, so setting both leaves YAML that looks live and does
nothing. And **none of this applies on a login client**, where authorities come from the access token's
scopes through `OidcUserService` and a mapper is the only route. See the comparison in
[providers.md](providers.md).

The colon in the claim name is legal JSON and fine in `getClaimAsStringList`, but be careful if you
reference the claim inside a SpEL expression, where it needs quoting.

## Token size is not constant

AWS is explicit that you must plan for it:

> "Your app must be able to store tokens of varying sizes. Token size can change for reasons including,
> but not limited to, additional claims, changes in encoding algorithms, and changes in encryption
> algorithms."

**Enabling token revocation adds claims and grows tokens**: `origin_jti` and `jti` are added to both access
and ID tokens. Combined with a long `cognito:groups` list, this is how a token outgrows a header or a
cookie limit in production having been fine in development.

## Customising claims

The **pre token generation Lambda trigger** can "add, modify, and suppress token claims", receiving OAuth
2.0 scopes, group membership and user attributes and returning updated claims.

Two notes. **It is a Lambda in your login path**, so its latency and its failure mode are now part of
authentication. And **access token customisation with version 2 events carries additional cost**, per
AWS's pricing page, which is worth knowing before designing around it.

## Not verified in this pass

- **SAML.** Cognito can federate to SAML identity providers, and can itself appear as an OIDC provider to
  your application. The metadata shape, certificate handling and single logout behaviour were **not
  verified**, nor was how upstream SAML attributes map into Cognito claims.
- **SCIM** provisioning support.
- **PKCE for confidential clients.**
- **Token lifetimes and defaults**, and refresh token rotation behaviour.
- **The hosted UI** and its customisation limits.
- Whether `sub` is unique beyond the user pool, and whether it is stable across an email change. Until
  established, key on `(issuer, sub)`, which is correct regardless.
- **Federated identities**, the separate Cognito identity pools feature, which exchanges tokens for AWS
  credentials and is a different product from user pools. Nothing here applies to it.

That last point deserves care: **Cognito has two things called Cognito.** User pools are the identity
provider described here. Identity pools are an AWS credential broker. Documentation and blog posts
conflate them constantly.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | Issuer and JWKS formats, the `aud` versus `client_id` split, `token_use`, `cognito:groups` in both tokens, two key pairs per pool, key rotation guidance, token size variability, pre token generation trigger. AWS Cognito developer guide, 12/08/2026 |
| Access token audience | **`client_id`, not `aud`.** Spring's `audiences` property does not apply |
| `token_use` | Must be validated. Not a standard claim, so Spring does not check it |
| Signing | `RS256`, 2048-bit RSA, **two key pairs per user pool** |
| Token revocation | Adds `origin_jti` and `jti`, increasing token size |
| User pools versus identity pools | Different products. This file is user pools only |

## Gotchas

- Agent sets `audiences` for a Cognito resource server and rejects every access token, because access
  tokens carry `client_id` rather than `aud`
- Agent then removes audience validation entirely and accepts tokens issued to any app client in the pool
- Agent omits the `token_use` check, so an ID token is accepted as a bearer token. Same issuer, same JWKS,
  valid signature
- Agent expects `cognito:groups` to become authorities automatically. Spring reads `scope` until told
  otherwise by `authorities-claim-name`
- Agent hand-writes a `JwtAuthenticationConverter` for this flat claim on a resource server, where two
  properties would have done it, or sets the properties **and** declares the bean, so the properties are
  silently ignored
- Agent references `cognito:groups` in a SpEL expression without quoting the colon
- Agent sizes a cookie or header for a token measured in development, then enables token revocation or
  meets a user with many groups
- Agent over-caches JWKS and fails when Cognito rotates a signing key
- Agent puts a pre token generation Lambda in the login path without accounting for its latency or its
  failure mode
- Agent confuses user pools with identity pools, or follows guidance written for the other one

## Related

- [providers.md](providers.md) · [spring-security-oidc.md](spring-security-oidc.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [checklist.md](checklist.md)
