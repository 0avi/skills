# Hexagonal Architecture

Ports and adapters: the domain defines interfaces for what it needs, and infrastructure implements them. Dependencies point **inward** - the domain depends on nothing.

## It goes inside a feature

Hexagonal is usually shown as three top-level packages:

```
com.example.app/
├── domain/            ← ❌ this is layer-first with different labels
├── application/
└── infrastructure/
```

That has the same defect as `controller/`/`service/`/`repository/`: every feature is smeared across all three, nothing can be package-private, and the top-level package structure tells you the architectural style rather than what the application does.

Hexagonal describes the shape **inside** a feature. It composes with feature-first packaging ([code-organization.md](code-organization.md)) rather than replacing it:

```
com.example.app/
├── Application.java
├── payment/                        ← the feature
│   ├── PaymentApi.java             ← what other features may call
│   ├── domain/
│   │   ├── Payment.java            ← pure Java, zero framework
│   │   ├── Money.java
│   │   └── port/
│   │       ├── in/  TakePaymentUseCase.java
│   │       └── out/ PaymentGatewayPort.java, PaymentRepository.java
│   ├── application/
│   │   └── TakePaymentService.java ← @Service, implements the in-port
│   └── infrastructure/
│       ├── StripePaymentAdapter.java     ← implements PaymentGatewayPort
│       ├── JpaPaymentRepository.java     ← implements PaymentRepository
│       └── PaymentController.java        ← driving adapter
├── order/                          ← a plain feature; no hexagon needed
└── config/
```

`order/` next to it is flat. Applying the hexagon to one feature and not another is correct, not inconsistent.

## When it earns its cost

The cost is real: a second model, a mapper both ways, and an interface for every outbound call.

| Worth it | Not worth it |
|---|---|
| Complex rules you want to test with no framework at all | CRUD over a table |
| A genuinely swappable external provider (payment, messaging, storage) | One database you will never change |
| The domain must outlive the framework - a long-lived core | A service you will rewrite within two years |
| A regulated core where the logic must be auditable in isolation | Anything where the entity *is* the model |

"We might swap the database" is not a reason. Nobody swaps the database, and Spring Data already abstracts it.

**The pure-domain test is the real payoff.** No Spring, no Testcontainers, no context - milliseconds. If the feature has enough rules for that to matter, the hexagon pays. If not, it is indirection.

## The domain: no framework

```java
public class Payment {

    private final PaymentId id;
    private final OrderId orderId;
    private final Money amount;
    private PaymentStatus status;
    private String gatewayReference;

    private Payment(PaymentId id, OrderId orderId, Money amount) {
        this.id = Objects.requireNonNull(id);
        this.orderId = Objects.requireNonNull(orderId);
        this.amount = Objects.requireNonNull(amount);
        this.status = PaymentStatus.PENDING;
    }

    public static Payment initiate(OrderId orderId, Money amount) {
        return new Payment(PaymentId.newId(), orderId, amount);
    }

    public void authorize(String gatewayReference) {
        if (status != PaymentStatus.PENDING) {
            throw new PaymentNotPendingException(id, status);
        }
        this.status = PaymentStatus.AUTHORIZED;
        this.gatewayReference = Objects.requireNonNull(gatewayReference);
    }

    public PaymentId id() { return id; }
    public PaymentStatus status() { return status; }
}
```

No `@Entity`, no `@Component`, no `jakarta.persistence`, no `org.springframework`. That constraint is the whole architecture - everything else follows from enforcing it. Enforce it with ArchUnit ([archunit.md](archunit.md)), because it will otherwise erode within weeks:

```java
noClasses().that().resideInAPackage("..payment.domain..")
        .should().dependOnClassesThat()
        .resideInAnyPackage("org.springframework..", "jakarta.persistence..");
```

## Ports

**In-ports** (driving) are what the feature offers. **Out-ports** (driven) are what it needs.

```java
// domain/port/in - what the outside world can ask for
public interface TakePaymentUseCase {
    PaymentResult take(TakePaymentCommand command);
}

public record TakePaymentCommand(OrderId orderId, Money amount) {}

// domain/port/out - what the feature needs from the outside world
public interface PaymentGatewayPort {
    GatewayOutcome charge(PaymentId paymentId, Money amount);
}

public interface PaymentRepository {
    Payment save(Payment payment);
    Optional<Payment> findById(PaymentId id);
}
```

The out-port is expressed in **domain terms** - `Money`, `PaymentId` - and returns a domain type. A port with `ResponseEntity`, `Page` or a JPA entity in its signature has already let the infrastructure in.

Note `PaymentRepository` here is a domain interface, not `JpaRepository`. That is deliberate: the domain says what it needs, and JPA is one way to provide it.

## Application: the use case

```java
@Service
public class TakePaymentService implements TakePaymentUseCase {

    private final PaymentRepository payments;
    private final PaymentGatewayPort gateway;

    TakePaymentService(PaymentRepository payments, PaymentGatewayPort gateway) {
        this.payments = payments;
        this.gateway = gateway;
    }

    @Override
    @Transactional
    public PaymentResult take(TakePaymentCommand command) {
        var payment = Payment.initiate(command.orderId(), command.amount());
        payments.save(payment);

        var outcome = gateway.charge(payment.id(), command.amount());
        if (outcome.authorized()) {
            payment.authorize(outcome.reference());
        } else {
            payment.decline(outcome.failureCode());
        }
        return PaymentResult.from(payments.save(payment));
    }
}
```

