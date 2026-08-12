# Auth End to End

`spring-boot-developer` owns `jwt-authentication.md` and `oauth2-resource-server.md`: how the
server issues, validates and authorises. The official `angular-developer` skill owns
`HttpClient`, interceptors and route guards as mechanisms. **This page owns the four decisions
that belong to neither**: where the token lives, what happens when it expires mid-flight, what a
guard is actually for, and what all of that does to an e2e suite.

This is the highest-severity area in the skill, because every failure mode here is silent. Nothing
throws. The user is simply logged out, or worse, appears logged in and every request fails.

## Where the token lives

There is no answer that is right everywhere. There is a decision, and it has consequences the two
sides have to agree on.

| Storage | Survives reload | Readable by JS | Sent automatically | SSR can read it |
| ------- | --------------- | -------------- | ------------------ | --------------- |
| In memory only | No | Yes | No | No |
| `localStorage` / `sessionStorage` | Yes | **Yes** | No | **No** |
| `httpOnly` cookie | Yes | No | Yes | **Yes** |

The two columns that make this a seam decision rather than a frontend one:

- **JS-readable storage means any script on the page can take the token.** That is the standard
  objection to `localStorage`, and it is not answered by "we do not have XSS"; it is answered by
  deciding how much a stolen token is worth, which depends on its lifetime and scope - server-side
  properties.
- **SSR cannot read `localStorage`.** The server rendering the page has no access to it, so the
  first render is unauthenticated and the client flips it after hydration. That is a visible flash
  for real users and a race in tests. An `httpOnly` cookie is sent with the document request, so
  SSR can render the authenticated view - but then the SSR server must forward that cookie on its
  own API calls, and the API must accept it. **That pairing is the decision**, and neither
  companion skill can make it for you.

If the application is server-rendered, the cookie path is usually the coherent one. If it is a
pure SPA, the short-lived-token-in-memory path with a refresh cookie is usually the coherent one.
Mixed answers, such as an access token in `localStorage` and a refresh token in a cookie, are
common and workable, but write down why, because the next person will assume it was an accident.

## The refresh stampede is real, and measured

Six components mount at once, each fires a request, the access token has just expired, so all six
get a 401. With the standard interceptor shape, where the `catchError` branch calls `refresh()`
itself, **each 401 starts its own refresh**. Modelled with RxJS 7.8.2, five parallel 401s:

```
naive, 5 parallel 401s                            refresh called 5x
single-flight, 5 parallel 401s                    refresh called 1x
single-flight, a second wave after it settled     refresh called 2x total
```

Five refreshes against a server that **rotates refresh tokens** means the first succeeds and the
other four present a token that has just been invalidated. The user is logged out by their own
application, on a page that was working, and the log shows four legitimate-looking rejections.
Whether this happens at all is a server decision - rotation, reuse detection, grace windows - which
is exactly why it belongs here and not in either companion.

The fix is one shared in-flight refresh, and it has a trap. Sharing with `shareReplay` and **not**
resetting when it settles caches the observable for the application's lifetime:

```
never reset: second expiry returns "fresh" (cached), refresh called 1x
```

The second expiry gets the *old* token from the replay buffer and never asks the server again. So
the application presents a stale token forever, and every request 401s with no refresh attempt.
Reset the shared observable when it completes or errors, and verify the reset by driving two waves,
as the measured run above does. One wave passing proves nothing about the second.

## 401 mid-request

- **Only replay what is safe to replay.** A GET is fine. A POST that already reached the server and
  failed authorisation after a side effect is not. If retrying writes, the endpoint needs an
  idempotency key, which is a server-side contract, not a client convenience.
- **Queue, do not drop.** Requests that 401 during an in-flight refresh should wait for it and then
  retry once, not fail. One retry, then surface the error: a refresh that itself 401s must not
  trigger another refresh.
- **Distinguish 401 from 403.** A 401 means "no valid credentials, refreshing may help". A 403
  means "authenticated and not allowed", and refreshing will never help. Retrying a 403 produces an
  infinite loop that looks like a hung page.
- **Status 0 is not a 401.** In the browser it means the request never completed: offline, CORS, or
  cancelled. Treat it as a network failure. See [problem-detail.md](problem-detail.md).
