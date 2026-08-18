# Sessions, Logout and Tenant Isolation

Protocol-level correctness does not survive a broken session model. These are the failures that sit
either side of the SSO handoff, plus the one class specific to multi-tenant SaaS, where the same
validation gap changes from an account compromise into a cross-customer breach.

## Session fixation across the SSO handoff

**Vulnerable pattern.** The session identifier issued before authentication survives it. An attacker who
planted a known session id in the victim's browser is now inside an authenticated session, having never
seen a credential.

The requirement is that **the session identifier changes at the moment privileges change**, which in an
SSO flow is when the assertion or token is accepted, not when the redirect starts.

Spring Security handles this by default, and the good news is that you mostly have to avoid breaking
it. The `sessionManagement()` DSL exposes `sessionFixation()` with four strategies:

```java
http.sessionManagement((session) -> session.sessionFixation().changeSessionId());
```

| Strategy | Behaviour |
| -------- | --------- |
| `changeSessionId()` | Uses the Servlet container's own `HttpServletRequest#changeSessionId()`, changing the id and retaining attributes. **The default** |
| `newSession()` | Creates a clean session, copying no existing attributes except Spring Security's own |
| `migrateSession()` | Creates a new session and copies all existing attributes |
| `none()` | **No protection.** Only defensible when something else already provides it, and the documentation says it "is not recommended" |

**A discrepancy worth knowing about.** The reference documentation describes the default as
container-conditional: `changeSessionId` "is the default in Servlet 3.1 and newer containers" and
`migrateSession` "is the default in Servlet 3.0 or older containers". The Spring Security 7.1.0 source
tells a simpler story: `SessionManagementConfigurer.createDefaultSessionFixationProtectionStrategy()`
returns `new ChangeSessionIdAuthenticationStrategy()` with no container check of any kind. So on
Spring Security 7.1.0 the effective default is **`changeSessionId`, unconditionally**. The
documentation's conditional wording describes older behaviour. Either way the practical answer is the
same, and the reason to know it is that "it depends on the container" is a false lead when debugging.

**So the review question is not "is protection enabled" but "has someone disabled it".** The usual
cause of a fixation bug in a Spring application is `none()` being set to make an unrelated symptom go
away, most often a lost session attribute during login. Search for `sessionFixation` and confirm what
it says.

**Related session controls that belong in the same review.** `sessionCreationPolicy()` takes
`ALWAYS`, `IF_REQUIRED`, `NEVER` or `STATELESS`, and defaults to `IF_REQUIRED`. `STATELESS` is right
for a pure resource server and wrong for an SSO login flow, which needs a session to hold the
authentication between the redirect out and the assertion coming back. Concurrent session control uses
`maximumSessions(int)`, or `maximumSessions(SessionLimit)` from 6.5, with `maxSessionsPreventsLogin`
choosing whether the new login is rejected or the oldest session expired. **It requires an
`HttpSessionEventPublisher` bean as well as the DSL call**, and omitting that bean is why concurrency
limits silently fail to apply.

**Where this is most often broken deliberately:** an application that keeps a pre-login session to hold
"where the user was going" and then reuses that same session after login. Keep the redirect target, not
the session.

## What the identity provider actually asserted

Delegating authentication does not delegate the decision about whether that authentication was good
enough. **ASVS 5.0 V6.8.4** puts the obligation on you: "if an application uses a separate Identity
Provider (IdP) and expects specific authentication strength, methods, or recentness for specific
functions, the application verifies this using the information returned by the IdP."

**Vulnerable pattern.** The product requires MFA for administrative actions, the customer has MFA
enabled at their identity provider, and the application never checks. A session established with a
password alone reaches the administrative function, because "we require SSO and they require MFA" was
treated as a control rather than as two independent assumptions.

**What carries the answer.** OIDC Core defines `acr` for the authentication context class, `amr` for the
methods used, and `auth_time` for when authentication happened. SAML carries the equivalents as
`AuthnContextClassRef` and the assertion's `AuthnInstant`.

**Whether a given provider populates them usefully is provider-specific and must be checked**, not
assumed. `amr` in particular is inconsistently populated across providers, so verify against a real
token from the actual tenant before designing a rule on it. See [providers.md](providers.md).

Three rules that follow:

- **If you require a factor, verify it in the assertion or token.** Requiring it in a settings page is a
  product statement, not an enforced control.
- **Recentness is separate from validity.** A session valid for eight hours says nothing about whether
  the person authenticated eight hours ago or eight seconds ago. Sensitive actions need `auth_time` or
  `AuthnInstant`, not merely an unexpired session. ASVS V7.5.1 and V7.5.3 require re-authentication
  before sensitive changes and transactions.
- **Step-up means asking the provider again**, with a request for the stronger context, and then
  verifying what comes back. It does not mean setting a flag in your own session.

**And close the side doors.** ASVS V6.3.4 requires that where an application has multiple authentication
pathways, "there are no undocumented pathways and that security controls and authentication strength are
enforced consistently." In an SSO product the undocumented pathways are the interesting ones: a legacy
password login, an API token, an impersonation feature, a break-glass account. Each is an authentication
pathway, and each needs the same strength rules or an explicit exception.

## Session termination you have to build

Three ASVS requirements that are ordinary product features until someone asks for them during a
security review, and are then urgent:

- **V7.4.5:** administrators can terminate active sessions "for an individual user or for all users".
  This is what you need during an incident, and building it under incident conditions is how a
  permanent bypass gets created.
- **V7.4.2:** all active sessions are terminated when an account is disabled or deleted. Disabling an
  account in your database while a valid session or access token is in flight removes nothing. See the
  deprovisioning section below.
- **V7.5.2:** users can view their own active sessions and terminate them, having re-authenticated.

**None of these are protocol work**, which is why they are routinely missing from an SSO project that
considers itself finished. They need a server-side record of live sessions, which a purely
token-stateless design does not have. That is a design consequence of choosing stateless tokens, and it
should be a decision rather than a discovery.

**Write the session model down.** ASVS asks for this explicitly, and it is the cheapest item here:
V7.1.1 the inactivity timeout and absolute maximum lifetime, V7.1.2 how many concurrent sessions an
account may have and what happens at the limit, and V7.1.3 that the systems creating and managing
sessions "as part of a federated identity management ecosystem (such as SSO systems)" are documented.
Idle timeout and absolute lifetime are two separate numbers and both need choosing, per V7.3.1 and
V7.3.2.

## Incomplete logout

**Vulnerable pattern.** Logout clears the local session and nothing else. The identity provider session
is intact, so the next login is silent and looks as though logout never happened. Tokens issued before
logout keep working until they expire.

Three separate things must happen. Most implementations do only the first:

1. **The local session is invalidated** and its cookie cleared.
2. **The identity provider session is ended**, through OIDC RP-initiated logout or SAML single logout.
3. **Tokens issued to that session are revoked**, or their lifetimes are short enough that the remaining
   window is an accepted, written-down risk.

**There are always at least two sessions, and confusing them is the root of most logout bugs.** The
identity provider holds an SSO session, and each application holds its own. They have different
lifetimes and different idle timeouts. Ending the application session leaves the SSO session alive, so
the next login is silent; ending the SSO session leaves application sessions alive, so the user stays
logged in to the applications. Wilson and Hingnikar organise this as separate concerns for a reason, and
a logout implementation that has not decided which sessions it is ending is not finished. Write down
both durations, because "logout does not work" is usually "these two lifetimes differ and nobody chose
them".

**Browser-mediated logout is the weak variety.** Propagation happens either through the front channel,
where the browser is redirected or loads hidden frames for each participant in turn, or through the back
channel, where the identity provider calls each relying party server to server. Front-channel
propagation fails for ordinary reasons that are not bugs: the user closes the tab mid-chain, a
participant is slow, or third-party cookie and frame restrictions stop the request being made at all.
Back-channel propagation does not depend on the browser staying put and is the more reliable design
where both ends support it.

**Spring Security 7.1.0 implements back-channel logout**, so on the Spring side this is a configuration
question rather than an open one: `OidcBackChannelLogoutHandler`, the `oidcLogout().backChannel(...)` DSL
and the endpoint `/logout/connect/back-channel/{registrationId}`, set out in
[spring-security-oidc.md](spring-security-oidc.md). Two conditions decide whether it helps you. Your
identity provider has to support OIDC back-channel logout and be told your endpoint, which is
provider-specific and belongs in the provider file. And the link between provider session and application
session is held in an `OidcSessionRegistry` that is **in memory by default**, so on more than one instance
you need a shared implementation or the mechanism quietly covers a fraction of sessions. Enabling it also
creates an availability surface that ASVS 5.0 **10.5.5** asks you to mitigate, since an endpoint that ends
sessions on request can be abused to end them.

