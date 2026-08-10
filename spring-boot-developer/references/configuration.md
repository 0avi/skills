# Configuration

## `@ConfigurationProperties`, not `@Value`

```java
@Validated
@ConfigurationProperties("app.orders")
public record OrderProperties(
        @NotNull @Positive Integer maxLinesPerOrder,
        @NotBlank String defaultCurrency,
        @NotNull Duration reservationTimeout,
        @NotNull @Valid Retry retry) {

    public record Retry(@Positive int maxAttempts, @NotNull Duration initialDelay) {}
}
```

```java
@SpringBootApplication
@ConfigurationPropertiesScan
public class Application { … }
```

```yaml
app:
  orders:
    max-lines-per-order: 100
    default-currency: GBP
    reservation-timeout: 15m
    retry:
      max-attempts: 3
      initial-delay: 200ms
```

A record gets constructor binding automatically, so the properties are immutable and every one is set at construction. `@ConfigurationPropertiesScan` on the application class registers them without `@EnableConfigurationProperties` per type.

Why not `@Value("${app.orders.max-lines}")`:

- A typo in the key fails at **injection** time, deep in a stack trace, not at startup.
- The value is a `String` until you convert it.
- Nothing groups related keys, so there is no single place to see the configuration surface.
- It cannot be validated.
- It is untestable without a Spring context - a properties record is `new OrderProperties(…)`.

`@Value` is acceptable for a single unrelated value in a `@Bean` method. Anything with two related keys is a properties type.

**Validate at startup.** `@Validated` on the properties turns a missing or nonsensical value into a startup failure with the offending key named, instead of a `NullPointerException` on the first request that needs it. See [validation.md](validation.md).

Duration and DataSize bind from readable strings - `15m`, `200ms`, `10MB` - so never store a raw `long millis`.

## Profiles

A profile selects **which environment** you are in. It is not a feature flag.

```
application.yml                 # shared defaults
application-local.yml           # developer machine
application-test.yml            # automated tests
application-prod.yml            # production
```

- **`default` should be safe.** If someone runs the jar with no profile, it must not connect to production.
- **Do not put secrets in any profile file.** Profile files are in the repository.
- **Avoid profile-dependent beans for business logic.** `@Profile("prod")` on a `PaymentGateway` means the production path is never exercised in any test. Use a property that selects an implementation, and test both.
- Keep the profile list short. `local`, `test`, `prod` covers most applications; profiles combine multiplicatively and a set of eight is unreadable.

```java
@Component
@Profile("local")                     // ✅ development convenience only
class DevDataSeeder implements ApplicationRunner { … }
```

Group related profiles when a deployment needs several:

```yaml
spring:
  profiles:
    group:
      prod: [prod-db, prod-metrics, prod-security]
```

## Where values come from

Later sources win:

1. `application.yml` in the jar
2. Profile-specific `application-{profile}.yml`
3. Config data outside the jar (`./config/`, `--spring.config.additional-location`)
4. Environment variables
5. Command-line arguments

**Environment variables are the deployment interface.** `app.orders.max-lines-per-order` binds from `APP_ORDERS_MAXLINESPERORDER` - relaxed binding uppercases and strips hyphens. Never `APP_ORDERS_MAX_LINES_PER_ORDER`; each underscore is a level of nesting, so that binds to a different key and is silently ignored.

Provide a default where one is safe and required where it is not:

```yaml
app:
  orders:
    max-lines-per-order: ${MAX_ORDER_LINES:100}   # optional, sensible default
  stripe:
    api-key: ${STRIPE_API_KEY}                    # required - fails fast if absent
```

The second form is deliberate: an absent required value should stop startup, not surface at 3am.

## Secrets

**Never in the repository.** Not in `application.yml`, not in a profile file, not in a test fixture, not in a comment.

| Platform | Mechanism |
|---|---|
| Kubernetes | Secrets mounted as files - Boot reads a directory of files as properties via `spring.config.import=configtree:/etc/secrets/` |
| Docker Compose | An env file outside version control |
| AWS / GCP / Azure | Secrets Manager or Key Vault, injected as environment variables at deploy time |
| Local development | `.env` or `application-local.yml`, both gitignored, with dummy values |

