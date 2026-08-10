# Messaging

## When a broker is the right answer

Messaging buys decoupling, buffering and retry across a process boundary. It costs eventual consistency, a new failure mode per queue, and a debugging story that no longer fits in one stack trace.

Do not reach for it to decouple two classes in the same application - that is an in-process event ([spring-modulith.md](spring-modulith.md)), which is transactional, ordered and debuggable. A broker is for crossing a process boundary, absorbing load spikes, or fanning out to consumers you do not own.

| Broker | Fits |
|---|---|
| **Kafka** | Event streams, replay, high throughput, ordering per key, multiple independent consumer groups over the same data |
| **RabbitMQ** | Work queues, per-message routing, priorities, delayed delivery, competing consumers on discrete tasks |
| **JMS** (Artemis, IBM MQ) | An existing enterprise broker you must integrate with |

The distinction that matters: Kafka is a **log** consumers read at their own offset; Rabbit is a **queue** where a delivered and acknowledged message is gone.

## Kafka

```xml
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

Boot manages the version - do not pin it.

### Producing

```java
@Component
public class OrderEventPublisher {

    private final KafkaTemplate<String, Object> kafka;

    OrderEventPublisher(KafkaTemplate<String, Object> kafka) {
        this.kafka = kafka;
    }

    public void publish(OrderPlaced event) {
        kafka.send("orders.placed", event.orderId().value().toString(), event)
                .whenComplete((result, failure) -> {
                    if (failure != null) {
                        log.error("Failed to publish OrderPlaced for {}", event.orderId(), failure);
                    }
                });
    }
}
```

**The key determines the partition, and the partition determines ordering.** Keying by order id guarantees every event for one order is processed in order. No key means round-robin and no ordering guarantee at all - which is the default, and the source of "events arrived out of order" bugs.

`send` returns a future. Ignoring it means a publish failure is silent.

### Consuming

```java
@Component
class OrderPlacedConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderPlacedConsumer.class);

    private final InventoryService inventoryService;
    private final ProcessedMessageStore processed;

    @KafkaListener(topics = "orders.placed", groupId = "inventory-service")
    void on(@Payload OrderPlaced event,
            @Header(KafkaHeaders.RECEIVED_KEY) String key) {

        if (!processed.markIfNew(event.eventId())) {
            log.debug("Skipping already-processed event {}", event.eventId());
            return;
        }
        inventoryService.reserve(event.orderId());
    }
}
```

The `groupId` is the unit of scaling and of independent consumption. Two applications with different group ids each get every message; two instances sharing a group id split the partitions.

### Serialization

```yaml
spring:
  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
      properties:
        enable.idempotence: true
    consumer:
      group-id: inventory-service
      auto-offset-reset: earliest
      enable-auto-commit: false
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.ErrorHandlingDeserializer
      properties:
        spring.deserializer.value.delegate.class: org.springframework.kafka.support.serializer.JsonDeserializer
        spring.json.trusted.packages: com.example.app.order.events
    listener:
      ack-mode: record
```

Four of these are load-bearing:

- **`spring.json.trusted.packages`** - never `*`. `JsonDeserializer` instantiates the class named in the message headers; an unrestricted list is a deserialisation gadget vector on a topic anyone can write to.
- **`ErrorHandlingDeserializer`** wrapping the real one. Without it, a single unparseable message throws *before* the listener, so no error handler runs, the offset never advances, and the consumer loops on it forever. This is the classic poison-pill stall.
- **`acks: all` + `enable.idempotence: true`** - otherwise a broker failover can silently lose or duplicate a published record.
- **`enable-auto-commit: false`** - auto-commit acknowledges on a timer, so a crash mid-processing loses messages that were already marked consumed.

### Errors and the dead-letter topic

```java
@Bean
DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, Object> template) {
    var recoverer = new DeadLetterPublishingRecoverer(template,
            (record, exception) -> new TopicPartition(record.topic() + ".DLT", record.partition()));

    var handler = new DefaultErrorHandler(recoverer, new ExponentialBackOff(500L, 2.0));
    handler.addNotRetryableExceptions(ValidationException.class, IllegalArgumentException.class);
    return handler;
}
```

Retry the transient, dead-letter the rest. A malformed payload will never succeed, so retrying it just blocks the partition - every message behind it waits.

For long backoffs use `@RetryableTopic`, which retries via separate delay topics instead of blocking the consumer thread:

```java
@RetryableTopic(attempts = "4", backoff = @Backoff(delay = 1000, multiplier = 2.0),
                dltTopicSuffix = ".DLT")
