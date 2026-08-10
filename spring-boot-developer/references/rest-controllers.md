# REST Controllers

A controller translates HTTP into a service call and the result back into HTTP. Nothing else.

```java
@RestController
@RequestMapping("/api/orders")
class OrderController {

    private final OrderService orderService;

    OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    ResponseEntity<OrderResponse> create(@Valid @RequestBody CreateOrderRequest request) {
        var orderId = orderService.place(request.toCommand());
        var location = ServletUriComponentsBuilder.fromCurrentRequest()
                .path("/{id}").buildAndExpand(orderId.value()).toUri();
        return ResponseEntity.created(location).body(orderService.findById(orderId));
    }

    @GetMapping("/{id}")
    OrderResponse getById(@PathVariable OrderId id) {
        return orderService.findById(id);
    }

    @GetMapping
    Page<OrderResponse> list(@RequestParam(required = false) OrderStatus status, Pageable pageable) {
        return orderService.find(status, pageable);
    }
}
```

The controller is package-private, as is its constructor - nothing outside the feature calls it. Spring does not need either to be public.

## Rules

- **One service call per endpoint.** Two calls in a controller is orchestration, and orchestration belongs in the service where it can be transactional. See [transactions.md](transactions.md).
- **Never accept or return an `@Entity`.** Inbound is a `*Request` record, outbound a `*Response` record. Returning an entity serialises your persistence model as your API contract, triggers lazy loading outside the transaction, and leaks columns you did not mean to publish.
- **No `try`/`catch`.** Exceptions go to `@RestControllerAdvice` - see [error-handling.md](error-handling.md).
- **No `@Transactional`.** It belongs on the service.
- **No `HttpServletRequest` past the controller.** If the service needs the caller, pass the value, not the request.
- **Return the payload directly** where the status is 200 and there are no custom headers. Reach for `ResponseEntity` when you need 201 with a `Location`, a custom header, or a status chosen at runtime.

## URL conventions

- **Plural nouns**: `/orders`, `/customers`
- **Kebab-case** for multi-word: `/order-items`, never `/orderItems`
- **Two levels of nesting maximum**: `/orders/{id}/items` is fine; `/orders/{id}/items/{itemId}/notes` is not - promote it to `/order-item-notes/{id}`
- **Opaque IDs in paths.** A UUID, or a business reference. Never an exposed auto-increment integer - it leaks row counts and invites enumeration
- **Verbs only for genuine non-CRUD transitions**: `POST /orders/{id}/cancel` is better than `PATCH` with a magic status field

```
GET    /api/orders              list, paginated
POST   /api/orders              create
GET    /api/orders/{id}         fetch one
PUT    /api/orders/{id}         full replace
PATCH  /api/orders/{id}         partial update
DELETE /api/orders/{id}         delete
POST   /api/orders/{id}/cancel  state transition
```

Versioning is not a URL convention on Boot 4 - see [api-versioning.md](api-versioning.md).

## Status codes

| Situation | Status |
|---|---|
| Read succeeded | 200 |
| Created a resource | 201 with a `Location` header |
| Accepted for async processing | 202 |
| Succeeded, nothing to return | 204 |
| Malformed or invalid request | 400 |
| Not authenticated | 401 |
| Authenticated, not permitted | 403 |
| No such resource | 404 |
| Conflict - duplicate, or optimistic-lock failure | 409 |
| Syntactically valid, violates a business rule | 422 |
| Unhandled | 500 |

400 versus 422 is worth getting right: 400 is "I could not parse or bind this", 422 is "I understood it and the domain refused". Map validation failures to 400 and domain rule violations to 422.

## Binding value-object IDs

With value-object IDs ([spring-data-jpa.md](spring-data-jpa.md)), register one `Converter` per ID type and `@PathVariable OrderId id` binds directly:

```java
@Component
class StringToOrderIdConverter implements Converter<String, OrderId> {
    @Override
    public OrderId convert(String source) {
        return OrderId.of(source);
    }
}
```

A malformed ID then throws from the converter and is mapped once, centrally, rather than in every handler. For request *bodies*, Jackson handles it via `@JsonValue`/`@JsonCreator` on the record - see [json-and-jackson.md](json-and-jackson.md).

## Pagination

Accept `Pageable` and return `Page<T>` of **response records**, never of entities:

```java
@GetMapping
Page<OrderResponse> list(Pageable pageable) {
    return orderService.findAll(pageable);   // service maps entity -> response
}
```

**Cap the page size.** A bare `Pageable` accepts `?size=100000` from any caller and one request pulls the table into memory. Boot's default ceiling is high enough to hurt:

```yaml
spring:
  data:
    web:
      pageable:
        default-page-size: 20
        max-page-size: 100      # larger requests are clamped, not rejected
```

Sorting is `?sort=placedAt,desc`. Whitelist sortable fields in the service if the client can name arbitrary properties - an unbounded sort key is a way to force a full scan on an unindexed column.

For deep pagination use keyset pagination instead; see [spring-data-jpa.md](spring-data-jpa.md).

## Content negotiation and headers

- Set `produces` / `consumes` only when the endpoint genuinely serves more than JSON, or you want a 415 rather than a confusing bind failure.
- Long-running work: return **202** with a `Location` pointing at a status resource. Do not hold the request open.
- CORS belongs in `WebMvcConfigurer` in `config/`, not scattered as `@CrossOrigin` on controllers.

## If on Boot 3.5.x

Controller code is unchanged. Two differences:

- JSON is Jackson 2 (`com.fasterxml.jackson`) - see [json-and-jackson.md](json-and-jackson.md).
- No native API versioning; see [api-versioning.md](api-versioning.md) for the 3.5.x approach.

## Gotchas

- Agent returns an `@Entity` or `Page<Entity>` from a handler - map to response records; serialising an entity leaks the schema and triggers lazy loads outside the transaction
- Agent binds a request body straight onto an entity - use a `*Request` record and convert in the service
- Agent injects a repository into a controller - go through the service
- Agent puts `@Transactional` on a controller - it belongs on the service
- Agent wraps handler bodies in `try`/`catch` - use `@RestControllerAdvice`
- Agent accepts a bare `Pageable` with no ceiling - set `spring.data.web.pageable.max-page-size`
- Agent uses `Long` auto-increment IDs in URLs - expose a UUID or a business reference
- Agent returns 200 for a creation - 201 with a `Location` header
- Agent returns 200 with an error object in the body - use the status code; see [error-handling.md](error-handling.md)
- Agent wraps every response in `ResponseEntity` - return the payload directly unless you need a non-default status or a header
- Agent nests resources three levels deep - flatten to a top-level resource
- Agent sprinkles `@CrossOrigin` on controllers - configure CORS once in `WebMvcConfigurer`
- Agent parses the ID from a `String` path variable inside the handler - register a `Converter` and bind the value object

## Related

- [error-handling.md](error-handling.md) · [validation.md](validation.md) · [json-and-jackson.md](json-and-jackson.md) · [api-versioning.md](api-versioning.md) · [spring-data-jpa.md](spring-data-jpa.md) · [testing-slices-web.md](testing-slices-web.md)
