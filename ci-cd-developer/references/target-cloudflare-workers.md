# Target: Cloudflare Workers

The one deployment target in this skill with **no container and no image digest**. The promotable unit is a **version** of the Worker, and the standard container vocabulary does not transfer. That is why it gets its own reference rather than a paragraph.

| The four questions | Answer |
| ------------------ | ------ |
| **How does an artifact become running code?** | `wrangler versions upload` creates a version; `wrangler versions deploy` puts it in front of traffic |
| **How is configuration injected?** | Wrangler environments (`[env.<name>]`) for config, `wrangler secret` for secrets, bindings for resources |
| **What is the rollback primitive?** | Deploy a previous **version**. Versions are retained, so rollback is a redeploy of a known-good one |
| **What is the zero-downtime primitive?** | **Gradual deployments**: one deployment splits traffic between **two** versions by percentage |

---

## Decouple upload from deploy, or you have no pipeline

By default `wrangler deploy` **creates a new version and immediately sends 100% of traffic to it, in one step.** That is convenient for a laptop and wrong for a delivery pipeline, because there is no artifact to promote and no gate between build and production.

Split it:

```bash
# CI: build and register the version. No traffic moves.
wrangler versions upload          # -> prints a version id

# CD: promote that exact version, when a human or a gate says so
wrangler versions deploy <version-id>@100
```

This is **build once, promote many** in Cloudflare's vocabulary: the version id is the thing that moves between environments, playing the role an image digest plays elsewhere. See [pipeline-design.md](pipeline-design.md).

Cloudflare's own Workers Builds follows the same shape: for commits outside the production branch the deploy command is replaced by a **preview** command that defaults to `wrangler versions upload`, producing a version without promoting it.

## Gradual deployments

A deployment can reference **one** version serving all traffic, or **two** versions splitting it:

```bash
wrangler versions deploy <new-id>@10 <old-id>@90     # 10% canary
wrangler versions deploy <new-id>@50 <old-id>@50
wrangler versions deploy <new-id>@100                # complete
```

Two constraints to design around:

- **Only two versions can share a deployment.** You cannot run a three-way split, so no A/B/C.
- **Only the last 100 uploaded versions are eligible.** A pipeline that uploads a version per commit on a busy repository can age a known-good version out of the window, which quietly removes it as a rollback target. If you rely on rolling back to a specific release, keep its version id recorded somewhere durable and be aware of the limit.

Because two versions serve simultaneously, the same compatibility rule as everywhere applies: **both versions must tolerate the current state of every shared resource** - KV, D1, R2, Durable Objects, and any database behind the Worker. A gradual deployment across a breaking schema change fails for whichever share of traffic hits the wrong side. See [database-migrations.md](database-migrations.md).

## Secrets, and a sharp edge

Secrets are set out of band rather than in the config file:

```bash
wrangler secret put API_TOKEN            # interactive or piped
```

**`wrangler secret put` creates a new version and deploys it immediately.** That is the sharp edge. It bypasses your promotion gate entirely: a secret rotation performed this way is an immediate production deployment of a new version, not a configuration change to the running one.

For a controlled flow use the versions-scoped form, which attaches the secret to a version without deploying it:

```bash
wrangler versions secret put API_TOKEN   # stays with the version, no traffic move
```

Also worth declaring: the `secrets` property in the Wrangler configuration lists the secret names the Worker requires, and `wrangler deploy` and `wrangler versions upload` then **fail with a clear error if any are missing**. That converts a runtime `undefined` into a deploy-time failure, which is exactly the trade you want. Turn it on.

Secrets can also be uploaded in bulk from a JSON or `.env` file, and secrets absent from the file are **preserved** from the previous version rather than deleted.

## Environments

```jsonc
{
  "name": "app",
  "env": {
    "staging":    { "name": "app-staging",    "vars": { "TIER": "staging" } },
    "production": { "name": "app-production", "vars": { "TIER": "prod" } }
  }
}
```

Deploy with `--env staging`. Note that each named environment is effectively a **separate Worker** with its own name, secrets and bindings, so "promotion" between Wrangler environments is not moving one artifact - it is uploading to a different Worker. If you want true single-artifact promotion, prefer one Worker with versions and use gradual deployments for the rollout, keeping environment differences in bindings.

## Authentication in CI

`CLOUDFLARE_API_TOKEN` as an environment variable. **Cloudflare is not an OIDC federation target** the way AWS, Azure and GCP are, so unlike those platforms you cannot eliminate the long-lived credential here. Consequences: scope the token to the minimum permissions, hold it as an environment-scoped secret with required reviewers on production, and rotate it on a schedule. See [oidc-and-secrets.md](oidc-and-secrets.md).

Cloudflare's own Workers Builds uses a user token scoped to Account Settings (read), Workers Scripts (edit), Workers KV Storage (edit), Workers R2 Storage (edit) and Zone Workers Routes (edit) - a reasonable starting point for the permissions a deploy actually needs.

## Version notes

- **`wrangler deploy`** creates a version and deploys it to 100% in one step. Use `versions upload` plus `versions deploy` in a pipeline.
- **Gradual deployments** support exactly **two** versions per deployment.
- **Only the last 100 uploaded versions** can participate in a gradual deployment.
- **`wrangler secret put` deploys immediately**; `wrangler versions secret put` does not.
- **The `secrets` config property** makes missing secrets a deploy-time failure.
- **Cited from Cloudflare's documentation, not measured** - verification needs a Cloudflare account. Wrangler moves quickly, so confirm command shapes against the current CLI before relying on them.

## Gotchas

- Agent uses bare `wrangler deploy` in a pipeline - creates and promotes in one step, leaving nothing to gate or promote
- Agent treats a Wrangler environment as a promotion stage - each named environment is a **separate Worker**, so nothing is being promoted
- Agent rotates a secret with `wrangler secret put` - **immediately deploys a new version**, bypassing every approval; use `wrangler versions secret put`
- Agent plans a three-way traffic split - a deployment supports **two** versions only
- Agent assumes any past version is a rollback target - only the **last 100 uploaded** are eligible for a gradual deployment
- Agent runs a gradual deployment across a breaking schema change - both versions serve simultaneously, so half the traffic breaks
- Agent expects OIDC federation to Cloudflare - unavailable; a scoped, rotated API token is the only option
- Agent omits the `secrets` config property - a missing secret then surfaces as a runtime failure instead of a deploy-time one
- Agent looks for an image digest to promote - there is none; the **version id** is the promotable identity
- Agent assumes a bulk secret upload replaces all secrets - omitted secrets are **preserved**, not removed

## Related

- [target-cloudflare-containers.md](target-cloudflare-containers.md) · [deployment-strategies.md](deployment-strategies.md) · [rollback.md](rollback.md) · [environments-and-promotion.md](environments-and-promotion.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [database-migrations.md](database-migrations.md) · [pipeline-design.md](pipeline-design.md) · [frontend-build.md](frontend-build.md)
