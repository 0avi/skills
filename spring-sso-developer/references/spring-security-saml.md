# Spring Security as a SAML 2.0 Service Provider

This file owns **how to configure it correctly**. The attack catalogue, and the validation Spring does
not perform, live in [security-saml.md](security-saml.md) and are not repeated here. Read that one
before you ship, because the headline is that Spring's own documentation calls its assertion validation
"minimal".

Everything below was read from the Spring Security **7.1.0** reference documentation. Where the
documentation does not state something, this page says so rather than filling the gap.

## Dependencies, including the one that breaks the build

```xml
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-saml2-service-provider</artifactId>
</dependency>
```

**You must also add the Shibboleth repository.** OpenSAML is not in Maven Central, so without this the
build cannot resolve the dependency at all, and the error names OpenSAML rather than Spring:

```xml
<repositories>
    <repository>
        <id>shibboleth-releases</id>
        <name>Shibboleth Releases Repository</name>
        <url>https://build.shibboleth.net/maven/releases/</url>
        <snapshots><enabled>false</enabled></snapshots>
    </repository>
</repositories>
```

This is the single most common first-hour failure on a SAML integration, and it looks like a corporate
proxy problem rather than a missing repository. If your organisation mirrors Maven through an internal
proxy, the Shibboleth repository has to be added there too.

## A minimal working relying party

```yaml
spring:
  security:
    saml2:
      relyingparty:
        registration:
          acme:
            signing:
              credentials:
                - private-key-location: "classpath:credentials/rp-private.key"
                  certificate-location: "classpath:credentials/rp-certificate.crt"
            assertingparty:
              entity-id: https://idp.acme.example/issuer
              singlesignon:
                url: https://idp.acme.example/issuer/sso
              verification:
                credentials:
                  - certificate-location: "classpath:acme-idp.crt"
```

```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests((authorize) -> authorize.anyRequest().authenticated())
        .saml2Login(Customizer.withDefaults())
        .saml2Logout(Customizer.withDefaults())
        .saml2Metadata(Customizer.withDefaults())
        .build();
}
```

`acme` is a registration id you choose, and it appears in the generated URLs. **One registration per
identity provider**, which in a multi-tenant product means one per customer.

**Signing credentials are part of the minimum, not an optional extra**, and `sign-request` is absent
above because the default already signs. This is the trap on the whole page, and it fails at startup
rather than at login:

| What you write | `wantAuthnRequestsSigned` | Result with no `signing.credentials` |
| -------------- | ------------------------- | ------------------------------------ |
| `sign-request` omitted | `true`, the field's initial value | **Context refresh fails** |
| `sign-request: true` | `true` | **Context refresh fails** |
| `sign-request: false` | `false` | Starts, and sends unsigned `AuthnRequest`s |

Boot's `Saml2RelyingPartyRegistrationConfiguration` enforces the coupling directly:

```java
private void validateSigningCredentials(Registration properties, boolean signRequest) {
    if (signRequest) {
        Assert.state(!properties.getSigning().getCredentials().isEmpty(),
                "Signing credentials must not be empty when authentication requests require signing.");
    }
}
```

The reason the reference documentation's example shows `sign-request: false` is that the example carries
**no signing credentials**, so it would not start otherwise. Read as a statement of the default it is
wrong in both directions: the default is `true`, and copying `false` into a registration that does have
signing credentials silently downgrades you to unsigned requests. **Leave `sign-request` unset**, supply
signing credentials, and set it to `false` only when an identity provider cannot accept signed requests,
recording the reason.

**On the `metadata-uri` path the customer decides.** `signRequest` is read from the built registration,
so with metadata the value comes from the asserting party's own `WantAuthnRequestsSigned` attribute. A
customer whose metadata requests signed requests will **fail your application's startup** if that
registration has no signing credentials, which is a startup failure caused by a third party's
configuration file. Give every registration signing credentials as a matter of course.

### The endpoints you get

| Purpose | Default path |
| ------- | ------------ |
| Start login (SP-initiated) | `/saml2/authenticate/{registrationId}` |
| Assertion consumer service | `/login/saml2/sso/{registrationId}` |
| Service provider metadata | `/saml2/metadata`, also `/saml2/metadata/{registrationId}` and `/saml2/service-provider-metadata/{registrationId}` |
| RP-initiated logout trigger | `POST /logout`, the standard Spring Security logout endpoint |
| Asserting-party logout requests and responses | `/logout/saml2/slo` |

