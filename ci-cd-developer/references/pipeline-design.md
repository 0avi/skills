# Pipeline Design

The platform-neutral spine. Everything here predates GitHub Actions and will outlive it, which is why it is separated from the syntax.

The deployment pipeline as a concept comes from Humble and Farley's *Continuous Delivery*: an automated implementation of the path from commit to release, where each stage either increases confidence or fails fast. The vocabulary below is theirs; the specifics are current.

| Principle | Consequence for a pipeline |
| --------- | -------------------------- |
| **Build once, promote many** | Exactly one build stage produces the artifact. Nothing downstream rebuilds |
| **Fail fast, cheapest first** | Order stages by cost, not by importance |
| **Every stage runs on the same artifact** | The identity that moves between environments is a digest or version, never a branch name |
| **The pipeline is the only route to production** | A manual deploy path invalidates every guarantee the pipeline makes |
| **Optimise for feedback time** | A pipeline nobody waits for is a pipeline nobody trusts |

---

## Build once, promote many

This is the load-bearing rule, and the one most often broken by accident.

```
commit ──> BUILD ──> artifact@sha256:abc ──┬──> test    (same digest)
                                            ├──> staging (same digest)
                                            └──> prod    (same digest)
```

If staging deploys `myapp:staging` and production deploys `myapp:prod`, built from separate runs, then **production is running software that was never tested.** It may be identical. You cannot demonstrate that it is.

How it breaks in practice, all seen in real pipelines:

- A deploy job that runs `docker build` because it was easier than passing the digest along.
- Deploying by mutable tag (`:latest`, `:main`) so the thing behind the tag changes between stages.
- Rebuilding to inject environment configuration at build time, which produces one artifact per environment by construction.
- Cloudflare Containers with `image` pointing at a Dockerfile, so `wrangler deploy` rebuilds. See [target-cloudflare-containers.md](target-cloudflare-containers.md).

The test: **can you name the exact bytes running in production, and find the pipeline run that produced them?** If not, this rule is broken somewhere.

Configuration therefore cannot live in the artifact. It is injected at deploy time. See [environments-and-promotion.md](environments-and-promotion.md).

## Stage ordering

Order by **cost to run** against **probability of catching something**, cheapest first:

| Order | Stage | Typical duration | Why here |
| ----- | ----- | ---------------- | -------- |
| 1 | Lint, format, compile | seconds | Catches the most, costs the least |
| 2 | Unit tests | under 5 min | Fast, deterministic, high volume |
| 3 | **Build the artifact** | 1-5 min | Everything downstream consumes this |
| 4 | Integration and component tests | 5-15 min | Needs the artifact and real dependencies |
| 5 | Security and SBOM | 1-5 min | Can run parallel to 4 |
| 6 | Deploy to a pre-production environment | minutes | First real environment |
| 7 | Smoke and end-to-end tests | 5-20 min | Slowest, flakiest, fewest |
| 8 | Promote to production | minutes | Gated |

Stages 4 and 5 are independent and should run concurrently. So should independent test suites within a stage. The critical path is what matters, not total compute.

**The commit stage should finish in about ten minutes.** That figure is a widely repeated rule of thumb from the continuous delivery literature rather than a measured constant, and the reasoning is what matters: beyond roughly ten minutes developers stop waiting, start batching, and the feedback loop the pipeline exists to provide stops working.

## What CI owes CD

A clean handover has exactly three things:

1. **An immutable artifact identity.** A digest, a version id, a checksummed package.
2. **Evidence.** Test results, SBOM, provenance attestation, scan output - all keyed to that identity.
3. **A statement of what was and was not checked.** So a human approving a promotion knows what the approval means.

If CD has to re-derive any of these, the boundary is wrong.

## Gates, and their real cost

A gate is a claim that something was checked. Two failure modes, and the second is worse:

- **A gate too weak to catch anything** wastes build minutes and provides false confidence.
- **A gate everyone routinely bypasses** actively teaches the team that gates are obstacles rather than information. One habitually-overridden required check does more damage than no check.

So: block on things that are **deterministic and unambiguous** (compile, tests, a known-vulnerable dependency with a fix available), and **report** on things that are heuristic (coverage deltas, new lint categories, informational scanner findings). See [quality-gates.md](quality-gates.md).

## Fan-out and fan-in

Parallelism helps only where the work is genuinely independent and the fan-in is cheap.