Spring is allowed here. The application layer orchestrates - it loads, calls domain methods, saves - and holds no business rules of its own. A conditional here that should be a domain method is the most common way a hexagon decays back into an anemic model.

Note this example makes a network call inside `@Transactional`, which [transactions.md](transactions.md) warns against. In real code, split it.

## Infrastructure: the adapters

```java
@Repository
class JpaPaymentRepository implements PaymentRepository {

    private final SpringDataPaymentRepository jpa;

    JpaPaymentRepository(SpringDataPaymentRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public Payment save(Payment payment) {
        return PaymentJpaMapper.toDomain(jpa.save(PaymentJpaMapper.toEntity(payment)));
    }

    @Override
    public Optional<Payment> findById(PaymentId id) {
        return jpa.findById(id.value()).map(PaymentJpaMapper::toDomain);
    }
}

interface SpringDataPaymentRepository extends JpaRepository<PaymentJpaEntity, UUID> {}
```

Two types where a plain feature has one: `Payment` (domain) and `PaymentJpaEntity` (persistence). **This is the cost of the hexagon**, and the thing to weigh before adopting it. The benefit is that a schema change does not touch the domain, and the domain has no persistence annotations distorting it.

Do not blur it by putting `@Entity` on the domain class. That saves the mapper and loses the entire point.

Mapping updates is where this gets awkward: `toEntity` on an existing row must merge onto the loaded entity rather than construct a new one, or you lose the JPA identity and the `@Version`. Load the entity, apply the changed fields, save.

The controller is a driving adapter - it depends on the in-port, never on the service class:

```java
@RestController
@RequestMapping("/api/payments")
class PaymentController {

    private final TakePaymentUseCase takePayment;   // the port, not TakePaymentService

    @PostMapping
    ResponseEntity<PaymentResponse> take(@Valid @RequestBody TakePaymentRequest request) {
        var result = takePayment.take(request.toCommand());
        return ResponseEntity.status(HttpStatus.CREATED).body(PaymentResponse.from(result));
    }
}
```

## Testing

The payoff:

```java
class PaymentTest {                                    // no Spring at all

    @Test
    void authorizesPendingPayment() {
        var payment = Payment.initiate(orderId, Money.of("49.99", "GBP"));
        payment.authorize("ch_123");
        assertThat(payment.status()).isEqualTo(PaymentStatus.AUTHORIZED);
    }

    @Test
    void refusesToAuthorizeTwice() {
        var payment = Payment.initiate(orderId, Money.of("49.99", "GBP"));
        payment.authorize("ch_123");
        assertThatThrownBy(() -> payment.authorize("ch_456"))
                .isInstanceOf(PaymentNotPendingException.class);
    }
}
```

Use cases test against **hand-written fakes** of the out-ports, not Mockito - an in-memory `PaymentRepository` is a few lines and is reusable across every use-case test. See [testing-unit.md](testing-unit.md).

The adapters still need real tests: the JPA adapter against Testcontainers ([testing-slices-persistence.md](testing-slices-persistence.md)), the gateway adapter against WireMock ([testing-integration.md](testing-integration.md)). The hexagon does not remove those, it isolates them.

## If on Boot 3.5.x

Nothing here is version-specific - it is a structural pattern using plain Java plus `@Service`, `@Repository` and `@Transactional`. The Boot 4 differences that apply are in the adapters: Jackson 3 in the web adapter, Testcontainers 2 in the adapter tests.

## Gotchas

- Agent creates root-level `domain/`, `application/`, `infrastructure/` packages - that is layer-first relabelled; the hexagon goes inside a feature
- Agent applies the hexagon to every feature - apply it where the rules justify it; CRUD features stay flat
- Agent puts `@Entity` or `jakarta.persistence` on a domain class - the domain must be framework-free
- Agent injects `JpaRepository` into a use case - depend on the domain's own repository port
- Agent puts `Page`, `ResponseEntity` or an entity in a port signature - ports are expressed in domain terms
- Agent puts `@Transactional` on a domain class - it belongs on the application service
- Agent injects the concrete service into the controller - depend on the in-port
- Agent confuses in-ports and out-ports - `in` is what the feature offers, `out` is what it needs
- Agent builds ports with only getters and setters behind them - an anemic hexagon is all cost and no benefit
- Agent skips the mapper and shares one class as domain model and entity - that removes the only reason to build the hexagon
- Agent maps an update by constructing a fresh entity - merge onto the loaded one or you lose the identity and `@Version`
- Agent mocks out-ports with Mockito everywhere - hand-written in-memory fakes are clearer and reusable
- Agent relies on discipline to keep the domain pure - add an ArchUnit rule; it erodes otherwise

## Related

- [code-organization.md](code-organization.md) · [domain-modelling.md](domain-modelling.md) · [archunit.md](archunit.md) · [testing-unit.md](testing-unit.md) · [transactions.md](transactions.md)
