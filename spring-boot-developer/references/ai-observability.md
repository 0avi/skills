# AI Observability

An LLM call is slow, paid per token, and non-deterministic. Without instrumentation you cannot answer "why is this slow?", "why did the bill triple?" or "what did we actually send?" - and all three questions arrive eventually.

This layers on [observability.md](observability.md); everything there applies.

## Built-in instrumentation

Spring AI ships Micrometer instrumentation - you get metrics without writing any:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

| Metric | What it gives you |
|---|---|
| `gen_ai.client.operation` | Call latency, tagged by provider and model |
| `gen_ai.client.token.usage` | Input and output token counts |
| `spring.ai.chat.client` | `ChatClient`-level timer and span |

These follow the OpenTelemetry GenAI semantic conventions, so they line up with whatever else you run.

Latency here is **not** your endpoint's latency - a model call is often the dominant term. Chart them together or you will misattribute a slow endpoint.

## Never log prompts in production

```yaml
spring:
  ai:
    chat:
      client:
        observations:
          log-prompt: false
          log-completion: false
      observations:
        log-prompt: false
        log-completion: false
        include-error-logging: true
```

Prompts contain whatever your users typed and whatever context you attached - personal data, order details, internal documents. Logging them copies all of it into a log store that is rarely as well protected as your database, and often ships to a third-party aggregator.

Enable prompt logging in development, deliberately, and never by leaving a dev profile's setting in place. `include-error-logging` is safe and worth keeping on.

## Token usage and cost

Token counts are the units your invoice is denominated in. Record them per operation so cost is attributable before the invoice arrives:

```java
@Component
public class AiUsageMetrics {

    private final MeterRegistry registry;

    AiUsageMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    public void record(String operation, String model, Usage usage) {
        Counter.builder("ai.tokens")
                .tag("operation", operation)      // bounded: a fixed set of features
                .tag("model", model)              // bounded: a handful of models
                .tag("direction", "input")
                .register(registry)
                .increment(usage.getPromptTokens());

        Counter.builder("ai.tokens")
                .tag("operation", operation)
                .tag("model", model)
                .tag("direction", "output")
                .register(registry)
                .increment(usage.getCompletionTokens());
    }
}
```

The cardinality rule from [observability.md](observability.md) is sharper here: **never tag a metric with a conversation id, user id or prompt content.** `operation` and `model` are bounded; anything per-request is not.

`Usage` exposes `getPromptTokens()` and `getCompletionTokens()`. `getGenerationTokens()` was the pre-GA name and no longer exists.

### Cost estimation

Prices change. Keep them in configuration, never compiled in:

```yaml
app:
  ai:
    pricing:
      # USD per million tokens - verify against current provider pricing
      claude-opus-5:   { input: 5.00, output: 25.00 }
      claude-sonnet-5: { input: 3.00, output: 15.00 }
      claude-haiku-4-5: { input: 1.00, output: 5.00 }
```

```java
@Validated
@ConfigurationProperties("app.ai.pricing")
public record AiPricingProperties(Map<String, ModelPrice> models) {
    public record ModelPrice(@NotNull BigDecimal input, @NotNull BigDecimal output) {}
}
```

```java
public BigDecimal estimate(String model, Usage usage) {
    var price = pricing.models().get(model);
    if (price == null) {
        log.warn("No pricing configured for model {}; cost not estimated", model);
        return BigDecimal.ZERO;
    }
    return price.input().multiply(BigDecimal.valueOf(usage.getPromptTokens()))
            .add(price.output().multiply(BigDecimal.valueOf(usage.getCompletionTokens())))
            .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP);
}
```

`BigDecimal`, not `double` - the same rule as any other money in the system ([domain-modelling.md](domain-modelling.md)). Treat the figure as an estimate for alerting and attribution; the provider's invoice is authoritative.

## Custom advisor

For per-call auditing beyond the built-in metrics:

```java
@Component
public class AiAuditAdvisor implements CallAdvisor {

    private static final Logger log = LoggerFactory.getLogger(AiAuditAdvisor.class);

    private final AiUsageMetrics metrics;

    AiAuditAdvisor(AiUsageMetrics metrics) {
        this.metrics = metrics;
    }

    @Override
    public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
        var started = System.nanoTime();
        try {
            var response = chain.nextCall(request);
            var chatResponse = response.chatResponse();

            if (chatResponse != null && chatResponse.getMetadata() != null) {
                var usage = chatResponse.getMetadata().getUsage();
                metrics.record("chat", chatResponse.getMetadata().getModel(), usage);
                log.info("AI call completed in {}ms, inputTokens={}, outputTokens={}",
                        Duration.ofNanos(System.nanoTime() - started).toMillis(),
                        usage.getPromptTokens(), usage.getCompletionTokens());
            }
            return response;
        } catch (Exception e) {
            log.error("AI call failed after {}ms",
                    Duration.ofNanos(System.nanoTime() - started).toMillis(), e);
            throw e;
        }
    }

    @Override
    public String getName() {
        return "aiAudit";
    }

    @Override
    public int getOrder() {
        return Ordered.LOWEST_PRECEDENCE;
    }
}
```

