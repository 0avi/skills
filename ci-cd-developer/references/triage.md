# Triage

Start here when there is a symptom. Each branch routes from what was observed to the measurement that identifies the cause, and only then to the fix.

**Collect these before changing anything.** All are cheap and all are gone once you start editing the workflow:

```
1. The failing run's full log, not the summary          (platform UI, or `gh run view --log`)
2. Per-job and per-step durations                       (which stage, not which pipeline)
3. Whether it fails consistently or intermittently      (re-run once, same commit)
4. Whether it fails on a fork PR, a branch, or main     (permissions differ by trigger)
5. What changed: the workflow, a dependency, the runner image, or nothing
```

That last one matters more than people expect. **A pipeline that broke with no commit to the pipeline usually means the runner image, a floating action tag, or an upstream dependency moved.** See [platform-versions.md](platform-versions.md).

---

## Branch A: the pipeline is slow

Measure the **critical path**, not total compute. A 40 minute pipeline with four 10 minute parallel jobs is a 10 minute pipeline.

| Reading | Likely cause | Go to |
| ------- | ------------ | ----- |
| One stage dominates | Genuine work, or a missing cache | [caching.md](caching.md) |
| Every job spends minutes before real work | Dependency restore, or no cache hit | [caching.md](caching.md) |
| Total is fine, wall clock is bad | Serialised stages that could be parallel | [pipeline-design.md](pipeline-design.md) |
| Queue time, not run time | Runner contention or concurrency limits | [runners.md](runners.md) |
| Slower only on main | Full suite on main is expected; check it is deliberate | [pipeline-design.md](pipeline-design.md) |
| Container build dominates | Layer cache missing or ordered wrongly | [containers.md](containers.md) |

**Check the cache hit rate before tuning cache keys.** A cache that never hits and a cache that always hits look identical in the workflow file and completely different in the log. A cache that is restored and then invalidated wastes the restore time twice over.

## Branch B: tests fail intermittently

Re-run the **same commit**. If it passes, it is flake, and flake is a policy problem before it is a technical one.

| Reading | Likely cause | Go to |
| ------- | ------------ | ----- |
| Passes on re-run, no code change | Flake | [flaky-tests.md](flaky-tests.md) |
| Fails only under parallelism | Shared fixture, port, or database state | [testing-in-ci.md](testing-in-ci.md) |
| Fails only in CI, never locally | Timezone, locale, file ordering, or CPU count | [testing-in-ci.md](testing-in-ci.md) |
| Fails at a consistent time of day | External dependency or scheduled job | [testing-in-ci.md](testing-in-ci.md) |
| Timeouts under load | Fixed sleeps rather than waits | [flaky-tests.md](flaky-tests.md) |

**Never add a blanket retry as the first move.** Retrying until green converts a known failure into an unknown risk, and it hides the one real defect among the noise. See [flaky-tests.md](flaky-tests.md).

## Branch C: the build is not reproducible

Two builds of the same commit produce different bytes.

| Reading | Likely cause |
| ------- | ------------ |
| Jar or archive differs, contents identical | **Embedded timestamps.** For Maven, `project.build.outputTimestamp` |
| Different dependency versions resolved | A floating version range, or no lockfile |
| Container image digest differs | Build-time timestamps, or `ADD`/`COPY` of a changing file |
| Differs only across runners | Toolchain version drift between images |

**Measured on this machine**, a Maven project built twice: with `project.build.outputTimestamp` set, both builds produced sha256 `899c9ecf90f4f25b...`; with the property removed, the same two builds produced `26df17eb...` and `a2a0f50f...`. The mtimes differed in both cases, confirming genuine rebuilds rather than a cached artifact. See [java-build.md](java-build.md).

## Branch D: the deploy failed

First question: **did it fail before or after traffic moved?** They are different incidents.

| Reading | Likely cause | Go to |
| ------- | ------------ | ----- |
| Failed before any traffic shift | Credentials, image pull, or manifest invalid | [oidc-and-secrets.md](oidc-and-secrets.md) |
| Image pull failure | Digest not present in the target registry, or no pull credential | [artifacts-and-registries.md](artifacts-and-registries.md) |
| Health checks fail on new instances | Configuration missing for this environment | [environments-and-promotion.md](environments-and-promotion.md) |
| Some requests fail during rollout | **Two versions running with an incompatible change** | [database-migrations.md](database-migrations.md) |
| Deploy succeeded, application broken | Config or a migration, not the deploy | [environments-and-promotion.md](environments-and-promotion.md) |
| Credentials error only on a fork PR | Expected. Forks get no secrets | [actions-security.md](actions-security.md) |

