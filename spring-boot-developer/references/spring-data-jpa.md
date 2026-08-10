# Spring Data JPA

Boot 4 manages **Jakarta Persistence 3.2** and **Hibernate ORM 7**. Import `jakarta.persistence.*`. Never declare a Hibernate or JPA version - the BOM owns it.

## Entities are classes, not records

A record cannot be an entity: JPA needs a no-arg constructor, mutable fields and a non-final class to proxy. Records are for DTOs, commands, events, value objects and embeddables - see [java-in-spring.md](java-in-spring.md).

```java
@Entity
@Table(name = "orders", indexes = {
        @Index(name = "idx_orders_customer", columnList = "customer_id"),
        @Index(name = "idx_orders_status_placed", columnList = "status, placed_at")
})
class Order extends BaseEntity {

    @EmbeddedId
    @AttributeOverride(name = "value", column = @Column(name = "id", nullable = false, updatable = false))
    private OrderId id;

    @AttributeOverride(name = "value", column = @Column(name = "customer_id", nullable = false, updatable = false))
    private CustomerId customerId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private OrderStatus status;

    @Embedded
    @AttributeOverrides({
            @AttributeOverride(name = "amount", column = @Column(name = "total_amount", nullable = false, precision = 19, scale = 2)),
            @AttributeOverride(name = "currency", column = @Column(name = "total_currency", nullable = false, length = 3))
    })
    private Money total;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<OrderItem> items = new ArrayList<>();

    @Column(name = "placed_at")
    private Instant placedAt;

    protected Order() {
        // for JPA only
    }

    private Order(OrderId id, CustomerId customerId) {
        this.id = Objects.requireNonNull(id, "id");
        this.customerId = Objects.requireNonNull(customerId, "customerId");
        this.status = OrderStatus.DRAFT;
        this.total = Money.zero("GBP");
    }

    static Order create(CustomerId customerId) {
        return new Order(OrderId.newId(), customerId);
    }

    void addItem(ProductId productId, int quantity, Money unitPrice) {
        if (status != OrderStatus.DRAFT) {
            throw new OrderNotModifiableException(id, status);
        }
        items.add(OrderItem.create(this, productId, quantity, unitPrice));
        recalculateTotal();
    }

    void place() {
        if (items.isEmpty()) {
            throw new EmptyOrderException(id);
        }
        this.status = OrderStatus.PLACED;
        this.placedAt = Instant.now();
    }

    private void recalculateTotal() {
        this.total = items.stream().map(OrderItem::subtotal).reduce(Money.zero("GBP"), Money::add);
    }

    OrderId id() { return id; }
    OrderStatus status() { return status; }
    Money total() { return total; }
    List<OrderItem> items() { return List.copyOf(items); }
}
```

Rules visible above:

- **Package-private class** in a flat feature package. Nothing outside the feature touches the entity. See [code-organization.md](code-organization.md).
- **`protected` no-arg constructor** for JPA; a real constructor for everyone else; a **static factory** as the only public construction path.
- **No setters.** `order.place()`, not `order.setStatus(PLACED)`. The name says what happened and the invariant is enforced in one place.
- **Accessors only for what callers need**, without the `get` prefix. Return a defensive copy of collections - handing out the live list lets a caller bypass `addItem` and its invariant.
- **Explicit table, column and index names.** Relying on the naming strategy means a rename silently changes your schema.
- **`@Enumerated(EnumType.STRING)` with a length.** `ORDINAL` stores a position, so reordering the enum silently corrupts every stored row.
- **Collections initialised inline** and never null.

## Identity: value-object IDs with time-ordered UUIDs

Two independent decisions, and both defaults are wrong.

### The type: a value object

```java
@Embeddable
public record OrderId(UUID value) {

    public OrderId {
        Objects.requireNonNull(value, "value");
    }

    public static OrderId newId() {
        return new OrderId(UuidV7.generate());
    }

    public static OrderId of(UUID value) {
        return new OrderId(value);
    }

    public static OrderId of(String value) {
        return new OrderId(UUID.fromString(value));
    }

    @Override
    public String toString() {
        return value.toString();
    }
}
```

`orderRepository.findById(customerId)` is now a compile error rather than a silent runtime miss. On Jakarta Persistence 3.2 a record may be an embeddable without `@Embeddable`, but keep the annotation - it is explicit and it still works on 3.5.x.

For the wire, add `@JsonValue`/`@JsonCreator` ([json-and-jackson.md](json-and-jackson.md)) and a `Converter` for path variables ([rest-controllers.md](rest-controllers.md)).

### The value: UUIDv7, never v4

`@GeneratedValue(strategy = GenerationType.UUID)` produces a **random v4** UUID. Every insert lands at a random point in the primary-key B-tree, causing page splits and destroying cache locality. On a large, write-heavy table this is measurable throughput loss.

