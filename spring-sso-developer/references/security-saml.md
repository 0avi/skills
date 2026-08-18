# SAML 2.0 Attack Classes

Assume nothing is validated until you have read what your provider validates. Spring Security states its
own position plainly, and it is worth quoting rather than paraphrasing:

> "`OpenSaml5AuthenticationProvider` performs minimal validation on SAML 2.0 Assertions. After verifying
> the signature, it will: 1. Validate `<AudienceRestriction>` and `<DelegationRestriction>` conditions
> 2. Validate `<SubjectConfirmation>`s, expect for any IP address information"

At the response level it validates `Issuer` and `Destination`. **Everything else on OWASP's checklist is
yours to add or confirm.** That single sentence is why this page exists.

## XML Signature Wrapping

**Vulnerable pattern.** The attacker keeps a legitimately signed assertion in the document but relocates
it, then inserts an unsigned assertion that the application actually reads. Signature verification
passes, because the signed element is still present and still intact. The application trusts a different
element from the one that was verified.

This is the attack from *On Breaking SAML: Be Whoever You Want to Be*, which the OWASP sheet cites, and
it is the reason "the signature verified" is not the same statement as "this assertion is authentic".

**The mitigation is to check that the signature covers the element you are about to trust.** OWASP:
"Verify the `<ds:Reference URI>` in the XML signature covers the `<saml:Assertion>` element being
trusted."

Supporting requirements from the same sheet:

- "Without exception, always perform schema validation on the XML document prior to using it for any
  security-related purposes"
- Use **absolute XPath expressions** to select elements rather than `getElementsByTagName`, which
  returns whichever matching element it finds first and is exactly what wrapping exploits.
- Use a `StaticKeySelector` or `X509KeySelector`, and **"ignore any `KeyInfo` elements in the
  document"**.

That last clause carries more weight than its length suggests: trusting in-document `KeyInfo` lets the
attacker supply both the assertion and the key that verifies it.

## XML External Entity injection

**Vulnerable pattern.** The assertion parser resolves external entities, or fetches a DTD or schema from
a URL contained in the document. Outcomes range from local file disclosure through SSRF to parser denial
of service.

OWASP requires strict schema validation against **local, trusted copies** of the schemas, and is
explicit: **"Never allow automatic download of schemas from third party locations."**

Confirm this against the parser your stack actually resolves, rather than assuming the library default
is safe. The library doing the parsing is the one that must be hardened, and in a Spring SAML
application that is the XML security stack pulled in transitively rather than code you wrote.

## Signature exclusion and unsigned assertions

**Vulnerable pattern.** The response carries no signature, or only the response is signed while the
assertion is not, and the implementation accepts it.

Spring's documented behaviour is that validation happens "after verifying the signature", but the
reference page **does not explicitly state that unsigned assertions are rejected**. Do not assume it.
Confirm the behaviour for your configuration, and require **assertion-level** signing from the identity
provider rather than relying on response-level signing alone. Signing the response but not the assertion
leaves the assertion detachable.

**Algorithm strength is part of the same check.** OWASP: "Explicitly verify the signature algorithm is
at least RSA-SHA-256 (or stronger)", and reject SHA-1 digests including
`<ds:DigestMethod Algorithm="...sha1">`, citing NIST SP 800-131A Rev. 2, which disallows SHA-1 for
digital signatures.

## The validation checklist Spring does not fully cover

Every row has a defined attack behind it, and OWASP requires all of them:

| Element | Requirement | What it stops |
| ------- | ----------- | ------------- |
| `InResponseTo` | Must match the `AuthnRequest` `ID` you issued | Binds the response to a login you started. Absent, any assertion can be injected |
| `Destination` on `<samlp:Response>` | Must exactly match your assertion consumer service URL | An assertion issued for another service provider being replayed at yours |
| `Recipient` in `<saml:SubjectConfirmationData>` | Must be your endpoint | The same class of cross-service replay |
| `<saml:Audience>` | Must match your entity ID | Spring does validate `<AudienceRestriction>` |
| `NotBefore` and `NotOnOrAfter` | Enforced in the assertion **and** in `SubjectConfirmationData` | The replay window |
| Assertion `ID` | Unique, and tracked as seen-once | Replay of a captured assertion |

