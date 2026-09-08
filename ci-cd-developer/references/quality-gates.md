# Quality Gates

A gate is a claim that something was checked. The design question is not "what can we check" but **"what is worth blocking on"**, because a blocking gate that is routinely overridden does more damage than no gate at all.

| Gate | Block or report? |
| ---- | ---------------- |
| Compile / typecheck | **Block.** Deterministic, unambiguous |
| Unit and integration tests | **Block.** Unless flaky, in which case fix the flake |
| Known-vulnerable dependency **with a fix available** | **Block** |
| Secret detected in the diff | **Block**, and treat as an incident |
| Migration marked destructive | **Block** pending explicit acknowledgement |
| Coverage **decrease** | Report, with a floor |
| New lint categories on legacy code | Report |
| Vulnerability with no available fix | **Report.** Blocking achieves nothing but stops all delivery |
| Bundle size increase | Report, with a hard ceiling |

---

## Block only what is deterministic

The test for a blocking gate: **given the same commit, does it always give the same answer, and is that answer unambiguous?**

- Compilation: yes. Block.
- A test suite: yes, if it is not flaky. Block, and treat flakiness as the defect it is.
- "Coverage dropped 0.3%": deterministic but not unambiguous - it can drop because you deleted a well-tested dead file. Report.
- A dependency CVE with no patch: unambiguous but not actionable. Blocking stops all delivery and fixes nothing.

Heuristic checks belong in the pull request as **information**, not as a barrier.

## The override problem

Two failure modes, and the second is the expensive one:

1. **A gate too weak to catch anything.** Wastes minutes, provides false confidence.
2. **A gate everyone bypasses.** Teaches the team that gates are obstacles rather than signals, and the habit generalises to the gates that matter.

So watch the **override rate**. A required check overridden more than occasionally is misconfigured: either the threshold is wrong or the check is measuring the wrong thing. Fix or remove it. A gate nobody can remember overriding is doing its job.

## Coverage, done in a way that survives

Coverage is the most-abused gate in CI. An absolute threshold fails in both directions: too low and it never fires, too high and it blocks legitimate work, and either way people write assertion-free tests to satisfy it.

What works better:

```
1. A floor, set at or slightly below current coverage, that may never fall
2. Coverage on NEW AND CHANGED lines, reported on the pull request
3. Ratchet the floor upward deliberately, never automatically
```

**Coverage of changed lines is the useful number**, because it answers "did this change bring tests" rather than "is the whole codebase well tested". An automatic ratchet sounds appealing and produces a threshold nobody chose, which eventually blocks a refactor for no reason.

And the standing caveat: coverage measures *execution*, not *assertion*. A suite with 90% coverage and no assertions covers everything and tests nothing.

## Vulnerability gates that do not stop delivery

Gate on **actionability**, not on severity alone:

| Finding | Action |
| ------- | ------ |
| Critical or high, fix available, in a runtime dependency | **Block** |
| Critical or high, no fix available | **Report**, record a decision, set a review date |
| Any severity in a build-only or test-only dependency | Report. Not in the deployed artifact |
| Findings in the base image | Route to the base image update, not to the application team |

Blocking on "any high severity" is the classic mistake: within a week the pipeline is red for something unfixable, the gate is disabled, and the genuinely fixable finding two months later is missed. See [scanning.md](scanning.md) and [dependency-updates.md](dependency-updates.md).

## Gates worth having that teams usually lack

- **Destructive migration acknowledgement.** Grep the diff for `DROP`, `TRUNCATE`, `RENAME`, `ALTER COLUMN ... TYPE` and `SET NOT NULL`; require a label. Cheap, and it catches the one-step rename that review fatigue misses. See [database-migrations.md](database-migrations.md).
- **Reproducibility check.** Build twice, compare hashes. Three lines, and it verifies build-once-promote-many is real. See [java-build.md](java-build.md).
- **Secret scanning on the diff**, with push protection.
- **Architecture tests** (ArchUnit and equivalents) - deterministic, so safe to block on.
- **A "no new `TODO` without an issue reference"** style check, if the codebase has a problem with them. Trivial, and only worth it where the problem is real.

## Where gates go in the pipeline

Cheapest first, so feedback is fast:

| Stage | Gates |
| ----- | ----- |
| Pre-commit / pre-push (local) | Format, fast lint. **Never the only place** a check runs |
| Pull request | Compile, unit tests, lint, changed-line coverage report, secret scan, destructive-migration check |
| Main branch | Full suite, integration tests, SBOM, scan, reproducibility |
| Pre-promotion to production | Attestation verification, approval with context |

**A check that runs only in a pre-commit hook is not a gate**, because hooks are local, skippable and frequently not installed. Hooks are a convenience; CI is the gate.

## Approvals as gates

A human approval is only a control if the approver can see what they are approving: the artifact digest, the diff against what is deployed, test and scan results, and **whether a migration will run**.

An approval button with no context trains people to click it and manufactures an audit trail implying a review that did not happen. That is worse than no approval, because it is now evidence. See [environments-and-promotion.md](environments-and-promotion.md).

## Version notes

- **Branch protection and required checks** exist on all three platforms with different names: GitHub required status checks and rulesets, Azure DevOps branch policies, GitLab merge request approval rules and protected branches.
- **Coverage tooling** (JaCoCo, Istanbul) reports differently for changed lines; some platforms need a dedicated action or bot to comment the delta.
- **`continue-on-error: true`** on GitHub makes a step non-blocking while still reporting, which is the mechanism for a report-only gate. Note it also marks the job as successful, so a fan-in job cannot distinguish it.
- **Not verified here:** branch protection and required-check behaviour need a hosted platform and an organisation.

## Gotchas

- Agent blocks on every high-severity finding regardless of fix availability - the pipeline is red for something unfixable within a week, then the gate gets disabled
- Agent sets an absolute coverage threshold - blocks legitimate refactors and encourages assertion-free tests
- Agent ratchets coverage automatically - produces a threshold nobody chose, which eventually blocks work for no reason
- Agent treats coverage as a measure of test quality - it measures execution, not assertion
- Agent adds a blocking gate and never checks the override rate - a routinely-overridden required check is misconfigured and corrosive
- Agent puts a check only in a pre-commit hook - hooks are local and skippable; that is not a gate
- Agent blocks on a heuristic check - report heuristics, block determinism
- Agent has no destructive-migration gate - the one-step `DROP COLUMN` reaches production through review fatigue
- Agent never verifies reproducibility - build-once-promote-many is asserted rather than checked
- Agent presents an approval with no diff, digest or migration status - manufactures an audit trail
- Agent uses `continue-on-error` for a report-only gate and then relies on a fan-in job to catch failures - the job reports success either way

## Related

- [pipeline-design.md](pipeline-design.md) · [flaky-tests.md](flaky-tests.md) · [testing-in-ci.md](testing-in-ci.md) · [scanning.md](scanning.md) · [dependency-updates.md](dependency-updates.md) · [database-migrations.md](database-migrations.md) · [java-build.md](java-build.md) · [environments-and-promotion.md](environments-and-promotion.md) · [checklist.md](checklist.md)
