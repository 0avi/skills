# Spring Proxies and Dependency Injection

Two things cause more silently-broken Spring code than anything else: field injection, and calling an annotated method on `this`. Both are covered here once; the rest of the skill links back.

## Constructor injection, always

```java
@Service
public class OrderService {

    private final OrderRepository orderRepository;
    private final InventoryService inventoryService;

    OrderService(OrderRepository orderRepository, InventoryService inventoryService) {
        this.orderRepository = orderRepository;
        this.inventoryService = inventoryService;
    }
}
```

No Lombok, no `@Autowired`. A single-constructor bean has its constructor used for injection automatically - the annotation has been unnecessary since Spring 4.3.

Why it is not merely a style preference:

- **`final` fields.** The dependency cannot be reassigned, and the compiler proves every one is set.
- **No half-built object.** Field injection constructs the bean, then populates it; anything running in between sees `null`.
- **Unit-testable without a container.** `new OrderService(mockRepo, mockInventory)` - no reflection, no `@SpringBootTest`. This is the whole reason [testing-unit.md](testing-unit.md) works.
- **Too many parameters is a signal, not a nuisance.** A constructor with nine dependencies is telling you the class does nine things. Field injection hides that.

Make the constructor package-private in a flat feature package - Spring does not need it public, and nothing outside the feature should be constructing the service by hand.

### Never

```java
@Autowired private OrderRepository orderRepository;   // field injection
@Autowired public void setRepo(OrderRepository r) { } // setter injection
```

Setter injection is defensible only for a genuinely optional, reconfigurable dependency. That is rare enough that if you are reaching for it, check first.

### Optional and multiple dependencies

```java
// Optional collaborator - absent is legal
OrderService(OrderRepository repo, Optional<AuditSink> auditSink) { … }

// Every implementation of an interface, injected as a list
OrderService(List<OrderValidator> validators) { … }

// Disambiguating two beans of the same type
OrderService(@Qualifier("primaryClock") Clock clock) { … }
```

`Optional<T>` as a *constructor parameter* is the one place java-developer's "never `Optional` as a parameter" rule does not apply - Spring defines this as its optional-dependency protocol, and the alternative is `@Autowired(required = false)` on a field.

## The proxy, and the self-invocation trap

Spring implements `@Transactional`, `@Async`, `@Cacheable`, `@Retryable`, `@ConcurrencyLimit`, `@PreAuthorize` and `@Validated` by wrapping your bean in a **proxy**. Callers get the proxy; the proxy runs the behaviour and then delegates to your object.

This means the annotation only works when the call **arrives from outside**. A call to `this.method()` goes straight to your object and the proxy is never involved.

```java
@Service
public class OrderService {

    @Transactional
    public void processAll(List<UUID> ids) {
        ids.forEach(id -> this.processSingle(id));   // ⚠ direct call - no new transaction
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void processSingle(UUID id) { … }         // annotation silently ignored
}
```

It compiles, runs, and does the wrong thing. There is no warning.

### The fix: cross a bean boundary

```java
@Service
public class OrderService {

    private final OrderItemProcessor processor;      // a separate bean

    OrderService(OrderItemProcessor processor) {
        this.processor = processor;
    }

    @Transactional
    public void processAll(List<UUID> ids) {
        ids.forEach(processor::processSingle);       // through the proxy
    }
}
```

Extracting the method to its own bean is the right fix nearly every time - the two methods wanted different transactional semantics, which usually means they were different responsibilities. Self-injection (`@Lazy OrderService self`) works and is a smell.

### Where this bites

| Annotation | Symptom when self-invoked |
|---|---|
| `@Transactional` | No transaction, or the wrong propagation. Writes commit or roll back unexpectedly |
| `@Async` | Runs synchronously on the caller's thread |
| `@Cacheable` | Cache never consulted or populated; every call hits the database |
| `@Retryable` | No retry; the first failure propagates |
| `@PreAuthorize` | **Authorization check skipped entirely** |
| `@Validated` | Method parameters unvalidated |

