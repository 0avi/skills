# Platform Versions

The file to consult before quoting a version. Everything here was resolved or observed on this machine, with the method stated so you can reproduce or dispute it.

**These move.** Re-resolve rather than copying, and prefer the commands below to the tables.

---

## Action versions and SHAs

Resolved through the GitHub API on this machine:

| Action | Tag | Commit SHA |
| ------ | --- | ---------- |
| `actions/checkout` | **v7.0.1** | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-java` | **v6.0.0** | `dd06d9cba3e5552c54d9f8ea23572deb30010f7c` |
| `actions/cache` | **v6.1.0** | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| `actions/upload-artifact` | **v7.0.1** | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |

```bash
# reproduce, for any action
a=actions/checkout
tag=$(curl -sSL "https://api.github.com/repos/$a/releases/latest" \
      | python -c "import sys,json;print(json.load(sys.stdin)['tag_name'])")
curl -sSL "https://api.github.com/repos/$a/git/ref/tags/$tag" \
      | python -c "import sys,json;print(json.load(sys.stdin)['object']['sha'])"
```

**Calibration point:** the widely-circulated tutorial value is `actions/checkout@v3`, and the current major is **v7**. Any material showing v3 is four majors stale, which is the practical argument for automated SHA bumping rather than manual pinning. See [dependency-updates.md](dependency-updates.md).

## Runner images

Verified by listing `actions/runner-images` on this machine. Available Ubuntu image documents:

```
Ubuntu2204-Readme.md    Ubuntu2204-Arm64-Readme.md
Ubuntu2404-Readme.md    Ubuntu2404-Arm64-Readme.md
Ubuntu2604-Readme.md    Ubuntu2604-Arm64-Readme.md
```

So **`ubuntu-latest` is a moving label across Ubuntu majors**, and arm64 variants exist. Each README lists every installed tool and its version, which is the authoritative answer to "what is on the runner".

```bash
# what is actually installed on a given image
curl -sSL "https://api.github.com/repos/actions/runner-images/contents/images/ubuntu"
```

Never depend on a pre-installed toolchain version; install it explicitly. See [runners.md](runners.md).

## Standards and specifications

| Standard | Current | Notes |
| -------- | ------- | ----- |
| **SLSA** | **v1.1** (approved April 2025) | v1.2 in progress. GitHub documents its attestations against **v1.0** |
| **CycloneDX** | **1.7** | **ECMA-424**, 2nd edition December 2025 |
| **SPDX** | **3.0.1** (December 2024) | **ISO/IEC 5962:2021**. 3.x is JSON-LD, not flat JSON |
| **NIST SSDF** | **SP 800-218 v1.1** | States goals; SLSA states mechanism |
| **SemVer** | 2.0.0 | `+build` metadata is ignored in precedence |
| **Conventional Commits** | 1.0.0 | |

**The SLSA version skew is worth flagging at point of use:** GitHub's Artifact Attestations documentation cites SLSA **v1.0** Build Levels, while the specification is at **v1.1**. The Build-track definitions are compatible but the version numbers do not match. See [provenance-and-signing.md](provenance-and-signing.md).

## Tools, as installed and exercised here

| Tool | Version | Exercised? |
| ---- | ------- | ---------- |
| **syft** | **1.51.1** (built 2026-08-27) | **Yes** - SBOM generation, output versions read back |
| **cosign** | **v3.1.3** (go1.26.4) | **Yes** - offline sign and verify, with a tampering control |
| **act** | **0.2.89** | **Yes** - a workflow parsed and run to success in Docker |
| **Docker** | **29.7.2** | **Yes** - images built; secret-in-layers, multi-stage and `Config.User` measured |
| **Maven** | **3.9.16** | **Yes** - reproducible build measured with a control |
| **grype** | **0.118.0** | **Yes** - scanned a real runtime image; 326 findings classified by package type |
| **trivy** | **0.74.0** | Installed, not used for a published figure |
| **kind** | **0.33.0** | Installed; **cluster creation did not complete** on this host under load |
| **Node / npm** | **25.8.0** / **11.11.0** | Present, not exercised |
| **kubectl** | **v1.36.1** | Client only; no cluster reached |
| `gradle`, `gh`, cloud CLIs | not installed | No |

### What syft emits, measured

| Requested | Emitted |
| --------- | ------- |
| `cyclonedx-json` (default) | **1.7** |
| `cyclonedx-json@1.6` | 1.6 |
| `spdx-json` (default) | **SPDX-2.3** - lags the 3.0.1 standard |
| `spdx-json@3.0` | **SPDX 3.0.1 JSON-LD** (`@context` + `@graph`, no `spdxVersion` key) |

```bash
# check your own toolchain rather than trusting the table
syft dir:. -o spdx-json=/tmp/s.json && python -c \
  "import json;d=json.load(open('/tmp/s.json'));print(d.get('spdxVersion') or list(d)[:3])"
