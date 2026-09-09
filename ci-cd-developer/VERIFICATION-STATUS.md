# Verification Status

Working notes on what in this skill is **measured** against **cited**, and what is needed to close each remaining gap. Kept separate from [SKILL.md](SKILL.md) and [references/book-deltas.md](references/book-deltas.md) so the skill itself stays clean: `book-deltas.md` carries the permanent record, this file carries the to-do list.

Last updated 2026-09-09.

---

## What is left

| # | Gap | What is needed |
| - | --- | -------------- |
| 1 | **Hosted runner behaviour** - the largest remaining cited block | The push blocker resolved, then a throwaway repo. Converts Actions `permissions` scoping, OIDC token minting, environments, approvals, artifact attestations and cache hit rates from cited to measured. Costs Actions minutes only |
| 2 | **The continuous delivery canon** | Legitimate copies of *Continuous Delivery* (Humble & Farley), *Accelerate*, *Continuous Delivery Pipelines* (Farley), *Grokking Continuous Delivery* (Wilson). An O'Reilly subscription covers the first two. Unblocks the spine and lets [references/dora-and-measurement.md](references/dora-and-measurement.md) carry real figures |
| 3 | **Cloud accounts** | Any free-tier or sandbox account for AWS, Azure and Cloudflare. Their behavioural claims are now doc-sourced and precise, but not executed |
| 4 | **Finish the adversarial audit** | 102 of 115 audit agents died on an individual spend limit. It resumes from cache once the limit resets |
| 5 | **Multi-node cluster behaviour** | `maxSurge`/`maxUnavailable` capacity effects under real traffic, GitOps reconciliation, admission-controller enforcement. Needs a multi-node cluster and load |

Everything else that was open has been closed. **Kubernetes and the registry are now measured, not cited.**

## Measured

Run on this machine, with a control wherever a control was meaningful. Method recorded in [references/book-deltas.md](references/book-deltas.md).

### Kubernetes, on a live kind cluster running v1.37.0

| Claim | Result |
| ----- | ------ |
| `kubectl rollout status` is a real gate | Exit **0** healthy, exit **1** on an unpullable image (`ImagePullBackOff`) |
| Readiness gates Service endpoints | 2 pods `Running` with `ready=false`; Service reported **`ready=0`, `notReady=2`** |
| Liveness restarts the container | **`restartCount` reached 4** in ~70s |
| `rollout undo` is pod-template only | Image reverted `3.9` to `3.10`; the ConfigMap changed in the same release **stayed at `v2`** |
| `revisionHistoryLimit` is literally the rollback window | With limit 2 after 4 revisions, **revision 1's ReplicaSet was deleted** |
| An initContainer migration races itself | `replicas: 3` gave **3** executions; a `Job` gave **1** |
| `--record` is deprecated, not removed | kubectl **v1.36.1**: warns, **exits 0**, updates the deployment. Hidden from `--help`. The annotation replacement populates `CHANGE-CAUSE` |

### Registry, digests and signing, against a live `registry:3`

| Claim | Result |
| ----- | ------ |
| A tag is not an identity | Two builds pushed to `:prod` produced digests `0f465b78…` then `5b0c6a56…`; the **old digest stayed pullable** |
| A signature binds to a digest | `cosign verify` exit **0** on the signed digest, exit **10** on the other digest in the same repository |
| A second scanner agrees | trivy **20 findings** on `alpine:3.22` (2 High, 6 Medium, 12 Low), **all** target type `alpine`, none from the application |

### Containers, builds and SBOMs

| Claim | Result |
| ----- | ------ |
| A secret `COPY`ed then `rm`ed survives | `tmp/secret.txt` plaintext in one layer, `tmp/.wh.secret.txt` whiteout in a later one. **Control:** `--mount=type=secret` gave 0 layers |
| Multi-stage removes the compiler | `bin/javac` in 1 layer single-stage, **0** multi-stage; 150,408,486 against 116,814,934 bytes; `Config.User` root against `10001` |
| Maven reproducibility comes from one property | Identical SHA-256 twice with `project.build.outputTimestamp`; **two different hashes** without. mtimes advanced, proving real rebuilds |
| A source SBOM misses the base image | syft: **1** component for the source tree, **1,263** for the image |
| Base-image packages are the findings | grype: **326 findings, 321 deb + 5 go-module (both base image), 0 application** |
| syft's SBOM defaults lag the standards | CycloneDX **1.7** (current), SPDX **2.3** (standard is 3.0.1) |
| SPDX 3.0 has no `spdxVersion` key | 3.0.1 is JSON-LD: `@context` + `@graph` |
| cosign v3 breaks v2 recipes | Three v2 invocations failed; the working offline form found by experiment |
| Action tags resolve to current SHAs | `actions/checkout` is at **v7**, not the v3 in tutorials |
| `ubuntu-latest` spans Ubuntu majors | 22.04, 24.04, 26.04 all present in `actions/runner-images` |
| `act` runs workflows with a local git context | Ran to success with **`GITHUB_SHA` empty** |

