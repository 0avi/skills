# JSON and Jackson

Boot 4 uses **Jackson 3**. This is one of the largest sources of code that looks right and does not compile.

## What moved, and what did not

| Artifact | Jackson 2 (Boot 3.5) | Jackson 3 (Boot 4) |
|---|---|---|
| Core, databind | `com.fasterxml.jackson.core` / `.databind` | **`tools.jackson.core` / `.databind`** |
| Mapper type | `ObjectMapper` | **`JsonMapper`** (`tools.jackson.databind.json.JsonMapper`) |
| Boot annotation | `@JsonComponent` | **`@JacksonComponent`** |
| Boot customizer | `Jackson2ObjectMapperBuilderCustomizer` | **`JsonMapperBuilderCustomizer`** |
| Databind annotations - `@JsonSerialize`, `@JsonDeserialize` | `com.fasterxml.jackson.databind.annotation` | **`tools.jackson.databind.annotation`** |
| **Core annotations - `@JsonValue`, `@JsonCreator`, `@JsonProperty`, `@JsonIgnore`, `@JsonInclude`, `@JsonFormat`** | `com.fasterxml.jackson.annotation` | **unchanged** |
| Properties | `spring.jackson.*` | `spring.jackson.*` configures Jackson 3; Jackson 2's moved to `spring.jackson2.*` |

The last two rows are where agents go wrong in both directions. `jackson-annotations` deliberately kept its group id and package, so the annotations you put on a DTO need **no** import change - but the two annotations that live in `databind` do move. Rewriting every `com.fasterxml.jackson` import to `tools.jackson` breaks the build.

## Do not declare an ObjectMapper bean

Boot auto-configures the mapper. Declaring your own replaces it and silently drops every Boot default - including the `spring.jackson.*` properties and the modules Boot registered.

```java
// ✅ customise
@Bean
JsonMapperBuilderCustomizer jsonCustomizer() {
    return builder -> builder.changeDefaultPropertyInclusion(
            incl -> incl.withValueInclusion(JsonInclude.Include.NON_NULL));
}
```

```java
// ❌ replaces Boot's mapper entirely
@Bean
JsonMapper jsonMapper() {
    return JsonMapper.builder().build();
}
```

Most of what people write a customizer for is a property:

```yaml
spring:
  jackson:
    default-property-inclusion: non_null
    deserialization:
      fail-on-unknown-properties: false
    serialization:
      write-dates-as-timestamps: false
```

Inject `JsonMapper` where you genuinely need to serialise by hand. Do not inject `ObjectMapper` on Boot 4.

## Records serialise natively

No annotation, no constructor, nothing:

```java
public record OrderResponse(
        UUID id,
        String status,
        BigDecimal total,
        Instant placedAt,
        List<OrderLineResponse> lines
) {}
```

Deserialisation uses the canonical constructor. This is the main practical reason DTOs are records - see [java-in-spring.md](java-in-spring.md).

`@JsonProperty` is needed only when the wire name differs from the component name:

```java
public record CustomerResponse(UUID id, @JsonProperty("full_name") String fullName) {}
```

Prefer a global naming strategy over per-field annotations if the whole API is snake_case:

```yaml
spring:
  jackson:
    property-naming-strategy: SNAKE_CASE
```

## Value objects on the wire

A value-object ID should appear as its underlying scalar, not as a nested object. Two annotations, both from the unchanged `com.fasterxml.jackson.annotation` package:

```java
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public record OrderId(@JsonValue UUID value) {

    public OrderId {
        Objects.requireNonNull(value, "value");
    }

    @JsonCreator
    public static OrderId of(String value) {
        return new OrderId(UUID.fromString(value));
    }

    public static OrderId of(UUID value) {
        return new OrderId(value);
    }
}
```

Serialises as `"9f2c…"`, not `{"value":"9f2c…"}`. Without `@JsonValue`, every value object in the API leaks a wrapper object into the contract.

`@JsonValue`/`@JsonCreator` handle the **request body**. Path variables and query parameters go through a Spring `Converter` instead - see [rest-controllers.md](rest-controllers.md). Both are needed; they are different mechanisms.

## Dates and times

```yaml
spring:
  jackson:
    serialization:
      write-dates-as-timestamps: false   # ISO-8601 strings, not epoch numbers
```

