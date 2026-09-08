# Checklist

Every practice in one scannable list, for a pipeline review pass.

**Split on the axis that matters here:** Part A is safe to apply to any pipeline without knowing anything else about it. Part B changes behaviour in ways that depend on your traffic, your team, your risk appetite or your target, and applying it blind is how a pipeline acquires settings nobody chose.

---

## Part A: adopt anywhere

### Artifact identity and promotion

| # | Practice | Why | Reference |
| - | -------- | --- | --------- |
| A1 | **Build once; nothing downstream rebuilds** | Otherwise production runs untested bytes | [pipeline-design.md](pipeline-design.md) |
| A2 | **Promote a digest or version id, never a tag** | Tags move between stages | [artifacts-and-registries.md](artifacts-and-registries.md) |
| A3 | Never deploy `:latest` or a branch-named tag | No artifact identity at all | [artifacts-and-registries.md](artifacts-and-registries.md) |
| A4 | Configuration lives **outside** the artifact | Baking it in forces one artifact per environment | [environments-and-promotion.md](environments-and-promotion.md) |
| A5 | Reject overwriting a released tag in the registry | Makes every deployment record a fact | [artifacts-and-registries.md](artifacts-and-registries.md) |
| A6 | Label the artifact with the **commit SHA** | Artifact-to-source is the first step of every investigation | [versioning.md](versioning.md) |
| A7 | SBOM and attestations share the artifact's retention | Evidence detached from the artifact proves nothing | [sbom.md](sbom.md) |
| A8 | Deploys are **idempotent**; release tags immutable | Retries and re-runs happen | [pipeline-design.md](pipeline-design.md) |

### Security

| # | Practice | Why | Reference |
| - | -------- | --- | --------- |
| A9 | **Pin third-party actions to a commit SHA**, with a version comment | Tags are mutable references | [actions-security.md](actions-security.md) |
| A10 | Pair pinning with **automated bumping** | Pinning without it is staleness | [dependency-updates.md](dependency-updates.md) |
| A11 | **Declare `permissions` explicitly**, minimum at workflow level | The default is an org setting that can change | [actions-security.md](actions-security.md) |
| A12 | **Never interpolate untrusted input into a script** - pass via `env` | Remote code execution | [actions-security.md](actions-security.md) |
| A13 | Avoid `pull_request_target`; split into `pull_request` + `workflow_run` | Hands secrets to fork code | [actions-security.md](actions-security.md) |
| A14 | Secrets at **environment** scope, never organisation scope | Org secrets are readable everywhere | [oidc-and-secrets.md](oidc-and-secrets.md) |
| A15 | Bind an OIDC trust policy with `StringEquals` on the **narrowest** claim | A wildcard is an org-wide grant to production | [oidc-and-secrets.md](oidc-and-secrets.md) |
| A16 | Never attach a self-hosted runner to a public repository | Fork PRs execute on your infrastructure | [runners.md](runners.md) |
| A17 | Self-hosted runners are **ephemeral**, one job each | Persistent runners accumulate credentials and caches | [runners.md](runners.md) |
| A18 | Secret leak response: **revoke first**, investigate second | Rewriting history is not remediation | [oidc-and-secrets.md](oidc-and-secrets.md) |
| A19 | Container runs as a **non-root** user | One escape from host root | [containers.md](containers.md) |
| A20 | Secrets via `--mount=type=secret`, never `COPY` then delete | It remains in the earlier layer forever | [containers.md](containers.md) |
| A21 | Secret scanning **with push protection** | Stops the secret entering history | [scanning.md](scanning.md) |
| A22 | `persist-credentials: false` where no push is needed | Token otherwise stays in `.git/config` | [actions-security.md](actions-security.md) |

### Build

