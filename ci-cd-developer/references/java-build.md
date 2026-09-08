# Java Build in CI

Maven and Gradle in a pipeline. The single highest-value item here is **reproducibility**, because it is one property, it is measurable, and without it "build once, promote many" cannot be verified even when you think you are doing it.

| Practice | Apply blind? |
| -------- | ------------ |
| `-B` / `--batch-mode` and no interactive prompts | **Yes** |
| Set `project.build.outputTimestamp` | **Yes.** One property, makes builds reproducible |
| Pin the JDK by version and distribution | **Yes** |
| Fail the build on dependency convergence problems | **Yes** |
| `-o` offline in CI | **No.** Needs a fully primed local repository |
| Parallel builds (`-T`) | Measure first. Not all plugins are thread-safe |

---

## Reproducible builds, measured

A reproducible build produces byte-identical artifacts from the same source. Without it you cannot prove the artifact in production is the one you tested; you can only assert it.

For Maven the whole thing is one property:

```xml
<properties>
  <project.build.outputTimestamp>2026-01-01T00:00:00Z</project.build.outputTimestamp>
</properties>
```

**Measured on this machine** (Maven 3.9.16), building the same project twice with `clean package` and comparing SHA-256 of the jar:

| Configuration | Build 1 | Build 2 | Result |
| ------------- | ------- | ------- | ------ |
| With `project.build.outputTimestamp` | `899c9ecf90f4f25b…` | `899c9ecf90f4f25b…` | **Identical** |
| Property removed (control) | `26df17eb27c9159e…` | `a2a0f50f66c7ebe0…` | **Different** |

Both runs exited 0 and the jar's mtime advanced between them (10:02:16 then 10:02:24), confirming a genuine rebuild rather than a cached artifact. **The control is what makes this a finding rather than a coincidence:** removing the property broke reproducibility, so the property is what provided it.

What the property does: it fixes the timestamps Maven writes into the jar entries. Without it every entry carries the build time, so the archive differs even when every class file is identical.

In CI, derive it from the commit rather than hard-coding a date:

```yaml
- run: mvn -B -Dproject.build.outputTimestamp=$(git log -1 --format=%cI) verify
```

Gradle needs two settings on archive tasks:

```kotlin
tasks.withType<AbstractArchiveTask> {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
```

**Verify it, do not assume it.** The check is three lines and belongs in the pipeline:

```bash
mvn -B clean package && sha256sum target/*.jar > /tmp/a
mvn -B clean package && sha256sum target/*.jar > /tmp/b
diff /tmp/a /tmp/b || { echo "build is not reproducible"; exit 1; }
```

## Toolchain selection

Pin both version and distribution. "Java 25" is not a specification; Temurin 25 and a different vendor's 25 can produce different bytes.

```yaml
- uses: actions/setup-java@dd06d9cba3e5552c54d9f8ea23572deb30010f7c  # v6.0.0
  with:
    java-version: '25'
    distribution: temurin
    cache: maven
```

`cache: maven` on `setup-java` handles `~/.m2/repository` keyed on the lockfile-equivalent, which is simpler and less error-prone than hand-rolling `actions/cache`. See [caching.md](caching.md).

**Distinguish the JDK that compiles from the JDK that runs.** `--release` controls the bytecode target; the runtime is a separate decision, and for performance behaviour they are not interchangeable. See [`java-performance-developer`](../../java-performance-developer/SKILL.md).

## Dependency hygiene as a gate

Java has no lockfile by default, which makes the dependency graph less determinate than npm's. Two gates worth adding:

```xml
<!-- fail on convergence conflicts and on ranges -->
<plugin>
  <artifactId>maven-enforcer-plugin</artifactId>
  <executions><execution>
    <goals><goal>enforce</goal></goals>
    <configuration><rules>
      <dependencyConvergence/>
      <banDynamicVersions/>
    </rules></configuration>
  </execution></executions>
</plugin>
```