@KafkaListener(topics = "orders.placed", groupId = "inventory-service")
void on(OrderPlaced event) { … }
```

**A DLT nobody watches is a silent data-loss channel.** Alert on its depth - see [observability.md](observability.md).

## RabbitMQ

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
```

```java
@Configuration
class OrderQueueConfig {

    @Bean
    Queue orderQueue() {
        return QueueBuilder.durable("orders.placed")
                .deadLetterExchange("orders.dlx")
                .deadLetterRoutingKey("orders.placed.dead")
                .build();
    }

    @Bean
    Queue orderDeadLetterQueue() {
        return QueueBuilder.durable("orders.placed.dead").build();
    }

    @Bean
    MessageConverter jsonMessageConverter(JsonMapper jsonMapper) {
        return new Jackson2JsonMessageConverter(jsonMapper);
    }
}
```

```java
@RabbitListener(queues = "orders.placed")
void on(OrderPlaced event) {
    inventoryService.reserve(event.orderId());
}
```

- **Declare the dead-letter exchange when you declare the queue.** Queue arguments are immutable - adding a DLX later means deleting and recreating the queue, which on a live system means losing what is in it.
- **Durable queues and persistent messages**, or a broker restart discards everything.
- Enable **publisher confirms** (`spring.rabbitmq.publisher-confirm-type=correlated`) so a failed publish is detectable.
- An exception from the listener requeues by default, which with an unfixable message is an infinite loop at full speed. Configure retry with a `RepublishMessageRecoverer` so exhausted messages go to the DLQ.

## Consumers must be idempotent

**Every broker delivers at least once.** Redelivery after a crash, a rebalance, or an acknowledgement lost in flight is normal operation, not an error. A consumer that is not idempotent will double-charge someone.

Two workable approaches:

```java
// 1. Deduplicate on a message id, with a unique constraint doing the work
@Transactional
public void handle(OrderPlaced event) {
    try {
        processed.save(new ProcessedMessage(event.eventId()));   // unique index on event_id
    } catch (DataIntegrityViolationException duplicate) {
        return;                                                   // already handled
    }
    inventoryService.reserve(event.orderId());
}
```

```java
// 2. Make the operation naturally idempotent - a conditional state transition
@Transactional
public void handle(OrderPlaced event) {
    var reservation = reservations.findByOrderId(event.orderId())
            .orElseGet(() -> Reservation.create(event.orderId()));
    reservation.ensureReserved();     // no-op if already reserved
    reservations.save(reservation);
}
```

The second is better where the domain allows it - no extra table, no cleanup job.

Include a stable `eventId` in every event you publish. Without one, deduplication is impossible.

## The transactional outbox

Writing to the database and publishing to a broker are two systems with no shared transaction. Either can fail after the other succeeded:

```java
// ❌ if the publish fails, the order exists and nobody was told
@Transactional
public OrderId place(PlaceOrderCmd cmd) {
    var order = orderRepository.save(Order.create(cmd.customerId()));
    kafka.send("orders.placed", OrderPlaced.from(order));
    return order.id();
}
```

Write the message to the database **in the same transaction**, then relay it:

```java
@Transactional
public OrderId place(PlaceOrderCmd cmd) {
    var order = orderRepository.save(Order.create(cmd.customerId()));
    outbox.save(OutboxMessage.of("orders.placed", order.id().value().toString(), OrderPlaced.from(order)));
    return order.id();                              // one transaction, both writes
}
```

