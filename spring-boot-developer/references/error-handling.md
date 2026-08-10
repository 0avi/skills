# Error Handling

Errors are **RFC 9457 Problem Details**. Spring has built-in support via `ProblemDetail`, so there is no reason to invent an error shape.

RFC 9457 obsoletes RFC 7807; the media type `application/problem+json` and the field names are unchanged, so older documentation describing "RFC 7807 support" is describing the same thing.

## No envelope

Do not wrap responses in a `{ success, data, error }` envelope. Success responses are the payload; the HTTP status carries the outcome; failures are `ProblemDetail`. An envelope duplicates the status code in the body, forces every client to unwrap, and breaks caching and conditional requests.

If you inherit a codebase that already has an envelope, **keep it and stay consistent** - mixing an envelope for success with `ProblemDetail` for errors gives consumers two shapes to handle and is worse than either.

## Enable it

```yaml
spring:
  mvc:
    problemdetails:
      enabled: true
```

This converts **Spring's own** exceptions - 404 on no handler, 405, 415, malformed body - into `ProblemDetail`. It does nothing for your domain exceptions; those still need handlers.

## The domain exception hierarchy

```java
public abstract class DomainException extends RuntimeException {

    private final String errorCode;

    protected DomainException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    protected DomainException(String errorCode, String message, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    public String errorCode() {
        return errorCode;
    }
}

public class OrderNotFoundException extends DomainException {
    public OrderNotFoundException(OrderId id) {
        super("ORDER_NOT_FOUND", "No order with id " + id.value());
    }
}

public class OrderNotModifiableException extends DomainException {
    public OrderNotModifiableException(OrderId id, OrderStatus status) {
        super("ORDER_NOT_MODIFIABLE", "Order %s cannot be modified in status %s".formatted(id.value(), status));
    }
}
```

Unchecked, always - a checked exception forces every intermediate layer to declare it and does not roll a transaction back by default ([transactions.md](transactions.md)). The stable `errorCode` is what clients branch on; the message is for humans and may change.

Throw from the service or the domain object, never from the controller.

## The global handler

```java
@RestControllerAdvice
class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private static final URI BASE = URI.create("https://errors.example.com/");

    @ExceptionHandler(OrderNotFoundException.class)
    ProblemDetail handleNotFound(OrderNotFoundException ex) {
        return problem(HttpStatus.NOT_FOUND, "Resource Not Found", ex);
    }

    @ExceptionHandler(DomainException.class)
    ProblemDetail handleDomain(DomainException ex) {
        return problem(HttpStatus.UNPROCESSABLE_ENTITY, "Business Rule Violation", ex);
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    ProblemDetail handleConflict(OptimisticLockingFailureException ex) {
        var problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.CONFLICT, "The resource was modified concurrently. Retry the request.");
        problem.setType(BASE.resolve("concurrent-modification"));
        problem.setTitle("Conflict");
        return problem;
    }

    @ExceptionHandler(Exception.class)
    ProblemDetail handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);
        var problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred.");
        problem.setType(BASE.resolve("internal"));
        problem.setTitle("Internal Server Error");
        return problem;
    }

    private ProblemDetail problem(HttpStatus status, String title, DomainException ex) {
        var problem = ProblemDetail.forStatusAndDetail(status, ex.getMessage());
        problem.setType(BASE.resolve(ex.errorCode().toLowerCase().replace('_', '-')));
        problem.setTitle(title);
        problem.setProperty("errorCode", ex.errorCode());
        return problem;
    }
}
```

Points that matter:

- **Extend `ResponseEntityExceptionHandler`** to inherit handling for the whole set of Spring MVC exceptions. Without it you re-implement 405, 415 and malformed-body handling by hand, badly.
- **Set `type`.** It is the one field RFC 9457 treats as the stable identifier for the error kind. `about:blank` - the default - means "the status code is all there is".
- **Return `ProblemDetail` directly.** Spring sets the status from the object and the `application/problem+json` content type. You only need `ResponseEntity<ProblemDetail>` to add a header.
- **`instance` is set for you** from the request URI. Setting it by hand from `HttpServletRequest` is redundant.
- **Never put `ex.getMessage()` in a 500.** Log it, return something generic. Stack traces and internal messages in an error body are an information leak.
- **Do not add a `timestamp`.** The HTTP `Date` header already carries it.

Ordering is by exception specificity, not declaration order, so the `DomainException` catch-all does not shadow `OrderNotFoundException`.

## Validation failures

