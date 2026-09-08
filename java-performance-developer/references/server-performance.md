# Servers and Remote Calls

**This file owns the performance reasoning: thread models, pool sizing, connection reuse, payload cost.** Framework configuration - Spring Boot properties, Actuator, `WebClient`, `@Async` - belongs to [`spring-boot-developer`](../../spring-boot-developer/SKILL.md).

| Concern | Rule |
| ------- | ---- |
| **Connection reuse** | Always. Opening a connection, especially TLS, dominates a short request |
| **Client object reuse** | Always. One shared `HttpClient`; they are thread-safe and expensive |
| **Worker pool size** | Enough for simultaneously executing **plus** simultaneously blocked |
| **Selector threads** | A few - three is a common default. They must not be the bottleneck |
| **Payload size** | Compress, and strip whitespace. Measured 60× on a slow link |
| **Interface granularity** | Coarse. Round trips cost more than bytes, up to a point |
| **Overload** | Reject fast with 429/503. Never queue unboundedly |

---

## Why non-blocking I/O matters

With blocking I/O a thread issuing `read()` on a socket waits until data arrives - and there is no way to know whether data is available without attempting the read. So a server must dedicate **one thread per connection**, whether or not that connection is doing anything.

The arithmetic is brutal. 100 clients, 30-second think time, 500 ms to process a request: fewer than **two** requests are in flight on average, yet the server needs **100 threads**. At 1 MB of stack each on Java 8 that is 100 MB of committed memory to do the work of two threads. HTTP keep-alive makes it worse, because connections stay open precisely to avoid reconnect cost.

Non-blocking I/O breaks the coupling. Sockets register with a `Selector`; the OS notifies it when data is readable; a worker thread from a pool handles that request and returns to the pool. **N clients are served by M threads, where M is sized to concurrent *requests* rather than concurrent *connections*.** In the example above, two to six threads suffice.

This is what every modern server does - Tomcat, Jetty, Undertow, Netty, Vert.x - and what frameworks built on Netty (Spring WebFlux, Helidon) extend further up the stack. Reactive programming is a *programming model* over the same mechanism; from a performance standpoint the benefit is identical, which is worth remembering when someone proposes a reactive rewrite for speed.

---

## Sizing server pools

Frameworks arrange selector and worker threads differently - separate pools, a shared pool, or workers that take turns selecting - but two things hold regardless.

**Worker threads: enough for those simultaneously executing plus those simultaneously blocked.** The full derivation is in [concurrency-performance.md](concurrency-performance.md); applied to a server:

| Server does | Threads needed |
| ----------- | -------------- |
| Pure CPU work | ≈ CPU count. More cannot help |
| **Blocking** outbound calls | CPU count + concurrent blocked calls |
| **Non-blocking** outbound calls | ≈ CPU count again - nothing is pinned while waiting |

Worked: two CPUs, 900 ms in the database, 100 ms of processing. The CPU supports 20 requests/second and ~20 are blocked at any moment, so **20 threads with a blocking client, 2 with a non-blocking one**. That is the entire performance argument for non-blocking clients - not that each call is faster, but that fewer threads are pinned.

**Selector threads: more than one, and only a few.** A selector calls `select()`, then must process the result. While it does, another selector should be calling `select()` for other sockets. Three is a common default and usually right. Where the same pool does both, add a few threads beyond the worker calculation.

**Do not default to a large pool because framework defaults are large.** A default of 16 or 32 threads on four CPUs is a reasonable compromise for unknown workloads - a slight penalty for CPU-bound work, a large gain for blocking work. Once you know which yours is, size it.

---

## Deferring work to a second pool

JAX-RS asynchronous responses, Netty event executors and similar let a request hand off to another pool and free the request thread:

```java
private final ThreadPoolExecutor async = new ThreadPoolExecutor(
    64, 64, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(128));

@GET @Path("/sleep")
public void endpoint(@QueryParam("delay") long delay, @Suspended AsyncResponse ar) {
  async.execute(() -> {
    doWork(delay);
    ar.resume(result());     // the request thread was released long ago
  });
}
```

**On its own this achieves nothing** - it is equivalent to enlarging the request pool, and slightly worse, since the hand-off costs a few milliseconds. Oaks' measurement: a Helidon server with a 32-thread default and a 100 ms endpoint served 32 concurrent requests at 100 ms each; 64 concurrent requests took 200 ms each. Deferring to a 64-thread pool fixed that exactly as resizing the default pool to 64 would have.

