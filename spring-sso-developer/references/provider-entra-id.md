# Microsoft Entra ID

**Verified against Microsoft's identity platform documentation on 12/08/2026.** Spring identifiers are
Spring Security 7.1.0. This is the most-deployed enterprise identity provider and the one with the most
traps, so this file is longer than the others. See [providers.md](providers.md) for the questions it
answers.

## Establish first: single tenant or multi tenant

Everything below branches on this, and it is a property of your **application registration**, not of your
code.

| | Single tenant | Multi tenant |
| --- | ------------- | ------------ |
| Metadata endpoint | `https://login.microsoftonline.com/{tenant-id}/v2.0/.well-known/openid-configuration` | `https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration` or `/organizations/...` |
| Issuer in metadata | The real tenant issuer | **The literal template** `https://login.microsoftonline.com/{tenantid}/v2.0` |
| Exact-match issuer validation | Works | **Cannot work** |

**Single tenant is unremarkable.** The metadata issuer and the token `iss` match exactly, which is all
OIDC Core requires. Set `issuer-uri` and Spring's default validation is correct.

## The multi-tenant issuer problem

**Microsoft returns a template, not a value.** The tenant-independent metadata document reports its issuer
as `https://login.microsoftonline.com/{tenantid}/v2.0`, where `{tenantid}` is a literal placeholder. A
real token's `iss` contains the tenant GUID. **They never match as strings**, so any validator doing exact
comparison fails, by design rather than by misconfiguration.

Microsoft's stated requirements for validating these tokens, all three of which are needed:

1. **Substitute** `{tenantid}` in the metadata issuer with the tenant id targeted by the request, then
   check for an exact match.
2. **Validate the signing key issuer.** Each key in the keys document carries its own `issuer` property. A
   templated value may be used only after substitution; a GUID value such as
   `https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0` must match exactly.
3. **Tie them together**: confirm `tid` is a GUID and that `iss` is exactly
   `https://login.microsoftonline.com/{tid}/v2.0` for that `tid`.

That third step is what turns three independent checks into one chain of trust. Skipping it leaves a
token whose issuer and whose signing key are each individually plausible.

**In Spring, enumerate the tenants and use an allowlist:**

```java
JwtIssuerAuthenticationManagerResolver resolver =
        JwtIssuerAuthenticationManagerResolver.fromTrustedIssuers(
                "https://login.microsoftonline.com/aaaabbbb-0000-cccc-1111-dddd2222eeee/v2.0",
                "https://login.microsoftonline.com/bbbbcccc-1111-dddd-2222-eeee3333ffff/v2.0");

http.oauth2ResourceServer((oauth2) -> oauth2.authenticationManagerResolver(resolver));
```

**Whether any Spring validator performs Microsoft's `{tenantid}` substitution was not verified**, and
`JwtIssuerValidator` compares strings, so do not assume it does. Accepting tenants you cannot enumerate in
advance means writing a validator that implements all three rules above, not just the first.

**What you must not do**, and what teams do when this fails: disable issuer validation. That turns an
inconvenience into an authentication bypass, because the issuer is what binds a token to a tenant.

## Which claim is the user

Microsoft is unusually direct here, and it contradicts what most applications do.

> "Never use `email` or `upn` claim values to store or determine whether the user in an access token
> should have access to data. Mutable claim values like these can change over time, making them insecure
> and unreliable for authorization."

And for `upn` specifically: "Not a durable identifier for the user and shouldn't be used for
authorization or to uniquely identity user information (for example, as a database key). Instead, use the
user object ID (`oid`) as a database key."

**So: `oid` is the directory object identifier and is what Microsoft tells you to key on.** Combine it
with `tid`, because claims on this provider are interpreted **within the tenant**: two tokens can carry
the same `sub` and describe different people in different tenants, and Microsoft states that `tid` "must
be part of the key used to access the user's data".

**The practical rule for a multi-tenant product: key on `(tid, oid)`.** Never on `email`, never on `upn`,
and not on `sub` alone.

**One related claim worth knowing if you link accounts by email at all.** `xms_edov` is a boolean
indicating whether the user's email domain owner has been verified. Microsoft notes that Facebook and
SAML/WS-Fed accounts **do not** have verified domains. If any flow in your product treats a matching
email as proof of identity, an unverified domain is how someone claims another person's account.

## Groups, and why they vanish at your largest customer

This is the Entra behaviour that breaks in production rather than in development, because it depends on
how many groups a real user is in.

**The limits, quoted:** "The number of groups emitted in a token is limited to 150 for SAML assertions and
200 for JWT, including nested groups."

**And the failure mode is not truncation.** "Exceeding this limit will cause Microsoft Entra ID completely
omit sending group claims in the token." A link to the Microsoft Graph endpoint is included instead, so
the application must call Graph to enumerate the user's groups.

