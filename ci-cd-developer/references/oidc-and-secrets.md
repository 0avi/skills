# OIDC and Secrets

The single highest-value security change available to a pipeline: **stop storing cloud credentials in CI at all.** OIDC federation lets the CI platform prove which workflow is running, and the cloud mints a short-lived credential in response. There is no long-lived key, so there is nothing to leak, rotate, or find in a git history five years later.

| Question | Answer |
| -------- | ------ |
| What replaces a stored cloud key? | A **workflow identity token** exchanged for a short-lived cloud credential |
| What must I get right? | **The trust condition.** A federation configured to trust the whole organisation is worse than a scoped secret |
| Which targets support it? | AWS, Azure, GCP and HashiCorp Vault, from all three CI platforms. **Not Cloudflare** |
| What still needs a stored secret? | Cloudflare, most SaaS APIs, signing keys you own, and anything without an OIDC trust model |
| Where do stored secrets belong? | **Scoped to an environment** with required reviewers on production, never at repository scope |

---

## How the exchange works

1. The job requests an OIDC token from its CI platform. On GitHub Actions this requires `permissions: id-token: write`.
2. The token is a short-lived JWT whose claims describe **which repository, which workflow, which branch or environment** is running.
3. The job presents it to the cloud, which validates the signature against the platform's public keys and checks the claims against a **trust policy** you configured.
4. The cloud returns a credential valid for minutes.

Everything rests on step 3. The token is not a secret worth protecting in the way a key is - it is short-lived and audience-bound - but a trust policy that accepts too much turns it into a permanent grant to anyone who can run a workflow in scope.

## The trust condition is the whole control

GitHub's issuer is `https://token.actions.githubusercontent.com`, and the `sub` claim takes forms such as:

```
repo:myorg/myrepo:ref:refs/heads/main
repo:myorg/myrepo:environment:production
repo:myorg/myrepo:pull_request
```

A trust policy that matches on `repo:myorg/*` accepts **every repository in the organisation**. One that matches `repo:myorg/myrepo:*` accepts every branch and every pull request in that repository, which means a fork PR workflow, or anyone who can push a branch, can assume the production role.

**Bind to the narrowest claim that still works**, which is almost always an environment:

```jsonc
// AWS trust policy condition - bind to one environment, not a wildcard
"Condition": {
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub":
      "repo:myorg/myrepo:environment:production"
  }
}
```

Then protect that environment with required reviewers, so producing a token with `environment:production` in its subject requires an approval. **That combination - environment-scoped federation plus environment protection - is the actual control.** Federation alone is not.

Use `StringEquals` where you can. `StringLike` with a `*` is where over-broad trust creeps in.

## Per platform and per cloud

| CI platform | Issuer | AWS | Azure | GCP |
| ----------- | ------ | --- | ----- | --- |
| **GitHub Actions** | `token.actions.githubusercontent.com` | `aws-actions/configure-aws-credentials` with `role-to-assume` | `azure/login` with `federated` credential | Workload Identity Federation |
| **Azure DevOps** | Azure DevOps issuer per organisation | Workload identity federation on the service connection | **Workload identity federation service connection** - the native path | Supported via federation |
| **GitLab CI** | Your GitLab instance URL | `id_tokens` plus `aws sts assume-role-with-web-identity` | `id_tokens` with Azure federated credential | Supported via federation |

GitHub Actions, minimal:

```yaml
permissions:
  id-token: write
  contents: read
jobs:
  deploy:
    environment: production          # so the sub claim carries it
    steps:
      - uses: aws-actions/configure-aws-credentials@<sha>
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy
          aws-region: eu-west-2
```

GitLab CI, minimal:

```yaml
deploy:
  id_tokens:
    AWS_TOKEN:
      aud: sts.amazonaws.com
  script:
    - aws sts assume-role-with-web-identity
        --role-arn "$ROLE_ARN" --role-session-name ci
        --web-identity-token "$AWS_TOKEN"
```

Azure DevOps: prefer a **workload identity federation** service connection over the older service principal with a secret. It is the same idea expressed as a connection type, and it removes the client secret that would otherwise need rotating.

**Cloudflare is the exception.** Neither Workers nor Containers accepts a federated identity for deployment, so a scoped API token is currently unavoidable. Treat it as the one credential you must actually manage: minimum permissions, environment-scoped, rotated. See [target-cloudflare-workers.md](target-cloudflare-workers.md).

