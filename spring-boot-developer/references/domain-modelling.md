# Domain Modelling

## When this is worth it

A CRUD screen over a table does not need an aggregate. If a feature reads a row, changes a field and writes it back, a service with a repository and a DTO is the right amount of structure, and adding domain objects makes it worse.

Reach for what follows when the feature has **rules** - states a thing can be in, transitions that are legal only from certain states, invariants spanning several fields, or calculations that must always agree. That is where an anemic model leaks the same `if` into six services and they drift.

Apply it per feature. A single application can have three CRUD features and one modelled domain, and should.

## Rich, not anemic

An anemic model is data with getters and setters, and all the rules elsewhere:

```java
// ❌ the invariant lives in whoever remembers to check it
if (order.getStatus() == OrderStatus.DRAFT) {
    order.getItems().add(new OrderItem(productId, quantity));
    order.setTotal(recalculate(order));
}
```

Nothing prevents the next caller from skipping the check, or from adding an item and forgetting the recalculation. Put the rule where the state is:

```java
// ✅ impossible to get wrong from outside
void addItem(ProductId productId, int quantity, Money unitPrice) {
    if (status != OrderStatus.DRAFT) {
        throw new OrderNotModifiableException(id, status);
    }
    items.add(OrderItem.create(this, productId, quantity, unitPrice));
    recalculateTotal();
}
```

The test: **can a caller put the object into an invalid state?** If yes, the rule is in the wrong place.

## Aggregates

An aggregate is a cluster of objects with one **root**, treated as a single unit for consistency.

- **One repository per aggregate root.** `OrderItem` has no repository; it is reached through `Order`. See [spring-data-jpa.md](spring-data-jpa.md).
- **All access goes through the root.** Never hand out a mutable collection of children - return `List.copyOf(items)` so `order.items().add(…)` cannot bypass the invariant.
- **Reference other aggregates by ID, not by object.**

```java
class Order {
    private CustomerId customerId;   // ✅ another aggregate - by ID
    private List<OrderItem> items;   // ✅ inside this aggregate - by reference
}
```

```java
class Order {
    @ManyToOne Customer customer;    // ❌ two aggregates in one object graph
}
```

Referencing by ID keeps the transactional boundary honest, stops one lazy load pulling in half the schema, and lets the two aggregates move to separate modules or services without a rewrite.

**Keep aggregates small.** The aggregate is the locking unit - everything inside it is loaded and version-checked together, so a large one is a contention hotspot. If two parts never change in the same transaction, they are two aggregates.

## Value objects

Records with validation in the compact constructor. Once one exists, nothing downstream has to check it.

```java
public record Money(BigDecimal amount, String currency) {

    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        if (amount.scale() > 2) {
            throw new IllegalArgumentException("Money supports at most 2 decimal places");
        }
        if (currency.length() != 3) {
            throw new IllegalArgumentException("Currency must be a 3-letter ISO code");
        }
    }

    public static Money of(String amount, String currency) {
        return new Money(new BigDecimal(amount), currency);
    }

    public static Money zero(String currency) {
        return new Money(BigDecimal.ZERO, currency);
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money multiply(int quantity) {
        if (quantity < 1) {
            throw new IllegalArgumentException("Quantity must be positive");
        }
        return new Money(amount.multiply(BigDecimal.valueOf(quantity)), currency);
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new CurrencyMismatchException(currency, other.currency);
        }
    }
}
```

- **`BigDecimal` for money, never `double`.** `0.1 + 0.2` is not `0.3`.
- Operations **return new instances**. A value object is immutable, so `add` produces a new `Money`.
- Refusing to add mismatched currencies is the kind of bug a raw `BigDecimal` cannot catch.

Model an identifier as a value object too - see [spring-data-jpa.md](spring-data-jpa.md).

## States as sealed types

Where states carry different data, model the choice rather than a status enum plus nullable fields:

```java
public sealed interface Fulfilment {
    record Pending() implements Fulfilment {}
    record Shipped(TrackingNumber tracking, Instant shippedAt) implements Fulfilment {}
    record Cancelled(String reason, Instant cancelledAt) implements Fulfilment {}
}
```

