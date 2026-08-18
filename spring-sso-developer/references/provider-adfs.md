# Active Directory Federation Services (AD FS)

**Verified against Microsoft's AD FS documentation on 12/08/2026.** Spring identifiers are Spring Security
7.1.0. See [providers.md](providers.md).

AD FS is customer-operated, on-premises, and the provider you are most likely to meet in a large
enterprise that has not moved to the cloud. It is also the one where **the version determines what is
possible at all**.

## Ask the version before anything else

Microsoft's OpenID Connect and OAuth documentation for AD FS carries the applicability note:

> "Applies to Active Directory Federation Services (AD FS) 2016 and later"

**So on AD FS before 2016, OIDC is not an option.** The path is SAML 2.0 or WS-Federation, and no amount
of Spring configuration changes that. Plenty of AD FS 2.0 and 3.0 deployments are still in production,
because AD FS upgrades follow Windows Server upgrades and those follow their own timetable.

**The first question to a customer is therefore the AD FS version, not the protocol.** Asking "do you
support OIDC" invites a yes from someone who has read a datasheet; asking the version gets a fact.

**Default to SAML for AD FS.** It is supported across every version in the field, it is what the
customer's other federations already use, and their administrators will be fluent in it. See
[spring-security-saml.md](spring-security-saml.md) for configuration and
[security-saml.md](security-saml.md) for the attack surface, including CVE-2026-40988, which matters here
because AD FS commonly uses the HTTP-Redirect binding.

## If it is 2016 or later and you choose OIDC

| | |
| --- | --- |
| Issuer | `https://{adfs-host}/adfs` |
| Discovery | `https://{adfs-host}/adfs/.well-known/openid-configuration` |
| Keys | `/adfs/discovery/keys` |
| UserInfo | `/adfs/userinfo`, which "returns the subject claim" |
| Other endpoints | `/authorize`, `/token`, `/devicecode`, `/logout` |

Single logout for OpenID Connect is supported on **2016 and later**.

Note the UserInfo description: AD FS's UserInfo returns the **subject** claim. Do not plan on it as a
general profile endpoint.

## Application groups, which have no equivalent elsewhere

> "You must associate an application group with every native or web app OAuth client or web API resource
> that's configured with AD FS. Configure the clients in an application group to access the resources in
> the same group."

**This is a registration model, not a Spring concern**, but it shapes the conversation with the customer's
administrator. A client and the API it calls must be in the **same application group**, so "please
register our client" is an incomplete request. You need to specify the client, the web API resource, and
that they belong to one group.

## Scopes are configured *and* requested, and the default resource is a trap

**Both sides must agree, which is unusual.** Quoted:

> "an administrator configures the scope as `openid` during resource registration and the application
> (client) must send the `scope = openid` in the authentication request for AD FS to issue the ID Token"

So requesting `openid` is not sufficient if the resource was never registered with it. **You get no ID
token and no error explaining why**, which presents as a broken OIDC integration when it is a
registration gap on the customer's side.

AD FS's scope list is its own, and worth knowing because most of it exists nowhere else: `openid`,
`email`, `profile`, `allatclaims`, `user_impersonation`, `aza`, `logon_cert`, and `vpn_cert` which
"isn't supported anymore".

**And the default resource is a security-relevant default.** Quoted:

> "If the resource isn't passed using the resource or scope parameters, AD FS uses a default resource
> `urn:microsoft:userinfo` whose policies, such as, MFA, issuance, or authorization policy, can't be
> configured."

**Read that carefully.** Omit the resource and you silently land on a resource **whose MFA policy cannot be
configured**. So a request that looks like it worked has bypassed the ability to require multifactor
authentication for that resource. **Always pass the resource**, and if you are reviewing an existing
integration, check that it does. This interacts directly with the ASVS requirement to verify
authentication strength from the identity provider, in
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

**How the resource is passed depends on the client library.** With MSAL there is no `resource` parameter:
"the resource URL is sent as a part of the scope parameter: *scope = [resource url]/[scope values, for
example, openid]*". Spring sends plain scopes, so **for a Spring client you will be composing the
resource-qualified scope value yourself**, and that is the shape to test first when tokens come back for
the wrong audience.

## Audience and claims

**The access token audience is the resource identifier.** Quoted: "The 'aud' or audience claim of this
token must match the identifier of the resource or web API." So `audiences` in Spring should be set to the
web API identifier the customer registered, not to your client id.

**Claims come from claim rules.** AD FS applies administrator-authored claim rules after authentication to
determine what appears in the token. Two consequences:

- **What you receive is whatever the customer's administrator wrote.** There is no product default to rely
  on, so the claim set is a per-customer negotiation. Ask for a decoded sample token rather than a
  description.
- **Getting access token claims into the ID token needs the `allatclaims` scope**, plus `response_mode`
  set to `form_post`, plus KB4019472 on the AD FS servers, plus a permission grant:

  ```powershell
  Grant-AdfsApplicationPermission -ClientRoleIdentifier "https://my/privateclient" `
      -ServerRoleIdentifier "https://rp/fedpassive" -ScopeNames "allatclaims","openid"
  ```

  That is four separate preconditions, one of which is a Windows update. **Do not design around
  `allatclaims` without confirming all four**, and prefer reading claims from the access token where you
  can.

## Refresh tokens may not refresh

This surprises people who assume a refresh token implies indefinite renewal:

> "**Simple logon, no KMSI, device *not* registered**: AD FS applies `SsoLifetime` and
> `DeviceUsageWindowInDays`. The first refresh token has `lifetime=DeviceUsageWindowInDays` or
> `SsoLifetime`, based on which field is lower but *no* further refresh tokens are issued."

**So in the plainest configuration you get one refresh token and no rotation.** Continuous renewal requires
either KMSI (`EnableKmsi=true` in AD FS configuration **and** `kmsi=true` passed as a parameter) or a
registered device with device authentication, governed by `KmsiLifetimeMins` and
`PersistentSsoLifetimeMins`.

These are **server-side settings the customer controls**, so session duration in your application is
partly their configuration. That belongs in the documented session model required by ASVS V7.1.1 and
V7.1.3.

## Not verified in this pass

- **PKCE support, and from which version.** Not mentioned on the pages read. Spring Security 7.1.0
  requires PKCE by default for `authorization_code`, so **this is the first thing to test** against an
  AD FS 2016 deployment. If AD FS rejects it, `requireProofKey(false)` is the documented escape, and it is
  a recorded security downgrade. See [security-oauth2-oidc.md](security-oauth2-oidc.md).
- **The claim type naming scheme.** AD FS is associated with long URI-style claim types, but no example
  was verified here, so none is quoted. Get a decoded sample token from the customer.
- **SAML specifics**: entity ID format, metadata URL, certificate rotation and single logout behaviour.
- **Group and role claims**: which claim carries group membership, and in what form.
- **Version differences between 2016, 2019 and 2022**, beyond the 2016 floor for OIDC.
- **SCIM**: not expected, and not verified either way.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | OIDC applies to **AD FS 2016 and later**; endpoint paths; application group requirement; the scope model and scope list; the `urn:microsoft:userinfo` default resource and its unconfigurable policies; access token audience; `allatclaims` preconditions; refresh token lifetime behaviour; OIDC single logout on 2016+. Microsoft AD FS documentation, 12/08/2026 |
| Pre-2016 | **No OIDC.** SAML 2.0 or WS-Federation only |
| PKCE | **Not verified.** Test it first against Spring Security 7.1.0's default |
| Customer-operated | The customer chooses the version, the claim rules and the session settings. Treat all three as questions, not constants |
| `vpn_cert` scope | "isn't supported anymore" |

## Gotchas

- Agent asks "does it support OIDC" instead of asking the version, and designs around an answer from a
  datasheet
- Agent designs an OIDC integration for a pre-2016 AD FS, where it does not exist
- Agent requests `openid` without the resource having been registered with that scope, gets no ID token,
  and debugs Spring
- Agent omits the resource, silently lands on `urn:microsoft:userinfo`, and loses the ability to require
  MFA for that resource
- Agent sets `audiences` to the client id rather than the registered web API identifier
- Agent assumes a product-default claim set. Claims are whatever the customer's claim rules emit
- Agent designs around `allatclaims` without confirming the scope grant, `form_post`, and the KB
- Agent assumes refresh tokens rotate. In the simplest configuration only one is issued
- Agent treats session lifetime as its own decision when `SsoLifetime` and friends are the customer's
- Agent quotes an AD FS claim type URI from memory rather than from a decoded sample token
- Agent forgets AD FS commonly uses the HTTP-Redirect binding, which is the binding affected by
  CVE-2026-40988

## Related

- [providers.md](providers.md) · [spring-security-saml.md](spring-security-saml.md) · [security-saml.md](security-saml.md) · [spring-security-oidc.md](spring-security-oidc.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [checklist.md](checklist.md)
