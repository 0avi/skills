# Unit Testing

Plain JUnit, Mockito and AssertJ with **no Spring context**. These run in milliseconds. You are testing *your* code - Spring has its own tests.

Constructor injection is what makes this possible: instantiate the bean with test doubles, no container required. That is the practical payoff of the rule in [spring-proxies-and-di.md](spring-proxies-and-di.md).

```java
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

    @Mock OrderRepository orderRepository;
    @Mock PaymentGateway paymentGateway;

    @InjectMocks OrderService orderService;

    @Test
    void placesOrderAndCharges() {
        var cmd = new PlaceOrderCmd(customerId, List.of(line), null);
        when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        var orderId = orderService.place(cmd);

        assertThat(orderId).isNotNull();
        verify(paymentGateway).charge(any(), eq(Money.of("49.99", "GBP")));
    }
}
```

## What to mock

Mock at **architectural boundaries**: external services, the repository, the clock, randomness. Use the real thing for value objects, domain entities and pure logic - mocking those couples the test to internals it should not know about.

```java
// ❌ mocking a value object
@Mock Money total;
when(total.amount()).thenReturn(new BigDecimal("49.99"));

// ✅ just build one
var total = Money.of("49.99", "GBP");
```

If a test needs five mocks, the class under test probably has five responsibilities. The mock count is a design signal.

## Prefer fakes to mocks for repositories

A hand-written in-memory fake is usually clearer than stubbing a repository call-by-call, and it is reusable:

```java
class InMemoryOrderRepository implements OrderRepository {

    private final Map<OrderId, Order> store = new ConcurrentHashMap<>();

    @Override
    public Order save(Order order) {
        store.put(order.id(), order);
        return order;
    }

    @Override
    public Optional<Order> findById(OrderId id) {
        return Optional.ofNullable(store.get(id));
    }
}
```

Twenty lines once, versus `when(...)` in every test - and the test reads as a scenario rather than a script of interactions. This is the natural fit for the out-ports in [hexagonal-architecture.md](hexagonal-architecture.md).

Fakes work less well against a Spring Data interface with dozens of inherited methods; there, mock the few methods used.

## Assert behaviour, not implementation

```java
// ❌ locks the test to how it was computed
verify(orderService).recalculateTotal();

// ✅ asserts what it produced
assertThat(order.total()).isEqualTo(Money.of("99.98", "GBP"));
```

Use `verify()` sparingly, and mainly to prove a **side effect** happened - a payment was taken - or did not: `verifyNoInteractions(paymentGateway)` for an empty cart. A test full of `verify()` calls fails on every refactor while catching nothing.

## AssertJ

```java
assertThat(orders)
        .hasSize(2)
        .extracting(Order::status)
        .containsExactly(OrderStatus.PLACED, OrderStatus.SHIPPED);

assertThat(order).satisfies(o -> {
    assertThat(o.total()).isEqualTo(expected);
    assertThat(o.items()).isNotEmpty();
});

assertThatThrownBy(() -> order.addItem(productId, 1, price))
        .isInstanceOf(OrderNotModifiableException.class)
        .hasMessageContaining("PLACED");
```

Use AssertJ, not JUnit's `assertEquals` - the failure messages are dramatically better, and `extracting`, `satisfies` and `containsExactlyInAnyOrder` express intent that manual loops obscure.

## Testing the domain

Rich domain objects ([domain-modelling.md](domain-modelling.md)) are the easiest thing in the codebase to test - no mocks at all:

```java
@Test
void refusesToAddItemToPlacedOrder() {
    var order = Order.create(customerId);
    order.addItem(productId, 1, Money.of("10.00", "GBP"));
    order.place();

    assertThatThrownBy(() -> order.addItem(otherProductId, 1, Money.of("5.00", "GBP")))
            .isInstanceOf(OrderNotModifiableException.class);
}
```

If putting rules on domain objects makes tests this simple and moving them to a service makes tests need mocks, that is the anemic-model cost showing up as test friction.

## Time and randomness

```java
@Test
void expiresReservationAfterTimeout() {
    var clock = Clock.fixed(Instant.parse("2026-08-10T12:00:00Z"), ZoneOffset.UTC);
    var service = new ReservationService(repository, clock);
    …
}
```

Inject a `Clock`; never call `Instant.now()` inside code you need to test. A test that only fails near midnight, at a month boundary, or in CI's timezone is a bug in the test.

## Parameterised tests

```java
@ParameterizedTest
@CsvSource({
        "DRAFT,     true",
        "PLACED,    false",
        "SHIPPED,   false",
        "CANCELLED, false",
})
void allowsItemsOnlyWhileDraft(OrderStatus status, boolean allowed) { … }
```

Collapse near-identical cases rather than copy-pasting methods. `@EnumSource(OrderStatus.class)` covers every enum constant and **fails when someone adds a new one** - often exactly what you want.

## What not to unit-test

- Getters, setters, record accessors
- Framework wiring - `@Autowired` works; that is Spring's test, not yours
- Private methods via reflection. If a private method needs its own test, it wants to be a class of its own
- Simple derived Spring Data queries - that is Spring Data's responsibility ([testing-slices-persistence.md](testing-slices-persistence.md))

## If on Boot 3.5.x

Version-agnostic. The only difference is JUnit 5 on 3.5.x versus JUnit 6 on 4.x, which changes none of the code above. Mockito and AssertJ arrive transitively via the test starter on both lines.

> **Native image:** Mockito does not work in a GraalVM native image, so `@Mock`-based tests cannot run under `nativeTest`. See [testing-strategy.md](testing-strategy.md).

## Gotchas

- Agent writes `@SpringBootTest` for a test that needs no Spring context - use plain JUnit
- Agent mocks value objects and entities - construct them; mock only at boundaries
- Agent needs five or more mocks for one class - that is a design signal, not a mocking problem
- Agent stubs a repository call-by-call - a hand-written in-memory fake is clearer and reusable
- Agent verifies internal method calls - assert the outcome instead
- Agent uses `verify()` on everything - reserve it for side effects
- Agent uses `Mockito.mock()` inline instead of `@Mock` with `@ExtendWith(MockitoExtension.class)`
- Agent uses JUnit's `assertEquals` - use AssertJ
- Agent calls `Instant.now()` in production code and asserts on the result - inject a `Clock`
- Agent copy-pastes near-identical test methods - use `@ParameterizedTest`
- Agent unit-tests getters, framework wiring, or private methods via reflection
- Agent tests a derived Spring Data query - that is Spring Data's code

## Related

- [testing-strategy.md](testing-strategy.md) · [domain-modelling.md](domain-modelling.md) · [hexagonal-architecture.md](hexagonal-architecture.md) · [spring-proxies-and-di.md](spring-proxies-and-di.md) · [java-in-spring.md](java-in-spring.md)

---

*Unit-testing and mocking guidance credits **Philip Riecks**, Testing Spring Boot Applications Demystified.*
