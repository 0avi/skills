# Code Organization

Package **by feature**, not by layer. This is what the [Spring Boot reference](https://docs.spring.io/spring-boot/reference/using/structuring-your-code.html) recommends, and it is the only layout under which anything can be hidden.

## Why not layer-first

```
com.example.app/
├── controller/      ← OrderController, CustomerController, InvoiceController…
├── service/         ← OrderService, CustomerService, InvoiceService…
├── repository/
└── dto/
```

Two costs, one of them fatal:

- Adding one feature touches four packages, and no package tells you what the application does.
- **Nothing can be package-private.** `OrderService` must be `public` for `OrderController` in a different package to call it. Every type in the application ends up public, so there is no boundary to enforce and no way to change a feature's internals safely.

Layer-first survives only in an application small enough that it does not matter. Do not start there.

## The default: flat, by feature

```
com.example.app/
├── Application.java
├── order/
│   ├── Order.java                 (package-private @Entity)
│   ├── OrderRepository.java       (package-private)
│   ├── OrderService.java          (public - the feature's boundary)
│   ├── OrderController.java
│   └── CreateOrderRequest.java, OrderResponse.java
├── customer/
└── config/
```

The entity and the repository are package-private. Only the service is public, so no other feature can reach past it into the persistence model. That is a real, compiler-enforced boundary and it costs nothing.

Keep `Application.java` in the root package above every feature - `@SpringBootApplication` derives component, entity and repository scanning from its package.

## The escalation ladder

A feature grows. Escalate one rung at a time; do not start at the top.

| Feature size | Shape | Enforced by |
|---|---|---|
| A handful of types | Flat feature package | javac - package-private |
| Outgrown one package | Feature base package is the API, nested packages are internal | Spring Modulith `verify()` |
| Contains separable parts | Nested `@ApplicationModule` packages inside it | Spring Modulith `verify()` |
| Separately deployable, or a hard team boundary | Maven or Gradle modules | the build |

**Rung 2 is where javac stops helping.** Java packages do not nest for access control: `order.internal.OrderEntity` cannot be package-private and still be visible to `order.web.OrderController`. The moment you sub-divide, package-private stops being a boundary and you need Spring Modulith or ArchUnit to enforce what the compiler no longer can. That is not a reason to avoid sub-dividing - it is the reason Modulith exists. Read [spring-modulith.md](spring-modulith.md).

**Rung 3 is for the genuinely large feature** - ten or more services, several sub-areas. Before taking it, apply the test below.

**Rung 4** costs the most and buys hard enforcement plus independent versioning. Read [maven.md](maven.md) or [gradle.md](gradle.md).

### Is it one big feature, or several filed together?

Before nesting modules inside a feature, check:

- Do the parts share an invariant that must hold across all of them? If not, they are siblings.
- Does every part point the same way, or do two of them depend on each other in both directions? A cycle means the split is wrong, not that the feature is big.
- Would you deploy or scale them together?

If those answers say "several", split into sibling features. Rung 3 applied to a feature that is really three features formalises the mess instead of fixing it.

## Where cross-cutting code goes

Two kinds, and conflating them is what turns `SecurityConfig` into a god-object.

### Genuinely global infrastructure - `config/`

`SecurityConfig`, `WebMvcConfig`, `JacksonConfig`, `AsyncConfig`, `OpenApiConfig`, the application-wide `@RestControllerAdvice`. These belong to no feature. Put them in a top-level `config/` package beside `Application.java`.

Under Spring Modulith, a top-level `config/` is itself detected as an application module, and every feature depending on it is then reported as a violation. Mark it open:

```java
@ApplicationModule(type = ApplicationModule.Type.OPEN)
package com.example.app.config;

import org.springframework.modulith.ApplicationModule;
```

### Genuinely shared domain types - `shared/`

Value objects and utilities used by more than one feature. Same `OPEN` marking. **`shared/` is a dumping ground unless you defend it** - a type belongs there only when two or more features genuinely need it, not when you cannot decide where it lives. A type used by one feature belongs to that feature.

### Config that only looks global

Authorization rules for `/api/orders/**` are the orders feature's business, not the platform's. Split it:

| Concern | Owner |
|---|---|
| Authentication - filter chain skeleton, password encoder, JWT decoder, 401/403 entry points | Global `SecurityConfig` |
| Authorization - who may do what | The feature, via `@PreAuthorize` on its service methods, or its own `SecurityFilterChain` bean with `@Order` for a whole URL space |
| Framework and generic exceptions | Global `@RestControllerAdvice` |
| Domain exceptions | The feature's own `@RestControllerAdvice(basePackageClasses = OrderService.class)` |

Without this split, `SecurityConfig` ends up listing every URL in the application and every feature change edits it. See [security-fundamentals.md](security-fundamentals.md) and [error-handling.md](error-handling.md).

## Naming conventions

| Type | Convention | Example |
|---|---|---|
| Entity | Domain noun, or `*Entity` when a domain model of the same name exists | `Order`, `OrderEntity` |
| Value object | Domain name, as a record | `OrderId`, `Money`, `EmailAddress` |
| Command | `*Cmd` | `CreateOrderCmd` |
| Query | `*Query` | `FindOrdersQuery` |
| Command result | `*Result` | `RegistrationResult` |
| HTTP request payload | `*Request` | `CreateOrderRequest` |
| HTTP response payload | `*Response` | `OrderResponse` |
| Repository | `*Repository` | `OrderRepository` |
| Service | `*Service` | `OrderService` |
| Domain exception | `*Exception` | `OrderNotModifiableException` |
| Configuration class | `*Config` | `SecurityConfig` |
| Module facade (rung 2+) | `*Api` | `OrdersApi` |

Keep `*Request`/`*Response` distinct from the domain - never bind a request payload straight onto an entity, and never return an entity as a response. See [rest-controllers.md](rest-controllers.md).

## If on Boot 3.5.x

Layout is version-agnostic - packaging, visibility and the escalation ladder are the same. The only version-bound rung is Modulith itself: 1.4.x on Boot 3.5.x, 2.x on Boot 4 ([spring-modulith.md](spring-modulith.md)).

## Gotchas

- Agent creates `controller/`, `service/`, `repository/` packages - package by feature; layer-first makes every type public and removes the only free boundary you have
- Agent makes every class `public` out of habit - in a flat feature package the entity and repository should be package-private
- Agent puts `Application.java` in the same package as a feature - it belongs in the root package above them all, or component scanning misses features
- Agent puts a feature's `SecurityFilterChain` rules into the global `SecurityConfig` - authentication is global, authorization belongs to the feature
- Agent creates `util/`, `common/` or `helper/` packages - name the capability; `shared/` only for types two or more features genuinely need
- Agent adds sub-packages to a feature and still expects package-private to hold - Java packages do not nest for access control; add Modulith or ArchUnit at the same time
- Agent nests modules inside a feature that is really three features - check for a shared invariant and a single dependency direction first
- Agent creates a `dto/` package spanning all features - request and response payloads belong with the feature that serves them

## Related

- [spring-modulith.md](spring-modulith.md) · [archunit.md](archunit.md) · [hexagonal-architecture.md](hexagonal-architecture.md) · [domain-modelling.md](domain-modelling.md)