**The SLO path is `/logout/saml2/slo`, with no registration id, and this is settled rather than
uncertain.** The logout documentation states why: "Because the user is already logged in or the original
Logout Request is known, the `registrationId` is not part of these URLs by default." The 7.1.0 source
agrees, since `Saml2LogoutConfigurer` initialises both the request and response configurers with
`private String logoutUrl = "/logout/saml2/slo";` and builds their matchers from that literal with no
path variable in it.

The login overview page lists `/logout/saml2/slo/{registrationId}` as also supported, which is a
customisation rather than a second default. You opt into it the same way you would move the endpoint
anywhere else:

```java
.saml2Logout((saml2) -> saml2
    .logoutRequest((request) -> request.logoutUrl("/logout/saml2/slo/{registrationId}"))
    .logoutResponse((response) -> response.logoutUrl("/logout/saml2/slo/{registrationId}")));
```

**Note the ACS path goes the other way round**, which is the genuinely confusing part.
`Saml2WebSsoAuthenticationFilter.DEFAULT_FILTER_PROCESSES_URI` is `"/login/saml2/sso/{registrationId}"`
on both 7.1.0 and 6.5.11, with `/login/saml2/sso` additionally matched. So the assertion consumer service
carries the registration id by default and the logout endpoint does not. Hand a customer's administrator
both paths from the table above rather than reasoning by analogy from one to the other. One further
wrinkle: the overview page writes the logout base path as `/logout/saml2/sso` in the bullet whose text
then describes the `slo` variant, so take `/logout/saml2/slo` from the logout page and the source.

## The startup dependency nobody expects

The documentation states that the identity provider must be **up and responding when your application
starts**, because the application queries its metadata endpoint for the `<SingleLogoutService>` element
and caches signature verification keys.

Read that again in production terms: **your service will not start if the customer's identity provider
is unreachable.** In a multi-tenant deployment with one registration per customer, that is a startup
dependency on every customer's infrastructure at once.

The mitigations are architectural rather than configuration:

- Prefer **locally stored certificates** over metadata fetched at startup where the identity provider's
  key is stable, so a slow or down provider cannot block boot.
- If you fetch metadata, load registrations **lazily or in the background** rather than eagerly during
  context refresh, so a single unreachable provider degrades one tenant instead of the deployment.
- Alert on metadata fetch failures separately from application health, because a fetch that fails after
  startup is invisible until the next login.

## Metadata, in both directions

**Publishing yours.** `Saml2MetadataFilter` serves `<saml2:SPSSODescriptor>` metadata at
`/saml2/metadata` once `saml2Metadata()` is enabled. The path is configurable:

```java
.saml2Metadata((saml2) -> saml2.metadataUrl("/saml/metadata"))
```

Publishing metadata is worth doing even though customers often ask for values by email, because it
removes a transcription step from every onboarding.

**Consuming theirs, and the default that will catch you.** The documented component is
`OpenSaml5AssertingPartyMetadataRepository`, which refreshes metadata in an expiry-aware way and
supports signature verification:

```java
// Verifies the metadata signature. Prefer this.
OpenSaml5AssertingPartyMetadataRepository.withMetadataLocation("https://idp.example.org/metadata")
        .verificationCredentials((c) -> c.add(myVerificationCredential))
        .build();
```

The documentation states the default plainly, and it is the sentence to remember:

> "If no credentials are provided, the component will not perform signature validation."

So `fromTrustedMetadataLocation(...)` does what its name says: it trusts the location. **Unverified
metadata means whoever controls that URL, or the transport to it, chooses the signing key your
application will trust for assertions.** That is a full authentication bypass delivered through a
configuration convenience, and it is why [security-saml.md](security-saml.md) treats metadata handling
as a key-management problem rather than a setup step.

The documentation does **not** address whether HTTPS is required when fetching metadata, so treat TLS to
a WebPKI certificate as your own requirement, per the OWASP guidance quoted in the security file.

`RelyingPartyRegistrations` is also referenced as a helper for parsing asserting-party metadata, but the
metadata page does **not** state its method names. Confirm them against the javadoc for your version
rather than copying a method name from a blog post.