**On `InResponseTo` specifically:** response-level validation exists but is **removable** by replacing
the `ResponseValidator`, and assertion-level checking comes from OpenSAML's
`BearerSubjectConfirmationValidator`, reachable through `setAssertionValidator`. If someone has
customised validation on this codebase, this is the first thing to re-check.

**On clock skew:** the assertion validator is configurable:

```java
OpenSaml5AuthenticationProvider provider = new OpenSaml5AuthenticationProvider();
provider.setAssertionValidator(AssertionValidator.builder()
        .clockSkew(Duration.ofMinutes(10))
        .build());
```

**The default is five minutes.** The reference page does not state it, which is why the ten minutes above
is easy to mistake for it, but the source does. `AssertionValidator.Builder` at the 7.1.0 tag:

```java
this.validationParameters.put(SAML2AssertionValidationParameters.CLOCK_SKEW, Duration.ofMinutes(5));
```

So the snippet above **doubles** the tolerance rather than setting it for the first time. Five minutes
each way is a ten-minute window in which a captured assertion stays valid, which is why replay detection
below is not optional: skew tolerance and replay protection are the same control seen from two sides.

**On replay:** OWASP recommends short response lifetimes, `OneTimeUse` on the response, and "proper
replay detection either at the response or assertion level". Replay detection requires server-side state
keyed on assertion ID, which means a **shared** store in a multi-instance deployment. A local in-memory
cache gives no protection behind a load balancer, which is the usual production shape.

## IdP-initiated flows and `RelayState`

**OWASP states the structural problem directly:** an unsolicited response "is inherently less secure by
design due to the lack of login CSRF protection". There is no `AuthnRequest`, so there is no
`InResponseTo` to bind against, and the protection simply does not exist to be configured.

**Spring supports it by default, whether or not you intended to.** The token converter matches on an
associated `AuthnRequest` or a `registrationId` in the URL, and failing both it falls back to looking up
the registration by the `<saml2:Response>` `Issuer` element. So an unsolicited response from a
configured identity provider is processed.

- If you do not need IdP-initiated login, **decide that deliberately** and confirm it is not reachable.
  Defaults you did not choose are still your defaults.
- If you do need it, OWASP requires replay detection, and if `RelayState` carries a URL, "make sure the
  URL is validated and explicitly on an allowlist". Otherwise `RelayState` is an open redirect on your
  login endpoint, reachable without authentication.

## Certificates, keys, and multi-IdP confusion

**Vulnerable pattern.** With several identity providers configured, any configured key can verify any
assertion, so identity provider A can mint assertions accepted as coming from B. In a multi-tenant
deployment that is one customer authenticating as another.

**Bind the key to the registration**, so an assertion claiming an issuer is verified only with that
issuer's key, never against the union of all configured keys.

OWASP's certificate requirements:

| Check | Requirement |
| ----- | ----------- |
| Key and algorithm | RSA 2048-bit minimum, or ECC 256-bit. "The most supported and currently secure combination is using RSA 2048 bit keys and SHA-256 hashing/signing." |
| Signing hash | SHA-256 minimum. No SHA-1 |
| Certificate lifetime | "The maximum lifetime of a SAML signing certificate should be two years" |
| Key usage | Should include `digitalSignature`; disallow other key usages |
| Extended key usage | RFC 9336 defines `id-kp-documentSigning`, OID `1.3.6.1.5.5.7.3.36`, as ideal |
| Revocation | "Validate IDP certificates for revocation against CRL/OCSP if they are present" |
| Key handling | Obtain the key directly from the identity provider and store it locally. Metadata URLs must be over TLS with a WebPKI CA certificate. Do not email certificates |
| Identity provider private keys | "IdP operators should strongly consider protecting the private keys using a Hardware Security Module (HSM)", FIPS 140-2 or 140-3 rated |