```java
@Component
class OutboxRelay {

    @Scheduled(fixedDelay = 500)
    @Transactional
    void relay() {
        for (var message : outbox.findUnpublished(Limit.of(100))) {
            kafka.send(message.topic(), message.key(), message.payload());
            message.markPublished();
        }
    }
}
```

The relay is at-least-once - it may publish a message and crash before marking it - which is exactly why consumers must be idempotent.

**Spring Modulith already implements this.** Its event publication registry plus event externalization gives you the outbox without hand-writing the table or the relay. Prefer it - see [spring-modulith.md](spring-modulith.md). The manual version above is what to write when Modulith is not in the project.

## Never publish inside an uncommitted transaction

Even with an outbox, direct publishing from inside a transaction sends a message describing a state that may roll back. Bind it to the commit - `@TransactionalEventListener(AFTER_COMMIT)`, as in [transactions.md](transactions.md).

## Schema evolution

A consumer you do not control is running an older version of the event. Treat the event as a published contract:

- **Add optional fields only.** Never remove or rename one.
- Never change a field's meaning while keeping its name.
- A breaking change is a **new topic** or a new event type, run alongside the old one until consumers migrate.
- Set `spring.json.value.default.type` or ignore unknown properties so an added field does not break older consumers.

A schema registry with Avro or Protobuf enforces this mechanically. Worth it once more than two teams consume your events.

## Testing

Testcontainers, against the real broker - an embedded or mock broker does not reproduce rebalancing, offset commits or DLT routing:

```java
@SpringBootTest
@Testcontainers
class OrderEventIntegrationTest {

    @Container
    @ServiceConnection
    static KafkaContainer kafka = new KafkaContainer("apache/kafka-native:3.8.0");

    @Test
    void publishesOrderPlaced() {
        orderService.place(cmd);

        await().atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(reservations.findByOrderId(orderId)).isPresent());
    }
}
```

`@ServiceConnection` wires the broker with no property registration ([testcontainers.md](testcontainers.md)). Messaging is asynchronous, so **await an assertion - never `Thread.sleep`.** Test the DLT path too: publish something unparseable and assert it lands there.

## If on Boot 3.5.x

Spring Kafka and Spring AMQP work the same, with two differences: the Rabbit JSON converter takes a Jackson 2 `ObjectMapper` rather than a `JsonMapper`, and Testcontainers uses 1.x coordinates. `@ServiceConnection` supports Kafka and RabbitMQ on both lines.

## Gotchas

- Agent uses a broker to decouple two classes in one application - use an in-process event
- Agent publishes with no key and expects ordering - the key selects the partition; no key means no ordering
- Agent ignores the `send` future - publish failures are silent
- Agent sets `spring.json.trusted.packages=*` - a deserialisation gadget vector
- Agent omits `ErrorHandlingDeserializer` - one poison message stalls the partition forever
- Agent leaves `enable-auto-commit` on - offsets commit on a timer and a crash loses in-flight messages
- Agent omits `acks: all` and idempotence - a failover can lose or duplicate records
- Agent retries a malformed payload - it will never succeed; dead-letter it and keep the partition moving
- Agent creates a DLT and never monitors it - that is silent data loss; alert on depth
- Agent writes a non-idempotent consumer - every broker is at-least-once
- Agent publishes no event id - deduplication becomes impossible
- Agent publishes to the broker inside a database transaction - use an outbox, or bind to `AFTER_COMMIT`
- Agent hand-writes an outbox when Spring Modulith is present - it already has one
- Agent declares a Rabbit queue without a DLX - queue arguments are immutable; adding one later means recreating the queue
- Agent lets a Rabbit listener requeue on every failure - an unfixable message loops at full speed
- Agent removes or renames a field in a published event - consumers are on older versions; add only
- Agent tests with an embedded broker - use Testcontainers; embedded brokers do not reproduce rebalancing or DLT routing
- Agent uses `Thread.sleep` in a messaging test - await the assertion

## Related

- [spring-modulith.md](spring-modulith.md) · [transactions.md](transactions.md) · [resilience.md](resilience.md) · [domain-modelling.md](domain-modelling.md) · [observability.md](observability.md) · [testcontainers.md](testcontainers.md)
