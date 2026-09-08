# Caching

The most commonly misconfigured part of a pipeline, and the one where intuition is least reliable: **caching can make a pipeline slower**, and it usually does so silently.

| Question | Answer |
| -------- | ------ |
| What is safe to cache? | Anything **immutable and reconstructible**: released dependencies, tool downloads |
| What is never safe? | Build output, `SNAPSHOT` dependencies, anything you will deploy |
| How do I know it works? | **Read the hit rate in the log.** A miss and a hit look identical in YAML |
| When does it lose? | Small caches, fast networks, and caches that are restored then invalidated |
| Cache or artifact? | Cache = optimisation you can lose. Artifact = output you cannot |

---

## Cache against artifact

Getting this distinction wrong is the root of several pipeline defects:

| | Cache | Artifact |
| --- | ----- | -------- |
| Purpose | Speed | **Transport and retention** |
| If lost | The job is slower | **The pipeline is broken** |
| Lifetime | Evicted at will by the platform | Explicit retention |
| Correct contents | Dependencies, tool installs | The deployable, test reports, SBOM |

**Never use a cache to pass build output between jobs.** Caches are evicted without notice and may be scoped per branch; a job that depends on a cache being present is a job that fails intermittently for reasons that look unrelated. Use the artifact mechanism. See [platform-matrix.md](platform-matrix.md).

## Key design

A cache key must change **exactly when the contents should change**, and not otherwise.

```yaml
- uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9  # v6.1.0
  with:
    path: ~/.m2/repository
    key: maven-${{ runner.os }}-${{ hashFiles('**/pom.xml') }}
    restore-keys: |
      maven-${{ runner.os }}-
```

Three parts, each load-bearing:

- **`hashFiles` over the dependency manifests.** Not over source files, which change constantly and would evict the cache every commit.
- **The OS in the key.** A cache built on Linux is not valid on Windows, and restoring it produces confusing native-library failures.
- **`restore-keys` as a prefix fallback.** On a manifest change you get the previous cache and download only the delta, instead of starting cold. This is the part most often omitted, and it is where most of the benefit lives.

**A key with no `hashFiles` component never invalidates**, so it goes stale and eventually serves a wrong dependency set. A key that includes `github.sha` never hits. Both are common.

## Read the hit rate

The decisive question is whether the cache is hit, and it is visible in the log on every platform: GitHub logs "Cache restored from key" or "Cache not found for input keys". If you have not read that line, you do not know whether your cache works.

Three failure patterns worth naming:

1. **Never hits.** Usually a key containing something per-run. Cost: the save time, every run, for nothing.
2. **Always hits and never updates.** A key with no manifest hash. Cost: correctness, eventually.
3. **Restored, then invalidated.** The cache is restored and the build then re-resolves anyway because a lockfile changed. Cost: paid twice.

The third is the subtle one, and it is why `npm ci` with a cached `~/.npm` behaves differently from a cached `node_modules`.

## When caching loses

| Situation | Why |
| --------- | --- |
| Small dependency set | Restore and save overhead exceeds the download |
| Very fast artifact proxy or mirror | Downloading is already cheap |
| Cache larger than a few hundred MB | Transfer and decompression dominate |
| Highly variable dependency sets | Constant invalidation, so constant re-save |
| Registry-backed container build cache on a small image | Push and pull can exceed the build. See [containers.md](containers.md) |

**The honest test is to disable it and compare.** Two runs with and without, comparing critical-path duration, settles it in ten minutes and prevents an argument.

## What to cache per ecosystem

| Ecosystem | Cache this | Key on | Never cache |
| --------- | ---------- | ------ | ----------- |
| Maven | `~/.m2/repository` | `**/pom.xml` | `target/`, `SNAPSHOT`s |
| Gradle | `~/.gradle/caches`, `~/.gradle/wrapper` | build scripts + lockfiles | `build/` |
| npm | `~/.npm` | `package-lock.json` | `node_modules` (prefer `npm ci`) |
| Docker | BuildKit layer cache | Dockerfile + manifests | - |

**`node_modules` is a trap.** It contains platform-specific compiled native modules and postinstall output; restoring it across runner images or Node versions produces failures that look like application bugs. Cache the download directory and let `npm ci` install. See [frontend-build.md](frontend-build.md).

**Never cache `SNAPSHOT` or other mutable versions.** They are mutable by definition, so the cache pins an arbitrary past build and the resulting failure is invisible. See [java-build.md](java-build.md).

## Cache poisoning

A cache is **shared mutable state that a job can write**. On a public repository, a workflow triggered by a fork pull request that can write the cache can poison what later runs restore.

- **Scope write access to trusted triggers.** Restore on pull requests, save only on the default branch.
- **Never cache anything executable that the build will run** without integrity checking. A poisoned `node_modules` or `~/.m2` executes attacker code.
- **Include a version prefix** (`maven-v2-…`) so you can invalidate an entire cache generation deliberately after an incident.

Cache scoping rules differ by platform: on GitHub, a cache created on a branch is visible to that branch and its descendants and to the default branch, which is the rule to reason about for fork safety. See [actions-security.md](actions-security.md).

## Version notes

| | Notes |
| --- | ----- |
| `actions/cache` | **v6.1.0**, `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| `setup-java`, `setup-node` | Both have built-in `cache:` inputs; prefer them over hand-rolled `actions/cache` |
| Azure DevOps | `Cache@2`, keyed similarly |
| GitLab | `cache:` with `key:files:` for the same effect |

- **Prefer the setup action's built-in caching** where it exists. It gets the paths and keys right, which is where hand-rolled caches go wrong.
- **Cache size and retention limits are platform and plan dependent**, and eviction is not announced. Never depend on presence.
- **Not verified here:** cache hit rates and eviction behaviour need a hosted runner over time. Cited from platform documentation.

## Gotchas

- Agent uses a cache to pass build output between jobs - caches are evicted without notice; use an artifact
- Agent writes a key with no `hashFiles` component - never invalidates, and eventually serves a wrong dependency set
- Agent includes `github.sha` in the key - never hits, so the cache costs save time and returns nothing
- Agent omits `restore-keys` - every manifest change starts completely cold, discarding most of the benefit
- Agent leaves the OS out of the key - a Linux cache restored on Windows produces baffling native failures
- Agent caches `node_modules` - platform-specific native modules break across images and Node versions
- Agent caches `SNAPSHOT` dependencies - mutable by definition; the cache pins an arbitrary past build
- Agent adds caching without measuring - it can be slower, and for small dependency sets frequently is
- Agent never reads the hit-rate line in the log - a hit and a miss are indistinguishable in the workflow file
- Agent lets fork pull requests write the shared cache - cache poisoning, and the cache contents get executed
- Agent has no way to invalidate a whole cache generation - include a version prefix in the key
- Agent enables a registry container build cache on a small image without measuring - transfer can exceed the build

## Related

- [pipeline-design.md](pipeline-design.md) · [java-build.md](java-build.md) · [frontend-build.md](frontend-build.md) · [containers.md](containers.md) · [triage.md](triage.md) · [actions-security.md](actions-security.md) · [platform-matrix.md](platform-matrix.md) · [runners.md](runners.md) · [checklist.md](checklist.md)
