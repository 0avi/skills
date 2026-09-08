# Containers

Building an image in CI. The image is the artifact for most targets in this skill, so its identity, size and contents are delivery concerns rather than packaging details.

| Practice | Apply blind? |
| -------- | ------------ |
| Multi-stage build, so build tools are absent from the runtime image | **Yes** |
| Reference by **digest** downstream, never by tag | **Yes** |
| Run as a non-root user | **Yes** |
| `.dockerignore` covering `.git`, `target/`, `node_modules/` | **Yes** |
| Order layers so dependencies precede source | **Yes** |
| Distroless or minimal base | Usually, with a debugging plan |
| Registry-backed build cache | Measure. It can cost more than it saves |

---

## Digests are the identity

A tag is a mutable pointer. A digest is the content address.

```bash
# capture the digest at build time, and pass that forward
digest=$(docker buildx build --push -t "$REG/app:$SHA" -q .)
echo "image=$REG/app@$digest" >> "$GITHUB_OUTPUT"
```

Every downstream stage - scan, sign, deploy - must consume `app@sha256:…`, not `app:latest` or `app:main`. If a scan runs against a tag and the deploy resolves the same tag later, they can be different images and the scan result is meaningless. This is [pipeline-design.md](pipeline-design.md)'s build-once rule expressed in registry terms.

**Also pin your base image by digest**, for the same reason applied upstream:

```dockerfile
FROM eclipse-temurin:25-jre@sha256:...    # not :25-jre
```

Then let Renovate bump it, so pinning does not become staleness. See [dependency-updates.md](dependency-updates.md).

## Multi-stage, and layer order

```dockerfile
# ---- build ----
FROM maven:3.9-eclipse-temurin-25@sha256:... AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -B -o dependency:go-offline || mvn -B dependency:go-offline   # cached layer
COPY src ./src
RUN mvn -B -Dproject.build.outputTimestamp=$BUILD_DATE package -DskipTests

# ---- runtime ----
FROM eclipse-temurin:25-jre@sha256:...
RUN useradd -r -u 10001 app
USER 10001
COPY --from=build /src/target/app.jar /app/app.jar
ENTRYPOINT ["java","-jar","/app/app.jar"]
```

Two things are doing work here. **Copying `pom.xml` before `src`** means a source-only change reuses the dependency layer, which is the single biggest build-time win available. And the runtime stage contains no Maven, no JDK compiler, no source, so the deployed image cannot be used to build and has a smaller attack surface.

**Reproducibility carries into the image.** Pass the same timestamp used in [java-build.md](java-build.md); otherwise the jar inside the image differs per build and so does the image digest, even with identical inputs.

## Size, and why it matters here

Image size is a delivery property, not vanity: it is pull time on every node during every rollout, and it is the number of packages a scanner will find.

| Base | Rough size | Trade-off |
| ---- | ---------- | --------- |
| `eclipse-temurin:25` (full JDK) | Largest | Never for runtime; it ships a compiler |
| `eclipse-temurin:25-jre` | Moderate | Sensible default |
| `-alpine` variants | Smaller | musl libc: different DNS and locale behaviour, occasional native-library breakage |
| Distroless | Small | **No shell.** `kubectl exec` debugging is gone; plan for ephemeral debug containers |
| `jlink` custom runtime | Smallest | Extra build complexity, must enumerate modules |

**Alpine is not a free win for the JVM.** musl differs from glibc in DNS resolution and locale handling, and native dependencies may not have musl builds. Choose it deliberately or stay on the standard JRE image.

## Buildpacks against a Dockerfile

| | Dockerfile | Buildpacks (`bootBuildImage`, `pack`) |
| --- | --------- | ------------------------------------- |
| Control | Total | Convention-driven |
| Base image updates | You bump it | Rebase without rebuilding the app |
| Reproducibility | Yours to arrange | Handled by the lifecycle |
| Best for | Anything unusual | Standard Spring Boot services |

