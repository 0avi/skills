# Testcontainers

How to connect a Spring Boot test to a real dependency in a container. Two wiring mechanisms exist, and choosing wrong is the most common Testcontainers mistake.

## Dependencies - coordinates changed in Boot 4

Boot 4 manages **Testcontainers 2.x**, which renamed the artifacts and moved the container classes:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-testcontainers</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>testcontainers-junit-jupiter</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>testcontainers-postgresql</artifactId>
    <scope>test</scope>
</dependency>
```

| Boot 3.5.x (Testcontainers 1.x) | Boot 4 (Testcontainers 2.x) |
|---|---|
| `org.testcontainers:junit-jupiter` | `org.testcontainers:testcontainers-junit-jupiter` |
| `org.testcontainers:postgresql` | `org.testcontainers:testcontainers-postgresql` |
| `org.testcontainers.containers.PostgreSQLContainer` | `org.testcontainers.postgresql.PostgreSQLContainer` |

Never pin the version - the BOM manages it.

## `@ServiceConnection` first

Use `@ServiceConnection` whenever Boot ships a `ConnectionDetailsFactory` for the container. Boot reads the container's mapped host, port, URL and credentials and wires the matching `*ConnectionDetails` bean for you. You register **no** properties.

```java
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfig {

    @Bean
    @ServiceConnection
    PostgreSQLContainer<?> postgres() {
        return new PostgreSQLContainer<>("postgres:18-alpine");
    }

    @Bean
    @ServiceConnection(name = "redis")
    GenericContainer<?> redis() {
        return new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);
    }
}
```

Containers with a built-in factory: JDBC databases (any `JdbcDatabaseContainer` - PostgreSQL, MySQL, MariaDB, Oracle, SQL Server) and their R2DBC equivalents; MongoDB, Redis, Cassandra, Couchbase, Elasticsearch, Neo4j; Kafka, RabbitMQ, ActiveMQ, Artemis, Pulsar; Zipkin, OpenTelemetry, LDAP, Flyway, Liquibase.

For a `GenericContainer` the factory cannot infer the service, so give it a name hint as shown above.

**Pin the image tag.** `postgres:18-alpine`, never `postgres` or `postgres:latest` - an untagged image means the build depends on what Docker Hub served that morning, and it will eventually break for reasons unrelated to your change.

Match the tag to production. Testing on 18 and deploying on 15 reintroduces the problem containers exist to solve.

## What goes where - the three-way rule

Static configuration routinely ends up in `@DynamicPropertySource`, and dynamic ports get pinned into properties files. Decide with this:

| The value is… | Put it… | Why |
|---|---|---|
| Connection details for a container with a factory | **nowhere** - `@ServiceConnection` handles it | Auto-wired; registering it manually is redundant and can conflict |
| Known **only after the container starts** - the mapped port of a factory-less container | A `DynamicPropertyRegistrar` bean | The mapped port is assigned at `start()`, not when you write the test |
| Fixed and known **when you write the test** - `ddl-auto`, feature flags, log levels, a disabled scheduler | `application-test.yml` | Static configuration belongs in a properties file |

**Mental model:** `@DynamicPropertySource` is for values that do not exist yet at authoring time. That is why the API takes a `Supplier`. Anything you could type as a literal does not belong there.

### Factory-less containers

```java
@Bean
DynamicPropertyRegistrar mailProperties(GenericContainer<?> mailpit) {
    return registry -> {
        registry.add("spring.mail.host", mailpit::getHost);
        registry.add("spring.mail.port", mailpit::getFirstMappedPort);
    };
}
```

Prefer the `DynamicPropertyRegistrar` bean (Boot 3.4+) over a static `@DynamicPropertySource` method: it can depend on other beans, lives cleanly in a `@TestConfiguration`, and orders correctly alongside `@ServiceConnection`.

### Two anti-patterns

- **Static values in `@DynamicPropertySource`** - `ddl-auto`, cache TTLs, feature flags. They belong in `application-test.yml`.
- **Fixed host ports** - `withFixedExposedPorts(5432, 5432)` or a hardcoded port. This guarantees clashes on CI and in parallel runs. Let Testcontainers map a random port and read it lazily.

## One container for the suite

The single biggest performance factor. Two ways:

**A shared `@TestConfiguration`, imported everywhere** (preferred - composes with context caching):

```java
@SpringBootTest
@Import(TestcontainersConfig.class)
class OrderIntegrationTest { … }
```

**Or a `static` container** on an abstract base class, started once per JVM:

```java
@Testcontainers
abstract class AbstractDatabaseTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");
}
```

`static` is what makes this work - a non-static `@Container` restarts per test method, which is dramatically slower and almost never intended.

Defining two different container configurations in one suite means two databases and two context-cache families. It is nearly always accidental - see [testing-strategy.md](testing-strategy.md).

## Reusing state between tests

The container is shared, so **data is shared**. Slice tests roll back, but a full `@SpringBootTest(webEnvironment = RANDOM_PORT)` does not - the request runs on another thread outside the test's transaction.

Options, best first:

1. **Make each test create its own data** with unique identifiers. No cleanup, no ordering dependency, parallel-safe.
2. **`@Sql` scripts** to reset to a known state before each test.
3. **Truncate in `@BeforeEach`** - workable, but it makes tests order-dependent the moment anyone forgets.

Do not rely on tests running in a particular order.

## Docker-less environments

Without Docker, a Testcontainers test hard-fails by default. How you handle that depends on how the container is declared:

```java
// @Testcontainers + static @Container - JUnit skips the class instead of failing
@DataJpaTest
@Testcontainers(disabledWithoutDocker = true)
class OrderRepositoryTest { … }
```

With the `@ServiceConnection` bean style there is no `@Testcontainers` annotation to carry that flag, and the container starts when the context loads. Gate the class instead:

```java
static boolean dockerAvailable() {
    return DockerClientFactory.instance().isDockerAvailable();
}

