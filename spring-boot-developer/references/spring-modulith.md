# Spring Modulith

Modulith is rung two and three of the ladder in [code-organization.md](code-organization.md): it enforces module boundaries that javac can no longer see once a feature has sub-packages. It is a **test-time verification tool** plus an event infrastructure - it changes nothing at runtime unless you use the event support.

Adopt it when a feature outgrows a single flat package. Not before.

## The convention

| Rule | Meaning |
|---|---|
| Each **direct sub-package** of the main application package is an application module | `com.example.app.orders` is a module; `com.example.app.orders.internal` is not |
| The module's **base package is its API** | The only package other modules may depend on |
| **Nested packages are internal** | A sibling module referencing `orders.internal.*` fails verification |
| `@NamedInterface` re-exposes a nested package | For when the base package is not enough |

So under Modulith, nesting is how you *declare* internals. This is the inverse of the flat layout, where nesting would destroy the boundary - Modulith is what replaces the lost `package-private` enforcement.

```
com.example.app/
├── Application.java
├── orders/
│   ├── OrdersApi.java             ← API: visible to other modules
│   ├── OrderResponse.java         ← API
│   └── internal/                  ← invisible to other modules
│       ├── Order.java
│       ├── OrderRepository.java
│       └── OrderService.java
├── inventory/
├── shared/                        ← OPEN
└── config/                        ← OPEN
```

## Setup

```xml
<properties>
    <spring-modulith.version>2.1.0</spring-modulith.version>
</properties>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.modulith</groupId>
            <artifactId>spring-modulith-bom</artifactId>
            <version>${spring-modulith.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>org.springframework.modulith</groupId>
        <artifactId>spring-modulith-starter-core</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.modulith</groupId>
        <artifactId>spring-modulith-starter-test</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

Use **Modulith 2.x with Boot 4**, 1.4.x with Boot 3.5.x. Confirm the current patch version rather than copying the one above.

## The verification test

Without this test, Modulith does nothing. Write it once, in the root package:

```java
class ModularityTests {

    static final ApplicationModules modules = ApplicationModules.of(Application.class);

    @Test
    void verifiesModularStructure() {
        modules.verify();
    }

    @Test
    void writesDocumentation() {
        new Documenter(modules).writeDocumentation();
    }
}
```

`verify()` fails the build on a cycle between modules or a reference into another module's internals. `Documenter` emits PlantUML component diagrams and an AsciiDoc module canvas into `target/spring-modulith-docs` - genuinely useful in review, and free.

## Opening the shared and config modules

`shared/` and `config/` are detected as modules, so every feature depending on them is reported as a violation. Mark them open:

```java
@ApplicationModule(type = ApplicationModule.Type.OPEN)
package com.example.app.shared;

import org.springframework.modulith.ApplicationModule;
```

`OPEN` means "no internal structure, anyone may depend on anything here". Use it only for genuinely cross-cutting packages. An `OPEN` feature module is a contradiction - it has opted out of the thing you added Modulith for.

## Exposing more than the base package

```java
@NamedInterface("events")
package com.example.app.orders.events;

import org.springframework.modulith.NamedInterface;
```

Other modules may then depend on `orders.events` as well as the base package. Use this for a module's published event types, or an SPI other modules implement. Every named interface is a public commitment - add them deliberately, not to make a verification failure go away.

## Nested modules - the large feature

Since Modulith 1.3, a package **inside** a module can itself be a module. This is the sanctioned answer to a feature with ten services and several sub-areas:

```java
@ApplicationModule
package com.example.app.orders.pricing;

import org.springframework.modulith.ApplicationModule;
```

```
orders/
├── OrdersApi.java              ← the top-level module's API
├── pricing/                    ← nested module, hidden from inventory/, shipping/…
│   └── internal/
├── fulfilment/                 ← nested module
│   └── internal/
└── internal/
```

A nested module is invisible to sibling **top-level** modules, while code inside it can still use what top-level modules expose. That gives you internal structure inside a large feature without leaking it outward.

Before reaching for this, apply the test in [code-organization.md](code-organization.md) - if the parts share no invariant and point in different directions, they are sibling features that got filed together, and nesting will formalise the mistake.

## Events: the way modules talk

Direct injection across modules couples them. For anything that does not need a synchronous answer, publish an event.

```java
// In orders - the event type is part of the module's API
public record OrderPlaced(OrderId orderId, CustomerId customerId, Money total) {}

