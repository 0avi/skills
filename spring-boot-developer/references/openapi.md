# OpenAPI

Two approaches, and the choice is about **who owns the contract**.

| | Code-first (springdoc) | Spec-first (generator) |
|---|---|---|
| Source of truth | The Java code | `openapi.yaml` |
| Spec produced by | Runtime introspection | You, by hand |
| Drift | Impossible - it is generated from the code | Possible; the build must enforce it |
| Use when | One team owns both sides; the API serves your own clients | Multiple teams or languages consume it; the contract is negotiated before implementation |

**Default to code-first.** Spec-first is worth its cost when the contract is a real interface between teams, and a liability when it is ceremony around a single team's API.

## Code-first with springdoc

```xml
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
    <version><!-- check for the release matching your Boot line --></version>
</dependency>
```

springdoc is not managed by Boot's BOM, so you set the version - and the major line must match your Boot/Framework generation. Verify against springdoc's compatibility matrix rather than copying a version.

The spec appears at `/v3/api-docs` and Swagger UI at `/swagger-ui.html` with no further configuration. Most of what you need beyond that is metadata:

```java
@Configuration
class OpenApiConfig {

    @Bean
    OpenAPI orderServiceApi(BuildProperties buildProperties) {
        return new OpenAPI()
                .info(new Info()
                        .title("Order Service API")
                        .version(buildProperties.getVersion())
                        .description("Ordering and fulfilment."))
                .components(new Components().addSecuritySchemes("bearer-jwt",
                        new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList("bearer-jwt"));
    }
}
```

Taking the version from `BuildProperties` keeps the published spec in step with the deployed artifact - see [maven.md](maven.md) for generating it.

### What springdoc infers, and what it cannot

It reads your mappings, records, and Jakarta Validation constraints - `@NotBlank` becomes `required`, `@Size(max = 100)` becomes `maxLength`. That is a strong reason to keep validation on the request record ([validation.md](validation.md)): it documents the API for free.

It cannot infer intent. Annotate only what is genuinely not derivable:

```java
@Operation(summary = "Cancel an order",
           description = "Only permitted while the order is PENDING.")
@ApiResponse(responseCode = "204", description = "Cancelled")
@ApiResponse(responseCode = "409", description = "Already shipped",
             content = @Content(schema = @Schema(implementation = ProblemDetail.class)))
@PostMapping("/{id}/cancel")
ResponseEntity<Void> cancel(@PathVariable OrderId id) { … }
```

Resist annotating every parameter and field. A controller where the annotations outweigh the code is harder to read and no better documented - springdoc already knew the types.

Document error responses as `ProblemDetail` so consumers see the real shape ([error-handling.md](error-handling.md)).

### Value objects in the schema

A value object with `@JsonValue` serialises as a scalar but springdoc may still document it as an object. Register the mapping once:

```java
static {
    SpringDocUtils.getConfig().replaceWithClass(OrderId.class, UUID.class);
}
```

Or put `@Schema(type = "string", format = "uuid")` on the record. Without this the published schema contradicts the actual payload.

### Locking the spec in CI

Code-first cannot drift from the code, but it can drift from what consumers expect. If anyone depends on your API, commit the generated spec and diff it in CI - springdoc's Maven plugin can write `/v3/api-docs` to a file during `integration-test`. A failing diff forces the breaking change to be a deliberate act, and tells you when to version ([api-versioning.md](api-versioning.md)).

### Production

Ship the spec, not the UI:

```yaml
springdoc:
  api-docs:
    enabled: true
  swagger-ui:
    enabled: false      # in production
```

Swagger UI in production is an unnecessary attack surface and an interactive client for your API. If it must be exposed, put it behind authentication - and make sure `/v3/api-docs` is not accidentally `permitAll` in your security config ([security-fundamentals.md](security-fundamentals.md)).

## Spec-first with the generator