| # | Practice | Why | Reference |
| - | -------- | --- | --------- |
| A23 | Set `project.build.outputTimestamp` (or the Gradle equivalent) | **Measured: builds differ without it** | [java-build.md](java-build.md) |
| A24 | **Verify reproducibility** - build twice, diff the hashes | Three lines; otherwise A1 is asserted, not checked | [java-build.md](java-build.md) |
| A25 | Pin the JDK **version and distribution** | Vendors' builds are not byte-equivalent | [java-build.md](java-build.md) |
| A26 | `mvn verify`, not `mvn test` | `test` skips integration tests and packaging | [java-build.md](java-build.md) |
| A27 | Ban dynamic versions and ranges | The build resolves differently on different days | [java-build.md](java-build.md) |
| A28 | `npm ci`, never `npm install` | `install` can ignore the lockfile and rewrite it | [frontend-build.md](frontend-build.md) |
| A29 | Pin the Node major explicitly | The runner image rolls | [frontend-build.md](frontend-build.md) |
| A30 | Multi-stage build; runtime image has no compiler or source | Smaller, and cannot be used to build | [containers.md](containers.md) |
| A31 | Copy dependency manifests **before** source | Otherwise every commit invalidates the costliest layer | [containers.md](containers.md) |
| A32 | Pin the **base image by digest** | Reproducibility, and upstream cannot change under you | [containers.md](containers.md) |
| A33 | `.dockerignore` covering `.git`, build output, `node_modules` | Context bloat and layer invalidation | [containers.md](containers.md) |

### Caching

| # | Practice | Why | Reference |
| - | -------- | --- | --------- |
| A34 | Never use a cache to pass build output between jobs | Caches are evicted without notice | [caching.md](caching.md) |
| A35 | Key caches on **dependency manifests**, and include the OS | Otherwise never invalidates, or never hits | [caching.md](caching.md) |
| A36 | Include `restore-keys` prefix fallback | Where most of the benefit lives | [caching.md](caching.md) |
| A37 | Cache `~/.npm`, **never `node_modules`** | Platform-specific native modules | [frontend-build.md](frontend-build.md) |
| A38 | Never cache `SNAPSHOT` or other mutable versions | Pins an arbitrary past build, invisibly | [java-build.md](java-build.md) |
| A39 | Restore caches on PRs; **save only on the default branch** | Cache poisoning from fork PRs | [caching.md](caching.md) |

### Test

| # | Practice | Why | Reference |
| - | -------- | --- | --------- |
| A40 | Real dependencies via Testcontainers; **never H2 for PostgreSQL** | Different dialect, and migrations do not run | [testing-in-ci.md](testing-in-ci.md) |
| A41 | Pin test container image versions | The test environment otherwise drifts | [testing-in-ci.md](testing-in-ci.md) |
| A42 | One container per suite, isolate **within** it | Startup otherwise dominates | [testing-in-ci.md](testing-in-ci.md) |
| A43 | Isolate shared state **before** sharding | Sharding shared state creates flake | [testing-in-ci.md](testing-in-ci.md) |
| A44 | Publish test results as an artifact with **`if: always()`** | Otherwise missing exactly when the job failed | [testing-in-ci.md](testing-in-ci.md) |
| A45 | Inject a `Clock`; never `Instant.now()` in code under test | The most common flake source | [flaky-tests.md](flaky-tests.md) |
| A46 | Randomise test order in CI | Surfaces order dependencies immediately | [flaky-tests.md](flaky-tests.md) |
| A47 | Await conditions; never `Thread.sleep` for async work | A race with a margin that CI removes | [flaky-tests.md](flaky-tests.md) |
| A48 | End-to-end tests run **after deploy**, not against a dev server | Otherwise they test something you will not ship | [testing-in-ci.md](testing-in-ci.md) |

### Gates and pipeline shape

