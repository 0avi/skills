---
name: ci-cd-developer
description: Designs, reviews and fixes CI/CD pipelines across GitHub Actions, Azure DevOps and GitLab CI, and the release path onto Kubernetes, Azure App Service and Container Apps, AWS ECS and Fargate, plain VMs and on-prem, Cloudflare Workers and Cloudflare Containers. Trigger when writing or reviewing a workflow or pipeline, when a build is slow or flaky, for caching and parallelism, secrets and OIDC federation to a cloud, pinning and hardening third-party actions, SBOM generation, SLSA provenance and artifact signing, dependency updates with Renovate or Dependabot, SAST DAST and container scanning placement, reproducible builds, artifact registries and promotion, versioning and release tagging, environment promotion and approvals, database migration gating, deployment strategies including blue-green canary and rolling, rollback, or measuring delivery with the four key metrics.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# CI/CD Guidelines

Covers the path from a commit to running code: **build, test, release, deploy**. It stops at the deployed artifact. Infrastructure definition and runtime operations are out of scope by design.

The organising idea is that a pipeline has two separable halves, and most bad pipelines confuse them. One half is **what the pipeline must guarantee** - that the thing you tested is the thing you shipped, that you can say where an artifact came from, that you can get back. That half barely changes between platforms and barely changes between decades. The other half is **how a given platform spells it**, which changes constantly. This skill keeps them apart: the reasoning lives in the spine, the syntax lives in one reference per platform, and a translation matrix maps between them.

## Operating rules

1. **Build once, promote the same artifact.** If a later stage rebuilds, you have thrown away the evidence that testing produced and you are deploying something no one tested. Every deployment target in this skill is documented in terms of *what gets promoted* - an image digest, a version id, a package - precisely because that is the thing which must not change between environments. See [pipeline-design.md](references/pipeline-design.md).

2. **A pipeline is a claim about risk, so make the claim checkable.** "It passed CI" is worth exactly as much as the gates in CI. State what each gate proves and what it does not. A gate that everyone bypasses is worse than no gate, because it produces false confidence. See [quality-gates.md](references/quality-gates.md).

3. **Pin what you execute.** A workflow that references a third-party action by tag executes whatever that tag points at today. Tags move; commit SHAs do not. This is the cheapest supply-chain control available and it is the one most often skipped. See [actions-security.md](references/actions-security.md).

4. **Prefer federated short-lived credentials to stored secrets.** OIDC federation from the CI platform to the cloud removes the long-lived key entirely, which removes the thing that leaks. Where a stored secret is unavoidable, scope it to an environment and rotate it. See [oidc-and-secrets.md](references/oidc-and-secrets.md).

5. **Rollback is a lie once a migration has run.** Code rolls back; a dropped column does not. Deployability and reversibility are properties of the *schema change*, not of the deployment tool, and the expand/contract discipline is what buys them back. See [database-migrations.md](references/database-migrations.md).

6. **Optimise the pipeline you measured, not the one you remember.** Cache hit rates, stage durations and flake rates are all observable. Guessing which stage is slow wastes as much time here as it does anywhere else, and caching in particular can make a pipeline slower. See [caching.md](references/caching.md).

Every reference carries a **`## Version notes`** section stating what differs across platforms and versions, and a **`## Gotchas`** list of the specific mistakes agents make in that area. Read the gotchas even when skimming.

## What was verified, and what was not

**Verified by running it** on this machine, with a control wherever a control was meaningful: SBOM generation and the exact specification versions emitted, reproducible Maven builds, `cosign` signing with a tampering control, **a secret surviving in an image layer after `rm` (with a `--mount=type=secret` control)**, multi-stage image contents and size, **a real vulnerability scan classified by package origin**, action tag-to-SHA resolution, and local workflow execution. Tools: syft 1.51.1, cosign v3.1.3, grype 0.118.0, trivy 0.74.0, act 0.2.89, Maven 3.9.16, Docker 29.7.2, kind 0.33.0, kubectl v1.36.1.

**Also measured, against live infrastructure:** a **Kubernetes v1.37.0** cluster (`rollout status` exit codes, readiness gating endpoints, liveness restarts, `rollout undo` scope, `revisionHistoryLimit`, initContainer-per-pod) and a **local registry** (tag mutability against digest immutability, digest-scoped signature verification).

