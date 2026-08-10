# REST API Testing

The end-to-end layer: the application on a real port, a real database, driven only through HTTP. Keep this layer **thin** - it is the slowest tier and the one that catches the fewest bugs per test. Its job is to prove the whole stack is wired together, not to cover business rules ([testing-strategy.md](testing-strategy.md)).

## The base class

One base class, imported by every end-to-end test, so the whole suite shares a single context and a single container:

```java
@SpringBootTest(webEnvironment = RANDOM_PORT)
@Import(TestcontainersConfig.class)
@AutoConfigureRestTestClient
@ActiveProfiles("test")
public abstract class BaseIntegrationTest {

    @Autowired protected RestTestClient restTestClient;
    @Autowired protected JsonMapper jsonMapper;

    protected String bearerTokenFor(String email) { … }
}
```

Every element earns its place:

- **`RANDOM_PORT`** - a fixed port breaks on CI and under parallel runs.
- **`@Import(TestcontainersConfig.class)`** - the *shared* configuration ([testcontainers.md](testcontainers.md)). A second one means a second database.
- **`@AutoConfigureRestTestClient`** - required on Boot 4; `RestTestClient` is not auto-provided.
- **`@ActiveProfiles("test")`** with settings in `application-test.yml` rather than scattered `@TestPropertySource` - every distinct property set forks the context cache.
- **`JsonMapper`** - Jackson 3 on Boot 4, not `ObjectMapper` ([json-and-jackson.md](json-and-jackson.md)).

Put shared mocks here too, not on individual test classes, for the same cache reason.

## `RestTestClient`

Spring Framework 7's `RestTestClient` unifies MockMvc and `WebTestClient` behind one fluent API, with a bind mode per test level: `bindToController(...)`, `bindTo(MockMvc)`, `bindToApplicationContext(...)`, and `bindToServer()`. The same client spans the sliced-to-end-to-end range instead of switching tools per level.

```java
class OrderApiTest extends BaseIntegrationTest {

    @Test
    void createsOrder() {
        var response = restTestClient.post()
                .uri("/api/orders")
                .headers(h -> h.setBearerAuth(bearerTokenFor(CUSTOMER_EMAIL)))
                .contentType(MediaType.APPLICATION_JSON)
                .body("""
                        {
                          "customerEmail": "customer@example.com",
                          "items": [{"productId": "%s", "quantity": 2}]
                        }
                        """.formatted(productId))
                .exchange()
                .expectStatus().isCreated()
                .expectHeader().exists(HttpHeaders.LOCATION)
                .returnResult(OrderResponse.class)
                .getResponseBody();

        assertThat(response.status()).isEqualTo("PLACED");
    }

    @Test
    void rejectsUnauthenticated() {
        restTestClient.post().uri("/api/orders")
                .contentType(MediaType.APPLICATION_JSON)
                .body("{}")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    void returnsProblemDetailForUnknownOrder() {
        restTestClient.get()
                .uri("/api/orders/{id}", UUID.randomUUID())
                .headers(h -> h.setBearerAuth(bearerTokenFor(CUSTOMER_EMAIL)))
                .exchange()
                .expectStatus().isNotFound()
                .expectHeader().contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .expectBody()
                .jsonPath("$.type").exists()
                .jsonPath("$.title").isEqualTo("Resource Not Found");
    }
}
```

Text blocks keep request bodies readable - but never interpolate untrusted content into one; use `.formatted(...)` with known values, exactly as in [java-in-spring.md](java-in-spring.md).

## What belongs at this level

A handful of tests, chosen deliberately:

| Worth an end-to-end test | Test it lower down instead |
|---|---|
| The happy path of each major resource | Every validation rule ([testing-slices-web.md](testing-slices-web.md)) |
| Authentication and authorization actually apply over HTTP | Every business rule ([testing-unit.md](testing-unit.md)) |
| The error contract really is `ProblemDetail` on the wire | Every query variant ([testing-slices-persistence.md](testing-slices-persistence.md)) |
| Content negotiation, headers, status codes | Every field's serialisation ([`@JsonTest`](testing-slices-web.md)) |
| A full write-then-read round trip through the real database | |

Adding an end-to-end test for every validation case is the most common way a suite becomes slow. Those belong in a web slice, which runs in a fraction of the time and gives a sharper failure.

## Test data

`RANDOM_PORT` tests **do not roll back** - the request runs on another thread, outside the test's transaction. Options in order of preference:

1. **Each test creates its own data** with unique identifiers. Order-independent and parallel-safe.
2. **`@Sql("/test-data.sql")`** on the base class for a shared, known starting state.
3. Truncate in `@BeforeEach` - works, and breaks the day someone adds a test that forgets.

Do not let tests depend on each other's leftovers, and never on execution order.

## Authentication

Generating a real token per test is slow and couples the suite to the auth implementation. Better:

- Issue one token in the base class and reuse it.
- Or use the JWT post-processor for the request rather than a real token ([jwt-authentication.md](jwt-authentication.md)).

Assert the negative cases here: unauthenticated is 401, wrong role is 403. These are the paths that silently break when a `securityMatcher` changes.

## If on Boot 3.5.x

`RestTestClient` does not exist - it is Spring Framework 7. Use `WebTestClient` (same fluent shape, so the tests translate closely) or `TestRestTemplate`. On Boot 4 `TestRestTemplate` additionally requires `@AutoConfigureTestRestTemplate`. Both live in the new `spring-boot-resttestclient` module on 4.x.

Everything else - `RANDOM_PORT`, `@Import`, Testcontainers, `@Sql` - is unchanged, apart from the Jackson 2 mapper type and the Testcontainers coordinates.

## Gotchas

- Agent writes end-to-end tests for every validation rule - they belong in a web slice; this layer stays thin
- Agent uses a fixed port instead of `RANDOM_PORT` - clashes on CI and in parallel runs
- Agent omits `@AutoConfigureRestTestClient` on Boot 4 - the client is not auto-provided
- Agent uses `TestRestTemplate` on Boot 4 without `@AutoConfigureTestRestTemplate`
- Agent injects `ObjectMapper` on Boot 4 - the bean is a `JsonMapper`
- Agent creates a second `TestcontainersConfig` - a second database and a second cache family
- Agent puts `@TestPropertySource` on individual test classes - use one `application-test.yml` with `@ActiveProfiles`
- Agent expects the test transaction to roll back the request's writes - it does not
- Agent writes tests that depend on execution order or another test's data
- Agent asserts only the happy path - assert 401, 403, and the `ProblemDetail` shape
- Agent generates a real auth token per test - issue one in the base class or use the JWT post-processor

## Related

- [testing-strategy.md](testing-strategy.md) · [testing-integration.md](testing-integration.md) · [testcontainers.md](testcontainers.md) · [error-handling.md](error-handling.md) · [jwt-authentication.md](jwt-authentication.md) · [json-and-jackson.md](json-and-jackson.md)
