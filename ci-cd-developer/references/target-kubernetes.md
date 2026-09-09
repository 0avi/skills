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
kubectl set image deployment/app app="$REG/app@$digest"
kubectl annotate deployment/app   kubernetes.io/change-cause="$GIT_SHA -> $digest" --overwrite   # not --record
kubectl rollout status deployment/app --timeout=5m     # WAIT, and fail on timeout
```

Two non-negotiables. **Deploy the digest**, so the running artifact is the tested one. And **wait for `rollout status`**, because without it the pipeline reports success the moment the API accepts the update, before any pod is healthy - and a failed rollout then looks like a successful deploy.

**Measured on a live kind cluster running Kubernetes v1.37.0:**

| Scenario | `kubectl rollout status` exit code |
| -------- | ---------------------------------- |
| Healthy rollout | **0** |
| Image changed to an unpullable reference | **1** (pod stuck `ImagePullBackOff`) |

So `rollout status` is a genuine gate: it exits non-zero and the pipeline can fail on it. Without that step the `set image` call alone returns success while the new ReplicaSet never becomes ready, and the old pods keep serving - which looks like a working deploy and is not one.

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

**Measured on Kubernetes v1.37.0**, the two probes behave completely differently and the difference is the whole point:

| Probe under test | Observed |
| ---------------- | -------- |
| **Readiness** failing, 2 replicas behind a Service | Both pods `Running` with `ready=false`; the Service reported **`ready=0`, `notReady=2`** endpoints |
| **Liveness** failing on a single pod | **`restartCount` reached 4** after ~70 seconds |

Read those two rows together. A failing **readiness** probe leaves the pod running and simply removes it from the Service - no traffic, no restart. A failing **liveness** probe **kills and restarts the container**. Confusing them is how a transient dependency outage becomes a cluster-wide restart storm.

Three failure modes worth naming:

- **No readiness probe**: traffic reaches pods that cannot serve, and the rollout reports success while requests fail. This is the single most common cause of "the deploy worked but users saw errors". The measurement above is what a readiness probe buys you: **zero** endpoints rather than two broken ones.
- **A liveness probe that checks a dependency**: when the database is briefly unavailable, Kubernetes restarts every pod - measured, four restarts in seventy seconds - turning a transient blip into a self-inflicted outage. **Liveness must check only the process itself.**
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

The `preStop` sleep addresses a genuine race, but **not the one usually described.** `SIGTERM` is *not* sent concurrently with endpoint removal: per Kubernetes' Container Lifecycle Hooks documentation, "PreStop hooks are not executed asynchronously from the signal to stop the Container; the hook must complete its execution before the TERM signal can be sent." **That ordering is exactly why the sleep works** - it delays `SIGTERM` while deregistration propagates. If the two were simultaneous, a `preStop` sleep could not help at all.

The real race is that shutdown initiation and endpoint deregistration are **concurrent and independent**: "At the same time as the kubelet is starting graceful shutdown of the Pod, the control plane evaluates whether to remove that shutting-down Pod from EndpointSlice objects." Deregistration is not instantaneous - the endpoint persists in the EndpointSlice marked terminating (`ready: false`, `serving: true`, `terminating: true`) and **every data-plane proxy and load balancer must observe the change** before traffic stops arriving. The sleep buys time for that propagation.

**`terminationGracePeriodSeconds` must cover `preStop` *plus* shutdown, not just the longest request.** The documentation is explicit: "This grace period applies to the total time it takes for both the PreStop hook to execute and for the Container to stop normally. If, for example, `terminationGracePeriodSeconds` is 60, and the hook takes 55 seconds to complete, and the Container takes 10 seconds to stop normally after receiving the signal, then the Container will be killed before it can stop normally." So budget **sleep + drain**, not drain alone.

Two refinements worth knowing. The kubelet grants "a small, one-off grace period extension of 2 seconds" if the `preStop` hook is still running when the period expires. And the grace period is a **bound on how long the kubelet waits, not a guarantee the application uses it**: `SIGKILL` goes only to processes still running when it expires, so a rollout with nothing long in flight loses nothing. An earlier draft of this file said "every rollout drops requests", which overstates it - the requirement is that the application actually stops accepting new work and finishes what is in flight.

## Rollout tuning

```yaml
strategy:
  rollingUpdate:
    maxSurge: 25%              # extra pods allowed during the roll
    maxUnavailable: 0          # never dip below desired capacity
