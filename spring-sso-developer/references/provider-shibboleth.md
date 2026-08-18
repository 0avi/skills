# Shibboleth and academic federations

**Verified against Shibboleth and REFEDS documentation on 12/08/2026.** Spring identifiers are Spring
Security 7.1.0. See [providers.md](providers.md).

**Relevant if you sell to universities, research institutions or government.** Shibboleth is SAML-based
and dominant in that sector, and it works on a **federation** model that inverts two assumptions built
into every other provider in this set, and into Spring Security's SAML support.

## The two inversions

**One: you do not integrate with an identity provider, you join a federation.** In the UK that is the UK
Access Management Federation, in the US InCommon, and there are national federations elsewhere. The
federation publishes metadata describing **all** of its members.

**Two: you do not decide which attributes you receive. The identity provider does.** Attribute release is
the IdP's policy decision, applied per service provider, and it is entirely possible to authenticate a
user successfully and receive **nothing useful about them**.

Both of these are structural, not configuration details, and both change what you build.

## Metadata aggregates, not metadata exchange

Shibboleth's documentation puts it plainly: metadata "provides the basis for all trust between providers
in Shibboleth", and it "doesn't configure the provider itself" but identifies and describes
counterparties.

**The federation supplies one signed aggregate**, not one document per identity provider. The
`<md:EntitiesDescriptor>` element "wraps one or more `EntityDescriptor` elements and is more common in
production Shibboleth use because it enables a bunch of IdPs or SPs to be described at once, and then
**signed as a unit**. This is a common way for federations to supply metadata about their members."

The roles inside it are `<md:IDPSSODescriptor>` and `<md:AttributeAuthorityDescriptor>` for identity
providers, and `<md:SPSSODescriptor>` for service providers.

**Three consequences that matter for a Spring implementation:**

- **You verify the aggregate's signature with the federation's signing key**, not with each identity
  provider's certificate. This is exactly the metadata-trust problem in
  [security-saml.md](security-saml.md): an aggregate consumed without signature verification means
  whoever serves that URL chooses every signing key you will trust, across hundreds of institutions at
  once. **Supply the federation's verification credential.**
- **The aggregate is large and refreshes on a schedule.** Treat retrieval and refresh as an operational
  concern with alerting, not a startup fetch, and see the startup-dependency warning in
  [spring-security-saml.md](spring-security-saml.md).
- **Spring's model assumes you know the identity provider.** A `RelyingPartyRegistration` describes one
  asserting party. A federation gives you hundreds, and the user's institution is not known until they
  say so. You need a `RelyingPartyRegistrationRepository` that resolves from the aggregate, plus a
  discovery step to establish which institution the user belongs to before authentication begins.

**That discovery step is home-realm discovery** by another name, and everything in
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) applies: the input is
unauthenticated, it must not select a signing key on its own, and it fails closed.

## Attribute release, which is why you may get nothing

**The identity provider decides what to release to you**, through an attribute filter policy. The
Shibboleth documentation describes restricting release "to SPs possessing a particular entity attribute",
for example releasing a bundle "to any SP registered by InCommon".

**Entity categories are how this scales.** Rather than naming your service provider individually, an
identity provider releases a defined attribute bundle to every service provider carrying a given entity
category in its metadata. The best known is **REFEDS Research and Scholarship (R&S)**, and Shibboleth's
documentation notes that using entity attributes this way in a filter policy requires **IdP v2.3.4 or
later**.

**So the practical route to receiving attributes is to qualify for a category and be tagged with it in
federation metadata**, not to ask each institution individually. Asking hundreds of institutions to add a
per-SP release rule does not scale and will not happen.

**Design for the attributes being absent.** Some institutions will release less than the category
suggests, and some users will arrive with an identifier and nothing else. An integration that requires an
email address to function will fail for real users at real institutions.

**One documented anti-pattern**, quoted: "Use of the federation URI as a relying party identifier in
attribute release policies... is NOT RECOMMENDED. Amongst other issues, use of the federation URI in this
way assumes that the entity consumes an aggregate containing all of the federation metadata."

## Identifiers

**Not verified in this pass**, and this is the item to establish first because it decides your primary
key. The sector uses several identifier attributes with materially different properties: some are
persistent and targeted per service provider, some are reassignable, and some are human-readable and
therefore mutable.

**Until verified, assume nothing.** Specifically, do not assume an identifier is globally unique, do not
assume it is stable across time, and do not assume it is the same attribute at every institution. Read
the federation's own technical recommendations, which will specify which identifier to key on. This is
the one thing worth spending the time to get right, because a reassignable identifier means one person
inheriting another's account, which is the identifier-reuse hazard in
[security-sessions-and-tenancy.md](security-sessions-and-tenancy.md).

## Practical notes

- **Expect SAML, not OIDC.** A Shibboleth identity provider can serve OIDC through a plugin, but SAML is
  the default assumption and the federation's metadata is SAML metadata. Configure per
  [spring-security-saml.md](spring-security-saml.md).
- **CVE-2026-40988 applies**, since the HTTP-Redirect binding is common here. Check the resolved
  `spring-security-saml2-service-provider` version against 7.0.6 or 6.5.11. See
  [security-saml.md](security-saml.md).
- **The federation has rules you must meet** to join, covering metadata, contacts, security practice and
  sometimes an entity category assessment. Treat it as a procurement-length process rather than a
  configuration task.
- **Institutions upgrade on their own timetable**, so expect a range of Shibboleth IdP versions in the
  field, exactly as with Keycloak and AD FS.

## Not verified in this pass

- **Which identifier attribute to key on**, its uniqueness scope and its stability. **The most important
  gap in this file.**
- The exact attribute names in any standard bundle, and their formats.
- The **entity category** membership requirements and assessment process.
- Federation-specific metadata aggregate URLs, refresh cadences and signing key distribution.
- Shibboleth IdP **OIDC plugin** capabilities and issuer format.
- Single logout behaviour across a federation.
- SCIM: not expected in this sector, and not verified either way.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Verified | Metadata as the basis of trust; `<md:EntitiesDescriptor>` aggregates signed as a unit; the descriptor role elements; entity-attribute-based attribute release with the IdP v2.3.4 floor; the federation-URI anti-pattern. Shibboleth and REFEDS documentation, 12/08/2026 |
| Entity attributes in filter policies | Requires **Shibboleth IdP v2.3.4 or later** on the institution's side |
| Spring's model | Assumes a known asserting party. A federation requires resolution from an aggregate plus discovery |
| Identifiers | **Unverified and important.** Read the federation's technical recommendations |

## Gotchas

- Agent treats a federation like a single identity provider and writes one `RelyingPartyRegistration`
- Agent consumes a federation aggregate without verifying its signature, so one URL controls every
  signing key it will trust
- Agent fetches a large aggregate during startup and makes boot depend on the federation's availability
- Agent assumes attributes will arrive because the protocol supports them. Release is the institution's
  policy decision
- Agent requires an email address to function, and real users at real institutions arrive without one
- Agent asks institutions individually for attribute release rather than qualifying for an entity
  category
- Agent uses the federation URI as a relying party identifier in policy, which the documentation calls
  NOT RECOMMENDED
- Agent picks an identifier attribute without reading the federation's recommendation, and keys accounts
  on something reassignable
- Agent assumes OIDC because the institution mentions it. SAML is the default here
- Agent skips discovery and cannot determine which institution a user belongs to

## Related

- [providers.md](providers.md) · [spring-security-saml.md](spring-security-saml.md) · [security-saml.md](security-saml.md) · [security-sessions-and-tenancy.md](security-sessions-and-tenancy.md) · [checklist.md](checklist.md)
