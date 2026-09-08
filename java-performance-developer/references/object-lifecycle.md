# Object Lifecycle Management

When to deliberately defeat the garbage collector, and - more often - when not to. This is the counterweight to [allocation.md](allocation.md): that file says allocate less and discard sooner, this one covers the cases where keeping objects alive wins despite the GC cost.

| Technique | Verdict |
| --------- | ------- |
| **Thread-local reuse** | **The best option when a per-thread object fits.** No return step, no contention |
| **Object pool** | Only for expensive-to-initialise objects, only in small numbers, or as a throttle |
| **Soft references** | A GC-friendly LRU cache. Needs `SoftRefLRUPolicyMSPerMB` tuning to behave |
| **Weak references** | Only when the object is strongly held *elsewhere* and you want to find it |
| **`Cleaner`** | The correct backstop for native resources (9+) |
| **`finalize()`** | **Never.** Deprecated for removal, and worse for GC than any other reference type |
| **Phantom references** | Rarely by hand - `Cleaner` is built on them and is easier |

**The default remains: create objects, let them die young.** Everything here is an exception requiring justification.

---

## Why reuse hurts the collector

Reuse conflicts directly with the generational design. A pooled object survives young collections, gets copied between survivor spaces, is promoted, and then **stays in the old generation permanently** - where it lengthens every subsequent collection.

**Full GC duration is proportional to surviving data, not to heap size.** Oaks measured a 4 GB heap:

| Situation | Full GC duration |
| --------- | ---------------- |
| Old generation nearly all live | 540-730 ms |
| Old generation mostly collectable | **70 ms** |

**An order of magnitude, from the same heap.** And on a single CPU the gap was 2,410 ms against 80 ms - 30×. So a large pool does not merely occupy memory; it makes every collection slower for the life of the process.

That is why GC engineers dislike object pools, and why the bar for one is high.

---

## What is genuinely worth reusing

The test is **expensive to initialise**, not expensive to allocate. Allocation in Java is a pointer bump ([allocation.md](allocation.md)); initialisation can be arbitrarily expensive. And the count must stay small.

What the JDK and well-built applications actually reuse:

| Object | Why |
| ------ | --- |
| **Threads** | Creation is expensive, and the pool doubles as a throttle |
| **JDBC connections** | Network connect, authentication, session setup |
| **`SecureRandom` / `Random`** | Seeding is expensive - see the measurement below |
| **`MessageDigest`, `Signature`, `Cipher`** | Algorithm lookup and initialisation |
| **Direct `ByteBuffer`s** | `allocateDirect` is costly regardless of size |
| **Large arrays** | Java zero-fills every element on allocation |
| **`NumberFormat`, `DateFormat`** | Internationalisation setup; also not thread-safe |
| **JAXB / Jackson `ObjectMapper`** | Builds proxies and reflective metadata on first use |
| **DNS lookups** | Network round trip |
| **`Inflater` / `Deflater`** | Cheap to create, **expensive to free** - native memory via `Cleaner` |

The `Inflater`/`Deflater` case is the odd one: they are pooled not for construction cost but because releasing their native memory depends on the collector running. See [native-memory.md](native-memory.md).

**Large arrays are worth noticing** because the reason is not obvious: the JLS requires every element be initialised to its zero value, so allocating a large array is `O(n)` in memory writes regardless of what you then do with it.

---

## Thread-local reuse against pooling

Prefer thread-local when the shape fits.

| | Thread-local | Object pool |
| --- | ------------ | ----------- |
| **Lifecycle** | Get it and use it. **No return step** | Must check out *and* check in - a `finally` block, and a leak if forgotten |
| **Cardinality** | At most one per thread | Arbitrary - 12 connections for 8 threads |
| **Contention** | **None, ever** | Inevitably synchronised; can become the bottleneck |
| **Throttling** | None. Cannot limit a scarce resource | **Yes - the main reason to prefer a pool** |
| **Memory** | Threads × object size | Pool size × object size |

```java
public class Thermometer {
  private static final ThreadLocal<NumberFormat> NF = ThreadLocal.withInitial(() -> {
    var nf = NumberFormat.getInstance();
    nf.setMinimumIntegerDigits(2);
    return nf;                       // not thread-safe, expensive to build: ideal
  });

  @Override public String toString() { return NF.get().format(reading); }
}
```

### The measurement that shows why removing contention is not enough

Oaks measured 10,000 random numbers on each of four threads:

| Approach | Elapsed |
| -------- | ------- |
| `ThreadLocalRandom` | **52 µs** |
| A new `Random` per call | 135 µs |
| One shared `Random` | 3,763 µs |

The shared instance is 70× worse - `next()` is synchronised. But **creating a new `Random` each time, which also eliminates contention, is still 2.6× worse than thread-local**, because seeding dominates. So the win is *both* effects: no contention *and* no re-initialisation. This is the clearest argument for `ThreadLocal` over "just make a new one".