- **`Instant` for a moment in time.** Serialises as `2026-08-10T09:15:30Z`. Use it for `createdAt`, `placedAt`, anything that happened.
- **`LocalDate` for a date with no time** - a birth date, an invoice date.
- **Avoid `LocalDateTime` on the wire.** It has no zone, so the client cannot know what instant it refers to. It is the single most common cause of off-by-one-hour bugs across a timezone boundary.
- **Do not register `JavaTimeModule`.** Jackson 3 handles `java.time` natively. On Jackson 2 Boot registered it for you, so it was never needed there either.

## Nulls and absent fields

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
public record OrderResponse(UUID id, String status, String cancellationReason) {}
```

Or globally via `default-property-inclusion`. Decide once and apply it API-wide - a response where some null fields are omitted and others are present as `null` is harder to consume than either.

For `PATCH`, omitting a field and setting it to `null` mean different things, and `NON_NULL` cannot distinguish them. Use `JsonNullable` (from `org.openapitools:jackson-databind-nullable`) or model the patch explicitly. Do not pretend the distinction does not exist.

## Unknown properties

Boot disables `FAIL_ON_UNKNOWN_PROPERTIES` by default, so an unexpected field is ignored. That is right for a tolerant reader consuming someone else's API. For **your own inbound requests**, consider turning it on - silently ignoring a misspelt field means the caller believes they set something they did not:

```yaml
spring:
  jackson:
    deserialization:
      fail-on-unknown-properties: true
```

## Polymorphic types

Jackson will not serialise a sealed hierarchy usefully without configuration. Either map to a flat response record at the boundary (preferred - see [java-in-spring.md](java-in-spring.md)), or be explicit:

```java
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
        @JsonSubTypes.Type(value = CardPayment.class, name = "card"),
        @JsonSubTypes.Type(value = BankTransfer.class, name = "transfer")
})
public sealed interface PaymentMethod permits CardPayment, BankTransfer {}
```

**Never enable default typing on an inbound mapper.** It deserialises arbitrary classes named in the payload and is a remote code execution vector. The one place default typing is legitimate is a cache you control on both ends, scoped to your own packages - see [caching.md](caching.md).

## Custom serializers

```java
@JacksonComponent
public class MoneySerializer extends ValueSerializer<Money> { … }
```

`@JacksonComponent` (Boot 4; `@JsonComponent` on 3.5.x) registers it automatically. Before writing one, check whether `@JsonValue` on the type does the job - it usually does.

## If on Boot 3.5.x

Jackson 2 throughout. `com.fasterxml.jackson.databind.ObjectMapper`, `@JsonComponent`, `Jackson2ObjectMapperBuilderCustomizer`, and `spring.jackson.*` configures Jackson 2. Everything else in this file - records, `@JsonValue`, date handling, inclusion, unknown properties - is identical, and `JavaTimeModule` is registered by Boot, so you still should not add it.

## Gotchas

- Agent declares an `ObjectMapper` or `JsonMapper` `@Bean` to customise JSON - that replaces Boot's mapper and drops every default; use `JsonMapperBuilderCustomizer` or a property
- Agent injects `ObjectMapper` on Boot 4 - the bean is a `JsonMapper`
- Agent rewrites every `com.fasterxml.jackson` import to `tools.jackson` - `jackson-annotations` did not move; `@JsonValue`, `@JsonCreator`, `@JsonProperty`, `@JsonIgnore`, `@JsonInclude` keep their package
- Agent leaves `@JsonSerialize`/`@JsonDeserialize` on the old package - those are in `databind` and did move to `tools.jackson.databind.annotation`
- Agent uses `@JsonComponent` on Boot 4 - it is `@JacksonComponent`
- Agent registers `JavaTimeModule` - unnecessary on both lines, and on Jackson 3 it does not exist in that form
- Agent serialises a value object without `@JsonValue` - the API gets `{"value":"…"}` instead of a scalar
- Agent adds `@JsonValue` and expects path variables to bind - that needs a `Converter`
- Agent uses `LocalDateTime` for a timestamp - no zone; use `Instant`
- Agent writes dates as epoch numbers - set `write-dates-as-timestamps: false`
- Agent enables default typing on the request mapper - a deserialisation gadget vector
- Agent returns a sealed interface from a controller - configure `@JsonTypeInfo` or map to a flat record
- Agent writes a custom serializer for something `@JsonValue` would handle
- Agent looks for Jackson 2 properties on Boot 4 - they moved to `spring.jackson2.*`

## Related

- [rest-controllers.md](rest-controllers.md) · [java-in-spring.md](java-in-spring.md) · [caching.md](caching.md) · [boot-versions.md](boot-versions.md) · [testing-slices-web.md](testing-slices-web.md)