Config trees are the cleanest option on Kubernetes: one file per secret, mounted read-only, and the filename is the property name.

```yaml
spring:
  config:
    import: optional:configtree:/etc/secrets/
```

Redact secrets from the actuator. `/actuator/env` and `/actuator/configprops` will happily print them - see [observability.md](observability.md).

## Feature flags

A boolean property with `@ConditionalOnProperty` wires a whole bean:

```java
@Bean
@ConditionalOnProperty(name = "app.features.recommendations.enabled", havingValue = "true")
RecommendationEngine recommendationEngine() { … }
```

For a flag flipped at runtime, inject the properties type and branch - a `@ConditionalOn*` bean is decided once at startup:

```java
if (features.recommendations().enabled()) { … }
```

Make the properties `@RefreshScope`-aware, or accept a restart. Genuine runtime flags with per-user targeting need a flag service; do not build one out of properties.

## Testing configuration

```java
@Test
void bindsNestedProperties() {
    new ApplicationContextRunner()
            .withUserConfiguration(OrderConfig.class)
            .withPropertyValues(
                    "app.orders.max-lines-per-order=50",
                    "app.orders.default-currency=EUR",
                    "app.orders.reservation-timeout=5m",
                    "app.orders.retry.max-attempts=2",
                    "app.orders.retry.initial-delay=100ms")
            .run(context -> assertThat(context.getBean(OrderProperties.class).maxLinesPerOrder())
                    .isEqualTo(50));
}

@Test
void rejectsNegativeMaxLines() {
    new ApplicationContextRunner()
            .withUserConfiguration(OrderConfig.class)
            .withPropertyValues("app.orders.max-lines-per-order=-1")
            .run(context -> assertThat(context).hasFailed());
}
```

`ApplicationContextRunner` starts no application. Test that validation **rejects** bad values - otherwise the constraints are decorative.

In tests, put shared settings in `application-test.yml` with `@ActiveProfiles("test")` rather than scattering `@TestPropertySource`. Every distinct property set forks the context cache and costs another full startup - see [testing-strategy.md](testing-strategy.md).

## Metadata for the IDE

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-configuration-processor</artifactId>
    <optional>true</optional>
</dependency>
```

Generates `spring-configuration-metadata.json` from your properties records, giving autocomplete and Javadoc in `application.yml`. Cheap, and it makes typos visible while typing.

## If on Boot 3.5.x

Identical: constructor binding, `@ConfigurationPropertiesScan`, `@Validated`, config trees, relaxed binding, `ApplicationContextRunner`. Some property **names** changed in Boot 4 - the OpenRewrite properties recipe handles the rename ([boot-versions.md](boot-versions.md)).

## Gotchas

- Agent uses `@Value` for a group of related keys - use a `@ConfigurationProperties` record
- Agent makes a properties class with getters and setters - a record binds by constructor and is immutable
- Agent omits `@ConfigurationPropertiesScan` or `@EnableConfigurationProperties` - the type is never registered
- Agent omits `@Validated` - a missing value surfaces as a `NullPointerException` at runtime instead of a startup failure
- Agent writes `APP_ORDERS_MAX_LINES_PER_ORDER` - each underscore is a nesting level; it is `APP_ORDERS_MAXLINESPERORDER`
- Agent stores a secret in `application.yml` or a profile file - those are in the repository
- Agent gives a required secret a default - it should fail startup, not run misconfigured
- Agent stores a timeout as a raw `long` - bind a `Duration` from `15m`
- Agent uses `@Profile` to swap a business implementation - the production path is then never tested
- Agent makes the no-profile default point at production - the default must be safe
- Agent uses `@ConditionalOnProperty` for a runtime-toggled flag - that is evaluated once at startup
- Agent exposes `/actuator/env` without redaction - it prints configuration values including secrets
- Agent tests configuration with a full `@SpringBootTest` - `ApplicationContextRunner` needs no application
- Agent scatters `@TestPropertySource` across tests - each distinct set forks the context cache

## Related

- [validation.md](validation.md) · [observability.md](observability.md) · [testing-strategy.md](testing-strategy.md) · [local-development.md](local-development.md) · [containerization-and-native.md](containerization-and-native.md)
