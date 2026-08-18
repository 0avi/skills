# Keycloak

**Verified against Keycloak's documentation and the `AccessToken` source on 12/08/2026.** Spring
identifiers are Spring Security 7.1.0. Keycloak is the usual answer when an organisation wants to run its
own identity provider, and it is the only entry here that is both a product you operate and a provider you
integrate with. See [providers.md](providers.md).

## The realm is the tenant boundary

Everything in Keycloak is scoped to a realm, and that single fact answers most of the schema.

| | |
| --- | --- |
| Realm base URL | `{server}/realms/{realm-name}` |
| OIDC discovery | `{server}/realms/{realm-name}/.well-known/openid-configuration` |
| Issuer | The realm base URL. This follows from the discovery path by OIDC Discovery convention rather than from a quoted example, so **confirm it against the customer's actual discovery document** |
| Subject scope | Per realm. Two realms are two separate user populations |
| Protocols | **Both OIDC and SAML 2.0**, natively, per client |

**The `/auth` path segment is a version trap.** Current documentation shows realm URLs with no `/auth`
prefix. Older deployments serve `{server}/auth/realms/{realm-name}`, and plenty are still running. **Do
not assume either shape**: ask for the discovery URL rather than constructing it, which is good practice
with any provider and load-bearing with this one.

**Because the realm is the boundary, realm-per-customer is the obvious multi-tenant shape**, and it is
usually right: separate users, separate roles, separate signing keys, separate issuer. The cost is
operational, one realm to administer per customer, and it maps cleanly onto a
`ClientRegistrationRepository` resolving by tenant. See
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

## Roles are nested, and Spring cannot see them

This is the Keycloak integration problem, and it is the same shape as Okta's with a different cause.

**Keycloak's side.** From the `AccessToken` source, roles arrive in two nested structures:

```json
{
  "realm_access":    { "roles": ["admin", "auditor"] },
  "resource_access": { "my-api": { "roles": ["editor"] } },
  "scope": "openid profile email"
}
```

`realm_access` holds realm roles. `resource_access` is a **map keyed by client id**, each entry holding
that client's roles. Verified property names: `realm_access`, `resource_access`, and `roles` on the inner
`Access` type.

**Spring's side.** Authorities come from the flat `scope` claim, prefixed `SCOPE_`. See
[spring-security-oidc.md](spring-security-oidc.md).

**Put together:** Keycloak's roles are **two levels deep inside a JSON object**, and Spring's default
converter reads a flat string claim. It will never find them. `hasRole('ADMIN')` denies while the token
plainly contains `admin`, and the token looks so obviously correct that the mapper is the last place
anyone checks.

**On a resource server**, supply a converter that digs into the structure and hand it to the JWT
authentication converter:

```java
@Bean
JwtAuthenticationConverter jwtAuthenticationConverter() {
    JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(this::authorities);
    return converter;
}

@SuppressWarnings("unchecked")
private Collection<GrantedAuthority> authorities(Jwt jwt) {
    Map<String, Object> realmAccess = jwt.getClaimAsMap("realm_access");
    if (realmAccess == null) {
        return List.of();
    }
    Collection<String> roles = (Collection<String>) realmAccess.get("roles");
    return roles == null ? List.of()
            : roles.stream().map((role) -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + role)).toList();
}
```

**On a login client**, do the equivalent in a `GrantedAuthoritiesMapper` or an `OidcUserService` delegate.

Three decisions this forces, none of them Spring's:

- **`ROLE_` or `SCOPE_`?** If you write `hasRole('ADMIN')` the authority must be `ROLE_ADMIN`. If you
  prefer `hasAuthority('admin')` prefix nothing. Choose once and write it down, because a mixed codebase
  fails in a way that reads as a permissions bug.
- **Realm roles or client roles?** Client roles under `resource_access` are per-application and are
  usually the right level for a product with several services. Realm roles are shared across every client
  in the realm, which is convenient and leaks authority between applications.
- **Which client's roles?** `resource_access` is keyed by client id, so a service reading another
  client's entry is reading authority it was not granted.

## Groups need a mapper, and are not roles

Keycloak distinguishes **roles**, which are authorisation categories, from **groups**, which organise
users and can carry role mappings. Keycloak states that per client "you can tailor what claims and
assertions are stored in the OIDC token or SAML assertion" through **protocol mappers**.