Buildpacks' genuine advantage is **rebase**: a base-image CVE can be patched by swapping the base layers without re-running the application build. That is a real operational benefit for a fleet. The cost is opacity when something is wrong.

For Spring Boot specifically, `bootBuildImage` is a reasonable default and [`spring-boot-developer`](../../spring-boot-developer/SKILL.md) covers its configuration.

## Build caching

`docker buildx` can persist the layer cache between CI runs:

```bash
docker buildx build \
  --cache-from type=registry,ref=$REG/app:buildcache \
  --cache-to   type=registry,ref=$REG/app:buildcache,mode=max \
  --push -t $REG/app:$SHA .
```

**Measure this before adopting it.** Pushing and pulling a cache is network work; for a small image with fast dependency resolution it can be slower than building cold. `mode=max` caches intermediate stages too, which helps multi-stage builds and increases the transfer. See [caching.md](caching.md).

The `.dockerignore` matters more than most caching tricks: shipping `.git` and `target/` into the build context invalidates layers on every commit and inflates the context transfer.

## Security basics that belong in the build

- **Non-root user.** A container running as root is one escape from host root.
- **No secrets in layers.** A secret `COPY`ed and then deleted remains in the earlier layer. Use `--mount=type=secret`.
- **Scan the image, not just the source** - the base image contributes OS packages you did not choose. See [scanning.md](scanning.md).
- **Generate an image SBOM** alongside the source SBOM; they answer different questions. See [sbom.md](sbom.md).
- **Sign the digest** and verify at the deployment gate. See [provenance-and-signing.md](provenance-and-signing.md).

## Version notes

| | Notes |
| --- | ----- |
| Docker | **29.7.2** present on this machine |
| `docker buildx` | The default builder now; BuildKit features assumed |
| Multi-architecture | `--platform linux/amd64,linux/arm64` produces a manifest list; the *list* digest is what you promote |
| Compose v1 | Removed. `docker compose`, not `docker-compose` |

- **On a multi-arch build the digest you promote is the manifest list digest**, not a per-architecture image digest. Signing and verification must target the list.
- **`docker build` without buildx** lacks cache mounts and secret mounts. Assume buildx.
- **Not verified here:** no image was built for this skill. The Docker daemon was available but image building and registry interaction were out of scope for the verification pass; treat this file as cited guidance.

## Gotchas

- Agent passes a tag downstream instead of a digest - the tag can move between scan, sign and deploy, and each stage may see a different image
- Agent scans by tag and deploys by tag - the scan result does not necessarily describe the deployed image
- Agent leaves the base image on a floating tag - reproducibility gone, and the build changes when upstream publishes
- Agent copies source before dependency manifests - every source change invalidates the dependency layer, which is the most expensive one
- Agent ships the build stage as the runtime image - includes a compiler and the source, for no benefit
- Agent runs as root because it is the default - one container escape from host root
- Agent `COPY`s a secret and deletes it in a later layer - it remains in the earlier layer forever; use `--mount=type=secret`
- Agent switches to Alpine for size without testing - musl changes DNS and locale behaviour and breaks some native libraries
- Agent moves to distroless with no debugging plan - no shell, so `exec` debugging requires ephemeral debug containers
- Agent enables a registry build cache without measuring - the cache transfer can exceed the build it saves
- Agent omits `.dockerignore` - `.git` and build output enter the context, invalidating layers every commit
- Agent signs a per-architecture digest on a multi-arch build - verification at deploy time resolves the manifest list and fails

## Related

- [java-build.md](java-build.md) · [caching.md](caching.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [sbom.md](sbom.md) · [scanning.md](scanning.md) · [provenance-and-signing.md](provenance-and-signing.md) · [target-kubernetes.md](target-kubernetes.md) · [target-cloudflare-containers.md](target-cloudflare-containers.md) · [`spring-boot-developer`](../../spring-boot-developer/SKILL.md) · [checklist.md](checklist.md)
