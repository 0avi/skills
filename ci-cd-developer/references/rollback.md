# Rollback

The plan for when a deployment is wrong. Most teams believe they can roll back and discover during an incident that they cannot, because **reversibility is a property they never actually tested.**

| Question | Answer |
| -------- | ------ |
| Roll back or roll forward? | **Roll forward by default.** Roll back when the fix is not immediate and the previous version is known good |
| What makes a deploy reversible? | The **schema and shared state** being compatible with the previous code |
| Can I roll back a migration? | Some. Never plan on it. See [database-migrations.md](database-migrations.md) |
| How fast should it be? | Faster than diagnosing. If rollback takes longer than a fix, nobody will use it |
| How do I know it works? | **You practised it.** An untested rollback is a hypothesis |

---

## Roll forward is usually right

Rolling back sounds safer and often is not:

| | Roll forward | Roll back |
| --- | ------------ | --------- |
| Data written by the new version | Stays valid | **May be unreadable by the old version** |
| Migration already applied | Compatible, by design | Compatible **only** if expand-only |
| Confidence | The fix is understood | The previous state is known good |
| Speed | One pipeline run | Usually faster, if it works |

Prefer roll-forward when the cause is understood and the fix is small; prefer rollback when the cause is *not* understood and you need to stop the bleeding. **"Stop the bleeding, then diagnose" is the right instinct**, provided rollback is genuinely available.

## What makes a deployment reversible

Four conditions, all required:

1. **The previous artifact still exists and is identifiable.** A digest or version id, not a tag that has since moved, and inside its retention window. See [artifacts-and-registries.md](artifacts-and-registries.md).
2. **The schema is compatible with the previous code.** Guaranteed by expand-only migrations, and by nothing else.
3. **Shared state is compatible.** Cache entry shapes, message formats, session data. The new version must not have written anything the old version cannot read.
4. **Configuration can go back too.** If the new version required a new configuration value, the old version must still start without it, or with it present and ignored.

Condition 3 is the one most often missed. A new version that writes a changed serialised object under an unchanged cache key has made rollback unsafe without touching the database at all.

## The database decides

```
Deploy N   ──> code N, schema expanded          <- rollback to N-1 is SAFE
Deploy N+1 ──> code N+1, schema contracted      <- rollback to N is NOT safe
```

Once a contract step has dropped a column, the previous code that read it cannot run. That is the whole argument for keeping expand and contract in separate releases: **it preserves a rollback window.** The size of that window is how many releases you can go back, and it is a deliberate design choice, not an accident.

For anything with a backfill, note that even a perfect schema rollback does not restore overwritten data. Keep the source column until you are certain.

## Rollback primitive per target

| Target | Primitive | Speed | Caveat |
| ------ | --------- | ----- | ------ |
| **Kubernetes** | `kubectl rollout undo` | Fast | Only within `revisionHistoryLimit`; **does not touch the database** |
| **Azure App Service** | **Swap slots back** | Very fast | Warm-up state and sticky sessions |
| **Azure Container Apps** | Shift traffic to the previous revision | Fast | Previous revision must still exist |
| **AWS ECS** | Update the service to the previous task definition | Moderate | Task definition revisions are retained |
| **VM / on-prem** | Reinstall the previous package | Slow | Depends on your own tooling |
| **Cloudflare Workers** | Deploy a previous **version** | Fast | **Only the last 100 uploaded versions** |
| **Cloudflare Containers** | Redeploy the previous Worker **and** image | Moderate | No single pointer covers both |

**`kubectl rollout undo` is the most over-trusted command in this table.** It reverts the pod template and nothing else: not the migration, not the ConfigMap if you changed it separately, not the data. It is a code rollback, and code is rarely the only thing that changed.

## Practise it

An untested rollback is a hypothesis. Make it routine:

- **Roll back in a pre-production environment on a schedule**, not just when something breaks.
- **Time it.** If rollback takes 25 minutes, people will attempt a hotfix instead, and you have the risk without the benefit.
- **Include a migration in the test.** Rolling back a code-only change proves the easy case.
- **Confirm the previous artifact is still fetchable**, which is the step that fails silently as retention expires.

## Version notes

- **`revisionHistoryLimit` defaults to 10** on Kubernetes Deployments. Setting it to a small number to reduce clutter shrinks the rollback window; that is a trade, not housekeeping.
- **Artifact retention limits the rollback window** on every platform. The default retention is usually shorter than the window teams assume.
- **Cloudflare Workers keeps the last 100 uploaded versions** eligible for deployment, so a busy repository uploading per commit can age out a known-good release.
- **Feature flags are the fastest rollback available** for anything they gate, because disabling a flag needs no deployment. See [deployment-strategies.md](deployment-strategies.md).
- **Not verified here:** every primitive above needs a live target. Cited from vendor documentation.

## Gotchas

- Agent treats `kubectl rollout undo` as a full rollback - it reverts the pod template only; migrations, config and data are untouched
- Agent plans rollback as the response to a bad migration - if the contract step ran, there is nothing to roll back to
- Agent rolls back code after the new version wrote incompatible cache or message data - the old version cannot read it
- Agent assumes the previous artifact is available - retention expires, and mutable tags no longer point where they did
- Agent shrinks `revisionHistoryLimit` for tidiness - that is the rollback window
- Agent never practises rollback - an untested rollback is a hypothesis, discovered during an incident
- Agent has a rollback slower than a hotfix - nobody will use it, so the capability is theoretical
- Agent forgets configuration - if the new version required a new setting, the old version must still start without it
- Agent relies on a Cloudflare version older than the last 100 uploads - no longer eligible
- Agent rolls back the code and leaves the migration, then reports the rollback as complete - the application is still broken, and the cause is now obscured

## Related

- [database-migrations.md](database-migrations.md) · [deployment-strategies.md](deployment-strategies.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [environments-and-promotion.md](environments-and-promotion.md) · [triage.md](triage.md) · [target-kubernetes.md](target-kubernetes.md) · [target-cloudflare-workers.md](target-cloudflare-workers.md) · [checklist.md](checklist.md)