*All federation flows here are cited from vendor documentation. Verifying them end to end needs cloud accounts, which this machine does not have.*

## When a secret is unavoidable

Scope it as tightly as the platform allows:

| Platform | Best available scoping |
| -------- | ---------------------- |
| GitHub Actions | **Environment secrets** with required reviewers and branch restrictions. Repository secrets are a weaker fallback; organisation secrets weaker still |
| Azure DevOps | **Variable groups** linked to an environment, or Azure Key Vault-backed groups. Mark as secret so it is masked |
| GitLab CI | **Protected + masked** CI/CD variables, scoped to protected branches and environments |

Rules that apply regardless of platform:

- **Never at organisation scope for a deployment credential.** Organisation secrets are readable by every repository that can run a workflow.
- **Prefer a secrets manager as the source of truth**, with CI fetching at run time via OIDC. Then the CI platform holds no secret at all and rotation happens in one place.
- **Mask, but do not rely on masking.** Any transformation - base64, JSON encoding, splitting across lines - defeats it. See [actions-security.md](actions-security.md).
- **Assume a secret used in a job is visible to everything in that job**, including dependency install scripts. That is why fork pull requests do not get secrets.

## Rotation and leak response

Rotation is only cheap if the secret has one home. If a token is pasted into three repositories and a developer's laptop, rotation is a project. This is the strongest practical argument for federation: **there is nothing to rotate.**

When a secret does leak:

1. **Revoke first, investigate second.** A revoked credential cannot be used while you read logs.
2. **Assume the whole blast radius**, not the one job you found it in. What else could that credential reach?
3. **Rewriting git history does not help.** Any clone or fork retains it, and it was already exposed. Revocation is the remedy; history rewriting is cosmetic.
4. **Turn on push protection and secret scanning** so the next one is caught before it lands.

## Version notes

| | Status |
| --- | ------ |
| GitHub OIDC issuer | `https://token.actions.githubusercontent.com` |
| GitHub permission required | `id-token: write` - absent by default |
| Azure DevOps | Workload identity federation is the current recommendation over service principal secrets |
| GitLab | `id_tokens` is the current mechanism; the older `CI_JOB_JWT` is removed |
| Cloudflare | **No OIDC federation for deployment.** Scoped API token only |

- **`CI_JOB_JWT` and `CI_JOB_JWT_V2` are gone from GitLab.** Any pipeline still referencing them needs migrating to `id_tokens`.
- **Subject claim formats are stable but not identical across platforms.** Read the actual token in a debug job before writing a trust policy against a guess.
- **Not verified here:** every federation flow. No cloud accounts on this machine.

## Gotchas

- Agent configures federation with a `repo:myorg/*` trust condition - grants the role to **every repository in the organisation**
- Agent trusts `repo:myorg/myrepo:*` - includes pull requests and every branch, so anyone who can open a PR can assume the production role
- Agent sets up federation and no environment protection - federation removes the key but adds no approval; the two are complementary, not alternatives
- Agent omits `permissions: id-token: write` - the token request fails, usually reported as an unhelpful credentials error
- Agent stores a deployment credential as an organisation secret - readable from every repository in the org
- Agent plans OIDC for Cloudflare - unsupported; budget for a scoped, rotated API token instead
- Agent rewrites git history after a leak and considers it handled - **revoke the credential**; history rewriting changes nothing for anyone who already cloned
- Agent relies on log masking - defeated by any encoding or transformation of the value
- Agent uses `StringLike` with a wildcard in a trust policy where `StringEquals` would do - the usual route to over-broad trust
- Agent references GitLab `CI_JOB_JWT` - removed; use `id_tokens`
- Agent grants a federated role broad cloud permissions because federation "is secure" - the credential is short-lived, not less powerful; scope the role too

## Related

- [actions-security.md](actions-security.md) · [environments-and-promotion.md](environments-and-promotion.md) · [platform-matrix.md](platform-matrix.md) · [github-actions.md](github-actions.md) · [azure-devops.md](azure-devops.md) · [gitlab-ci.md](gitlab-ci.md) · [target-cloudflare-workers.md](target-cloudflare-workers.md) · [provenance-and-signing.md](provenance-and-signing.md) · [checklist.md](checklist.md)
