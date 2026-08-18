# Google Workspace and Google Identity

**Verified against Google's OpenID Connect documentation on 12/08/2026.** Spring identifiers are Spring
Security 7.1.0. See [providers.md](providers.md).

## Two issuer values, and Spring validates one

Google's own validation instruction, quoted:

> "Verify that the value of the `iss` claim in the ID token is equal to `https://accounts.google.com` or
> `accounts.google.com`."

**Two acceptable forms, one with a scheme and one without.** Spring's `JwtIssuerValidator` compares
strings against a single configured issuer, so a token carrying the form you did not configure fails
validation while being entirely valid by Google's rules.

**Whether Spring's default configuration accommodates both forms was not verified in this pass.** Do not
assume it does, and do not assume it does not. Two ways to establish it, in order of preference:

1. **Test it.** Obtain a real ID token from a real Google sign-in and read its `iss`. If your tenant only
   ever emits one form, configure that form and move on. This is the cheapest answer and the most
   reliable.
2. **If both forms appear**, you need a validator accepting either, composed with the defaults through
   `DelegatingOAuth2TokenValidator` so issuer and expiry checks survive. See
   [security-oauth2-oidc.md](security-oauth2-oidc.md) for why replacing rather than delegating is the
   trap.

Discovery is at `https://accounts.google.com/.well-known/openid-configuration`.

## The `hd` claim is the whole B2B story

**Vulnerable pattern.** You sell SSO to a customer on Google Workspace, configure "Sign in with Google",
and it works. **Any Google account on earth can now sign in**, including a personal Gmail address,
because nothing restricts which Google account is acceptable.

Google addresses this directly, and the distinction it draws is the important part:

> "Don't rely on this UI optimization to control who can access your app, as client-side requests can be
> modified. Be sure to validate that the returned ID token has an `hd` claim value that matches what you
> expect."

And:

> "Unlike the request parameter, the ID token `hd` claim is contained within a security token from Google,
> so the value can be trusted."

**So there are two `hd`s and only one is a control:**

| | Trustworthy | Purpose |
| --- | --- | --- |
| `hd` **request parameter** | **No.** Client-side requests can be modified | A UI optimisation that pre-selects a domain on the sign-in page |
| `hd` **claim in the ID token** | **Yes.** It is inside a token signed by Google | The value you authorise on |

`hd` is "the domain associated with the Google Workspace or Cloud organization of the user".

**The rule for a multi-tenant product:** the tenant is resolved from the **`hd` claim**, matched against
the domains that tenant has registered, and a token whose `hd` matches no registered domain is rejected
rather than treated as a new signup. And note **`hd` is absent for a personal Google account**, which is
precisely the case you are excluding, so absence must fail closed. See
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

This is the Google equivalent of every other provider's tenant-binding rule, and it is easier to get
wrong here because the integration appears to work perfectly while being open to the world.

## Identity: `sub`, and only `sub`

Google is unusually clean here, and differs from Entra ID and Keycloak.

> "An identifier for the user, unique among all Google Accounts and never reused... A Google Account can
> have multiple email addresses at different points in time, but the `sub` value is never changed."

**So Google's `sub` is globally unique and permanently stable**, which means `sub` alone is a valid
primary key. Contrast with Entra ID, where `sub` is interpreted within the tenant and Microsoft directs
you to `(tid, oid)`, and with Keycloak, where subjects are scoped per realm. **This is exactly why the
per-provider files exist**: the correct primary key is a per-provider answer, not a general one.

Google states the negative case too: "Don't use the `email` field as a unique identifier for a user.
Always use the `sub` field." `email_verified` is "True if the user's email address has been verified", and
is the claim to check if any flow treats an email match as meaningful.

**In a product supporting several providers, still store the issuer alongside the subject.** Google's
`sub` is unique among Google accounts, not unique among all your users, so `(issuer, sub)` remains the
right shape once a second provider exists.

## Groups are not in the token

**Group membership does not appear in the ID token.** Google's OpenID Connect documentation does not
provide it, and **it does not name an alternative API on the page read**, so the API to call is
**unverified here**.

What this means for design, which does not depend on the API name:

- **Plan a directory lookup**, not a claim mapping. Authorities come from a call to Google after
  authentication, not from the token, which means an extra dependency in your login path and a caching
  decision.
- **Cache the result** against the user's session, and decide the staleness you accept, because a group
  change at the customer will not reach you until the cache expires.
- **Have a fallback** for when the lookup fails. A directory call that errors during login must not
  silently produce a user with no authorities, which is the failure mode that looks like a permissions
  bug.
- **Or avoid it.** If your product's roles are managed in your product rather than mirrored from the
  customer's directory, you do not need groups from Google at all. For many B2B products that is the
  right answer, and it removes this whole section.

## Not verified in this pass

- **Whether Spring's default issuer validation accepts both `iss` forms.**
- **The API for retrieving group membership**, and the scopes it requires.
- **SAML.** Google Workspace can act as a SAML identity provider for third-party applications, but its
  metadata shape, certificate rotation and single logout behaviour were **not verified here**, and nor
  was the boundary between the OIDC and SAML paths. **Do not assume Google is OIDC-only.**
- **SCIM** provisioning support and deprovisioning semantics.
- **PKCE for confidential clients.**
- Token lifetimes and refresh token behaviour, including whether refresh tokens are issued by default.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | Discovery URL, both accepted `iss` forms, the `hd` claim and its trust boundary, `sub` stability and uniqueness, `email_verified`. Google OpenID Connect documentation, 12/08/2026 |
| `iss` | **Two accepted forms:** `https://accounts.google.com` and `accounts.google.com` |
| `hd` | Trustworthy **as a claim**, not as a request parameter. Absent for personal accounts |
| `sub` | Globally unique and never changed. Unlike Entra ID and Keycloak |
| Groups | Not in the ID token. Directory lookup required, API unverified |

## Gotchas

- Agent ships "Sign in with Google" for a Workspace customer and never validates `hd`, so any Google
  account in the world can sign in to that customer's tenant
- Agent validates the `hd` **request parameter** instead of the claim. The parameter is a UI hint and can
  be modified client-side
- Agent treats a missing `hd` as acceptable. It is absent for personal accounts, which is the case being
  excluded, so it must fail closed
- Agent configures one `iss` form and is surprised when a valid token carrying the other is rejected
- Agent keys users on `email`. Google says explicitly to use `sub`
- Agent expects a groups claim and finds none, then debugs the authority mapper instead of planning a
  directory lookup
- Agent adds a directory lookup with no fallback, so a failed call yields a user with no authorities
- Agent assumes Google cannot act as a SAML identity provider. That was not established either way here
- Agent uses Google's `sub` as a global primary key in a product that also supports other providers.
  Unique among Google accounts is not unique among your users

## Related

- [providers.md](providers.md) · [spring-security-oidc.md](spring-security-oidc.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [checklist.md](checklist.md)
