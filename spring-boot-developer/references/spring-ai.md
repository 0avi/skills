# Spring AI

Boot 4 requires **Spring AI 2.0**; the 1.x line targets Boot 3 only. Mixing them produces an unresolvable dependency graph - see the pairing table in [boot-versions.md](boot-versions.md).

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-bom</artifactId>
            <version><!-- current 2.0.x --></version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-model-anthropic</artifactId>
    </dependency>
</dependencies>
```

Starter coordinates follow `spring-ai-starter-model-<provider>` and `spring-ai-starter-vector-store-<store>`. The pre-1.0 pattern `spring-ai-<x>-spring-boot-starter` resolves to nothing in Maven Central - an agent trained on older material will emit it.

## Configuration

```yaml
spring:
  ai:
    anthropic:
      api-key: ${ANTHROPIC_API_KEY}
      chat:
        model: claude-opus-5
        max-tokens: 4096
```

**Model IDs carry no date suffix.** `claude-opus-5`, not `claude-opus-5-20260101`. An appended date is a 404, and it is one of the most common generated mistakes.

| Model | ID | Use for |
|---|---|---|
| Claude Opus 5 | `claude-opus-5` | Default. Complex reasoning, agentic work, coding |
| Claude Sonnet 5 | `claude-sonnet-5` | High-volume production work where cost matters |
| Claude Haiku 4.5 | `claude-haiku-4-5` | Simple, latency-critical tasks - classification, routing |

Verify the current list against the provider's documentation rather than trusting a hardcoded table; models are added and retired on their own schedule.

Spring AI 2.0 **flattened the chat properties** - the old `chat.options.*` nesting is gone, so `spring.ai.anthropic.chat.model`, not `spring.ai.anthropic.chat.options.model`.

The API key comes from the environment ([configuration.md](configuration.md)), never from `application.yml`.

## ChatClient

```java
@Configuration
class AiConfig {

    @Bean
    ChatClient chatClient(ChatClient.Builder builder, ChatMemory chatMemory) {
        return builder
                .defaultSystem("You are a support assistant for an order management system.")
                .defaultAdvisors(MessageChatMemoryAdvisor.builder(chatMemory).build())
                .build();
    }

    @Bean
    ChatMemory chatMemory() {
        return MessageWindowChatMemory.builder().maxMessages(20).build();
    }
}
```

`InMemoryChatMemory` no longer exists. `MessageWindowChatMemory` caps history to a sliding window - without a cap, a long conversation grows the prompt until it exceeds the context window and every request gets more expensive.

Advisors are constructed with builders in 2.0: `MessageChatMemoryAdvisor.builder(chatMemory).build()`, not `new MessageChatMemoryAdvisor(...)`. `PromptChatMemoryAdvisor` was removed.

## The conversation id is mandatory

```java
@Service
public class SupportAssistant {

    private final ChatClient chatClient;

    SupportAssistant(ChatClient chatClient) {
        this.chatClient = chatClient;
    }

    public String reply(ConversationId conversationId, String message) {
        return chatClient.prompt()
                .advisors(a -> a.param(ChatMemory.CONVERSATION_ID, conversationId.value()))
                .user(message)
                .call()
                .content();
    }
}
```

Spring AI 2.0 removed `ChatMemory.DEFAULT_CONVERSATION_ID`; a memory-advisor call without a conversation id throws `IllegalArgumentException`.

That removal is a safety feature. A shared default id meant **every user's conversation history landed in the same window** - one customer's messages visible to the next. Scope the id to the user or session and never share it.

## Prompt templates

Keep prompts out of Java. They change on a different cadence from code, and inline strings invite concatenation:

```
Analyse the following order and identify anomalies.

Customer: {customer}
Placed: {placedAt}
Total: {total}
Lines:
{lines}

Report only anomalies. If there are none, reply exactly: NONE.
```

```java
@Value("classpath:prompts/analyse-order.st")
private Resource analyseOrderPrompt;

public String analyse(ConversationId conversationId, OrderSummary order) {
    return chatClient.prompt()
            .advisors(a -> a.param(ChatMemory.CONVERSATION_ID, conversationId.value()))
            .user(u -> u.text(analyseOrderPrompt)
                    .param("customer", order.customerReference())
                    .param("placedAt", order.placedAt())
                    .param("total", order.total())
                    .param("lines", order.formattedLines()))
            .call()
            .content();
}
```

**Never build a prompt with string concatenation.** Beyond being unreadable, interpolating user-controlled text directly into instructions is prompt injection - the same class of mistake as SQL injection, and java-developer's text-block warning applies for the same reason. Use `.param()`, keep untrusted content clearly delimited, and never let it sit where instructions are expected.

## Structured output

```java
public record OrderAnomalies(List<Anomaly> anomalies, RiskLevel risk) {
    public record Anomaly(String code, String description) {}
}