**"Some requests fail during the rollout" is almost always a compatibility problem, not a deployment problem.** Every zero-downtime strategy runs two versions at once. See [deployment-strategies.md](deployment-strategies.md).

## Branch E: a rollback is stuck or made things worse

| Reading | Cause |
| ------- | ----- |
| Code rolled back, application still broken | **A migration ran.** The old code is meeting a new schema |
| Cannot find the previous artifact | Mutable tags, or retention expired |
| Rollback deployed but data is wrong | A backfill is not reversible |
| Cloudflare: previous version unavailable | Only the **last 100 uploaded versions** are eligible |

This branch usually means the schema was not kept backwards compatible. There is no deployment-tool fix; go to [rollback.md](rollback.md) and [database-migrations.md](database-migrations.md).

## Branch F: a secret leaked

In this order, and do not reorder:

1. **Revoke the credential.** Immediately, before investigating.
2. **Establish the blast radius.** What else could it reach?
3. **Check whether it was used.** Cloud audit logs, not CI logs.
4. **Then** clean up the source and enable push protection.

**Rewriting git history is not remediation.** Any fork or clone retains it. Revocation is the only remedy. See [oidc-and-secrets.md](oidc-and-secrets.md).

## Branch G: it passes CI and breaks in production

The pipeline is making a claim it cannot support. Work out which:

| Difference | Fix |
| ---------- | --- |
| Different artifact than tested | **Build-once-promote-many is broken.** [pipeline-design.md](pipeline-design.md) |
| Different configuration | Config is not under the same review as code. [environments-and-promotion.md](environments-and-promotion.md) |
| Different data volume or shape | Test environment is not representative |
| Different dependency versions | No lockfile, or the deploy resolved fresh |
| A gate that only reported | [quality-gates.md](quality-gates.md) |
| A manual step outside the pipeline | Every guarantee is void. [pipeline-design.md](pipeline-design.md) |

**The first row is the one to check first**, because it invalidates everything else. If the deploy rebuilt, nothing that CI proved applies.

## Branch H: a third-party action or dependency broke the pipeline

| Reading | Cause |
| ------- | ----- |
| Nothing changed in the repository | A floating tag moved, or the runner image updated |
| Fails only for new runs of an old commit | Same, and this is the diagnostic: re-running an old green commit that now fails proves the change is external |
| An action behaves differently with no version change | The tag was moved under you. **Pin to a SHA** |

**Re-running a previously green commit is the cheapest way to separate "our change" from "the world changed".** See [actions-security.md](actions-security.md) and [dependency-updates.md](dependency-updates.md).

## Version notes

- **Log retention is finite** on all three platforms, and shorter than most incident reviews. Export the log before it expires.
- **Runner images update continuously.** A pipeline green on Friday and red on Monday with no commits is usually a runner image roll. Check [platform-versions.md](platform-versions.md).
- **`act` reproduces much of GitHub Actions locally** but not `GITHUB_TOKEN` permissions, OIDC, environments or hosted-runner tooling. Useful for logic, not for auth. Verified present here at 0.2.89.
- **Not verified here:** every hosted-runner and cloud-specific behaviour. This file is a routing table, and the measurements it cites are marked at the point of use.

## Gotchas

- Agent edits the workflow before reading the log - the log names the failing step, and editing destroys the evidence
- Agent optimises total compute rather than the critical path - four parallel 10 minute jobs are a 10 minute pipeline
- Agent tunes cache keys without checking the hit rate - a cache that never hits and one that always hits look identical in the YAML
- Agent adds a retry to a flaky test as the first response - converts a known failure into unknown risk
- Agent treats "fails during rollout" as a deploy bug - it is a two-version compatibility problem
- Agent tries to fix a stuck rollback with the deployment tool - if a migration ran, the tool cannot help
- Agent investigates a leaked secret before revoking it - revoke first
- Agent rewrites history after a leak and calls it fixed - clones and forks retain it
- Agent assumes a pipeline that broke with no commits must be their fault - re-run an old green commit to prove it was external
- Agent debugs a fork PR credentials failure as misconfiguration - forks correctly receive no secrets
- Agent skips checking whether the deploy rebuilt the artifact - that single question invalidates every other line of enquiry

## Related

- [pipeline-design.md](pipeline-design.md) · [caching.md](caching.md) · [flaky-tests.md](flaky-tests.md) · [testing-in-ci.md](testing-in-ci.md) · [java-build.md](java-build.md) · [rollback.md](rollback.md) · [database-migrations.md](database-migrations.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [actions-security.md](actions-security.md) · [platform-versions.md](platform-versions.md) · [checklist.md](checklist.md)
