# Web Slice Testing

Slices for the non-persistence layers. Each loads only its layer's beans, so it is far faster than a full `@SpringBootTest` - see [testing-strategy.md](testing-strategy.md).

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webmvc-test</artifactId>
    <scope>test</scope>
</dependency>
```

Boot 4 name. On 3.5.x this is `spring-boot-starter-test`. Do not add both - the Boot 4 `-test` starters are self-contained ([boot-versions.md](boot-versions.md)).

## `@WebMvcTest` - controllers in isolation

Loads the web layer only: controllers, `@ControllerAdvice`, filters, converters, `MockMvcTester`. `@Service`, `@Repository` and `@Component` are **not** loaded, so any collaborator the controller needs must be a `@MockitoBean` or the context fails to start.

```java
@WebMvcTest(OrderController.class)
@Import({ SecurityConfig.class, StringToOrderIdConverter.class })
class OrderControllerTest {

    @Autowired MockMvcTester mockMvc;

    @MockitoBean OrderService orderService;

    @Test
    @WithMockUser
    void returnsOrder() {
        given(orderService.getById(orderId)).willReturn(orderResponse);

        assertThat(mockMvc.get().uri("/api/orders/{id}", orderId.value()))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.status").isEqualTo("PLACED");
    }

    @Test
    @WithMockUser
    void rejectsInvalidPayload() {
        assertThat(mockMvc.post().uri("/api/orders")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.violations").asArray().isNotEmpty();
    }
}
```

Two things must be imported explicitly or the test is misleading:

- **Your `SecurityConfig`.** The web slice does **not** pick it up. Without `@Import`, the test runs against Boot's default chain - usually a surprise 401, or worse, a green test that proves nothing about your actual rules. See [security-fundamentals.md](security-fundamentals.md).
- **Any `Converter`** the controller relies on for path-variable binding, such as the value-object ID converters in [rest-controllers.md](rest-controllers.md).

Name the controller - `@WebMvcTest(OrderController.class)` - rather than the bare annotation, which loads *every* controller and forces you to mock every collaborator in the application.

### `MockMvcTester`

Prefer `MockMvcTester` (Boot 3.4+) over raw `MockMvc`. It is AssertJ-native, so assertions compose and failure messages are readable:

```java
assertThat(mockMvc.get().uri("/api/orders")).hasStatusOk();

// view-rendering controller
assertThat(mockMvc.get().uri("/orders/{id}", id).exchange())
        .hasStatusOk()
        .hasViewName("order-detail")
        .model().containsKey("order");

// redirect and flash attributes
assertThat(mockMvc.post().uri("/orders")
        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
        .param("customerEmail", "a@example.com")
        .exchange())
        .hasStatus(HttpStatus.FOUND)
        .hasRedirectedUrl("/orders")
        .flash().containsKey("successMessage");

// binding errors
assertThat(result).model().extractingBindingResult("order")
        .hasErrorsCount(2)
        .hasFieldErrors("customerEmail", "items");
```

Migrating gradually: `MockMvcTester.create(mockMvc)` wraps an existing `MockMvc`.

## What to assert

Test what the **web layer** does, not what the service does - the service is mocked here.

| Assert | Do not assert |
|---|---|
| Status code for each outcome | Business rules (mock the service and test it separately) |
| The JSON contract - field names, shapes, absent fields | Repository behaviour |
| Validation rejects bad input, with all violations | |
| Authentication and authorization: 401, 403, and the allowed case | |
| Error responses are `ProblemDetail` | |

Assert the **negative** security cases. A suite that only proves the happy path passes just as well when the rules have been removed.

## `@JsonTest` - pinning the wire format

Loads only JSON configuration and gives you `JacksonTester`. Use it to lock a DTO's serialised shape so a field rename cannot silently break clients:

```java
@JsonTest
class OrderResponseJsonTest {

    @Autowired JacksonTester<OrderResponse> json;

