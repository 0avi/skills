# Deployment Strategies

How new code replaces old without dropping requests. The choice is usually made for you by the target, so the useful knowledge is **what each strategy requires of your application**, not how to configure it.

| Strategy | Two versions live at once? | Needs a load balancer? | Rollback speed | Cost |
| -------- | -------------------------- | ---------------------- | -------------- | ---- |
| **Recreate** | No | No | Redeploy | **Downtime** |
| **Rolling** | **Yes** | Yes | Roll forward or back, gradual | Low |
| **Blue-green** | Briefly, at cutover | Yes | **Instant switch back** | Double the infrastructure |
| **Canary** | **Yes, for a long time** | Yes, with weighting | Fast, small blast radius | Needs metrics to decide |

**The second column is the one that constrains you.** Every strategy except recreate runs two versions simultaneously, which imposes the compatibility requirement in [database-migrations.md](database-migrations.md) and applies equally to message formats, cache entries and any shared state.

---

## What "two versions at once" demands

For the duration of the overlap, both versions must tolerate:

- **The current database schema.** Expand-only migrations, always. See [database-migrations.md](database-migrations.md).
- **Each other's messages.** A queue consumer on the old version may receive a message produced by the new one. Add fields, do not repurpose or remove them.
- **Each other's cache entries.** A changed serialised shape under an unchanged cache key will be read by the other version.
- **Shared session or lock state.** If session data changes shape, old instances must still read it.

This is the same expand-and-contract discipline applied beyond the database, and it is why a "simple" deploy can fail mid-rollout while both endpoints look healthy in isolation.

## Rolling

Replace instances a few at a time. The default nearly everywhere: Kubernetes Deployments, ECS services, Container Apps revisions, Cloudflare Containers rollouts.

What must be true for it to be safe:

1. **A real readiness check** that fails until the instance can actually serve. Without it, traffic reaches an instance that is still starting, and the rollout looks successful while requests fail.
2. **Graceful shutdown.** The instance must stop accepting new work, finish in-flight requests, then exit. A process killed immediately drops requests. Handle `SIGTERM`.
3. **Backwards compatibility**, per above.
4. **Surge capacity**, or the rollout reduces capacity while it runs.

**Readiness and graceful shutdown are the two most commonly missing pieces**, and both produce errors that get blamed on the deployment tool.

## Blue-green

Two complete environments. Deploy to the idle one, verify it, switch traffic, keep the old one warm as the rollback path.

Strengths: verification against the real environment before any user traffic, and rollback is a switch rather than a redeploy.

**The trap is shared state.** Blue and green almost always share one database, so blue-green does **not** exempt you from expand-only migrations. Teams reach for it expecting that exemption and do not get it. It also doubles infrastructure for the overlap, and any long-lived connection (WebSocket, SSE, streaming) needs a draining plan because a traffic switch does not migrate existing connections.

Native support: Azure App Service **deployment slots** with slot swap is the cleanest example; AWS CodeDeploy offers it for ECS.

## Canary

Route a small percentage to the new version, watch, then increase or abort.

The essential point: **a canary is only as good as the signal you evaluate.** Sending 5% of traffic to a new version and not comparing error rate or latency between the two is not a canary, it is a partial deployment with extra steps. Decide in advance what metric, what threshold, and what window.

Two practical constraints:

- **Low-traffic services cannot canary meaningfully.** 5% of 20 requests an hour yields no signal in any useful window.
- **The overlap is long**, so the compatibility requirements bite hardest here.

Native support: Kubernetes with a service mesh or Gateway API weighting, Argo Rollouts or Flagger; ECS with CodeDeploy canary; **Cloudflare Workers gradual deployments** are precisely this, limited to two versions. See [target-cloudflare-workers.md](target-cloudflare-workers.md).

## Which targets support what

| Target | Native default | Blue-green | Canary |
| ------ | -------------- | ---------- | ------ |
| **Kubernetes** | Rolling | Via two Services or a mesh | Mesh, Gateway API, Argo Rollouts, Flagger |
| **Azure App Service** | Rolling | **Slot swap** - the cleanest available | Slot traffic percentage |
| **Azure Container Apps** | Revisions | Multiple active revisions | **Revision traffic weights** |
| **AWS ECS / Fargate** | Rolling | CodeDeploy blue-green | CodeDeploy canary or linear |
| **VM / on-prem** | Whatever you build | Two pools plus a load balancer | Load balancer weighting |
| **Cloudflare Workers** | Immediate 100% | Not really | **Gradual deployments, two versions** |
| **Cloudflare Containers** | **Rolling, cumulative `[10, 100]`** | No | Via `rollout_step_percentage` |

## Feature flags: the strategy that decouples the two questions

Deployment strategies control **which code is running**. Feature flags control **which code path executes**. Separating them is what makes trunk-based development work without long-lived branches.

The practical consequence: a risky change ships dark, is enabled for a small cohort, and is disabled without a deployment if it misbehaves. Rollback becomes a configuration change, which is faster and safer than any deployment strategy.

The cost is real and worth stating: every flag is a branch in production, flags multiply combinations, and **stale flags are technical debt with an operational risk attached**. Give each flag an owner and a removal date. See [trunk-and-branching.md](trunk-and-branching.md).

## Version notes

- **Rolling is the default on nearly every target**, so it is what you get unless you choose otherwise. Verify readiness and graceful shutdown are in place before relying on it.
- **Blue-green does not solve migrations.** Shared database, shared constraint.
- **Cloudflare Workers gradual deployments are limited to two versions** and to the last 100 uploaded.
- **Cloudflare Containers rolls in cumulative steps defaulting to `[10, 100]`** - the array must end at 100, so `[10, 90]` is wrong - and the Worker updates immediately while instances roll, leaving a skew window.
- **Not verified here:** every strategy above needs a live target. Cited from vendor documentation, and the Cloudflare specifics from Cloudflare's docs.

## Gotchas

- Agent picks a zero-downtime strategy and ships a breaking schema change - every strategy except recreate runs two versions; expand-only is mandatory
- Agent assumes blue-green avoids the migration constraint - the two environments share the database
- Agent deploys with no readiness check - traffic reaches instances that cannot serve, and the rollout reports success
- Agent omits graceful `SIGTERM` handling - in-flight requests are dropped on every rollout
- Agent calls a percentage rollout a canary without evaluating a metric - that is a partial deployment, not a canary
- Agent canaries a low-traffic service - 5% of very little is no signal
- Agent forgets long-lived connections in a blue-green switch - WebSockets and streams do not migrate with a traffic switch
- Agent considers only the database for compatibility - message formats, cache entry shapes and session data have the same requirement
- Agent adds feature flags and no removal discipline - each stale flag is a live branch in production
- Agent assumes rolling gives spare capacity - without surge settings the rollout runs at reduced capacity

## Related

- [rollback.md](rollback.md) · [database-migrations.md](database-migrations.md) · [environments-and-promotion.md](environments-and-promotion.md) · [target-kubernetes.md](target-kubernetes.md) · [target-azure.md](target-azure.md) · [target-aws.md](target-aws.md) · [target-vm-onprem.md](target-vm-onprem.md) · [target-cloudflare-workers.md](target-cloudflare-workers.md) · [target-cloudflare-containers.md](target-cloudflare-containers.md) · [trunk-and-branching.md](trunk-and-branching.md) · [checklist.md](checklist.md)