**Single logout is unreliable in practice.** It fails across identity providers with differing support,
and it fails across several service providers sharing one identity provider session, where one
participant not honouring the request leaves the user logged in somewhere they believe they left. Design
for it failing:

- Keep access token lifetimes short, so an unpropagated logout has a bounded window.
- Treat logout as best-effort at the identity provider and authoritative locally.
- **Never present single logout to users as a security guarantee**, and never rely on it as the control
  that ends access on a shared device.

**The consequence for deprovisioning:** if logout is unreliable, then so is "we removed their access".
Access removal has to be enforced at the resource server through short token lifetimes plus revocation
or introspection, not by ending sessions.

## Deprovisioning, which is the part customers audit

Provisioning gets built because nothing works without it. Deprovisioning gets deferred because
everything appears to work without it, and it is the half a customer's security review asks about. The
structure below follows the identity-lifecycle treatment in Wilson and Hingnikar, chapter 15.

**Removing access is not deleting a record.** Four separate actions, and most implementations do the
first only:

1. **Terminate access.** Sessions ended, and tokens revoked or expired. Per the logout section above,
   ending a session does not end a token, so short access token lifetimes are what actually bound the
   window.
2. **Reset credentials** held locally, if any exist alongside SSO. An orphaned local password is a
   working back door into an account that federation no longer governs.
3. **Preserve the account record** for audit. "Who did this, and when" must survive the person leaving.
   Hard-deleting the identity destroys the audit trail that the same compliance review will ask for.
4. **Decide the reprovisioning story** before you need it. People come back, and contractors come back
   repeatedly.

**The identifier-reuse hazard, which is a genuine vulnerability rather than hygiene.** If you key
accounts on an email address or a username and the customer later reissues that identifier to a
different person, the new person inherits the old person's account through nothing more than logging in.
Two defences: **reserve deprovisioned identifiers** rather than freeing them for reuse, and key internal
records on the identity provider's stable subject identifier rather than on the email address. The
provider's `sub` claim, or the SAML persistent name identifier, exists precisely because email addresses
are mutable and reassignable.

**But `sub` alone is not always enough, and assuming it is causes a worse bug than the one it fixes.**
On a multi-tenant provider the subject may be unique only **within** a tenant or realm. Microsoft states
this explicitly for Entra ID: with tenant-independent metadata, claims are interpreted within the tenant,
two tokens can carry the identical `sub` and describe **different people**, and the `tid` claim "must be
part of the key used to access the user's data". Keycloak realms scope subjects the same way.

So the rule is: **key on the pair, tenant plus subject.** Keying on `sub` alone against a multi-tenant
provider silently merges two customers' users into one account the first time two tenants collide, which
is worse than the email-reuse problem because it crosses a customer boundary rather than staying inside
one. Per-provider specifics are in [providers.md](providers.md).

**Prefer soft delete, with a defined path to hard delete.** Soft delete keeps the record, keeps the
audit trail, and makes an accidental deprovisioning recoverable. A right-to-erasure request is then a
separate, deliberate operation with its own authorisation and its own record, rather than the same code
path as an ordinary offboarding.

**In multi-tenant SaaS, deprovisioning is per tenant.** A user removed from one customer's directory
must lose access to that customer's tenant only, and the same human may legitimately remain active in
another. This is a strong argument for the tenant binding being part of the membership record rather
than a property of the user.

**Automated versus manual is a product decision with a security consequence.** SCIM or a similar
provisioning integration removes access in minutes; a manual process removes it whenever someone
remembers. If deprovisioning is manual, say so in the security questionnaire honestly, because the gap
between an employee leaving and their access ending is the number the customer is measuring.

## Login CSRF and clickjacking

**Login CSRF** is covered for OAuth2 by `state`, and is the specific structural weakness of
IdP-initiated SAML, which has no `AuthnRequest` to bind against. See
[security-oauth2-oidc.md](security-oauth2-oidc.md) and [security-saml.md](security-saml.md).