## Signing credentials

Signing needs a **PKCS#8 private key** and an **X.509 certificate**:

```yaml
signing:
  credentials:
    - private-key-location: "classpath:credentials/rp-private.key"
      certificate-location: "classpath:credentials/rp-certificate.crt"
```

or programmatically:

```java
Saml2X509Credential credential = Saml2X509Credential.signing(privateKey, certificate);
RelyingPartyRegistration.withRegistrationId("acme")
        .signingX509Credentials((signing) -> signing.add(credential));
```

**The property tree is fixed, and one documentation example reads as though it is not.** The logout page
shows a registration whose id happens to be the word `metadata`:

```yaml
        registration:
          metadata:                       # this is the registrationId, not a nesting level
            signing.credentials:
              - private-key-location: classpath:credentials/rp-private.key
            singlelogout.url: "{baseUrl}/logout/saml2/slo"
            assertingparty:
              metadata-uri: https://ap.example.com/metadata
```

That slot holds `acme` in the example above and `adfs`, `okta` or `azure` in others. Boot's
`Saml2RelyingPartyProperties` settles it: `registration` is a `Map<String, Registration>`, and
`Registration` has exactly `entityId`, `acs`, `signing`, `decryption`, `singlelogout`, `assertingparty`
and `nameIdFormat`. **There is no `metadata` member**, so a registration literally named `metadata` is
the only reading available.

**Decryption credentials** are a separate concern from signing, for encrypted assertions, and they sit
directly under the registration:

```yaml
decryption:
  credentials:
    - private-key-location: "classpath:credentials/rp-private.key"
      certificate-location: "classpath:credentials/rp-certificate.crt"
```

The general point survives the specific one: a mis-nested Spring Boot property is **silently ignored**,
so the symptom of getting this wrong is an unsigned request or an undecryptable assertion rather than a
startup error. Bind against the properties class when in doubt, not against an example.

## Logout

Both directions are supported, and both require signatures.

**RP-initiated.** The user posts to `/logout`. Spring builds and posts a `<saml2:LogoutRequest>` to the
identity provider's SLO endpoint, and the provider returns a `<saml2:LogoutResponse>` to
`/logout/saml2/slo`. Driven by `Saml2RelyingPartyInitiatedLogoutSuccessHandler`.

**AP-initiated.** The identity provider posts a signed `<saml2:LogoutRequest>` to `/logout/saml2/slo`.
Spring validates it, logs the user out, and posts a `<saml2:LogoutResponse>` back. Handled by
`Saml2LogoutRequestFilter` and `Saml2LogoutResponseFilter`.

The customisation surfaces:

```java
.saml2Logout((saml2) -> saml2
    .logoutUrl("/saml2/logout")
    .logoutRequest((request) -> request.logoutRequestResolver(myResolver))
    .logoutResponse((response) -> response.logoutResponseValidator(myValidator)));
```

with `Saml2LogoutRequestResolver`, `Saml2LogoutRequestValidator`, `Saml2LogoutResponseResolver` and
`Saml2LogoutResponseValidator` as the interfaces, defaulted by the `OpenSaml5Logout*` implementations,
and `LogoutRequestRepository` storing in-flight requests, session-based by default.

**Three preconditions on the identity provider**, all of which are the customer's configuration rather
than yours, and all of which you will end up asking for by name:

1. It must support SAML 2.0 Single Logout at all.
2. Its metadata must include a `<SingleLogoutService>` element.
3. It must be configured to **sign and POST** logout requests and responses to your
   `/logout/saml2/slo` endpoint.

`singlelogout.url` is the property for your endpoint in the registration. Do not promise a customer
working single logout until all three preconditions are confirmed on their side, because the failure is
silent: login works perfectly and logout simply does not propagate.

**Why this is unreliable in practice**, and how to design for its failure, is in
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md). The short version: keep session
lifetimes short, treat logout as authoritative locally and best-effort remotely, and never present
single logout to a customer as a security guarantee.

## The principal, and mapping attributes to authorities

**The accessor API changed in 7.0, and the one most material names is now deprecated.** Read from the
source at both tags:

| Version | What to use | Status |
| ------- | ----------- | ------ |
| **6.5.11** | `Saml2AuthenticatedPrincipal` | Current on this line |
| **7.1.0** | `Saml2ResponseAssertionAccessor`, plus `Saml2AssertionAuthentication.getRelyingPartyRegistrationId()` | `Saml2AuthenticatedPrincipal` is `@Deprecated`, its javadoc naming exactly these two as the replacement |

`Saml2ResponseAssertionAccessor`, added in 7.0, declares `getNameId()`, `getSessionIndexes()`,
`getAttributes()` returning **`Map<String, List<Object>>`**, `getResponseValue()`, and the two
convenience defaults `getFirstAttribute(String)` and `getAttribute(String)`, both `@Nullable`.

**That return type is the practical point, not the rename.** Every SAML attribute is multi-valued, so an
attribute is a `List` even when a customer only ever sends one value. `getFirstAttribute` exists because
of that, and reaching for it is right for single-valued attributes and wrong for group membership, which
is exactly where multiple values are the normal case. Reading only the first group is a bug that passes
every test where a test user belongs to one group.

The tenant identity is `getRelyingPartyRegistrationId()`, which moved to `Saml2AssertionAuthentication`
on 7.x. In a multi-tenant product that is the value to bind the session to, and taking it from the
`Authentication` rather than from the URL is what makes it trustworthy.

What matters architecturally, and does not depend on which version's API you are on:

- **Map groups to authorities at the boundary, once**, in a converter, not scattered through the
  application. A customer sends whatever their directory contains, which is rarely what your roles are
  called.
- **Never trust an attribute you have not decided to trust.** A group attribute is a claim by the
  identity provider about the user, and if you grant administrator rights from a group name, then the
  customer's directory administrator controls administration in your product. That may be exactly what
  you want; it should be a decision.
- **Expect attribute names to be URNs or OID-like strings**, not friendly names, and to differ per
  provider for the same concept. This is a per-registration mapping concern, which is another reason
  registrations are per customer.

## Multi-tenant SAML

One `RelyingPartyRegistration` per customer, resolved before authentication, and:

- **Verify each assertion with that registration's credentials only.** Verifying against the union of
  all configured certificates lets one customer's identity provider mint assertions accepted as another
  customer's. In a SaaS product this is a cross-tenant authentication bypass, and it is the single most
  important rule on this page.
- **Track certificate expiry per registration and alert ahead of it.** OWASP puts the maximum useful
  lifetime of a SAML signing certificate at two years, so every customer integration has a scheduled
  breakage.
