# HTTP Clients

## Which client

| Client | Use |
|---|---|
| **HTTP interface** (`@HttpExchange`) | **Default.** Declare the remote API as an interface; Spring generates the implementation |
| `RestClient` | Imperative, when a call is too dynamic for an interface - a computed URI, streaming, conditional headers |
| `WebClient` | Only when the return type is genuinely `Mono`/`Flux` |
| `RestTemplate` | Maintenance only. Superseded by `RestClient` |

On Java 21+ with virtual threads, `RestClient` is not "the blocking one to avoid" - a blocking call on a virtual thread does not pin a platform thread. Reaching for `WebClient` purely for concurrency is no longer a reason. See [async-and-scheduling.md](async-and-scheduling.md).

## Declarative interfaces

```java
@HttpExchange("/inventory")
public interface InventoryClient {

    @GetExchange("/{productId}")
    StockLevel stockFor(@PathVariable UUID productId);

    @PostExchange("/reservations")
    ReservationResponse reserve(@RequestBody ReservationRequest request);

    @DeleteExchange("/reservations/{id}")
    void release(@PathVariable UUID id);
}
```

No `@Component`, no implementation class. On **Boot 4**, register with `@ImportHttpServices`:

```java
@Configuration
@ImportHttpServices(group = "inventory", basePackages = "com.example.app.inventory.client")
class InventoryClientConfig {
}
```

```yaml
spring:
  http:
    clients:                       # global transport defaults
      connect-timeout: 2s
      read-timeout: 5s
    serviceclient:
      inventory:                   # must match the group name
        base-url: ${INVENTORY_BASE_URL}
        read-timeout: 10s
```

Note the two different property roots: `spring.http.clients.*` for global defaults, `spring.http.serviceclient.<group>.*` per group. Getting these confused is common - `spring.http.client.*` (singular) is not the group root.

The default client type is the blocking `RestClient`. For an interface returning `Mono`/`Flux`, select `HttpServiceGroup.ClientType.WEB_CLIENT` and add the WebClient starter. Group configurers apply to the whole group, so an interface needing different treatment belongs in its own group.

Keep the host in configuration, never in `@HttpExchange`. The annotation holds the path only.

## Timeouts

**Every client needs a connect timeout and a read timeout.** Without them the default is effectively infinite, and one slow dependency exhausts your request threads until the whole application stops responding. This is the single most common way a healthy service is taken down by an unhealthy one.

Set them globally in `spring.http.clients.*` and override per group. For a manually built client:

```java
@Bean
RestClient inventoryRestClient(RestClient.Builder builder, InventoryProperties properties) {
    var settings = ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(Duration.ofSeconds(2))
            .withReadTimeout(Duration.ofSeconds(5));

    return builder
            .baseUrl(properties.baseUrl())
            .requestFactory(ClientHttpRequestFactoryBuilder.detect().build(settings))
            .build();
}
```

Read timeouts should be shorter than your own inbound timeout. A 30-second read timeout on a call inside a request that a load balancer abandons after 10 seconds is pure waste.

## Errors

By default a 4xx or 5xx throws - `HttpClientErrorException` or `HttpServerErrorException`. Translate to a domain exception at the client boundary so callers never see an HTTP type:

```java
@Bean
RestClientCustomizer inventoryErrorHandling() {
    return builder -> builder
            .defaultStatusHandler(HttpStatusCode::is4xxClientError, (request, response) -> {
                if (response.getStatusCode() == HttpStatus.NOT_FOUND) {
                    throw new ProductNotStockedException(request.getURI());
                }
                throw new InventoryRequestRejectedException(response.getStatusCode());
            })
            .defaultStatusHandler(HttpStatusCode::is5xxServerError, (request, response) -> {
                throw new InventoryUnavailableException(response.getStatusCode());
            });
}
```

The distinction matters for retry: a 4xx will fail again identically, a 5xx or a timeout might not. Separate exception types let [resilience.md](resilience.md) retry only what is worth retrying.

Never let a remote failure surface as a 500 with the upstream's message in it - that leaks internal topology.

## Authentication

Propagate the caller's token, or use a service credential - never a hardcoded key:

```java
@Bean
RestClientCustomizer bearerTokenPropagation() {
    return builder -> builder.requestInterceptor((request, body, execution) -> {
        if (SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken jwt) {
            request.getHeaders().setBearerAuth(jwt.getToken().getTokenValue());
        }
        return execution.execute(request, body);
    });
}
```

Propagating the user's token means the downstream sees the real caller and applies its own authorization. For service-to-service calls with no user, use the client-credentials flow rather than a shared static secret.

An interceptor reading `SecurityContextHolder` will find nothing on an `@Async` thread or in a scheduled job - the context does not propagate by default. Pass the credential explicitly there.

## Calling a versioned API

```java
RestClient.builder()
        .apiVersionInserter(ApiVersionInserter.fromHeader("API-Version").build())
        .defaultApiVersion("1.2")
        .build();
```

Match the server's strategy - see [api-versioning.md](api-versioning.md).

## Testing

```java
@RestClientTest(InventoryClient.class)
class InventoryClientTest {

    @Autowired InventoryClient client;
    @Autowired MockRestServiceServer server;

    @Test
    void readsStockLevel() {
        server.expect(requestTo("/inventory/9f2c8b1e"))
                .andRespond(withSuccess("""
                        {"available": 12}
                        """, MediaType.APPLICATION_JSON));

        assertThat(client.stockFor(productId).available()).isEqualTo(12);
    }

    @Test
    void translatesNotFound() {
        server.expect(requestTo("/inventory/9f2c8b1e")).andRespond(withResourceNotFound());
        assertThatThrownBy(() -> client.stockFor(productId))
                .isInstanceOf(ProductNotStockedException.class);
    }
}
```

`MockRestServiceServer` intercepts `RestClient` and `RestTemplate` in-process - no port, no extra dependency. Reach for it first.

Escalate to WireMock only when you need a real socket: testing actual timeouts, TLS, fault injection, or a client that `MockRestServiceServer` cannot intercept. See [testing-integration.md](testing-integration.md).

Always test the error translation, not just the happy path.

## If on Boot 3.5.x

`@HttpExchange` and `RestClient` exist, but `@ImportHttpServices` and the `spring.http.serviceclient.*` groups **do not** - those are Boot 4. Build the proxy explicitly:

```java
@Bean
InventoryClient inventoryClient(RestClient.Builder builder, InventoryProperties properties) {
    var restClient = builder
            .baseUrl(properties.baseUrl())
            .requestFactory(timeoutFactory())
            .build();
    return HttpServiceProxyFactory
            .builderFor(RestClientAdapter.create(restClient))
            .build()
            .createClient(InventoryClient.class);
}
```

One factory per external service. Everything else - timeouts, status handlers, interceptors, `@RestClientTest` - is identical.

## Gotchas

- Agent sets no timeouts - the default is effectively infinite and one slow dependency stops your application
- Agent writes an `HttpServiceProxyFactory` bean per client on Boot 4 - use `@ImportHttpServices` groups
- Agent uses `spring.http.client.*` for group settings - global defaults are `spring.http.clients.*`, groups are `spring.http.serviceclient.<group>.*`
- Agent adds `@Component` or an implementation class to an `@HttpExchange` interface - neither is needed
- Agent hardcodes the host in `@HttpExchange` - the annotation holds the path; the host is configuration
- Agent returns `Mono`/`Flux` from an interface using the default client - select `WEB_CLIENT` explicitly
- Agent reaches for `WebClient` for concurrency on Java 21+ - virtual threads remove that reason
- Agent lets `HttpClientErrorException` escape to the caller - translate to a domain exception at the client boundary
- Agent retries a 4xx - it will fail identically; distinguish client from server errors
- Agent surfaces the upstream error message to its own callers - that leaks internal topology
- Agent hardcodes an API key - configuration or a secret manager
- Agent propagates a token from an `@Async` or scheduled thread - the security context is not there
- Agent uses WireMock for everything - `MockRestServiceServer` is in-process and needs no port
- Agent tests only the success path - assert the error translation

## Related

- [resilience.md](resilience.md) · [api-versioning.md](api-versioning.md) · [transactions.md](transactions.md) · [async-and-scheduling.md](async-and-scheduling.md) · [testing-integration.md](testing-integration.md) · [observability.md](observability.md)
