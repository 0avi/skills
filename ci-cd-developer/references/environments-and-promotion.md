# Environments and Promotion

An environment is where an artifact runs; promotion is moving **the same artifact** to the next one. If anything is rebuilt between environments, this is not promotion and the pipeline's guarantees do not hold.

| Question | Answer |
| -------- | ------ |
| What moves between environments? | **A digest or version id.** Never a branch, never a tag, never source |
| Where does configuration live? | **Outside the artifact**, injected at deploy time |
| How many environments? | As few as give real signal. Each one costs money and latency |
| What gates production? | An **environment with required reviewers**, plus federated identity bound to it |
| Should staging match production? | In *shape* yes, in scale rarely. Know which differences exist |

---

## Configuration cannot be in the artifact

If the artifact contains environment-specific configuration, you must build one per environment, and then you are no longer promoting anything. This is the twelve-factor position and it follows directly from build-once-promote-many.

```
one artifact  +  staging config     ──> staging
              +  production config  ──> production
```

| Belongs in the artifact | Injected at deploy |
| ----------------------- | ------------------ |
| Code, dependencies, static assets | Endpoints, credentials, feature-flag defaults |
| Default values safe everywhere | Connection strings, log level, replica count |
| The schema migration files | Which database to run them against |

**Fail fast on missing configuration.** A service that starts with a null connection string and fails on first request is much harder to diagnose than one that refuses to start. Validate required configuration at startup. Cloudflare's `secrets` config property does exactly this and is worth turning on. See [target-cloudflare-workers.md](target-cloudflare-workers.md).

## Configuration deserves the same review as code

Most incidents attributed to "a bad deploy" are configuration changes, and configuration is frequently edited in a portal with no review, no diff and no audit trail.

Keep it in version control and let the pipeline apply it. Then a configuration change gets a diff, a reviewer and a revert. The exception is secret *values*, which live in a secret store while their *names* and *shape* stay in version control. See [oidc-and-secrets.md](oidc-and-secrets.md).

## How many environments

Each environment costs infrastructure, deploy latency and drift maintenance. Add one only if it answers a question the others cannot.

| Environment | The question it answers | Worth it |
| ----------- | ----------------------- | -------- |
| Ephemeral per pull request | "Does this change work at all?" | Often, if cheap to create |
| Integration / dev | "Do the services work together?" | Usually |
| Staging | "Is this release deployable?" | Usually |
| Pre-production with production data | "Does it work at real scale and shape?" | For high-risk changes, with data protection controls |
| Production | - | - |

**A staging environment that nobody trusts is worse than none**, because releases route around it while still paying for it. If staging is routinely skipped, either fix its fidelity or delete it.

Where staging has a copy of production data, the data-protection obligations travel with it: pseudonymise or mask, and treat access as production access.

## Promotion mechanics

| Platform | Environment | Approval |
| -------- | ----------- | -------- |
| GitHub Actions | `environment:` on the job | **Required reviewers**, plus deployment branch rules |
| Azure DevOps | `environment:` in a deployment job | **Approvals and checks** on the environment |
| GitLab CI | `environment:` with a protected environment | Allowed-to-deploy plus `when: manual` |

```yaml
# the artifact is an input, not something this job builds
jobs:
  promote-production:
    needs: [deploy-staging]
    environment: production          # gate + scoped secrets + OIDC subject claim
    steps:
      - run: ./deploy.sh "${{ needs.build.outputs.digest }}"
```

Two things that matter more than the syntax:

- **The environment is where the approval, the secrets and the identity all belong.** Putting them there is what makes production access auditable rather than ambient.
- **Serialise deploys per environment.** Two concurrent promotions of different digests race, and which wins is arbitrary. See [github-actions.md](github-actions.md).

## Approvals that mean something

An approval is only a control if the approver can see what they are approving. Give them, in the request: the artifact digest, the diff since what is currently deployed, the test and scan results, and **whether a migration will run**.

An approval button with no context trains people to click it, which is worse than no gate because it manufactures an audit trail implying review that did not happen. See [quality-gates.md](quality-gates.md).

## Drift

Environments diverge, and undetected divergence is what makes staging results meaningless. Sources, in rough order of frequency: manual portal changes, configuration applied to one environment only, infrastructure changed outside the pipeline, and different secret values with different shapes.

The countermeasure is that **the pipeline is the only route to change**, in every environment including the lowest. A single manual change to staging invalidates it as evidence for production.

## Version notes

- **All three platforms call this `environment`** and mean roughly the same thing: a named target carrying its own secrets and approvals.
- **Environment-scoped secrets are strictly better than repository-scoped**, and the GitHub OIDC subject claim carries the environment name, which lets a cloud trust policy bind to it.
- **Ephemeral per-PR environments** need a teardown path, or they accumulate cost silently.
- **Not verified here:** approvals, environment secrets and drift behaviour all need a hosted platform and an organisation. Cited from platform documentation.

## Gotchas

- Agent builds separately per environment - not promotion; production runs something staging never tested
- Agent bakes environment configuration into the artifact - forces one artifact per environment by construction
- Agent promotes a tag rather than a digest - the tag may point elsewhere by the time production deploys
- Agent lets a service start with missing configuration - a null connection string fails later and much more confusingly than a refusal to start
- Agent edits configuration in a cloud portal - no diff, no review, no revert, and it is the most common cause of "a bad deploy"
- Agent adds an environment without a question for it to answer - cost and latency for no signal
- Agent keeps a staging environment everyone bypasses - pays for it and gets nothing; fix its fidelity or remove it
- Agent copies production data into staging with no masking - the data-protection obligations came with the data
- Agent puts secrets at repository scope when environment scope is available - every workflow in the repository can read them
- Agent presents an approval with no artifact, diff or migration status - manufactures an audit trail for review that did not happen
- Agent omits deploy serialisation - concurrent promotions race
- Agent makes one manual change to staging - staging is no longer evidence for anything

## Related

- [pipeline-design.md](pipeline-design.md) · [deployment-strategies.md](deployment-strategies.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [database-migrations.md](database-migrations.md) · [quality-gates.md](quality-gates.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [rollback.md](rollback.md) · [platform-matrix.md](platform-matrix.md) · [checklist.md](checklist.md)
