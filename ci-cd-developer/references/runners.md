# Runners

The machine your pipeline executes on. Two things matter: **what is installed on it** (because that silently determines build reproducibility) and **who can run code on it** (because a self-hosted runner is a foothold).

| Question | Answer |
| -------- | ------ |
| Hosted or self-hosted? | **Hosted** unless you need private network access, specific hardware, or licensed software |
| What is installed? | Read the runner-image manifest. **Do not assume** |
| Should I pin the image? | **Pin the OS version** where the toolchain matters. `latest` rolls between majors |
| Self-hosted on a public repository? | **Never.** Fork pull requests would execute on your infrastructure |
| How do I make self-hosted safe? | **Ephemeral runners**, one job per instance, no persistence |

---

## What is actually installed

Hosted runner images carry a large but specific toolset, and the contents change continuously. Relying on a pre-installed tool version without pinning it means the build changes when the image rolls, with no commit on your side.

**GitHub publishes the manifests** in the `actions/runner-images` repository, one README per image, listing every installed tool and version. Verified by listing that repository on this machine, the available Ubuntu images are:

```
Ubuntu2204-Readme.md      Ubuntu2204-Arm64-Readme.md
Ubuntu2404-Readme.md      Ubuntu2404-Arm64-Readme.md
Ubuntu2604-Readme.md      Ubuntu2604-Arm64-Readme.md
```

So `ubuntu-latest` is a **moving label across Ubuntu majors**, and there are arm64 variants. When a pipeline breaks with no commit to it, an image roll is one of the first hypotheses. See [triage.md](triage.md).

**The rule: never depend on a pre-installed toolchain version.** Install what you need explicitly:

```yaml
runs-on: ubuntu-24.04            # pin the OS, not `latest`
steps:
  - uses: actions/setup-java@dd06d9cba3e5552c54d9f8ea23572deb30010f7c  # v6.0.0
    with:
      java-version: '25'         # pin the tool, do not inherit it
      distribution: temurin
```

Pinning the OS costs you automatic upgrades, which is a trade: pin for reproducibility, and schedule the upgrade deliberately rather than receiving it unannounced.

## Hosted against self-hosted

| | Hosted | Self-hosted |
| --- | ------ | ----------- |
| Maintenance | None | **Yours**: patching, disk, runner version |
| Isolation | **Fresh VM per job** | Whatever you build |
| Private network access | No | **Yes** - the usual reason to choose it |
| Cost model | Per minute | Your infrastructure, plus operational time |
| Specific hardware or licences | No | **Yes** |
| Security posture | Strong by default | **Depends entirely on you** |

**Choose hosted by default.** The realistic reasons for self-hosted are: reaching a private network, hardware you cannot rent, licensed software tied to a machine, or a compliance requirement that data stays inside your boundary.

## Self-hosted security

A self-hosted runner executes arbitrary code from workflows. Treat it as a build machine with production network access, because that is usually what it is.

**Never attach a self-hosted runner to a public repository.** A fork pull request would execute attacker code on your infrastructure, and the default runner is *not* ephemeral, so state persists to the next job - including anything left behind deliberately. GitHub's own documentation is explicit about this, and it remains a common breach path.

For self-hosted done properly:

1. **Ephemeral.** One job per runner instance, then destroy it. `--ephemeral` registration, or a controller like Actions Runner Controller that creates a pod per job.
2. **Least network privilege.** A runner that can reach production databases is a lateral-movement path from any workflow.
3. **No long-lived credentials on the host.** Use OIDC federation so nothing is stored. See [oidc-and-secrets.md](oidc-and-secrets.md).
4. **Not on a machine with anything else.** Not a developer workstation, not a shared server.
5. **Restrict which repositories may use the pool**, and scope at organisation level rather than allowing every repository.

A persistent self-hosted runner accumulates: a poisoned dependency cache, a leftover credential in `~/.m2` or `~/.docker/config.json`, a modified PATH. Ephemeral removes the entire category.

## Concurrency, queueing and cost

Queue time is part of pipeline duration and is invisible in step timings. If a pipeline "takes 20 minutes" but the first job starts eight minutes in, the fix is capacity or concurrency limits, not the build.

- **Cancel superseded runs** on branches with `concurrency` and `cancel-in-progress`, but **never on deploys**. See [github-actions.md](github-actions.md).
- **Serialise per environment** with a fixed concurrency group, an exclusive lock, or `resource_group`.
- **Larger runners** trade money for wall-clock time; worth it for a genuinely CPU-bound build, wasteful for an I/O-bound one. Measure which you have.
- **Sharding multiplies fixed costs** - checkout, dependency restore, container startup - across every shard. See [caching.md](caching.md).

## Containers and services on runners

| Need | Hosted Linux | Hosted Windows / macOS |
| ---- | ------------ | ---------------------- |
| Docker | **Available** | Different or unavailable in the same form |
| Linux service containers | Available | No |
| Testcontainers | **Works** | Verify before relying on it |

**Testcontainers on a hosted Windows or macOS runner is not the same proposition as on Linux.** Check before designing a test strategy around it. See [testing-in-ci.md](testing-in-ci.md).

## Version notes

| | Status |
| --- | ------ |
| GitHub runner images | Ubuntu **22.04, 24.04, 26.04**, plus arm64 variants. Verified by listing `actions/runner-images` |
| `ubuntu-latest` | A moving label across Ubuntu majors |
| Azure DevOps | Microsoft-hosted images roll the same way; agent pools for self-hosted |
| GitLab | Shared runners on GitLab.com; self-managed runners with executor choice (docker, shell, kubernetes) |

- **GitLab's `shell` executor runs directly on the host** with no container isolation. Prefer the `docker` or `kubernetes` executor.
- **Runner image contents are documented per image**, not per platform. Read the manifest for the image you actually use.
- **Not verified here:** runner behaviour, queueing and installed toolchains were not exercised. Only the *list* of available images was verified through the GitHub API on this machine.

## Gotchas

- Agent depends on a pre-installed toolchain version - the image rolls and the build changes with no commit
- Agent uses `ubuntu-latest` where reproducibility matters - a moving label across Ubuntu majors
- Agent attaches a self-hosted runner to a public repository - fork pull requests execute on your infrastructure
- Agent runs a persistent self-hosted runner - state persists between jobs, including anything left deliberately
- Agent puts a self-hosted runner on a developer workstation or shared server - compromise reaches everything else on it
- Agent gives a runner network access to production - a lateral-movement path from any workflow
- Agent stores long-lived cloud credentials on a runner host - use OIDC federation and store nothing
- Agent uses GitLab's `shell` executor - no container isolation
- Agent ignores queue time when diagnosing a slow pipeline - it is invisible in step timings
- Agent assumes Docker and Testcontainers work identically on hosted Windows and macOS runners - they do not
- Agent buys larger runners for an I/O-bound build - pays for CPU that is not the constraint
- Agent shards aggressively without accounting for per-shard fixed costs - checkout and restore repeat every time

## Related

- [github-actions.md](github-actions.md) · [azure-devops.md](azure-devops.md) · [gitlab-ci.md](gitlab-ci.md) · [actions-security.md](actions-security.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [caching.md](caching.md) · [testing-in-ci.md](testing-in-ci.md) · [triage.md](triage.md) · [platform-versions.md](platform-versions.md) · [checklist.md](checklist.md)
