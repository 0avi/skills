# Collections

Java ships more than 58 collection classes. Choosing the right one is Data Structures 101 and not Java-specific; this file covers the Java-specific parts - sizing, synchronisation choice, and memory efficiency - which is where the avoidable cost actually is.

| Rule | Apply blind? | Measured effect |
| ---- | ------------ | --------------- |
| **Size the collection at construction when you know the size** | **Yes for `HashMap`; marginal for `ArrayList`** | JMH: `HashMap` **1.5× at 1,000 entries and 2.3× at 100,000**. `ArrayList` **1.15× at 1,000 and no measurable difference at 100,000** |
| Choose the structure for the access pattern | Yes | Asymptotic - outranks everything else here |
| Prefer unsynchronised when single-threaded | With judgement | ~5-8 ns per operation |
| Prefer concurrent over synchronised when shared | Yes | Large under contention |
| Do not use a collection for one or two values | Yes | Avoids the whole object graph |

---

## Choose the structure first

No amount of tuning recovers a wrong data structure, and this dwarfs everything else on this page:

- Searching by key → `HashMap`, not a scan of an `ArrayList`.
- Sorted iteration → `TreeMap`, rather than sorting on every access.
- Index access → `ArrayList`. Frequent insertion in the middle → `ArrayDeque` or `LinkedList`.
- Queue between threads → `ArrayBlockingQueue` or `LinkedBlockingQueue`, never a synchronised `List`.
- Set membership → `HashSet`. Small, fixed, enum-keyed → `EnumSet`/`EnumMap`, which are backed by bit vectors and arrays.

`LinkedList` is almost always the wrong answer in modern Java: `ArrayDeque` beats it for queue and deque use, and `ArrayList` beats it for nearly everything else, because contiguous memory is cache-friendly and every `LinkedList` node is a separate 24-byte object.

---

## Sizing: the highest-value blind fix

Collections backed by an array must reallocate and copy when they outgrow it. `ArrayList` grows by ~50% each time, so its backing array goes 10 → 15 → 22 → 33 → …, with a full array copy at every step and the old array left as garbage.

Measured on 25.0.4.1, 10,000 insertions, mean of 300 repetitions:

| | Default capacity | Pre-sized | Improvement |
| --- | ---------------- | --------- | ----------- |
| `ArrayList` 1,000 `add` | 5.219 ± 0.102 µs | 4.527 ± 0.131 µs | **1.15×** |
| `ArrayList` 100,000 `add` | 470.9 ± 10.8 µs | 463.3 ± 26.2 µs | **none - ranges overlap** |
| `HashMap` 1,000 `put` | 15.647 ± 0.889 µs | **10.135 ± 0.246 µs** | **1.54×** |
| `HashMap` 100,000 `put` | 2,250.9 ± 60.3 µs | **979.4 ± 32.6 µs** | **2.30×** |

Measured with JMH on Temurin 25.0.4.1, 3 forks, 5 warm-up + 6 measurement iterations. **Read the `ArrayList` rows together:** presizing it is worth about 15% at a thousand elements and **nothing measurable at a hundred thousand**, because `ArrayList` growth is amortised doubling and `System.arraycopy` is very fast. `HashMap` is the one that repays presizing, and it repays it more as the map grows, because each rehash re-buckets every existing entry.

An earlier version of this file published 2.1× and 2.6× from a hand-rolled harness. **Both are withdrawn**, and the `ArrayList` figure in particular was not reproducible.

```java
// costs ~1.15x more at 1,000 elements, and produces copy garbage at every growth step
List<Integer> list = new ArrayList<>();

// when the size is known or estimable
List<Integer> list = new ArrayList<>(expectedSize);
Map<K, V> map = new HashMap<>(expectedSize * 4 / 3 + 1);   // allow for load factor
```

**`HashMap`'s parameter is capacity, not expected entries.** With the default 0.75 load factor, a map given 10,000 resizes at 7,500 entries. Size it to `expected / 0.75 + 1`, or on Java 19+ use the clearer factory:

```java
Map<K, V> map = HashMap.newHashMap(expectedEntries);   // 19+, handles the load factor for you
```

**How to tell whether a class is array-backed: it has a constructor taking an initial size.** That is the signal. `LinkedList` has none because each node is separate.

The same applies beyond collections. `StringBuilder`, `StringBuffer` and `ByteArrayOutputStream` all hold an internal array and **double** it on growth, leaving them ~25% oversized on average:

```java
new StringBuilder(estimatedLength)
new ByteArrayOutputStream(estimatedBytes)
```

**Whenever a constructor accepts a size and you can estimate it, pass it.** There is no downside beyond a wrong guess, and even a rough estimate beats starting at 10.

---

## Synchronised, concurrent, or neither

