# SBOM

A Software Bill of Materials is an inventory of what is inside a build. It is worth generating for one practical reason: when the next widely-exploited dependency vulnerability lands, the question "are we affected, and where" becomes a query instead of an investigation.

| Question | Answer |
| -------- | ------ |
| Which format? | **CycloneDX** for security work, **SPDX** for licence and compliance work. Generate both if asked; they are cheap |
| Are they standards? | Yes, both. CycloneDX is **ECMA-424**, SPDX is **ISO/IEC 5962:2021** |
| Where in the pipeline? | At build time, from the same job that produces the artifact, and **attached to the artifact** |
| Source or image? | **Both, and they answer different questions.** Source SBOM covers your declared dependencies; image SBOM covers the OS packages you inherited |
| Does an SBOM find vulnerabilities? | **No.** It is an inventory. A scanner consumes it. Keep the two ideas separate |

---

## The two standards

| | CycloneDX | SPDX |
| --- | --------- | ---- |
| Standard | **ECMA-424** | **ISO/IEC 5962:2021** |
| Steward | OWASP | Linux Foundation |
| Current specification | **1.7** (ECMA-424 2nd edition, December 2025) | **3.0.1** (December 2024) |
| Emphasis | Security: vulnerabilities, VEX, dependency graph | Licensing, provenance, compliance |
| Document shape | Flat JSON, `specVersion` field | **2.x flat JSON; 3.x is JSON-LD** |

Both are real international standards, which matters when an auditor asks. Neither is going away, and tooling generally supports both.

## What tooling actually emits, measured

**Verified with syft 1.51.1** against a Maven project on this machine, reading the emitted documents rather than trusting the flag:

| Requested format | Emitted version | Notes |
| ---------------- | --------------- | ----- |
| `cyclonedx-json` (default) | **1.7** | Matches the current ECMA-424 edition |
| `cyclonedx-json@1.6` | 1.6 | Honoured |
| `spdx-json` (default) | **SPDX-2.3** | **Not the current standard.** The default lags 3.0.1 |
| `spdx-json@3.0` | **SPDX 3.0.1 JSON-LD** | Works, but a structurally different document |

Two findings worth carrying:

**1. The SPDX default is not the current SPDX.** Asking syft for `spdx-json` gets you 2.3, while the published standard is 3.0.1. If a customer or auditor requires SPDX 3.x you must ask for it explicitly. Nothing warns you.

**2. SPDX 3.0 changed the document model, so version detection breaks.** A 2.3 document is flat JSON with a `spdxVersion` field. A 3.0.1 document is **JSON-LD**: no `spdxVersion` key at all, but a `@context` of `https://spdx.org/rdf/3.0.1/spdx-context.jsonld` and an `@graph` array. Measured top-level keys:

```
SPDX 2.3   ["SPDXID","creationInfo","dataLicense","documentNamespace",
            "files","name","packages","relationships","spdxVersion"]
SPDX 3.0.1 ["@context","@graph"]
```

**Any script that identifies an SPDX file by reading `spdxVersion` silently fails on 3.0.** It will not error; the key is simply absent. This is the single most likely way an SPDX 2 to 3 migration breaks a pipeline, and it is invisible until something downstream produces an empty result.

## Generating one

```bash
# source tree: your declared dependencies
syft dir:. -o cyclonedx-json=sbom.cdx.json

# container image: what you inherited from the base image too
syft <image>@sha256:<digest> -o cyclonedx-json=image.cdx.json

# both standards, explicit versions, no surprises
syft dir:. -o cyclonedx-json@1.7=sbom.cdx.json -o spdx-json@2.3=sbom.spdx.json
```

**Scan the image by digest, not by tag.** A tag can move between the build and the scan, and then the SBOM describes something other than what you shipped. See [containers.md](containers.md).

### Native build-tool plugins

`syft` scans a tree or an image from the outside. Build plugins see the *resolved dependency graph* from the inside, which is more accurate for transitive dependencies and scopes:

| Ecosystem | CycloneDX | SPDX |
| --------- | --------- | ---- |
| Maven | `cyclonedx-maven-plugin` | `spdx-maven-plugin` |
| Gradle | `cyclonedx-gradle-plugin` | - |
| npm | `@cyclonedx/cyclonedx-npm` | - |

Prefer the build plugin for the application's own dependencies and `syft` for the image. They disagree, and the disagreement is informative: anything in the image SBOM but not the build SBOM came from the base image and is still yours to patch.

## Where the document has to go

An SBOM in a build log is worthless. It has to be retrievable later, keyed to the artifact:

1. **Attach it to the artifact** in the registry, so it travels with the thing it describes. `cosign attach sbom` or the registry's own referrer support.
2. **Attest it**, which signs the association between the SBOM and the artifact digest so it cannot be swapped. See [provenance-and-signing.md](provenance-and-signing.md).
3. **Publish it to whatever consumes it** - a vulnerability platform, or a customer who contractually requires one.

The test of whether this works: given a CVE and a dependency name, can you list every deployed artifact containing it, without rebuilding anything? If not, the SBOM is decorative.

## Version notes

| | CycloneDX | SPDX |
| --- | --------- | ---- |
| Standardised as | ECMA-424 | ISO/IEC 5962:2021 |
| 1st standard edition | June 2024 | 2021 |
| Current edition | **2nd, December 2025 (spec 1.7)** | **3.0.1, December 2024** |
| syft 1.51.1 default | **1.7** | **2.3** |
| Document model change | None | **2.x flat JSON to 3.x JSON-LD** |

- **SPDX 2.3 is not deprecated** and remains widely consumed. Emitting 2.3 is a legitimate choice; emitting it *believing it is current* is not.
- **CycloneDX 1.7 adds cryptographic and ML component types.** If you generate 1.7 and a downstream tool expects 1.4, pin the output version rather than hoping.
- **Verified on this machine only.** Other syft versions may default differently; check with the probe below rather than assuming.

```bash
# what does your toolchain actually emit?
syft dir:. -o spdx-json=/tmp/s.json && python -c \
  "import json;d=json.load(open('/tmp/s.json'));print(d.get('spdxVersion') or list(d)[:3])"
```

## Gotchas

- Agent treats an SBOM as a vulnerability report - it is an inventory; a scanner consumes it, and the two belong in different pipeline stages
- Agent generates an SBOM and leaves it in the job log or as a build artifact with 30-day retention - it must outlive the build and be keyed to the artifact digest
- Agent assumes `spdx-json` means current SPDX - **measured, syft 1.51.1 emits 2.3 by default** while the standard is 3.0.1
- Agent detects SPDX version by reading `spdxVersion` - **absent in 3.0 JSON-LD**; the document has `@context` and `@graph` instead, and the check fails silently
- Agent scans an image by tag - the tag can move; scan the digest so the SBOM describes what shipped
- Agent generates only a source SBOM - misses every OS package inherited from the base image, which is where a large share of reported vulnerabilities live
- Agent generates only an image SBOM - misses dependency scopes and the resolved graph that a build plugin sees
- Agent picks one format on principle - CycloneDX and SPDX answer different questions and generating both costs one extra flag
- Agent asserts an SBOM proves provenance - it says what is inside, not where it came from or who built it. That is [provenance-and-signing.md](provenance-and-signing.md)

## Related

- [provenance-and-signing.md](provenance-and-signing.md) · [scanning.md](scanning.md) · [dependency-updates.md](dependency-updates.md) · [containers.md](containers.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [platform-versions.md](platform-versions.md) · [checklist.md](checklist.md)
