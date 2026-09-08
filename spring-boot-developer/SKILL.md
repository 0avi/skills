---
name: spring-boot-developer
description: Generates modern Spring Boot code and provides architectural guidance for Spring Boot 4.x and 3.5.x. Trigger when writing or modernising Spring Boot applications, or for best practices on package structure, Spring Modulith, REST controllers, RFC 9457 error handling, validation, Jackson 3, Spring Data JPA, transactions, Flyway, caching, Spring Security, JWT, OAuth2, HTTP interface clients, resilience, messaging, configuration, Actuator observability, async, virtual threads and structured concurrency, Spring Batch, Spring AI, MCP servers, Testcontainers testing, or Boot 3 to Boot 4 migration.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# Spring Boot Developer Guidelines

Covers Spring Boot 4.x (the baseline) and 3.5.x (the last 3.x line, and the realistic upgrade source).

1. **Always determine the Boot version, the Java version and the build tool before giving guidance.** Boot 4 renamed starters, moved to Jackson 3, Spring Security 7, Spring Batch 6, Testcontainers 2 and JSpecify. Advice that is correct on 4.x frequently will not compile on 3.5.x, and the reverse.

2. **This skill pairs with [`java-developer`](https://github.com/0avi/skills).** It is fully usable on its own, but where both are installed, java-developer owns the language - immutability, records, sealed types, patterns, `Optional`, `var`, text blocks. This skill owns the framework and never restates or overrides a language rule. Read [java-in-spring.md](references/java-in-spring.md) for how the two meet.

3. **Never generate Lombok.** No `@Data`, `@Getter`, `@RequiredArgsConstructor`, `@Builder` or `@Slf4j` - write the constructor, the accessors and the logger. [java-in-spring.md](references/java-in-spring.md) carries the replacement for each annotation. If the project already uses Lombok, match the surrounding code and raise it rather than silently mixing styles.

4. **This is a Spring MVC skill.** Servlet stack, with virtual threads for concurrency across requests on Java 21+ and structured concurrency for fan-out within one. Do not improvise WebFlux guidance - where Boot exposes parallel configuration for both, the reference names the `spring.webflux.*` key and stops there. A genuinely reactive requirement is out of scope; say so rather than guessing.

5. **Errors are RFC 9457 `ProblemDetail`.** No success/error envelope wrapper. Success responses are DTOs and the HTTP status carries the meaning. See [error-handling.md](references/error-handling.md).

6. **After generating code, compile it and run the tests** with the project's build tool. Do not skip this - starter renames, Jackson 3 package moves and Security 7 API removals all fail at compile time, and entity mapping errors fail only at runtime.

Every reference carries an **`## If on Boot 3.5.x`** section wherever behaviour differs, and a **`## Gotchas`** list of the specific mistakes agents make in that area. Read the gotchas even when skimming.

## Determining the Version

**Step 1.** Read the build config, not the installed toolchain. Maven: the `spring-boot-starter-parent` version, or `spring-boot-dependencies` in `dependencyManagement`. Gradle: the `org.springframework.boot` plugin version. Also check `spring-boot.version` properties and CI workflow files.

**Step 2.** Establish the Java version the same way - Boot 4 requires Java 17 as a floor and is built for 21+; virtual-thread and record-pattern guidance depends on it. java-developer's [java-versions.md](https://github.com/0avi/skills) covers this.

**Step 3.** Only generate APIs that exist in that release. If a recommendation needs Boot 4, say so and give the 3.5.x alternative. Never silently generate Boot 4 code for a 3.5.x project.

Read [boot-versions.md](references/boot-versions.md) for the current release lines and the complete Boot 3.5 → 4 delta index.

## Foundations

- **Boot Versions and Migration**: Current release lines, the full 3.5→4 change index (starter renames, Jackson 3, Security 7, Batch 6, Testcontainers 2, JSpecify, `@MockBean` removal, Flyway no longer transitive), and how to run the migration. Read [boot-versions.md](references/boot-versions.md)
- **Code Organization**: Package by feature, not by layer. The four-rung boundary ladder from package-private through Spring Modulith to Maven modules, where global `config/` and `shared/` live, and why a feature owning its own authorization beats one god-object `SecurityConfig`. Read [code-organization.md](references/code-organization.md)
- **Spring Modulith**: Rungs two and three of the ladder - module base package as API, nested packages as internals, `@NamedInterface`, nested `@ApplicationModule` for a feature that has outgrown itself, and the event infrastructure. Read [spring-modulith.md](references/spring-modulith.md)
- **Spring Proxies and DI**: Constructor injection without Lombok, and the self-invocation trap taught once - it silently disables `@Transactional`, `@Async`, `@Cacheable`, `@Retryable` and `@PreAuthorize` alike. Read [spring-proxies-and-di.md](references/spring-proxies-and-di.md)

## Java in Spring

- **Java in Spring**: Where java-developer's rules land in a Spring codebase - records for DTOs, commands, events and value objects; classes for entities; the Lombok replacement table; `Optional` on repository returns; sealed types for domain state. Read [java-in-spring.md](references/java-in-spring.md)

## Web Layer

- **REST Controllers**: Controller responsibilities and what must not be in them, URL and status conventions, binding value-object IDs, and capping `Pageable`. Read [rest-controllers.md](references/rest-controllers.md)
- **Error Handling**: RFC 9457 `ProblemDetail`, the global versus per-feature `@RestControllerAdvice` split, the domain exception hierarchy, and why security filter exceptions never reach your handler. Read [error-handling.md](references/error-handling.md)
- **Validation**: Jakarta Validation, and the three places validation can live - request DTO, record compact constructor, entity invariant - with the rule for choosing. Read [validation.md](references/validation.md)
- **JSON and Jackson**: Jackson 3 on Boot 4 (`tools.jackson`, `JsonMapper`, `@JacksonComponent`), serialising records and value objects, and the Jackson 2 fallback on 3.5.x. Read [json-and-jackson.md](references/json-and-jackson.md)
- **API Versioning**: Boot 4's native `version` mapping attribute and single resolution strategy, deprecation headers, and the hand-rolled 3.5.x fallback. Read [api-versioning.md](references/api-versioning.md)
- **HATEOAS**: Assemblers, `PagedResourcesAssembler`, and when hypermedia earns its cost. Read [hateoas.md](references/hateoas.md)
- **OpenAPI**: Spec-first generation with the delegate pattern, and code-first with springdoc. Read [openapi.md](references/openapi.md)

## Persistence

- **Spring Data JPA**: Entity modelling, value-object `@EmbeddedId` with UUIDv7, `equals`/`hashCode` rules, repositories per aggregate root, projections, N+1, keyset pagination and batch writes. Read [spring-data-jpa.md](references/spring-data-jpa.md)
- **Transactions**: Where `@Transactional` belongs, propagation, `readOnly`, rollback rules, optimistic locking, and binding side effects to commit rather than to publish. Read [transactions.md](references/transactions.md)
- **Flyway**: Naming, the expand/contract pattern for safe schema change, the `CONCURRENTLY` transaction trap, and why Boot 4 no longer pulls Flyway in for you. Read [flyway.md](references/flyway.md)
- **Caching**: The Spring Cache abstraction first, Redis specifics second - serializers, TTL with jitter, and the stampede on a hot key. Read [caching.md](references/caching.md)

## Architecture Patterns

- **Domain Modelling**: Aggregates, value objects, domain events published on commit, specifications, the anti-corruption layer, and the `Cmd`/`Query`/`Result` service-layer conventions. Read [domain-modelling.md](references/domain-modelling.md)
- **Hexagonal Architecture**: Ports and adapters as the internal shape of a feature, not a rival to feature-first packaging. Read [hexagonal-architecture.md](references/hexagonal-architecture.md)

## Security

- **Security Fundamentals**: Spring Security 7's lambda-only DSL, the filter chain, method security, the global-authentication versus per-feature-authorization split, JSON 401/403, and testing secured code. Read [security-fundamentals.md](references/security-fundamentals.md)
- **JWT Authentication**: Self-issued tokens - signing, the filter, access versus refresh, and rotation. Read [jwt-authentication.md](references/jwt-authentication.md)
- **OAuth2 Resource Server**: Validating tokens from an external IdP, issuer and JWK configuration, and mapping claims to authorities. Read [oauth2-resource-server.md](references/oauth2-resource-server.md)

## Integration

- **HTTP Clients**: Declarative `@HttpExchange` interfaces with Boot 4's `@ImportHttpServices` groups, the manual proxy factory on 3.5.x, and `RestClient` versus `WebClient`. Read [http-clients.md](references/http-clients.md)
- **Resilience**: Spring Framework 7's core `@Retryable` and `@ConcurrencyLimit` - which is not Spring Retry repackaged - and why retry must sit outside the transaction. Read [resilience.md](references/resilience.md)
- **Messaging**: Kafka, RabbitMQ and JMS - serialization, consumer error handling and dead-letter topics, idempotent consumers, and the transactional outbox. Read [messaging.md](references/messaging.md)

## Runtime and Operations

- **Configuration**: `@ConfigurationProperties` over scattered `@Value`, profile strategy, secrets and environment binding, and validating configuration at startup. Read [configuration.md](references/configuration.md)
- **Async and Scheduling**: `@Async` and its proxy trap, task executors, `@Scheduled`, virtual threads - including when they remove the reason to reach for reactive - and structured concurrency for the fan-out inside one request that virtual threads do not touch. Read [async-and-scheduling.md](references/async-and-scheduling.md)
- **Observability**: Actuator endpoints, liveness and readiness probes, Micrometer metrics, distributed tracing, and what is safe to expose in production. Read [observability.md](references/observability.md)
- **Spring Batch**: Batch 6's API, the resourceless default repository that silently costs you restartability, `JobOperator`, chunk boundaries and reader thread-safety. Read [spring-batch.md](references/spring-batch.md)

## AI

- **Spring AI**: `ChatClient`, chat memory and the mandatory conversation id, externalised prompt templates, structured output, RAG and streaming. Read [spring-ai.md](references/spring-ai.md)
- **MCP Server**: Building an MCP server with the Spring AI starter, `@McpTool`, transport selection, and stdout hygiene on stdio. Read [mcp-server.md](references/mcp-server.md)
- **AI Observability**: GenAI semantic-convention metrics, the advisor API, token and cost tracking, and keeping prompts out of production logs. Read [ai-observability.md](references/ai-observability.md)

## Testing

Write tests at complementary levels. The levels are not alternatives - a green unit test suite routinely coexists with a broken application, because it exercises no mapping, no serialization and no configuration. Most framework-touching tests belong at the fast **sliced** level; keep full-context `@SpringBootTest` for a smoke test plus one request-level end-to-end test.

- **Testing Strategy**: Why the levels are complementary, the sliced-first distribution, context caching and what forks the cache key, one container per suite, and the native-image caveat. Read [testing-strategy.md](references/testing-strategy.md)

| What you are testing | Level | Reference |
|---|---|---|
| Business logic, no framework | Unit, no Spring context | [testing-unit.md](references/testing-unit.md) |
| JPA / JDBC / Spring Data JDBC / jOOQ queries | Persistence slice + Testcontainers | [testing-slices-persistence.md](references/testing-slices-persistence.md) |
| Controller, JSON serialization, or an outbound REST client | Web slice | [testing-slices-web.md](references/testing-slices-web.md) |
| A few real components together, external HTTP, or a startup smoke test | Sliced `@SpringBootTest(classes = …)` | [testing-integration.md](references/testing-integration.md) |
| Full REST API over a real port | End-to-end | [testing-rest-api.md](references/testing-rest-api.md) |
| Wiring a container | - | [testcontainers.md](references/testcontainers.md) |
| Architecture and layout rules | Build-time | [archunit.md](references/archunit.md) |

All persistence and integration tests use **Testcontainers against the real database**, never in-memory H2 - see [testcontainers.md](references/testcontainers.md).

## Build and Delivery

The rest of this skill is build-tool agnostic. Read whichever applies:

- **Maven**: [maven.md](references/maven.md) - parent, starters, and the plugins worth configuring.
- **Gradle**: [gradle.md](references/gradle.md) - the Kotlin DSL equivalents.

- **Local Development**: Boot's Docker Compose support, devtools, and a Taskfile for the common commands. Read [local-development.md](references/local-development.md)
- **Containerization and Native**: Buildpacks, layered jars, and GraalVM native images with AOT. Read [containerization-and-native.md](references/containerization-and-native.md)

## Checklist

- **Best Practices Checklist**: Every rule in one scannable list, for a review pass over existing code. Read [checklist.md](references/checklist.md)