Three reasons it *is* worth doing:

1. **Parallelism inside one request.** Three unrelated JDBC calls can run concurrently instead of serially - the same problem `StructuredTaskScope` solves on 21+.
2. **Limiting active threads** while keeping request acceptance responsive.
3. **Throttling properly** - the one that matters most, below.

### Reject fast under overload

Most servers queue pending requests in an unbounded (or very large) queue. Under overload that converts into unbounded latency: a request queued for three seconds is worthless - the user has gone - and it still consumes a thread when it finally runs.

```java
@GET @Path("/work")
public void endpoint(@Suspended AsyncResponse ar) {
  if (async.getActiveCount() >= MAX_ACTIVE) {
    ar.cancel();          // → HTTP 503 immediately
    return;
  }
  async.execute(() -> { ... });
}
```

**Returning 429 or 503 immediately is the correct behaviour for an overloaded server**, and it is what stops the death spiral: shedding load reduces the load, which lets the server recover. A bounded queue with a rejection handler is the more robust form of the same idea. See [concurrency-performance.md](concurrency-performance.md).

---

## Outbound HTTP clients

Two rules, and both are about reuse.

### Share one client object

```java
private static final HttpClient CLIENT = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(2))
    .build();                                    // ONE per application
```

**Every HTTP client object is thread-safe and expensive to construct.** Creating one per request is a common and costly mistake. `HttpURLConnection` is the exception - it cannot be reused, being a per-request object.

### Pool connections, and understand the pooling

Opening a socket is expensive; a TLS handshake is much more so. Reuse is essential - and the pooling behaviour is widely misunderstood.

| Client | Pooling | Configure with |
| ------ | ------- | -------------- |
| `HttpURLConnection` (8+) | 5 per server by default | `-Dhttp.maxConnections=N` |
| `java.net.http.HttpClient` (11+) | Unbounded by default, **per client object** | `-Djdk.httpclient.connectionPoolSize=N` |
| Apache `HttpClient` | Explicit | `PoolingHttpClientConnectionManager` |
| Jetty / Netty-based | Pooled by default | Client configuration |

**Two traps.**

`HttpURLConnection` *does* pool - five connections per destination - but **it does not throttle**. Ask for a sixth and it creates one, then destroys it when you are done. So you see a stream of transient connections and reasonably conclude pooling is broken. It is not; it is unbounded above the pooled five. The Javadoc never mentions the pooling, which does not help. Despite the name, `http.maxConnections` applies to HTTPS too.

`java.net.http.HttpClient`'s pool is **per client object**. Create a client per request and you get no pooling at all, however you configure it - which compounds the first rule.

### Asynchronous clients

An async client hands response processing to another thread. Two very different implementations hide behind the same API, and the difference is invisible at the call site:

- **Blocking under the hood** - a background thread is pinned per in-flight request. You gain concurrency by adding threads. The JAX-RS default connector and the Jersey Apache connector work this way.
- **Genuinely non-blocking (NIO)** - a few threads handle selection and response processing for many requests. Grizzly and Jetty connectors work this way.

Both look asynchronous. Only the second improves thread scalability, and that is the whole point of choosing one. Oaks' aggregator example - one request fanning out to three services - needed one thread per request with the blocking client and completed with fewer than three threads on the non-blocking one, for identical user-visible latency.

**Even a fully non-blocking server needs a fair number of threads**, because business logic between the I/O still needs CPU. A REST server is not nginx serving static files; do not size it as if it were.