**UUIDv7 is time-ordered** - the leading 48 bits are a millisecond timestamp - so inserts append. Same 128 bits, same opacity, no downside.

An `@EmbeddedId` is **assigned, not generated**: `@GeneratedValue` and `@UuidGenerator` do not apply to it. Generate the value in the factory. UUIDv7 is fully specified by RFC 9562 and needs no dependency:

```java
public final class UuidV7 {

    private static final SecureRandom RANDOM = new SecureRandom();

    private UuidV7() {
    }

    /// Generates an RFC 9562 version 7 UUID: a 48-bit big-endian Unix
    /// millisecond timestamp followed by 74 random bits.
    public static UUID generate() {
        var random = new byte[10];
        RANDOM.nextBytes(random);

        long timestamp = System.currentTimeMillis() & 0xFFFF_FFFF_FFFFL;
        long msb = (timestamp << 16)
                | 0x7000L                                          // version 7
                | ((random[0] & 0x0FL) << 8) | (random[1] & 0xFFL); // 12 bits rand_a

        long lsb = 0;
        for (int i = 2; i < 10; i++) {
            lsb = (lsb << 8) | (random[i] & 0xFFL);
        }
        lsb = (lsb & 0x3FFF_FFFF_FFFF_FFFFL) | 0x8000_0000_0000_0000L; // variant 10

        return new UUID(msb, lsb);
    }
}
```

Values generated within the same millisecond are not ordered relative to each other. That is permitted by RFC 9562 and irrelevant to index locality, which depends on the millisecond prefix.

Store it as a native `uuid` column on PostgreSQL - not `varchar(36)`, which is twice the size and slower to compare.

### The fallback

If the `@AttributeOverride` ceremony is judged not worth it, use a bare `UUID` id - but keep v7, which Hibernate generates natively:

```java
@Id
@UuidGenerator(style = UuidGenerator.Style.VERSION_7)
@Column(name = "id", nullable = false, updatable = false)
private UUID id;
```

`UuidGenerator.Style` also has `RANDOM` (v4, the default), `TIME` (**v1**, not v7 - a common misreading) and `VERSION_6`. Use `VERSION_7`.

What you give up is the compile-time protection. What you must not give up is time-ordering: plain `GenerationType.UUID` on a high-write table is simply a mistake.

## The base class

```java
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class BaseEntity {

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private Long version;

    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
}
```

```java
@Configuration
@EnableJpaAuditing
class JpaConfig {
}
```

`@Version` here is doing two jobs:

1. **Optimistic locking.** A concurrent update throws `ObjectOptimisticLockingFailureException`, which maps to 409 - see [error-handling.md](error-handling.md).
2. **New-state detection.** With an assigned `@EmbeddedId`, Spring Data cannot use "is the id null?" to decide between `persist` and `merge`. It checks a nullable `@Version` first: null means new. **This is why the wrapper `Long` matters** - a primitive `long` defaults to `0`, which JPA treats as an existing first version, and every `save()` becomes a `merge` with a preceding `SELECT`.

Without `@Version`, an assigned-ID entity needs `Persistable` with an `isNew` flag cleared by `@PostPersist` and `@PostLoad`. `@Version` is simpler and you usually want the locking anyway.

Prefer Spring Data auditing (`@CreatedDate`) over Hibernate's `@CreationTimestamp` - it also gives `@CreatedBy`/`@LastModifiedBy` from an `AuditorAware` bean, and it is not tied to the ORM.

## equals and hashCode

The rule is short: **do not write them on an entity.**

Default object identity is correct within a persistence context, which is the only scope where two references to the same row exist. Writing them is where the bugs are:

- Including the ID breaks before the entity is persisted, when the ID may be assigned but the object is not yet in the database - and for generated IDs it is null.
- Including mutable fields means `hashCode` changes after an object is put in a `HashSet`, and it is never found again.
- Including an association triggers a lazy load, potentially the whole graph, from inside `equals`.

Two exceptions:

- **A stable natural key**, backed by a unique constraint - base equality on that alone.
- Use **`instanceof`, never `getClass()`** - a Hibernate proxy is a subclass, so `getClass()` comparison fails against a lazily-loaded reference.

```java
@Override
public boolean equals(Object other) {
    return other instanceof Product that && sku != null && sku.equals(that.sku);
}

@Override
public int hashCode() {
    return Objects.hashCode(sku);
}
```

Never include a collection or an association in `toString()`, for the same lazy-loading reason.

## Relationships

