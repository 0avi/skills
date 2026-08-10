# Java in Spring

Where java-developer's language rules land in a Spring codebase. **java-developer owns the language** - immutability, records, sealed types, pattern matching, `Optional`, `var`, text blocks. This file only resolves the places where a framework constrains how those rules apply, and states the Spring-specific decisions java-developer says to make per system.

## The record/bean decision, made

java-developer's `beans-vs-records.md` says to decide per system which side of the record/bean cliff edge you are on, and to apply it consistently. For a Spring Boot application, the split is not arbitrary - the frameworks decide it. Use this:

| Kind | Form | Why |
|---|---|---|
| HTTP request / response payload | **record** | Immutable snapshot of what crossed the wire; Jackson binds records natively |
| Command / query / result | **record** | Values passed into and out of a service |
| Domain event | **record** | A fact that happened; must never change |
| Value object, including IDs | **record** | Validate in the compact constructor |
| `@ConfigurationProperties` | **record** | Constructor binding; immutable configuration |
| Projection / read model | **record** or interface | Both supported by Spring Data |
| `@Embeddable` | **record** | Supported by Hibernate 6+; on Jakarta Persistence 3.2 the annotation is optional |
| **`@Entity`** | **class** | Mutable, identity-based, needs a no-arg constructor and non-final fields for proxying. A record cannot be an entity |
| **Spring bean** (`@Service`, `@Component`, `@Configuration`) | **class** | Holds collaborators, must be proxyable |

This is the "explicit split" option in java-developer's cliff-edge section, not a half-adoption: records everywhere data crosses a boundary, classes for the two things the framework owns.

Note the second row of the entity rule against java-developer's data-oriented guidance that record components should be simple types and never hold collaborators - a Spring bean holds nothing but collaborators, which is precisely why it is a class.

## No Lombok

Write the code. Each annotation has a direct replacement:

| Lombok | Write instead |
|---|---|
| `@RequiredArgsConstructor` | The constructor. See [spring-proxies-and-di.md](spring-proxies-and-di.md) |
| `@Getter` on a DTO | A record - the accessors come free |
| `@Getter` on an entity | Explicit accessors, only for the fields callers genuinely need |
| `@Setter` | Nothing. Name the operation: `order.cancel()`, not `order.setStatus(CANCELLED)` |
| `@Data` | Nothing - it generates setters and an `equals` over mutable fields. See [spring-data-jpa.md](spring-data-jpa.md) for why that is dangerous on an entity |
| `@Value` (Lombok's) | A record |
| `@Builder` | A static factory per legitimate construction path. If a type genuinely needs a builder, that is java-developer's case for a generated immutable bean |
| `@Slf4j` | `private static final Logger log = LoggerFactory.getLogger(OrderService.class);` |
| `@SneakyThrows` | Handle the exception, or wrap it in a domain exception |
| `@EqualsAndHashCode` | A record, or nothing - see the entity equality rules |

```java
@Service
public class OrderService {

    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    private final OrderRepository orderRepository;

    OrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }
}
```

Three lines instead of two annotations, and no annotation processor editing the AST.

If the project already uses Lombok, **match the surrounding code and raise it** - a file half-converted is worse than either style. Removing Lombok is its own change, on its own commit.

## Optional at the Spring boundaries

java-developer's rule: `Optional` on public return types, never a parameter, never a field. Spring adds three specifics.

**Repositories return `Optional`.** Spring Data supports it directly:

```java
Optional<Order> findByReference(String reference);

default Order getByReference(String reference) {
    return findByReference(reference)
            .orElseThrow(() -> new OrderNotFoundException(reference));
}
```

The `getBy…` default method beside the `findBy…` is the idiom worth adopting - callers that require the row get an exception mapped to a 404 by [error-handling.md](error-handling.md), and callers that can handle absence get the `Optional`.

**Constructor parameters are the exception.** `Optional<T>` as a constructor parameter is Spring's protocol for an optional dependency - see [spring-proxies-and-di.md](spring-proxies-and-di.md). This is the one sanctioned violation.

**Never as a record component of a payload.** Jackson serialises `Optional` awkwardly and it produces a nullable field either way. Use a nullable component and mark it, or model absence with a sealed type.

## var in Spring code

Adopt it, per java-developer. Two places to keep the explicit type:

```java
var order = orderRepository.getById(id);              // obvious
var response = OrderResponse.from(order);             // obvious

// Keep the type when the value is a framework type whose shape matters
ResponseEntity<OrderResponse> entity = ResponseEntity.created(uri).body(response);
```

Never `var` for a `@Bean` method return type - the declared return type *is* the bean's registered type, and inference would change what the container publishes.

## Sealed types for domain state

Where a domain has a closed set of states with different data, model it as java-developer does and let the compiler prove the handling is complete:

```java
public sealed interface PaymentOutcome {
    record Authorized(String reference, Money amount) implements PaymentOutcome {}
    record Declined(String reasonCode) implements PaymentOutcome {}
    record RequiresAction(URI redirect) implements PaymentOutcome {}
}
```

```java
return switch (paymentGateway.charge(cmd)) {
    case Authorized(var reference, var amount) -> ResponseEntity.ok(new PaidResponse(reference, amount));
    case Declined(var reasonCode)              -> throw new PaymentDeclinedException(reasonCode);
    case RequiresAction(var redirect)          -> ResponseEntity.status(HttpStatus.SEE_OTHER).location(redirect).build();
};
```

A caveat: **Jackson does not serialise a sealed hierarchy without help.** Use sealed types for internal results between service and controller, and map to a flat response record at the boundary - or configure polymorphic type handling deliberately. See [json-and-jackson.md](json-and-jackson.md).

Do **not** use a sealed hierarchy for a JPA entity hierarchy; Hibernate needs to proxy and subclass.

## Text blocks for JPQL and SQL

```java
@Query("""
        select o
        from Order o
        where o.status = :status
        order by o.placedAt desc, o.id desc
        """)
List<Order> findRecentByStatus(OrderStatus status, Limit limit);
```

java-developer's warning applies with full force here: **never interpolate into a query**. `"... where o.status = '" + status + "'"` is a JPQL injection. Bind a parameter, always. Same for native SQL and for anything handed to `JdbcClient`.

## Immutability and `final`

java-developer prefers `final` classes. Spring imposes two exclusions:

| Type | `final`? |
|---|---|
| DTO, value object, event, command (records) | Final by definition |
| `@Entity` | **No** - Hibernate subclasses it to proxy |
| Advised Spring bean | **No** - CGLIB subclasses it. See [spring-proxies-and-di.md](spring-proxies-and-di.md) |
| Everything else | Yes |

Bean *fields* stay `final` regardless - constructor injection makes that free.

## If on Boot 3.5.x

The record/bean split, the Lombok replacements, `Optional` usage, `var`, sealed types and the `final` exclusions are all identical. Two differences, both covered elsewhere: Jackson 2 rather than Jackson 3 ([json-and-jackson.md](json-and-jackson.md)), and a record used as an `@Embeddable` **must** carry the annotation on 3.5.x, where Jakarta Persistence 3.2's implicit support does not exist ([spring-data-jpa.md](spring-data-jpa.md)).

## Gotchas

- Agent makes a JPA entity a record - impossible; entities need a no-arg constructor and mutable, non-final fields
- Agent makes a DTO a class with getters and setters - use a record
- Agent generates any Lombok annotation - see the replacement table
- Agent hand-writes `equals`/`hashCode` on a DTO - use a record; on an entity, see [spring-data-jpa.md](spring-data-jpa.md)
- Agent marks an `@Entity` or an advised `@Service` `final` - breaks proxying
- Agent uses `var` for a `@Bean` method return type - the declared type is the registered bean type
- Agent puts `Optional` in a request or response record - Jackson handles it poorly; use a nullable component
- Agent returns `null` from a repository-backed lookup - return `Optional`, with a `getBy…` default that throws
- Agent concatenates a value into a `@Query` text block - bind a parameter
- Agent returns a sealed interface straight from a controller - Jackson will not serialise it usefully; map to a flat response record

## Related

- [spring-proxies-and-di.md](spring-proxies-and-di.md) · [spring-data-jpa.md](spring-data-jpa.md) · [json-and-jackson.md](json-and-jackson.md) · [validation.md](validation.md) · [domain-modelling.md](domain-modelling.md)
