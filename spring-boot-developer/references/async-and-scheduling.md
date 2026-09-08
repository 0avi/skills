# Async and Scheduling

## Virtual threads first

On Java 21+, turn them on:

```yaml
spring:
  threads:
    virtual:
      enabled: true
```

**It is off by default** - on every Boot version that supports it. Setting it swaps the thread-pool `ExecutorService` behind Tomcat and `applicationTaskExecutor` for a **virtual-thread-per-task** executor. Every request is then handled on a virtual thread. A blocking call - JDBC, an HTTP client, a message send - parks the virtual thread and releases the underlying platform thread, so throughput stops being bounded by a fixed pool of 200 Tomcat threads.

What this changes:

- **Reactive is no longer the answer to "handle more concurrent requests".** That was the main reason most teams adopted WebFlux, and it is gone. Blocking code on virtual threads is simpler and now scales comparably.
- **Connection pool sizing becomes the real limit.** Virtual threads are effectively unlimited; your database connections are not. Ten thousand concurrent requests against a pool of ten means 9,990 threads waiting on the pool. Size and monitor the pool, not the thread pool.
- **Thread pools stop being a useful bulkhead.** A bounded pool used to cap concurrent work against a dependency. Use `@ConcurrencyLimit` for that now - see [resilience.md](resilience.md).

What it does **not** change: **a single slow request.** Virtual threads make *concurrent* requests cheap and do nothing for three REST calls made one after another inside one handler. That is a separate problem with a separate answer - see below.

Three caveats:

- **`synchronized` around a blocking call pins** the carrier thread **before JDK 24** - a virtual thread blocked inside `synchronized` cannot unmount, so concurrency caps at the carrier count rather than at your connection pool. Measured at 13.1 s versus 1.0 s for the same work on JDK 21 and 25; java-developer's `structured-concurrency.md` has the numbers. Prefer `ReentrantLock` on a hot path, and note that this is gated by **the JDK you run**, not the one you compile with or the Boot version.
- **`ThreadLocal` still works but is per-task**, and virtual threads are created per request rather than pooled, so a `ThreadLocal` cache that used to be reused across requests is now allocated per request.
- **Thread names stop being useful.** Virtual threads are unnamed by default, so log patterns, metrics or dumps keyed on a thread name lose their handle. Correlate on a trace or request id instead ([observability.md](observability.md)).

## Structured concurrency - fan-out inside one request

The endpoint that calls three services in sequence is 1.5 s of wall clock that should be 500 ms, and enabling virtual threads does not touch it. `StructuredTaskScope` runs each call on its own virtual thread and joins them, and unlike WebFlux it needs no change to the things being called - `RestClient`, JDBC and the service methods stay exactly as they are.

**Status, and the verdict for a Boot service.** `StructuredTaskScope` is a **preview API on Java 25**. Using it in a Boot application means `--enable-preview` on the compiler *and* on the launcher, in the Dockerfile, and in every test task - and preview class files are rejected by a JDK of a different feature release, so an upgrade forces a rebuild. **Do not turn preview on across a production service for this.** Reach for it when a single endpoint's fan-out latency is a measured problem, keep it behind a service boundary, and expect the API to change again before it is final. `ScopedValue` (Java 25, final, no flag) has no such caveat.

The scope belongs in a service, never in a controller - a controller that opens a scope is doing orchestration, and the joiner is where that logic goes:

```java
@Service
public class SpeakerProfileService {

    private final ProfileSourceClient client;

    SpeakerProfileService(ProfileSourceClient client) {
        this.client = client;
    }

    public Profile bestProfile(SpeakerId id) throws InterruptedException {
        try (var scope = StructuredTaskScope.open(new BestProfileJoiner(),
                cfg -> cfg.withName("profile").withTimeout(Duration.ofSeconds(2)))) {
            scope.fork(() -> client.fromDirectory(id));
            scope.fork(() -> client.fromCrm(id));
            scope.fork(() -> client.fromLegacy(id));
            return scope.join();
        }
    }
}
```

Three things Boot-specific enough to get wrong:

**1. Your exception does not arrive intact.** A `Joiner.result()` that throws a domain exception is wrapped: `join()` throws `StructuredTaskScope.FailedException` with yours as the cause. A `@RestControllerAdvice` handler written for the domain exception never fires, and the client gets a 500 instead of the `ProblemDetail` you designed. Unwrap at the service boundary rather than teaching the advice about `FailedException` ([error-handling.md](error-handling.md)):

```java
try {
    return scope.join();
} catch (StructuredTaskScope.FailedException e) {
    throw switch (e.getCause()) {
        case ProfileNotFoundException notFound -> notFound;
        case RuntimeException other -> other;
        case Throwable other -> new IllegalStateException(other);
    };
}
```

