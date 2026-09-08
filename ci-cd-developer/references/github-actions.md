# GitHub Actions

Syntax and semantics. The security half is separate and larger: read [actions-security.md](actions-security.md) alongside this, because the two most damaging defects in a workflow (unpinned actions, interpolated untrusted input) are covered there.

| Question | Answer |
| -------- | ------ |
| Reusable workflow or composite action? | **Reusable workflow** for a whole job, **composite action** for a sequence of steps inside someone else's job |
| Where do secrets belong? | **Environment** secrets, with required reviewers on production |
| How do I pass a value between jobs? | Job `outputs` plus `needs.<job>.outputs`. Files need `upload-artifact` |
| How do I stop concurrent deploys? | `concurrency` with a fixed group name |
| Can I test locally? | Partly, with `act`. Logic yes; tokens, OIDC and environments no |

---

## Shape

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read                  # workflow-level floor

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true        # supersede stale runs on the same ref

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      digest: ${{ steps.push.outputs.digest }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-java@dd06d9cba3e5552c54d9f8ea23572deb30010f7c  # v6.0.0
        with:
          java-version: '25'
          distribution: temurin
          cache: maven
      - run: mvn -B verify
      - id: push
        run: echo "digest=sha256:..." >> "$GITHUB_OUTPUT"

  deploy:
    needs: build
    environment: production       # approval gate + scoped secrets live here
    permissions:
      contents: read
      id-token: write             # OIDC, no stored cloud key
    steps:
      - run: echo "deploying ${{ needs.build.outputs.digest }}"
```

Every element of that is load-bearing: pinned SHAs with version comments, an explicit `permissions` floor, `concurrency` to cancel superseded runs, a digest passed forward rather than rebuilt, and `id-token: write` only on the job that federates.

## `cancel-in-progress`, and where not to use it

`cancel-in-progress: true` is right for CI on a branch: a newer commit supersedes an older one and cancelling saves minutes.

**It is wrong for deploys.** Cancelling a deployment part-way leaves the target in an unknown state. For a deploy, serialise without cancelling:

```yaml
concurrency:
  group: deploy-production        # no ref: one queue for the environment
  cancel-in-progress: false
```

## Reusable workflows against composite actions

| | Reusable workflow | Composite action |
| --- | ----------------- | ---------------- |
| Called with | `uses:` at **job** level | `uses:` at **step** level |
| Runs as | Its own job, own runner | Steps inside the caller's job |
| Secrets | Explicit `secrets:` contract, or `secrets: inherit` | Inherits the caller's environment |
| Own `permissions` | **Yes** | No, uses the caller's |
| SLSA relevance | **Supplies Build L3 on GitHub** | No |
| Use for | A whole build or deploy job shared across repositories | A repeated 3-step sequence |

```yaml
# caller
jobs:
  build:
    uses: myorg/.github/.github/workflows/build.yml@<sha>
    with: { java-version: '25' }
    secrets: inherit              # prefer naming specific secrets over inherit
```

`secrets: inherit` is convenient and hands every secret to the callee. Name the secrets explicitly for anything shared beyond your own repository.

**The reusable workflow is the mechanism behind GitHub's SLSA Build Level 3 claim**, because the caller cannot alter the trusted steps. See [provenance-and-signing.md](provenance-and-signing.md).

## Matrices

```yaml
strategy:
  fail-fast: false               # let every combination report
  matrix:
    java: ['21', '25']
    os: [ubuntu-latest, windows-latest]
    exclude:
      - { os: windows-latest, java: '21' }
```

`fail-fast: true` (the default) cancels the whole matrix on the first failure. That is right when you want a fast signal and wrong when you want to know **which** combinations fail. For a compatibility matrix set it to `false`.

## Passing things between jobs

| What | How |
| ---- | --- |
| A string | `echo "k=v" >> "$GITHUB_OUTPUT"`, then `needs.<job>.outputs.k` |
| A file | `actions/upload-artifact` then `actions/download-artifact` |
| An image | Push to a registry; pass the **digest** as an output |
| A secret | Do not. Fetch it in the job that needs it |

**Jobs do not share a filesystem.** Each runs on a fresh runner. A step writing to `./target` in one job leaves nothing for the next.

`$GITHUB_OUTPUT` supersedes the deprecated `::set-output::` workflow command, which still appears in older material.

## Environments

An environment is the right place for three things at once:

```yaml
jobs:
  deploy:
    environment:
      name: production
      url: https://app.example.com
```

- **Scoped secrets** - only jobs targeting this environment can read them.
- **Required reviewers** - the approval gate.
- **Deployment branch rules** - only `main` may deploy to production.

It also makes the OIDC subject claim carry `environment:production`, which is what lets a cloud trust policy bind to it. That combination is the actual production control. See [oidc-and-secrets.md](oidc-and-secrets.md).

## Local execution with `act`, and its limits

**Verified on this machine with act 0.2.89 and Docker 29.7.2.** A two-step workflow parsed and ran to `Job succeeded` inside `catthehacker/ubuntu:act-22.04`.

One measured limitation worth knowing, because it produces silently wrong results rather than an error: **the `github` context is derived from your local git state.** In a freshly initialised repository with no commits, the run logged `unable to get git ref: reference not found` and `GITHUB_SHA` resolved to **empty**, so a step writing `sha=$GITHUB_SHA` to `$GITHUB_OUTPUT` emitted `sha=` and still reported success.

So `act` is useful for **step logic and shell correctness** and misleading for anything context-dependent. It does not reproduce `GITHUB_TOKEN` permissions, OIDC token minting, environments and approvals, hosted-runner preinstalled tooling, or artifact retention. Never conclude "it works" from `act` alone for an auth-dependent workflow.

## Version notes

| Action | Current | Pinned SHA |
| ------ | ------- | ---------- |
| `actions/checkout` | **v7.0.1** | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-java` | **v6.0.0** | `dd06d9cba3e5552c54d9f8ea23572deb30010f7c` |
| `actions/cache` | **v6.1.0** | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| `actions/upload-artifact` | **v7.0.1** | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |

Resolved through the GitHub API on this machine. **Re-resolve rather than copying**; see [platform-versions.md](platform-versions.md).

- **`::set-output::` is deprecated.** Use `$GITHUB_OUTPUT`. Older tutorials and books still show the old form.
- **`save-state` is likewise replaced** by `$GITHUB_STATE`.
- **`ubuntu-latest` is a moving target.** Runner images exist for Ubuntu 22.04, 24.04 and 26.04, and `latest` rolls between them. Pin the version where the toolchain matters. See [runners.md](runners.md).
- **Node-based actions have a runtime version** (`node20`, `node24`). An action on an EOL runtime produces deprecation warnings and eventually stops working.
- **Not verified here:** tokens, OIDC, environments, approvals and hosted-runner tooling. All need a hosted runner.

## Gotchas

- Agent expects two jobs to share a filesystem - each job gets a fresh runner; use artifacts or outputs
- Agent uses `::set-output::` - deprecated; write to `$GITHUB_OUTPUT`
- Agent sets `cancel-in-progress: true` on a deploy - cancelling mid-deploy leaves the target in an unknown state; serialise instead
- Agent omits `concurrency` on a production deploy - concurrent deploys race and the winner is arbitrary
- Agent leaves `fail-fast` at its default for a compatibility matrix - the first failure cancels the rest, hiding which combinations break
- Agent uses `secrets: inherit` for a workflow outside their own repository - hands over every secret; name them explicitly
- Agent reaches for a composite action to share a whole build - it has no `permissions` of its own and runs in the caller's job; use a reusable workflow
- Agent claims SLSA L3 without a reusable workflow - the isolation that L3 requires comes from the reusable workflow on this platform
- Agent concludes a workflow is correct because `act` passed - **measured: `GITHUB_SHA` was empty and the job still succeeded**; `act` does not reproduce context, tokens or OIDC
- Agent pins `ubuntu-latest` and assumes a fixed toolchain - the image rolls between Ubuntu majors
- Agent grants `id-token: write` at workflow level - scope it to the job that federates

## Related

- [actions-security.md](actions-security.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [platform-matrix.md](platform-matrix.md) · [runners.md](runners.md) · [caching.md](caching.md) · [provenance-and-signing.md](provenance-and-signing.md) · [environments-and-promotion.md](environments-and-promotion.md) · [platform-versions.md](platform-versions.md) · [checklist.md](checklist.md)
