# Observability

## Actuator

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

Only `/actuator/health` is exposed over HTTP by default. **Expose the rest deliberately** - never `include: "*"`:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      probes:
        enabled: true
      show-details: when-authorized
      show-components: when-authorized
  server:
    port: 9090                    # separate port, not routed by the public ingress
```

`include: "*"` publishes `/actuator/env` (every configuration value, including secrets), `/actuator/configprops`, `/actuator/heapdump` (a downloadable copy of your process memory, containing credentials and personal data) and `/actuator/threaddump`. Treat that as a data breach waiting for a scanner to find it.

Two defences, use both:

- **A separate management port** that the public ingress does not route to.
- **A dedicated security chain** - see [security-fundamentals.md](security-fundamentals.md):

```java
@Bean
@Order(1)
SecurityFilterChain actuatorChain(HttpSecurity http) throws Exception {
    return http
            .securityMatcher("/actuator/**")
            .authorizeHttpRequests(auth -> auth
                    .requestMatchers("/actuator/health/**").permitAll()   // probes must be anonymous
                    .anyRequest().hasRole("OPS"))
            .httpBasic(Customizer.withDefaults())
            .build();
}
```

`show-details: when-authorized` matters: health details name your database host, broker and downstream URLs.

## Health, liveness and readiness

The two probes answer different questions, and conflating them causes restart loops.

| Probe | Question | Failure means |
|---|---|---|
| `/actuator/health/liveness` | Is the process broken beyond recovery? | **Kill and restart me** |
| `/actuator/health/readiness` | Can I serve traffic right now? | **Stop sending me traffic** - do not restart |

A database outage is a **readiness** failure. If it also fails liveness, the orchestrator restarts every replica during the outage, and a cold start plus reconnection storm makes the outage worse.

```yaml
management:
  endpoint:
    health:
      group:
        readiness:
          include: readinessState,db,redis
        liveness:
          include: livenessState
```

Liveness should depend on almost nothing. Readiness includes the dependencies you genuinely cannot serve without - and *only* those. Putting an optional downstream in readiness takes you out of rotation for something you could have degraded past.

### Custom indicators

```java
@Component
class InventoryServiceHealthIndicator implements HealthIndicator {

    private final InventoryClient client;

    @Override
    public Health health() {
        try {
            client.ping();
            return Health.up().build();
        } catch (Exception e) {
            return Health.down().withDetail("reason", e.getClass().getSimpleName()).build();
        }
    }
}
```

Health checks must be **fast and cheap** - they run every few seconds per replica. Never run a real query, and never call a downstream's full health endpoint, which cascades into a distributed health storm. Cache the result if the check is not trivial.

Only report `DOWN` for something that genuinely makes you unable to serve.

## Metrics

Micrometer is already there. Boot instruments HTTP requests, the connection pool, JVM memory, GC and thread counts with no code.

```yaml
management:
  metrics:
    tags:
      application: ${spring.application.name}
  prometheus:
    metrics:
      export:
        enabled: true
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
```

Custom metrics where the business question is not answerable from HTTP metrics:

```java
@Component
public class OrderMetrics {

    private final Counter placed;
    private final Timer fulfilment;

    OrderMetrics(MeterRegistry registry) {
        this.placed = Counter.builder("orders.placed")
                .description("Orders successfully placed")
                .register(registry);
        this.fulfilment = Timer.builder("orders.fulfilment")
                .publishPercentileHistogram()
                .register(registry);
    }

    public void recordPlaced() {
        placed.increment();
    }
}
```

Register meters **once**, in the constructor. Calling `Counter.builder(…).register(registry)` on every request performs a registry lookup each time and is a measurable hot-path cost.

### Cardinality

**A tag whose value set is unbounded will take down your metrics backend.** Each distinct combination of tag values is a separate time series.

| Safe tag | Never a tag |
|---|---|
| `status` (a handful of values) | User id |
| `endpoint` (a fixed route template) | Order id, or any entity id |
| `region`, `tenant` (bounded and known) | Raw URI with path parameters expanded |
| `outcome` = success / failure | Email address, IP address |
| | An exception **message** |

The URI tag is templated (`/api/orders/{id}`) precisely for this reason. Anything with per-entity granularity belongs in a log or a trace, not a metric.

### What to alert on

Alert on symptoms users feel, not on causes:

- Error rate and latency percentiles per endpoint (p95, p99 - never the mean, which hides everything)
- Saturation: connection pool usage, queue depth, `@ConcurrencyLimit` rejections
- Dead-letter topic depth ([messaging.md](messaging.md))
- Business signals - orders placed per minute dropping to zero is often the fastest detector of a broken deploy

## Tracing

```xml
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-otel</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-exporter-otlp</artifactId>
</dependency>
```

```yaml
management:
  tracing:
    sampling:
      probability: 0.1        # 10% in production; 1.0 in development
  otlp:
    tracing:
      endpoint: ${OTEL_ENDPOINT}
