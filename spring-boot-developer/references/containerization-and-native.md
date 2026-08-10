# Containerization and Native Images

## Buildpacks before Dockerfiles

Boot builds an OCI image without a Dockerfile:

```bash
./mvnw spring-boot:build-image -DskipTests
./gradlew bootBuildImage
```

The result is layered, runs as a non-root user, picks an appropriate JDK, sets sensible JVM defaults for a container, and includes an SBOM. A hand-written Dockerfile has to get all of that right and then keep getting it right.

Reach for a Dockerfile when you need a specific base image for compliance reasons, extra OS packages, or a build step buildpacks do not cover. Otherwise the maintenance is not worth it.

```xml
<configuration>
    <image>
        <name>${docker.registry}/${project.artifactId}:${project.version}</name>
        <env>
            <BP_JVM_VERSION>21</BP_JVM_VERSION>
        </env>
    </image>
</configuration>
```

## Layered jars, if you write a Dockerfile

The point is that dependencies change rarely and your code changes constantly - putting them in separate layers means a redeploy pushes a few hundred kilobytes instead of the whole jar.

```dockerfile
FROM eclipse-temurin:21-jre-alpine AS builder
WORKDIR /app
COPY target/*.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --layers --launcher

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder /app/app/dependencies/ ./
COPY --from=builder /app/app/spring-boot-loader/ ./
COPY --from=builder /app/app/snapshot-dependencies/ ./
COPY --from=builder /app/app/application/ ./

USER app
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Layer order matters - least to most frequently changed. Reversing it defeats the point.

`-Djarmode=tools ... extract` is the Boot 3.3+ form. The older `-Djarmode=layertools` is deprecated.

**Run as a non-root user.** The default is root, and a container process running as root is an unnecessary privilege escalation path.

## JVM settings in a container

Modern JVMs are container-aware and read cgroup limits, so **do not hardcode `-Xmx`** - it stops the JVM adapting when the memory limit changes and is a common cause of a container being OOM-killed after a deployment resize.

```bash
JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError"
```

`MaxRAMPercentage` scales with the limit. `ExitOnOutOfMemoryError` matters more than it looks: without it a JVM that has exhausted its heap keeps running in a degraded state, failing requests while still passing a simple health check. Exiting lets the orchestrator restart it.

Give the container enough headroom for non-heap memory - metaspace, thread stacks, direct buffers, the JVM itself. 75% of the limit for heap is a reasonable start.

## Graceful shutdown

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 25s
```

In-flight requests finish instead of being killed mid-write. The timeout must be **shorter** than the orchestrator's termination grace period, or the pod is killed anyway and the setting achieves nothing. See [async-and-scheduling.md](async-and-scheduling.md).

## Probes

```yaml
management:
  endpoint:
    health:
      probes:
        enabled: true
  server:
    port: 9090
```

Liveness at `/actuator/health/liveness`, readiness at `/actuator/health/readiness`. The distinction is load-bearing - a database outage is a **readiness** failure; wiring it to liveness restarts every replica during the outage and makes it worse. Full reasoning in [observability.md](observability.md).

A separate management port keeps the actuator off the public ingress.

## Startup

Container platforms scale on startup time. In order of effort:

- **Class Data Sharing** - buildpacks can enable it; it measurably cuts startup for free.
- **Lazy initialization** (`spring.main.lazy-initialization=true`) - starts faster by deferring bean creation, at the cost of moving failures from startup to first request. That trade is usually wrong in production: a bad bean definition should fail the deployment, not the first user. Fine for local development.
- **AOT processing** - Boot's ahead-of-time processing improves JVM startup without going fully native.
- **Native image** - the largest gain, and the largest cost.

## GraalVM native images

```bash
./mvnw -Pnative native:compile
```

| Gain | Cost |
|---|---|
| Startup in tens of milliseconds | Build takes minutes, not seconds |
| Much lower memory footprint | No runtime reflection unless registered |
| Small attack surface | Mockito does not work, so much of your test suite cannot run natively |
| | Some libraries need explicit configuration or do not work at all |
| | Peak throughput can be *lower* than a warmed-up JVM |

