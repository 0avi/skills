# Validation

Validation lives in three places, and putting a rule in the wrong one either duplicates it or lets an invalid object exist.

| Kind of rule | Where | Enforced by |
|---|---|---|
| **Shape of the request** - required, length, format, range | Jakarta Validation annotations on the `*Request` record, `@Valid` at the controller | Spring, before your code runs |
| **Invariant of a value** - a `Money` cannot be negative, an `OrderId` cannot be blank | The record's compact constructor | The type system; an invalid instance cannot exist |
| **Invariant of the aggregate** - you cannot add an item to a submitted order | A behaviour method on the entity | The domain object, at the moment of the change |

The distinction is state: the first two check a value in isolation and can run before anything is loaded. The third needs the current state of the aggregate, so it belongs where that state is.

This is java-developer's "validate at the boundaries, trust the interior" applied to a Spring application. Rows one and two *are* the boundary. Row three is not re-validation - it is a different rule that could not have been checked earlier.

## Request validation

```java
public record CreateOrderRequest(

        @NotBlank
        @Email
        String customerEmail,

        @NotEmpty
        @Size(max = 100, message = "an order may contain at most 100 lines")
        @Valid
        List<OrderLineRequest> items,

        @Size(max = 500)
        String notes
) {
    public PlaceOrderCmd toCommand() {
        return new PlaceOrderCmd(
                EmailAddress.of(customerEmail),
                items.stream().map(OrderLineRequest::toCommand).toList(),
                notes);
    }
}

public record OrderLineRequest(
        @NotNull UUID productId,
        @Positive int quantity
) { … }
```

```java
@PostMapping
ResponseEntity<OrderResponse> create(@Valid @RequestBody CreateOrderRequest request) { … }
```

- **`@Valid` on the parameter** triggers it. Without the annotation the constraints are inert - this is the single most common validation bug.
- **`@Valid` on the nested collection** cascades into the elements. `@NotEmpty` alone checks the list, not its contents.
- **Validate the request record, not the entity.** By the time you have an entity, binding has already happened.
- Add `message` when the default is unhelpful to an API consumer. `@Size(max = 100)` produces "size must be between 0 and 100", which is not what the caller needs to hear.

Failures surface as `MethodArgumentNotValidException` and become an RFC 9457 `violations` array - see [error-handling.md](error-handling.md).

### Which annotation

| Intent | Annotation |
|---|---|
| Present and not only whitespace (`String`) | `@NotBlank` |
| Present and not empty (collection, map, array, `String`) | `@NotEmpty` |
| Present (anything, including `false` and `0`) | `@NotNull` |
| Numeric bounds | `@Positive`, `@PositiveOrZero`, `@Min`, `@Max`, `@DecimalMin`, `@DecimalMax` |
| Money and precision | `@Digits(integer = 10, fraction = 2)` |
| Dates | `@Past`, `@PastOrPresent`, `@Future`, `@FutureOrPresent` |
| Pattern | `@Pattern(regexp = …)` |

`@NotNull` on a `String` accepts `""` and `"   "`. Use `@NotBlank` for text.

## Value object invariants

```java
public record EmailAddress(String value) {

    private static final Pattern PATTERN = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$");

    public EmailAddress {
        Objects.requireNonNull(value, "value");
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Not a valid email address: " + value);
        }
    }

    public static EmailAddress of(String value) {
        return new EmailAddress(value);
    }
}
```

Once this exists, no method taking an `EmailAddress` needs to check it. That is the payoff, and it is why java-developer says to let types carry the validation.

Two rules:

- **Throw `IllegalArgumentException`, not a domain exception**, from a compact constructor. It signals a programming error at the point of construction. Convert at the boundary if a caller can trigger it.
- **Do not put Jakarta Validation annotations on a value object and expect them to run.** They fire only where something calls the validator - a `@Valid` parameter, or a `@Validated` bean. A directly constructed value object is not validated. The compact constructor is what guarantees the invariant.

## Aggregate invariants

```java
void addItem(ProductId productId, int quantity, Money unitPrice) {
    if (status != OrderStatus.DRAFT) {
        throw new OrderNotModifiableException(id, status);
    }
    items.add(OrderItem.create(this, productId, quantity, unitPrice));
    recalculateTotal();
}
```

State-dependent, so it can only be checked here. Throw a `DomainException` subtype - this one maps to 422, not 400, because the request was well-formed and the domain refused it.

Never enforce this with a Jakarta Validation annotation on the entity. Entity-level constraints run on flush, which is the wrong time and produces a `ConstraintViolationException` from deep in the persistence layer rather than a meaningful domain error.

## Custom constraints

When a rule repeats across requests:

```java
@Documented
@Constraint(validatedBy = SupportedCurrencyValidator.class)
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT })
@Retention(RetentionPolicy.RUNTIME)
public @interface SupportedCurrency {
    String message() default "unsupported currency";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

class SupportedCurrencyValidator implements ConstraintValidator<SupportedCurrency, String> {

    private final CurrencyRegistry registry;   // injected - validators are Spring beans

    SupportedCurrencyValidator(CurrencyRegistry registry) {
        this.registry = registry;
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || registry.isSupported(value);   // null is @NotNull's job
    }
}
```

- Include `ElementType.RECORD_COMPONENT` in `@Target` or the annotation cannot be used on a record.
- **Return `true` for `null`.** Composing with `@NotNull` is the caller's choice; a validator that rejects null duplicates it and produces two messages.
- Validators are Spring beans, so they may inject dependencies. Do not perform a database query in one on a hot path.

### Cross-field rules

A constraint on the type, not a component:

```java
@Target(ElementType.TYPE)
@Constraint(validatedBy = DateRangeValidator.class)
public @interface ValidDateRange { … }

@ValidDateRange
public record ReportRequest(@NotNull LocalDate from, @NotNull LocalDate to) {}
```

Use `context.buildConstraintViolationWithTemplate(…).addPropertyNode("to").addConstraintViolation()` to attach the message to a specific field so the `violations` array stays useful.

## Validating method parameters

`@Valid` on a `@RequestBody` is handled by the argument resolver. To validate parameters on a **service** method, the bean needs `@Validated`:

```java
@Service
@Validated
public class OrderService {

    public OrderId place(@Valid PlaceOrderCmd cmd) { … }
}
```

This is proxy-based, so a self-invoked call is not validated - see [spring-proxies-and-di.md](spring-proxies-and-di.md). Failures throw `ConstraintViolationException`, not `MethodArgumentNotValidException`, so it needs its own handler.

Prefer value objects over `@Validated` on services. If the command's components are already validated types, there is nothing left to check.

## Validating configuration

Configuration errors should fail at startup, not on first use:

```java
@Validated
@ConfigurationProperties("app.orders")
public record OrderProperties(
        @NotNull @Positive Integer maxLinesPerOrder,
        @NotBlank String defaultCurrency,
        @NotNull Duration reservationTimeout
) {}
```

See [configuration.md](configuration.md).

## Validation groups

For a field required on update but not on create:

```java
public interface OnCreate {}
public interface OnUpdate {}

public record SaveCustomerRequest(
        @Null(groups = OnCreate.class) @NotNull(groups = OnUpdate.class) UUID id,
        @NotBlank String name
) {}

@PutMapping("/{id}")
ResponseEntity<?> update(@Validated(OnUpdate.class) @RequestBody SaveCustomerRequest request) { … }
```

`@Validated(Group.class)`, not `@Valid`, which cannot take a group. Groups are worth it for genuine create/update asymmetry. Two separate request records are usually clearer.

## If on Boot 3.5.x

Identical. Both lines use Jakarta Validation (`jakarta.validation.*`); Boot 4 manages a newer version but the annotations, `@Validated` and the custom-constraint API are unchanged. `jakarta.validation` arrives with `spring-boot-starter-validation` on both - the web starter does not bring it transitively.

## Gotchas

- Agent adds constraint annotations but omits `@Valid` on the parameter - nothing is validated
- Agent omits `@Valid` on a nested collection or object - `@NotEmpty` checks the list, not the elements
- Agent uses `@NotNull` on a `String` - accepts `""` and whitespace; use `@NotBlank`
- Agent puts constraints on a value-object record and assumes they run - validate in the compact constructor
- Agent puts Jakarta constraints on an entity for a business rule - they fire on flush; enforce in a behaviour method
- Agent writes a custom validator that rejects `null` - return `true` and let `@NotNull` own that
- Agent omits `ElementType.RECORD_COMPONENT` from a custom constraint's `@Target` - unusable on records
- Agent validates in the controller with `if` statements - annotate the request record
- Agent throws a `DomainException` from a compact constructor - that is `IllegalArgumentException` territory
- Agent expects `@Validated` on a service to work for a self-invoked call - proxy-based, so it does not
- Agent returns only the first violation - report all of them
- Agent forgets `spring-boot-starter-validation` - constraints are silently absent from the classpath
- Agent uses `@Valid` with a group - `@Valid` takes no group; use `@Validated(Group.class)`

## Related

- [rest-controllers.md](rest-controllers.md) · [error-handling.md](error-handling.md) · [domain-modelling.md](domain-modelling.md) · [configuration.md](configuration.md) · [java-in-spring.md](java-in-spring.md)