**Certificate expiry is the most common production SSO outage**, and it is not a security failure until
it is. Two-year certificates mean every customer integration has a scheduled breakage. Track expiry per
registration and alert well ahead of it, because the failure mode is every user at one customer losing
access simultaneously, with no code change to blame.

## Metadata trust, which is key distribution wearing a disguise

**Vulnerable pattern.** The application fetches the identity provider's metadata from a URL and installs
whatever signing certificate it contains, without verifying the metadata's own signature. Whoever
controls that URL, or the transport to it, now chooses the key your application trusts for assertions.
They can then mint assertions for any user.

This is not a theoretical chain. It is one configuration convenience away, and Spring documents the
default in a single sentence:

> "If no credentials are provided, the component will not perform signature validation."

That is `OpenSaml5AssertingPartyMetadataRepository`. The method named
`fromTrustedMetadataLocation(...)` does exactly what it says: **it trusts the location.** Trust is
delegated to your transport and to whoever operates that host, which is usually the customer.

**So treat metadata retrieval as key distribution, and apply key-distribution rules:**

- **Supply verification credentials** so the metadata signature is actually checked, using
  `withMetadataLocation(...).verificationCredentials(...)`.
- **Or prefer a locally stored certificate** obtained out of band. OWASP's guidance is to obtain the key
  directly from the identity provider and store it locally, which removes the fetch from the trust path
  entirely.
- **Require TLS to a WebPKI certificate** for any metadata URL. Spring's documentation does **not**
  state that HTTPS is required, so this is your requirement to impose rather than one you inherit.
- **Never accept a metadata URL from a customer without review.** In a self-service SSO setup flow, the
  metadata URL field is an attacker-controlled input that selects a signing key and causes a
  server-side fetch. It needs the same scrutiny as an issuer allowlist, for the same reason.

The configuration mechanics are in [spring-security-saml.md](spring-security-saml.md).

## Compressed payload inflation, with a real CVE

**Vulnerable pattern.** The HTTP-Redirect binding carries the SAML message DEFLATE-compressed in a query
parameter. If the implementation inflates it without bounding the output, a small request expands into a
large allocation, and an unauthenticated attacker exhausts memory by repeating it. A decompression bomb,
in an endpoint that by definition accepts traffic before anyone has authenticated.

**This is the one CVE cited in this skill**, because it is verified against the vendor's own advisory
rather than recalled:

**CVE-2026-40988**, HIGH, in `spring-security-saml2-service-provider`. Applications using the REDIRECT
binding face "denial of service by way of an unbounded writer that inflates the compressed SAML payload
into memory."

| | |
| --- | --- |
| Affected | 7.0.0 to 7.0.5, 6.5.0 to 6.5.10, 6.4.0 to 6.4.16, 6.3.0 to 6.3.16, 5.8.0 to 5.8.25, and 5.7.23 and earlier |
| Fixed, open source | **7.0.6** and **6.5.11** |
| Fixed, enterprise support only | 7.0.5.1, 6.5.10.2, 6.4.17, 6.3.17, 5.8.26, 5.7.24 |
| Additional mitigation | Disallow SAML Responses over GET with `OpenSaml5AuthenticationTokenConverter#setShouldConvertGetRequests(false)` |

**Two things follow for the versions this skill covers.** Spring Security 7.1.0 is past 7.0.6, so it is
fixed. Boot 3.5.16 manages 6.5.11, which is exactly the fix version, so **any 6.5.x below .11 is
affected** and a Boot 3.5.x project pinned to an older patch is exposed. Check the resolved version, not
the Boot line.

