# Platform Matrix

One table per concept, so advice can be given once and translated. This file exists to stop the same guidance being written three times and drifting.

**Read the concept column first.** If you cannot name the concept, translating the syntax will not help.

---

## Structure

| Concept | GitHub Actions | Azure DevOps | GitLab CI |
| ------- | -------------- | ------------ | --------- |
| File location | `.github/workflows/*.yml` | `azure-pipelines.yml`, any path | `.gitlab-ci.yml`, any path |
| Top-level unit | **workflow** | **pipeline** | **pipeline** |
| Grouping | `jobs` | `stages` containing `jobs` | `stages`, or `needs` for a DAG |
| Unit of execution | `job` (own runner) | `job` (own agent) | `job` (own runner) |
| Smallest unit | `step` | `step` / `task` | a line in `script` |
| Sequencing | `needs:` | `dependsOn:` | `stage:` order, or `needs:` |
| Parallel variants | `strategy.matrix` | `strategy.matrix` / `parallel` | `parallel.matrix` |
| Reuse | **Reusable workflow** or **composite action** | **Template** (`extends`, `steps` template) | **`include`**, or a **CI/CD Component** |

## Triggers

| Concept | GitHub Actions | Azure DevOps | GitLab CI |
| ------- | -------------- | ------------ | --------- |
| On push | `on: push` | `trigger:` | `rules: if: $CI_COMMIT_BRANCH` |
| On pull request | `on: pull_request` | `pr:` | `rules: if: $CI_PIPELINE_SOURCE == "merge_request_event"` |
| Manual | `on: workflow_dispatch` | manual stage, or `trigger: none` | `when: manual` |
| Scheduled | `on: schedule` (cron) | `schedules:` | `rules: if: $CI_PIPELINE_SOURCE == "schedule"` |
| Another pipeline finished | `on: workflow_run` | pipeline resource trigger | `trigger:` / parent-child |
| Path filter | `on.push.paths` | `trigger.paths` | `rules: changes:` |

**Fork pull requests differ on every platform** and this is the most important row in the file. On GitHub, `pull_request` from a fork gets **no secrets** and a read-only token. Azure DevOps and GitLab have equivalent settings that are configurable and sometimes default to permissive. Check the setting; do not assume. See [actions-security.md](actions-security.md).

## Artifacts and passing data

| Concept | GitHub Actions | Azure DevOps | GitLab CI |
| ------- | -------------- | ------------ | --------- |
| Publish | `actions/upload-artifact` | `publish` / `PublishPipelineArtifact` | `artifacts: paths:` |
| Consume | `actions/download-artifact` | `download` / `DownloadPipelineArtifact` | automatic from earlier stages, or `dependencies:` |
| Value between jobs | `outputs` + `needs.<job>.outputs` | `isOutput=true` variable | `dotenv` report artifact |
| Cache | `actions/cache` | `Cache@2` task | `cache:` |
| Retention | Repo/org setting, default 90 days | Project setting | Project setting, `expire_in` |

**Artifacts and caches are different things**, and conflating them is a common defect: an artifact is *output you need later or want to keep*; a cache is *a reconstructible optimisation*. Losing a cache costs time. Losing an artifact loses the thing you were going to deploy. See [caching.md](caching.md).

## Secrets, identity and environments

| Concept | GitHub Actions | Azure DevOps | GitLab CI |
| ------- | -------------- | ------------ | --------- |
| Secret store | Repository / environment / org secrets | Variable groups, Key Vault-backed | CI/CD variables (masked, protected) |
| Best scoping | **Environment secrets** | Variable group linked to an environment | **Protected + masked**, environment-scoped |
| Deployment target abstraction | `environment:` | `environment:` | `environment:` |
| Approval gate | Environment **required reviewers** | Environment **approvals and checks** | Protected environment + `when: manual` |
| Cloud identity without a key | OIDC (`id-token: write`) | **Workload identity federation** service connection | `id_tokens` |
| Connection to a cloud | Action + OIDC role | **Service connection** | Variables or `id_tokens` |

All three call the concept `environment`, and it means roughly the same thing on each: a named deployment target that can carry its own secrets and its own approval requirements. **It is the right place to put both.** See [oidc-and-secrets.md](oidc-and-secrets.md) and [environments-and-promotion.md](environments-and-promotion.md).

## Expressions and variables

