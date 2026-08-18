# Auth0

**Verified against Auth0's documentation on 12/08/2026.** Spring identifiers are Spring Security 7.1.0.

**A note on this file's depth.** Three separate Auth0 documentation pages were read and the token-level
specifics were largely absent from them: the pages describe concepts and cross-reference each other
rather than stating claim names and formats. So this file is **shorter and carries more unverified
entries than the Okta, Entra ID and Keycloak files**. That is a property of the source material, not a
judgement about Auth0, and the gaps below name exactly what to go and read. See
[providers.md](providers.md).

## The trailing slash

**Auth0's issuer ends with a slash.** From an Auth0 sample token:

```json
"iss": "https://my-domain.auth0.com/"
```

**This is the classic Auth0 integration failure**, because issuer validation is exact string comparison
and half the configuration examples in the world omit the slash. Symptoms: the signature verifies, the
token looks perfect, and validation fails with an issuer mismatch that reads as nonsense because the two
strings look identical at a glance.

Set `issuer-uri` to the form Auth0 actually emits, slash included, and where you have a custom domain use
the custom domain consistently. **Mixing the tenant domain and a custom domain between configuration and
tokens produces the same failure**, so pick one and use it everywhere.

## JWT or opaque, and why your resource server may reject everything

Auth0 issues both shapes, and a Spring resource server's JWT decoder can only handle one.

**What is verified:** "Access tokens issued for the Management API and access tokens issued for any
custom API that you have registered with Auth0 follow the JWT standard."

And, for Management API tokens specifically: "An access token issued for the Auth0 Management API should
be treated as opaque (regardless of whether it actually is), so you don't need to validate it." **Do not
build your own authorisation on Management API tokens**, which is the same advice as Okta's org
authorization server for the same reason.

**What is not verified:** the precise condition that produces an opaque token rather than a JWT.
Auth0's documentation, across the three pages read, does not state it plainly. **The practical
diagnostic:** if your resource server rejects everything with a decoding or malformed-token error rather
than a validation error, you are being handed something that is not a JWT, and the place to look is your
**registered API and the audience the client requests** rather than anything in Spring. Read Auth0's
current documentation on requesting tokens for a custom API before configuring this.

## Audience, which Auth0 makes explicit

Auth0's validation guidance requires that the `aud` claim "match the unique identifier of the target API
as defined in your API's Settings", and that the `scope` claim be checked against what the endpoint
requires.

That maps directly onto Spring:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://my-domain.auth0.com/
          audiences: https://api.example.com
```

**`audiences` is not validated unless you set it**, so an Auth0 integration that omits it accepts tokens
minted for any other API in the same tenant. In a product with several APIs behind one Auth0 tenant, that
is a confused-deputy problem rather than a hygiene issue. See
[security-oauth2-oidc.md](security-oauth2-oidc.md).

## Roles and permissions

**Not verified.** Auth0 distinguishes roles from permissions in its RBAC model, and the documentation
read describes the concepts without naming the claims that carry them or the setting that enables them.

What can be said safely, and is enough to plan around:

- **`scope` carries permissions in the standard place**, and Auth0's own validation guidance says to
  check it. Spring maps `scope` to `SCOPE_`-prefixed authorities automatically, so this path works with
  no converter.
- **Anything richer than `scope` will need a converter**, exactly as with every other provider in this
  set. See the comparison in [providers.md](providers.md).
- **Auth0 requires custom claims to be namespaced**, which is a well-known constraint of its model, but
  **the exact namespace format rule was not verified here.** If you are adding roles through a custom
  claim, read Auth0's current documentation on custom claims before choosing a claim name, because a
  non-conforming name is silently dropped rather than rejected.

**Design advice that does not depend on the unverified parts:** prefer `scope` and permissions over
custom role claims where you can, because it is the path Spring handles natively and the one Auth0
documents most clearly.

## Not verified in this pass

Named precisely, so the gap is actionable:

- The condition that produces an **opaque** access token rather than a JWT.
- The **discovery document URL** format for an Auth0 tenant.
- The **JWKS URI** format.
- The **permissions claim name** and the setting that enables it.
- The **custom claim namespacing** rule and format.
- **Roles** in tokens: whether present by default, and under what claim.
- **SAML** support specifics: metadata, certificate rotation, single logout.
- **SCIM** provisioning support and deprovisioning semantics.
- **PKCE for confidential clients**: whether Auth0 accepts it.
- **Subject identifier**: whether `sub` is stable and unique across connections, which matters because
  Auth0 aggregates several upstream connections and the same human can arrive through more than one.

That last one deserves emphasis even unverified: **Auth0 is frequently a broker in front of other
identity providers**, so a user signing in through two connections may present two identities. Establish
how your tenant handles account linking before keying records on anything.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | Issuer format with trailing slash, JWT versus opaque statement for custom and Management APIs, audience and scope validation guidance. Auth0 documentation, 12/08/2026 |
| Issuer | **Ends with a slash.** `https://{tenant}.auth0.com/` |
| Custom domains | Use one domain consistently across configuration and tokens |
| Management API tokens | Auth0 says to treat as opaque and not validate. Not a basis for your own authorisation |
| Depth | Lower than the Okta, Entra ID and Keycloak files, because the token-level specifics were not present in the pages read. Everything absent is listed above rather than inferred |

## Gotchas

- Agent omits the trailing slash from the Auth0 issuer, and issuer validation fails against two strings
  that look identical
- Agent mixes the tenant domain and a custom domain between configuration and tokens, producing the same
  failure
- Agent builds authorisation on Management API tokens, which Auth0 says to treat as opaque
- Agent omits `audiences`, so tokens minted for a different API in the same tenant are accepted
- Agent sees a decode error rather than a validation error and debugs Spring, when the token is not a JWT
  and the cause is the API and audience configuration
- Agent invents a permissions claim name or a custom claim namespace. Neither was verified here; read
  Auth0's documentation
- Agent assumes one human is one identity when Auth0 is brokering several upstream connections
- Agent fills in this file's unverified sections from memory rather than from Auth0's documentation

## Related

- [providers.md](providers.md) · [spring-security-oidc.md](spring-security-oidc.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [checklist.md](checklist.md)