@EnabledIf("com.example.app.DockerCondition#dockerAvailable")
class OrderIntegrationTest extends BaseIntegrationTest { … }
```

`@EnabledIf` takes a `Class#staticMethod` reference and cannot call the API inline. Simplest alternative: `assumeTrue(DockerClientFactory.instance().isDockerAvailable())` in `@BeforeAll`, or `@Tag("docker")` excluded in Docker-less runs.

**Do not let this hide in CI.** Skipping is a convenience for local development. A Testcontainers test silently skipped in CI is false confidence - exactly the trap H2 creates. Ensure CI has Docker, or use Testcontainers Cloud.

## Startup cost

- **Reuse** (`withReuse(true)` plus `testcontainers.reuse.enable=true` in `~/.testcontainers.properties`) keeps the container alive between local runs. It is a local-development feature - leave it off in CI, where a clean container per run is the point.
- Prefer `-alpine` images where the project offers one.
- Use `.withInitScript(...)` for schema setup only when Flyway is not already doing it - running both means two sources of truth for the schema.

## If on Boot 3.5.x

`@ServiceConnection` (3.1+) and `DynamicPropertyRegistrar` (3.4+) both exist and behave identically. The difference is the coordinates and class packages in the table at the top - Testcontainers 1.x rather than 2.x.

## Gotchas

- Agent uses Testcontainers 1.x coordinates on Boot 4 - `testcontainers-postgresql`, and the class moved to `org.testcontainers.postgresql`
- Agent pins a Testcontainers version - the BOM manages it
- Agent registers `spring.datasource.*` manually for a container that has a factory - `@ServiceConnection` does it, and doing both can conflict
- Agent uses `@ServiceConnection` on a bare `GenericContainer` with no name hint - the factory cannot infer the service
- Agent puts static configuration in `@DynamicPropertySource` - it belongs in `application-test.yml`
- Agent uses `withFixedExposedPorts` or a hardcoded port - clashes on CI and in parallel runs
- Agent declares `@Container` non-static - the container restarts per test method
- Agent starts a container per test class - one for the suite; import a shared `@TestConfiguration`
- Agent uses an untagged or `latest` image - the build depends on what Docker Hub served that day
- Agent tests on a different major version than production - reintroduces the divergence containers exist to prevent
- Agent assumes a `RANDOM_PORT` test rolls back - it does not; clean up explicitly
- Agent lets Testcontainers tests skip silently in CI - that is false confidence, same as passing on H2
- Agent enables container reuse in CI - a clean container per run is the point there

## Related

- [testing-slices-persistence.md](testing-slices-persistence.md) · [testing-integration.md](testing-integration.md) · [testing-rest-api.md](testing-rest-api.md) · [testing-strategy.md](testing-strategy.md) · [messaging.md](messaging.md)

---

*Testcontainers patterns credit **Siva Prasad Reddy Katamreddy** ([testcontainers-samples](https://github.com/sivaprasadreddy/testcontainers-samples)) and **Philip Riecks**, Testing Spring Boot Applications Demystified.*