**And note where the fixes are.** Six of the eight fixed versions are enterprise support only, so an
application on 6.4.x or older has no open-source patch for this at all. Two of those six, **7.0.5.1** and
**6.5.10.2**, are the interesting ones: they exist precisely so that a project pinned to 7.0.5 or 6.5.10
can take the fix without moving a patch version, and both are behind the subscription. Without it the
only open-source route off this CVE is 7.0.6 or 6.5.11. That is a maintenance argument for staying
current, not merely a security note.

The generalisation, which outlives the CVE: **any endpoint that decompresses attacker-supplied input
before authentication needs an output bound.** Ask the question of your own code as well as your
framework's.

## Transport and caching

OWASP: "Exchange assertions only over secure transports like TLS." On the HTTP POST binding it warns
that "If a SAML protocol message gets cached, it can subsequently be used as a Stolen Assertion or
Replay attack", so responses must not be cacheable.

## Canonicalization

XML canonicalization edge cases that defeat signature validation are a real class, and the OWASP SAML
sheet **does not cover them**. Rather than reconstruct detail from memory, this page states only the
practical consequence: canonicalization bugs live in the XML security library, not in your code, so keep
that library patched and prefer the version your framework manages over a pinned older one. Anything
more specific needs a primary source that has not been consulted here.

## Version notes

**Spring identifiers read from the Spring Security 7.1.0 reference documentation on 12/08/2026.**
Sources: OWASP SAML Security Cheat Sheet, RFC 9336, NIST SP 800-131A Rev. 2, and OASIS SAML 2.0 Core,
Bindings and Profiles for protocol-level requirements.

| Concern | Detail |
| ------- | ------ |
| Provider class | **`OpenSaml5AuthenticationProvider`**. Material written against earlier versions names `OpenSaml4AuthenticationProvider` or `OpenSamlAuthenticationProvider`. Check what exists in your version before copying any example |
| Default validation scope | Response: `Issuer` and `Destination`. Assertion: `<AudienceRestriction>`, `<DelegationRestriction>`, `<SubjectConfirmation>` excluding IP address information |
| Assertion clock skew default | **5 minutes**, from `AssertionValidator.Builder` at the 7.1.0 tag. Not stated on the reference page, so the ten minutes in its `clockSkew` example is a doubling, not a first setting |
| Unsigned assertion rejection | **Not explicitly stated in the reference documentation.** Confirm for your configuration |
| Customisation surfaces | `setResponseValidator`, `setAssertionValidator`, `setResponseAuthenticationConverter` on the provider; `AssertionValidator.builder()`; `ResponseValidator.withDefaults(...)` |
| Spring Security SAML Extension | Superseded. The current support is built into Spring Security, and the reference documentation carries a migration page for the old extension |

## Gotchas

- Agent reads Spring's SAML support as complete validation. Its own documentation calls it "minimal"
- Agent verifies a signature and then reads a different assertion from the document, which is the whole
  of XML Signature Wrapping
- Agent selects elements with `getElementsByTagName`, which is the selection behaviour wrapping exploits
- Agent trusts in-document `KeyInfo`, so the attacker supplies both the assertion and its verifying key
- Agent allows schema or DTD fetching from the document, opening XXE and SSRF
- Agent accepts a signed response containing an unsigned assertion, which leaves the assertion
  detachable
- Agent assumes unsigned assertions are rejected. The documentation does not say so
- Agent takes the documentation's ten-minute `clockSkew` example for the default, and reports a tolerance
  it has actually just doubled. The default is five minutes
- Agent verifies assertions against every configured identity provider key rather than the one bound to
  that registration, so one tenant can authenticate as another
- Agent leaves IdP-initiated SAML enabled without deciding to, because Spring falls back to matching on
  `Response#Issuer`
- Agent treats `RelayState` as opaque and redirects to it, creating an unauthenticated open redirect
- Agent implements replay detection in an in-memory cache and then deploys more than one instance
- Agent ignores certificate expiry until a customer's users are all locked out at once
- Agent accepts SHA-1 signatures because the library permits them

## Related

- [security-hardening.md](security-hardening.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [spring-security-saml.md](spring-security-saml.md) · [checklist.md](checklist.md)
