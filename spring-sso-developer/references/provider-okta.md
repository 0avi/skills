# Okta

**Verified against Okta's developer documentation on 12/08/2026.** Spring identifiers are Spring Security
7.1.0. Vendor behaviour changes; re-check anything here that a decision depends on, and see
[providers.md](providers.md) for the questions this file is answering.

## The one thing to establish first

**Which authorization server issues your tokens?** Okta has two kinds and they differ in issuer, in
capability, and in whether your Spring role checks can work at all. Nearly every Okta integration problem
traces back to this being unclear.

| | Org authorization server | Custom authorization server |
| --- | ------------------------ | --------------------------- |
| Issuer | `https://{yourOktaDomain}` | `https://{yourOktaDomain}/oauth2/{authorizationServerId}` |
| Purpose | Tokens for Okta's own resources | Securing **your** APIs |
| Custom scopes | **Not supported** | Supported |
| Custom claims | ID token only | ID and access tokens |
| Audience, policies | **Not customisable** | Customisable |
| Requires | Built in | The **API Access Management** product |

Two direct quotations worth keeping, because they decide architecture:

> "You can't customize the org authorization server's audience, claims, policies, or scopes."

> "Only the org authorization server can mint access tokens that contain Okta API scopes."

**And the warning that should settle it.** Okta states that org authorization server token contents are
subject to change without notice, so validating them may fail in future. **Do not build your own API's
authorization on org-server access tokens.** If you are protecting your own resource server, you want a
custom authorization server, and that is a paid product line rather than a configuration switch. Discover
that during design, not during procurement.

## Groups, and why Spring will ignore them

This is the trap, and it takes two facts to see. Neither document mentions the other.

**Okta's side:** for the org authorization server, *"you can only create an ID token with a groups claim,
not an access token."* A custom authorization server can put groups in both.

**Spring's side:** authorities are populated from the **access token's scopes**, prefixed `SCOPE_`. No ID
token claim becomes an authority on its own. See
[spring-security-oidc.md](spring-security-oidc.md).

**Put together:** on the Okta org authorization server, group membership **physically cannot** reach
Spring's default authority mapping, because the only place Okta will put it is the one place Spring does
not read. `hasRole('ADMIN')` denies, login succeeds, and nothing in either product's documentation tells
you why.

Two ways out, and they are not equivalent:

1. **Map from the ID token yourself**, with a `GrantedAuthoritiesMapper` reading `OidcUserAuthority`
   `getIdToken()`, or an `OidcUserService` delegate. Works with the org server, no extra Okta licence.
   This is the right answer for authentication-time role mapping.
2. **Use a custom authorization server** so groups appear in the access token. Necessary if a separate
   **resource server** must authorise from the token, because a resource server never sees your ID token.

**The choice follows your architecture, not your preference.** Monolith with a session: option 1. Separate
API validating bearer tokens: option 2, and budget for API Access Management.

### Configuring the claim

- Default claim name is **`groups`**, and it is configurable.
- **A scope must be requested.** For the org authorization server the documentation names `openid` and
  **`groups`**. For a custom authorization server the worked example shows `scope=openid`, and the groups
  scope **is not explicitly named there**, so confirm against your own authorization server's scope
  configuration rather than assuming symmetry.
- Group selection uses a **regex filter**. `.*` returns all of the user's groups.
- **No limit on group count is stated** in the documentation consulted. Do not assume there is none: a
  user in hundreds of groups produces a large token, and large tokens fail in headers rather than in
  code. Test with your largest real customer's group membership.

## Discovery, and the asymmetry that catches people

Four endpoints, and the path ordering differs between the two server types:

| Server | OIDC discovery | RFC 8414 OAuth metadata |
| ------ | -------------- | ----------------------- |
| Org | `https://{yourOktaDomain}/.well-known/openid-configuration` | `https://{yourOktaDomain}/.well-known/oauth-authorization-server` |
| Custom | `https://{yourOktaDomain}/oauth2/{authorizationServerId}/.well-known/openid-configuration` | `https://{yourOktaDomain}/.well-known/oauth-authorization-server/oauth2/{authorizationServerId}` |