The `@PreAuthorize` row is a security hole, not an inefficiency.

### Two more proxy rules

- **`private`, `static` and `final` methods cannot be advised.** A CGLIB proxy subclasses your class and overrides methods; it cannot override those. `@Transactional` on a private method does nothing.
- **`final` classes cannot be proxied at all** - bean creation fails, or the advice is dropped. Do not make an annotated `@Service` final. (This is the one place java-developer's "prefer `final` classes" rule yields to the framework; entities and Spring beans are excluded, DTOs and value objects are not.)

## Configuration classes

```java
@Configuration
public class HttpClientConfig {

    @Bean
    RestClient inventoryRestClient(RestClient.Builder builder,
                                   InventoryProperties properties) {
        return builder.baseUrl(properties.baseUrl()).build();
    }
}
```

- `@Configuration` classes belong in `config/`, or in a feature's own package when the bean belongs to that feature. See [code-organization.md](code-organization.md).
- **Wire infrastructure, not business logic.** A `@Configuration` that injects a `@Service` has the dependency backwards.
- `@Bean` methods on a `@Configuration` are themselves proxied so that calling one twice returns the same bean. Set `@Configuration(proxyBeanMethods = false)` when methods do not call each other - it is faster and it is what Boot's own auto-configuration does.
- Prefer `@ConfigurationProperties` over `@Value` for anything with more than one related key. See [configuration.md](configuration.md).

### Conditional beans

```java
@Bean
@ConditionalOnMissingBean            // let the application override this default
OrderNumberGenerator orderNumberGenerator() { … }

@Bean
@ConditionalOnProperty(name = "app.features.recommendations", havingValue = "true")
RecommendationClient recommendationClient() { … }
```

`@ConditionalOnMissingBean` is for library and auto-configuration authors supplying an overridable default. In application code, prefer `@ConditionalOnProperty` or a profile - an application bean that silently vanishes because something else defined the same type is very hard to debug.

## Bean lifecycle

| Need | Use |
|---|---|
| Work after dependencies are injected | `@PostConstruct`, or do it in the constructor |
| Cleanup at shutdown | `@PreDestroy` |
| Work after the whole context is ready | `ApplicationRunner` / `CommandLineRunner`, or `@EventListener(ApplicationReadyEvent.class)` |

Do not start threads, open connections or call remote services from a constructor or `@PostConstruct` - the context is not fully built, and a failure there turns into an obscure startup error. Use `ApplicationReadyEvent`.

## If on Boot 3.5.x

Version-agnostic. Constructor injection, proxying, the self-invocation trap, `@Configuration` semantics and the bean lifecycle are unchanged between the two lines - this file applies verbatim.

## Gotchas

- Agent writes `@Autowired` on a field - constructor injection only; `final` fields and no half-built objects
- Agent adds `@Autowired` to the single constructor - unnecessary since Spring 4.3
- Agent calls an annotated method on `this` - the proxy is bypassed and the annotation silently does nothing
- Agent puts `@Transactional` (or any advice annotation) on a `private` method - a proxy cannot override it
- Agent marks an advised `@Service` class `final` - it cannot be proxied
- Agent stacks `@Retryable` and `@Transactional` on the same method - the retry re-runs inside a transaction already marked rollback-only; put the retry on a calling bean. See [resilience.md](resilience.md)
- Agent injects a `@Service` into a `@Configuration` class - configuration wires infrastructure, not business logic
- Agent uses `@ConditionalOnMissingBean` in application code - that is an auto-configuration idiom; use a property or profile
- Agent opens connections in `@PostConstruct` - use `ApplicationReadyEvent`; the context is not finished yet
- Agent injects `ApplicationContext` to look beans up by hand - inject the dependency, or a `List<T>` / `Map<String, T>` of them

## Related

- [transactions.md](transactions.md) · [async-and-scheduling.md](async-and-scheduling.md) · [caching.md](caching.md) · [resilience.md](resilience.md) · [security-fundamentals.md](security-fundamentals.md) · [java-in-spring.md](java-in-spring.md)