```java
@Entity
@Table(name = "order_items")
class OrderItem {

    @EmbeddedId
    @AttributeOverride(name = "value", column = @Column(name = "id", nullable = false, updatable = false))
    private OrderItemId id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_order_items_order"))
    private Order order;

    private int quantity;

    @Embedded
    private Money unitPrice;

    protected OrderItem() {
    }

    Money subtotal() {
        return unitPrice.multiply(quantity);
    }
}
```

- **`fetch = FetchType.LAZY` on every `@ManyToOne` and `@OneToOne`.** To-one associations are EAGER by default, and each one pulls another table into every query that touches the entity.
- **Map one direction only** unless you genuinely navigate both ways. A back-reference you do not use is a maintenance cost and an N+1 waiting to happen.
- **`orphanRemoval = true` only when the parent truly owns the child's lifetime.** On a shared reference it deletes rows another aggregate still points at.
- **No `@ManyToMany` for a relationship with attributes.** The moment the join needs a quantity, a date or a status, model the join row as an entity. Converting later is a migration.
- **Never serialise an association to JSON.** Map to a DTO inside the transaction.

## Repositories

One repository per **aggregate root** - not per table. `OrderItem` has no repository; it is reached through `Order`. See [domain-modelling.md](domain-modelling.md).

```java
interface OrderRepository extends JpaRepository<Order, OrderId> {

    Optional<Order> findByReference(String reference);

    boolean existsByCustomerIdAndStatus(CustomerId customerId, OrderStatus status);

    @EntityGraph(attributePaths = "items")
    Optional<Order> findWithItemsById(OrderId id);

    @Query("""
            select new com.example.app.order.OrderSummary(o.id, o.status, o.total.amount, o.placedAt)
            from Order o
            where o.customerId = :customerId
            order by o.placedAt desc
            """)
    List<OrderSummary> findSummariesByCustomer(CustomerId customerId, Limit limit);

    default Order getById(OrderId id) {
        return findById(id).orElseThrow(() -> new OrderNotFoundException(id));
    }
}
```

- Package-private, like the entity.
- **`getById` default method beside `findById`** - callers that require the row get a domain exception mapped to 404; callers that can handle absence get the `Optional`.
- **Derived queries for simple filters; `@Query` for joins and anything non-trivial.** A derived name past about four conditions is unreadable - `findByStatusAndCustomerIdAndPlacedAtBetweenOrderByPlacedAtDesc` should be a `@Query`.
- **`exists…` rather than `findById(id).isPresent()`** - it selects a boolean instead of hydrating an entity.
- **Never `findAll()` in an endpoint.** Require a `Pageable`, a `Limit`, or a filtered query.

## Projections

For read-only views, do not load the entity:

```java
// Interface projection - Spring Data implements it
interface OrderSummaryView {
    OrderId getId();
    OrderStatus getStatus();
    Instant getPlacedAt();
}

List<OrderSummaryView> findByCustomerId(CustomerId customerId);
```

```java
// Record projection via a constructor expression - explicit, and it is a real DTO
public record OrderSummary(OrderId id, OrderStatus status, BigDecimal total, Instant placedAt) {}
```

A projection selects only the mapped columns, does not enter the persistence context, and cannot trigger a lazy load. For a list endpoint this is usually the single biggest win available.

## N+1

The symptom is one query for the list and one more per row. It appears when a lazy association is touched inside a loop, or when an entity with associations is serialised.

```java
@EntityGraph(attributePaths = {"items", "items.product"})
Optional<Order> findWithItemsAndProductsById(OrderId id);
```

- `@EntityGraph` for a **bounded** graph you know you need.
- A projection when you only need scalars - better still, because it never loads the graph at all.
- **Never fetch-join two collections in one query.** It produces a cartesian product; Hibernate 7 raises `MultipleBagFetchException` for bags. Fetch one collection, or use `@BatchSize`.
- Turn on `spring.jpa.properties.hibernate.generate_statistics` in a test to count queries, or assert query counts directly. An N+1 is invisible in a passing test otherwise.

Keep `spring.jpa.open-in-view=false` (below). With it on, lazy loads succeed during view rendering and the N+1 silently moves into the serialisation phase.

## Pagination

`Page<T>` runs a second `count` query. When you do not need the total, `Slice<T>` skips it.

For deep pages, offset pagination degrades - the database scans and discards every skipped row. Use keyset pagination:

```java
@Query("""
        select o
        from Order o
        where o.status = :status
          and (o.placedAt < :lastPlacedAt
               or (o.placedAt = :lastPlacedAt and o.id.value < :lastId))
        order by o.placedAt desc, o.id.value desc
        """)
List<Order> findNextPage(OrderStatus status, Instant lastPlacedAt, UUID lastId, Limit limit);
```

The `(placedAt, id)` tuple keeps the cursor stable when timestamps collide. Back it with an index matching the sort - `(status, placed_at desc, id desc)`.

