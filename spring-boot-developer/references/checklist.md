# Best Practices Checklist

Use this for a review pass over existing code. Each rule links to the reference that explains when it does not apply.

For the language itself - records, sealed types, `Optional`, `var`, patterns - use java-developer's checklist alongside this one.

## Versions and build

| # | Rule | Reference |
| - | ---- | --------- |
| 1 | Target the current Boot 4.x line. Do not start a new project on 3.5.x. | [boot-versions.md](boot-versions.md) |
| 2 | Never declare a version for anything the Boot BOM manages. | [maven.md](maven.md) · [gradle.md](gradle.md) |
| 3 | On Boot 4, add `spring-boot-starter-flyway` explicitly - it is no longer transitive, and without it migrations silently never run. | [flyway.md](flyway.md) |
| 4 | Migrate 3.4 → 3.5 → 4.0 in separate commits, then review the diff. | [boot-versions.md](boot-versions.md) |
| 5 | Commit the build wrapper. Pin the JDK with a Gradle toolchain, not `sourceCompatibility`. | [maven.md](maven.md) · [gradle.md](gradle.md) |

## Structure

| # | Rule | Reference |
| - | ---- | --------- |
| 6 | Package by feature, not by layer. Entities and repositories package-private. | [code-organization.md](code-organization.md) |
| 7 | Escalate one rung at a time: package-private → Modulith → nested modules → build modules. | [code-organization.md](code-organization.md) |
| 8 | Global `config/` and `shared/` marked `@ApplicationModule(type = OPEN)` under Modulith. | [spring-modulith.md](spring-modulith.md) |
| 9 | Authentication is global; **authorization belongs to the feature**. | [security-fundamentals.md](security-fundamentals.md) |
| 10 | Enforce layout and dependency rules with ArchUnit or Modulith - not review. | [archunit.md](archunit.md) |

## Beans and proxies

| # | Rule | Reference |
| - | ---- | --------- |
| 11 | Constructor injection only. No field injection, no `@Autowired` on a sole constructor. | [spring-proxies-and-di.md](spring-proxies-and-di.md) |
| 12 | **Never call an annotated method on `this`** - the proxy is bypassed and `@Transactional`, `@Async`, `@Cacheable`, `@Retryable` and `@PreAuthorize` all silently do nothing. | [spring-proxies-and-di.md](spring-proxies-and-di.md) |
| 13 | No Lombok. Write the constructor, the accessors and the logger. | [java-in-spring.md](java-in-spring.md) |
| 14 | Records for DTOs, commands, events and value objects; classes for entities and beans. | [java-in-spring.md](java-in-spring.md) |

## Web

| # | Rule | Reference |
| - | ---- | --------- |
| 15 | One service call per endpoint. No entities in or out, no `@Transactional`, no `try`/`catch`. | [rest-controllers.md](rest-controllers.md) |
| 16 | Errors are RFC 9457 `ProblemDetail`. No success/error envelope. Set `type`. | [error-handling.md](error-handling.md) |
| 17 | Extend `ResponseEntityExceptionHandler`; global advice for framework errors, feature advice for domain errors. | [error-handling.md](error-handling.md) |
| 18 | Never put `ex.getMessage()` in a 500. Log it; return something generic. | [error-handling.md](error-handling.md) |
| 19 | Cap `Pageable` with `max-page-size`. Never return `Page<Entity>`. | [rest-controllers.md](rest-controllers.md) |
| 20 | Validate the request record with `@Valid`; report **all** violations. | [validation.md](validation.md) |
| 21 | On Boot 4, declare `JsonMapper` beans, not `ObjectMapper` - and never replace Boot's mapper bean. | [json-and-jackson.md](json-and-jackson.md) |
| 22 | Version the mapping, not the controller. One resolution strategy. | [api-versioning.md](api-versioning.md) |

## Persistence