**Clickjacking** on login and consent pages requires frame protection. Spring Security sends frame
options by default, so the realistic failure is someone having relaxed it to allow embedding the
application somewhere, and then never restoring it for the login and consent routes specifically. When
reviewing, check the login route rather than the application default.

## CORS misconfiguration

**Vulnerable pattern.** A permissive CORS policy, in particular reflecting the `Origin` header with
credentials allowed, lets a hostile origin read authenticated responses, including any endpoint that
returns a token.

Reflecting arbitrary origins **with credentials enabled** is the specific mistake, and it is common
because it makes a local development problem disappear. Two rules:

- An allowlist of origins, never a reflection of the request's `Origin`.
- **A token-returning endpoint should not be CORS-reachable at all.** If the browser needs a token, that
  is a signal to move to a backend-for-frontend rather than to widen CORS.

## Tenant isolation, the class specific to SaaS

This is the one where SSO defects stop being account-level. A validation gap that would leak one user's
data in a single-tenant application leaks **one customer's entire dataset** here, and it will be found
by a customer's security review rather than by you.

**Vulnerable pattern.** The tenant is taken from something the user controls: a query parameter, a form
field, a subdomain trusted without checking, or an unverified claim. Authentication succeeds against
tenant A's identity provider and the session is then bound to tenant B.

Five rules hold this together:

1. **Tenant context is derived at authentication time and stored server-side in the session.** It is
   never re-read from a request parameter afterwards. If a later request needs to know the tenant, it
   asks the session, not the URL.
2. **The identity provider is resolved from the tenant, and the assertion or token is verified with that
   tenant's key or issuer only.** Never verify against the union of all configured keys. This is the
   multi-IdP key confusion problem, and in a SaaS product it is a cross-customer authentication bypass.
3. **Every authorization check includes the tenant**, so a valid token for tenant A cannot address
   tenant B's resources. Audience and tenant claims are authorization inputs, not descriptive metadata.
4. **Home-realm discovery is not authentication.** Resolving which identity provider an email domain
   belongs to happens *before* any identity is proven. Treat the input as hostile, rate-limit it, and do
   not let it select a signing key. Leaking whether a domain is configured is also an information
   disclosure some customers will raise.
5. **Verify that the claim you route on is signed.** Spring's own warning about tenant-aware key
   selection: **"make sure that the authorization server is configured to include the claim set as part
   of the token's signature. Without this, you have no guarantee that the issuer hasn't been altered by
   a bad actor."**

**Two further operational rules that are specific to selling SSO as a feature:**

- **SSO-enforced versus SSO-optional is a per-organisation setting, and it is a security control.** If
  an organisation has enforced SSO, password login for its users must be closed, including any
  pre-existing password and any password-reset path. Otherwise SSO enforcement is decorative, and the
  customer believes they have a control they do not have.
- **Keep a break-glass path that does not depend on the customer's identity provider.** When a
  customer's IdP certificate expires or their tenant is misconfigured, every administrator at that
  customer is locked out, including the one who needs to fix it. Design the recovery path deliberately,
  restrict it tightly, and log every use of it, because an unplanned break-glass path invented during an
  outage is how a permanent bypass gets created.

**Where tenant configuration is stored**, and the shared-schema versus schema-per-tenant versus
database-per-tenant decision, belongs to `postgresql-developer`'s multi-tenancy material rather than
here. What belongs here is that the tenant identifier used for authentication and the one used for data
isolation must be the same value, resolved once.

## Version notes

**Sources:** OWASP OAuth2 and SAML cheat sheets, and the Spring Security 7.1.0 reference documentation
read on 12/08/2026 for the tenant-aware key selection warning.