**2. Never fork a repository call inside `@Transactional`.** Spring binds the transaction - the `Connection`, the `EntityManager`, the synchronizations - to the current thread through `TransactionSynchronizationManager`, which is a `ThreadLocal`. A forked subtask is a different thread, so it sees no transaction, takes its own connection from the pool, and commits independently of the one you are in. Fan out **before** the transaction opens, or fan out over calls that are not database work.

**3. `scope.join()` is mandatory and enforced.** Leaving the try-with-resources without it throws `IllegalStateException: Owner did not join after forking` - which an early `return` between the last `fork` and the `join` will find in production rather than in a test.

The payoff is that the aggregation logic lives in the `Joiner`, which is a plain class: construct it, call `onComplete` with subtasks you made yourself, assert on `result()`. No `@SpringBootTest`, no `MockMvc` ([testing-unit.md](testing-unit.md)).

### Nothing thread-bound survives a `fork()` either

The same table as `@Async` below, for the same reason - a fork is a new thread:

| | Inside `scope.fork(...)` |
| --- | --- |
| `SecurityContextHolder.getContext()` | Empty on the default `ThreadLocal` strategy. `MODE_INHERITABLETHREADLOCAL` does cross a fork, but it is a global switch with its own costs - do not flip it to paper over one scope |
| `RequestContextHolder`, `@RequestScope` beans | Absent - throws or returns nothing |
| MDC correlation id | Lost, so subtask log lines are unattributable |
| `TransactionSynchronizationManager` | Empty - see above |

Pass what the subtask needs as a parameter. Where that is impractical across a deep call chain, bind a `ScopedValue` in a filter - it is the one mechanism that reads through a fork, and it is final on Java 25. `-Djdk.traceVirtualThreadLocals=true` prints a stack trace at every `ThreadLocal` access from a virtual thread and will list the migration for you. java-developer's `structured-concurrency.md` covers the API.

Do not assume the framework has done this for you. Verify against the Spring version in the build before relying on any context crossing a fork you opened yourself.

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

- `SecurityContextHolder.getContext()` is empty - an `@Async` method cannot see who the caller was. Pass the identity as a parameter, or set `SecurityContextHolder.setStrategyName(MODE_INHERITABLETHREADLOCAL)` knowing that it does not work with a pooled executor. That last caveat lifts once virtual threads are on and the executor creates a thread per task - an `InheritableThreadLocal` is inherited at thread creation, so it propagates again. Do not build on that quietly: it is a behaviour change that follows from one property, and it reverts the moment someone routes the method to a named pooled executor.
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

`@Async`, `@Scheduled`, the executor and scheduler properties, and graceful shutdown are all identical. `spring.threads.virtual.enabled` exists from Boot 3.2 on Java 21+, so virtual threads are available there too - the JDK version matters more than the Boot version for pinning behaviour, and for whether `StructuredTaskScope` and `ScopedValue` exist at all. Structured concurrency is a Java 25 question, not a Boot 4 one: a Boot 3.5.x service on Java 25 can use it, and a Boot 4 service on Java 21 cannot.

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
- Agent assumes virtual threads are on - `spring.threads.virtual.enabled` is off by default on every Boot version
- Agent uses `synchronized` on a hot path with virtual threads - it pins the carrier before JDK 24; prefer `ReentrantLock`, and check the JDK that runs rather than the one that compiles
- Agent enables virtual threads and calls a slow sequential fan-out fixed - they change nothing inside a single request
- Agent opens a `StructuredTaskScope` without adding `--enable-preview` to the compiler, the launcher and the container - it is still a preview API on Java 25
- Agent turns preview on for a whole production service to use one scope - keep it to a measured hot endpoint, or do not use it
- Agent opens a scope in a controller - it belongs in a service, with the aggregation in a `Joiner`
- Agent forks a repository call inside `@Transactional` - the transaction is thread-bound, so the subtask runs on its own connection and commits separately
- Agent writes a `@RestControllerAdvice` handler for a domain exception thrown from `Joiner.result()` - it arrives wrapped in `FailedException`; unwrap at the service boundary
- Agent expects `SecurityContextHolder` or MDC to be readable inside `scope.fork(...)` - both are thread-bound and empty there
- Agent returns early between a `fork` and the `join` - closing the scope then throws `IllegalStateException: Owner did not join after forking`
- Agent uses `Thread.sleep` in an async test - use Awaitility
- Agent leaves scheduling enabled in tests - jobs fire mid-test and make failures irreproducible

## Related

- [spring-proxies-and-di.md](spring-proxies-and-di.md) · [transactions.md](transactions.md) · [error-handling.md](error-handling.md) · [resilience.md](resilience.md) · [observability.md](observability.md) · [spring-batch.md](spring-batch.md) · [configuration.md](configuration.md)
- java-developer's `structured-concurrency.md` owns the language-level API - `StructuredTaskScope`, `Joiner`, `ScopedValue`, and the measured pinning numbers.