**Cited, not measured:** hosted-runner behaviour (token scoping, OIDC minting, environments, approvals, cache hit rates), the AWS, Azure and Cloudflare targets, cross-registry copying, and multi-node cluster behaviour under load. Those are sourced to vendor documentation and marked at the point of use. **Nine claims in earlier drafts were wrong and are corrected**; [../VERIFICATION-STATUS.md](VERIFICATION-STATUS.md) lists each one, how it was found, and what remains open.

**The four key delivery metrics are research, not measurement here.** They come from the DORA programme reported in *Accelerate*; this skill does not re-derive them. See [dora-and-measurement.md](references/dora-and-measurement.md).

## Start Here

- **Triage**: The decision tree from symptom to cause - pipeline is slow, tests are flaky, the deploy failed, a rollback is stuck, a secret leaked, the build is not reproducible - with the measurement to take at each branch. Read [triage.md](references/triage.md)
- **Pipeline Design**: Stages and what belongs in each, build-once-promote-many, gates and their cost, fan-out and fan-in, what CI owes CD. The platform-neutral spine. Read [pipeline-design.md](references/pipeline-design.md)

## Platforms

- **Platform Matrix**: One table mapping every pipeline concept to its spelling in GitHub Actions, Azure DevOps and GitLab CI, so advice can be given once and translated. Read [platform-matrix.md](references/platform-matrix.md)
- **GitHub Actions**: Workflows, jobs and steps, triggers, matrices, reusable workflows against composite actions, environments, concurrency and cancellation, artifacts and job outputs. Read [github-actions.md](references/github-actions.md)
- **Azure DevOps**: YAML pipelines, templates and their parameter types, service connections, environments and approvals, stages and dependencies. **Classic pipelines are maintenance-mode and out of scope.** Read [azure-devops.md](references/azure-devops.md)
- **GitLab CI**: Stages against `needs` and the DAG, rules and workflow rules, components and includes, environments, child pipelines. Read [gitlab-ci.md](references/gitlab-ci.md)
- **Runners**: Hosted against self-hosted, what is actually installed on a hosted image and how to check, ephemeral runners, and why a self-hosted runner on a public repository is a breach waiting to happen. Read [runners.md](references/runners.md)

## Security and Supply Chain

The highest-value half of this skill for regulated work, and the half most often absent.

- **Actions Security**: SHA pinning, the `permissions` block and why the default is wrong, script injection through untrusted expression interpolation, the `pull_request_target` trap, and assessing a third-party action. Read [actions-security.md](references/actions-security.md)
- **OIDC and Secrets**: Federating from each CI platform to each cloud without a stored key, the trust conditions that make or break it, environment-scoped secrets, and secret scanning and rotation. Read [oidc-and-secrets.md](references/oidc-and-secrets.md)
- **SBOM**: CycloneDX (ECMA-424) against SPDX (ISO/IEC 5962), which specification versions current tooling actually emits, generating per ecosystem, and where the document has to end up to be useful. Read [sbom.md](references/sbom.md)
- **Provenance and Signing**: SLSA build levels and what each actually requires, GitHub Artifact Attestations, `cosign` including the v3 changes that break every v2 snippet, and verifying at the point of deployment rather than at the point of build. Read [provenance-and-signing.md](references/provenance-and-signing.md)
- **Dependency Updates**: Renovate against Dependabot, grouping and scheduling so the noise is survivable, automerge policy, and triaging a CVE that has no fix. Read [dependency-updates.md](references/dependency-updates.md)
- **Scanning**: Where SAST, DAST, SCA and container scanning belong in a pipeline, what each finds and misses, and how to gate on them without blocking every build. Read [scanning.md](references/scanning.md)

## Build

