# The Frontend Half

**Written 14/08/2026.** Spring identifiers are Spring Security 7.1.0.

**This file is framework-independent and complete on its own.** Almost all frontend SSO advice is the same
whether you are in Angular, React, Vue, Solid or anything else, because the constraints come from the
browser, the redirect and the protocol rather than from the framework. The six problems every framework
must solve are stated below as problems and rules, without naming any framework's API.

**Per-framework notes appear only where something is genuinely different**, and the short sections at the
end are that, not a substitute for reading your framework's own documentation. A framework earns a
dedicated file in this skill only if its server-rendering story needs more than the rules here; otherwise
adding one would be four copies of this page with the nouns changed.

**This file owns what is specific to an SSO redirect flow.** Token lifecycle in general - where a token
lives, the refresh stampede, a 401 mid-request, route guards as a UX affordance - is owned by our
`angular-spring-contract` skill's `auth-flow.md`, and is not restated here. What is different about SSO is
that **there is no password form, the browser leaves your application entirely, and it may come back
without ever having been in your application first**.

## The decision that removes most of the problems

**Use a backend-for-frontend.** The browser holds a session cookie; the server holds the tokens.

| | Tokens in the browser | Backend-for-frontend |
| --- | --------------------- | -------------------- |
| Where the access token lives | JavaScript-reachable, or a cookie you then have to protect | Server side only |
| Blast radius of one XSS | Account takeover, durable until token expiry | The session, revocable |
| Who refreshes | The SPA, with the stampede problem | The server |
| Who talks to the identity provider | The SPA | The server |
| Logout | Partly the SPA's problem | The server's |
| Extra infrastructure | None | A server you already have, if the backend is Spring |

**In a Spring shop the BFF is nearly free**, because `oauth2Login()` already produces exactly this shape:
the server completes the code exchange, holds the tokens in the `OAuth2AuthorizedClient`, and gives the
browser a session cookie. **You get the BFF by not doing anything clever.**

RFC 9700 recommends sender-constraining tokens and OWASP requires authorization code with PKCE for all
client types, but neither removes the fact that **a token in a browser is reachable by any script on the
origin**. The BFF removes the token from the browser instead of protecting it there. See
[security-oauth2-oidc.md](security-oauth2-oidc.md).

**If you cannot use a BFF**, because the frontend is served separately from any backend you control, then
the rules in `angular-spring-contract`'s `auth-flow.md` apply and the token goes in an `HttpOnly`,
`Secure`, `SameSite` cookie, never `localStorage`.

## The browser leaves, and your application state goes with it

**This is the structural difference from a password form.** A login form posts and returns. SSO navigates
the whole document away to the identity provider, possibly through a corporate proxy, an MFA prompt and a
consent screen, and comes back minutes later.

**Consequences for a single-page application:**

- **In-memory state is gone.** Anything the user had typed, any unsaved form, any client-side route
  position. It is a cold bootstrap on return.
- **Preserve the destination server-side, not client-side.** The user asked for `/reports/42`, got bounced
  to the identity provider, and must land back on `/reports/42`. Spring's saved-request mechanism does
  this, which is another argument for the server driving the flow. **Do not put the destination in the
  `state` parameter**: `state` is a CSRF token with a security job, and overloading it means you now
  validate a value you also parse.
- **Do not attempt SSO in an iframe or a popup as the default.** Identity providers commonly refuse
  framing, third-party cookie restrictions break silent flows, and the failure is intermittent rather
  than clean. A full-page redirect is the reliable shape.
- **Show something before the redirect.** A user who clicks "Sign in" and sees a blank frame for two
  seconds while the app bootstraps and then redirects will click again.

## Starting the flow

**Do not build the authorization URL in the frontend.** With `oauth2Login()` the server exposes a
per-registration initiation path, and the frontend's job is a plain navigation to it:

```html
<!-- correct: a real navigation, not a fetch -->
<a href="/oauth2/authorization/acme-okta">Sign in</a>
```

**Why not `fetch`:** the response is a 302 to another origin. An XHR or `fetch` either follows it opaquely
or is blocked by CORS, and in neither case does the browser end up at the identity provider. **The most
common frontend SSO bug is trying to start the flow with an AJAX call**, and the symptom is a CORS error
that looks like a server misconfiguration.

