# Artifacts and Registries

Where the promotable thing lives, and what its identity is. Get this wrong and build-once-promote-many is unenforceable no matter how the pipeline is written.

| Rule | Why |
| ---- | --- |
| **A released version is immutable** | Overwriting a release makes every deployment record a guess |
| **Promote by content address** | A digest cannot be repointed; a tag can |
| **`latest` is not a version** | It names whatever was pushed last, which is not a fact about your release |
| **Retention must exceed your rollback window** | A rollback target that has been garbage-collected is not a rollback target |
| **One registry per trust boundary** | Not per environment. Promote by copying, not rebuilding |

---

## Identity: digest against tag

| | Tag | Digest |
| --- | --- | ------ |
| Mutable | **Yes** | No |
| Human-readable | Yes | No |
| Safe to promote | **No** | **Yes** |
| Correct use | Discovery and convenience | The pipeline's internal identity |

Use both, for different purposes: tag for humans (`v1.4.2`, `2026-09-08-abc1234`), digest for the pipeline. Every stage after build consumes the digest.

```bash
# build stage: emit the digest
digest=$(docker buildx build --push -q -t "$REG/app:$VERSION" .)
echo "image=$REG/app@$digest" >> "$GITHUB_OUTPUT"

# every later stage: consume it
docker pull "$REG/app@$digest"
```

**A pipeline that pushes `:latest` and deploys `:latest` has no artifact identity at all.** Two runs racing means production gets whichever finished last, and nothing records which commit that was.

## Immutability

Configure the registry to reject overwriting an existing tag. Most support it: ECR tag immutability, Azure Container Registry locks, GitLab and GitHub package retention policies, Nexus and Artifactory release repositories.

Two consequences worth wanting:

1. **A re-run cannot silently replace a released artifact.** It fails loudly, which is correct: the release already happened.
2. **A deployment record becomes a fact.** "Production runs `app@sha256:abc`" stays true.

`SNAPSHOT` or pre-release repositories are the deliberate exception, and precisely why they must never be cached or deployed. See [caching.md](caching.md).

## Retention against the rollback window

These two settings must be reasoned about together and usually are not:

```
rollback window you promise  <=  artifact retention
```

Default retention is often 30 or 90 days, and teams assume they can roll back to "any recent release". Check the actual policy, and be explicit that a release older than retention is not a rollback target. See [rollback.md](rollback.md).

Retention rules worth setting deliberately:

| Artifact class | Retention |
| -------------- | --------- |
| Release artifacts | Long, often indefinite, at least as long as anything in production |
| Main-branch builds | Weeks |
| Pull request builds | Days, or do not publish them at all |
| Test reports and logs | Long enough for an incident review |
| SBOM and attestations | **As long as the artifact.** They are evidence and useless separated from it |

## Promotion between registries

For separate trust boundaries - a public build registry and a locked-down production one - promotion is a **copy of the same bytes**, never a rebuild:

```bash
# copy by digest, preserving content identity
crane copy "$DEV_REG/app@$digest" "$PROD_REG/app@$digest"
# or: skopeo copy docker://... docker://...
```

**Copy by digest and verify the digest is unchanged afterwards.** A copy that re-tags is fine; a copy that rebuilds or recompresses changes the digest and breaks every signature and attestation pointing at the original. See [provenance-and-signing.md](provenance-and-signing.md).

Do not create one registry per environment. Environments are a deployment concept; registries are a trust and access concept. One registry with immutable digests serves many environments.

## Coordinates and layout

Whatever the ecosystem, the artifact needs a coordinate you can resolve later:

| Ecosystem | Coordinate | Immutability |
| --------- | ---------- | ------------ |
| OCI image | `registry/repo@sha256:…` | Digest is inherently immutable |
| Maven | `group:artifact:version` | Release repositories reject redeploy |
| npm | `name@version` | Published versions cannot be replaced |
| Generic package | Path plus checksum | Whatever you enforce |

**Include the commit SHA in the human-facing version or as a label.** Going from a running artifact back to its source commit is the first step in every investigation, and if it requires guesswork the investigation starts badly.

```dockerfile
LABEL org.opencontainers.image.revision="$GIT_SHA"
LABEL org.opencontainers.image.source="https://github.com/org/repo"
```

## Version notes

| | Notes |
| --- | ----- |
| OCI | Digests are content addresses; a **multi-arch manifest list has its own digest**, and that is what you promote and sign |
| `actions/upload-artifact` | **v7.0.1**, `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| Retention | Platform and plan dependent. Verify rather than assuming |
| `crane`, `skopeo` | Copy images between registries without a Docker daemon, which suits CI |

- **On a multi-arch build, promote and sign the manifest list digest**, not a per-architecture digest, or verification at deploy time will fail.
- **Attestations and SBOMs must travel with the artifact** and share its retention. Evidence separated from the thing it describes is worthless.
- **Not verified here:** registry behaviour, retention and cross-registry copying were not exercised on this machine. Cited from tool and registry documentation.

## Gotchas

- Agent pushes and deploys `:latest` - no artifact identity; concurrent runs mean production gets whichever finished last
- Agent promotes by tag - the tag can be repointed between stages
- Agent rebuilds when moving between registries - new digest, broken signatures and attestations; copy the bytes
- Agent creates one registry per environment - environments are a deployment concept, registries a trust concept
- Agent leaves default retention in place while promising a longer rollback window - the rollback target is garbage collected
- Agent publishes pull request builds to the release registry - fills it with undeployable artifacts, and on forks it is a security problem
- Agent stores the SBOM or attestation separately with shorter retention - evidence detached from the artifact proves nothing
- Agent allows tag overwrite on a release repository - every deployment record becomes a guess
- Agent caches or deploys a `SNAPSHOT` - mutable by definition
- Agent omits the commit SHA from the image - the artifact-to-source path requires guesswork
- Agent signs a per-architecture digest on a multi-arch build - deploy-time verification resolves the manifest list and fails

## Related

- [containers.md](containers.md) · [pipeline-design.md](pipeline-design.md) · [provenance-and-signing.md](provenance-and-signing.md) · [sbom.md](sbom.md) · [rollback.md](rollback.md) · [environments-and-promotion.md](environments-and-promotion.md) · [versioning.md](versioning.md) · [caching.md](caching.md) · [checklist.md](checklist.md)