Read that in production terms: **an administrator at a large customer, who is in more groups than anyone
else, is the user most likely to arrive with no groups at all** and therefore no privileges. It works for
every test account and fails for the person who reports it.

Three further limits and behaviours:

- **Implicit flow: a five-group limit**, with a `"hasgroups":true` claim emitted instead when the user is
  in more than five groups.
- **Group filtering only works below 1,000 groups.** "Microsoft Entra ID supports group filtering only if
  a user belongs to 1,000 or fewer groups (including direct and transitive memberships). If this limit is
  exceeded, filtering won't apply and an overage claim is sent instead." So filtering does not rescue the
  worst case, which is the case you need rescuing.
- **`ApplicationGroup` excludes nested groups.** Restricting to groups assigned to the application is
  Microsoft's recommendation for large organisations, and the trade is that "nested groups are not
  included and the user must be a direct member of the group assigned to the application".

**Microsoft's own recommendation is to stop using groups for this.** Quoted: base in-app authorization on
**application roles** rather than groups when developing a new application, because it "limits the amount
of information that needs to go into the token, is more secure, and separates user assignment from app
configuration". Roles arrive in the `roles` claim, are assigned per application, and have no overage
behaviour of this kind. **Take that advice** unless you need nested group semantics.

### Configuring group claims

`groupMembershipClaims` in the application manifest takes `All`, `SecurityGroup`, `DirectoryRole`,
`ApplicationGroup` or `None`. Note `DirectoryRole` emits a `wids` claim and **no** group claim.

`optionalClaims` is per token type, and the type names matter: `idToken`, `accessToken`, and `Saml2Token`
which covers both SAML 1.1 and 2.0. `additionalProperties` accepts `sam_account_name`,
`dns_domain_and_sam_account_name`, `netbios_domain_and_sam_account_name`, `cloud_displayname` and
`emit_as_roles`.

**Two traps in that configuration.**

**`emit_as_roles` silently displaces your application roles.** Quoted: "If you use `emit_as_roles`, any
configured application roles that the user is assigned to will not appear in the role claim." So a config
intended to add group information removes role information.

**Group display names are not safe to authorise on**, and Microsoft explains why cloud display names are
restricted to assigned groups: "a group name is not unique, and display names can only be emitted for
groups explicitly assigned to the application to reduce the security risks. Otherwise, any user could
create a group with duplicate name and gain access in the application side." **Authorise on group
`ObjectID`**, which is immutable and unique. If you must use `sAMAccountName` for a migrated application,
use the domain-qualified form, because it can collide across multiple synced Active Directory domains.

## Verifying what the authentication actually was

This is where Entra answers ASVS 5.0 V6.8.4, and it is better instrumented than most providers. See
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

**`amr` tells you the method.** Microsoft publishes the mapping, and the operative line is that
`multipleauthn` and `mfa` "are emitted only when the user has completed MFA". Selected values:

| Method | `amr` values |
| ------ | ------------ |
| Password | `pwd` |
| Authenticator push | `rsa`, `ngcmfa`, `mfa` |
| Authenticator TOTP | `totp`, `mfa` |
| SMS | `sms`, `mfa` |
| FIDO2 security key, passkey | `fido`, `mfa` |
| Windows Hello for Business | `hwk`, `mfa`, `ngcmfa` |
| Certificate-based | `hwk` or `x509`, `mfa`, `rsa` |
| Windows integrated (Kerberos) | `wia` |

**So `amr` containing `mfa` is a verifiable assertion that MFA happened**, rather than a belief that the
customer enabled it. That is the difference between a control and an assumption.

**But you have to ask for it.** `amr` is a **v2.0-specific optional claim**, and for SAML applications
"the application administrator must add the optional `amr` claim with the `include_granular_amr`
additional property", except for Salesforce applications where it is sent by default.

**`auth_time` is also optional**, not present by default. If you enforce re-authentication recentness for
sensitive actions, request it or you have nothing to check.

**For step-up**, `acrs` carries Auth Context IDs "of the operations that the bearer is eligible to
perform", and is used with `xms_cc`, where a value of `cp1` "is the authoritative way to identify that a
client application is capable of handling a claims challenge". This is the Conditional Access and
Continuous Access Evaluation path.

## Audience validation, and a v1.0 hazard

Microsoft requires that web APIs "must only accept tokens containing one of their AppId URIs as the `aud`
claim", and names accepting a token meant for another resource as the **confused deputy** problem.

**In v1.0 access tokens the `aud` value is not stable.** It "can be emitted in various ways - any appID
URI, with or without a trailing slash, and the client ID of the resource", which the documentation itself
calls hard to code against. The fix is the `use_guid` additional property on the `aud` optional claim,
which forces the resource's client ID in GUID form every time. **Set it** rather than writing a validator
that accepts several shapes, since accepting several shapes is how an audience check becomes decorative.

