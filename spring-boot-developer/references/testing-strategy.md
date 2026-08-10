# Testing Strategy

Read this to decide **which levels** of test to write, and why a large Spring Boot suite stays fast. The individual how-tos live in the leaf references.

## The levels are complementary, not alternatives

Slice tests and end-to-end tests are not a choice. You write both, because each catches failures the others structurally cannot.

- A **pure unit test** can have complete coverage and still pass while the application is broken. It exercises no persistence mapping, no request mapping, no serialization, no security configuration, no annotation. A missing `@RestController` means the endpoint returns nothing in production; the unit test never notices.
- A **full-context smoke test** catches wiring failures - a bad bean definition, a mapping that will not resolve - but as a black box it tells you little about *where* a behavioural bug is, and it is slow.
- A **sliced Spring test** boots the real framework around the components under test, so it catches annotation, mapping and SQL bugs a unit test misses, while staying fast.

The mistake is assuming green unit tests mean the framework-touching tests can be skipped.

## The distribution

Roughly:

- **The bulk - sliced Spring tests.** `@SpringBootTest(classes = { … })` paired with a slice annotation bootstraps only the components you list, with the real framework, annotations and mappings. Mock the slow or costly externals; keep the rest real. See [testing-integration.md](testing-integration.md), [testing-slices-web.md](testing-slices-web.md), [testing-slices-persistence.md](testing-slices-persistence.md).
- **At least one smoke test, plus at least one request-level end-to-end test.** An almost-empty `@SpringBootTest` proves the context starts; one request driven through the full stack proves the wiring actually serves a response. See [testing-integration.md](testing-integration.md) and [testing-rest-api.md](testing-rest-api.md).
- **Some unit tests** for complex framework-free logic - fast and valuable, rarely sufficient alone. See [testing-unit.md](testing-unit.md).

This is deliberately **not** the 70/20/10 pyramid. The pyramid was drawn for a world where integration tests meant a shared environment and a nightly run; a sliced Spring test with a cached context runs in milliseconds and catches the bugs unit tests cannot. Weighting the suite toward unit tests optimises for a cost that no longer exists.

Use the decision table in [SKILL.md](../SKILL.md) for "what am I testing → which reference". This file is the reasoning behind it.

## Why the sliced test is the workhorse: context cost

Full-context `@SpringBootTest` startup is the expensive part - several seconds for a medium application, considerably longer for a large one once data initialisation and cache warming are involved. That is why the *sliced* Spring test is the default and full-context tests are kept to the smoke and end-to-end handful. Not because slices and end-to-end are alternatives, but because the full context is what is slow.

## Context caching

Spring reuses a loaded `ApplicationContext` across test classes with identical configuration; the first test pays startup, later ones reuse it. Getting this right is the difference between a suite that takes minutes and one that takes tens of minutes.

The cache key is the **`MergedContextConfiguration`**. Spring reuses a context only when all of these match:

- configuration classes / `classes`
- active profiles (`@ActiveProfiles`)
- properties (`@TestPropertySource` and inline `properties`)
- **mock beans** (`@MockitoBean` / `@MockitoSpyBean`)
- the test's initializers and customizers

If any differ, Spring builds a new context - another full startup. **Adding one `@MockitoBean` forks the cache.** So:

- Consolidate common mocks into an `abstract BaseIntegrationTest`; do not sprinkle `@MockitoBean` per class.
- Put shared configuration in `application-test.yml` with `@ActiveProfiles("test")` rather than scattering property overrides.
- **Avoid `@DirtiesContext`.** It discards the cached context; ten uses can cost minutes. Fix the isolation problem instead - usually a test that mutates shared state and does not clean up.
- Watch it with `logging.level.org.springframework.test.context.cache=DEBUG`.

A suite that has quietly grown twenty distinct context configurations pays twenty startups. It is worth counting.

## One container per suite

