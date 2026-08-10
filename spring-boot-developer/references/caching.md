# Caching

Start with Spring's cache **abstraction**, not with a Redis client. `@Cacheable` is store-agnostic: the same code runs against an in-process map in tests and Redis in production, and swapping the store is a dependency change.

Before adding a cache, confirm the read is actually hot and actually slow. A cache adds an invalidation problem, a consistency window and a new failure mode. An index is often the real answer.

## Enable it

```java
@Configuration
@EnableCaching
class CacheConfig {
}
```

Without `@EnableCaching`, every `@Cacheable` silently does nothing - the method just runs. There is no warning.

## The annotations

```java
@Service
@Transactional(readOnly = true)
public class ProductService {

    @Cacheable(cacheNames = "products", key = "#id")
    public ProductResponse getById(ProductId id) {
        return ProductResponse.from(productRepository.getById(id));
    }

    @CachePut(cacheNames = "products", key = "#result.id()")
    @Transactional
    public ProductResponse rename(ProductId id, String name) {
        var product = productRepository.getById(id);
        product.rename(name);
        return ProductResponse.from(product);
    }

    @CacheEvict(cacheNames = "products", key = "#id")
    @Transactional
    public void delete(ProductId id) {
        productRepository.deleteById(id);
    }
}
```

| Annotation | Behaviour |
|---|---|
| `@Cacheable` | Return the cached value if present, otherwise run the method and cache the result |
| `@CachePut` | Always run the method, then overwrite the cache entry |
| `@CacheEvict` | Remove the entry |
| `@Caching` | Combine several of the above on one method |

`@Cacheable` and `@CachePut` on the same method is a contradiction - the first tries to skip the call, the second insists on it.

**Cache DTOs, never entities.** A cached entity is detached, carries uninitialised lazy proxies that will throw when touched, and pins a graph of objects in memory. Every example above caches a `ProductResponse`.

Caching is proxy-based, so a self-invoked call is never cached - see [spring-proxies-and-di.md](spring-proxies-and-di.md).

### Cache and transaction ordering

`@CacheEvict` runs when the method returns, **before** the transaction commits. If the commit then fails, the cache has been evicted for a change that never happened - self-correcting, since the next read repopulates from the database.

The dangerous direction is `@CachePut`: it can publish a value that the rollback then discards, leaving the cache holding data that does not exist. Where correctness matters, evict after commit instead:

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
void onProductChanged(ProductChanged event) {
    cacheManager.getCache("products").evict(event.productId());
}
```

See [transactions.md](transactions.md).

## Keys

The default key is derived from all the method parameters, which is fragile - adding a parameter silently changes every key and invalidates the whole cache.

**Always set `key` explicitly.** Use SpEL against parameter names:

```java
@Cacheable(cacheNames = "orders-by-customer", key = "#customerId.value()")
@Cacheable(cacheNames = "products", key = "#id.value() + ':' + #locale")
```

Keys must be stable and short. A key derived from a value object needs a stable `toString()`/accessor, not the record's default `toString()` which includes the component name.

For Redis, name caches so the keyspace is browsable and one application cannot collide with another:

```
{app}:{cache}:{id}          orders:product:9f2c8b1e-…
{app}:{cache}:{filter}      orders:product-list:status:ACTIVE
```

## TTL - always

An entry with no expiry is a memory leak with a consistency bug attached. Set a default and override per cache:

```yaml
spring:
  cache:
    type: redis
    redis:
      time-to-live: 10m
      cache-null-values: false
      key-prefix: "orders:"
      use-key-prefix: true
```

`cache-null-values: false` stops a miss being cached as a `null`. The trade-off is real: caching negatives protects the database from a hammering on a non-existent key. Cache them deliberately, with a *short* TTL, only when that attack or pattern is a genuine concern.

## Redis

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

Boot auto-configures a `RedisCacheManager` when Redis is on the classpath and `spring.cache.type=redis`. Configure per-cache TTLs only when the defaults are not enough:

```java
@Bean
RedisCacheManagerBuilderCustomizer cacheCustomizer() {
    return builder -> builder
            .withCacheConfiguration("products",
                    RedisCacheConfiguration.defaultCacheConfig().entryTtl(Duration.ofHours(1)))
            .withCacheConfiguration("order-summaries",
                    RedisCacheConfiguration.defaultCacheConfig().entryTtl(Duration.ofMinutes(2)));
}
```

Use the customizer rather than declaring your own `RedisCacheManager` bean - replacing the bean discards Boot's configuration, exactly as with the JSON mapper ([json-and-jackson.md](json-and-jackson.md)).

### Serialization

**Never use Java serialization** - the default for a raw `RedisTemplate<String, Object>`. It is unreadable, brittle across deployments, and a deserialisation gadget vector. Use JSON.

Deserialising back to the real type requires type information in the payload. Scope it to your own packages and never enable it globally:

```java
@Bean
RedisCacheConfiguration cacheConfiguration() {
    var validator = BasicPolymorphicTypeValidator.builder()
            .allowIfSubType("com.example.app.")
            .allowIfSubType("java.util.")
            .build();

    var serializer = GenericJacksonJsonRedisSerializer.builder()
            .enableDefaultTyping(validator)
            .build();

    return RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(10))
            .disableCachingNullValues()
            .serializeValuesWith(SerializationPair.fromSerializer(serializer));
}
```

Without default typing, a cached object comes back as a `LinkedHashMap` and throws `ClassCastException` on first use. With *unrestricted* default typing, you have a remote code execution vector. The validator is the point.

On Boot 4 this is `GenericJacksonJsonRedisSerializer` (Jackson 3). On 3.5.x it is `GenericJackson2JsonRedisSerializer`.

A simpler alternative that avoids the whole question: serialise each cache to a **known type** with `Jackson2JsonRedisSerializer<>(ProductResponse.class)` per cache. More configuration, no polymorphic typing, no validator to get wrong.

### Connection settings

```yaml
spring:
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
      password: ${REDIS_PASSWORD:}
      timeout: 2s
      connect-timeout: 1s
      lettuce:
        pool:
          max-active: 16
          max-idle: 8
          min-idle: 2