- **Resolve the tenant from the registration id in the URL or from the assertion issuer**, never from a
  user-supplied parameter. See
  [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

A `RelyingPartyRegistrationRepository` backed by your database rather than by static configuration is
the natural shape once customers self-serve their own SSO setup.

## Migrating from the Spring Security SAML Extension

The standalone Spring Security SAML Extension is **superseded**; SAML support is built into Spring
Security itself, and the reference documentation carries a dedicated migration page. **The contents of
that page were not read in this pass**, so this file does not summarise its steps. If you are migrating,
read it directly rather than following any third-party guide, because the extension's configuration
model has no direct equivalent.

The general shape of the change: the extension's XML-heavy provider configuration is replaced by
`RelyingPartyRegistration` objects, and its filter set by the `saml2Login()` DSL.

## Version notes

**Read from the Spring Security 7.1.0 reference documentation on 12/08/2026.**

| Concern | Detail |
| ------- | ------ |
| Boot mapping | Boot 4.1.0 manages Spring Security 7.1.0; Boot 3.5.16 manages 6.5.11. On the 3.5.x line, check every class name below against the 6.5.x reference |
| Provider class | **`OpenSaml5AuthenticationProvider`**. Earlier versions named `OpenSaml4AuthenticationProvider` or `OpenSamlAuthenticationProvider`, so any example using those predates 7.x |
| Metadata repository | `OpenSaml5AssertingPartyMetadataRepository`. **No signature validation unless verification credentials are supplied** |
| Logout SLO path | `/logout/saml2/slo`, with **no** `{registrationId}` by default, from the logout page and from `Saml2LogoutConfigurer` at the 7.1.0 tag. The `{registrationId}` form is a documented customisation you opt into |
| ACS path | `/login/saml2/sso/{registrationId}`, from `Saml2WebSsoAuthenticationFilter.DEFAULT_FILTER_PROCESSES_URI` at both the 7.1.0 and 6.5.11 tags, with `/login/saml2/sso` also matched. Opposite convention to the logout endpoint |
| `sign-request` default | **`true`.** `AssertingPartyDetails.Builder` initialises `private boolean wantAuthnRequestsSigned = true;` at the 7.1.0 tag, and Boot's property is `@Nullable Boolean`, applied only when present. Unset therefore means signed, and Boot asserts that signing credentials are non-empty whenever it is `true` |
| Assertion clock skew default | **5 minutes.** `OpenSaml5AuthenticationProvider.AssertionValidator.Builder` puts `SAML2AssertionValidationParameters.CLOCK_SKEW` to `Duration.ofMinutes(5)` at the 7.1.0 tag. The reference page does not state it; the source does |
| Unsigned assertion rejection | **Not explicitly stated in the documentation.** Confirm for your configuration |
| Property tree under a registration | Settled from `Saml2RelyingPartyProperties`: exactly `entityId`, `acs`, `signing`, `decryption`, `singlelogout`, `assertingparty`, `nameIdFormat`. The `metadata` key in one logout example is a **registration id**, not a nesting level |
| Decryption credential property path | `decryption.credentials[]`, taking `private-key-location` and `certificate-location`, from `Saml2RelyingPartyProperties.Registration.Decryption` |
| Principal accessor API | **Version split.** `Saml2AuthenticatedPrincipal` is current on 6.5.11 and **`@Deprecated` on 7.1.0**, replaced by `Saml2ResponseAssertionAccessor` and `Saml2AssertionAuthentication.getRelyingPartyRegistrationId()`, both added in 7.0. Read from the source at both tags |
| Attribute value type | `Map<String, List<Object>>`. Every attribute is multi-valued, so `getFirstAttribute` is wrong for group membership |
| Migration page contents | **Not read in this pass** |
| Shibboleth repository | Mandatory. OpenSAML is not published to Maven Central |

## Gotchas

- Agent omits the Shibboleth repository and reports an unresolvable OpenSAML dependency as a proxy or
  network problem
- Agent uses `fromTrustedMetadataLocation` and believes metadata signatures are being checked. Without
  verification credentials the component performs no signature validation
- Agent fetches identity provider metadata at startup and creates a hard boot dependency on every
  customer's infrastructure
- Agent reads the documentation example's `sign-request: false` as the default. The default is `true`,
  and the example shows `false` only because it carries no signing credentials
- Agent writes `sign-request: true` into a registration with no signing credentials, and the application
  fails context refresh on `Assert.state` rather than starting and sending unsigned requests
- Agent reads the registration id `metadata` in the logout example as a nesting level and invents a
  property path from it
- Agent copies a property nesting from an example without checking it against
  `Saml2RelyingPartyProperties`, and a silently ignored property produces an unsigned request rather
  than an error
- Agent verifies assertions against all configured certificates rather than the registration's own,
  which in a multi-tenant product is a cross-customer authentication bypass
- Agent promises a customer working single logout before confirming their identity provider supports
  SLO, publishes `<SingleLogoutService>`, and signs and POSTs to the right endpoint
- Agent gives a customer administrator an SLO URL with `{registrationId}` in it by analogy with the ACS
  path, when the logout endpoint takes no registration id by default, and the break appears only at
  logout
- Agent grants administrator authority from a group attribute without deciding that the customer's
  directory administrator should control administration in the product
- Agent assumes friendly attribute names. Providers send URNs and OID-like strings, differently per
  provider
- Agent reads group membership with `getFirstAttribute`, which returns one value from a multi-valued
  attribute and passes every test whose user belongs to one group
- Agent writes against `Saml2AuthenticatedPrincipal` on 7.x, which is deprecated there in favour of
  `Saml2ResponseAssertionAccessor`, or against the 7.0 replacements on 6.5.x, where they do not exist
- Agent treats certificate expiry as an operational detail until every user at one customer is locked
  out simultaneously
- Agent follows a third-party migration guide for the old SAML Extension instead of the official
  migration page
- Agent takes the ten minutes in the documentation's `clockSkew` example as the default. The default is
  **five** minutes, in the source at the version tag

## Related

- [security-saml.md](security-saml.md) · [security-hardening.md](security-hardening.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [spring-security-oidc.md](spring-security-oidc.md) · [checklist.md](checklist.md)
