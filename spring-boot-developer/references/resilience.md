# Resilience

Spring Framework 7 has declarative retry and concurrency limiting in the core framework. **This is not Spring Retry repackaged** - the annotations live in a different package, the attribute names differ, and there is no recovery callback. Code written for Spring Retry does not compile against it.

## Before reaching for retry

Retry is the third thing to try, not the first.

1. **Timeouts.** A call with no timeout cannot be retried usefully, and it is the actual cause of most cascading failures. See [http-clients.md](http-clients.md).
2. **Idempotency.** Retrying a non-idempotent operation duplicates it. Fix that first, or do not retry.
3. **Then retry** - and only transient failures.

Retrying a broken dependency turns your traffic into a denial-of-service against it, right when it is least able to cope. Cap the attempts, back off exponentially, and add jitter.

## Enable it

```java
@Configuration
@EnableResilientMethods
class ResilienceConfig {
}
```

Without this the annotations are inert and the method simply runs once, silently.

## Retry

```java
import org.springframework.resilience.annotation.Retryable;

@Service
public class InventoryGateway {

    @Retryable(
            includes = { ConnectException.class, InventoryUnavailableException.class },
            maxRetries = 3,
            delay = 200,
            multiplier = 2.0,
            maxDelay = 2000,
            jitter = 100)
    public StockLevel stockFor(ProductId productId) {
        return inventoryClient.stockFor(productId.value());
    }
}
```

| Attribute | Meaning |
|---|---|
| `includes` | Exception types to retry. **Always set this** - the default retries everything, including bugs |
| `excludes` | Types never to retry |
| `maxRetries` | Retries **after** the first call. `3` means up to 4 total attempts |
| `delay` | Initial delay in milliseconds |
| `multiplier` | Exponential factor. `1.0` is a fixed delay |
| `maxDelay` | Ceiling for the backoff |
| `jitter` | Random spread, so a fleet does not retry in lockstep |

Jitter is not optional at scale. Without it, every instance that failed at the same moment retries at the same moment, and the thundering herd is what keeps the dependency down.

### Differences from Spring Retry

| Spring Retry | Framework 7 core |
|---|---|
| `org.springframework.retry.annotation` | `org.springframework.resilience.annotation` |
| `@EnableRetry` | `@EnableResilientMethods` |
| `maxAttempts` (total calls) | `maxRetries` (retries after the first) |
| `retryFor` / `noRetryFor` | `includes` / `excludes` |
| Nested `@Backoff(delay=…, multiplier=…)` | Flat `delay`, `multiplier`, `maxDelay`, `jitter` |
| `@Recover` fallback method | **None** - the final exception reaches the caller |

`maxAttempts = 3` and `maxRetries = 3` are not the same: three total calls versus four.

**There is no `@Recover`.** When attempts are exhausted the last exception propagates. Handle it at the orchestration boundary:

```java
public StockLevel stockOrUnknown(ProductId productId) {
    try {
        return inventoryGateway.stockFor(productId);
    } catch (InventoryUnavailableException e) {
        log.warn("Inventory unavailable for {}, degrading", productId, e);
        return StockLevel.unknown();
    }
}
```

Degrading deliberately like this is usually better than failing the whole request - decide per call site whether stale or absent data is acceptable.

## Retry and transactions

**Never put `@Retryable` and `@Transactional` on the same method.** The first failure marks the transaction rollback-only; every retry then runs inside a doomed transaction and fails at commit.

Put the retry on a bean that *calls* the transactional one, so each attempt gets a fresh transaction:

```java
@Service
public class OrderStatusUpdater {

    private final OrderService orderService;      // separate bean

    @Retryable(includes = ObjectOptimisticLockingFailureException.class,
               maxRetries = 3, delay = 50, jitter = 25)
    public void changeStatus(OrderId id, OrderStatus status) {
        orderService.changeStatus(id, status);    // @Transactional lives here
    }
}
```

Retrying an optimistic-lock failure is the textbook case: the conflict is genuinely transient, and the retry reloads the current version. See [transactions.md](transactions.md).

## Concurrency limiting

```java
import org.springframework.resilience.annotation.ConcurrencyLimit;

@ConcurrencyLimit(8)
public Report generate(ReportRequest request) { … }
```

