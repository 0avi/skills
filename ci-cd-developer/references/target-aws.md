# Target: AWS ECS and Fargate

Container deployment on AWS. The key mental model is that **the deployable unit is a task definition revision**, not an image - which adds one level of indirection compared with Kubernetes.

| The four questions | Answer |
| ------------------ | ------ |
| **How does an artifact become running code?** | Register a **task definition revision** referencing the image digest, then update the service |
| **How is configuration injected?** | Task definition environment variables, plus `secrets` referencing Secrets Manager or SSM |
| **What is the rollback primitive?** | Update the service to the **previous task definition revision** |
| **What is the zero-downtime primitive?** | Rolling update with a load balancer health check, or **CodeDeploy** for blue-green and canary |

---

## Task definition revisions

```bash
# 1. render a new revision with the new image digest
aws ecs register-task-definition --cli-input-json file://taskdef.json

# 2. point the service at it
aws ecs update-service --cluster prod --service app \
  --task-definition app:42

# 3. WAIT, and fail if it does not stabilise
aws ecs wait services-stable --cluster prod --services app
```

Two points that decide whether the pipeline is honest:

- **Step 3 is not optional.** `update-service` returns as soon as the API accepts the change. Without `services-stable` the pipeline reports success while tasks may be failing and rolling back. Note `wait` has its own timeout behaviour, so treat a non-zero exit as a failed deploy.
- **The task definition is the artifact of record.** Keep the rendered JSON in version control or as a pipeline artifact, because "which revision is production running, and what was in it" is the first question in any investigation.

**Reference the image by digest** in the task definition - but not for the reason usually given, and an earlier draft of this file gave the wrong one.

Current ECS resolves tags to digests **at deployment time** and reuses that digest for subsequent tasks. The container definition parameter **`versionConsistency` defaults to `enabled`**, and with it ECS pins the resolved digest for the rest of the service's tasks and for future updates. So the "a scaling event weeks later pulls a different image" drift **does not happen by default** on current ECS.

It can still happen, and these are the cases to check: `versionConsistency` explicitly set to `disabled`, digest resolution failing repeatedly at deployment, or a container agent older than the versions that support the feature. Referencing the digest yourself remains the better practice because it makes the identity explicit in the task definition you keep as a record - not because ECS would otherwise drift.

## Health checks: two independent ones

| Check | Owner | Consequence of failure |
| ----- | ----- | ---------------------- |
| **Load balancer target group health check** | ALB/NLB | Target removed from rotation |
| **ECS container health check** | ECS agent | Container marked unhealthy, task replaced |

Both matter and they are configured separately. The load balancer check is what governs whether traffic reaches a task, so it is the one that determines zero-downtime behaviour.

Settings that decide whether a rollout drops requests:

- **`healthCheckGracePeriodSeconds`** on the service. For a JVM application that takes 40 seconds to start, a grace period shorter than that means ECS kills tasks before they can ever pass, producing an infinite replacement loop.
- **Deregistration delay** on the target group - the drain window. Must exceed your longest request or in-flight requests are cut.
- **`stopTimeout`** on the container, and the application must handle `SIGTERM` by draining.

## Rolling update tuning

```
minimumHealthyPercent: 100     # never dip below capacity
maximumPercent: 200            # allow double during the roll
```

`minimumHealthyPercent: 100` with `maximumPercent: 200` gives capacity-preserving rollouts, at the cost of headroom during the deploy. The default (`100`/`200` for most launch types) is usually reasonable; `minimumHealthyPercent: 50` will deliberately run at half capacity mid-rollout.

## CodeDeploy for blue-green and canary

ECS rolling updates are simple but give no traffic control. **CodeDeploy** adds it:

| Configuration | Behaviour |
| ------------- | --------- |
| `AllAtOnce` | Shift everything immediately |
| `Canary10Percent5Minutes` | 10%, wait 5 minutes, then the rest |
| `Linear10PercentEvery1Minute` | Incremental shift |

It works by managing two target groups and shifting listener rules, giving a real blue-green with a **bake time** during which CloudWatch alarms can trigger an automatic rollback. That automatic rollback on an alarm is the feature worth adopting: it converts a canary from "someone watches a dashboard" into an actual control.

