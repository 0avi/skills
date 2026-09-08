# Versioning

Giving an artifact a name a human can reason about. The pipeline's internal identity is a digest; the version is for people, changelogs, support conversations and dependency ranges.

| Question | Answer |
| -------- | ------ |
| Which scheme? | **SemVer** for anything others depend on. **CalVer** or a build number for a deployed application |
| Who decides the number? | **The commits**, via Conventional Commits, or a human for a release. Not a manual edit in a file |
| Where does it live? | A git **tag**, immutable, plus the artifact's metadata |
| Do applications need SemVer? | Usually not. Nobody declares a dependency range on your web app |
| What about the commit SHA? | **Always include it**, whatever the scheme |

---

## Choose the scheme by who consumes it

| Consumer | Scheme | Why |
| -------- | ------ | --- |
| A library other teams depend on | **SemVer** (`1.4.2`) | The contract is about compatibility, which is what SemVer encodes |
| A deployed application | **CalVer** (`2026.09.1`) or build number | Nobody expresses a range against it; date or sequence is more informative |
| A container image | Both: a semantic or calendar tag **plus** an immutable per-commit tag | Humans read one, the pipeline uses the other |
| An internal shared module | SemVer | Same contract argument as a public library |

**SemVer on a deployed application is usually ceremony.** Deciding whether a UI change is a minor or a patch consumes real argument and informs no decision, because no consumer resolves a range. A date plus a sequence answers "which release is this" faster.

The one exception: if you support multiple concurrent versions in production for different customers, you need semantic version identity because compatibility is now a real question.

## SemVer, the part people get wrong

`MAJOR.MINOR.PATCH`, where the increment is determined by **the effect on consumers**, not by the effort involved:

- **MAJOR**: an existing consumer must change something.
- **MINOR**: new capability, existing consumers unaffected.
- **PATCH**: a fix, existing consumers unaffected.

A large refactor with no API change is a **patch**. A one-character change to a default value that alters behaviour is a **major**. Effort and version increment are unrelated, and conflating them is the standard error.

`0.x` means anything can break at any time; taking a production dependency on `0.x` and expecting stability is a misreading of the scheme.

## Conventional Commits

Derive the version from the commits so nobody edits a version by hand:

```
feat(billing): add VAT breakdown to invoices        -> MINOR
fix(auth): reject expired refresh tokens            -> PATCH
refactor(core): extract fee calculator              -> PATCH
feat(api)!: remove deprecated /v1/orders            -> MAJOR (the !)

BREAKING CHANGE: /v1/orders removed, use /v2/orders -> MAJOR (footer)
```

What this buys, and it is more than tidiness:

1. **The version is computed**, so it cannot drift from what shipped.
2. **The changelog is generated** from the same source, so it cannot be forgotten.
3. **Breaking changes are declared at commit time**, by the person who knows.

What it costs: a commit-message convention that has to be enforced, or it decays within weeks. Enforce it with a lint gate on the pull request title or commits. Half-followed Conventional Commits produce a *wrong* computed version, which is worse than no automation, because it is trusted.

## Tags

```bash
git tag -a v1.4.2 -m "Release 1.4.2"
git push origin v1.4.2
```

- **Annotated tags**, not lightweight - they carry an author, date and message.
- **Immutable.** Never move a release tag. A moved tag makes every record referencing it a guess. Protect release tags at the platform level so a force-push cannot rewrite them.
- **A tag is not an artifact.** The tag names a commit; the artifact is what the pipeline built from it, identified by digest. Keep both and record the mapping. See [artifacts-and-registries.md](artifacts-and-registries.md).

## Always carry the commit SHA

Whatever the scheme, the artifact must state which commit produced it. Going from a running deployment back to source is the first step of every investigation:

```dockerfile
LABEL org.opencontainers.image.version="2026.09.1"
LABEL org.opencontainers.image.revision="abc1234def..."
LABEL org.opencontainers.image.source="https://github.com/org/repo"
```

Expose it at runtime too - a `/actuator/info` endpoint, a startup log line, a build-info file. "Which version is production running" should be answerable in seconds without consulting the pipeline.

## Monorepo against polyrepo

| | Polyrepo | Monorepo |
| --- | -------- | -------- |
| Version scope | One per repository | **Per package**, or one for everything |
| Tag format | `v1.4.2` | `billing-v1.4.2` |
| Release trigger | Any change | **Only changed packages** |
| Tooling | Built into most release tools | Changesets, Nx, Lerna, or custom |

The monorepo decision that matters: **one version for everything, or a version per package?** One version is simple and releases unchanged packages, which is harmless for applications and noisy for libraries. Per-package versioning is more accurate and needs change detection, which means path filtering in the pipeline and a tool that understands the dependency graph.

**Decide before the first release**, because migrating a tag scheme later is painful.

## Pre-release and build metadata

```
1.4.2-rc.1        pre-release: sorts BEFORE 1.4.2
1.4.2+build.573   build metadata: IGNORED in precedence
```

The second is the trap: **`+build` metadata is excluded from version comparison** by the SemVer specification. Two artifacts differing only in build metadata are the *same version* as far as any resolver is concerned, so it cannot be used to distinguish two builds of one version. If you need that distinction, use a pre-release identifier or a separate immutable tag.

## Version notes

| | Notes |
| --- | ----- |
| SemVer | **2.0.0** is the current specification |
| Conventional Commits | **1.0.0** |
| Maven | `-SNAPSHOT` is Maven's own pre-release concept and is **mutable**; never deploy or cache one |
| npm | Full SemVer including ranges; `npm version` manages the tag |
| OCI | Use annotation labels for version and revision |

- **Maven `SNAPSHOT` is not a SemVer pre-release.** It is a mutable moving target, which is why it must never be deployed or cached. See [caching.md](caching.md).
- **`+build` metadata is ignored in precedence.** Do not use it to distinguish builds.
- **Not verified here:** no release tooling was executed for this skill. The specifications are cited.

## Gotchas

- Agent applies SemVer to a deployed application - argument about minor against patch, with no consumer to benefit
- Agent increments MAJOR for a large refactor with no API change - version reflects consumer impact, not effort
- Agent takes a production dependency on `0.x` expecting stability - `0.x` means anything can break
- Agent adopts Conventional Commits without enforcement - decays quickly, and then computes a **wrong** version that is trusted
- Agent edits a version in a file by hand alongside automation - the two drift, and the artifact disagrees with the tag
- Agent moves a release tag - every record referencing it becomes a guess
- Agent uses a lightweight tag for a release - no author, date or message
- Agent treats the tag as the artifact identity - the tag names a commit; the artifact is a digest
- Agent omits the commit SHA from the artifact - artifact-to-source needs guesswork at the worst moment
- Agent uses `+build` metadata to distinguish two builds - **ignored in SemVer precedence**; they compare equal
- Agent deploys a Maven `SNAPSHOT` - mutable, so what is deployed cannot be identified
- Agent defers the monorepo versioning decision - migrating a tag scheme after the first release is painful

## Related

- [artifacts-and-registries.md](artifacts-and-registries.md) · [pipeline-design.md](pipeline-design.md) · [trunk-and-branching.md](trunk-and-branching.md) · [environments-and-promotion.md](environments-and-promotion.md) · [dependency-updates.md](dependency-updates.md) · [containers.md](containers.md) · [checklist.md](checklist.md)
