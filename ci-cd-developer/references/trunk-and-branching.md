# Trunk and Branching

Branching strategy is a **delivery constraint**, not a preference. A branching model that keeps work unmerged for weeks makes continuous delivery arithmetically impossible, whatever the pipeline does.

| Question | Answer |
| -------- | ------ |
| Which model? | **Trunk-based**: short-lived branches merged to one trunk, at least daily |
| How long may a branch live? | **A day or two.** Longer means the merge is a risk event |
| What about release branches? | Only if you genuinely support multiple versions in production |
| Git Flow? | Designed for versioned desktop software. **A poor fit for a continuously deployed service** |
| How do I ship incomplete work? | **Feature flags**, or build it behind an unreferenced entry point |

---

## Why branch lifetime is the whole argument

The cost of a merge grows with how long the branch has diverged, and it grows worse than linearly: more conflicts, and more *semantic* conflicts that merge cleanly and still break.

| Branch age | What merging is |
| ---------- | --------------- |
| Hours | A formality |
| A day or two | Ordinary |
| A week | An event that needs care |
| A month | A project, with its own risk and its own testing |

The DORA research reported in *Accelerate* is the evidence base for the connection between small batches, short-lived branches and delivery performance; that is where the four key metrics come from, and this skill does not re-derive them. See [dora-and-measurement.md](dora-and-measurement.md).

The mechanism is not mysterious: **long-lived branches mean the pipeline is testing a state that nobody will ever deploy.** A branch tested green in isolation says little about the merge result, so the guarantee CI offers is much weaker than it appears.

## Trunk-based, concretely

```
main  ──●──●──●──●──●──●──●──●──>   always releasable
         \    /    \    /
          ●──●      ●──●            branches measured in hours
```

- **One trunk**, always releasable, always the source of releases.
- **Short-lived branches** with a pull request, merged within a day or two.
- **Every merge triggers the full pipeline**, and a red trunk is everyone's problem.
- **Incomplete work ships disabled** rather than waiting on a branch.

"Always releasable" does not mean every commit is deployed. It means every commit *could* be, which is what makes a release a decision rather than a project.

## Feature flags are what make it work

Trunk-based development without a way to hide incomplete work degenerates into either long branches or half-finished features in production. Flags separate two questions people conflate:

| Question | Controlled by |
| -------- | ------------- |
| Is the code deployed? | The pipeline |
| Is the code **executing**? | The flag |

That separation is what makes rollback fast: disabling a flag needs no deployment, so the recovery path is a configuration change rather than a pipeline run. It is the fastest rollback available for anything a flag gates. See [rollback.md](rollback.md).

The costs are real and worth stating plainly:

- **Every flag is a branch in production**, and combinations multiply. Two flags mean four paths, and you are testing some of them and not others.
- **Stale flags are debt with operational risk.** A flag nobody remembers, defaulting to a path nobody tests, is a latent incident.
- **Flag state is configuration**, so it needs the same review and audit as any other production configuration. See [environments-and-promotion.md](environments-and-promotion.md).

Practical discipline: an owner and a removal date per flag, a review of flags older than a set age, and removal as part of finishing the feature rather than a separate task nobody schedules.

## Other patterns for incomplete work

Flags are not the only tool:

- **Branch by abstraction.** Introduce an interface, add the new implementation behind it, switch, remove the old. Good for large refactors that would otherwise need a long branch.
- **Expand and contract**, applied to any interface, not just a database schema. Add the new, migrate callers, remove the old. Same shape as [database-migrations.md](database-migrations.md).
- **Unreferenced code.** A new endpoint nobody routes to, or a screen with no navigation entry, is deployed and inert with no flag machinery at all. Often the simplest option.

## When a release branch is justified

Only when you genuinely support **multiple versions in production simultaneously** - a customer-managed or on-premises product where different customers run different versions, which is common in regulated work. See [target-vm-onprem.md](target-vm-onprem.md).

Then a release branch is a maintenance line: fixes land on trunk first and are **cherry-picked back**, never the reverse. Fixing on the release branch and forward-porting is how a fix gets lost.

For a continuously deployed service, a release branch is usually a symptom that trunk is not trusted to be releasable, and the fix is the pipeline rather than the branching model.

## Git Flow, honestly

Git Flow was designed for software with explicit versioned releases and multiple supported versions. Its `develop`, `release/*` and `hotfix/*` branches exist to manage exactly that.

For a service deployed several times a week it adds ceremony and delay: an extra integration branch that must itself be tested, releases that are batch events, and hotfixes that need a separate path because the normal path is too slow. **If the normal release path is too slow to fix a production problem, that is the defect to address.**

## Version notes

- **Protect trunk** with required checks and a linear or squash-merge history: GitHub rulesets, Azure DevOps branch policies, GitLab protected branches.
- **Squash merge** keeps trunk history readable and makes revert trivial, at the cost of losing intermediate commits. For short-lived branches that loss is small.
- **Merge queues** (GitHub) test the merge result rather than the branch, which closes the "green in isolation, broken after merge" gap. Worth enabling on a busy trunk.
- **Conventional Commits interacts with squash merging**: the squash commit message becomes the versioning input, so enforce the convention on the **pull request title**. See [versioning.md](versioning.md).
- **Not verified here:** no measurement. The DORA findings are cited, not reproduced.

## Gotchas

- Agent keeps a branch alive for weeks - the merge becomes a risk event, and CI was testing a state nobody will deploy
- Agent adopts trunk-based development with no way to hide incomplete work - either long branches return or half-finished features ship enabled
- Agent adds feature flags with no owner or removal date - each stale flag is an untested path in production
- Agent treats flag state as outside change control - it is production configuration and deserves the same review
- Agent uses Git Flow for a continuously deployed service - ceremony, batch releases, and a hotfix path that exists because the normal path is too slow
- Agent creates a release branch because trunk is not trusted - fix the pipeline, not the branching model
- Agent fixes on a release branch and forward-ports - the fix eventually gets lost; land on trunk and cherry-pick
- Agent relies on a green branch build as evidence the merge is safe - it is not; use a merge queue
- Agent enforces Conventional Commits on commits but squash-merges - the squash message is what versioning reads, so enforce on the PR title
- Agent reaches for a feature flag where unreferenced code would do - flag machinery for something already inert

## Related

- [pipeline-design.md](pipeline-design.md) · [dora-and-measurement.md](dora-and-measurement.md) · [deployment-strategies.md](deployment-strategies.md) · [versioning.md](versioning.md) · [rollback.md](rollback.md) · [quality-gates.md](quality-gates.md) · [environments-and-promotion.md](environments-and-promotion.md) · [database-migrations.md](database-migrations.md) · [book-deltas.md](book-deltas.md)
