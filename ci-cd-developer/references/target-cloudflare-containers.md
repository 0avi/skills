# Target: Cloudflare Containers

Cloudflare Containers run a real OCI image, unlike Workers. But they are **not** a general container orchestrator, and the difference that matters for a pipeline is that a container here is always fronted by a Worker and a Durable Object.

| The four questions | Answer |
| ------------------ | ------ |
| **How does an artifact become running code?** | `wrangler deploy` builds and pushes the image with **Docker**, uploads the Worker, then updates container instances |
| **How is configuration injected?** | Worker bindings and secrets, passed into the container by your Worker code. Not a separate container env store |
| **What is the rollback primitive?** | Redeploy the previous image and Worker together. There is no single "previous deployment" pointer covering both |
| **What is the zero-downtime primitive?** | A **built-in rolling rollout**, 10% then 90% by default, configurable |

---

## The architecture decides the pipeline

The container class **extends `DurableObject`**. The Durable Object handles routing, lifecycle and persistent state; the container process runs your image inside a Linux VM. Requests reach the container through the Worker, never directly.

Three pipeline consequences:

1. **You are always deploying two things at once** - Worker code and a container image - and they are versioned together in one `wrangler deploy`.
2. **You cannot deploy the container alone.** There is no "update just the image" path equivalent to `kubectl set image`.
3. **Docker is a build dependency of your pipeline.** `wrangler deploy` invokes Docker to build and push. A runner without a working Docker daemon cannot deploy, which rules out some hosted runner configurations and matters for self-hosted ones.

## Image configuration

The `image` field in the Wrangler configuration accepts three forms:

```jsonc
{
  "containers": [{
    "class_name": "MyContainer",
    "image": "./Dockerfile",           // a Dockerfile
    // "image": "./container-dir",     // a directory containing a Dockerfile
    // "image": "registry.cloudflare.com/<ACCOUNT_ID>/<IMAGE>:<TAG>",
    "instance_type": "basic"
  }]
}
```

**Prefer the fully qualified registry reference in CI.** Pointing at a Dockerfile makes `wrangler deploy` build the image at deploy time, which means the deploy step rebuilds rather than promoting - and that violates build-once-promote-many, because the image the deploy produces is not the image you tested. Build and push once, then deploy by reference. See [pipeline-design.md](pipeline-design.md).

Cloudflare provides a managed registry at `registry.cloudflare.com/<ACCOUNT_ID>/<IMAGE>:<TAG>`.

**Pin by digest where the tooling permits it**, for the same reason as everywhere else: a tag can move between build and deploy. See [containers.md](containers.md).

### Instance types

`instance_type` selects memory, CPU and disk: **`lite`** (the default), **`basic`**, and **`standard-1`** through **`standard-4`**. The default is the smallest, so an application that needs more will fail or thrash until this is set deliberately. Treat it as capacity configuration that belongs in review, not a detail.

## Rollouts, and the skew window

`wrangler deploy` does not update everything simultaneously, and this is the most important operational detail:

- **Worker code updates immediately.**
- **Container instances update by rolling deploy**, in two steps by default: **10% of instances first, then the remaining 90%**, tunable with `rollout_step_percentage`.

**So there is a window in which new Worker code is talking to old container instances.** That is a real compatibility requirement, and it is the same discipline as a database migration: the new Worker must work against both the old and the new container image, at least for the duration of the rollout. Deploy a breaking change to the container's interface and requests will fail during the window, not after it.

The mitigation is the expand-and-contract pattern applied to the Worker-to-container interface: add the new path, deploy, then remove the old one in a later deploy. Exactly the two-deploy rule from [database-migrations.md](database-migrations.md), applied to a different boundary.

### Draining

`rollout_active_grace_period` sets the minimum seconds before an *active* instance becomes eligible for update. When an instance is selected it receives **`SIGTERM`** and then has **15 minutes** to exit gracefully.

Two things follow. Your image must **handle `SIGTERM`** and finish in-flight work rather than being killed; a process that ignores it will be terminated at the end of the window. And 15 minutes is generous, so long-running request handling is survivable if you actually implement the handler.

## A pipeline shape

```yaml
# build and push once
- run: |
    docker build -t registry.cloudflare.com/$ACCOUNT/app:$GITHUB_SHA .
    docker push  registry.cloudflare.com/$ACCOUNT/app:$GITHUB_SHA
# deploy by reference, not by Dockerfile
- run: npx wrangler deploy
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

with the image reference in the Wrangler config templated or set to the same tag. Note the API token: Cloudflare is **not** an OIDC federation target for Workers or Containers in the way AWS, Azure and GCP are, so a stored token is currently unavoidable. Scope it narrowly and hold it in an environment-scoped secret. See [oidc-and-secrets.md](oidc-and-secrets.md).

## Containers against Workers

| | Workers | Containers |
| --- | ------- | ---------- |
| Unit of deployment | A **version** of the Worker | A Worker **plus** an image |
| Build artifact | A JS/Wasm bundle | An **OCI image** |
| Needs Docker in CI | No | **Yes** |
| Promotion model | Upload a version, deploy later | Deploy builds or references, then rolls out |
| Traffic splitting | **Gradual deployments** between two versions | **Rolling rollout** by instance percentage |
| Rollback | Deploy a previous version | Redeploy previous Worker and image |
| Skew risk | Between two Worker versions during a gradual deployment | **Between new Worker code and old instances during rollout** |

Choose Workers where the workload fits the isolate model; reach for Containers when you need a real filesystem, an arbitrary runtime, or a long-running process. Do not reach for Containers to avoid learning the Workers model, because you inherit image building, registries and rollout skew in exchange.

## Version notes

- **Instance types** are `lite`, `basic`, `standard-1`, `standard-2`, `standard-3`, `standard-4`, with `lite` the default.
- **Default rollout** is two steps at 10% and 90%, changeable with `rollout_step_percentage`.
- **Shutdown** is `SIGTERM` followed by a **15 minute** grace period.
- **The container class extends `DurableObject`**, so Durable Object semantics apply to routing and state.
- **Cited from Cloudflare's documentation, not measured.** Verifying this needs a Cloudflare account with Containers enabled and a working Docker daemon on the runner. Cloudflare ships product changes frequently; re-check the rollout defaults and instance types before quoting them.

## Gotchas

- Agent points `image` at a Dockerfile in a CI deploy - the deploy step then **rebuilds**, so the deployed image is not the tested image; push once and deploy by reference
- Agent assumes the container and the Worker update together - **Worker code updates immediately while instances roll**, leaving a skew window
- Agent ships a breaking Worker-to-container interface change in one deploy - fails during the rollout window; expand first, contract in a later deploy
- Agent leaves `instance_type` unset - defaults to `lite`, the smallest, and the application may thrash or fail
- Agent does not handle `SIGTERM` in the image - the instance is terminated at the end of the 15 minute grace period with in-flight work lost
- Agent expects a Kubernetes-style rollback pointer - there is none spanning Worker and image; redeploy the previous pair
- Agent plans OIDC federation to Cloudflare - not available for this path; a scoped API token is required, so treat it as a secret to rotate
- Agent runs `wrangler deploy` on a runner with no Docker daemon - the image build fails, unlike a Workers deploy which needs no Docker
- Agent deploys by mutable tag - the tag can move between push and deploy; prefer a digest or an immutable per-commit tag

## Related

- [target-cloudflare-workers.md](target-cloudflare-workers.md) · [containers.md](containers.md) · [deployment-strategies.md](deployment-strategies.md) · [rollback.md](rollback.md) · [database-migrations.md](database-migrations.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [pipeline-design.md](pipeline-design.md)