A `trackingNumber` that is only meaningful when shipped stops being a nullable column that half the code forgets to check. The compiler then proves every branch is handled - see java-developer's data-oriented guidance and [java-in-spring.md](java-in-spring.md).

The cost is persistence: a sealed hierarchy does not map to a JPA entity directly. Keep the entity's storage flat and reconstruct the sealed type in an accessor, or use `@Embedded` with nullable columns behind the scenes.

## Domain events

A fact that has happened, named in the past tense, immutable:

```java
public record OrderPlaced(OrderId orderId, CustomerId customerId, Money total, Instant occurredAt) {

    public static OrderPlaced from(Order order) {
        return new OrderPlaced(order.id(), order.customerId(), order.total(), Instant.now());
    }
}
```

Carry **IDs and values, not entities.** An event holding an entity is a detached object by the time the listener runs.

### Let Spring Data publish them

Rather than publishing by hand in the service, collect events on the aggregate and let the repository drain them on `save()`:

```java
@Entity
class Order extends BaseEntity {

    @Transient
    private final List<Object> domainEvents = new ArrayList<>();

    void place() {
        if (items.isEmpty()) {
            throw new EmptyOrderException(id);
        }
        this.status = OrderStatus.PLACED;
        this.placedAt = Instant.now();
        domainEvents.add(OrderPlaced.from(this));
    }

    @DomainEvents
    Collection<Object> domainEvents() {
        return List.copyOf(domainEvents);
    }

    @AfterDomainEventPublication
    void clearDomainEvents() {
        domainEvents.clear();
    }
}
```

Spring Data calls `@DomainEvents` on every `save()`, publishes each one, then calls `@AfterDomainEventPublication`. The service stays free of event plumbing, and an event cannot be forgotten by a caller that took a different path to `save`.

Note the two failure modes: an aggregate mutated and **not** saved publishes nothing, and one saved twice in a transaction publishes twice unless the list is cleared. `@AfterDomainEventPublication` handles the second.

Extending `AbstractAggregateRoot<Order>` gives the same behaviour via `registerEvent(…)` with less code, at the cost of inheriting from a Spring Data class.

### Consuming them

```java
@Component
class ReserveInventoryOnOrderPlaced {

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(OrderPlaced event) {
        inventoryService.reserve(event.orderId());
    }
}
```

`AFTER_COMMIT` matters: a plain `@EventListener` runs inside the publishing transaction, so a later rollback leaves the side effect done. With Spring Modulith, `@ApplicationModuleListener` bundles this correctly and persists the publication - see [spring-modulith.md](spring-modulith.md) and [transactions.md](transactions.md).

## Commands, queries and results

Service inputs and outputs are dedicated records, not loose parameters and not the HTTP payloads.

```java
public record PlaceOrderCmd(CustomerId customerId, List<OrderLine> lines, String notes) {}
public record OrderLine(ProductId productId, int quantity, Money unitPrice) {}
public record FindOrdersQuery(CustomerId customerId, OrderStatus status, Pageable pageable) {}
```

| Suffix | Meaning |
|---|---|
| `*Cmd` | An intent to change state |
| `*Query` | A request to read |
| `*Result` | What a command returns, when it is more than an ID |

Why not just take the `*Request` record from the controller: the request belongs to HTTP and may be versioned or reshaped by an API change that the domain should not feel. The controller maps `CreateOrderRequest` → `PlaceOrderCmd`, and the API can change independently of the domain. See [rest-controllers.md](rest-controllers.md).

Why not loose parameters: `place(customerId, lines, notes)` grows a fourth parameter, then a fifth, and `place(a, b, null, null, true)` at the call site says nothing.

Where the command's components are already validated value objects, there is nothing left to validate - see [validation.md](validation.md).

## Specifications

For a query built from optional criteria, composing a `Specification` beats a repository method per combination:

```java
final class OrderSpecifications {

    private OrderSpecifications() {
    }

    static Specification<Order> forCustomer(CustomerId customerId) {
        return (root, query, cb) -> cb.equal(root.get("customerId"), customerId);
    }

    static Specification<Order> withStatus(OrderStatus status) {
        return (root, query, cb) -> cb.equal(root.get("status"), status);
    }

    static Specification<Order> placedAfter(Instant instant) {
        return (root, query, cb) -> cb.greaterThan(root.get("placedAt"), instant);
    }
}
```

```java
var spec = Specification.allOf(
        OrderSpecifications.forCustomer(customerId),
        status != null ? OrderSpecifications.withStatus(status) : null,
        since != null ? OrderSpecifications.placedAfter(since) : null);

return orderRepository.findAll(spec, pageable);
```

Requires `JpaSpecificationExecutor<Order>`. The trade-off: specifications reference field names as strings, so a rename compiles and fails at runtime. Use the JPA metamodel if you use them heavily, and prefer a plain `@Query` when the combinatorics are small.

## Anti-corruption layer

An external system's model must not become your model. Translate at the edge:

```java
@Component
class StripePaymentAdapter implements PaymentPort {

    private final StripeClient stripe;

    @Override
    public PaymentOutcome charge(OrderId orderId, Money amount) {
        var request = new StripeChargeRequest(
                amount.amount().movePointRight(2).longValueExact(),   // Stripe wants minor units
                amount.currency().toLowerCase(),
                orderId.value().toString());

        var response = stripe.charge(request);

        return switch (response.status()) {
            case "succeeded" -> new PaymentOutcome.Authorized(response.id(), amount);
            case "requires_action" -> new PaymentOutcome.RequiresAction(URI.create(response.nextActionUrl()));
            default -> new PaymentOutcome.Declined(response.failureCode());
        };
    }
}
```

The adapter is the only place that knows about minor units, lowercase currency codes and the provider's status strings. Without it those conventions spread through the domain, and swapping providers becomes a rewrite.

The adapter lives in infrastructure. The `PaymentPort` interface belongs to the domain - see [hexagonal-architecture.md](hexagonal-architecture.md).

## If on Boot 3.5.x

Version-agnostic. Aggregates, value objects, `@DomainEvents`/`@AfterDomainEventPublication`, `AbstractAggregateRoot`, specifications and `@TransactionalEventListener` all behave identically. The version-bound pieces are elsewhere: entity identity ([spring-data-jpa.md](spring-data-jpa.md)) and Modulith's version ([spring-modulith.md](spring-modulith.md)).

## Gotchas

- Agent builds aggregates for a CRUD feature - a service, a repository and a DTO is enough where there are no rules
- Agent generates getters and setters and puts the rules in the service - put behaviour where the state is
- Agent maps a reference to another aggregate as `@ManyToOne` - reference by ID
- Agent returns the live children collection - return `List.copyOf(...)` or the invariant is bypassable
- Agent creates a repository for a child entity - one per aggregate root
- Agent builds an aggregate spanning a dozen entities - that is the locking unit; split it
- Agent uses `double` for money - `BigDecimal`, in a `Money` value object
- Agent makes a value object mutable - operations return new instances
- Agent puts an entity inside a domain event - carry IDs and values; the entity is detached by then
- Agent names an event in the present tense - events are facts: `OrderPlaced`, not `PlaceOrder`
- Agent publishes an event before the save - collect on the aggregate and let `@DomainEvents` drain it
- Agent omits `@AfterDomainEventPublication` - events republish on the next save
- Agent uses plain `@EventListener` for a side effect - it runs inside the transaction; use `AFTER_COMMIT`
- Agent passes the HTTP `*Request` record into the service - map to a `*Cmd` so the API can change independently
- Agent lets an external provider's model into the domain - translate in an adapter
- Agent uses specifications for a two-condition query - a `@Query` is clearer and refactor-safe

## Related

- [spring-data-jpa.md](spring-data-jpa.md) · [hexagonal-architecture.md](hexagonal-architecture.md) · [spring-modulith.md](spring-modulith.md) · [transactions.md](transactions.md) · [java-in-spring.md](java-in-spring.md) · [validation.md](validation.md)
