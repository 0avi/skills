# Flaky Tests

A flaky test passes and fails on the same commit. The technical fixes are ordinary; the reason flakiness persists is that the **cheap response - retry until green - converts a known failure into an unknown risk**, and it feels like progress.

| Question | Answer |
| -------- | ------ |
| First move? | **Confirm it is flake**: re-run the same commit unchanged |
| Is a retry acceptable? | As a **temporary, visible, tracked** measure. Never as the resolution |
| Quarantine? | Yes, with an owner and a deadline. Quarantine without either is deletion with extra steps |
| Why does it matter so much? | A suite with flake teaches the team to ignore red, and then a real failure is ignored too |
| Where do they come from? | Time, order, concurrency, shared state, and the network. In that order |

---

## The retry trap

```
test fails ──> add retry ──> green ──> ship
```

What just happened: a test detected something at least once, and you decided not to find out what. Sometimes it was a race in the test. Sometimes it was a race in the **production code**, which is now shipping.

The distinction matters because the symptom is identical. A retry cannot tell you which one you had, and it removes the evidence.

**A defensible retry policy:**

- Retry at the **test** level, never the whole job. Re-running a job hides which test was unstable.
- Retry **once**, not three times. If once is not enough it is not flake, it is broken.
- **Record every retry**, and treat the count as a tracked metric with a downward target.
- **Never retry a test that guards something dangerous** - money, authorisation, data deletion. There, a single failure is a stop signal.

If retries are invisible, the suite silently degrades until nobody trusts it.

## Confirm it is flake

Re-run the **same commit** with no changes. Then classify:

| Observation | Cause | Fix |
| ----------- | ----- | --- |
| Passes on re-run, nothing changed | Genuine flake | Below |
| Fails only when the suite runs in parallel | Shared state: fixture, port, database row, temp file | Isolate per test |
| Fails only in CI, passes locally | Environment: timezone, locale, file ordering, CPU count, no display | Pin them in CI |
| Fails at a particular time of day | Date boundary, or an external scheduled job | Inject a clock |
| Fails on the first run and passes after | Warm-up, lazy init, or a cache the first run populates | Explicit setup |
| Fails only on a slower runner | Fixed sleeps rather than waits | Await a condition |

**"Passes locally, fails in CI" is almost never CI's fault.** It is usually that CI has a different timezone, locale, filesystem ordering, or core count, and the test depended on one of them without saying so.

## The five sources, in order of frequency

**1. Time.** `Instant.now()` in code under test, a test asserting "today", a timeout that is fine on a fast machine. Inject a `Clock` and set it. Never assert on wall-clock elapsed time.

**2. Order.** A test that passes only after another has run has an undeclared dependency. Randomise order in CI so the dependency surfaces immediately rather than during an unrelated refactor.

**3. Concurrency in the test.** `Thread.sleep(500)` waiting for something asynchronous is a race with a comfortable margin, and CI removes the margin. Wait for the condition, with a generous timeout.

**4. Shared state.** One database, one Redis, one port, one temp directory, several parallel tests. Give each test its own schema, its own key prefix, an ephemeral port, and a unique temp directory. See [testing-in-ci.md](testing-in-ci.md).

**5. The network.** A test hitting a real external service is not a test, it is a monitor. Stub it, and keep one deliberate contract test that is allowed to be slow and is not gating.

## Quarantine, properly

Quarantine buys time without keeping the suite red. It only works with both halves:

```
1. Tag the test as quarantined; exclude it from the gating suite
2. Keep RUNNING it, reporting, non-blocking
3. Assign an owner and a deadline
4. At the deadline: fixed, or deleted
```

**Step 2 is what distinguishes quarantine from deletion.** A quarantined test that stops running provides nothing while implying coverage exists. **Step 3 is what stops the quarantine list growing forever**; without a deadline, the list is where tests go to die quietly.

If a test is quarantined and nobody will own it, delete it. An unowned quarantined test is a lie about coverage, and deleting it is at least honest.

## Detection

You cannot manage what you do not measure. Two mechanisms:

- **Re-run the suite on an unchanged commit**, on a schedule (nightly is enough). Anything that fails is flake by definition, with no ambiguity.
- **Track pass/fail per test across runs.** Any test with a mixed record on identical commits is flaky. Most CI platforms and test reporters support this, and it turns flake from anecdote into a list.

Then keep **the flake rate** as a number people see. A suite with a published flake rate gets fixed; one where flakiness is folklore does not.

## Version notes

- **JUnit 5** has no built-in retry; `@RepeatedTest` is not a retry. Use an extension, and make retries visible.
- **Surefire and Failsafe** support `rerunFailingTestsCount`, which retries at the test level - preferable to a job-level retry.
- **Playwright and Cypress** have first-class retry and trace-on-retry, which is genuinely useful for diagnosing a flake rather than hiding it.
- **`fail-fast: false`** on a matrix is worth setting while chasing flake, so you see every failing combination rather than the first. See [github-actions.md](github-actions.md).
- **Not verified here:** no flake measurement was performed for this skill. The classification table is standard practice.

## Gotchas

- Agent adds a retry as the first response - converts a known failure into unknown risk, and may be shipping a real race
- Agent retries at job level - hides which test was unstable, and re-runs everything
- Agent retries three times - if once is not enough, the test is broken, not flaky
- Agent makes retries invisible - the suite degrades silently until nobody trusts red
- Agent retries a test guarding money, authorisation or deletion - a single failure there is a stop signal
- Agent blames CI for "passes locally, fails in CI" - it is usually timezone, locale, file ordering or core count
- Agent uses `Thread.sleep` to wait for async work - a race with a margin that CI removes; await the condition
- Agent quarantines a test and stops running it - that is deletion while implying coverage
- Agent quarantines with no owner or deadline - the list grows forever
- Agent keeps a test that calls a real external service in the gating suite - that is a monitor, and it will fail for reasons unrelated to the change
- Agent never re-runs an unchanged commit - flake stays anecdotal and unprioritised
- Agent leaves tests order-dependent - passes today, fails after an unrelated refactor reorders them

## Related

- [testing-in-ci.md](testing-in-ci.md) · [quality-gates.md](quality-gates.md) · [triage.md](triage.md) · [pipeline-design.md](pipeline-design.md) · [github-actions.md](github-actions.md) · [java-build.md](java-build.md) · [checklist.md](checklist.md)