- **Java Build**: Maven and Gradle in CI, toolchain selection, **reproducible builds and the one property that makes them work**, test parallelism, and build caching that is safe. Read [java-build.md](references/java-build.md)
- **Frontend Build**: npm and Angular in CI, lockfile discipline, `npm ci` against `npm install`, bundle budgets as a gate, and cache keys that actually hit. Read [frontend-build.md](references/frontend-build.md)
- **Caching**: What to cache and what never to, cache key design, poisoning and how to avoid it, and the cases where caching makes a pipeline slower. Read [caching.md](references/caching.md)
- **Containers**: Multi-stage builds, digest pinning, build caching across runs, distroless and minimal bases, buildpacks against a hand-written Dockerfile, and image size as a deployment property. Read [containers.md](references/containers.md)
- **Artifacts and Registries**: Immutability, retention, coordinates and versioning, promotion between registries, and why "latest" is not a version. Read [artifacts-and-registries.md](references/artifacts-and-registries.md)

## Test in CI

- **Testing in CI**: The pyramid as a pipeline shape, Testcontainers and service containers, splitting and parallelising, and what to run on a pull request against on the main branch. Read [testing-in-ci.md](references/testing-in-ci.md)
- **Flaky Tests**: Detection, quarantine, the policy question, and why retrying until green is a decision to ship unknown risk. Read [flaky-tests.md](references/flaky-tests.md)
- **Quality Gates**: Coverage, linting, architecture tests, bundle budgets and vulnerability thresholds - which are worth blocking on, which should only report, and how to set a threshold that does not ratchet into meaninglessness. Read [quality-gates.md](references/quality-gates.md)

## Release and Deploy

- **Versioning**: Semantic versioning against calendar versioning, Conventional Commits, changelog generation, tagging, and monorepo against polyrepo release coordination. Read [versioning.md](references/versioning.md)
- **Environments and Promotion**: Dev, staging and production as a promotion chain, configuration injection and the twelve-factor position, approvals, and keeping one artifact across all of them. Read [environments-and-promotion.md](references/environments-and-promotion.md)
- **Deployment Strategies**: Rolling, blue-green, canary and their prerequisites, which targets support which natively, and how each interacts with a schema change. Read [deployment-strategies.md](references/deployment-strategies.md)
- **Rollback**: Rollback against roll-forward, what makes a deployment reversible, and the database as the thing that decides. Read [rollback.md](references/rollback.md)
- **Database Migrations**: Expand and contract, the two-deploy rule, gating migrations in a pipeline, and why backwards-compatible schema change is a delivery concern rather than a database one. Read [database-migrations.md](references/database-migrations.md)

### Deployment targets

Each target answers the same four questions: how an artifact becomes running code, how configuration is injected, what the rollback primitive is, and what the zero-downtime primitive is.

- **Kubernetes**: Read [target-kubernetes.md](references/target-kubernetes.md)
- **Azure App Service and Container Apps**: Read [target-azure.md](references/target-azure.md)
- **AWS ECS and Fargate**: Read [target-aws.md](references/target-aws.md)
- **VM and on-premises**: Read [target-vm-onprem.md](references/target-vm-onprem.md)
- **Cloudflare Workers**: The one target with no container and no image digest, where the promotable unit is a *version*. Read [target-cloudflare-workers.md](references/target-cloudflare-workers.md)
- **Cloudflare Containers**: A real OCI image, but fronted by a Worker and a Durable Object, with a rolling rollout that leaves a Worker-to-container skew window. Read [target-cloudflare-containers.md](references/target-cloudflare-containers.md)

## Reference

- **Checklist**: Every practice in one scannable list, **split into adopt-anywhere and depends-on-context**, for a pipeline review pass. Read [checklist.md](references/checklist.md)
- **Platform Versions**: Action versions and their SHAs, runner images, tool versions, and the schema and API versions each platform is on. The file to check before quoting a version. Read [platform-versions.md](references/platform-versions.md)
- **DORA and Measurement**: The four key metrics, how to instrument them from pipeline data, and what the research does and does not claim. Read [dora-and-measurement.md](references/dora-and-measurement.md)
- **Trunk and Branching**: Trunk-based development, short-lived branches, why branching strategy is a delivery constraint, and feature flags as the alternative to long-lived branches. Read [trunk-and-branching.md](references/trunk-and-branching.md)
- **Book Deltas**: Where this skill departs from the continuous delivery canon, and what it could not verify. Read [book-deltas.md](references/book-deltas.md)
