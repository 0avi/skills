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

**Measured on Docker 29.7.2**, the same trivial Java application built both ways:

| | Single-stage (JDK base) | Multi-stage (JRE runtime) |
| --- | ----------------------- | ------------------------- |
| Size, `docker image inspect .Size` | 150,408,486 bytes | **116,814,934 bytes** |
| `bin/javac` present in any layer | **Yes** (1 occurrence) | **No** (0 occurrences) |
| `Config.User` | empty, i.e. **root** | `10001` |

A 22% size reduction is worth having, but the compiler's absence is the point: the single-stage image ships a full JDK to production, so anything that achieves execution inside it has a compiler to hand.

Both facts were established **statically**, by listing layer contents and reading image metadata, without starting a container.

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

## A secret deleted in a later layer is still in the image

**Measured on Docker 29.7.2**, because this is the container claim most often waved away. An image that copies a secret and removes it in the next instruction:

```dockerfile
FROM alpine:3.22
COPY secret.txt /tmp/secret.txt
RUN rm -f /tmp/secret.txt
```

Saving the image and decompressing each OCI blob shows exactly what happened:

| Layer | Contents |
| ----- | -------- |
| `77162c956bcd` | `tmp/secret.txt` - **29 bytes, plaintext, fully readable** |
| `3f0c418e9e1d` | `tmp/.wh.secret.txt` - an overlayfs **whiteout marker** |

**That is the mechanism.** `rm` does not remove bytes from the earlier layer; it writes a whiteout entry in a *later* layer that tells the union filesystem to hide the file. The container's runtime filesystem shows nothing at `/tmp/secret.txt`, and anyone with the image can still recover the secret with `docker save` and `gzip -dc`.

The control, same secret, same base image, using a mount instead:

```dockerfile
RUN --mount=type=secret,id=tok cat /run/secrets/tok > /dev/null
```

| Approach | Layers containing the secret |
| -------- | ---------------------------- |
| `COPY` then `rm` | **1** |
| `--mount=type=secret` | **0** |

So `--mount=type=secret` is not a stylistic preference, it is the difference between a distributed secret and no secret in the image at all.

**Verifying your own image**, which is worth doing once on anything you publish:

```bash
docker save myimage:tag -o img.tar && mkdir x && tar -xf img.tar -C x
for b in x/blobs/sha256/*; do
  file "$b" | grep -qi gzip && gzip -dc "$b" | grep -a "SECRET_PATTERN" && echo "LEAK in $b"
done
```

Add a gotcha to your own tooling while you are there: **a leak check that reports "clean" may simply be looking in the wrong place.** Confirm the check works by planting a known string first.

Note the shape of that command: Docker saves in **OCI format**, so layers are gzip blobs under `blobs/sha256/` with **no `.tar` extension**. A naive `find -name '*.tar'` finds nothing and reports a clean image. That false negative is easy to produce and was produced while writing this file.

## Security basics that belong in the build

- **Non-root user.** A container running as root is one escape from host root. **Measured**: the single-stage image built here had `Config.User` empty, meaning root; the multi-stage one had `10001`.
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
- **Measured here** on Docker **29.7.2**: the secret-in-layers behaviour with a `--mount=type=secret` control, multi-stage size and contents, `Config.User`, and the OCI blob layout that makes a naive leak check produce a false negative.
- **Not verified here:** registry interaction, `buildx` registry cache economics, multi-architecture manifest lists, and buildpacks. No registry was stood up and no multi-arch build was performed.

## Gotchas

- Agent passes a tag downstream instead of a digest - the tag can move between scan, sign and deploy, and each stage may see a different image
- Agent scans by tag and deploys by tag - the scan result does not necessarily describe the deployed image
- Agent leaves the base image on a floating tag - reproducibility gone, and the build changes when upstream publishes
- Agent copies source before dependency manifests - every source change invalidates the dependency layer, which is the most expensive one
- Agent ships the build stage as the runtime image - includes a compiler and the source, for no benefit
- Agent runs as root because it is the default - one container escape from host root
- Agent `COPY`s a secret and deletes it in a later layer - **measured: the plaintext survives in an earlier layer while a `.wh.` whiteout marker hides it**; use `--mount=type=secret`, which measured 0 layers containing it
- Agent switches to Alpine for size without testing - musl changes DNS and locale behaviour and breaks some native libraries
- Agent moves to distroless with no debugging plan - no shell, so `exec` debugging requires ephemeral debug containers
- Agent enables a registry build cache without measuring - the cache transfer can exceed the build it saves
- Agent omits `.dockerignore` - `.git` and build output enter the context, invalidating layers every commit
- Agent signs a per-architecture digest on a multi-arch build - verification at deploy time resolves the manifest list and fails

## Related

- [java-build.md](java-build.md) · [caching.md](caching.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [sbom.md](sbom.md) · [scanning.md](scanning.md) · [provenance-and-signing.md](provenance-and-signing.md) · [target-kubernetes.md](target-kubernetes.md) · [target-cloudflare-containers.md](target-cloudflare-containers.md) · [`spring-boot-developer`](../../spring-boot-developer/SKILL.md) · [checklist.md](checklist.md)
