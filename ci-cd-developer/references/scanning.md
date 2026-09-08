# Scanning

Where the security scanners go, what each actually finds, and how to gate on them without the pipeline ending up permanently red or permanently ignored.

| Scanner | Finds | Runs on | Gate? |
| ------- | ----- | ------- | ----- |
| **Secret scanning** | Credentials in the diff or history | Every push, plus push protection | **Block** |
| **SCA** (dependencies) | Known CVEs in libraries you use | Every push | Block **if fixable** |
| **SAST** (code) | Injection, unsafe deserialisation, crypto misuse | Pull request, changed files | Report, block on high confidence |
| **Container scan** | CVEs in OS packages from the base image | After image build | Block **if fixable** |
| **IaC scan** | Misconfigured infrastructure | On change | Report |
| **DAST** (running app) | Auth, headers, runtime behaviour | **After deploy**, on a schedule | Report |

**The pattern: block on findings that are unambiguous and fixable, report on everything else.** See [quality-gates.md](quality-gates.md).

---

## Placement in the pipeline

```
push ──> secret scan ──> SAST (changed files) ──> build
                                                    │
                              SCA + container scan ─┤   (parallel, on the artifact)
                                                    │
                            deploy to staging ──> DAST (scheduled, not per-commit)
```

Three placement rules that matter more than tool choice:

1. **Secret scanning first**, because it is instant and the response is different from every other finding: revoke, do not fix.
2. **Scan the artifact you built, by digest**, not the source tree and not a tag. A scan against `app:latest` may describe a different image than the one you deploy. See [containers.md](containers.md).
3. **DAST after deployment**, against a running environment, on a schedule. It needs a live application and is far too slow for per-commit.

## Secret scanning

The only scanner where the correct response is **revoke first, investigate second**. A secret that has been pushed is compromised regardless of whether you can prove it was read.

- **Push protection** is worth more than detection, because it stops the secret entering history at all.
- **Scan history, not just the diff**, when first enabling it. The interesting ones are usually old.
- **Rewriting history is not remediation.** Clones and forks retain it. See [oidc-and-secrets.md](oidc-and-secrets.md).

The best mitigation is structural: with OIDC federation there is no long-lived credential to leak in the first place.

## SCA, and the reachability question

SCA compares your dependency list against a vulnerability database. It is cheap, high-volume, and **noisy in a specific way**: it reports vulnerabilities in code you may never execute.

Triage in this order:

1. **Runtime or build-only?** A test-scoped dependency is not in the artifact.
2. **Reachable?** Is the vulnerable function on any path you call? Where the tooling supports reachability analysis, this typically eliminates a large share of findings.
3. **Fixable?** If yes, take the update. If no, decide and record with a review date.

Feed it the SBOM you already generate rather than re-resolving dependencies, so the scan describes the same artifact. See [sbom.md](sbom.md).

## SAST, and the false-positive problem

SAST reads your code for dangerous patterns. Its value depends entirely on tuning, and untuned SAST is the most reliable way to get a security tool switched off.

- **Run it on changed files** for pull requests. A full-repository scan of a legacy codebase produces thousands of findings nobody will triage.
- **Adopt with a baseline.** Accept existing findings, block only on *new* ones. Otherwise adoption is impossible.
- **Block only the high-confidence categories** - SQL string concatenation, command injection, disabled certificate verification. Report the rest.
- **Suppress with a reason**, in code, reviewable. A suppression with no justification is indistinguishable from a mistake.

## Container scanning

The base image contributes packages you did not choose, and they are where most container findings live.

```bash
trivy image --severity HIGH,CRITICAL "$REG/app@$digest"
grype "$REG/app@$digest"
```

**Measured with grype 0.118.0** on the runtime image built for this skill - a trivial Java application on `eclipse-temurin:25-jre`, with no third-party application dependencies at all:

| | Count |
| --- | ----- |
| Total findings | **326** |
| From `deb` packages, i.e. the base image OS | **321** |
| From `go-module` packages inside the base image | 5 |
| From the application's own code or dependencies | **0** |
| By severity | 4 High, 281 Medium, 41 Low |

**98.5% of findings came from the base image**, on an application with essentially no dependencies of its own. That is the quantified case for two things in this file: scan the image rather than only the source, and route the findings to whoever can actually fix them. Handing an application team 321 Debian package CVEs they cannot patch is how scanning gets switched off.

Route findings by **who can fix them**:

| Finding location | Owner | Action |
| ---------------- | ----- | ------ |
| OS package from the base image | Platform | Update or rebase the base image |
| Application dependency | Application team | Dependency update |
| Something you installed in the Dockerfile | Application team | Remove or update |

**Sending base-image CVEs to the application team is how scanning gets ignored**, because they cannot fix them. Fix the base image once and every service benefits. Buildpacks' rebase is designed for exactly this. See [containers.md](containers.md).

A minimal base is the structural fix: distroless images have very few OS packages, so they generate very few findings.

## DAST

Tests the running application: authentication, headers, TLS, error handling, and behaviour no static tool can see.

- **After deploy, against a real environment.** Never against a local approximation.
- **Scheduled, not per-commit.** A meaningful DAST run is slow.
- **Never against production without authorisation**, and be aware that an active scan generates real traffic and can create real data.
- **Report, do not gate.** DAST findings need interpretation.

## Version notes

| | Notes |
| --- | ----- |
| `trivy`, `grype` | Both scan images and SBOMs; both need periodic database updates |
| GitHub | Secret scanning with push protection, Dependabot alerts, and CodeQL for SAST |
| GitLab | Bundled SAST, dependency, container and DAST scanning by tier |
| Azure DevOps | Microsoft Defender for DevOps, or third-party extensions |
| SARIF | The common format for uploading findings so the platform renders them inline |

- **Vulnerability databases update constantly**, so the same image scanned twice a week apart legitimately yields different results. That is not a bug, and it means a scan result has a date.
- **Prefer SARIF upload** so findings appear on the pull request rather than in a log.
- **Measured here:** `grype` **0.118.0** was run against the runtime image built for this skill, producing the 326-finding breakdown above. `trivy` **0.74.0** is installed but was not used for a published figure.
- **Not verified here:** SAST, DAST, IaC scanning and SARIF upload. Those need a hosted platform or a deployed application, and are cited from vendor documentation.

## Gotchas

- Agent scans the source tree and deploys an image - **measured: 1 component in the source SBOM against 1,263 in the image**, and 321 of 326 vulnerability findings came from base-image OS packages
- Agent scans by tag and deploys by tag - the two can be different images; scan the digest
- Agent blocks on all high-severity findings regardless of fixability - pipeline red within a week, gate disabled shortly after
- Agent adopts SAST with no baseline on a legacy codebase - thousands of findings, none triaged, tool switched off
- Agent runs full-repository SAST on every pull request - slow and unactionable; scan changed files
- Agent routes base-image CVEs to the application team - they cannot fix them, so the findings are ignored
- Agent runs DAST per commit - far too slow, and it needs a deployed environment
- Agent runs an active DAST scan against production without authorisation - real traffic, possibly real data
- Agent treats a leaked secret as a code fix - revoke first; the secret is compromised the moment it is pushed
- Agent rewrites history after a leak and considers it resolved - forks and clones retain it
- Agent suppresses a SAST finding with no recorded reason - indistinguishable from an error later
- Agent re-resolves dependencies for the scan instead of using the SBOM - the scan then describes something other than the artifact
- Agent treats differing results from two scans a week apart as a tooling bug - vulnerability databases update continuously

## Related

- [sbom.md](sbom.md) · [dependency-updates.md](dependency-updates.md) · [quality-gates.md](quality-gates.md) · [containers.md](containers.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [actions-security.md](actions-security.md) · [provenance-and-signing.md](provenance-and-signing.md) · [checklist.md](checklist.md)