| # | Practice | Why | Reference |
| - | -------- | --- | --------- |
| A49 | Order stages **cheapest first** | Feedback time is the point | [pipeline-design.md](pipeline-design.md) |
| A50 | Block on the deterministic; **report** the heuristic | An overridden gate is corrosive | [quality-gates.md](quality-gates.md) |
| A51 | Never block on a vulnerability with **no available fix** | The gate gets disabled within a week | [quality-gates.md](quality-gates.md) |
| A52 | A fan-in job must **inspect the results** of jobs it needs | Otherwise green pipeline, failed stage | [pipeline-design.md](pipeline-design.md) |
| A53 | A check in a pre-commit hook is **not** a gate | Hooks are local and skippable | [quality-gates.md](quality-gates.md) |
| A54 | Add a **destructive-migration acknowledgement** gate | Catches the one-step `DROP` past review fatigue | [database-migrations.md](database-migrations.md) |
| A55 | The pipeline is the **only** route to production | A manual path voids every guarantee | [pipeline-design.md](pipeline-design.md) |
| A56 | Do not publish artifacts from pull request builds | Registry noise, and a fork security problem | [pipeline-design.md](pipeline-design.md) |

### Deploy

| # | Practice | Why | Reference |
| - | -------- | --- | --------- |
| A57 | **Wait for rollout completion** and fail on timeout | Otherwise success is reported before anything is healthy | [target-kubernetes.md](target-kubernetes.md) |
| A58 | **Serialise deploys** per environment | Concurrent deploys race, arbitrarily | [environments-and-promotion.md](environments-and-promotion.md) |
| A59 | Never `cancel-in-progress` on a deploy | Leaves the target in an unknown state | [github-actions.md](github-actions.md) |
| A60 | **Readiness check** that fails until the instance can serve | The commonest cause of "deploy worked, users saw errors" | [target-kubernetes.md](target-kubernetes.md) |
| A61 | Liveness checks the **process only**, never a dependency | A database blip otherwise restarts everything | [target-kubernetes.md](target-kubernetes.md) |
| A62 | Handle **`SIGTERM`** and drain; grace period > longest request | Otherwise every rollout drops requests | [deployment-strategies.md](deployment-strategies.md) |
| A63 | **Expand-only migrations**, always | Every zero-downtime strategy runs two versions | [database-migrations.md](database-migrations.md) |
| A64 | Migrations in a **dedicated step**, never from app startup | Racing instances, crash loops, standing DDL rights | [database-migrations.md](database-migrations.md) |
| A65 | Breaking schema change takes **two deployments minimum** | Preserves a rollback window | [database-migrations.md](database-migrations.md) |
| A66 | Never claim a `down` migration reverses a backfill | A lie that gets trusted during an incident | [database-migrations.md](database-migrations.md) |
| A67 | Upload hashed assets **before** the entry point | Otherwise a window of broken page loads | [frontend-build.md](frontend-build.md) |
| A68 | Verify signatures **where the artifact is consumed** | Verifying in the build proves nothing | [provenance-and-signing.md](provenance-and-signing.md) |
| A69 | `cosign verify` with `--certificate-identity-regexp` | Without it, any Sigstore identity is accepted | [provenance-and-signing.md](provenance-and-signing.md) |
| A70 | Test the **negative case** of any verification step | An untested verify is unverified | [provenance-and-signing.md](provenance-and-signing.md) |

### Hygiene

| # | Practice | Why | Reference |
| - | -------- | --- | --------- |
| A71 | Turn on GC logging of the pipeline: durations, queue time, flake rate | You cannot tune what you do not measure | [dora-and-measurement.md](dora-and-measurement.md) |
| A72 | Configuration under version control, applied by the pipeline | Portal edits have no diff, review or revert | [environments-and-promotion.md](environments-and-promotion.md) |
| A73 | Fail fast on missing configuration at startup | A null connection string fails later and worse | [environments-and-promotion.md](environments-and-promotion.md) |
| A74 | Annotated, protected, **immutable** release tags | A moved tag makes records guesses | [versioning.md](versioning.md) |
| A75 | Retention ≥ the rollback window you promise | Otherwise the rollback target is collected | [rollback.md](rollback.md) |
| A76 | Route base-image findings to the **base image** | The app team cannot fix them | [scanning.md](scanning.md) |
| A77 | Feed the scanner your **SBOM** rather than re-resolving | Otherwise the scan describes something else | [sbom.md](sbom.md) |
| A78 | Emit SBOM formats with an **explicit version** | Defaults lag the standards. Measured | [sbom.md](sbom.md) |