In Angular that means an anchor or `window.location.assign(...)`, not `HttpClient`. In React the same:
`window.location.assign(...)`, not `fetch` or axios.

## Do not render a list of identity providers

**Spring's generated login page lists every configured provider by client name**, which in a multi-tenant
product leaks the identity of your customers to anonymous visitors. See
[spring-security-oidc.md](spring-security-oidc.md).

**A hand-built frontend can make the same mistake**, and more visibly. If your sign-in screen shows
"Acme Corp", "Globex" and "Initech" as buttons, you have published your customer list.

**Use home-realm discovery instead:** ask for an email address, resolve the domain to a tenant on the
server, and redirect to that tenant's registration.

## Home-realm discovery is an unauthenticated endpoint

The screen that turns an email address into an identity provider runs **before anyone has proven
anything**, and it is easy to build as if it were part of authentication.

The rules, which are the frontend expression of what
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) requires:

- **Resolve on the server.** The browser sends an email or domain and receives a redirect. It must not
  receive a mapping table.
- **Do not confirm or deny that a domain is configured.** "We do not recognise that address" tells an
  attacker which of your customers use SSO, and some customers treat their own presence as confidential.
  Prefer a uniform response and a redirect that either works or lands on a generic failure.
- **Rate limit it.** It is an unauthenticated endpoint that performs a lookup, so it is enumerable.
- **Never let it select a signing key.** The input chooses which registration to redirect to; validation
  still happens against that registration's own configuration.

## Arriving already authenticated

**IdP-initiated flows land a user in your application with no prior client state.** They clicked your tile
in their identity provider's portal; they never visited your site first.

**The frontend must handle a cold, authenticated arrival:**

- **There is no saved destination**, so land on a sensible default rather than an error.
- **There is no in-flight request to resume.** Code that assumes a login was preceded by a rejected API
  call will break.
- **Tenant context comes from the session**, established server-side at authentication, never from a URL
  parameter the frontend read.

Whether you support IdP-initiated at all should be a decision. It is structurally weaker, and for SAML
Spring supports it by default whether you intended to or not. See [security-saml.md](security-saml.md).

## Logout is a navigation, not a request

**A `fetch('/logout')` is not enough**, and this is the second most common frontend SSO bug.

Three things must happen, and only the first is local:

1. **End the local session.** A POST to the server's logout endpoint.
2. **End the identity provider session**, which requires the browser to visit the provider's
   `end_session_endpoint`. **That is a full-page navigation**, so the server responds with a redirect and
   the browser must follow it. An AJAX logout completes step 1, reports success, and leaves the user
   silently signed in at the provider, so the next "Sign in" click logs them straight back in with no
   prompt. **To the user this reads as logout being broken.**
3. **Discard client state.** Clear in-memory stores and any cached data. In Angular, that means resetting
   whatever holds user state; in React, the same. Do not rely on the redirect to do it, because a failed
   redirect leaves a populated store.

**Step 2 assumes the server will actually redirect, and it may not.** On the Spring side
`OidcClientInitiatedLogoutSuccessHandler` falls back to the ordinary logout success URL, with no exception
and no log entry, whenever `end_session_endpoint` is missing from the provider metadata, which is the case
whenever the registration was configured without `issuer-uri`. **The frontend symptom is identical to
success**: the POST returns a redirect, the browser follows it, the user lands on your logged-out page. The
provider session is untouched. So a frontend test asserting "logout returned 302" passes against a broken
logout. **Test the behaviour instead**: log out, click sign in again, and assert the provider prompts for
credentials. If it does not, the fault is server-side and is in
[spring-security-oidc.md](spring-security-oidc.md), not in your navigation code.

**And logout the user did not initiate needs the back channel.** If a user signs out at the identity
provider, or an administrator ends their session, nothing above runs, because there is no navigation
through your application at all. Spring Security 7.1.0 implements OIDC back-channel logout for this: the
provider calls `/logout/connect/back-channel/{registrationId}` server to server and the session is
invalidated without the browser's involvement. For the SPA plus BFF shape this file recommends, that is
the mechanism that makes "signed out everywhere" true. The configuration, and the in-memory session
registry that quietly limits it to one instance, are in
[spring-security-oidc.md](spring-security-oidc.md). **The frontend consequence is worth designing for:**
the session can end between two clicks with no redirect to observe, so treat a 401 on any request as a
possible logout rather than an error state, and do not cache authentication status indefinitely.