public OrderAnomalies analyse(OrderSummary order) {
    return chatClient.prompt()
            .user(u -> u.text(analyseOrderPrompt).param("order", order.formatted()))
            .call()
            .entity(OrderAnomalies.class);
}
```

Records map cleanly. For a generic type, erasure means you must supply the type reference:

```java
.entity(new ParameterizedTypeReference<List<Anomaly>>() {})
```

`.entity(List.class)` compiles and then fails at runtime.

Structured output is a request for a shape, not a guarantee - validate what comes back before acting on it. See [validation.md](validation.md).

## RAG

```java
@Bean
ChatClient ragChatClient(ChatClient.Builder builder, VectorStore vectorStore) {
    return builder
            .defaultAdvisors(QuestionAnswerAdvisor.builder(vectorStore)
                    .searchRequest(SearchRequest.builder().topK(5).similarityThreshold(0.7).build())
                    .build())
            .build();
}
```

```xml
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-vector-store-pgvector</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-vector-store-advisor</artifactId>
</dependency>
```

`QuestionAnswerAdvisor` moved to `spring-ai-vector-store-advisor` in 2.0 (previously `spring-ai-advisors-vector-store`). The starter auto-configures the `VectorStore` - inject it; do not construct `new PgVectorStore(...)`, whose public constructor was removed.

`SearchRequest` uses a builder: `SearchRequest.builder().topK(5).build()`, not `SearchRequest.defaults().withTopK(5)`.

Set a `similarityThreshold`. Without one, `topK` returns the five least-bad matches even when nothing is relevant, and the model answers confidently from irrelevant context.

Ingestion belongs in a batch job or a scheduled task, not a request path - embedding a large document is slow and costs money per call. See [spring-batch.md](spring-batch.md).

## Streaming

```java
@GetMapping(value = "/assist", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
Flux<String> assist(@RequestParam String question) {
    return chatClient.prompt().user(question).stream().content();
}
```

This is the one place a `Flux` legitimately appears in an MVC application - server-sent events are a streaming response by nature. It does not make the application reactive.

## Failure handling

An LLM call is a slow, paid, unreliable network call to a third party. Treat it as such ([http-clients.md](http-clients.md), [resilience.md](resilience.md)):

| Exception | Retry? |
|---|---|
| `TransientAiException` (rate limit, overload, timeout) | Yes, with exponential backoff and jitter |
| `NonTransientAiException` (bad request, auth failure, content refused) | No - it fails identically every time |

Set a timeout. Decide what the feature does when the model is unavailable - degrade to a non-AI path, queue for later, or return a clear error. "The page hangs" is not a plan.

Never make the call inside a transaction ([transactions.md](transactions.md)).

## Cost and safety

- **Cap `max-tokens`.** It is the only hard ceiling on the cost of a single call.
- **Cache aggressively.** Identical prompts produce billable calls every time; a cache in front of a deterministic prompt is often the largest single saving available ([caching.md](caching.md)).
- **Never put secrets or personal data in a prompt** without a deliberate decision - the payload leaves your infrastructure.
- **Treat model output as untrusted.** Never execute it, never interpolate it into SQL or a shell command, never render it as raw HTML.
- **Log token usage per operation** so cost is visible before the invoice - see [ai-observability.md](ai-observability.md).

## Testing

Do not call a real model in tests. It is slow, costs money, and is non-deterministic, so assertions on exact wording will flake.

- Mock `ChatClient` (or the `ChatModel` beneath it) for service-level tests, and assert on how the result is *used*.
- Assert prompt construction - that the right template and parameters were passed - rather than the response text.
- Test the failure paths: transient error, non-transient error, timeout, malformed structured output.

Keep an end-to-end test against the real provider if you need one, tagged and excluded from the normal build.

## If on Boot 3.5.x

Use **Spring AI 1.x**. The `ChatClient` fluent API, prompt templates, structured output, RAG and streaming are broadly the same, but 2.0 made several breaking changes - flattened `chat.options.*` properties, the removal of `ChatMemory.DEFAULT_CONVERSATION_ID`, the `spring-ai-advisors-vector-store` rename, builder-only advisor construction, and the removal of `PromptChatMemoryAdvisor`. Check the Spring AI 1.x reference for the version you are on rather than assuming the 2.0 shapes above.

## Gotchas

- Agent uses Spring AI 1.x on Boot 4, or 2.0 on Boot 3.5 - the lines are not interchangeable
- Agent emits `spring-ai-anthropic-spring-boot-starter` - the pattern is `spring-ai-starter-model-anthropic`
- Agent appends a date suffix to a model id - current ids are bare (`claude-opus-5`)
- Agent configures `spring.ai.anthropic.chat.options.model` - 2.0 flattened it; drop `.options`
- Agent writes `new MessageChatMemoryAdvisor(new InMemoryChatMemory())` - both removed; use the builder plus `MessageWindowChatMemory`
- Agent omits the conversation id on a memory-advisor call - throws, and a shared default would leak one user's history to another
- Agent uses unbounded chat memory - the prompt grows until it exceeds the context window
- Agent uses `PromptChatMemoryAdvisor` - removed in 2.0
- Agent adds `spring-ai-advisors-vector-store` - renamed `spring-ai-vector-store-advisor`
- Agent constructs `new PgVectorStore(...)` - the starter auto-configures it
- Agent writes `SearchRequest.defaults().withTopK(n)` - use the builder
- Agent omits `similarityThreshold` - irrelevant context is retrieved and answered from confidently
- Agent uses `.entity(List.class)` - generics erase; pass a `ParameterizedTypeReference`
- Agent concatenates user input into a prompt - that is prompt injection; use `.param()`
- Agent hardcodes the API key - environment or secret manager
- Agent omits `max-tokens` - no ceiling on the cost of one call
- Agent retries a `NonTransientAiException` - it will fail identically
- Agent calls the model inside a transaction - holds a connection for a multi-second remote call
- Agent embeds documents in a request handler - do it in a batch or scheduled job
- Agent renders model output as raw HTML or passes it to a shell - treat it as untrusted input
- Agent writes tests that call the real model - mock it; assert prompt construction and failure paths

## Related

- [ai-observability.md](ai-observability.md) · [mcp-server.md](mcp-server.md) · [resilience.md](resilience.md) · [caching.md](caching.md) · [configuration.md](configuration.md) · [boot-versions.md](boot-versions.md)