## Batch writes

```yaml
spring:
  jpa:
    properties:
      hibernate:
        jdbc.batch_size: 50
        order_inserts: true
        order_updates: true
```

`GenerationType.IDENTITY` **silently disables insert batching** - Hibernate must round-trip for each generated key. Assigned UUIDv7 IDs, as recommended above, do not have this problem. That is a second, independent reason to prefer them.

## Configuration

```yaml
spring:
  jpa:
    open-in-view: false
    show-sql: false
    hibernate:
      ddl-auto: validate
    properties:
      hibernate:
        jdbc.batch_size: 50
        order_inserts: true
        order_updates: true
        connection.provider_disables_autocommit: true
        query.fail_on_pagination_over_collection_fetch: true
  datasource:
    hikari:
      auto-commit: false
```

| Setting | Why |
|---|---|
| `open-in-view: false` | **The most important one.** On by default, it holds the persistence context open through view rendering, so lazy loads succeed outside the service and N+1s hide until production. Turning it off surfaces them as `LazyInitializationException` at development time |
| `ddl-auto: validate` | Never `update` or `create` outside a throwaway environment. Schema belongs to [Flyway](flyway.md); `validate` catches drift at startup |
| `fail_on_pagination_over_collection_fetch` | Fails loudly instead of silently paginating in memory over a fetch-joined collection |
| `auto-commit: false` + `provider_disables_autocommit` | Lets Hibernate defer acquiring the connection until it is genuinely needed |
| `show-sql: false` | Use `logging.level.org.hibernate.SQL=DEBUG` when you need it - `show-sql` writes to stdout unformatted |

## If on Boot 3.5.x

- Hibernate **6.x**, Jakarta Persistence **3.1**. Everything above works.
- A record used as an `@Embeddable` **must** carry the `@Embeddable` annotation; 3.2's implicit support is Boot 4 only. Keep the annotation and both lines work.
- `@UuidGenerator` with `Style.VERSION_7` requires Hibernate 6.6+. On older 6.x, generate the value in the factory as shown - which is what the recommended approach does anyway.
- `Limit` as a query parameter requires Spring Data 3.2+ (Boot 3.2+).

## Gotchas

- Agent makes an entity a record - impossible; entities need a no-arg constructor and mutable fields
- Agent puts Lombok `@Data` on an entity - generates setters plus an `equals` over mutable fields and associations
- Agent adds setters - name the operation instead and enforce the invariant there
- Agent makes an entity or its constructor `final`/`private` - Hibernate cannot proxy or instantiate it
- Agent uses `@GeneratedValue(strategy = GenerationType.UUID)` - that is random v4; use UUIDv7
- Agent reads `UuidGenerator.Style.TIME` as UUIDv7 - `TIME` is v1; the constant is `VERSION_7`
- Agent puts `@GeneratedValue` on an `@EmbeddedId` - embedded ids are assigned; generate in the factory
- Agent uses a primitive `long` for `@Version` - must be a nullable `Long`, or new-state detection breaks and every save does a SELECT first
- Agent omits `@Version` on an assigned-ID entity - Spring Data cannot tell new from existing
- Agent writes `equals`/`hashCode` on an entity - don't, unless there is a stable natural key
- Agent uses `getClass()` in entity `equals` - fails against a Hibernate proxy; use `instanceof`
- Agent includes an association in `equals`, `hashCode` or `toString` - triggers a lazy load, or infinite recursion
- Agent leaves a `@ManyToOne` EAGER - it is the default; set `LAZY`
- Agent uses `@Enumerated` without `STRING` - `ORDINAL` is the default and reordering the enum corrupts the data
- Agent fetch-joins two collections at once - cartesian product, and `MultipleBagFetchException`
- Agent returns entities from a list endpoint - use a projection
- Agent calls `findAll()` in a controller - require `Pageable`, `Limit`, or a filter
- Agent uses `findById(id).isPresent()` - use `existsBy…`
- Agent leaves `open-in-view` at its default - turn it off so N+1s fail loudly in development
- Agent sets `ddl-auto: update` - schema belongs to Flyway; use `validate`
- Agent creates a repository per table - one per aggregate root
- Agent uses offset pagination for deep pages - switch to keyset
- Agent enables batching with `GenerationType.IDENTITY` - batching is silently off
- Agent exposes the live collection from an accessor - return `List.copyOf(...)` or the aggregate's invariant can be bypassed
- Agent stores a UUID as `varchar(36)` - use the native `uuid` type

## Related

- [transactions.md](transactions.md) · [flyway.md](flyway.md) · [domain-modelling.md](domain-modelling.md) · [java-in-spring.md](java-in-spring.md) · [testing-slices-persistence.md](testing-slices-persistence.md)