// In orders/internal
@Transactional
public OrderId place(PlaceOrderCmd cmd) {
    var order = Order.place(cmd);
    orderRepository.save(order);
    events.publishEvent(new OrderPlaced(order.id(), order.customerId(), order.total()));
    return order.id();
}
```

```java
// In inventory - a different module, no compile-time dependency on orders' internals
@Component
class OrderPlacedListener {

    private static final Logger log = LoggerFactory.getLogger(OrderPlacedListener.class);

    @ApplicationModuleListener
    void on(OrderPlaced event) {
        inventoryService.reserve(event.orderId());
    }
}
```

`@ApplicationModuleListener` is the one to use. It is a meta-annotation combining:

- `@TransactionalEventListener(phase = AFTER_COMMIT)` - the listener runs only if the publisher's transaction committed
- `@Async` - on a separate thread, so the publisher does not wait
- `@Transactional(propagation = REQUIRES_NEW)` - the listener gets its own transaction

That combination is what you almost always want and almost never write correctly by hand. See [transactions.md](transactions.md) for why `AFTER_COMMIT` matters.

### Making events survive a crash

By default an async listener that fails loses the event. The event publication registry persists each publication and marks it complete when the listener succeeds:

```xml
<dependency>
    <groupId>org.springframework.modulith</groupId>
    <artifactId>spring-modulith-starter-jdbc</artifactId>
</dependency>
```

```properties
spring.modulith.events.jdbc.schema-initialization.enabled=true
spring.modulith.events.completion-mode=update
spring.modulith.events.republish-outstanding-events-on-restart=true
```

Incomplete publications are retried on restart. In production manage the event-publication table with [Flyway](flyway.md) rather than letting Modulith create it - `schema-initialization.enabled=true` is a development convenience.

This is a transactional outbox for in-process modules. For crossing a process boundary, see [messaging.md](messaging.md).

## Module tests

```java
@ApplicationModuleTest
class OrdersModuleTests {

    @Test
    void placesOrder(Scenario scenario) {
        scenario.stimulate(() -> ordersApi.place(cmd))
                .andWaitForEventOfType(OrderPlaced.class)
                .toArriveAndVerify(event -> assertThat(event.total()).isEqualTo(expected));
    }
}
```

`@ApplicationModuleTest` boots only the module under test and fails if it touches another module's internals. `Scenario` handles the await for async event delivery - do not write `Thread.sleep` for this.

## If on Boot 3.5.x

Use Modulith **1.4.x**; 2.x targets Boot 4. Nested modules (1.3+), `@ApplicationModuleListener`, `@NamedInterface` and the event publication registry all exist on 1.4.x. Modulith 2.1's integration of module tests with Boot's slice-test support is 2.x only.

## Gotchas

- Agent adds the Modulith dependency and never writes the verification test - without `modules.verify()` in a test, Modulith enforces nothing
- Agent expects Modulith to enforce boundaries at runtime - it is a build-time check plus an event library
- Agent leaves `shared/` and `config/` unmarked - they are detected as modules and every dependency on them is reported as a violation; mark them `type = OPEN`
- Agent marks a feature module `OPEN` to silence a failure - that opts the module out of the only thing Modulith does
- Agent adds `@NamedInterface` to make a violation go away - the violation is usually correct; move the type or publish an event
- Agent injects another module's `@Service` directly - depend on its API type, or use an event
- Agent uses plain `@EventListener` between modules - it runs inside the publisher's transaction, so a later rollback leaves the side effect done; use `@ApplicationModuleListener`
- Agent expects async events to survive a crash without the registry - add `spring-modulith-starter-jdbc`
- Agent lets Modulith create the event table in production - manage it with Flyway
- Agent puts entities and repositories in the module's base package - that publishes them; they belong in a nested internal package
- Agent nests modules inside a feature that is really several features - check for a shared invariant first

## Related

- [code-organization.md](code-organization.md) · [domain-modelling.md](domain-modelling.md) · [transactions.md](transactions.md) · [messaging.md](messaging.md) · [archunit.md](archunit.md)
