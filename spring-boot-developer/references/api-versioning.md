# API Versioning

Spring Framework 7 routes by API version in the mapping layer. On Boot 4, never hand-roll versioning with duplicated `V1`/`V2` controllers, a custom `RequestCondition`, or header sniffing in a filter.

## Version the mapping, not the controller

```java
@RestController
@RequestMapping("/api/orders")
class OrderController {

    @GetMapping("/{id}")                              // unversioned - matches any version
    OrderResponse getById(@PathVariable OrderId id) { … }

    @GetMapping(path = "/{id}", version = "1.1")      // exactly 1.1
    OrderResponseV1_1 getByIdV1_1(@PathVariable OrderId id) { … }

    @GetMapping(path = "/{id}", version = "1.2+")     // 1.2 and every supported version above
    OrderResponseV2 getByIdV2(@PathVariable OrderId id) { … }
}
```

- The value is a **semantic version string**: `"1.0"`, not `1`.
- A `+` suffix is a baseline - the mapping handles that version and everything newer.
- The most specific match wins.
- One handler per version of one endpoint. Only the endpoints that actually changed get a second handler; the rest stay unversioned.

That last point is the reason to prefer this over duplicated controllers: a `V2` controller forces you to copy all twenty endpoints to change one.

## Pick exactly one resolution strategy

```java
@Configuration
class ApiVersionConfig implements WebMvcConfigurer {

    @Override
    public void configureApiVersioning(ApiVersionConfigurer configurer) {
        configurer
                .useRequestHeader("API-Version")
                .setDefaultVersion("1.0")
                .addSupportedVersions("1.0", "1.1", "1.2");
    }
}
```

Or in configuration:

```yaml
spring:
  mvc:                          # WebFlux: the same keys under spring.webflux.apiversion.*
    apiversion:
      use:
        header: API-Version
        # path-segment: 1       # /api/v1.1/orders - index of the segment holding the version
        # query-parameter: version
        # media-type-parameter: version
      supported: [1.0, 1.1, 1.2]
      default: 1.0
```

Four sources exist - request header, path segment, query parameter, media-type parameter. **Choose one and keep it.** Two sources means a request can carry two versions and nobody can say which wins.

| Strategy | Use when |
|---|---|
| Request header | Default choice. URLs stay stable, the version is out of the resource identity |
| Path segment | The version must be visible in a URL people paste, log or bookmark |
| Query parameter | Easiest to try in a browser. Mixes a version into the resource identity, which harms caching |
| Media-type parameter | Strict REST. Correct, and painful for most clients |

Keep the strategy in Java configuration when the behaviour must be explicit and reviewable; properties are fine for a simple setup.

## Defaults and required versions

Versioning is **required** unless you configure a default or call `setVersionRequired(false)`. With neither, an unversioned request gets a 400.

| Situation | Exception | Status |
|---|---|---|
| Version not in the supported list | `InvalidApiVersionException` | 400 |
| No version and none defaulted | `MissingApiVersionException` | 400 |

Both flow through `ResponseEntityExceptionHandler`, so they emit `ProblemDetail` - see [error-handling.md](error-handling.md).

Set a default when you are adding versioning to an API that already has clients. Without one, every existing caller breaks the day you deploy.

## Deprecating a version

```java
@Override
public void configureApiVersioning(ApiVersionConfigurer configurer) {
    var deprecation = new StandardApiVersionDeprecationHandler();
    deprecation.configureVersion("1.0")
            .setDeprecationDate(ZonedDateTime.parse("2026-09-01T00:00:00Z"))
            .setSunsetDate(ZonedDateTime.parse("2027-01-01T00:00:00Z"))
            .setDeprecationLink(URI.create("https://docs.example.com/api/v1-sunset"));

    configurer.useRequestHeader("API-Version")
            .setDeprecationHandler(deprecation);
}
```

Emits the RFC 9745 `Deprecation` and `Sunset` headers plus a `Link` to the migration notes. Do not invent your own sunset header - clients and gateways already understand these.

## Clients send versions too

If you call a versioned API, configure the outbound side to match the server's strategy:

```java
RestClient.builder()
        .apiVersionInserter(ApiVersionInserter.fromHeader("API-Version").build())
        .defaultApiVersion("1.2")
        .build();
```

Works on `RestClient`, `WebClient` and HTTP interface clients - see [http-clients.md](http-clients.md).

## When to add a version at all

Adding a version is expensive: every version is a contract you support until sunset. Most changes do not need one.

| Change | Needs a version |
|---|---|
| Adding an optional response field | No - tolerant readers ignore it |
| Adding an optional request field | No |
| Adding an endpoint | No |
| Renaming or removing a response field | Yes |
| Making an optional request field required | Yes |
| Changing a field's type or meaning | Yes |
| Changing the error contract | Yes |

Prefer expanding the current version over minting a new one. When you must version, version the **representation**, not the whole API - one changed endpoint, one new handler.

## If on Boot 3.5.x

The `version` mapping attribute and `ApiVersionConfigurer` **do not exist** on Framework 6. Options, best first:

1. **Do not version yet.** Expand compatibly for as long as you can.
2. **Path prefix with separate controllers**: `/api/v1/orders`, `/api/v2/orders`. Explicit and testable. Keep the service layer version-free - controllers map their own version's payloads onto one shared command and result. The cost is a duplicated controller per version.
3. **Header-based routing by hand** with a custom `RequestCondition`. Works, but it is the machinery Framework 7 replaced; avoid on new code.

Whichever you pick, keep the version at the web boundary. A version that reaches a service or repository has escaped.

## Gotchas

- Agent hand-rolls `/v1` and `/v2` controllers on Boot 4 - use the `version` mapping attribute
- Agent writes `version = 1` - it is a semantic version `String`, `"1.0"`
- Agent configures two resolution sources - pick one
- Agent enables versioning with no default and no `setVersionRequired(false)` - every existing client gets a 400
- Agent invents `X-Sunset` or similar - use `StandardApiVersionDeprecationHandler` for RFC 9745 headers
- Agent duplicates all endpoints for one changed representation - version the mapping that changed
- Agent leaks the version into the service layer - version at the web boundary only
- Agent uses the Boot 4 `version` attribute on a 3.5.x project - it does not exist on Framework 6
- Agent versions a purely additive change - adding an optional field does not need a new version
- Agent forgets to configure the version on outbound clients - the server rejects the call as unversioned

## Related

- [rest-controllers.md](rest-controllers.md) · [error-handling.md](error-handling.md) · [http-clients.md](http-clients.md) · [openapi.md](openapi.md)