Where these pools are unbounded (Jersey's `jersey-client-async-executor` is, by default), bound them:

```java
var cc = new ClientConfig();
cc.property(ClientProperties.ASYNC_THREADPOOL_SIZE, 64);
```

### Asynchronous database access

There is no non-blocking standard JDBC, and proposals for one were rejected. **Wrapper libraries that "make JDBC async" defer the blocking call to a background pool** - the API looks asynchronous, a thread is still pinned, and no scalability is gained. Recognise this pattern rather than adopting it for performance.

Genuine options: **R2DBC** (a different API, drivers for some databases), reactive NoSQL drivers, or - on 21+ - **virtual threads, which make blocking JDBC scale acceptably without a new API**. That last is the outcome Project Loom was aiming at, and for most applications it is now the right answer: keep JDBC, keep blocking code, run it on virtual threads. See [concurrency-performance.md](concurrency-performance.md) and [database-performance.md](database-performance.md).

---

## Payload size

The most under-measured factor, because tests usually run on a fast LAN and users do not.

Oaks measured a ~100 KB HTML response, one user, 100 ms think time:

| Optimisation | LAN | Broadband | Public WiFi |
| ------------ | --- | --------- | ----------- |
| None | 20 ms | 26 ms | **1,003 ms** |
| Whitespace removed | 20 ms | 10 ms | **43 ms** |
| Output compressed | **30 ms** | **5 ms** | **17 ms** |

**Read the columns against each other.** On the LAN, compression made things *worse* - 30 ms against 20 ms - because CPU cost exceeded transmission savings. On public WiFi it was **60× better**. A LAN-only test would have concluded compression is harmful and left 98% of the real improvement unrealised.

**Test on the network your users actually have**, or emulate it. This is the single strongest argument in this file for realistic test environments.

Practical measures:

- **Compress**, where the client advertises support. Most servers do this conditionally and above a size threshold, which is right - compressing a 200-byte response is pure loss.
- **Strip whitespace** from generated markup. Tomcat and derivatives have `trimSpaces` for JSP.
- **Combine CSS and JavaScript** - fewer requests, and each costs a round trip.
- **Log numerically**: IP addresses not hostnames, epoch timestamps not formatted dates. A reverse DNS lookup per request is a network round trip on the request path. See [exceptions-and-logging.md](exceptions-and-logging.md).

---

## Coarse or chatty?

Two rules in direct tension: **send less data** and **make fewer calls**. Round-trip setup cost is fixed and often dominates.

Oaks measured a REST service over broadband:

| Scenario | Response time | Data |
| -------- | ------------- | ---- |
| 1 year of data | 90 ms | 30 KB |
| 1-year summary only | 30 ms | 60 B |
| 5 years of data | 300 ms | 186 KB |
| 2 summary requests | 60 ms | 2 × 60 B |
| 10 summary requests | 280 ms | 10 × 60 B |

**Ten 60-byte calls (280 ms) cost as much as one 186 KB call (300 ms).** The bytes were irrelevant; the round trips were everything. Returning a full year (90 ms) beats three summary calls (90 ms) while providing far more - so if the client is likely to need three pieces, send everything at once.

**Caching changes the crossover.** With the response already marshalled:

| Scenario | Uncached | Cached |
| -------- | -------- | ------ |
| 1 year | 90 ms | **50 ms** |
| 5 years | 300 ms | **90 ms** |
| 10 summaries | 280 ms | 270 ms |

Marshalling was most of the cost for large responses, and none of it for small ones. **Once responses are cached, sending "too much" data is nearly free**, and the balance tips decisively towards coarse interfaces.

**Design coarse**, and revisit if payloads become genuinely large on slow links.

---

## JSON and XML processing

Choose the technique by how the application needs to use the data, not by benchmark ranking. Rough order slowest to fastest:

| Technique | Gives you | Cost |
| --------- | --------- | ---- |
| **Object mapping** (POJOs, JSON-B, JAXB) | Ordinary Java objects | Highest - reflection, proxies, allocation |
| **Document model** (`JsonObject`, DOM) | A navigable tree, format preserved | Moderate |
| **Pull parser** (`JsonParser`, StAX) | A token stream | Lowest |

Oaks measured the same 100-item document:

| Model | Marshal |
| ----- | ------- |
| Generic JSON object | 2,318 µs |
| JSON-B POJO classes | 7,071 µs |
| **Jackson `ObjectMapper`** | **1,549 µs** |

And parsing directly:

| Items | Default parser | Jackson parser |
| ----- | -------------- | -------------- |
| 10 (then stop) | 159 µs | **86 µs** |
| 100 (all) | 1,662 µs | **770 µs** |

Three conclusions:

1. **Jackson is consistently fastest** and has effectively won this space. Prefer it over reference implementations.
2. **Direct parsing beats object mapping by roughly an order of magnitude** where the application only needs a scan, or needs to filter.
3. **Filtering compounds it.** Processing 10 of 100 items took ~10% of the time - the parser simply stops.

**Reuse factories; do not reuse parsers.** Factories are expensive and thread-safe - hold one in a static field. Parsers are cheap and *not* thread-safe - create per use.

**One `ObjectMapper` per application.** It builds proxy classes and reflective metadata on first use per type. Creating one per class, or per request, is a well-known cause of memory pressure, excessive GC and `OutOfMemoryError` - and it is a common mistake because the object looks lightweight.

The historical lesson from XML is worth keeping: the JDK once searched the entire classpath for a `META-INF/services` entry on **every factory creation**, which on a long classpath was ruinous. Specifying the factory by system property avoided it. Modern JSON libraries do not have that defect, but it is why factory creation is still worth doing once.

---

## Version notes

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| `java.net.http.HttpClient` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `HttpURLConnection` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `jdk.SocketRead` / `SocketWrite` JFR events | ✗ | ✓ | ✓ | ✓ | ✓ |
| Virtual threads for thread-per-request | ✗ | ✗ | ✗ | ✓ | ✓ |
| `StructuredTaskScope` for in-request fan-out | ✗ | ✗ | ✗ | preview | preview |
| `Thread.vthread_pollers` (I/O poller state) | ✗ | ✗ | ✗ | ✗ | **✓** |

**Virtual threads change the architecture of this file.** On 21+, thread-per-request is viable again: one virtual thread per request, blocking code throughout, and no reactive rewrite. `spring.threads.virtual.enabled=true` in Spring Boot is a one-property change (**off by default**), and the measured effect on a 1,000-user load test against a 1-second endpoint was worst-case latency falling from ~5 s to ~1 s.

Two caveats that keep this file relevant rather than obsolete:

- **Virtual threads speed up *concurrent requests*, not a serial fan-out inside one request.** Three sequential outbound calls take exactly as long. That is what `StructuredTaskScope` is for.
- **On 21-23, a blocking call inside `synchronized` pins its carrier**, capping concurrency at the carrier count. Fixed in 24. Check driver, client and pool libraries for internal `synchronized` blocks around I/O. See [concurrency-performance.md](concurrency-performance.md).

## Gotchas

- Agent creates an HTTP client object per request - thread-safe and expensive; share one, and `HttpClient`'s pool is per client object
- Agent concludes `HttpURLConnection` does not pool because it sees transient connections - it pools five per destination and does not throttle above that
- Agent sizes a server pool to the CPU count while making blocking outbound calls - needs the blocked ones too
- Agent adds threads to a client whose server is already saturated - measured up to 9× worse response time ([concurrency-performance.md](concurrency-performance.md))
- Agent uses one selector thread - while it processes results, nothing is selecting
- Agent defers work to a second pool and expects a gain by itself - equivalent to resizing the first pool, and slightly worse
- Agent leaves the request queue unbounded - unbounded latency; reject with 429/503 instead
- Agent adopts an "async" JDBC wrapper for scalability - it pins a background thread; use R2DBC or virtual threads
- Agent assumes an async HTTP client is non-blocking - many pin a thread per request; only NIO-based ones scale
- Agent expects a non-blocking server to need very few threads - business logic still needs CPU
- Agent tests only on a LAN - compression measured *worse* on LAN and 60× better on public WiFi
- Agent compresses tiny responses - pure cost; use a size threshold
- Agent designs fine-grained remote interfaces - ten 60-byte calls measured as expensive as one 186 KB call
- Agent optimises payload size before checking whether responses are cached - marshalling was most of the cost
- Agent maps JSON to POJOs when only a scan is needed - direct parsing is roughly an order of magnitude cheaper
- Agent creates an `ObjectMapper` per class or per request - builds proxies and metadata each time; a known OOM cause
- Agent reuses a parser across threads - factories are thread-safe, parsers are not
- Agent resolves hostnames in an access log - a network round trip on the request path
- Agent enables virtual threads and expects a serial fan-out to speed up - it will not; use `StructuredTaskScope`
- Agent enables virtual threads on 21-23 with `synchronized` around blocking I/O - pins the carrier and caps concurrency

## Related

- [concurrency-performance.md](concurrency-performance.md) · [database-performance.md](database-performance.md) · [io-performance.md](io-performance.md) · [triage.md](triage.md) · [exceptions-and-logging.md](exceptions-and-logging.md) · [containers.md](containers.md) · [methodology.md](methodology.md) · [`spring-boot-developer`](../../spring-boot-developer/SKILL.md)