| # | Rule | Reference |
| - | ---- | --------- |
| 23 | Value-object `@EmbeddedId` with a time-ordered UUIDv7. Never `GenerationType.UUID` (v4) on a high-write table. | [spring-data-jpa.md](spring-data-jpa.md) |
| 24 | `@Version` as a nullable `Long` - optimistic locking *and* new-state detection. | [spring-data-jpa.md](spring-data-jpa.md) |
| 25 | Do not write `equals`/`hashCode` on an entity unless there is a stable natural key; then use `instanceof`, never `getClass()`. | [spring-data-jpa.md](spring-data-jpa.md) |
| 26 | `fetch = LAZY` on every to-one. `@Enumerated(STRING)`. No association in `equals`/`hashCode`/`toString`. | [spring-data-jpa.md](spring-data-jpa.md) |
| 27 | `spring.jpa.open-in-view=false` and `ddl-auto=validate` - in every environment, including local. | [spring-data-jpa.md](spring-data-jpa.md) |
| 28 | One repository per aggregate root. Projections for list views. Never `findAll()` in an endpoint. | [spring-data-jpa.md](spring-data-jpa.md) |
| 29 | Never edit an applied migration. Expand and contract for anything destructive. | [flyway.md](flyway.md) |

## Transactions and side effects

| # | Rule | Reference |
| - | ---- | --------- |
| 30 | `@Transactional` on the service. Class-level `readOnly = true` with method-level overrides for writes. | [transactions.md](transactions.md) |
| 31 | **Never make a network call inside a transaction.** | [transactions.md](transactions.md) |
| 32 | Bind side effects to commit - `@TransactionalEventListener(AFTER_COMMIT)`, or Modulith's `@ApplicationModuleListener`. | [transactions.md](transactions.md) |
| 33 | Domain exceptions unchecked, so rollback is automatic. | [error-handling.md](error-handling.md) |
| 34 | Never stack `@Retryable` and `@Transactional` on one method - put the retry on a calling bean. | [resilience.md](resilience.md) |

## Integration

| # | Rule | Reference |
| - | ---- | --------- |
| 35 | **Every HTTP client needs a connect and a read timeout.** The default is effectively infinite. | [http-clients.md](http-clients.md) |
| 36 | Translate remote failures to domain exceptions at the client boundary. Never leak the upstream message. | [http-clients.md](http-clients.md) |
| 37 | Retry only transient failures, with backoff **and jitter**. Set `includes` - the default retries bugs. | [resilience.md](resilience.md) |
| 38 | Every message consumer is idempotent - brokers deliver at least once. | [messaging.md](messaging.md) |
| 39 | Never publish to a broker inside a transaction - use an outbox, or Modulith's event registry. | [messaging.md](messaging.md) |
| 40 | Never set `spring.json.trusted.packages=*`, and always wrap with `ErrorHandlingDeserializer`. | [messaging.md](messaging.md) |

## Security

| # | Rule | Reference |
| - | ---- | --------- |
| 41 | Security 7 is lambda-DSL only. `securityMatcher` on every chain; `anyRequest()` last. | [security-fundamentals.md](security-fundamentals.md) |
| 42 | `@EnableMethodSecurity` - without it `@PreAuthorize` is silently inert, which is a hole, not an inefficiency. | [security-fundamentals.md](security-fundamentals.md) |
| 43 | Configure `authenticationEntryPoint` and `accessDeniedHandler` - advice cannot catch filter exceptions. | [security-fundamentals.md](security-fundamentals.md) |
| 44 | Prefer an external IdP. If self-issuing, use Spring Security's own encoder/decoder - not a hand-written filter. | [jwt-authentication.md](jwt-authentication.md) |
| 45 | Set `issuer-uri` **and** `audiences`; scopes are `hasAuthority('SCOPE_…')`, not `hasRole`. | [oauth2-resource-server.md](oauth2-resource-server.md) |
| 46 | Refresh tokens are opaque, hashed, rotated on use, with reuse treated as compromise. | [jwt-authentication.md](jwt-authentication.md) |

## Configuration and operations