### The throttle is the pool's real advantage

`ThreadLocal` cannot cap a scarce resource. If 100 threads each take a JDBC connection, the database gets 100 connections - and if it cannot handle them, everything degrades ([database-performance.md](database-performance.md)).

**A pool bounded below demand is a feature, not a limitation.** Threads waiting for a free connection is better than a saturated database, because total throughput is higher. This is the same principle as bounding a queue in [concurrency-performance.md](concurrency-performance.md).

### Thread-locals and virtual threads

On 21+ the calculus changes. With one virtual thread per task and millions of tasks, a `ThreadLocal` is no longer "one per pool thread" - it is potentially one per request, and the memory multiplies. `ScopedValue` (final in 25) is the replacement, and it also survives a `StructuredTaskScope.fork()` where a `ThreadLocal` does not. The API belongs to [`java-developer`](../../java-developer/SKILL.md); the performance consequence is that **thread-local caching stops being a memory optimisation once threads are cheap and numerous**.

---

## Soft, weak and phantom references

Collectively *indefinite references*. Useful, and each has a cost people underestimate.

### The costs

**Extra memory per reference.** A `SoftReference` wrapping a 512-byte object adds ~40 bytes, and the reference object is itself strongly held.

**At least two GC cycles to reclaim.** When the referent is cleared, the reference object goes on a `ReferenceQueue` - which gives it a *new* strong reference. It is freed only after that queue is processed and the next collection runs. If the queue is processed lazily, it takes longer still.

**Reference processing costs pause time**, and it is measurable:

```bash
-Xlog:gc+ref=debug      # 11+
-XX:+PrintReferenceGC   # 8 only; fatal on 11+
```

Oaks measured 238,425 weak references adding **23 ms to a single young collection**. At scale, indefinite references are not free.

### Soft references: an LRU cache

Cleared based on recency *and* free memory:

```
if (now - lastAccess > SoftRefLRUPolicyMSPerMB * freeHeapMB) clear();
```

Verified `SoftRefLRUPolicyMSPerMB = 1000` on all five versions. So on a 4 GB heap that is 50% free, a soft reference untouched for **2,048 seconds (~34 minutes)** is cleared. At 75% full, ~1,024 seconds.

**That default is dangerously permissive for a cache that fills quickly.** Fill 1.7 GB of a 2 GB free heap with soft references inside 34 minutes and *none* is eligible for clearing - leaving 300 MB for everything else and constant GC. Lower the value when caching aggressively:

```bash
-XX:SoftRefLRUPolicyMSPerMB=500
```

Before throwing `OutOfMemoryError` the JVM clears **all** soft references, so it will not die while a cache could be dropped. But that is a cliff: a large number cleared at once, visible in the reference log, means the cache was sized beyond what the heap supports.

**Soft references suit a modest, naturally bounded cache.** For a large one, a bounded LRU with explicit eviction is more predictable, because you control the policy instead of inferring it from a formula involving free memory.

### Weak references: only when something else holds it

Cleared at the **next** collection once no strong reference remains. So the correct use is narrow:

> "While someone else is interested in this object, tell me where it is. Otherwise throw it away and I will rebuild it."

The canonical shape: a per-session strong cache of an expensive object, plus a global weak map so a second session can find the same instance while the first still holds it. When the first session ends, the entry vanishes.

**A weak reference is not a shorter-lived soft reference.** A soft reference survives minutes or hours; a weak reference survives until the next collection touches it. Treating them as interchangeable is the most common error here.

Where a weak reference *lives* matters too: cleared while still in the young generation, it is reclaimed at the next young collection; promoted to the old generation first, it waits for a concurrent or full cycle.

### Collections built on them

`WeakHashMap` (and third-party soft-reference maps) are convenient and carry two specific costs:

1. **Entries are only cleaned up when the map is used.** The map processes its reference queue on access, so an infrequently touched `WeakHashMap` holds its values long after the keys died.
2. **Operation cost becomes unpredictable.** The first operation after a collection processes the queue, so a normally `O(1)` `get` occasionally does proportional work. If keys are cleared frequently, `WeakHashMap` performance can be poor.

Approach with caution; manage the collection explicitly where you can.

---

## `finalize()`: never

Deprecated for removal in Java 9, deprecated on the method in 11, and disabled by default in recent releases. It is also the worst of all the reference types for GC, for a reason worth understanding.

For a soft or weak reference the *referent* is freed immediately and only the small reference object waits two cycles. **A finalizer must be able to run code on the referent, so the referent cannot be freed** - the whole object graph waits for the finalizer thread to run, plus another cycle. The penalty applies to your data, not to a 40-byte wrapper.

And it is functionally unsafe: `finalize()` can resurrect the object by storing `this` somewhere reachable. Then it never runs again, and the cleanup it was supposed to perform silently stops happening.

```bash
jcmd <pid> GC.finalizer_info      # is anything queued?
jcmd <pid> GC.run_finalization    # drain before a heap dump
```

