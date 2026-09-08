# Dependency Updates

Automated dependency updates are what make SHA pinning and digest pinning sustainable. Without them, pinning becomes staleness, and a stale pin is a security problem wearing a security control's clothing.

| Question | Answer |
| -------- | ------ |
| Renovate or Dependabot? | **Renovate** for control, grouping and non-package updates. **Dependabot** if you want zero setup |
| What should automerge? | **Patch and minor for dev dependencies with green CI.** Not production majors |
| How do I survive the noise? | **Group and schedule.** Ungrouped daily PRs get ignored, which defeats the point |
| Do they update pinned action SHAs? | **Yes, both** - and they maintain the version comment |
| What about a CVE with no fix? | Record a decision with a review date. Do not block delivery |

---

## Renovate against Dependabot

| | Renovate | Dependabot |
| --- | -------- | ---------- |
| Setup | `renovate.json` | Native on GitHub, minimal config |
| Grouping | **Excellent** - arbitrary rules | Limited |
| Scheduling | **Precise** - cron-like windows | Daily/weekly/monthly |
| Automerge | **Rich conditions**, including a minimum age | Basic |
| Non-package updates | **Dockerfile bases, GitHub Action SHAs, Terraform, Helm** | Actions and packages |
| Dependency dashboard | **Yes** - one issue summarising everything | No |
| Platform | GitHub, GitLab, Azure DevOps, Bitbucket | GitHub (and GitLab, differently) |

**Renovate's grouping and scheduling are the reason to choose it**, because they are what make the output survivable. Dependabot's advantage is that it needs almost no configuration, which is a real advantage for a small repository.

Since the platforms differ, Renovate is also the only option that behaves consistently across GitHub Actions, Azure DevOps and GitLab.

## Configuration that survives contact

```jsonc
{
  "extends": ["config:recommended"],
  "timezone": "Europe/London",
  "schedule": ["after 9pm on saturday"],
  "prConcurrentLimit": 5,
  "packageRules": [
    {
      "description": "Dev tooling: batch it and merge it",
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["minor", "patch"],
      "groupName": "dev dependencies",
      "automerge": true
    },
    {
      "description": "Action SHAs: one PR, weekly",
      "matchManagers": ["github-actions"],
      "groupName": "github actions",
      "pinDigests": true
    },
    {
      "description": "Never automerge a production major",
      "matchUpdateTypes": ["major"],
      "automerge": false,
      "labels": ["needs-review"]
    },
    {
      "description": "Let a release settle before adopting it",
      "matchUpdateTypes": ["minor", "patch"],
      "minimumReleaseAge": "3 days"
    }
  ],
  "vulnerabilityAlerts": { "schedule": ["at any time"], "labels": ["security"] }
}
```

Five decisions in there, each earning its place:

- **`schedule`** keeps routine churn out of working hours, so pull requests do not compete with feature work.
- **`prConcurrentLimit`** stops thirty open PRs, which is the state in which everyone stops reading them.
- **`groupName`** turns twenty PRs into one, and one reviewable PR beats twenty ignored ones.
- **`minimumReleaseAge`** is the underrated one: it avoids adopting a release in the window where a compromised or broken publish is discovered. Three days costs nothing and has repeatedly mattered.
- **`vulnerabilityAlerts` bypassing the schedule** - security updates should not wait for Saturday.

## Automerge, safely

Automerge is safe in proportion to how much your CI actually proves. Requirements before enabling it:

1. **Tests that would catch a breaking change**, and a suite without meaningful flake. A flaky suite plus automerge means retries eventually merge something broken. See [flaky-tests.md](flaky-tests.md).
2. **Never automerge majors** into production dependencies.
3. **`minimumReleaseAge` of a few days**, so a bad publish is caught upstream first.
4. **Automerge into the default branch, not directly to a release branch.**

| Update | Automerge? |
| ------ | ---------- |
| Dev dependency patch/minor | **Yes** |
| Production dependency patch | Yes, with good tests |
| Production dependency minor | Cautiously |
| Any major | **No** |
| Action SHA for the same version tag | **Yes** - this is exactly what makes pinning sustainable |
| Base image digest, same tag | Yes |

That second-to-last row is the important one: a pinned action SHA is only maintainable if something bumps it automatically. Pinning without automation produces a workflow frozen on a two-year-old action, which is worse than a floating tag. See [actions-security.md](actions-security.md).

## Keeping pins fresh

Both tools understand the pinned-SHA-with-comment convention:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
```

They update the SHA **and** the trailing comment together. Renovate's `pinDigests` will also convert floating tags to pinned digests for you, which is the cheapest way to adopt pinning across many repositories.

The same applies to container base images, which is what makes digest-pinning a base image practical. See [containers.md](containers.md).

## Triaging a CVE

A vulnerability alert is not automatically an emergency. Establish, in order:

1. **Is it reachable?** A vulnerability in a code path you never call is a lower priority than one on your request path. Reachability analysis, where the tooling offers it, changes the answer materially.
2. **Is it in a runtime or a build dependency?** A test-only dependency is not in the deployed artifact.
3. **Is there a fix?** If yes, take it. If no, you need a decision, not a blocked pipeline.
4. **Is there a mitigation?** Configuration, a WAF rule, disabling a feature.

**Then record the decision with a review date.** An accepted risk with no review date is a forgotten risk, and it will be found by an auditor rather than by you.

**Do not block the pipeline on an unfixable finding.** Within a week the gate is disabled, and then the fixable finding two months later is missed too. See [quality-gates.md](quality-gates.md).

## Version notes

| | Notes |
| --- | ----- |
| Renovate | Self-hosted or the hosted app; config schema is versioned and `config:recommended` changes over time |
| Dependabot | `.github/dependabot.yml`; grouping support has improved but remains narrower than Renovate's |
| `minimumReleaseAge` | Renovate; earlier configurations used `stabilityDays` |
| Both | Update pinned action SHAs and their version comments |

- **`config:base` was renamed `config:recommended`** in Renovate. Older configurations still reference the old name.
- **Renovate's defaults change** as `config:recommended` evolves; pin the preset if you need stability.
- **Not verified here:** neither tool was run for this skill. Cited from their documentation.

## Gotchas

- Agent pins action SHAs and adds no update automation - the workflow freezes on a stale action, which is worse than a floating tag
- Agent enables automerge with a flaky suite - retries eventually merge something broken
- Agent automerges production majors - the one category that reliably breaks things
- Agent leaves updates ungrouped and unscheduled - thirty open PRs, all ignored, so the mechanism provides nothing
- Agent omits `prConcurrentLimit` - the same outcome by a different route
- Agent adopts releases the moment they publish - no window for a compromised or broken publish to be caught; set `minimumReleaseAge`
- Agent schedules security updates alongside routine ones - a critical fix waits for Saturday
- Agent blocks the pipeline on an unfixable CVE - the gate gets disabled, and the next fixable one is missed
- Agent treats every CVE as an emergency without checking reachability or whether it is a build-only dependency
- Agent accepts a risk with no review date - a forgotten risk found later by an auditor
- Agent uses `config:base` - renamed to `config:recommended`
- Agent expects Dependabot to update Terraform or Helm - Renovate covers more ecosystems

## Related

- [actions-security.md](actions-security.md) · [scanning.md](scanning.md) · [sbom.md](sbom.md) · [quality-gates.md](quality-gates.md) · [containers.md](containers.md) · [flaky-tests.md](flaky-tests.md) · [versioning.md](versioning.md) · [platform-versions.md](platform-versions.md) · [checklist.md](checklist.md)
