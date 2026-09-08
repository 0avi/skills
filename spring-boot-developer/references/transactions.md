# Transactions

## Where `@Transactional` goes

**On the service.** Not the controller, not the repository.

The service method is the unit of work: it is the scope that must succeed or fail as a whole. A repository method is too small - two repository calls in one business operation would be two transactions. A controller is too large and drags HTTP concerns into the transaction boundary.

```java
@Service
@Transactional(readOnly = true)          // the default for every method here
public class OrderService {

    private final OrderRepository orderRepository;
    private final InventoryService inventoryService;

    OrderService(OrderRepository orderRepository, InventoryService inventoryService) {
        this.orderRepository = orderRepository;
        this.inventoryService = inventoryService;
    }

    @Transactional                        // override for writes
    public OrderId place(PlaceOrderCmd cmd) {
        var order = Order.create(cmd.customerId());
        cmd.lines().forEach(line -> order.addItem(line.productId(), line.quantity(), line.unitPrice()));
        order.place();
        inventoryService.reserve(order.id(), cmd.lines());   // joins this transaction
        return orderRepository.save(order).id();
    }

    public OrderResponse getById(OrderId id) {               // inherits readOnly = true
        return OrderResponse.from(orderRepository.getById(id));
    }
}
```

Class-level `readOnly = true` with method-level overrides is the right default: read methods outnumber writes, and forgetting `readOnly` on a read is silent while forgetting `@Transactional` on a write is loud.

`readOnly = true` is not decoration. Hibernate sets the flush mode to manual, so it skips dirty checking on every loaded entity, and the driver can route to a read replica.

## Propagation

| Propagation | Behaviour |
|---|---|
| `REQUIRED` (default) | Join the caller's transaction, or start one |
| `REQUIRES_NEW` | Suspend the caller's, run in a new one, resume |
| `MANDATORY` | Must already be in one, else throw |
| `SUPPORTS` | Join if present, otherwise run without |
| `NOT_SUPPORTED` | Suspend any transaction and run without |
| `NEVER` | Throw if a transaction exists |
| `NESTED` | Savepoint within the caller's transaction |

You will use `REQUIRED` and occasionally `REQUIRES_NEW`. The rest exist for cases you will recognise when you meet them.

`REQUIRES_NEW` is for work that must survive the caller's rollback - an audit record, a failure log:

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)
public void recordAttempt(AuditEvent event) {
    auditRepository.save(event);          // commits independently
}
```

It takes a **second connection** from the pool while the first is suspended. A `REQUIRES_NEW` inside a loop over a large collection will exhaust the pool and deadlock - the outer transactions hold connections while waiting for inner ones that cannot get any.

## Rollback rules

`@Transactional` rolls back on `RuntimeException` and `Error`. It **commits** on a checked exception.

```java
@Transactional(rollbackFor = InventoryUnavailableException.class)   // checked
public OrderId place(PlaceOrderCmd cmd) throws InventoryUnavailableException { … }
```

Simpler: make domain exceptions unchecked, as [error-handling.md](error-handling.md) does. Then rollback is automatic and no caller has to declare anything.

**Catching an exception does not undo a rollback.** Once a participating method has thrown, the transaction is marked rollback-only; catching it and carrying on ends in `UnexpectedRollbackException` at commit. If a step is genuinely optional, it needs `REQUIRES_NEW` so its failure never touches the caller's transaction.

## Self-invocation

`@Transactional` is proxy-based, so `this.otherMethod()` bypasses it entirely and silently. This is the single most common Spring bug - it is covered in full, with the fix, in [spring-proxies-and-di.md](spring-proxies-and-di.md).

Same reason: `@Transactional` on a `private`, `static` or `final` method does nothing.

## Keep transactions short

A transaction holds a database connection and, on a write, row locks. Everything inside it is contention.

**Never make a network call inside a transaction.** An HTTP call to a payment provider inside `@Transactional` holds a connection and locks for the duration of someone else's outage. Restructure: do the remote work before or after, and keep the transaction to the database writes.

```java
// ❌ the transaction is open for the whole remote round trip
@Transactional
public void pay(OrderId id) {
    var order = orderRepository.getById(id);
    var result = paymentGateway.charge(order.total());   // seconds, or a timeout
    order.markPaid(result.reference());
}
```

```java
// ✅ remote call outside; two short transactions around it
public void pay(OrderId id) {
    var total = orderService.totalOf(id);                // transaction 1
    var result = paymentGateway.charge(total);           // no transaction held
    orderService.markPaid(id, result.reference());       // transaction 2
}
```

This does introduce a window where the charge succeeded and the local write has not happened yet. That is a real distributed-systems problem and the answer is idempotency and reconciliation - not a longer transaction, which does not fix it either.

### The transaction is bound to the thread, so it does not cross a fork

Spring holds the `Connection`, the `EntityManager` and the synchronizations in `TransactionSynchronizationManager`, which is a `ThreadLocal`. Anything that moves work to another thread therefore leaves the transaction behind - an `@Async` method, a `parallelStream()`, and a `StructuredTaskScope.fork(...)` alike. The subtask does not join your transaction and does not fail with it: it silently takes its own connection from the pool and commits on its own.

```java
@Transactional                                       // ❌ neither fork is in this transaction
public void reprice(OrderId id) {
    try (var scope = StructuredTaskScope.open()) {
        scope.fork(() -> orderRepository.save(...));  // its own connection, its own commit
        scope.fork(() -> auditRepository.save(...));  // and this one commits even if the first fails
        scope.join();
    }
}
```

Fan out **before** the transaction opens, over work that is not database work, and write once you have joined. See [async-and-scheduling.md](async-and-scheduling.md).

## Optimistic locking

`@Version` on the entity ([spring-data-jpa.md](spring-data-jpa.md)) makes a concurrent update fail rather than silently overwrite:

```java
@Transactional
public void changeStatus(OrderId id, OrderStatus status) {
    orderRepository.getById(id).changeStatus(status);
    // ObjectOptimisticLockingFailureException on commit if another transaction won
}
```

Map it to **409** and let the client retry, or retry server-side - see [resilience.md](resilience.md). Pessimistic locking (`@Lock(LockModeType.PESSIMISTIC_WRITE)`) is for genuinely contended rows where a retry loop would thrash; it holds a database lock, so keep the transaction tiny.

## Side effects belong after commit

An email sent inside a transaction that later rolls back has still been sent. Bind side effects to the commit:

```java
@Transactional
public OrderId place(PlaceOrderCmd cmd) {
    var order = Order.create(cmd.customerId());
    orderRepository.save(order);
    events.publishEvent(new OrderPlaced(order.id(), order.total()));  // not delivered yet
    return order.id();
}
```

```java
@Component
class OrderPlacedNotifier {

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void on(OrderPlaced event) {
        emailService.sendConfirmation(event.orderId());   // safe: the data is durable
    }
}
```

- Plain `@EventListener` runs **synchronously inside** the publishing transaction - exactly what you are trying to avoid.
- `AFTER_COMMIT` runs **outside** the original transaction, so a listener that writes needs its own `@Transactional(propagation = REQUIRES_NEW)`.
- The listener runs on the publishing thread by default, so the caller still waits. Add `@Async` to decouple - and accept that a failure after commit is then lost unless you persist the intent.

Spring Modulith's `@ApplicationModuleListener` bundles `AFTER_COMMIT` + `@Async` + `REQUIRES_NEW` and can persist publications so they survive a crash. Prefer it when it is available - see [spring-modulith.md](spring-modulith.md). Across a process boundary, use a transactional outbox ([messaging.md](messaging.md)).

## Retry and transactions

Never put `@Retryable` and `@Transactional` on the same method. The retry re-runs inside a transaction already marked rollback-only, so every attempt fails at commit. Put the retry on a **calling** bean so each attempt gets a fresh transaction. See [resilience.md](resilience.md).

## Multi-service operations

There is no distributed transaction across HTTP. Use a saga: a sequence of local transactions, each with a compensating action.

```java
@Service
public class PlaceOrderSaga {