**Group membership does not appear in a token by default.** A protocol mapper must be added. **The exact
name of the built-in group mapper was not verified in this pass**, so read the client's mapper list in
the admin console rather than copying a name from a tutorial.

The design advice is the same as Entra's for the same reason: **prefer roles for authorisation** and
treat groups as the administrative convenience that assigns them. It keeps the token small and keeps
authority decisions in one vocabulary.

## SAML

Keycloak is a full SAML 2.0 identity provider as well as an OIDC one, configured per client, so a single
Keycloak can serve one application over OIDC and another over SAML. That is genuinely useful when
migrating an estate.

**The Spring side is unchanged**: see [spring-security-saml.md](spring-security-saml.md), and the
attack surface in [security-saml.md](security-saml.md). **Keycloak's SAML metadata URL shape, its
signing certificate rotation behaviour and its single logout support were not verified in this pass.**

## Do not use a Keycloak Java adapter

Keycloak's own documentation refers to the "legacy Keycloak OIDC Java adapters", and the general rule in
[providers.md](providers.md) applies with particular force here because these adapters were widely
adopted and a great deal of surviving tutorial material assumes them.

**Use Spring Security's own OAuth2 client and resource server support**, pointed at the realm issuer.
Keycloak is then an ordinary OIDC provider and nothing in your code is Keycloak-specific except the role
converter above.

**The precise deprecation or removal timeline for those adapters was not verified in this pass.** The
recommendation does not depend on it: a vendor adapter that lags Spring releases is the wrong dependency
whatever its formal status.

## Other claims worth knowing

From the `AccessToken` source, alongside the roles structures: `scope`, `allowed-origins`,
`trusted-certs`, `authorization`, `authorization_details`, and **`cnf`** for confirmation, which is the
certificate-binding claim used by sender-constrained tokens. If you are implementing mTLS or DPoP
per RFC 9700's recommendation, `cnf` is where the binding lands. See
[security-oauth2-oidc.md](security-oauth2-oidc.md).

## Not verified in this pass

- The exact issuer string in an issued token, as opposed to the realm base URL derived from the discovery
  path.
- The name of the built-in **group** protocol mapper.
- SAML metadata URL shape, certificate rotation and single logout behaviour.
- **SCIM support.** Whether current Keycloak provides SCIM natively or through an extension was not
  established. Do not assume provisioning is built in.
- PKCE enforcement configuration per client.
- The deprecation or removal timeline of the Java adapters.
- Token lifetime defaults.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | Realm discovery path, and the `realm_access`, `resource_access` and `roles` claim names from the `AccessToken` source, on 12/08/2026 |
| `/auth` path prefix | Absent in current documentation, present in older deployments. **Ask for the discovery URL rather than constructing it** |
| Issuer | Derived from the discovery path by OIDC Discovery convention, not from a quoted example |
| Adapters | Keycloak's documentation calls the Java adapters "legacy". Timeline unverified |
| Self-hosted versioning | Unlike a SaaS provider, the customer chooses when to upgrade, so a Keycloak integration must tolerate a range of versions in the field. Treat the version as a question to ask, not a constant |

## Gotchas

- Agent expects `hasRole(...)` to work against Keycloak roles with no converter. They are nested in
  `realm_access` and `resource_access`, and Spring reads a flat `scope` claim
- Agent writes a converter for `realm_access` and misses `resource_access`, or the reverse, so half the
  roles are invisible
- Agent reads another client's entry from the `resource_access` map, granting authority the service was
  never given
- Agent forgets the `ROLE_` prefix and `hasRole(...)` silently denies, or adds it and `hasAuthority(...)`
  silently denies
- Agent constructs the realm URL with or without `/auth` by guessing, instead of asking for the discovery
  URL
- Agent assumes group membership is in the token. It needs a protocol mapper
- Agent uses realm roles for everything, leaking authority between applications in the same realm
- Agent adopts a Keycloak Java adapter because a tutorial used one, instead of Spring Security's own
  OIDC support
- Agent assumes SCIM is built in
- Agent treats a self-hosted Keycloak as a fixed version, when the customer controls upgrades

## Related

- [providers.md](providers.md) · [spring-security-oidc.md](spring-security-oidc.md) · [spring-security-saml.md](spring-security-saml.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [checklist.md](checklist.md)