| Concern | Detail |
| ------- | ------ |
| Session fixation protection | Default is `changeSessionId`. Verified twice: the reference documentation states it as the default for Servlet 3.1 and newer, and `SessionManagementConfigurer.createDefaultSessionFixationProtectionStrategy()` in the Spring Security 7.1.0 source returns `ChangeSessionIdAuthenticationStrategy` unconditionally |
| `maximumSessions(SessionLimit)` | Added in Spring Security **6.5**. The `int` overload predates it |
| `sessionCreationPolicy` default | `IF_REQUIRED` |
| Servlet or Jakarta EE baseline | **Not asserted.** The prerequisites page states Java 17 or higher and does not state a Servlet minimum, so no Servlet baseline is claimed here |
| Frame options | Sent by default by Spring Security. The failure mode is a project having relaxed it |
| OIDC RP-initiated logout | Implemented by Spring Authorization Server as an OIDC 1.0 endpoint. Client-side support belongs to the OAuth2 client configuration; see [spring-security-oidc.md](spring-security-oidc.md) |
| SAML single logout | Spring Security exposes SLO endpoints; the default paths are listed in [spring-security-saml.md](spring-security-saml.md) |
| OWASP ASVS | Cross-checked against **ASVS 5.0.0**, released 30 May 2025, chapters **V6 Authentication**, **V7 Session Management**, **V9 Self-contained Tokens** and **V10 OAuth and OIDC**. Note 5.0 renumbered: material citing V2 and V3 is against ASVS 4.x, and V9 and V10 are new chapters with no 4.x equivalent |
| Back-channel logout | **Implemented on Spring Security 7.1.0.** See [spring-security-oidc.md](spring-security-oidc.md). The default `OidcSessionRegistry` is in-memory, so a clustered deployment needs a shared one |
| `acr`, `amr`, `auth_time` | OIDC Core claims. SAML equivalents are `AuthnContextClassRef` and `AuthnInstant`. **Whether a provider populates them usefully is provider-specific and unverified here** |

## Gotchas

- Agent reuses the pre-authentication session after login to preserve the intended destination, keeping
  a session identifier across a privilege change
- Agent disables session fixation protection to fix an unrelated symptom and never restores it
- Agent implements logout as local session invalidation only, leaving the identity provider session and
  the issued tokens alive
- Agent presents single logout as a guarantee. It is unreliable across providers and across service
  providers sharing one session
- Agent treats "we removed their access" as done when the session ended, while a valid access token is
  still in flight
- Agent treats "the customer has MFA enabled" as an enforced control without checking `acr`, `amr` or
  `AuthnContextClassRef` in the assertion
- Agent builds step-up authentication by setting a flag in its own session rather than asking the
  provider again and verifying the response
- Agent treats an unexpired session as evidence of recent authentication. Validity and recentness are
  different questions, answered by `auth_time` or `AuthnInstant`
- Agent designs `amr`-based rules from documentation rather than from a real token, and finds the claim
  absent or differently populated in production
- Agent enforces authentication strength on the SSO pathway and leaves a legacy password login, API
  token or impersonation feature exempt
- Agent ships no administrator ability to terminate sessions, then builds one during an incident
- Agent chooses stateless tokens and discovers afterwards that session listing and revocation are now
  impossible
- Agent documents one session timeout. Idle and absolute maximum are two numbers
- Agent does not distinguish the identity provider session from the application session, so logout ends
  one and the user is puzzled that they are still signed in
- Agent relies on front-channel logout propagation, which fails when the user closes the tab or when
  third-party frame and cookie restrictions block the requests
- Agent keys accounts on the email address, so a reissued address hands the new holder the previous
  person's account. Key on the stable subject identifier
- Agent frees deprovisioned identifiers for reuse
- Agent hard-deletes the identity on offboarding and destroys the audit trail the compliance review then
  asks for
- Agent implements provisioning and defers deprovisioning, which is the half a customer audits
- Agent deprovisions a user globally when the same human legitimately remains active in another tenant
- Agent leaves a local password alongside SSO after deprovisioning, which is a working back door
- Agent relaxes frame options globally to allow embedding and leaves the login and consent routes
  unprotected
- Agent reflects the request `Origin` with credentials enabled, because it made local development work
- Agent exposes a token-returning endpoint to CORS instead of moving to a backend-for-frontend
- Agent reads the tenant from a request parameter after authentication rather than binding it to the
  session at authentication time
- Agent verifies an assertion or token against every configured tenant key, making cross-customer
  authentication possible
- Agent treats home-realm discovery as part of authentication and lets unauthenticated input select a
  signing key
- Agent leaves password login open for an organisation that has enforced SSO, including the reset path
- Agent ships no break-glass path, so a customer certificate expiry locks out the administrator who
  would fix it
- Agent uses one tenant identifier for authentication and a different one for data isolation

## Related

- [security-hardening.md](security-hardening.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [security-saml.md](security-saml.md) · [checklist.md](checklist.md)