Real-infrastructure tests are only cheap if the container is reused. Start **one** container for the whole suite - a `static` container or a shared `@ServiceConnection` bean - never one per class. See [testcontainers.md](testcontainers.md).

This composes with context caching: one container plus one cached context makes "always test against the real database" practical at scale. Two different container configurations in the same suite means two databases and two context-cache families, and is almost always accidental.

## Mocking is a boundary tool

Mock at architectural boundaries - external services, the clock, randomness. Keep everything else real. The full rationale and the over-mocking smell are in [testing-unit.md](testing-unit.md).

## Isolation and ordering

Tests must not depend on execution order or on each other's leftovers.

- Slice tests are transactional and roll back. Full-context `@SpringBootTest(webEnvironment = RANDOM_PORT)` tests are **not** - the request runs on another thread, so the test's transaction does not cover it. Clean up explicitly, or use `@Sql` to reset.
- Inject a fixed `Clock` rather than calling `Instant.now()` in production code, so time-dependent assertions are stable. A test that fails at midnight or in another timezone is a real bug in the test.
- Parallel execution multiplies all of this. Get isolation right first.

## GraalVM native image: mocks do not work

If you run the suite as a native image to validate native compatibility, **Mockito is not supported there** - `@Mock`, `@MockitoBean` and `@MockitoSpyBean` all fail, because Mockito generates classes at runtime and a closed-world native image forbids it.

- Skip mock-based tests in native runs with JUnit's `@DisabledInNativeImage`.
- For a native-safe bean replacement, use **`@TestBean`** - a static factory method returning a real or hand-written stub. Bean Override support works in a native image; Mockito does not.
- This is another argument for real-component and Testcontainers tests: they use no mocks, so they run natively and are what actually exercises native compatibility. See [containerization-and-native.md](containerization-and-native.md).

## If on Boot 3.5.x

- Context caching and its cache key work identically.
- **4.x only: context pausing** (Spring Framework 7) freezes `@Scheduled` tasks and listeners in cached contexts between tests and resumes them instantly, reducing the need for `@DirtiesContext`. 4.x also improves `@TestConfiguration` bean-override ergonomics.
- Mock beans are `@MockitoBean` / `@MockitoSpyBean` on both lines. `@MockBean` is deprecated on 3.5.x and **removed** on 4.x.

## Gotchas

- Agent writes only unit tests - they pass while the application is broken; nothing exercises mapping, serialization or configuration
- Agent uses `@SpringBootTest` for everything - the full context is the slow part; use slices
- Agent targets a 70/20/10 pyramid - that weighting optimises for a cost cached slice tests no longer have
- Agent scatters `@MockitoBean` across test classes - each distinct set forks the context cache and costs another startup
- Agent scatters `@TestPropertySource` instead of one `application-test.yml` plus `@ActiveProfiles` - same cache-forking effect
- Agent reaches for `@DirtiesContext` to fix flakiness - that discards the cached context; fix the isolation problem
- Agent starts a container per test class - start one for the suite
- Agent defines two Testcontainers configurations in one suite - two databases and two cache families
- Agent assumes a `RANDOM_PORT` test rolls back - it does not; the request runs on another thread
- Agent calls `Instant.now()` in production code and asserts on time - inject a `Clock`
- Agent runs a mock-based test under `nativeTest` - Mockito does not work in a native image; use `@TestBean` or `@DisabledInNativeImage`

## Related

- [testing-unit.md](testing-unit.md) · [testing-slices-web.md](testing-slices-web.md) · [testing-slices-persistence.md](testing-slices-persistence.md) · [testing-integration.md](testing-integration.md) · [testing-rest-api.md](testing-rest-api.md) · [testcontainers.md](testcontainers.md)

---

*The layered model and the sliced-test-first distribution credit **Paul Bakker** (Netflix), [Testing Spring Boot the Netflix Way](https://github.com/paulbakker/testing-spring-boot-presentation). The context-caching cost model credits **Philip Riecks**, Testing Spring Boot Applications Demystified.*
