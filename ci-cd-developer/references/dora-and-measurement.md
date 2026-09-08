# DORA and Measurement

How to tell whether a pipeline is any good, using four metrics that have an actual evidence base rather than an opinion behind them.

**Provenance, stated plainly.** These come from the DORA research programme, reported in *Accelerate* (Forsgren, Humble and Kim, 2018) and the annual State of DevOps reports. This skill **cites** that research; it does not reproduce it. Nothing on this page was measured on this machine, and the correlations reported are theirs, not a claim derived here.

| Metric | Question it answers | Where the data comes from |
| ------ | ------------------- | ------------------------- |
| **Deployment frequency** | How often do we ship? | Deployment records per environment |
| **Lead time for changes** | Commit to production, elapsed | Commit timestamp against deploy timestamp |
| **Change failure rate** | What share of deploys cause a problem? | Incidents and rollbacks over deploys |
| **Time to restore service** | How long from detection to recovery? | Incident open and close times |

---

## Why these four and not others

They are chosen to be **hard to game as a set**, because they pull against each other:

- Optimise deployment frequency alone and change failure rate rises.
- Optimise change failure rate alone and you deploy monthly, so lead time collapses.
- **The finding that makes the research interesting is that throughput and stability move together** rather than trading off, once batch size shrinks and automation is real.

That last point is the one worth internalising, because the intuition "we must slow down to be safe" is precisely what the data contradicts. Small, frequent, well-tested changes are both faster and safer than large infrequent ones.

**Anything measuring individuals is not on this list**, and adding such a metric will corrupt these four. Lines of code, commits per developer and story points are gameable, and gaming them damages exactly what these metrics track.

## Instrumenting them from pipeline data

You have the data already; it is a matter of recording deployments as events.

**Deployment frequency** - count deployment records per environment per week. All three platforms record deployments against an environment, which is another reason to use the environment feature rather than a bare job. See [environments-and-promotion.md](environments-and-promotion.md).

**Lead time for changes** - the useful definition is *commit authored* to *running in production*:

```
lead_time = deploy_completed_at - commit_authored_at
```

Report the **median and the 90th percentile**, never the mean. A mean is dominated by the one change that sat in a branch for three weeks, which tells you about that branch rather than about the system. Deriving this requires the deployment record to carry the commit SHA, which is another reason to label artifacts with it. See [versioning.md](versioning.md).

**Change failure rate** - deployments causing degradation, over total deployments. The definition needs deciding locally and then holding still: rollbacks plus incidents plus hotfixes-within-an-hour is a workable proxy. **A rollback is not automatically a failure** - a canary aborted by an alarm is the system working - so decide whether to count it and be consistent.

**Time to restore** - detection to recovery, not report to close. If it is measured from the ticket being closed it will measure administrative habits instead.

## Reading them honestly

| Reading | Likely meaning |
| ------- | -------------- |
| Low frequency, low failure rate | Often **large batches and fear**, not quality. Check lead time |
| High frequency, high failure rate | Automation without adequate gates. See [quality-gates.md](quality-gates.md) |
| Low lead time, high failure rate | Gates too weak, or flaky tests being retried through |
| Good median lead time, terrible p90 | A subset of work is stuck. Usually long-lived branches or a slow approval |
| Excellent everything, unhappy team | Check what is not measured: toil, on-call load, manual steps |

**The p90 lead time is where the interesting information lives.** A team with a 2 hour median and a 3 week p90 has a bimodal process: routine changes flow and a category of change does not. Finding that category is more valuable than improving the median.

## What these metrics do not tell you

Worth stating, because they get over-applied:

- **Nothing about whether you built the right thing.** A team shipping the wrong feature quickly scores well.
- **Nothing about code quality directly**, only about the consequences that reach production.
- **Nothing about security posture.** A pipeline with no scanning and no provenance can score perfectly. That is why the security half of this skill exists independently.
- **Nothing comparable between organisations.** Definitions vary enough that cross-company comparison is noise. Compare against your own trend.

## Pipeline metrics worth tracking alongside

These are not DORA metrics but they are the levers you actually pull:

| Metric | Why |
| ------ | --- |
| **Pipeline duration, p50 and p90** | Lead time's largest controllable component |
| **Queue time** | Invisible in step timings, and often the real cost. See [runners.md](runners.md) |
| **Flake rate** | Directly corrupts change failure rate, because retries hide real failures |
| **Cache hit rate** | The usual explanation for a slow pipeline. See [caching.md](caching.md) |
| **Gate override rate** | A routinely overridden gate is misconfigured. See [quality-gates.md](quality-gates.md) |
| **Time from a merged dependency PR to deployed** | How quickly a security fix actually reaches production |

That last one is the metric regulated work cares about most and almost nobody tracks: a CVE fixed in a dependency is only fixed when it is **running**, not when it is merged.

## Version notes

- **The four key metrics** are from the DORA programme, reported in *Accelerate* (2018) and subsequent State of DevOps reports. Later reports have added and revised supporting metrics, including a reliability dimension.
- **Definitions vary between tools.** Any DevOps platform's built-in "DORA metrics" dashboard uses its own definitions; read them before trusting a comparison.
- **This skill does not hold the primary source.** *Accelerate* was not among the books available when this file was written, so the four metrics are named and their instrumentation described, but no figures, thresholds or performance-band boundaries are quoted from it. See [book-deltas.md](book-deltas.md).
- **Not verified here:** nothing. This page is entirely citation and instrumentation guidance.

## Gotchas

- Agent quotes DORA performance bands or specific thresholds - **this skill does not hold the source**; name the metrics, do not invent the numbers
- Agent reports mean lead time - dominated by one stale branch; use median and p90
- Agent measures lead time from pull request opened rather than commit authored - hides the time work sat unmerged
- Agent measures time to restore from ticket closure - measures administrative habit, not recovery
- Agent counts every rollback as a change failure - a canary aborted by an alarm is the system working
- Agent adds an individual-productivity metric alongside these - gameable, and gaming it corrupts the four
- Agent reads low deployment frequency plus low failure rate as healthy - often large batches and fear; check lead time
- Agent treats good DORA metrics as evidence of a secure pipeline - they say nothing about scanning or provenance
- Agent compares their numbers against another organisation's - definitions differ enough that it is noise
- Agent optimises the median lead time and ignores p90 - the stuck category of work is where the information is
- Agent does not track time from dependency fix to deployed - the metric that actually matters for a CVE

## Related

- [pipeline-design.md](pipeline-design.md) · [trunk-and-branching.md](trunk-and-branching.md) · [quality-gates.md](quality-gates.md) · [flaky-tests.md](flaky-tests.md) · [caching.md](caching.md) · [runners.md](runners.md) · [dependency-updates.md](dependency-updates.md) · [environments-and-promotion.md](environments-and-promotion.md) · [book-deltas.md](book-deltas.md)
