# HATEOAS

Hypermedia earns its cost in one situation: **the client's available actions depend on server-side state that the client cannot compute.** An order can be cancelled while it is `PENDING` but not after it ships - if the server sends a `cancel` link only when cancelling is legal, the client stops reimplementing that rule.

If your client is a single team's SPA that already knows the state machine, links are ceremony. Return plain DTOs ([rest-controllers.md](rest-controllers.md)) and revisit this when you have a second consumer.

Adopt it API-wide or not at all. Half the endpoints returning `_links` is worse than none.

## Dependency

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-hateoas</artifactId>
</dependency>
```

Adding it switches the default response content type for `RepresentationModel` types to HAL (`application/hal+json`). Plain DTOs are unaffected.

## Assemblers, not factory methods on the model

Put link construction in a `RepresentationModelAssembler`, not in a static method on the response record and not in the controller. The assembler is a bean, so it can inject what it needs, and it is reusable across the controllers that return the same resource.

```java
@Component
class OrderModelAssembler
        implements RepresentationModelAssembler<Order, EntityModel<OrderResponse>> {

    @Override
    public EntityModel<OrderResponse> toModel(Order order) {
        var model = EntityModel.of(
                OrderResponse.from(order),
                linkTo(methodOn(OrderController.class).getById(order.id())).withSelfRel(),
                linkTo(methodOn(OrderController.class).list(null)).withRel("orders"));

        // Action links only when the action is currently legal
        if (order.status() == OrderStatus.PENDING) {
            model.add(linkTo(methodOn(OrderController.class).cancel(order.id())).withRel("cancel"));
        }
        if (order.status() == OrderStatus.PROCESSING) {
            model.add(linkTo(methodOn(OrderController.class).ship(order.id())).withRel("ship"));
        }
        return model;
    }
}
```

`EntityModel.of(dto, links…)` wraps an existing response record - preferred over extending `RepresentationModel`, which forces the DTO to be a mutable class and gives up the record.

The conditional links are the entire point. An assembler that adds every link regardless of state has reimplemented a static URL list with extra steps.

## Controller

```java
@GetMapping("/{id}")
EntityModel<OrderResponse> getById(@PathVariable OrderId id) {
    return assembler.toModel(orderService.getById(id));
}

@GetMapping
PagedModel<EntityModel<OrderResponse>> list(
        Pageable pageable,
        PagedResourcesAssembler<Order> pagedAssembler) {

    return pagedAssembler.toModel(orderService.findAll(pageable), assembler);
}
```

`PagedResourcesAssembler` is injected by Spring - do not declare it as a bean - and generates `first`, `prev`, `next` and `last` links plus the `page` metadata block. Building pagination links by hand is always a mistake; the edge cases at the first and last page are what you will get wrong.

## Building links

`linkTo(methodOn(Controller.class).method(args))` resolves the URL from the mapping, so a changed `@RequestMapping` updates every link. Never concatenate a URL string - that is the bug hypermedia exists to prevent, reintroduced.

`methodOn` records a proxy call, so the handler must not be `final` and arguments may be `null` when they do not affect the path.

Use IANA-registered relations where one fits - `self`, `next`, `prev`, `first`, `last`, `collection`, `item`, `edit` - via `IanaLinkRelations`. Invent a name only for a domain action (`cancel`, `ship`, `refund`).

## Response shape

```json
{
  "id": "9f2c8b1e-…",
  "status": "PENDING",
  "total": "49.99",
  "_links": {
    "self":   { "href": "https://api.example.com/api/orders/9f2c8b1e-…" },
    "orders": { "href": "https://api.example.com/api/orders" },
    "cancel": { "href": "https://api.example.com/api/orders/9f2c8b1e-…/cancel" }
  }
}
```

Every resource carries `self`. A client that received a resource must be able to re-fetch it without constructing a URL.

Behind a proxy or gateway, link hostnames come out wrong unless forwarded headers are honoured:

```yaml
server:
  forward-headers-strategy: framework
```

Without it, `linkTo` builds links against the internal host and port, and every link the client receives is unreachable.

## Testing

Assert links, not just fields - an assembler that stops emitting `cancel` is a broken contract that a field-only assertion will not catch:

```java
assertThat(mockMvcTester.get().uri("/api/orders/{id}", id))
        .hasStatusOk()
        .bodyJson()
        .hasPathSatisfying("$._links.self.href", href -> assertThat(href).asString().endsWith(id.toString()))
        .hasPathSatisfying("$._links.cancel.href", Assert::isNotNull);
```

Cover the negative too: a shipped order must **not** carry `cancel`.

## If on Boot 3.5.x

Spring HATEOAS is unchanged - `EntityModel`, `CollectionModel`, `PagedModel`, `RepresentationModelAssembler`, `PagedResourcesAssembler` and `linkTo`/`methodOn` behave identically. Only the JSON is produced by Jackson 2.

## Gotchas

- Agent adds hypermedia to some endpoints and plain DTOs to others - adopt API-wide or not at all
- Agent emits every link regardless of state - conditional action links are the reason to use HATEOAS
- Agent hardcodes or concatenates URLs - use `linkTo(methodOn(...))`
- Agent builds pagination links by hand - use `PagedResourcesAssembler`
- Agent declares `PagedResourcesAssembler` as a `@Bean` - Spring supplies it as a handler argument
- Agent omits the `self` link - every resource needs one
- Agent puts link logic in the controller or in a static factory on the DTO - use an assembler bean
- Agent extends `RepresentationModel` from a record - impossible; wrap the record in `EntityModel.of(...)`
- Agent forgets `forward-headers-strategy` behind a proxy - every generated link points at the internal host
- Agent tests only the payload fields - assert the links, including the ones that must be absent

## Related

- [rest-controllers.md](rest-controllers.md) · [openapi.md](openapi.md) · [json-and-jackson.md](json-and-jackson.md) · [testing-slices-web.md](testing-slices-web.md)