```xml
<plugin>
    <groupId>org.openapitools</groupId>
    <artifactId>openapi-generator-maven-plugin</artifactId>
    <version><!-- check the current release --></version>
    <executions>
        <execution>
            <goals><goal>generate</goal></goals>
            <configuration>
                <inputSpec>${project.basedir}/src/main/resources/openapi.yaml</inputSpec>
                <generatorName>spring</generatorName>
                <apiPackage>com.example.app.api</apiPackage>
                <modelPackage>com.example.app.api.model</modelPackage>
                <output>${project.build.directory}/generated-sources/openapi</output>
                <configOptions>
                    <delegatePattern>true</delegatePattern>
                    <skipDefaultInterface>true</skipDefaultInterface>
                    <useSpringBoot3>true</useSpringBoot3>
                    <useTags>true</useTags>
                    <dateLibrary>java8</dateLibrary>
                    <openApiNullable>false</openApiNullable>
                </configOptions>
            </configuration>
        </execution>
    </executions>
</plugin>
```

- `useSpringBoot3=true` is still the flag for Jakarta / Spring 6+ generation despite the name. Without it you get `javax.*` imports that will not compile.
- `delegatePattern=true` generates an interface you implement, leaving the generated controller untouched.
- `skipDefaultInterface=true` - otherwise the generated interface has default methods returning 501 and a missing implementation compiles silently.
- Generate into `target/`, never into `src/`. Add it to `.gitignore` and let the build produce it.

The generator's Spring templates lag Boot releases. Verify the generated code compiles against your Boot version before committing to this approach.

### Implement the delegate

```java
@Service
class OrdersApiDelegateImpl implements OrdersApiDelegate {

    private final OrderService orderService;

    OrdersApiDelegateImpl(OrderService orderService) {
        this.orderService = orderService;
    }

    @Override
    public ResponseEntity<OrderResponse> createOrder(CreateOrderRequest request) {
        var id = orderService.place(OrderApiMapper.toCommand(request));
        return ResponseEntity.created(URI.create("/api/orders/" + id.value()))
                .body(OrderApiMapper.toResponse(orderService.getById(id)));
    }
}
```

**Generated models are not domain models.** Map at this boundary. Letting a generated class reach the service means regenerating the spec refactors your domain.

### Keeping the spec honest

Spec-first only works if the spec is authoritative. Enforce it:

- Lint it in CI (Spectral or the generator's `validate` goal) before generating.
- Never edit generated code - the next build discards it.
- Review spec changes like API changes, because they are.

## If on Boot 3.5.x

**springdoc's major line is tied to the Spring generation**, so this is a real version constraint rather than a cosmetic one - a springdoc built for Spring Framework 6 will not work on Framework 7, and the reverse. Check springdoc's compatibility matrix for your Boot line; it is not BOM-managed, so nothing in the build will warn you.

Everything else is the same. The generated spec is produced by Jackson 2 on 3.5.x, which does not change the schema. For spec-first, the OpenAPI Generator's Spring templates target a Spring generation too - verify the generated code compiles against your Boot version.

## Gotchas

- Agent adopts spec-first for a single-team API - code-first with springdoc is less machinery and cannot drift
- Agent pins a springdoc version that does not match the Boot line - check the compatibility matrix; it is not BOM-managed
- Agent annotates every field with `@Schema` - springdoc infers types and validation constraints already
- Agent documents errors as a bespoke object - document `ProblemDetail`
- Agent leaves Swagger UI enabled in production - ship the spec, disable the UI
- Agent adds `/v3/api-docs` to `permitAll` without thinking - that publishes the full API surface anonymously
- Agent lets a `@JsonValue` value object document as an object - the schema then contradicts the payload
- Agent omits `useSpringBoot3=true` - generates `javax.*` imports that do not compile
- Agent omits `skipDefaultInterface=true` - a missing implementation compiles and returns 501 at runtime
- Agent commits generated sources - generate into `target/` and gitignore them
- Agent edits generated controllers - implement the delegate; edits are lost on the next build
- Agent passes generated models into the service layer - map at the delegate

## Related

- [rest-controllers.md](rest-controllers.md) · [validation.md](validation.md) · [error-handling.md](error-handling.md) · [api-versioning.md](api-versioning.md) · [security-fundamentals.md](security-fundamentals.md)