| Concept | GitHub Actions | Azure DevOps | GitLab CI |
| ------- | -------------- | ------------ | --------- |
| Expression syntax | `${{ }}` | `$( )` runtime, `${{ }}` compile-time, `$[ ]` runtime expression | `$VAR` |
| Commit SHA | `github.sha` | `Build.SourceVersion` | `CI_COMMIT_SHA` |
| Branch | `github.ref_name` | `Build.SourceBranchName` | `CI_COMMIT_REF_NAME` |
| Run id | `github.run_id` | `Build.BuildId` | `CI_PIPELINE_ID` |
| Repository | `github.repository` | `Build.Repository.Name` | `CI_PROJECT_PATH` |
| Trigger source | `github.event_name` | `Build.Reason` | `CI_PIPELINE_SOURCE` |
| Conditional | `if:` | `condition:` | `rules:` / `only`/`except` (legacy) |

**Azure DevOps has three expression syntaxes with different evaluation times**, which is its sharpest edge for newcomers: `${{ }}` is expanded at compile time before the pipeline runs, `$[ ]` at runtime, and `$( )` is a macro the agent substitutes. Using the wrong one produces a value that is empty or literal rather than an error.

**Template expansion precedes execution on all three platforms.** That is why script injection is the same vulnerability class everywhere, differing only in sigil. Pass untrusted values through the environment, never into the script body. See [actions-security.md](actions-security.md).

## Concurrency and cancellation

| Concept | GitHub Actions | Azure DevOps | GitLab CI |
| ------- | -------------- | ------------ | --------- |
| Cancel superseded runs | `concurrency` with `cancel-in-progress` | `batch: true` on trigger; queueing policies | `interruptible: true` + auto-cancel setting |
| Serialise deploys | `concurrency: group: prod` | Environment exclusive lock | `resource_group:` |

**Serialising production deploys is worth doing on every platform.** Two concurrent deploys of different commits to one environment is a race whose winner is arbitrary.

## What does not translate

Some things have no equivalent and pretending otherwise causes trouble:

| Feature | Notes |
| ------- | ----- |
| GitHub **reusable workflow** | Not the same as an Azure DevOps template. A reusable workflow is a *whole job graph* with its own permissions and secrets contract; a template is text substitution. This is also what supplies SLSA Build L3 on GitHub. See [provenance-and-signing.md](provenance-and-signing.md) |
| GitHub **composite action** | Closest to a `steps` template in Azure DevOps, but runs in the caller's job |
| Azure DevOps **service connection** | A first-class, permissioned, auditable object. GitHub and GitLab express the same thing as secrets or federation configuration |
| GitLab **child pipelines** | Dynamically generated pipelines. Approximated by `workflow_dispatch` or matrix generation elsewhere |
| GitLab **`rules:changes`** with merge-request awareness | Path filtering semantics differ meaningfully between platforms; test rather than port |
| Azure DevOps **Classic pipelines** | Maintenance mode, YAML-only investment since 2023. **Out of scope.** Any pre-2023 material teaches this model |

## Version notes

| | Status |
| --- | ------ |
| GitHub Actions | Continuous delivery; no version to pin. Runner images roll continuously |
| Azure DevOps | **YAML only** for new work. Classic is maintenance-mode |
| GitLab CI | Versioned with the GitLab instance. `only`/`except` is legacy; use `rules:` |
| GitLab `CI_JOB_JWT` | **Removed.** Use `id_tokens` |

- **Feature availability differs by plan and by self-managed version** on Azure DevOps and GitLab. Check against the instance, not the public docs.
- **Cited from vendor documentation.** Only the GitHub Actions rows were exercised on this machine, and only locally through `act`, which does not reproduce tokens, OIDC or environments.

## Gotchas

- Agent ports a workflow between platforms by translating syntax alone - trigger semantics, fork handling and expression evaluation times all differ
- Agent assumes an Azure DevOps template equals a GitHub reusable workflow - a template is substitution; a reusable workflow is a job graph with its own secrets contract
- Agent uses `${{ }}` in Azure DevOps where a runtime value is needed - compile-time expansion yields an empty or literal value, with no error
- Agent treats artifacts and caches as interchangeable - a lost cache costs time, a lost artifact loses the deployable
- Agent assumes fork pull requests are handled the same everywhere - the defaults differ and some are permissive
- Agent uses GitLab `only`/`except` in new pipelines - legacy; `rules:` is current
- Agent references `CI_JOB_JWT` - removed from GitLab
- Agent omits deploy serialisation - concurrent deploys to one environment race, and the winner is arbitrary
- Agent writes Azure DevOps guidance from a pre-2023 source - that material is Classic pipelines, which are maintenance-mode
- Agent interpolates untrusted input into a script on any platform - template expansion precedes execution on all three; the vulnerability is identical

## Related

- [github-actions.md](github-actions.md) · [azure-devops.md](azure-devops.md) · [gitlab-ci.md](gitlab-ci.md) · [runners.md](runners.md) · [actions-security.md](actions-security.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [caching.md](caching.md) · [environments-and-promotion.md](environments-and-promotion.md) · [pipeline-design.md](pipeline-design.md) · [platform-versions.md](platform-versions.md)