`idtyp` is worth knowing for a resource server that serves both users and services: its value is `app`
for an app-only token, and Microsoft calls it "the most accurate way for an API to determine if a token is
an app token or an app+user token".

## Token versions and lifetimes

**Two token versions coexist and they are not interchangeable.** `requestedAccessTokenVersion` in the app
manifest controls it: `null` or `1` gives v1.0, `2` gives v2.0.

| | v1.0 | v2.0 |
| --- | --- | --- |
| `iss` | `https://sts.windows.net/{tenantid}/` | `https://login.microsoftonline.com/{tenantid}/v2.0` |
| Metadata to validate against | The v1.0 endpoint | The v2.0 endpoint |

**And the version of the token decides which metadata document you read, not the authority you
configured.** Microsoft states that validating a `ver` 1.0 token requires the v1.0 metadata endpoint "even
if the authority configured for your web API is a v2.0 authority", and the converse. A mismatch here looks
like an unexplained signature or issuer failure.

**Lifetimes are deliberately variable.** Access tokens get "a random value ranging between 60-90 minutes
(75 minutes on average)" by default, to spread reissue load. Long-lived cases with Continuous Access
Evaluation range from 20 to 28 hours. **Do not hard-code an expectation of one hour.**

**Signing keys rotate continuously**, and Microsoft recommends checking for updated public keys **every 24
hours**. Spring caches JWKS, so an over-cached or pinned key set fails at rotation rather than at deploy.

## Not verified in this pass

- **The exact claim names emitted in the groups overage case.** The documentation says a link to the
  Microsoft Graph endpoint is included instead of the groups, but the claim names carrying it were not
  confirmed here. Read Microsoft's documentation before implementing the Graph fallback.
- **SAML specifics**: metadata URL shape, signing certificate rotation and single logout behaviour.
- **SCIM provisioning** shape and deprovisioning semantics.
- **PKCE for confidential clients**: whether Entra accepts it. Spring Security 7.1.0 requires it by
  default, so a rejection appears at the token request.
- **Whether `sub` is pairwise per application.** Only its tenant-scoped interpretation was confirmed, and
  the recommendation to key on `oid` makes this moot in practice.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | Issuer formats and multi-tenant validation rules, identity claim guidance, group limits and behaviour, `amr` values, audience behaviour, token versions and lifetimes, key rotation cadence. Microsoft identity platform documentation, 12/08/2026 |
| Group limits | **150 SAML, 200 JWT**, including nested. Five for implicit flow. Filtering only below 1,000 groups |
| Overage behaviour | Group claims are **omitted entirely**, not truncated |
| `amr` and `auth_time` | **Optional claims.** Absent unless requested. SAML needs `include_granular_amr` |
| v1.0 `aud` | Unstable unless `use_guid` is set |
| Spring template handling | **Not verified** whether any Spring validator substitutes `{tenantid}` |
| Consumers tenant | `consumers` is a nickname for tenant `9188040d-6c67-4c5b-b112-36a304b66dad` |

## Gotchas

- Agent points `issuer-uri` at `/common` and cannot understand why issuer validation fails. The metadata
  issuer is a template and never matches a token
- Agent then disables issuer validation, converting a configuration problem into an authentication bypass
- Agent implements the tenant substitution and omits the signing key issuer check, breaking the chain of
  trust at its second link
- Agent keys user records on `email` or `upn`, both of which Microsoft explicitly says are mutable and
  unsuitable for authorization
- Agent keys on `sub` alone in a multi-tenant product. Microsoft says use `oid`, and the tenant must be
  part of the key
- Agent tests group claims with an account in five groups and ships. The customer's administrator is in
  more than 200 and arrives with no groups at all
- Agent expects the groups claim to be truncated on overage. It is omitted entirely
- Agent adds group filtering to solve the overage, which stops applying above 1,000 groups
- Agent uses `emit_as_roles` and silently loses every application role the user was assigned
- Agent authorises on group display names, which are not unique and which any user can duplicate
- Agent treats "the customer has MFA enabled" as a control without checking `amr` for `mfa`
- Agent checks `amr` or `auth_time` without configuring them as optional claims, and finds them absent
- Agent validates a v1.0 token against v2.0 metadata and reports an unexplained signature failure
- Agent accepts several `aud` shapes on a v1 token instead of setting `use_guid`
- Agent hard-codes a one-hour token lifetime expectation
- Agent over-caches JWKS and fails at the next key rotation

## Related

- [providers.md](providers.md) · [spring-security-oidc.md](spring-security-oidc.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [checklist.md](checklist.md)