```

Set timeouts. A Redis instance that stops responding without a timeout turns a cache into an outage - every request blocks on it.

Decide what happens when Redis is down. By default a cache failure propagates as an exception and the request fails, which is usually the wrong answer for a cache. Supply a `CacheErrorHandler` that logs and falls through to the database.

## Stampede

When a hot key expires, every concurrent request misses simultaneously and all of them recompute the same value.

```java
@Cacheable(cacheNames = "products", key = "#id.value()", sync = true)
public ProductResponse getById(ProductId id) { … }
```

`sync = true` lets one caller compute while the others wait - **per instance**. Across a fleet you still get one recomputation per instance; for a genuinely expensive value, add a short distributed lock (`SET key value NX EX 30`) around the recompute.

Add jitter to TTLs so a batch of keys written together does not expire on the same second.

## Local caching

For data that is small, read-mostly and tolerant of a few seconds of staleness, an in-process cache beats a network round trip:

```xml
<dependency>
    <groupId>com.github.ben-manes.caffeine</groupId>
    <artifactId>caffeine</artifactId>
</dependency>
```

```yaml
spring:
  cache:
    type: caffeine
    caffeine:
      spec: maximumSize=1000,expireAfterWrite=5m
```

Each instance holds its own copy, so evictions are not shared - a change on one instance is invisible to the others until their entries expire. Acceptable for reference data, not for anything a user just edited.

Because the abstraction is the same, this is a configuration change and not a code change. That is the argument for using `@Cacheable` rather than a Redis client directly.

## HTTP caching

Sometimes the right cache is the client's. An `ETag` plus a 304 avoids serialising and transferring the body entirely:

```java
@Bean
FilterRegistrationBean<ShallowEtagHeaderFilter> etagFilter() {
    return new FilterRegistrationBean<>(new ShallowEtagHeaderFilter());
}
```

It still executes the handler, so it saves bandwidth rather than work. `ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)))` on genuinely public, stable resources saves both.

## If on Boot 3.5.x

The abstraction, all four annotations, `sync = true`, Caffeine and the Redis properties are identical. The differences are Jackson 2: `GenericJackson2JsonRedisSerializer` rather than `GenericJacksonJsonRedisSerializer`, and `ObjectMapper` rather than `JsonMapper`. Spring Session keys also moved - `spring.session.redis.*` on 3.5.x became `spring.session.data.redis.*`.

## Gotchas

- Agent omits `@EnableCaching` - every `@Cacheable` silently does nothing
- Agent caches an entity - detached, with lazy proxies that throw when touched; cache a DTO
- Agent relies on the default cache key - adding a parameter silently invalidates everything; set `key` explicitly
- Agent sets no TTL - a memory leak plus permanently stale data
- Agent uses Java serialization for Redis values - brittle and a deserialisation gadget vector; use JSON
- Agent enables Jackson default typing without a `PolymorphicTypeValidator` - remote code execution vector
- Agent omits default typing entirely - cached values return as `LinkedHashMap` and throw `ClassCastException`
- Agent uses `GenericJackson2JsonRedisSerializer` on Boot 4 - that is the Jackson 2 class
- Agent declares its own `RedisCacheManager` bean - use `RedisCacheManagerBuilderCustomizer` or Boot's defaults are lost
- Agent calls a `@Cacheable` method on `this` - proxy bypassed, nothing is cached
- Agent puts `@Cacheable` and `@CachePut` on the same method - they contradict each other
- Agent evicts inside the transaction where correctness matters - evict after commit
- Agent sets no Redis timeout - an unresponsive cache becomes a full outage
- Agent lets a Redis failure fail the request - add a `CacheErrorHandler` that falls through to the source
- Agent leaves a hot key unprotected - use `sync = true`, plus a distributed lock if the recompute is expensive
- Agent gives every entry an identical TTL - add jitter so they do not expire together
- Agent uses Caffeine for data that must be consistent across instances - local caches do not share evictions

## Related

- [transactions.md](transactions.md) · [spring-proxies-and-di.md](spring-proxies-and-di.md) · [json-and-jackson.md](json-and-jackson.md) · [observability.md](observability.md) · [configuration.md](configuration.md)