A bulkhead: at most eight concurrent invocations, the rest wait. Use it to stop one expensive operation consuming every thread, or to respect a downstream's concurrency budget.

On a contended write path, capping concurrency often beats retrying - it prevents the contention instead of reacting to it.

## Proxy rules

Both annotations are proxy-based. Self-invocation bypasses them entirely and silently, and neither works on a `private`, `static` or `final` method. See [spring-proxies-and-di.md](spring-proxies-and-di.md).

## What to retry

| Retry | Do not retry |
|---|---|
| Connection refused, connection reset | 400, 401, 403, 404, 422 |
| Read timeout on an **idempotent** call | Validation failures |
| 502, 503, 504 | Business rule violations |
| Optimistic-lock failure | Anything non-idempotent without an idempotency key |
| Deadlock detected | Bugs - `NullPointerException`, `IllegalArgumentException` |

A read timeout on a **`POST`** is the difficult case: the request may well have succeeded. Retrying creates a duplicate. Either make the endpoint idempotent with a client-supplied key, or do not retry writes.

This is why `includes` should always be set. The default retries `NullPointerException` four times before giving you the same stack trace.

## Circuit breakers

Core Spring has **no** circuit breaker. Retry alone does not stop you hammering a dependency that is comprehensively down.

The standard option is Spring Cloud Circuit Breaker with Resilience4j - an added third-party dependency, which is a real cost to weigh. Cheaper approaches that often suffice:

- **Aggressive timeouts plus `@ConcurrencyLimit`** bound the damage: a dead dependency can only ever consume N threads for T seconds.
- **A deliberate fallback** at the call site, as above.
- **Actuator health indicators** on the dependency so it is visible rather than silent - see [observability.md](observability.md).

Add a circuit breaker when a genuinely optional dependency fails often enough that failing fast is materially better than failing slowly. Not by default.

## If on Boot 3.5.x

Core resilience is Framework 7, so **none of it exists** on 3.5.x. Use Spring Retry:

```xml
<dependency>
    <groupId>org.springframework.retry</groupId>
    <artifactId>spring-retry</artifactId>
</dependency>
```

```java
@EnableRetry     // not @EnableResilientMethods

@Retryable(retryFor = ConnectException.class,
           maxAttempts = 4,                                   // total, not retries
           backoff = @Backoff(delay = 200, multiplier = 2.0, maxDelay = 2000, random = true))
public StockLevel stockFor(ProductId productId) { … }

@Recover
public StockLevel fallback(ConnectException e, ProductId productId) {
    return StockLevel.unknown();
}
```

Spring Retry also needs `spring-boot-starter-aspectj` (`-aop` on 3.5.x). On upgrade: translate `maxAttempts` to `maxRetries` minus one, flatten `@Backoff`, and replace `@Recover` with a `try`/`catch` at the caller.

## Gotchas

- Agent adds `spring-retry` on Boot 4 for basic retry - it is in the core framework
- Agent imports `org.springframework.retry.annotation` on Boot 4 - core is `org.springframework.resilience.annotation`
- Agent forgets `@EnableResilientMethods` - the annotations are silently inert
- Agent writes `maxAttempts` - core uses `maxRetries`, which excludes the first call
- Agent writes `retryFor`/`noRetryFor` - core uses `includes`/`excludes`
- Agent nests `@Backoff` - the attributes are flat on `@Retryable`
- Agent adds `@Recover` - core has no recovery callback; catch at the caller
- Agent omits `includes` - the default retries everything, including `NullPointerException`
- Agent retries a 4xx - it will fail identically every time
- Agent retries a non-idempotent `POST` after a timeout - that duplicates the operation
- Agent omits jitter - the whole fleet retries in lockstep
- Agent stacks `@Retryable` and `@Transactional` - every retry runs in the rollback-only transaction
- Agent retries a self-invoked method - the proxy is bypassed
- Agent adds retry without a timeout - the call that never returns is never retried either
- Agent adds a circuit breaker by default - bound the damage with timeouts and a concurrency limit first

## Related

- [http-clients.md](http-clients.md) · [transactions.md](transactions.md) · [spring-proxies-and-di.md](spring-proxies-and-di.md) · [messaging.md](messaging.md) · [observability.md](observability.md)