The prerequisite is an alarm that genuinely detects the failure. A canary with no alarm is a partial deployment. See [deployment-strategies.md](deployment-strategies.md).

## Identity: OIDC, not access keys

```yaml
permissions:
  id-token: write
steps:
  - uses: aws-actions/configure-aws-credentials@<sha>
    with:
      role-to-assume: arn:aws:iam::123456789012:role/deploy
      aws-region: eu-west-2
```

**Never store an AWS access key in CI.** Federate, and bind the IAM role's trust policy to the narrowest subject claim - ideally `repo:org/repo:environment:production` with `StringEquals`. A trust policy using `StringLike` with a wildcard is the standard way this becomes an org-wide grant to production. See [oidc-and-secrets.md](oidc-and-secrets.md).

The task itself should use a **task role** for its own AWS access, never embedded credentials.

## Configuration and secrets

```jsonc
// in the task definition
"environment": [{ "name": "TIER", "value": "prod" }],
"secrets": [{
  "name": "DB_PASSWORD",
  "valueFrom": "arn:aws:secretsmanager:eu-west-2:123:secret:prod/db-AbC123"
}]
```

The `secrets` block makes the ECS agent fetch the value at task start, so the secret is never in the task definition, never in the pipeline log, and rotates in one place. **Use it rather than putting values in `environment`.**

Note that a task definition is **immutable once registered** and is visible to anyone with `ecs:DescribeTaskDefinition`. Anything placed in `environment` is effectively permanently disclosed to those principals.

## ECR

- **Enable tag immutability** so a tag cannot be repointed.
- **Enable scan on push**, and route base-image findings to the base image rather than the application team. See [scanning.md](scanning.md).
- **Set a lifecycle policy** that retains untagged images long enough for rollback, since a digest-referenced image that gets expired breaks both rollback and scaling.

That last point is a real trap: an aggressive lifecycle policy can delete an image a running task definition still references.

## Version notes

- **The deployable unit is a task definition revision**, not an image. Rollback means the previous revision.
- **`aws ecs wait services-stable` has a bounded timeout**; a timeout is not proof of failure but must be treated as one.
- **`versionConsistency` defaults to `enabled`**, so ECS resolves a tag to a digest at deployment and pins it. Referencing the digest yourself is still better for the audit trail, but tag drift on scaling is not the default risk it is often described as.
- **ECR lifecycle policies can expire images a task definition references**, breaking rollback and scaling.
- **Not verified here:** no AWS account available. All cited from AWS documentation; CLI shapes change, so verify against the current CLI.

## Gotchas

- Agent runs `update-service` and does not wait for stability - the pipeline reports success while tasks fail and roll back
- Agent references the image by tag and records nothing - ECS pins the resolved digest by default, so drift is unlikely, but the task definition then does not state which image actually ran
- Agent sets `healthCheckGracePeriodSeconds` shorter than startup time - tasks are killed before they can pass, looping forever
- Agent leaves deregistration delay shorter than the longest request - in-flight requests are cut on every rollout
- Agent does not handle `SIGTERM` - requests dropped on task replacement
- Agent puts a secret in `environment` - permanently visible to anyone who can describe the task definition
- Agent stores an AWS access key in CI - federate instead
- Agent writes an IAM trust policy with `StringLike` and a wildcard - an org-wide grant to production
- Agent calls a CodeDeploy canary a control with no CloudWatch alarm - nothing triggers the rollback
- Agent sets an aggressive ECR lifecycle policy - can delete an image a live task definition references
- Agent leaves ECR tags mutable - a tag can be repointed under a running service
- Agent does not keep the rendered task definition - "what was in revision 42" becomes unanswerable

## Related

- [deployment-strategies.md](deployment-strategies.md) · [rollback.md](rollback.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [containers.md](containers.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [scanning.md](scanning.md) · [database-migrations.md](database-migrations.md) · [environments-and-promotion.md](environments-and-promotion.md) · [checklist.md](checklist.md)