**So: logout is a form POST or a navigation, never `fetch`.** And test it as a behaviour, per
[spring-security-oidc.md](spring-security-oidc.md): log out, click sign in again, and assert the provider
prompts for credentials.

## The six problems every framework must solve

**This section is the framework-independent core of the core.** Each item is a problem with a rule, stated
without naming any framework's API, because the rule is the same in all of them and only the primitive
differs. If you are working in Angular, React, Vue, Solid or anything else, these are the six things to
implement, and the framework's own documentation tells you with what.

### 1. Cold-start authentication detection

**The problem.** After the redirect returns, the application boots from nothing and must answer "am I
signed in?" before it renders anything that depends on the answer.

**The rule.** **Ask the server, once, and treat the answer as the source of truth.** With a BFF that is a
single call to an endpoint returning the current user or 401. Do not infer it from the presence of a
cookie, because an `HttpOnly` cookie is invisible to script and a visible one proves nothing. Do not cache
the answer across a page load.

**The trap.** Rendering the authenticated shell optimistically and then discovering a 401 produces a flash
of the wrong UI, and worse, code paths that assumed a user object.

### 2. Route protection

**The problem.** Some routes should not render for an unauthenticated user.

**The rule.** **Guards are a user-experience affordance, not access control.** The server rejects the
request regardless. A guard exists so the user sees a sign-in prompt instead of a broken screen, and every
framework has a primitive for it. **Never let a guard be the only thing preventing access to data.**

### 3. Sending credentials with API calls

**The problem.** With a BFF the session is a cookie, and cookies are not sent on cross-origin requests
unless both the request and the server opt in.

**The rule.** **Serve the frontend from the same origin as the BFF and the problem disappears.** If you
cannot, the request must be configured to include credentials and the server must allow that specific
origin. **Never reflect the request's origin with credentials enabled**, which is the CORS mistake in
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

### 4. Handling a 401 mid-session

**The problem.** The session expires while the application is open, and the next API call fails.

**The rule.** **One place handles it**, whatever your framework calls that layer, and it redirects to the
server's login initiation path as a **navigation**. Do not attempt a silent re-authentication in the
background: with a redirect-based flow that means an iframe or popup, both of which fail intermittently
under current cookie policies.

Token-level concerns behind this, the refresh stampede and concurrent 401s, are owned by our
`angular-spring-contract` skill's `auth-flow.md`.

### 5. Discarding state on logout

**The problem.** Client-side stores hold the previous user's data, and a redirect that fails leaves it on
screen.

**The rule.** **Clear client state before initiating the logout navigation, not after**, because after may
never run. Whatever holds user state, reset it, then navigate. On a shared device the residue is the whole
risk.

### 6. Server-side rendering and the meta-framework

**The problem, and it is the largest.** With SSR the first render happens on a server, so the session
cookie must be read there, and the login redirect may need to be issued from there. Every meta-framework
does this differently.

**The rules that hold across all of them:**

- **Establish where the session is read on the first render**, and confirm it is the server and not a
  client-side effect that runs after the shell has already been sent.
- **Never let user-specific rendered output be cached** by the framework, a CDN or a reverse proxy. This
  is the SSR failure with the worst consequence: one user's page served to another.
- **Do not put tokens into the serialised state** sent to the browser. A BFF keeps them server-side, and
  hydration payloads are plain text in the document.
- **The redirect belongs to the server** in an SSR app, which is convenient, because it is the correct
  shape anyway.

**Whether a per-framework file is warranted comes down to this section.** If a framework's SSR story needs
more than the four rules above, it earns a file. If it does not, it does not.

## Angular notes

- **The app bootstraps twice per login**, once before the redirect and once after. Anything expensive in
  bootstrap happens twice, and anything that assumes single initialisation may misbehave.
- **Guards are UX, not security.** A route guard prevents a confusing screen; the server prevents access.
  Our `angular-spring-contract` skill's `auth-flow.md` makes this point and it holds identically here.
