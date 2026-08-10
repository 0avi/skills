# Async and Scheduling

## Virtual threads first

On Java 21+, turn them on:

```yaml
spring:
  threads:
    virtual:
      enabled: true
```

Every request is then handled on a virtual thread. A blocking call - JDBC, an HTTP client, a message send - parks the virtual thread and releases the underlying platform thread, so throughput stops being bounded by a fixed pool of 200 Tomcat threads.

What this changes:

- **Reactive is no longer the answer to "handle more concurrent requests".** That was the main reason most teams adopted WebFlux, and it is gone. Blocking code on virtual threads is simpler and now scales comparably.
- **Connection pool sizing becomes the real limit.** Virtual threads are effectively unlimited; your database connections are not. Ten thousand concurrent requests against a pool of ten means 9,990 threads waiting on the pool. Size and monitor the pool, not the thread pool.
- **Thread pools stop being a useful bulkhead.** A bounded pool used to cap concurrent work against a dependency. Use `@ConcurrencyLimit` for that now - see [resilience.md](resilience.md).

Two caveats:

- **`synchronized` blocks pin** the carrier thread on some JDK versions - a virtual thread blocked inside `synchronized` cannot unmount. Prefer `ReentrantLock` in code on a hot path. Pinning was substantially improved in later JDKs; verify against the JDK you actually run.
- **`ThreadLocal` still works but is per-task**, and virtual threads are created per request rather than pooled, so a `ThreadLocal` cache that used to be reused across requests is now allocated per request.

## `@Async`

```java
@Configuration
@EnableAsync
class AsyncConfig {
}
```

```java
@Component
public class OrderNotifier {                     // a SEPARATE bean from the caller

    @Async
    public void sendConfirmation(OrderId orderId) {
        emailClient.send(…);
    }

    @Async
    public CompletableFuture<Receipt> generateReceipt(OrderId orderId) {
        return CompletableFuture.completedFuture(receiptService.build(orderId));
    }
}
```

Three rules that account for nearly every `@Async` bug:

1. **Self-invocation does nothing.** `this.sendConfirmation(id)` runs synchronously on the caller's thread - no error, no warning. The annotated method must live on a different bean. See [spring-proxies-and-di.md](spring-proxies-and-di.md).
2. **A `void` `@Async` method swallows exceptions.** Nothing is watching the returned nothing. Either return `CompletableFuture<T>`, or register an `AsyncUncaughtExceptionHandler`, or the failure is invisible.
3. **Return `CompletableFuture<T>`**, not the raw value, when the caller needs the result.

```java
@Bean
AsyncUncaughtExceptionHandler asyncExceptionHandler() {
    return (throwable, method, params) ->
            log.error("Async {} failed with {}", method.getName(), Arrays.toString(params), throwable);
}
```

### Nothing propagates automatically

The security context, the request scope and MDC logging context are all thread-bound and **absent** on the async thread:

- `SecurityContextHolder.getContext()` is empty - an `@Async` method cannot see who the caller was. Pass the identity as a parameter, or set `SecurityContextHolder.setStrategyName(MODE_INHERITABLETHREADLOCAL)` knowing that it does not work with a pooled executor.
- `@RequestScope` beans and `RequestContextHolder` throw or return nothing.
- MDC values - a correlation id - are lost, so async log lines are unattributable. Micrometer's context propagation handles the tracing context; MDC needs a task decorator.

### The executor

Boot auto-configures one `applicationTaskExecutor`. With virtual threads enabled it uses them, and sizing stops mattering. Without them, the default is a `ThreadPoolTaskExecutor` with an **unbounded queue** - under sustained load, work accumulates in memory until the heap gives out rather than applying backpressure.

```java
@Bean(name = "reportExecutor")
Executor reportExecutor() {
    var executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(4);
    executor.setMaxPoolSize(8);
    executor.setQueueCapacity(100);                 // bounded - reject rather than exhaust the heap
    executor.setThreadNamePrefix("report-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(30);
    executor.initialize();
    return executor;
}
```

```java
@Async("reportExecutor")
public CompletableFuture<Report> generate(ReportRequest request) { … }
```

Name the threads. `pool-2-thread-7` in a stack trace tells you nothing.

## `@Scheduled`

```java
@Configuration
@EnableScheduling
class SchedulingConfig {
}
```

```java
@Component
class ReservationExpiryJob {

    @Scheduled(fixedDelayString = "${app.orders.expiry-scan-interval:PT1M}")
    void expireStaleReservations() {
        reservationService.expireOlderThan(Instant.now().minus(timeout));
    }

    @Scheduled(cron = "0 0 2 * * *", zone = "Europe/London")
    void nightlyReconciliation() {
        reconciliationService.run();
    }
}
```

| Attribute | Behaviour |
|---|---|
| `fixedDelay` | Wait N after the previous run **finished**. Runs never overlap |
| `fixedRate` | Start every N regardless of duration. Runs **can** overlap, or queue up if the job is slower than the interval |
| `cron` | Calendar schedule. Always set `zone` - the default is the server's, which differs between your laptop and production |