```
        ┌── unit tests (shard 1..4) ──┐
build ──┼── integration tests ────────┼── fan-in ── deploy
        └── security scan + SBOM ─────┘
```

Two traps:

- **Fan-out that re-does shared setup.** Four jobs each spending three minutes restoring dependencies to save two minutes of tests is a net loss. Measure before sharding. See [caching.md](caching.md).
- **Fan-in that hides a failure.** If the aggregating job does not fail when a parallel job fails, the pipeline is green and wrong. On GitHub Actions in particular, `if: always()` on a summary job will report success unless it explicitly inspects the needed jobs' results.

## Pull request against main branch

They answer different questions and should not run the same thing:

| | Pull request | Main branch |
| --- | ------------ | ----------- |
| Question | "Is this change safe to merge?" | "Is main releasable?" |
| Scope | Changed code, fast suites, lint | Everything, including slow suites |
| Artifact | Usually not published | **Published and retained** |
| Secrets | **None for forks** | Available, environment-scoped |
| Duration budget | Minutes | Longer is tolerable |

Publishing artifacts from pull requests is usually a mistake: it fills the registry with things that will never be deployed, and on a fork PR it is a security problem.

## Idempotence and re-runnability

Any stage may run twice - a retry, a re-run, a duplicated webhook. Design for it:

- **Deploys should be idempotent.** Deploying the same digest twice is a no-op, not an error.
- **Version tags should be immutable.** A re-run that tries to overwrite `v1.2.3` should fail loudly, not silently replace a released artifact. See [artifacts-and-registries.md](artifacts-and-registries.md).
- **Migrations must be exactly-once by construction**, which is what a migration tool's version table provides. Never a hand-rolled `if` in a deploy script. See [database-migrations.md](database-migrations.md).

## Version notes

The principles are platform-neutral. What differs is the machinery:

| Concept | GitHub Actions | Azure DevOps | GitLab CI |
| ------- | -------------- | ------------ | --------- |
| Stage boundary | Job with `needs` | `stage` with `dependsOn` | `stage`, or `needs` for a DAG |
| Passing an artifact | `upload-artifact` / `download-artifact` | `publish` / `download` | `artifacts` / `dependencies` |
| Gate before production | Environment with reviewers | Environment approvals and checks | Protected environment plus manual job |
| Manual promotion | `workflow_dispatch` or environment approval | Manual stage | `when: manual` |

Full mapping in [platform-matrix.md](platform-matrix.md).

- **"Ten minute commit stage" is a heuristic**, repeated widely in the continuous delivery literature. Treat it as a target, not a measured threshold.
- **The four key delivery metrics** are the evidence base for why batch size and lead time matter; they come from the DORA research and are not re-derived here. See [dora-and-measurement.md](dora-and-measurement.md).
- **Not verified here:** nothing in this file is a measurement. It is design guidance, and the citations are named where they matter.

## Gotchas

- Agent adds a `docker build` to the deploy job - **breaks build-once-promote-many**; production then runs untested bytes
- Agent promotes by mutable tag - the thing behind `:latest` or `:main` can change between stages; promote a digest
- Agent injects environment configuration at build time - forces one artifact per environment, which is the same defect wearing a different hat
- Agent orders stages by importance rather than cost - a 20 minute end-to-end suite ahead of a 30 second compile wastes the feedback loop
- Agent parallelises without measuring - shared setup repeated across shards frequently costs more than it saves
- Agent writes a fan-in job that does not inspect the results of the jobs it needs - green pipeline, failed stage
- Agent runs the full suite on every pull request - slow feedback, and it still does not answer whether main is releasable
- Agent publishes artifacts from pull request builds - fills the registry with undeployable images, and is a security problem on forks
- Agent leaves a manual deploy path alongside the pipeline - every guarantee the pipeline makes is now unverifiable
- Agent assumes a stage runs exactly once - retries and re-runs happen; deploys must be idempotent and release tags immutable
- Agent treats "it passed CI" as a risk statement without saying what CI checks - the claim is only as strong as the gates

## Related

- [triage.md](triage.md) · [quality-gates.md](quality-gates.md) · [environments-and-promotion.md](environments-and-promotion.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [caching.md](caching.md) · [database-migrations.md](database-migrations.md) · [platform-matrix.md](platform-matrix.md) · [dora-and-measurement.md](dora-and-measurement.md) · [trunk-and-branching.md](trunk-and-branching.md) · [book-deltas.md](book-deltas.md)