Most collections are unsynchronised. The exceptions - `Vector`, `Hashtable` and friends - are synchronised for a historical reason worth knowing: they predate the Collections Framework, and in early Java threading was poorly understood and synchronisation was expensive, so the framework introduced in 1.2 reversed the default. That is why `Vector` and `ArrayList` both exist.

Uncontended cost, measured on 25.0.4.1 over 20 million operations:

| Mechanism | ns/op |
| --------- | ----- |
| Plain field increment | ~0.3 (see caveat) |
| `AtomicLong.incrementAndGet` (CAS) | **5.0** |
| `synchronized` block | **16.708 ± 0.641** |

*The plain-increment figure is unreliable* - a non-volatile static increment in a tight loop is exactly what the JIT optimises away, and 0.3 ns/op is faster than a memory round trip. Treat it as "effectively free" rather than a measurement. The CAS and `synchronized` numbers are meaningful because both require real memory barriers.

So **uncontended synchronisation costs roughly 18 ns and uncontended CAS roughly 5 ns.** For a collection accessed millions of times that adds up; for one accessed thousands of times it is invisible.

The decision:

| Situation | Use |
| --------- | --- |
| Confined to one thread | Unsynchronised `ArrayList`, `HashMap` |
| Shared, low contention | `ConcurrentHashMap`, `CopyOnWriteArrayList` |
| Shared, high contention | `ConcurrentHashMap`; consider `LongAdder` for counters |
| Shared, must be a `List` | `Collections.synchronizedList`, or copy-on-write if reads dominate |
| Legacy code | Leave `Vector`/`Hashtable` alone unless profiled |

**Prefer concurrent collections over synchronised wrappers.** `ConcurrentHashMap` locks per bin rather than per map, so it degrades far better under contention, and it is not much more expensive uncontended.

**A caution against over-optimising for the single-threaded case:** choosing an unsynchronised collection saves about **15 ns** per operation (16.7 ns against a 1.3 ns floor, JMH with a control) and creates a latent concurrency bug the day someone shares it. Oaks' own framing is right - sometimes it is better to be safe than sorry. Save the unsynchronised choice for genuinely hot, genuinely confined paths.

### Fine-grained synchronisation can be worse than none

A real production case worth recognising:

```java
Vector v;
for (int i = 0; i < v.size(); i++) {   // synchronized
  process(v.get(i));                    // synchronized
}
```

`size()` and `get()` are both synchronised, so this loop synchronises twice per element. The cost was not the lock - it was uncontended - but the **memory barriers**, forcing register flushes to main memory on every call. On a large SPARC machine with many registers per thread this dominated the loop; the same code had run fine for years on smaller hardware.

It is also incorrect: another thread can shrink the vector between `size()` and `get()`, producing `ArrayIndexOutOfBoundsException`. The fix is to hold one lock around the loop, or to copy and partition - not to synchronise more finely.

**The lesson generalises: many small synchronised calls can cost more than one coarse lock**, and the effect grows with the CPU's register count. See [concurrency-performance.md](concurrency-performance.md).

---

## Memory efficiency

Collections are frequently the largest consumers in a heap, for two reasons.

**Wasted backing-array capacity.** `ArrayList` sits up to 50% oversized after a growth step, `HashMap` similar, and doubling structures average ~25% over. Sizing correctly removes most of this.

**Sparse collections.** A `HashMap` holding two entries still allocates a table, a `Node` per entry, and boxes primitive keys and values. Java 7 and 8 improved this by **lazily allocating the backing array** - `new ArrayList<>()` and `new HashMap<>()` allocate no table until the first insertion, which measurably reduced GC in applications holding many never-used collections. But once used, the overhead per entry is real.

**When there are one or two values, a collection is the wrong tool.** Two object references cost 8 bytes; a `HashMap` holding two entries costs a couple of hundred. Likewise a `HashMap` is the fastest way to look up among many keys and overkill for one - use a field.

Boxing compounds it. A `Map<Integer, Integer>` with 10,000 entries holds 20,000 boxed `Integer` objects at ~16 bytes each on top of the nodes and the table. Verified: a boxed `Long` costs 24 bytes on 8, 11 and 25 by default, and **16 bytes on 25 with compact object headers** ([allocation.md](allocation.md)). `Integer.valueOf` caches −128…127 (`-XX:AutoBoxCacheMax`, verified 128 on all five versions), so small values are shared and larger ones are not. For large primitive-keyed maps, a primitive-specialised collection from Eclipse Collections, fastutil or HPPC avoids boxing entirely - and that is the only case here where a third-party dependency is usually justified.

**Sorting small arrays:** `Arrays.sort` uses insertion sort below a size threshold rather than quicksort, because for small inputs it is faster. **The threshold changed, and so did the constant's name** - read from each JDK's own `src.zip`, `java/util/DualPivotQuicksort.java`: `INSERTION_SORT_THRESHOLD = 47` on 8 and 11, `MAX_INSERTION_SORT_SIZE = 44` on 17, 21 and 25. Quote 47 only for 8 and 11. A reminder that asymptotic complexity is not the whole story at small sizes.