`banDynamicVersions` is the important one: a version range means the build resolves differently on different days, which defeats reproducibility at the source. `dependencyLockfile` support and `mvn dependency:tree -Dverbose` help diagnose the rest.

For Gradle, `dependencyLocking` provides an actual lockfile and is worth enabling for applications.

## Tests in CI

```bash
mvn -B verify                    # not `test`: verify runs integration tests and packaging
```

`mvn test` stops before packaging and before `maven-failsafe-plugin`, so a pipeline running `test` is not running integration tests and is not proving the artifact builds. Use `verify`.

Parallelism has two independent axes, and they are often confused:

| Axis | Setting | Notes |
| ---- | ------- | ----- |
| Parallel **modules** | `mvn -T 1C` | Multi-module only. Some plugins are not thread-safe |
| Parallel **tests** | Surefire `parallel` / `forkCount` | Watch for shared state, ports and databases |

`forkCount=1C` with `reuseForks=false` is the safest meaningful test parallelism, at the cost of JVM startup per fork. Measure rather than assuming; JVM startup is not free. See [testing-in-ci.md](testing-in-ci.md).

## Build caching, safely

| Cache | Safe? |
| ----- | ----- |
| `~/.m2/repository` | **Yes.** Immutable released artifacts, keyed on `pom.xml` hashes |
| Gradle `~/.gradle/caches` | **Yes**, keyed on build scripts and lockfiles |
| Gradle build cache (task outputs) | Yes, but **only with reproducible task inputs** |
| `target/` between jobs | **No.** Pass the artifact explicitly instead |

**Never cache `SNAPSHOT` dependencies.** They are mutable by definition, so a cached snapshot pins you to an arbitrary past build and the failure is invisible.

## Version notes

| | Notes |
| --- | ----- |
| Maven | **3.9.16** used for the measurements here. Maven 4 changes defaults; re-verify on it |
| `project.build.outputTimestamp` | Supported by Maven 3.6.1+ and honoured by the standard packaging plugins |
| Gradle | `isPreserveFileTimestamps` and `isReproducibleFileOrder` are the equivalent |
| `actions/setup-java` | **v6.0.0**, `dd06d9cba3e5552c54d9f8ea23572deb30010f7c` |

- **Reproducibility is per-plugin.** A plugin that stamps a build time or a random value into a resource defeats the property. If the check above fails with the property set, a plugin is the cause.
- **Maven 4 is a behavioural change**, not just a version bump. Do not carry these measurements onto it without re-running the check.
- **Measured on Windows x64 with Temurin.** The reproducibility result should hold anywhere, but the hashes quoted are specific to this project and toolchain.

## Gotchas

- Agent omits `project.build.outputTimestamp` and calls the build reproducible - **measured: two builds differed** without it
- Agent adds the property and never verifies - a single non-reproducible plugin silently defeats it; the two-build diff is three lines
- Agent runs `mvn test` in CI - skips integration tests and packaging, so the artifact is never proven to build
- Agent omits `-B` - interactive-mode output, and transfer progress noise that makes logs unreadable
- Agent pins `java-version` without `distribution` - different vendors' builds of the same version are not byte-equivalent
- Agent allows version ranges - the build resolves differently on different days; `banDynamicVersions` catches it
- Agent caches `SNAPSHOT` dependencies - mutable by definition; the cache pins an arbitrary past build
- Agent caches `target/` to pass build output between jobs - use an artifact; a cache is an optimisation, not a transport
- Agent enables `-T` on a project with thread-unsafe plugins - intermittent, hard-to-attribute failures
- Agent conflates module parallelism with test parallelism - different settings, different failure modes
- Agent assumes the compile JDK and the runtime JDK are interchangeable - `--release` sets bytecode, not runtime behaviour

## Related

- [caching.md](caching.md) · [testing-in-ci.md](testing-in-ci.md) · [containers.md](containers.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [sbom.md](sbom.md) · [github-actions.md](github-actions.md) · [`java-developer`](../../java-developer/SKILL.md) · [`java-performance-developer`](../../java-performance-developer/SKILL.md) · [checklist.md](checklist.md)