| # | Rule | Reference |
| - | ---- | --------- |
| 47 | `@ConfigurationProperties` records with `@Validated`, not scattered `@Value`. Fail at startup. | [configuration.md](configuration.md) |
| 48 | Secrets never in the repository. Required ones have no default, so absence stops startup. | [configuration.md](configuration.md) |
| 49 | The no-profile default must be safe. Never `@Profile` a business implementation. | [configuration.md](configuration.md) |
| 50 | Never `management.endpoints.web.exposure.include: "*"` - that publishes `/env` and `/heapdump`. | [observability.md](observability.md) |
| 51 | Database in **readiness**, never liveness. | [observability.md](observability.md) |
| 52 | Never tag a metric with a user id, entity id or exception message. | [observability.md](observability.md) |
| 53 | Log the exception object, not `ex.getMessage()`. Never log secrets or personal data. | [observability.md](observability.md) |
| 54 | Enable virtual threads on Java 21+ - they are off by default - then size the connection pool, which is now the bottleneck. | [async-and-scheduling.md](async-and-scheduling.md) |
| 55 | Virtual threads do nothing for a sequential fan-out inside one request. `StructuredTaskScope` is that fix - preview on Java 25, in a service and never in a controller, never around a repository call inside `@Transactional`. | [async-and-scheduling.md](async-and-scheduling.md) |
| 56 | A `@Scheduled` job runs once per replica. Make it idempotent or claim the work. | [async-and-scheduling.md](async-and-scheduling.md) |
| 57 | `MaxRAMPercentage`, not `-Xmx`. Run as non-root. Graceful shutdown shorter than the orchestrator's grace period. | [containerization-and-native.md](containerization-and-native.md) |

## Testing

| # | Rule | Reference |
| - | ---- | --------- |
| 58 | Layer the levels - unit, sliced, smoke, one end-to-end. Green unit tests do not mean a working application. | [testing-strategy.md](testing-strategy.md) |
| 59 | Guard the context cache: shared `application-test.yml`, mocks in a base class, avoid `@DirtiesContext`. | [testing-strategy.md](testing-strategy.md) |
| 60 | **Testcontainers against the real database, never H2** - H2 also means your migrations never run. | [testing-slices-persistence.md](testing-slices-persistence.md) |
| 61 | One container for the suite. `static` or a shared `@TestConfiguration`. Pin the image tag. | [testcontainers.md](testcontainers.md) |
| 62 | `@ServiceConnection` where a factory exists; `DynamicPropertyRegistrar` only for values that do not exist at authoring time. | [testcontainers.md](testcontainers.md) |
| 63 | `@WebMvcTest` needs `@Import(SecurityConfig.class)` - otherwise it tests Boot's defaults. | [testing-slices-web.md](testing-slices-web.md) |
| 64 | Assert the negative security cases: 401 and 403. | [testing-slices-web.md](testing-slices-web.md) |
| 65 | Awaitility for anything asynchronous. Never `Thread.sleep`. | [testing-integration.md](testing-integration.md) |
| 66 | Inject a `Clock`; never call `Instant.now()` in code you need to test. | [testing-unit.md](testing-unit.md) |
| 67 | `@MockitoBean`, not `@MockBean` - removed in Boot 4. | [boot-versions.md](boot-versions.md) |

## AI

| # | Rule | Reference |
| - | ---- | --------- |
| 68 | Pair the versions: Spring AI 2.0 with Boot 4, 1.x with Boot 3.5. | [spring-ai.md](spring-ai.md) |
| 69 | Scope the conversation id per user or session - a shared one leaks history between users. | [spring-ai.md](spring-ai.md) |
| 70 | Never concatenate user input into a prompt. Never execute or render model output unescaped. | [spring-ai.md](spring-ai.md) |
| 71 | `log-prompt: false` in production, and never tag a metric with prompt content. | [ai-observability.md](ai-observability.md) |
| 72 | Cap `max-tokens`, track token usage per operation, and alert on spend. | [ai-observability.md](ai-observability.md) |

---

## The five that cause the most damage

1. **Self-invocation.** `this.method()` silently disables `@Transactional`, `@Async`, `@Cacheable`, `@Retryable` - and `@PreAuthorize`, which makes it a security hole. No error, no warning.
2. **H2 in persistence tests.** Your migrations never run, dialect-specific SQL diverges, and the suite is green the whole time.
3. **No HTTP client timeout.** One slow dependency exhausts your request threads and takes the application down with it.
4. **`exposure.include: "*"`.** `/actuator/heapdump` is a downloadable copy of your process memory, including every secret in it.
5. **`open-in-view` left on.** N+1 problems succeed silently in development and surface as a production incident.