```

### cosign v3 breaking changes, measured

| v2-era invocation | Result on v3.1.3 |
| ----------------- | ---------------- |
| `sign-blob --key k --tlog-upload=false` | **Fails**: `must specify --bundle with --new-bundle-format` |
| `--signing-config` together with `--tlog-upload=false` | **Fails** - and cosign's own error message recommends this combination |
| `--signing-config <tlog-less>` `--new-bundle-format` `--bundle` | **Works** |
| `verify-blob` without `--insecure-ignore-tlog=true` | Fails against Rekor with a 400 that reads like a signature error |

## Platform status

| Platform | Status |
| -------- | ------ |
| **GitHub Actions** | Continuous delivery; nothing to pin. `::set-output::` and `save-state` deprecated |
| **Azure DevOps** | **YAML only** for new investment since 2023. Classic pipelines maintenance-mode |
| **GitLab CI** | Versioned with the instance. `rules` current, `only`/`except` legacy, **`CI_JOB_JWT` removed** |
| **Cloudflare** | Ships frequently. Workers: two versions per gradual deployment, last 100 eligible. Containers: `lite` default instance type, 10%/90% rollout, `SIGTERM` plus 15 minutes |
| **Renovate** | `config:base` renamed **`config:recommended`**; `stabilityDays` renamed `minimumReleaseAge` |

## Version notes

- **Everything above was resolved on Windows x64.** Action SHAs and standards versions are platform-neutral; tool availability and behaviour are not.
- **No cloud account and no hosted runner** was available, so every cloud and hosted-runner statement in this skill is cited from vendor documentation rather than measured.
- **A local `kind` cluster was attempted and abandoned.** `kind` 0.33.0 pulled `kindest/node:v1.37.0` successfully but stalled at "Preparing nodes" on a host already running 10 development containers. Kubernetes claims therefore remain cited. This is a host-capacity limitation, not a tooling one, and is the cheapest remaining gap to close.
- **Dates matter for standards.** CycloneDX 1.7 and SPDX 3.0.1 are recent; a tool built before them cannot emit them.
- **The measurements have a date.** Re-run the reproduction commands rather than trusting a table that ages.

## Gotchas

- Agent copies an action SHA from this table months later - re-resolve; tags and SHAs move
- Agent quotes `actions/checkout@v3` from a tutorial - four majors stale
- Agent depends on a pre-installed runner toolchain version - the image rolls without a commit on your side
- Agent treats `ubuntu-latest` as a fixed OS - it moves across Ubuntu majors
- Agent claims "SLSA L3" without naming the specification version - GitHub and slsa.dev currently cite different ones
- Agent assumes `spdx-json` means current SPDX - measured, the default is 2.3
- Agent detects SPDX by the `spdxVersion` key - absent in 3.0 JSON-LD
- Agent copies a pre-v3 `cosign` recipe - measured to fail on v3.1.3
- Agent cites this skill's tool versions as authoritative for another machine - they describe this one
- Agent uses Renovate `config:base` or `stabilityDays` - both renamed
- Agent references GitLab `CI_JOB_JWT` - removed

## Related

- [actions-security.md](actions-security.md) · [github-actions.md](github-actions.md) · [runners.md](runners.md) · [sbom.md](sbom.md) · [provenance-and-signing.md](provenance-and-signing.md) · [dependency-updates.md](dependency-updates.md) · [platform-matrix.md](platform-matrix.md) · [book-deltas.md](book-deltas.md) · [checklist.md](checklist.md)