Note the custom server's two forms are **not** the same shape: OIDC puts `.well-known` after the
authorization server path, RFC 8414 puts it before. That is the RFC 8414 convention rather than an Okta
quirk, and it matters for Spring.

**Why it matters for Spring:** `ClientRegistrations.fromIssuerLocation(...)` probes in order, stopping at
the first success: the issuer plus `/.well-known/openid-configuration`, then the RFC 8414
`/.well-known/openid-configuration/{path}` form, then `/.well-known/oauth-authorization-server/{path}`.
So `fromIssuerLocation` with a custom authorization server issuer resolves, because one of those probes
matches Okta's layout. `fromOidcIssuerLocation(...)` probes **only the first**, which is the form Okta
serves for a custom server, so it also works. Either is fine here; know which you used before debugging a
404.

For Spring configuration, set the issuer and let discovery do the rest:

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          okta:
            provider: okta
            client-id: ${OKTA_CLIENT_ID}
            client-secret: ${OKTA_CLIENT_SECRET}
            scope: openid, profile, email, groups
        provider:
          okta:
            issuer-uri: https://your-domain.okta.com/oauth2/aus1a2b3c4d5e6f7g8h9
```

## Not verified in this pass

Stated plainly rather than guessed, because these need Okta's own current documentation:

- **SAML support.** Okta is a SAML identity provider as well as an OIDC one, but its SAML metadata URL
  shape, signing certificate rotation behaviour and single logout support were **not verified here**.
  If the customer wants SAML, read Okta's SAML documentation and see
  [spring-security-saml.md](spring-security-saml.md) for the Spring side.
- **SCIM.** Okta is a common SCIM client for provisioning into SaaS products, but its SCIM version,
  supported operations and behaviour on deactivation were **not verified**. Deprovisioning behaviour
  specifically, whether a deactivated user is a `PATCH` setting `active` to false or a `DELETE`,
  determines what your endpoint must implement.
- **PKCE for confidential clients.** Not verified. Spring Security 7.1.0 requires it by default, so if
  Okta rejects it for a confidential client you will see it at the token request. See
  [security-oauth2-oidc.md](security-oauth2-oidc.md).
- **Subject uniqueness.** Whether Okta's `sub` is stable across a user's email change, and whether it is
  unique beyond the org, was **not verified**. Until it is, key on `(issuer, sub)` rather than `sub`,
  which is correct regardless.
- **Token lifetimes and rotation defaults.** Not verified.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | Authorization server types, issuer formats, discovery endpoints, org-server limitations, and the groups claim behaviour, from Okta developer documentation on 12/08/2026 |
| Org server token stability | Okta states contents are subject to change without notice. Treat org-server access tokens as unsuitable for your own API authorization |
| API Access Management | A separate paid product, required for a custom authorization server. This is a procurement dependency, not a configuration one |
| Groups scope on a custom server | The documentation's custom-server example shows only `scope=openid`. Not confirmed whether a `groups` scope is required there |
| Everything under "Not verified" above | Unverified. Do not fill these in from memory |

## Gotchas

- Agent does not establish which authorization server is in play, and every subsequent answer is a
  coin flip
- Agent builds its own resource server against org-server access tokens, which Okta says may change
  without notice
- Agent expects the `groups` claim to satisfy `hasRole(...)`. On the org server it is in the ID token
  only, and Spring reads authorities from access token scopes
- Agent tries to add groups to the org server's access token, which is not possible, rather than mapping
  from the ID token
- Agent omits the `groups` scope and finds the claim absent, then debugs the mapper
- Agent assumes the custom server needs the same scopes as the org server. The documentation does not say
  so
- Agent uses `.*` as the group regex in production, sending every group a user belongs to and eventually
  exceeding a header limit at the largest customer
- Agent mixes up the two discovery path shapes, since OIDC and RFC 8414 order `.well-known` differently
  for a custom server
- Agent assumes a custom authorization server is a setting rather than a paid product
- Agent fills in this file's unverified sections from memory instead of Okta's documentation

## Related

- [providers.md](providers.md) · [spring-security-oidc.md](spring-security-oidc.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [spring-security-saml.md](spring-security-saml.md) · [checklist.md](checklist.md)
