# Target: Kubernetes

The most machinery and the most transferable knowledge. Kubernetes gives you the strongest rollback and rollout primitives of any target here, and the widest scope to get them wrong.

| The four questions | Answer |
| ------------------ | ------ |
| **How does an artifact become running code?** | Update the pod template's **image digest**; the Deployment controller rolls pods |
| **How is configuration injected?** | ConfigMaps and Secrets, as env vars or mounted files |
| **What is the rollback primitive?** | `kubectl rollout undo`, within `revisionHistoryLimit` |
| **What is the zero-downtime primitive?** | Rolling update, plus **readiness probes** and `maxSurge`/`maxUnavailable` |

---

## Deploy by digest

```bash
kubectl set image deployment/app app="$REG/app@$digest" --record
kubectl rollout status deployment/app --timeout=5m     # WAIT, and fail on timeout
```

Two non-negotiables. **Deploy the digest**, so the running artifact is the tested one. And **wait for `rollout status`**, because without it the pipeline reports success the moment the API accepts the update, before any pod is healthy - and a failed rollout then looks like a successful deploy.

`rollout status` returning non-zero on timeout is what makes the pipeline honest.

## Readiness and liveness, which are not the same

This is the most consequential configuration on the page, and the two probes are routinely confused:

| Probe | Question | Failure consequence |
| ----- | -------- | ------------------- |
| **readiness** | "Can this pod serve traffic *now*?" | Removed from the Service endpoints |
| **liveness** | "Is this pod broken beyond recovery?" | **Container is restarted** |
| **startup** | "Is it still starting?" | Holds off the other two |

```yaml
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: 8080 }
  periodSeconds: 5
livenessProbe:
  httpGet: { path: /actuator/health/liveness, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3
startupProbe:                     # for slow starters: JVM apps
  httpGet: { path: /actuator/health/readiness, port: 8080 }
  failureThreshold: 30
  periodSeconds: 5
```

Three failure modes worth naming:

- **No readiness probe**: traffic reaches pods that cannot serve, and the rollout reports success while requests fail. This is the single most common cause of "the deploy worked but users saw errors".
- **A liveness probe that checks a dependency**: when the database is briefly unavailable, Kubernetes restarts every pod, turning a transient dependency blip into a self-inflicted outage. **Liveness must check only the process itself.**
- **No startup probe on a JVM application**: a slow start trips liveness, and the pod restart-loops before it ever becomes ready.

## Graceful shutdown

```yaml
spec:
  terminationGracePeriodSeconds: 45      # must exceed your drain time
  containers:
    - lifecycle:
        preStop:
          exec: { command: ["sleep", "5"] }   # let endpoint removal propagate
```

The `preStop` sleep addresses a genuine race: `SIGTERM` and endpoint removal happen concurrently, so a pod can receive new requests after it has begun shutting down. A short sleep lets the endpoint change propagate before the process starts refusing work.

The application must then handle `SIGTERM` by draining rather than exiting immediately, and `terminationGracePeriodSeconds` must exceed the longest legitimate request. Otherwise every rollout drops requests, and it will be blamed on Kubernetes.

## Rollout tuning

```yaml
strategy:
  rollingUpdate:
    maxSurge: 25%              # extra pods allowed during the roll
    maxUnavailable: 0          # never dip below desired capacity
```

`maxUnavailable: 0` with `maxSurge > 0` means capacity never drops, at the cost of needing headroom. That is usually the right trade for a user-facing service.

`revisionHistoryLimit` (default 10) **is your rollback window**. Reducing it for tidiness reduces how far back you can go. See [rollback.md](rollback.md).

## Manifests, and the templating choice

| Approach | Notes |
| -------- | ----- |
| Plain YAML plus `kubectl set image` | Simplest. Fine for a small number of services |
| **Kustomize** | Built into `kubectl`. Overlays per environment, no templating language |
| **Helm** | Templating and packaging. Powerful, and easy to make unreadable |
| **GitOps** (Argo CD, Flux) | The cluster pulls desired state from git |

Whatever you choose, the environment-specific part must be **configuration, not a rebuild**. Kustomize overlays and Helm values both satisfy that. See [environments-and-promotion.md](environments-and-promotion.md).

**GitOps changes the pipeline's job**: CI builds and pushes the artifact, then commits the new digest to a manifests repository, and the cluster reconciles. The pipeline no longer needs cluster credentials at all, which is a real security improvement - and the deployment becomes asynchronous, so the pipeline must poll for sync status or it reports success before anything has happened.

## Verify signatures at admission

The right place to enforce provenance is the cluster, not the pipeline:

- **Sigstore Policy Controller**, **Kyverno** or **Gatekeeper** can reject images that are unsigned, lack an attestation, or come from an unapproved registry.
- This is what makes signing meaningful: a build that signs its own output proves nothing, whereas a cluster that refuses unsigned images enforces something. See [provenance-and-signing.md](provenance-and-signing.md).

## Migrations

Run them as a **Job** before the rollout, not as an init container on every pod:

```yaml
# a Job runs once; an initContainer runs per pod and races
apiVersion: batch/v1
kind: Job
```

An init container executes on every pod in the replica set, so N pods means N concurrent migration attempts. Expand-only, always, because a rolling update runs both versions simultaneously. See [database-migrations.md](database-migrations.md).

## Version notes

- **`revisionHistoryLimit` defaults to 10** and is the rollback window.
- **`kubectl rollout undo` reverts the pod template only** - not ConfigMaps changed separately, not migrations, not data.
- **`--record` is deprecated** in current kubectl; change-cause annotation is handled differently, so do not rely on it for an audit trail.
- **Probe paths differ by framework.** Spring Boot exposes `/actuator/health/readiness` and `/liveness` when configured; see [`spring-boot-developer`](../../spring-boot-developer/SKILL.md).
- **Not verified here:** no cluster was available. `kubectl` is present on this machine but nothing was deployed; all cited from Kubernetes documentation.

## Gotchas

- Agent deploys and does not wait for `rollout status` - the pipeline reports success before any pod is healthy
- Agent omits a readiness probe - traffic reaches pods that cannot serve while the rollout looks successful
- Agent puts a dependency check in the liveness probe - a database blip restarts every pod, turning a transient fault into an outage
- Agent omits a startup probe on a JVM application - slow start trips liveness and the pod restart-loops
- Agent leaves `terminationGracePeriodSeconds` shorter than the longest request - every rollout drops requests
- Agent omits the `preStop` delay - pods receive requests after shutdown has begun
- Agent deploys a mutable tag - the running artifact is not identifiably the tested one
- Agent reduces `revisionHistoryLimit` for tidiness - that is the rollback window
- Agent treats `kubectl rollout undo` as a complete rollback - pod template only
- Agent runs migrations in an init container - one attempt per pod, racing
- Agent ships a breaking schema change with a rolling update - two versions run simultaneously
- Agent signs images and enforces nothing at admission - signing without verification is theatre
- Agent adopts GitOps and reports success on commit - reconciliation is asynchronous; poll for sync status

## Related

- [deployment-strategies.md](deployment-strategies.md) · [rollback.md](rollback.md) · [database-migrations.md](database-migrations.md) · [containers.md](containers.md) · [provenance-and-signing.md](provenance-and-signing.md) · [environments-and-promotion.md](environments-and-promotion.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [`spring-boot-developer`](../../spring-boot-developer/SKILL.md) · [checklist.md](checklist.md)