    public OrderId execute(PlaceOrderCmd cmd) {
        var orderId = orderService.createDraft(cmd);            // local transaction
        try {
            inventoryClient.reserve(orderId, cmd.lines());
            paymentClient.charge(orderId, cmd.total());
            orderService.confirm(orderId);                      // local transaction
            return orderId;
        } catch (PaymentFailedException e) {
            inventoryClient.release(orderId);                   // compensate
            orderService.fail(orderId, e.getMessage());
            throw e;
        }
    }
}
```

The saga method itself is **not** `@Transactional` - it spans network calls. Each compensating action must be idempotent, because it may run after a partial failure or be retried.

## If on Boot 3.5.x

Everything here is identical. The one difference is retry: core `@Retryable` and `@EnableResilientMethods` are Framework 7, so on 3.5.x that is the separate Spring Retry project with different attribute names - see [resilience.md](resilience.md).

## Gotchas

- Agent puts `@Transactional` on a controller - it belongs on the service
- Agent calls a `@Transactional` method on `this` - the proxy is bypassed and there is no transaction
- Agent puts `@Transactional` on a `private` method - a proxy cannot advise it
- Agent omits `readOnly = true` on reads - loses the dirty-checking and replica-routing optimisation
- Agent expects a checked exception to roll back - it commits; use unchecked exceptions or `rollbackFor`
- Agent catches an exception inside a transaction and continues - it is already rollback-only; expect `UnexpectedRollbackException`
- Agent makes an HTTP call inside a transaction - holds a connection and locks for the length of a remote timeout
- Agent uses `REQUIRES_NEW` inside a loop - each one takes a second connection; the pool deadlocks
- Agent sends email or publishes to a broker inside the transaction - use `@TransactionalEventListener(AFTER_COMMIT)`
- Agent uses plain `@EventListener` for a post-commit side effect - it runs inside the transaction
- Agent writes to the database from an `AFTER_COMMIT` listener without `REQUIRES_NEW` - there is no active transaction there
- Agent stacks `@Retryable` and `@Transactional` on one method - every retry runs in the doomed transaction
- Agent makes the saga orchestrator `@Transactional` - it spans network calls; each step is its own local transaction
- Agent writes non-idempotent compensating actions - they will run twice
- Agent forks repository calls inside `@Transactional`, or parallelises them with `parallelStream()` - the transaction is thread-bound, so each one commits separately and a rollback does not reach them

## Related

- [spring-proxies-and-di.md](spring-proxies-and-di.md) · [spring-data-jpa.md](spring-data-jpa.md) · [resilience.md](resilience.md) · [messaging.md](messaging.md) · [spring-modulith.md](spring-modulith.md) · [error-handling.md](error-handling.md) · [async-and-scheduling.md](async-and-scheduling.md)
