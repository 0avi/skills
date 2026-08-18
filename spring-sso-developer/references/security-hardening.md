# SSO Security Hardening: Index

The attack catalogue is split by protocol so that a review of one does not require loading the other.
This page carries what applies to all of them: the two Spring defaults that matter most, the order to
work in, and the policy on CVEs.

| Reviewing | Read |
| --------- | ---- |
| OAuth 2.0 or OIDC: PKCE, `state`, `nonce`, redirect URIs, JWT validation, mix-up, token storage, refresh rotation, scope | [security-oauth2-oidc.md](security-oauth2-oidc.md) |
| SAML 2.0: signature wrapping, XXE, unsigned assertions, the validation checklist, IdP-initiated flows, certificates | [security-saml.md](security-saml.md) |
| Sessions, logout, CORS, clickjacking, and multi-tenant isolation | [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) |

## The two defaults that catch people

Both are cases where a correct-looking Spring configuration is quietly insecure, and neither produces
a warning. Everything else in the catalogue is more widely known than these two.

**1. Whether PKCE protects your confidential client depends on which Spring Security you are on**, and
the default flipped between the two versions this skill covers. Verified from
`ClientRegistration.java` at both tags:

| Spring Security | `ClientSettings.Builder.requireProofKey` | Result for a confidential `authorization_code` client |
| --------------- | ---------------------------------------- | ----------------------------------------------------- |
| **7.1.0**, Boot 4.1.0 | `private boolean requireProofKey = true;` | **PKCE is on by default.** Nothing to do |
| **6.5.11**, Boot 3.5.16 | `private boolean requireProofKey;`, so `false` | **PKCE is off by default.** You must enable it |

So on Boot 4.x the good news is that Spring already meets RFC 9700's recommendation for confidential
clients. On Boot 3.5.x it does not, and enabling it is a deliberate act. **Establish the version before
reporting this as a finding either way**, and see
[security-oauth2-oidc.md](security-oauth2-oidc.md) for the two remaining traps: a provider that cannot
accept PKCE from a confidential client, and the fact that the two versions disagree about what happens
when the grant type is not `authorization_code`.

**2. SAML assertion validation is minimal, and Spring says so.** Quoted from the reference
documentation:

> "`OpenSaml5AuthenticationProvider` performs minimal validation on SAML 2.0 Assertions. After
> verifying the signature, it will: 1. Validate `<AudienceRestriction>` and `<DelegationRestriction>`
> conditions 2. Validate `<SubjectConfirmation>`s, expect for any IP address information"

At the response level it validates `Issuer` and `Destination`. Everything else on OWASP's checklist is
yours to add.

A third, narrower but equally quiet: **replacing a JWT validator with `setJwtValidator` drops issuer
and expiry validation**, because the default chain is replaced rather than extended. See
[security-oauth2-oidc.md](security-oauth2-oidc.md).

## How to review, in order

Work outward from the token, not inward from the framework:

1. **What does the application trust, and what proves it?** Every trust decision needs a signature or
   a channel binding behind it. Write down which one, for each.
2. **What is validated by default, and what did I have to add?** Defaults are the whole game. Both
   protocols validate less than most people assume.
3. **What happens if the attacker controls this field?** Run that question over `redirect_uri`,
   `state`, `RelayState`, `iss`, `aud`, and every tenant identifier.
4. **What is the blast radius when this fails?** In single-tenant terms a validation gap is an account
   compromise. In multi-tenant SaaS the same gap is a cross-customer breach, which changes its
   priority. See [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

## On CVEs

**Exactly one CVE is cited in this skill**, and only because it was read from the vendor's own advisory
page: **CVE-2026-40988**, an unbounded DEFLATE inflation denial of service in
`spring-security-saml2-service-provider`, fixed in 7.0.6 and 6.5.11. It is written up with its affected
ranges in [security-saml.md](security-saml.md).

Nothing else is cited. A CVE may be cited only when verified against NVD or the vendor's advisory, and
citing one from memory is precisely the failure the rule exists to prevent, so where verification did
not happen the page carries nothing rather than something that might be wrong.

**The CVE that matters to you is the one in your resolved dependency tree**, which no document can
know. A cited list dates within months; a scanner does not. Check resolved versions against the vendor
advisory feeds for Spring Security, your XML security library and your identity provider, and wire it
into automated dependency scanning so it keeps happening without anyone remembering to.

One practical note from the advisory above: **several of its fixed versions are available only with
commercial support.** An application on an older maintenance line may have no open-source patch at all,
which turns "we are on a supported version" into a question worth actually checking rather than
assuming.

## Version notes

**Spring identifiers and defaults across these pages were read from the Spring Security 7.1.0
reference documentation on 12/08/2026.** Specifications cited: RFC 9700 (BCP 240, January 2025),
RFC 6749, RFC 7636, RFC 9207, RFC 8705, RFC 9449, RFC 9336, and the OWASP SAML Security and OAuth2
cheat sheets.

| Concern | Detail |
| ------- | ------ |
| Boot to Spring Security mapping | Verified from Boot's own `spring-boot-dependencies` build files: **Boot 4.1.0 manages Spring Security 7.1.0**, Boot 4.0.0 manages 7.0.0, Boot 4.0.7 manages 7.0.6, and **Boot 3.5.16 manages Spring Security 6.5.11**. So the 3.5.x line is on 6.5.x, not 7.x |
| Java floor | Spring Security 7.1.0 "requires a Java 17 or higher Runtime Environment" |
| `OpenSaml5AuthenticationProvider` | The current class name. Older material names `OpenSaml4AuthenticationProvider` or `OpenSamlAuthenticationProvider` |
| Deprecated patterns in older books | `WebSecurityConfigurerAdapter` and `authorizeRequests()` were **removed** in Spring Security 6. Any example using them predates every supported version |
| OWASP ASVS | Cross-checked against **ASVS 5.0.0**, 30 May 2025, chapters **V6 Authentication**, **V7 Session Management**, **V9 Self-contained Tokens** and **V10 OAuth and OIDC**. 5.0 renumbered V2 and V3 to V6 and V7, so guidance citing V2 and V3 is against ASVS 4.x. V9 and V10 are new in 5.0, and V10's seven sections split requirements by role: client, resource server, authorization server, OIDC relying party, OpenID provider and consent |
| CVE policy | One CVE cited, **CVE-2026-40988**, from the vendor advisory. Nothing else, by design |

## Gotchas

- Agent reviews the framework's features and never establishes what is validated **by default**, which
  is where both protocols actually fail
- Agent states whether PKCE is on for a confidential client without naming a version. It is on by default
  on Spring Security 7.1.0 and off on 6.5.11, and off again on a Spring Authorization Server registered
  client
- Agent reads Spring's SAML support as complete validation. Its own documentation calls it "minimal"
- Agent treats a validation gap as a single-account problem in a multi-tenant product, where it is a
  cross-customer one
- Agent cites a CVE from memory. Verify against NVD or the vendor advisory, or omit it
- Agent copies a configuration example from a book published before Spring Security 6 and cannot
  compile it, because the base class it extends no longer exists

## Related

- [security-oauth2-oidc.md](security-oauth2-oidc.md) · [security-saml.md](security-saml.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [spring-security-oidc.md](spring-security-oidc.md) · [spring-security-saml.md](spring-security-saml.md) · [checklist.md](checklist.md)