Override the hook rather than handling `MethodArgumentNotValidException` yourself, so the rest of `ResponseEntityExceptionHandler` keeps working:

```java
@Override
protected ResponseEntity<Object> handleMethodArgumentNotValid(
        MethodArgumentNotValidException ex, HttpHeaders headers,
        HttpStatusCode status, WebRequest request) {

    var problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Request validation failed.");
    problem.setType(URI.create("https://errors.example.com/validation"));
    problem.setTitle("Validation Failed");
    problem.setProperty("violations", ex.getBindingResult().getFieldErrors().stream()
            .map(error -> Map.of("field", error.getField(), "message", error.getDefaultMessage()))
            .toList());
    return ResponseEntity.badRequest().body(problem);
}
```

```json
{
  "type": "https://errors.example.com/validation",
  "title": "Validation Failed",
  "status": 400,
  "detail": "Request validation failed.",
  "instance": "/api/orders",
  "violations": [
    { "field": "customerEmail", "message": "must be a well-formed email address" },
    { "field": "items", "message": "must not be empty" }
  ]
}
```

Report **all** violations, not the first. See [validation.md](validation.md).

## Per-feature handlers

A feature can own its domain exceptions without editing the global handler:

```java
@RestControllerAdvice(basePackageClasses = OrderService.class)
class OrderExceptionHandler {

    @ExceptionHandler(OrderNotModifiableException.class)
    ProblemDetail handle(OrderNotModifiableException ex) { … }
}
```

Scoped advice applies only to controllers in that package. The rule: **the global handler owns framework exceptions and the generic fallback; features own their domain exceptions.** This keeps the global handler from accumulating an entry per feature. See [code-organization.md](code-organization.md).

## What `@RestControllerAdvice` cannot catch

**Anything thrown in a security filter.** Filters run before the `DispatcherServlet`, so authentication and authorization failures never reach your handler. An unauthenticated request gets Spring Security's default empty 401 unless you configure the entry points yourself:

```java
.exceptionHandling(ex -> ex
    .authenticationEntryPoint(problemDetailEntryPoint())    // 401
    .accessDeniedHandler(problemDetailAccessDeniedHandler()) // 403
)
```

Write the `ProblemDetail` to the response by hand there - see [security-fundamentals.md](security-fundamentals.md).

Same applies to failures during request parsing before dispatch, and to anything thrown from an async listener after the response has been sent ([async-and-scheduling.md](async-and-scheduling.md)).

## Logging errors

| Class | Level |
|---|---|
| Client error the caller can fix (400, 404, 422) | `DEBUG`, or nothing |
| Conflict (409) | `INFO` |
| Server error (500) | `ERROR`, with the stack trace |

Logging every 404 at `ERROR` turns the log into noise and hides real failures. Log the exception object, not `ex.getMessage()` - you lose the stack trace otherwise.

## If on Boot 3.5.x

`ProblemDetail`, `spring.mvc.problemdetails.enabled` and `ResponseEntityExceptionHandler` all work identically - `ProblemDetail` has been present since Boot 3.0. The only difference is that the JSON is produced by Jackson 2.

## Gotchas

- Agent invents a `{ success, data, error }` envelope - use `ProblemDetail`; the status code carries the outcome
- Agent returns `Map<String, Object>` or a custom error record - use `ProblemDetail`
- Agent writes a handler that does not extend `ResponseEntityExceptionHandler` - you lose Spring's own MVC exception handling
- Agent assumes `problemdetails.enabled: true` covers domain exceptions - it converts only Spring's own exceptions
- Agent leaves `type` unset - it is the stable machine-readable identifier for the error kind
- Agent puts `ex.getMessage()` in a 500 response - log it, return a generic message
- Agent adds a `timestamp` property - the `Date` header has it
- Agent sets `instance` manually - Spring populates it from the request URI
- Agent returns 200 with an error body - use the status code
- Agent maps every failure to 400 - 400 is a parse/bind failure, 422 is a business rule refusal
- Agent catches exceptions in the controller - throw from the service, handle in advice
- Agent expects advice to catch a security filter exception - configure `authenticationEntryPoint` and `accessDeniedHandler`
- Agent returns only the first validation error - report all violations
- Agent uses checked exceptions for domain failures - unchecked, and they roll back by default
- Agent logs 404s at `ERROR` - that is noise; reserve `ERROR` for server faults

## Related

- [rest-controllers.md](rest-controllers.md) · [validation.md](validation.md) · [security-fundamentals.md](security-fundamentals.md) · [transactions.md](transactions.md) · [observability.md](observability.md)