## Corrections made to this skill

Nine claims in earlier drafts were wrong. Recorded because the skill's credibility rests on saying so.

**Found by internal audit** (three upheld findings, each confirmed by 2-or-3 of 3 independent refuters):

1. `scanning.md` said "98.5% of findings came from the base image" while its own table showed 321 deb + 5 go-module + 0 application = 326. Both categories are base-image, so the share is **100%**.
2. `gitlab-ci.md`'s flagship example had `needs: [test]` on the deploy job while the jar comes from `build` - and the same file documents that `needs` restricts artifact download. The example deployed nothing.
3. `github-actions.md` put `cancel-in-progress: true` at **workflow** level in an example containing a production deploy, contradicting its own next section, its gotcha list, checklist A59 and `runners.md`.

**Found by doc research** (all high confidence, vendor documentation):

4. **Azure Container Apps secrets** - the claim was **inverted**. Secrets are application-scoped, so a change creates **no** revision and running replicas keep the old value until restarted.
5. **Cloudflare `rollout_step_percentage`** - values are **cumulative and must end at 100**, so the default is `[10, 100]`, not "10% then 90%". Writing `[10, 90]` would strand instances.
6. **Cloudflare Containers and Docker** - Docker is needed only when `image` is a Dockerfile; a registry reference needs none. The blanket claim was wrong for this file's own recommended shape.
7. **ECS tag drift** - `versionConsistency` defaults to `enabled`, so ECS resolves tags to digests at deployment. The "scaling event pulls a different image" risk is not the default.
8. **Kubernetes `preStop`** - `SIGTERM` is **not** concurrent with endpoint removal; `preStop` completes first, which is precisely why the sleep works. `terminationGracePeriodSeconds` must cover `preStop` **plus** drain.
9. **Kubernetes `maxUnavailable: 0`** - guarantees an *availableReplicas count*, not serving capacity. Without a real readiness probe a pod counts Available before it can serve, and capacity dips anyway.

**One audit hypothesis was refuted by measurement:** that `--record` had been removed from kubectl. It has not; it warns and works on v1.36.1.

## Unverified audit findings

The audit's verifier agents died on the spend limit, so several findings show as "refuted" with **zero votes** - that is missing evidence, not refutation. Items 4 to 7 above came from that list and were confirmed by research. The remainder are settled. When the audit is re-run, treat any zero-vote verdict as unexamined.

## A diagnosis I got wrong, twice

Recorded as a caution about method.

Kubernetes verification failed three times before succeeding. I attributed it first to memory pressure, then to a `kind`/Docker-Desktop incompatibility, and finally wrote into this file that "the Docker Desktop daemon has degraded - container creation succeeds, container start does not". **All three were wrong**, and the third was asserted from an exit code whose stderr I had suppressed with `2>&1 >/dev/null`.

The actual cause was the first guess: `docker info` reports **Total Memory 7.75 GiB**, and a kind control plane could not start alongside ten development containers. With those stopped, the cluster came up in **60 seconds**. The `rc=125` I read as a daemon fault was a port conflict from my own earlier attempt.

**The lesson, which applies to the whole skill:** diagnose from the error message, not the exit code. Had the user not asked "what error exactly", a false claim would have been committed.

## Ready-to-run scripts

In the session scratchpad, not the repo. All three have been executed successfully:

```
scratchpad/cicd/verify_k8s.sh          6 Kubernetes experiments
scratchpad/cicd/verify_registry.sh     tag/digest, cosign, multi-arch, trivy
scratchpad/cicd/verify_containers.sh   secret layers, multi-stage, sizes
```

## Related

- [SKILL.md](SKILL.md) · [references/book-deltas.md](references/book-deltas.md) · [references/platform-versions.md](references/platform-versions.md)