- **With a BFF, requests need credentials.** Session cookies are only sent if the request is configured to
  include them and the server's CORS policy allows it, which is a reason to serve the frontend from the
  same origin as the BFF and avoid CORS entirely. See
  [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) on why reflecting origins with
  credentials is the mistake to avoid.
- **Framework mechanics belong to the official Angular skill.** Interceptors, guards and bootstrap are its
  material, not ours.

## React notes

- **Be wary of drop-in auth libraries.** Several store tokens in `localStorage` by default, which is the
  one thing not to do. If you are using a BFF you may not need an auth library at all: the session is a
  cookie and the app just calls its own API.
- **Do not implement the code exchange in the browser** when a BFF is available. A public-client PKCE flow
  in React is correct only when there is genuinely no backend you control.
- **Strict-mode double effects are a real hazard here.** An effect that consumes a one-time authorization
  code and runs twice will exchange the code once successfully and once with a used code, producing a
  spurious error. **This is another reason the exchange belongs on the server.**

## Not verified in this pass

- **Exact Angular and React APIs are deliberately not asserted here.** Nothing in this file names a
  framework method signature, because framework mechanics belong to the official Angular skill and to the
  React ecosystem, and both move faster than this file will.
- Which identity providers will call a back-channel logout endpoint, and how each is configured to do so.
  Spring's side is verified and written up in [spring-security-oidc.md](spring-security-oidc.md); the
  provider's side belongs in that provider's file and was not established per vendor in this pass.
- Any specific BFF library or gateway. The pattern is described; product choices are not.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Spring side | Spring Security 7.1.0. `oauth2Login()` produces the BFF shape by default. Initiation path is per registration; see [spring-security-oidc.md](spring-security-oidc.md) for the exact defaults |
| Token lifecycle | Owned by our `angular-spring-contract` skill's `auth-flow.md`. Not restated |
| Framework mechanics | Owned by the official `angular-developer` skill. No Angular or React API is asserted here |
| Third-party cookies | Browser restrictions continue to tighten, which progressively breaks iframe and silent-renewal patterns. Prefer the redirect and the BFF, which do not depend on them |
| Back-channel logout | Implemented on Spring Security 7.1.0, and the right mechanism for propagating a logout the user performed elsewhere. Needs a shared `OidcSessionRegistry` to work behind a load balancer |

## Gotchas

- Agent starts the SSO flow with `fetch` or `HttpClient`, gets a CORS error, and debugs the server. It
  must be a real navigation
- Agent logs out with `fetch`, ends the local session only, and the next sign-in is silent. The user
  reports logout as broken
- Agent builds the authorization URL in the frontend instead of navigating to the server's initiation path
- Agent renders a list of configured identity providers, publishing the customer list
- Agent returns a domain-to-tenant mapping to the browser, or confirms which domains are configured
- Agent puts the post-login destination in the `state` parameter, overloading a CSRF token
- Agent assumes the user was in the application before authenticating. IdP-initiated arrivals were not
- Agent reads tenant context from a URL parameter after login instead of from the session
- Agent stores a token in `localStorage`, or adopts a library that does it by default
- Agent implements the code exchange in the browser when a BFF was available
- Agent puts the code exchange in a React effect and hits the double-invocation problem with a one-time
  code
- Agent relies on an iframe or popup for the primary flow, and it fails intermittently as cookie policies
  change
- Agent treats a route guard as an access control
- Agent leaves client-side stores populated after logout, so a failed redirect leaves user data on screen
- Agent infers authentication state from the presence of a cookie rather than asking the server
- Agent renders the authenticated shell optimistically and then meets a 401
- Agent attempts silent re-authentication in an iframe or popup after a mid-session 401
- Agent clears client state after initiating the logout navigation, so it never runs
- Agent lets a server-rendered, user-specific page be cached by the framework, a CDN or a proxy
- Agent puts a token into the SSR serialised state, which is plain text in the document
- Agent writes a per-framework file that is this page with the nouns changed

## Related

- [spring-security-oidc.md](spring-security-oidc.md) · [security-oauth2-oidc.md](security-oauth2-oidc.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [security-saml.md](security-saml.md) · [providers.md](providers.md) · [checklist.md](checklist.md)