---

## Part B: depends on your context

**A finding here is not actionable without the stated input.** If you do not have it, say what to gather rather than what to change.

| # | Change | What you need first | Reference |
| - | ------ | ------------------- | --------- |
| B1 | Adding or tuning a cache | **The current hit rate**, and a with/without duration comparison | [caching.md](caching.md) |
| B2 | Registry-backed container build cache | Measured build time against cache transfer time | [containers.md](containers.md) |
| B3 | Sharding a test suite | Per-shard fixed cost against tests saved, on the critical path | [testing-in-ci.md](testing-in-ci.md) |
| B4 | Parallel Maven modules (`-T`) | Whether every plugin in the build is thread-safe | [java-build.md](java-build.md) |
| B5 | Larger runners | Whether the build is CPU-bound or I/O-bound | [runners.md](runners.md) |
| B6 | Self-hosted runners | A private-network, hardware or licensing need, **and** an ephemeral design | [runners.md](runners.md) |
| B7 | Coverage threshold | Current coverage, and a decision to ratchet deliberately | [quality-gates.md](quality-gates.md) |
| B8 | Bundle budget ceiling | Current size, plus headroom for normal growth | [frontend-build.md](frontend-build.md) |
| B9 | Automerge policy | A suite that would catch a break, with a low flake rate | [dependency-updates.md](dependency-updates.md) |
| B10 | `minimumReleaseAge` window | Your appetite for a compromised upstream publish | [dependency-updates.md](dependency-updates.md) |
| B11 | Blocking on a scanner finding | Whether it is **fixable**, reachable, and in a runtime dependency | [scanning.md](scanning.md) |
| B12 | SAST adoption | A baseline of existing findings, or adoption is impossible | [scanning.md](scanning.md) |
| B13 | Choosing a deployment strategy | Traffic volume, capacity headroom, and a metric to judge a canary | [deployment-strategies.md](deployment-strategies.md) |
| B14 | Canary percentages and bake time | Enough traffic for signal, and an alarm that fires | [deployment-strategies.md](deployment-strategies.md) |
| B15 | `maxSurge` / `maxUnavailable` | Whether spare capacity exists during a rollout | [target-kubernetes.md](target-kubernetes.md) |
| B16 | `revisionHistoryLimit` | The rollback window you intend to promise | [rollback.md](rollback.md) |
| B17 | Grace periods and drain windows | The **longest legitimate request** duration | [deployment-strategies.md](deployment-strategies.md) |
| B18 | `healthCheckGracePeriodSeconds` (ECS) | Measured application startup time | [target-aws.md](target-aws.md) |
| B19 | Container Apps scale-to-zero | Latency tolerance for a cold start | [target-azure.md](target-azure.md) |
| B20 | Cloudflare `instance_type` | Actual memory and CPU needs; the default is smallest | [target-cloudflare-containers.md](target-cloudflare-containers.md) |
| B21 | Cloudflare `rollout_step_percentage` | Worker-to-container interface compatibility during skew | [target-cloudflare-containers.md](target-cloudflare-containers.md) |
| B22 | Slot-specific settings (App Service) | Which settings distinguish environments. **Get this wrong and staging's DB swaps into production** | [target-azure.md](target-azure.md) |
| B23 | Distroless or Alpine base | A debugging plan, and native-dependency compatibility | [containers.md](containers.md) |
| B24 | Buildpacks against a Dockerfile | Whether rebase matters more than transparency | [containers.md](containers.md) |
| B25 | Number of environments | A question each one answers that the others cannot | [environments-and-promotion.md](environments-and-promotion.md) |
| B26 | Production data in a lower environment | Masking, and production-equivalent access controls | [environments-and-promotion.md](environments-and-promotion.md) |
| B27 | Versioning scheme | Whether anyone resolves a dependency range against you | [versioning.md](versioning.md) |
| B28 | Monorepo per-package versioning | Change detection and a dependency-graph-aware tool | [versioning.md](versioning.md) |
| B29 | A test retry policy | Confirmation it is flake, and visible retry counts | [flaky-tests.md](flaky-tests.md) |
| B30 | Quarantining a test | An **owner and a deadline**, or it is deletion in disguise | [flaky-tests.md](flaky-tests.md) |
| B31 | A release branch | Genuinely supporting multiple production versions | [trunk-and-branching.md](trunk-and-branching.md) |
| B32 | Feature flag adoption | Per-flag owner and removal date | [trunk-and-branching.md](trunk-and-branching.md) |
| B33 | GitOps | Acceptance that deployment becomes asynchronous, and sync polling | [target-kubernetes.md](target-kubernetes.md) |
| B34 | Pinning `ubuntu-24.04` over `ubuntu-latest` | A deliberate schedule for the OS upgrade | [runners.md](runners.md) |
| B35 | Air-gapped `cosign` signing | Real time budgeted; **v3 broke the v2 recipes** | [provenance-and-signing.md](provenance-and-signing.md) |