    @Test
    void serialisesOrder() throws Exception {
        var response = new OrderResponse(orderId, "PLACED", new BigDecimal("49.99"), placedAt);

        assertThat(json.write(response))
                .hasJsonPathStringValue("$.id")
                .extractingJsonPathStringValue("$.status").isEqualTo("PLACED");
    }

    @Test
    void serialisesValueObjectAsScalar() throws Exception {
        assertThat(json.write(response))
                .extractingJsonPathStringValue("$.id")
                .isEqualTo(orderId.value().toString());   // not a nested object
    }
}
```

The second test is the one worth having: it catches a missing `@JsonValue` on a value object, which otherwise ships a wrapper object into the API contract ([json-and-jackson.md](json-and-jackson.md)).

## `@RestClientTest` - stubbing outbound HTTP

For code that **calls out** via `RestClient` or `RestTemplate`, this auto-configures the client plus a `MockRestServiceServer`. In-process: no port, no extra dependency, no socket.

```java
@RestClientTest(InventoryClient.class)
class InventoryClientTest {

    @Autowired InventoryClient client;
    @Autowired MockRestServiceServer server;

    @Test
    void readsStockLevel() {
        server.expect(requestTo("/inventory/" + productId))
                .andRespond(withSuccess("""
                        {"available": 12}
                        """, MediaType.APPLICATION_JSON));

        assertThat(client.stockFor(productId).available()).isEqualTo(12);
    }

    @Test
    void translatesServerError() {
        server.expect(requestTo("/inventory/" + productId))
                .andRespond(withServerError());

        assertThatThrownBy(() -> client.stockFor(productId))
                .isInstanceOf(InventoryUnavailableException.class);
    }
}
```

Reach for this first. `MockRestServiceServer` only intercepts Spring's `RestClient`/`RestTemplate` - for `WebClient`, an HTTP-interface client, a third-party SDK, or when you need a real port for timeouts or TLS, escalate to WireMock ([testing-integration.md](testing-integration.md)).

Test the **error translation**, not just the happy path. That is where the bug is.

## If on Boot 3.5.x

`@WebMvcTest`, `@JsonTest`, `@RestClientTest`, `MockRestServiceServer`, `JacksonTester`, `MockMvcTester` (3.4+) and `@WithMockUser` are all identical. Two differences:

- The test starter is `spring-boot-starter-test`, not `spring-boot-starter-webmvc-test`.
- `@JsonTest` uses Jackson 2 (`com.fasterxml.jackson`) rather than Jackson 3 (`tools.jackson`). The DTO assertions are unchanged; only the mapper underneath differs.

## Gotchas

- Agent writes `@WebMvcTest` without `@Import(SecurityConfig.class)` - the test runs against Boot's default chain and proves nothing about your rules
- Agent uses bare `@WebMvcTest` - loads every controller and demands a mock for every collaborator; name the controller
- Agent forgets a `@MockitoBean` for a collaborator - the slice does not load `@Service` beans, so the context fails to start
- Agent forgets to import a `Converter` - path-variable binding silently fails
- Agent adds `spring-boot-starter-test` next to `spring-boot-starter-webmvc-test` on Boot 4 - the `-test` starters are self-contained
- Agent uses `@MockBean` - removed in Boot 4; `@MockitoBean`
- Agent uses raw `MockMvc` with `andExpect(jsonPath(...))` - `MockMvcTester` gives readable AssertJ failures
- Agent omits `@WithMockUser` and gets an unexplained 401
- Agent tests only authorised requests - assert the 401 and the 403
- Agent asserts business rules in a web slice - the service is mocked; test it separately
- Agent uses WireMock where `@RestClientTest` would do - the in-process stub needs no port
- Agent tests only the happy path of an outbound client - assert the error translation

## Related

- [testing-strategy.md](testing-strategy.md) · [rest-controllers.md](rest-controllers.md) · [error-handling.md](error-handling.md) · [json-and-jackson.md](json-and-jackson.md) · [security-fundamentals.md](security-fundamentals.md) · [http-clients.md](http-clients.md)

---

*Slice-testing patterns credit **Philip Riecks**, Testing Spring Boot Applications Demystified.*