---

## Iteration and views

- **`Map.forEach` and `entrySet()` beat `keySet()` plus `get()`** - the latter hashes every key twice.
- **`keySet()`, `values()` and `entrySet()` are views, not copies.** Iterating them is cheap; the mistake is copying them into a new collection to iterate.
- **`Collections.unmodifiableList` is a wrapper**, so it adds an indirection per call. `List.copyOf` (10+) makes a genuinely immutable copy - one allocation, no per-call cost.
- **`List.of`, `Map.of` and `Set.of` (9+) are compact**, allocating no backing table for small sizes, and are the right choice for constants. Note the iteration order of `Set.of` and `Map.of` is randomised per JVM run, which is a correctness trap rather than a performance one.

---

## Version notes

Verified by measurement on 25.0.4.1 and by `-XX:+PrintFlagsFinal` on all five.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| Lazy backing array for `ArrayList`/`HashMap` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `AutoBoxCacheMax` default | 128 | 128 | 128 | 128 | 128 |
| `List.of` / `Map.of` / `Set.of` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `List.copyOf` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `HashMap.newHashMap(n)` | ✗ | ✗ | ✗ | ✓ (19+) | ✓ |
| `LongAdder`, `LongAccumulator` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Boxed `Long` size | 24 B | 24 B | 24 B | 24 B | 24 B (**16 B** compact) |
| `AggressiveOpts` alternate `HashMap`/`TreeMap` | ✓ | **removed** | removed | removed | removed |

**`-XX:+AggressiveOpts` deserves a specific warning** because a lot of older material recommends it. On Java 8 it substituted faster implementations of `HashMap`, `LinkedHashMap`, `TreeMap`, `BigDecimal`, `BigInteger`, `DecimalFormat` and `NumberFormat`. It was **removed in Java 12** - verified **unrecognised and fatal on 21 and 25**, so a command line carrying it will not start. Its improvements were either folded into the base classes or superseded. Never recommend it.

Its history is also a useful warning about relying on iteration order: the aggressive `HashMap` returned keys in a different order, and enough applications depended on the standard order that the faster implementation could not be made the default. **Never depend on `HashMap` iteration order.**

## Gotchas

- Agent constructs a `HashMap` at default size when the size is known - JMH measured **1.54× at 1,000 entries and 2.30× at 100,000**; rehashing dominates and it gets worse as the map grows
- Agent claims a large win from presizing an `ArrayList` - measured **1.15× at 1,000 and no measurable difference at 100,000** (error ranges overlap). Still pass the size, because it is free and avoids copy garbage, but do not sell it as a speed fix
- Agent quotes this skill's earlier "2.1× and 2.6×" - withdrawn; hand-rolled, and it overstated `ArrayList` badly
- Agent passes the expected entry count to `HashMap` as capacity - with a 0.75 load factor it resizes at 75%; use `expected / 0.75 + 1` or `HashMap.newHashMap` on 19+
- Agent sizes the collection but not the `StringBuilder` or `ByteArrayOutputStream` beside it - same rule, same benefit
- Agent uses `LinkedList` for indexed or general-purpose use - `ArrayList` and `ArrayDeque` beat it almost everywhere
- Agent chooses an unsynchronised collection to save ~15 ns/op on a cold path - a latent concurrency bug for no measurable gain
- Agent wraps in `Collections.synchronizedMap` where `ConcurrentHashMap` fits - per-bin locking degrades far better
- Agent calls several fine-grained synchronised methods in a loop - the memory barriers can cost more than one coarse lock, and it is racy
- Agent uses `keySet()` plus `get()` - hashes every key twice; use `entrySet()` or `forEach`
- Agent copies a `keySet()` or `entrySet()` view to iterate it - the view is already cheap
- Agent uses a `HashMap` for one or two values - a field costs 8 bytes, the map costs hundreds
- Agent ignores boxing in large primitive-keyed maps - 10,000 entries means 20,000 boxed objects
- Agent recommends `-XX:+AggressiveOpts` - removed in 12 and **fatal on 21 and 25**
- Agent depends on `HashMap` iteration order - never specified, and it has changed
- Agent depends on `Set.of` / `Map.of` iteration order - deliberately randomised per JVM run

## Related

- [allocation.md](allocation.md) · [strings.md](strings.md) · [concurrency-performance.md](concurrency-performance.md) · [heap-analysis.md](heap-analysis.md) · [lambdas-and-streams.md](lambdas-and-streams.md) · [object-lifecycle.md](object-lifecycle.md) · [methodology.md](methodology.md) · [flags.md](flags.md)