Prefer `fixedDelay`. `fixedRate` on a job that occasionally runs long gives you concurrent executions of a job that almost certainly is not safe to run twice.

Bind the interval to a property so it can be tuned or disabled without a rebuild. Spring's cron has **six** fields (seconds first), not the five of Unix cron - a five-field expression fails at startup.

### The single-threaded default

**The scheduler runs one thread.** Every `@Scheduled` method in the application shares it, so one slow job delays every other job - silently, and it looks like the others "sometimes don't run".

```yaml
spring:
  task:
    scheduling:
      pool:
        size: 4
```

### Multiple instances run everything multiple times

Deploy three replicas and a nightly job runs three times. This is the most common production surprise in this file, and neither `@Scheduled` nor Boot does anything about it.

Options, cheapest first:

- **Make the job idempotent** so concurrent runs are harmless. Best when achievable.
- **Claim work atomically.** `UPDATE … SET claimed_by = ? WHERE status = 'PENDING' AND claimed_by IS NULL` with `LIMIT` - each instance processes only what it claimed. No extra infrastructure.
- **A distributed lock** - a `SELECT … FOR UPDATE SKIP LOCKED` row, or a lock library. An added dependency for the library route.
- **Run the schedule outside the application** - a Kubernetes `CronJob` hitting an endpoint, or a scheduler service. Best for genuinely once-only jobs.

Whatever you choose, make it explicit. A schedule that is correct only because the deployment happens to be a single replica breaks the day it scales.

### Scheduled methods and transactions

`@Scheduled` and `@Transactional` on the same method works - the schedule triggers through the proxy, so both apply. But a scheduled method should be short: a long transaction holds a connection and locks for its whole duration ([transactions.md](transactions.md)). Have the scheduled method fetch a bounded batch and delegate each item to a transactional bean.

Like everything proxy-based, `@Scheduled` needs a `public`, non-final method on a Spring bean, and it takes no arguments.

## Graceful shutdown

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

In-flight requests finish rather than being killed mid-write. Set `waitForTasksToCompleteOnShutdown` on custom executors too, or queued async work is discarded on deploy. The timeout should be shorter than your orchestrator's termination grace period, or it kills the pod anyway.

## Testing

Do not `Thread.sleep`. Use Awaitility:

```java
@Test
void sendsConfirmationAsynchronously() {
    orderService.place(cmd);

    await().atMost(Duration.ofSeconds(5))
            .untilAsserted(() -> verify(emailClient).send(any()));
}
```

Disable scheduling in tests so jobs do not fire unpredictably - `spring.task.scheduling.enabled=false` in `application-test.yml`, and test the method directly by calling it. On Boot 4, context pausing freezes `@Scheduled` tasks in cached contexts between tests ([testing-strategy.md](testing-strategy.md)).

## If on Boot 3.5.x

`@Async`, `@Scheduled`, the executor and scheduler properties, and graceful shutdown are all identical. `spring.threads.virtual.enabled` exists from Boot 3.2 on Java 21+, so virtual threads are available there too - the JDK version matters more than the Boot version for pinning behaviour.

## Gotchas

- Agent calls an `@Async` method on `this` - it runs synchronously; no warning
- Agent writes `void` `@Async` methods with no exception handler - failures vanish silently
- Agent forgets `@EnableAsync` or `@EnableScheduling` - the annotations are inert
- Agent expects `SecurityContextHolder` to work on an async thread - it is empty; pass the identity
- Agent expects MDC or a correlation id to propagate - it does not without a task decorator
- Agent relies on the default executor under load - its queue is unbounded; bound it and set a rejection policy
- Agent leaves the scheduler at one thread - one slow job silently delays every other
- Agent uses `fixedRate` for a job that can run long - executions overlap
- Agent writes a five-field cron - Spring's cron has six fields, seconds first
- Agent omits `zone` on a cron - the server's timezone differs between environments
- Agent deploys a `@Scheduled` job to multiple replicas - it runs once per instance
- Agent puts a long transaction in a scheduled method - fetch a batch, delegate per item
- Agent adds arguments to a `@Scheduled` method - it must take none
- Agent uses reactive purely for concurrency on Java 21+ - virtual threads remove that reason
- Agent enables virtual threads and leaves the connection pool at its default - the pool is now the bottleneck
- Agent uses `synchronized` on a hot path with virtual threads - it can pin the carrier thread; prefer `ReentrantLock`
- Agent uses `Thread.sleep` in an async test - use Awaitility
- Agent leaves scheduling enabled in tests - jobs fire mid-test and make failures irreproducible

## Related

- [spring-proxies-and-di.md](spring-proxies-and-di.md) · [transactions.md](transactions.md) · [resilience.md](resilience.md) · [observability.md](observability.md) · [spring-batch.md](spring-batch.md) · [configuration.md](configuration.md)