**Native is for scale-to-zero, serverless, CLI tools and very high replica counts.** For a long-running service handling steady traffic, a warmed JVM often performs better and costs far less to build and debug. Do not adopt it for startup time you do not need.

Spring Boot's AOT processing generates most of the reflection configuration, and Spring libraries ship reachability metadata. Third-party libraries may not. Add hints where needed:

```java
@Configuration
@ImportRuntimeHints(OrderRuntimeHints.class)
class NativeConfig {
}

class OrderRuntimeHints implements RuntimeHintsRegistrar {

    @Override
    public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
        hints.resources().registerPattern("prompts/*.st");
        hints.reflection().registerType(LegacyPayload.class, MemberCategory.INVOKE_DECLARED_CONSTRUCTORS);
    }
}
```

### Testing a native build

```bash
./mvnw -PnativeTest test
```

**Mockito does not work in a native image** - it generates classes at runtime, which a closed-world image forbids. So `@Mock`, `@MockitoBean` and `@MockitoSpyBean` all fail there.

- Mark the affected classes `@DisabledInNativeImage`.
- Use `@TestBean` - a static factory returning a real object or a hand-written stub - where you need a native-safe replacement.
- **Your Testcontainers tests are the ones that matter here.** They use no mocks, so they run natively and actually exercise native compatibility. This is a further argument for the real-component testing in [testing-strategy.md](testing-strategy.md).

A native build that compiles is not a native build that works. Reflection failures surface at runtime, on the path that uses them - so the native test run is not optional.

## Image hygiene

- **Pin the base image by tag**, and rebuild regularly to pick up security patches. An image built once and run for a year accumulates every CVE published in that year.
- **Never bake secrets into an image.** Environment variables or mounted files at deploy time ([configuration.md](configuration.md)). A secret in a layer is in the registry, permanently, for anyone who can pull it.
- **Scan images in CI.** A base image with a known CVE is the most likely security finding in a typical deployment.
- Keep the image small - a JRE base rather than a full JDK, alpine or distroless where your dependencies allow it.

## If on Boot 3.5.x

Buildpacks, layered jars, graceful shutdown, probes, AOT and native image all work the same. `-Djarmode=tools` requires Boot 3.3+; on older 3.x use `-Djarmode=layertools`.

## Gotchas

- Agent writes a Dockerfile when buildpacks would do - buildpacks handle the non-root user, JVM tuning, layering and SBOM
- Agent copies the fat jar in one layer - every redeploy pushes the whole thing; extract layers
- Agent orders layers most-changed-first - defeats layer caching
- Agent uses `-Djarmode=layertools` - deprecated; use `-Djarmode=tools ... extract`
- Agent runs the container as root - unnecessary privilege
- Agent hardcodes `-Xmx` - use `MaxRAMPercentage` so the JVM tracks the container limit
- Agent omits `ExitOnOutOfMemoryError` - the JVM limps on failing requests while looking healthy
- Agent sets a shutdown timeout longer than the orchestrator's grace period - the pod is killed anyway
- Agent wires the database into the liveness probe - an outage then restarts every replica
- Agent enables lazy initialization in production - moves failures from deployment to the first user
- Agent adopts native images for a long-running service - a warmed JVM often performs better for far less effort
- Agent runs a mock-based test under `nativeTest` - Mockito cannot work there
- Agent ships a native build without running the native test suite - reflection failures only appear at runtime
- Agent bakes a secret into an image layer - it is in the registry permanently
- Agent pins a base image and never rebuilds - it accumulates every CVE published since

## Related

- [maven.md](maven.md) · [gradle.md](gradle.md) · [observability.md](observability.md) · [configuration.md](configuration.md) · [testing-strategy.md](testing-strategy.md) · [async-and-scheduling.md](async-and-scheduling.md)