---

## Top five

1. **Build once and promote a digest.** Everything else in this file is downstream of it. If the deploy rebuilds, nothing CI proved applies.
2. **Pin actions to SHAs and automate the bumps.** The cheapest real supply-chain control, and worthless if it becomes staleness.
3. **Expand-only migrations, two deployments for a breaking change.** This is what makes rollback possible at all, and it is where teams actually break production.
4. **Federate identity instead of storing cloud keys.** There is then nothing to leak or rotate. Bind the trust policy to an environment, not a wildcard.
5. **Readiness checks and `SIGTERM` handling.** Two small things that decide whether every rollout drops requests, and both get blamed on the deployment tool.

**And the meta-rule: a pipeline is a claim about risk.** State what each gate proves. "It passed CI" is worth exactly as much as the gates in CI, and no more.

## Version notes

| Rules | Need |
| ----- | ---- |
| Most of Part A | Any platform |
| A9-A13, A22, A59 | GitHub Actions specifics; see [platform-matrix.md](platform-matrix.md) for equivalents |
| A15 | OIDC federation - **not available on Cloudflare** |
| A23 | Maven 3.6.1+ for `project.build.outputTimestamp` |
| A69, B35 | cosign; **v3 changed the CLI incompatibly** |
| A78 | syft 1.51.1 behaviour as measured |
| B20-B21 | Cloudflare Containers |
| B22 | Azure App Service slots |

- **A57-A70 are one review pass**, not seventy separate changes: they are the deploy stage read once, carefully.
- **Part B is not optional work.** It is work that needs an input first.

## Gotchas

- Agent applies Part B blind - these change behaviour in ways that depend on traffic, capacity and risk appetite
- Agent counts Part A as 78 separate tasks - several are one decision; A57 to A70 is a single careful read of the deploy stage
- Agent treats this checklist as complete for a platform it has not named - the platform files carry the specifics
- Agent quotes a Part A rule without its reference - the reason matters more than the rule when someone pushes back
- Agent skips A24 because A23 is set - the verification is what turns the claim into a fact

## Related

- [pipeline-design.md](pipeline-design.md) · [triage.md](triage.md) · [actions-security.md](actions-security.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [database-migrations.md](database-migrations.md) · [quality-gates.md](quality-gates.md) · [platform-versions.md](platform-versions.md) · [book-deltas.md](book-deltas.md)