```

**`maxUnavailable: 0` does not mean serving capacity never drops**, and an earlier draft of this file claimed it did. The documented guarantee is about a *count*: "Kubernetes doesn't count terminating Pods when calculating the number of `availableReplicas`, which must be between `replicas - maxUnavailable` and `replicas + maxSurge`."

The gap is what "Available" means. Available is readiness **plus `minReadySeconds`**, and `minReadySeconds` "defaults to 0 (the Pod will be considered available as soon as it is ready)". Readiness in turn comes from the readiness probe *if one is configured*. So with **no readiness probe, or a shallow one**, a pod counts as Available before it can actually serve at full capacity; the controller then scales down an old pod, and real serving capacity dips even though the count never did. Endpoint programming lag compounds it.

Two consequences: **`maxUnavailable: 0` is only as good as your readiness probe**, and `minReadySeconds` is the knob that converts "ready" into "warmed up".

Note also that this is a **constraint rather than a bonus**: `maxUnavailable` "cannot be 0 if `.spec.strategy.rollingUpdate.maxSurge` is 0", and `maxSurge` cannot be 0 if `maxUnavailable` is 0. Setting one to zero *requires* headroom in the other.

`revisionHistoryLimit` (default 10) **is your rollback window**, and that is literal rather than rhetorical.

**Measured on v1.37.0** with `revisionHistoryLimit: 2`, after four total revisions:

```
REVISION  CHANGE-CAUSE
2         <none>
3         <none>
4         <none>          <- revision 1 is GONE; 3 ReplicaSets retained
```

Revision 1 is not merely hidden, its ReplicaSet has been deleted, so `rollout undo --to-revision=1` has nothing to return to. Setting this low to keep `kubectl get rs` tidy is a decision to shorten how far back you can recover. See [rollback.md](rollback.md).

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

**Measured on v1.37.0**, the same migration command in both shapes:

| Shape | Migration executions |
| ----- | -------------------- |
| Deployment, `replicas: 3`, migration in an `initContainer` | **3** |
| `Job` | **1** |

Three replicas, three executions - concurrently, against one database. That is the race, and it scales with your replica count, so it gets worse exactly when you scale up under load.

**And per pod it is at-least-once, not once.** Two documented paths to re-execution: "If a Pod's init container fails, the kubelet repeatedly restarts that init container until it succeeds", and a pod can restart - re-running its init containers - when "the Pod infrastructure container is restarted" or when "all containers in a Pod are terminated while `restartPolicy` is set to `Always`... and the init container completion record has been lost due to garbage collection".

So an `initContainer` migration is **N replicas x at-least-once**, which is the wrong shape for a schema change under any reading. A Job, or a single-run path with an advisory lock, is the answer. Expand-only regardless, because a rolling update runs both versions simultaneously. See [database-migrations.md](database-migrations.md).

## Version notes

- **`revisionHistoryLimit` defaults to 10.** Setting it small to reduce clutter shrinks the rollback window; that is a trade, not housekeeping.
- **Defaults worth knowing, from kubernetes.io:** `terminationGracePeriodSeconds` **30 seconds**; `maxSurge` and `maxUnavailable` both **25%**; `minReadySeconds` **0**. Note the asymmetric rounding - `maxUnavailable`'s absolute number is "calculated from percentage by rounding **down**", `maxSurge`'s by rounding **up**.
- **`kubectl rollout undo` reverts the pod template only.** **Measured on v1.37.0:** a release changed both the image (`pause:3.10` to `pause:3.9`) and a ConfigMap (`tier=v1` to `tier=v2`); after `rollout undo` the image was back to `3.10` and **the ConfigMap was still `v2`**. Not ConfigMaps changed separately, not migrations, not data.
- **`--record` is deprecated but not yet removed.** **Measured on kubectl v1.36.1** against a live cluster: it prints `Flag --record has been deprecated, --record will be removed in the future`, **exits 0**, and updates the deployment. It is also hidden from `kubectl set image --help`. So an example using it works today and will break silently later; prefer the annotation.
- **The replacement is an explicit annotation**, and it is strictly better because you choose the text. **Measured:** `kubectl annotate deploy/x kubernetes.io/change-cause="deployed digest abc123" --overwrite` populated the `CHANGE-CAUSE` column in `kubectl rollout history`. Put the commit SHA and the digest in it.
- **Probe paths differ by framework.** Spring Boot exposes `/actuator/health/readiness` and `/liveness` when configured; see [`spring-boot-developer`](../../spring-boot-developer/SKILL.md).
- **Measured here on a kind cluster running Kubernetes v1.37.0:** `rollout status` exit codes, readiness gating Service endpoints, liveness restart counts, `rollout undo` scope against a ConfigMap, `revisionHistoryLimit` deleting old ReplicaSets, and initContainer-per-pod against Job-once.
- **Not verified here:** `preStop` timing, `maxSurge`/`maxUnavailable` capacity behaviour under load, GitOps reconciliation, and admission-controller signature enforcement. Those need either a multi-node cluster with real traffic or extra components, and are cited from Kubernetes documentation.

## Gotchas

- Agent deploys and does not wait for `rollout status` - **measured: exit 0 on a healthy rollout, exit 1 on an unpullable image**, so skipping it discards the only signal
- Agent omits a readiness probe - traffic reaches pods that cannot serve while the rollout looks successful
- Agent puts a dependency check in the liveness probe - **measured: restartCount hit 4 in ~70s**; a database blip restarts every pod, turning a transient fault into an outage
- Agent omits a startup probe on a JVM application - slow start trips liveness and the pod restart-loops
- Agent leaves `terminationGracePeriodSeconds` shorter than the longest request - every rollout drops requests
- Agent omits the `preStop` delay - endpoint deregistration is not instantaneous, so pods receive requests after shutdown has begun
- Agent believes `SIGTERM` and endpoint removal are simultaneous - **`preStop` completes before `SIGTERM` is sent**, which is the whole reason a `preStop` sleep works
- Agent sizes `terminationGracePeriodSeconds` against the longest request only - it must cover **`preStop` + drain**; a 55s hook inside a 60s budget leaves 5s to stop
- Agent trusts `maxUnavailable: 0` to protect serving capacity - it protects a **count**, and "Available" means ready, which means nothing without a real readiness probe
- Agent deploys a mutable tag - the running artifact is not identifiably the tested one
- Agent reduces `revisionHistoryLimit` for tidiness - **measured: with limit 2, revision 1's ReplicaSet was deleted outright**; that is the rollback window
- Agent treats `kubectl rollout undo` as a complete rollback - **measured: image reverted, the ConfigMap changed in the same release did not**
- Agent runs migrations in an init container - **measured: 3 replicas produced 3 concurrent executions**, against one database
- Agent ships a breaking schema change with a rolling update - two versions run simultaneously
- Agent signs images and enforces nothing at admission - signing without verification is theatre
- Agent adopts GitOps and reports success on commit - reconciliation is asynchronous; poll for sync status

## Related

- [deployment-strategies.md](deployment-strategies.md) · [rollback.md](rollback.md) · [database-migrations.md](database-migrations.md) · [containers.md](containers.md) · [provenance-and-signing.md](provenance-and-signing.md) · [environments-and-promotion.md](environments-and-promotion.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [`spring-boot-developer`](../../spring-boot-developer/SKILL.md) · [checklist.md](checklist.md)