The GA advisor API is `CallAdvisor` with `ChatClientRequest`/`ChatClientResponse`. The pre-GA `CallAroundAdvisor`/`AdvisedRequest`/`AdvisedResponse` do not compile - agents generate them reliably, because most published examples predate the rename.

Log token counts and timings, **not** prompt or completion text.

## Persisting an audit trail

Where you need a durable record - a regulated domain, a cost chargeback model, a dispute about what the system produced:

```java
@Entity
@Table(name = "ai_call_audit")
class AiCallAudit extends BaseEntity {

    @EmbeddedId
    private AiCallAuditId id;

    @Column(name = "operation", nullable = false, length = 64)
    private String operation;

    @Column(name = "model", nullable = false, length = 64)
    private String model;

    @Column(name = "input_tokens", nullable = false)
    private int inputTokens;

    @Column(name = "output_tokens", nullable = false)
    private int outputTokens;

    @Column(name = "estimated_cost_usd", nullable = false, precision = 12, scale = 6)
    private BigDecimal estimatedCostUsd;

    @Column(name = "latency_ms", nullable = false)
    private long latencyMs;

    @Column(name = "succeeded", nullable = false)
    private boolean succeeded;
}
```

Store **metadata, not content**. If the prompt genuinely must be retained, that is a data-protection decision with a retention policy attached, not an incidental logging choice.

Write it asynchronously so auditing does not add latency to the call - and remember `@Async` needs to be on a separate bean or the proxy is bypassed and it runs inline ([async-and-scheduling.md](async-and-scheduling.md)).

## Tracing

Trace context propagates through Spring AI calls, so a model call appears as a span inside the request that triggered it - which is how you see that a three-second endpoint spent 2.8 seconds waiting on the provider.

```yaml
management:
  tracing:
    sampling:
      probability: 0.1
```

Consider sampling AI calls at a higher rate than general traffic: they are comparatively rare, individually expensive, and the ones you most want a trace for.

## What to alert on

| Signal | Why |
|---|---|
| Spend per hour against a budget | The failure mode is financial, and it arrives fast |
| Error rate by exception type | Separates rate limiting from auth failure from bad requests |
| p95 latency | Provider slowdowns show up here before anywhere else |
| Rate-limit (429) rate | Tells you to back off or raise the quota before users notice |
| Token usage per operation, trending | A prompt change that doubles context is otherwise invisible until the invoice |

A runaway loop calling a model can spend a lot of money quickly. A spend alert is not a nice-to-have.

## If on Boot 3.5.x

Actuator, Micrometer, the GenAI metric conventions and tracing work the same. The advisor API differs: Spring AI 1.x has its own advisor interfaces, and the `CallAroundAdvisor` → `CallAdvisor` rename happened at 1.0 GA - so pre-GA 1.x code and post-GA 1.x code differ from each other as well as from 2.0. Check the reference for your exact Spring AI version.

## Gotchas

- Agent enables `log-prompt` in production - prompts carry user data and internal context into the log store
- Agent implements `CallAroundAdvisor` / `AdvisedRequest` - pre-GA API; use `CallAdvisor` / `ChatClientRequest`
- Agent calls `usage.getGenerationTokens()` - it is `getCompletionTokens()`
- Agent tags a metric with a conversation id, user id or prompt text - unbounded cardinality
- Agent hardcodes token pricing - put it in configuration; prices change
- Agent uses `double` for cost - `BigDecimal`
- Agent stores full prompts in an audit table without a retention decision
- Agent writes the audit record synchronously - adds latency to every call
- Agent puts `@Async` on a method called from within the same bean - the proxy is bypassed and it runs inline
- Agent tracks only latency - the cost signal is the one that surprises people
- Agent sets no spend alert - a runaway loop is expensive before anyone notices
- Agent charts AI latency separately from endpoint latency - the model call is usually the dominant term

## Related

- [spring-ai.md](spring-ai.md) · [observability.md](observability.md) · [configuration.md](configuration.md) · [async-and-scheduling.md](async-and-scheduling.md) · [caching.md](caching.md)