Anything on the finalizer queue is about to be freed, so draining it before a heap dump removes noise ([heap-analysis.md](heap-analysis.md)).

### Use `Cleaner` (9+)

```java
public class Resource implements AutoCloseable {
  private static final Cleaner CLEANER = Cleaner.create();

  // MUST be static: an inner class would capture `this` and nothing would ever be reclaimed
  private static final class State implements Runnable {
    private final long handle;
    State(long handle) { this.handle = handle; }
    @Override public void run() { freeNative(handle); }   // idempotent
  }

  private final State state;
  private final Cleaner.Cleanable cleanable;

  public Resource() {
    this.state = new State(allocateNative());
    this.cleanable = CLEANER.register(this, state);       // `this` is the trigger, state the action
  }

  @Override public void close() { cleanable.clean(); }     // the normal path
}
```

**The one rule that matters: the cleanup action must not reference the object being cleaned.** The `Cleaner` holds the action strongly, so a lambda or non-static inner class capturing `this` keeps the object permanently reachable and the cleaner never fires. Use a `static` nested class holding only what the cleanup needs. This is why the JDK's own `Inflater` uses a static `InflaterZStreamRef` rather than a lambda.

`close()` remains the documented path; the `Cleaner` is the backstop for callers who forget. `AutoCloseable` plus try-with-resources first, `Cleaner` second, `finalize()` never.

---

## Version notes

Verified by `-XX:+PrintFlagsFinal` on 8u504, 11.0.32.1, 17.0.20.1, 21.0.12 and 25.0.4.1.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| `SoftRefLRUPolicyMSPerMB` | 1000 | 1000 | 1000 | 1000 | 1000 |
| `java.lang.ref.Cleaner` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `finalize()` deprecated | ✗ | ✓ | ✓ | ✓ | ✓ |
| `-XX:+PrintReferenceGC` | ✓ | **fatal** | fatal | fatal | fatal |
| `-Xlog:gc+ref=debug` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `ThreadLocalRandom` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ScopedValue` (replaces `ThreadLocal` after `fork`) | ✗ | ✗ | ✗ | preview | **final** |
| Virtual threads change thread-local economics | ✗ | ✗ | ✗ | ✓ | ✓ |

Two notes:

- **On Java 8 there is no `Cleaner`**, so a native resource needs either `finalize()` or a hand-rolled `PhantomReference`/`WeakReference` plus a daemon thread draining a `ReferenceQueue`. The hand-rolled version is strictly better than `finalize()` because the referent is freed on the first cycle. Keep the pending references in a `static` set, or they are collected before they reach the queue.
- **`-XX:+PrintReferenceGC` is fatal from 11.** Use `-Xlog:gc+ref=debug`.

## Gotchas

- Agent introduces an object pool for cheap-to-construct objects - allocation is a pointer bump; only *initialisation* cost justifies a pool
- Agent pools a large number of objects - full GC scales with surviving data; Oaks measured 70 ms against 730 ms on the same heap
- Agent uses a pool where a thread-local fits - no return step, no contention, no leak
- Agent uses a thread-local where a throttle is needed - cannot cap a scarce resource; that is the pool's real advantage
- Agent removes contention by constructing a new object each call - measured 2.6× worse than thread-local for `Random`; seeding is the cost
- Agent keeps thread-local caches on 21+ with virtual threads - one per task, not one per pool thread; consider `ScopedValue`
- Agent treats weak references as short-lived soft references - a weak reference dies at the next collection; a soft one survives ~34 minutes by default
- Agent builds a large soft-reference cache without lowering `SoftRefLRUPolicyMSPerMB` - the default keeps entries ~34 minutes on a half-free 4 GB heap
- Agent ignores the two-cycle cost of indefinite references - measured 23 ms added to one young collection for 238,425 weak references
- Agent uses a `WeakHashMap` that is rarely read - entries are cleaned only on access, so values outlive their keys
- Agent overrides `finalize()` - deprecated for removal, and it delays the whole object graph rather than a small wrapper
- Agent writes a `Cleaner` action as a lambda or non-static inner class - it captures `this`, so the object is never reclaimable and the cleaner never runs
- Agent relies on a `Cleaner` instead of `close()` - `AutoCloseable` is the path; the cleaner is the backstop
- Agent forgets to hold hand-rolled `PhantomReference`s in a static set on Java 8 - they are collected before reaching the queue
- Agent uses `-XX:+PrintReferenceGC` on 11+ - fatal; use `-Xlog:gc+ref=debug`

## Related

- [allocation.md](allocation.md) · [heap-analysis.md](heap-analysis.md) · [native-memory.md](native-memory.md) · [concurrency-performance.md](concurrency-performance.md) · [collections-performance.md](collections-performance.md) · [gc-tuning.md](gc-tuning.md) · [database-performance.md](database-performance.md) · [flags.md](flags.md)