```

Trace context propagates automatically across `RestClient`, `WebClient`, HTTP interface clients and Kafka. It does **not** cross `@Async` or `@Scheduled` boundaries without context propagation configured - see [async-and-scheduling.md](async-and-scheduling.md).

Sample at 1.0 in development and low in production. 100% sampling at production volume is expensive and mostly redundant.

Put the trace id in your logs so a log line leads to a trace:

```yaml
logging:
  pattern:
    level: "%5p [${spring.application.name},%X{traceId:-},%X{spanId:-}]"
```

## Structured logging

Boot emits JSON logs natively - no encoder configuration, no extra dependency:

```yaml
logging:
  structured:
    format:
      console: ecs        # or logstash, or gelf
```

Use it wherever logs are shipped to a searchable store. A JSON line with `traceId`, `spanId` and MDC fields as first-class keys is queryable; a formatted string is not.

Log rules that matter more than the format:

- **Log the exception object, not `ex.getMessage()`** - otherwise the stack trace is gone.
- **Never log secrets, tokens, passwords or personal data.** Redact at the source; a log store is rarely as well protected as a database.
- **`ERROR` means a human should look.** A 404 logged at `ERROR` trains everyone to ignore the level. See [error-handling.md](error-handling.md).
- Use placeholders - `log.info("Placed order {}", orderId)` - not concatenation, so the message is not built when the level is disabled.

## The info endpoint

```yaml
management:
  info:
    build:
      enabled: true
    git:
      mode: full
    env:
      enabled: false        # off - it can expose configuration
```

With build and git info generated at build time ([maven.md](maven.md)), `/actuator/info` tells you exactly which commit is running. That single fact resolves a surprising share of "is the fix deployed?" questions.

## Observation API

For a custom span plus timer plus (optionally) a log from one call:

```java
Observation.createNotStarted("order.fulfilment", observationRegistry)
        .lowCardinalityKeyValue("channel", channel)      // becomes a metric tag - must be bounded
        .highCardinalityKeyValue("orderId", id.toString()) // trace attribute only
        .observe(() -> fulfilmentService.fulfil(id));
```

The low/high cardinality split is the API enforcing the tag rule above: low-cardinality keys become metric tags, high-cardinality ones stay on the span.

## If on Boot 3.5.x

Actuator, health groups, probes, Micrometer, tracing and the Observation API are the same. Structured logging is Boot 3.4+, so it is available on 3.5.x too. Boot 4 updated its OpenTelemetry support, and Spring Batch 6 dropped Micrometer's global static registry - a Batch application on Boot 4 needs an `ObservationRegistry` bean wired to the `MeterRegistry` ([spring-batch.md](spring-batch.md)).

## Gotchas

- Agent sets `management.endpoints.web.exposure.include: "*"` - publishes `/env`, `/configprops` and `/heapdump`; a heap dump contains every secret in memory
- Agent leaves actuator on the main port with no security - put it on a separate port and behind a chain
- Agent sets `show-details: always` - health details name your database host and downstream URLs
- Agent puts the database in the **liveness** probe - an outage then restarts every replica and makes it worse
- Agent puts an optional dependency in readiness - you leave rotation for something you could degrade past
- Agent writes a health indicator that runs a real query - probes run every few seconds per replica
- Agent tags a metric with a user id, order id or exception message - unbounded cardinality kills the metrics backend
- Agent registers a meter inside the request path - build it once in the constructor
- Agent alerts on mean latency - the mean hides the tail; use p95/p99
- Agent samples traces at 1.0 in production - expensive and mostly redundant
- Agent expects trace context across `@Async` - it needs context propagation configured
- Agent logs `ex.getMessage()` - the stack trace is lost
- Agent logs tokens, passwords or personal data - redact at the source
- Agent hand-rolls a JSON log encoder - Boot has structured logging built in
- Agent enables `management.info.env` - it can expose configuration values

## Related

- [security-fundamentals.md](security-fundamentals.md) · [error-handling.md](error-handling.md) · [async-and-scheduling.md](async-and-scheduling.md) · [messaging.md](messaging.md) · [configuration.md](configuration.md) · [containerization-and-native.md](containerization-and-native.md)
