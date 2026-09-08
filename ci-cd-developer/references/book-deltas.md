# Book Deltas

Where this skill departs from its sources, what it could not verify, and - unusually - what its sources turned out not to be. Written because the rest of the skill claims verification, so the limits have to be stated somewhere findable.

---

## The sources this skill does *not* have

**The continuous delivery canon was requested and did not arrive.** None of the following were available when this skill was written:

| Book | Role it would have played |
| ---- | ------------------------- |
| **Continuous Delivery** - Humble & Farley (2010) | The deployment pipeline concept, stage design, the original argument |
| **Accelerate** - Forsgren, Humble & Kim (2018) | The evidence base: four key metrics, batch size, the throughput-and-stability finding |
| **Continuous Delivery Pipelines** - Farley (2021) | The modern restatement |
| **Grokking Continuous Delivery** - Wilson (2022) | Pipeline design as distinct from tool configuration; flake and gate policy |

**Consequences, stated so they can be corrected later:**

- The spine ([pipeline-design.md](pipeline-design.md), [trunk-and-branching.md](trunk-and-branching.md)) **names** these ideas and attributes them, but quotes no figures, tables or passages from them.
- [dora-and-measurement.md](dora-and-measurement.md) names the four metrics and describes how to instrument them, and deliberately **quotes no performance bands, thresholds or percentages**, because the source is not here to check them against.
- The "ten minute commit stage" is flagged in [pipeline-design.md](pipeline-design.md) as **a widely repeated heuristic, not a measured constant**, for the same reason.

**When the canon arrives, this file is the checklist:** verify the pipeline-design claims against Humble and Farley, add the DORA figures with their bands, and add a proper deltas section recording where a 2010 text is now wrong. That last section will be substantial - the 2010 book predates Docker, Kubernetes, cloud-native deployment, hosted CI and every platform this skill covers.

## What arrived, and what it actually was

Three files were supplied. **Two were not usable books.**

| Supplied | Reality |
| -------- | ------- |
| `software-supply-chain-security-...pdf` | **Not a PDF.** 1,678 bytes of HTML containing a PHP error dump (`filesize(): stat failed`, `controllers/Pdftool.php` line 411). The download failed server-side |
| `GitHub_Actions_in_Action_MEAP_V03.pdf` | **A fabricated file.** Zero embedded fonts, 61 JPEG page scans. Page 1 an `ebookname.com` advert, page 3 a list of unrelated titles, page 30 genuine chapter-2 excerpt, page 58 filler from a heraldry dictionary |
| `Azure DevOps Explained.pdf` | **A real book, wrong edition.** 1st edition, December 2020, ISBN 978-1-80056-351-3 |

The first two contributed nothing. The third contributed the analysis below.

## The 2020 Azure DevOps book, quantified

Measured across its 438 pages, rather than asserted:

| Term | Occurrences |
| ---- | ----------- |
| `Release pipeline` | **100** |
| `YAML` | 76 |
| `azure-pipelines.yml` | **3** |
| `Classic editor` | 14 |

Chapter 8, the deployment chapter, teaches deployment through *release pipelines* - the Classic model. The prose is GUI walkthrough (*"Now, Save and queue the build, specify a save comment"*) supported by 752 screenshots.

**Position taken:** since Microsoft has invested new capability exclusively in YAML pipelines since 2023 and Classic is maintenance-mode, this book is used as a **concepts-only** source - service connections, environments and approvals, agent pools, and the chapter 11 scenarios - and **no pipeline syntax is taken from it**. [azure-devops.md](azure-devops.md) states this at the point of use.

**Generalised rule this produced:** treat any Azure DevOps material predating 2023 as teaching a deprecated model. It is the clearest instance in this repository of a real, competent book being actively misleading because the platform moved underneath it.

## Where the standards replaced a book

The missing supply-chain book turned out not to matter, and that is worth recording as a finding rather than a consolation.

Supply-chain security is governed by **normative standards that are free and citable**, and a book is a secondary summary of them:

| Instead of a book | Use |
| ----------------- | --- |
| Supply-chain narrative | **SLSA v1.1**, **NIST SSDF SP 800-218**, **in-toto** |
| SBOM formats | **CycloneDX / ECMA-424**, **SPDX / ISO/IEC 5962:2021** |
| Signing | **Sigstore** documentation |

These are what an auditor cites, which makes them the better source regardless of book availability. See [sbom.md](sbom.md) and [provenance-and-signing.md](provenance-and-signing.md).

## What this skill measured

Genuinely run on this machine, with controls where a control was meaningful:

| Claim | Method |
| ----- | ------ |
| Maven reproducibility depends on `project.build.outputTimestamp` | Built twice with it (identical SHA-256) and twice without (**two different hashes**). mtimes advanced, proving real rebuilds |
| syft emits CycloneDX 1.7 but SPDX **2.3** by default | Generated and read the version fields back |
| SPDX 3.0 has no `spdxVersion` key | Compared top-level keys of a 2.3 and a 3.0.1 document |
| cosign v3 offline signing works, tampering is rejected | `Verified OK` on the genuine artifact; **failed** on the same artifact with one byte appended |
| cosign v3 breaks v2 recipes | Three specific invocations failed; the working form found by experiment |
| Action tags resolve to these SHAs | GitHub API |
| `ubuntu-latest` spans Ubuntu majors | Listed `actions/runner-images` |
| `act` runs workflows but with a local git context | Ran one to success; **`GITHUB_SHA` was empty** and the job still passed |

**The negative controls are the point.** A reproducibility claim without the without-the-property comparison, or a signature-verification claim without a tampered input, is an assertion.

## What this skill could not verify

Stated plainly, because most of the deployment half falls here:

- **Every cloud target.** No AWS, Azure, GCP or Cloudflare account. All of [target-kubernetes.md](target-kubernetes.md), [target-azure.md](target-azure.md), [target-aws.md](target-aws.md), [target-cloudflare-workers.md](target-cloudflare-workers.md) and [target-cloudflare-containers.md](target-cloudflare-containers.md) is cited from vendor documentation.
- **Hosted runner behaviour.** Token scoping, OIDC minting, environments, approvals, cache hit rates, queueing, and what is preinstalled.
- **Azure DevOps and GitLab entirely.** No organisation or instance available; both platform files are documentation-derived.
- **Container image building and registry interaction.** Docker was running but no image was built or pushed.
- **Any scanner.** `trivy` and `grype` were not installed.
- **The DORA findings.** Cited, not reproduced, and no figures quoted.

## Version notes

- **Windows x64, single machine.** Tool availability and behaviour are platform-specific; the standards versions are not.
- **The measurements have a date.** Tool versions are in [platform-versions.md](platform-versions.md) with reproduction commands.
- **This file should shrink.** Each item under "could not verify" is a candidate to move into "measured" when an account, a cluster or a book becomes available.

## Gotchas

- Agent cites this skill's cloud deployment guidance as measured - it is cited from vendor documentation; only the local toolchain claims were measured
- Agent quotes DORA performance bands from this skill - **the source is not held here**; the metrics are named, the numbers deliberately are not
- Agent takes Azure DevOps YAML syntax from a pre-2023 book - that material is Classic pipelines
- Agent treats the supplied `GitHub Actions in Action` file as the book - it is a pirate-aggregator fabrication with heraldry filler
- Agent treats a download from an ebook aggregator as a verified source - two of three supplied files were broken or fabricated
- Agent repeats the "ten minute commit stage" as a measured threshold - it is a heuristic, flagged as such
- Agent asserts reproducibility without the control build - the comparison is what makes it a finding
- Agent asserts signature verification works without testing a tampered input - an untested verification step is unverified
- Agent concludes a workflow is correct because `act` passed - measured, `GITHUB_SHA` was empty and the job still succeeded

## Related

- [pipeline-design.md](pipeline-design.md) · [dora-and-measurement.md](dora-and-measurement.md) · [azure-devops.md](azure-devops.md) · [sbom.md](sbom.md) · [provenance-and-signing.md](provenance-and-signing.md) · [java-build.md](java-build.md) · [platform-versions.md](platform-versions.md) · [trunk-and-branching.md](trunk-and-branching.md) · [checklist.md](checklist.md)