- **Do not attach the token to the refresh call itself**, or an expired access token makes the
  refresh unauthorised too.

## Route guards are a UX affordance

A guard stops a user navigating to a page that would render broken. It is client-side code and
anyone can skip it. **Every guard must have a server-side counterpart, and the server's is the one
that matters.** If a guard is the only thing preventing access, the endpoint is unprotected.

The corollary that gets missed: a guard that checks only "is there a token in storage" passes with
an expired token, so the route activates and then every request on it 401s. Check expiry, or accept
that the guard is about navigation rather than about validity.

## Under test

Playwright's `storageState` is the standard way to log in once and reuse it. Its shape, from the
shipped types in `@playwright/test` 1.62.1:

```ts
{
  cookies: Array<{ name; value; domain; path; expires: number;
                   httpOnly: boolean; secure; sameSite }>;
  origins: Array<{ origin; localStorage: Array<{ name; value }> }>;
}
```

Two things follow directly from that shape:

- **Cookies carry `expires`; `localStorage` entries carry only `name` and `value`.** There is no
  expiry field for `localStorage`, so a JWT saved there is restored verbatim no matter how stale it
  is. The suite starts every test with a token that may already be dead.
- **`httpOnly` cookies are captured**, so a refresh token in a cookie does survive into the saved
  state. That makes the cookie path easier to test as well as easier to render.

So a suite that authenticates once and runs for longer than the access token's lifetime will, part
way through, start every test with an expired token. What happens next is decided entirely by the
refresh contract above, not by the test. The failure looks like flake: a test that passes alone
fails when it runs eighth, and it moves as the suite's timing changes.

Practical positions, in order of preference: make the access token lifetime longer than the suite;
re-authenticate per worker rather than once globally; or assert the refresh path deliberately in one
test and keep it out of the others.

**Not verified here.** The `storageState` shape above is read from the shipped type definitions.
The mid-suite expiry behaviour is reasoned from it plus the measured refresh results, not observed
against a running suite - proving it needs a real login flow and a real token lifetime. Treat the
mechanism as established and the timing as something to confirm in your own suite.

## Version notes

**Mostly version-agnostic, and the parts that are not belong to the companions.** The refresh
stampede and its fix are RxJS behaviour, measured on 7.8.2, and unchanged across the RxJS 7 line.
The `storageState` shape is from Playwright 1.62.1.

| Concern | Where it is decided |
| ------- | ------------------- |
| Interceptor registration, and functional versus class interceptors | Angular version. The official `angular-developer` skill owns this |
| Whether refresh tokens rotate, and whether reuse is detected | Server policy. `spring-boot-developer` owns the mechanism |
| Whether SSR is in play at all | Angular's rendering strategy, which decides the storage question above |
| CSRF requirements once you choose cookies | Spring Security configuration, which changes across Boot majors |

## Gotchas

- Agent calls `refresh()` inside the `catchError` branch per request - that is the stampede.
  Measured: five parallel 401s, five refreshes
- Agent shares the refresh with `shareReplay` and never resets it - the second expiry replays the
  old token and no refresh is ever attempted again
- Agent tests the single-flight fix with one wave of requests - one wave cannot detect the missing
  reset. Drive two
- Agent retries a 403 - refreshing cannot help, and the retry loop presents as a hung page
- Agent treats status 0 as an auth failure and logs the user out when they briefly go offline
- Agent attaches the access token to the refresh request
- Agent replays a POST after refreshing, with no idempotency key
- Agent lets a failed refresh trigger another refresh
- Agent relies on a route guard for protection - it is navigation only, and the server is the
  authority
- Agent writes a guard that checks for a token's presence but not its expiry, so the route
  activates and every request on it 401s
- Agent puts the access token in `localStorage` in a server-rendered app - SSR cannot read it, so
  the first render is always logged out
- Agent saves one `storageState` for a whole suite with a short-lived token - tests then fail by
  position rather than by cause
- Agent decodes the JWT client-side and trusts a claim in it for an authorisation decision -
  decoding is not verifying, and the client has no key

## Related

- [problem-detail.md](problem-detail.md) · [openapi-contract.md](openapi-contract.md)
