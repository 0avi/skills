# Allocation and Object Layout

What an object actually costs, measured. Using less memory is the most reliable way to improve GC behaviour: fewer objects means less frequent collections, and a smaller live set means shorter ones. **The length of a full GC is proportional to surviving data, not to heap size** - a 3 GB old generation with few survivors collects faster than a 1 GB old generation that is 75% live.

| Field type | Bytes |
| ---------- | ----- |
| `boolean`, `byte` | 1 |
| `char`, `short` | 2 |
| `int`, `float` | 4 |
| `long`, `double` | 8 |
| reference | 4 with compressed oops (heap < 32 GB), else 8 |

Plus a header, plus padding to an 8-byte boundary. **The floor for any object is 16 bytes** on a standard 64-bit JVM - and **8 bytes on Java 25 with compact object headers**.

---

## Measured object sizes

Allocating one million instances and measuring heap delta, `-Xmx3g -Xms1g`, on Temurin 8u504, 11.0.32.1 and 25.0.4.1:

| Declaration | 8 | 11 | 25 | **25 + compact headers** |
| ----------- | - | -- | -- | ------------------------ |
| `class Empty {}` | 16 | 16 | 16 | **8** |
| `class OneInt { int i; }` | 16 | 16 | 16 | 16 |
| `class TwoInt { int i, j; }` | 24 | 24 | 24 | **16** |
| `class OneLong { long l; }` | 24 | 24 | 24 | **16** |
| `class OneRef { Object o; }` | 16 | 16 | 16 | 16 |
| `class IntPlusRef { int i; Object o; }` | 24 | 24 | 24 | **16** |
| `class FourByte { byte a,b,c,d; }` | 16 | 16 | 16 | 16 |
| `new byte[0]` | 16 | 16 | 16 | 16 |
| `new byte[1]` | 24 | 24 | 24 | **16** |
| `new byte[8]` | 24 | 24 | 24 | 24 |
| `Long.valueOf(n)` | 24 | 24 | 24 | **16** |
| `new String(new char[0])` | **40** | 24 | 24 | 24 |
| `new String(8 chars)` | **56** | 48 | 48 | 48 |

Method precision is about ±0.5 bytes per object; readings of 15.5 and 10.6 for `Empty` on 11 and 8 are accounting jitter around a true 16.

### Reading the arithmetic

The header is **12 bytes** on a 64-bit JVM with compressed oops (8-byte mark word plus a 4-byte compressed class pointer), and objects align to 8 bytes:

- `Empty` - 12 header, padded to **16**. Four bytes wasted.
- `OneInt` - 12 + 4 = 16, **no padding**. The `int` occupies space that was padding anyway, so it is **free**.
- `TwoInt` - 12 + 8 = 20, padded to **24**.
- `OneRef` - 12 + 4 (compressed reference) = 16. Also free.
- `IntPlusRef` - 12 + 4 + 4 = 20, padded to **24**.
- `FourByte` - 12 + 4 = 16. Four `byte` fields cost nothing over `Empty`.

**The practical rule: adding the first 4 bytes of fields to a class is free.** Beyond that you pay in 8-byte steps. Arrays use a 16-byte header (the extra 4 bytes hold the length), which is why `byte[0]` is 16 and `byte[1]` is 24.

### Compact object headers: Java 25

`-XX:+UseCompactObjectHeaders` - verified a **product** flag on 25.0.4.1 and absent from 8, 11, 17 and 21 - compresses the header from 12 bytes to 8, and the measured effect is substantial:

- `Empty` **halves**, 16 → 8.
- `TwoInt`, `OneLong`, `IntPlusRef`, `byte[1]` and boxed `Long` all drop 24 → **16**, a third smaller.
- `OneInt`, `OneRef`, `FourByte` stay at 16, because 8 + 4 still pads to 16.
- `byte[8]` stays at 24 - the payload dominates.

**A boxed `Long` going from 24 to 16 bytes matters** for any application holding large numbers of boxed values in collections. But note the pattern: **the saving appears only where the 4-byte reduction crosses an 8-byte boundary**, so measure your own workload rather than assuming a third off everything.

It is off by default on 25. Two things to check before enabling: it is recorded into an AOT cache, so a cache built without it stops applying ([startup-and-warmup.md](startup-and-warmup.md)); and any tool or agent that parses object headers may not understand the new layout.

Neither edition of Oaks' book covers this - his object-size table is the "default" column above, correct on every version including 25's default, and now with an additional column he could not have written.

---

## Compressed oops and the 32 GB cliff

Verified `UseCompressedOops=true` on all five versions. References are stored as 32-bit values and shifted by 3 on use, exploiting 8-byte alignment to address 32 GB.

**Above a 32 GB heap it switches off and every reference doubles.** A 31 GB heap routinely outperforms a 33 GB one, because the larger heap holds less useful data. If you must exceed 32 GB, plan on 38 GB or more before the extra capacity repays the pointer cost - roughly 20% of a typical heap is references. Full discussion in [native-memory.md](native-memory.md).

---

## Reducing object size

Two levers, and the second is less obvious.

**Fewer fields.** Verified: `class B { int i; Locale l = Locale.US; }` costs 24 bytes shallow where `class A { int i; }` costs 16 - 8 more for the reference plus padding, even though the `Locale` is shared. Worse, `class C { int i; ConcurrentHashMap m = new ConcurrentHashMap(); }` costs 24 shallow but ~200 bytes *retained*, because it owns the map. **A field you do not need costs the reference; a field you instantiate and do not need costs the whole graph.**

**Smaller fields.** `byte` for a value with eight possible states rather than `int`; `float` where `double` precision is not needed; `int` rather than `long`. Given the padding rules this only pays when it crosses an 8-byte boundary, so check with the arithmetic above before refactoring - but there is no reason not to declare the narrowest correct type.

### Cache a computed value, or recompute it?

The classic time-versus-space trade-off, with a Java twist: **memory costs time too**, because more memory means more GC. The JDK itself decides both ways, which is instructive:

- `String` **caches its hash code** in a field. Computing it walks every character, and it is used constantly as a map key - so caching wins decisively.
- `Object.toString()` **does not cache**. It is called rarely, the result is often large, and holding a `String` per object would be a substantial permanent cost.

The discriminator is the ratio of read frequency to computation cost, and whether the cached value would be retained long. When the goal is reducing GC, the balance shifts towards recomputing.

---

## Lazy initialisation

Deferring an expensive field until first use. Worth it **only when the common path leaves the field unset** - otherwise you pay the check on every access and save nothing.

```java
// worth it only if report() is rarely called
private Calendar calendar;
private DateFormat df;

private void report(Writer w) throws IOException {
  if (calendar == null) {                    // the check you now pay for
    calendar = Calendar.getInstance();
    df = DateFormat.getDateInstance();
  }
  w.write("On " + df.format(calendar.getTime()) + ": " + this);
}
```

**Sometimes the check is free**, and `ArrayList` is the model. It already had to test the array's length on every add, so lazy allocation of the backing array cost nothing:

```java
private static final Object[] EMPTY_ELEMENTDATA = {};
private Object[] elementData = EMPTY_ELEMENTDATA;   // no allocation until first add
```

Both `ArrayList` and `HashMap` do this, and when the change landed in Java 7 it measurably reduced GC in applications holding many never-used collections. Look for the same shape in your own code: if a bounds or state check already exists, lazy initialisation is free.

### Thread-safe lazy initialisation

Synchronising the whole method is the correct first move, and usually enough - the whole premise of lazy initialisation is that the field is rarely initialised, so contention is rare. It becomes a bottleneck only when an infrequently used path is suddenly hit by many threads at once.

If the lazily created object is itself thread-safe, use double-checked locking, and **every detail here is load-bearing**:

```java
private volatile ConcurrentHashMap<K, V> instanceChm;   // volatile is mandatory

public void doOperation() {
  ConcurrentHashMap<K, V> chm = instanceChm;            // read the field once
  if (chm == null) {
    synchronized (this) {
      chm = instanceChm;                                // re-read inside the lock
      if (chm == null) {
        chm = new ConcurrentHashMap<>();
        populate(chm);                                  // fully build via the local
        instanceChm = chm;                              // publish last
      }
    }
  }
  use(chm);
}
```

- **`volatile`** - without it another thread may see a non-null reference to a partly constructed object.
- **The local variable** - one volatile read instead of several, and it guarantees the code operates on one consistent value.
- **Publishing last** - populate through the local so no other thread can observe a half-filled map.

If the object is *not* thread-safe, do not do this. Synchronise access to it instead, or use a `ThreadLocal`.

### Eager deinitialisation is usually wrong

Setting a field to `null` to help the collector is almost always unnecessary: when the owning object becomes unreachable, so does everything it referenced. And a field only used within one method should have been a local variable, which falls out of scope for free.

**The genuine exception is a stale reference in a long-lived container.** `ArrayList.remove` carries one of the JDK's few GC comments:

```java
elementData[--size] = null;   // clear to let GC do its work
```

After decrementing `size`, the slot is unreachable *by the API* but still referenced by the array - and the array lives a long time. Without the assignment the removed element is retained indefinitely. **The rule: a long-lived structure that stops needing a reference must clear it.** Elsewhere, do not bother.

---

## Immutable and canonical objects

Immutable objects - `Integer`, `Long`, `BigDecimal`, `String`, and well-designed domain types - are cheap to create and die young, so they cost little. The problem is duplicates surviving into the old generation.

`Boolean` is the cautionary design: an application needs exactly two instances, but the public constructor lets you make millions of objects identical to `Boolean.TRUE`. A private constructor with a factory would have made that impossible - which is what `Boolean.valueOf` and, in modern Java, the deprecation of the constructor are for. **Design immutable types with a factory, not a public constructor**, so canonicalisation is available later.

To canonicalise your own type, keep a map of instances and make sure it does not become the leak:

```java
public final class ImmutableValue {
  private static final Map<ImmutableValue, ImmutableValue> CANONICAL =
      Collections.synchronizedMap(new WeakHashMap<>());

  public static ImmutableValue canonical(ImmutableValue v) {
    var existing = CANONICAL.putIfAbsent(v, v);
    return existing != null ? existing : v;
  }
}
```

The weak keys are what prevent the cache from retaining everything. In a threaded application the synchronisation can itself become the bottleneck, and the JDK offers no concurrent weak map - so measure before adopting this. For `String` specifically there are better options: see [strings.md](strings.md).

---

## TLABs: why allocation is nearly free

Allocation in eden is a pointer bump, and it needs no lock because each thread has its own **thread-local allocation buffer** carved out of eden. No synchronisation on the fast path at all.

The consequence is the one that matters: **an object too large for the remaining TLAB space must be allocated in the shared heap, with synchronisation.** When a TLAB fills, the JVM either retires it (wasting the remainder) or allocates the object directly from the heap and keeps the TLAB - a decision driven by how much space is left.

TLAB size is dynamic, computed from thread count, eden size and each thread's allocation rate, so it cannot be predicted. Verified `UseTLAB=true` and `ResizeTLAB=true` on all five versions. **Never disable them.**

Diagnose rather than guess:

```bash
jfr print --events jdk.ObjectAllocationOutsideTLAB recording.jfr   # 11+
-Xlog:gc+tlab=trace                                                # 11+
-XX:+PrintTLAB                                                     # 8 only; fatal on 11+
```

Some allocation outside TLABs is normal, especially just before a young collection when eden is nearly full. A *large proportion* outside TLABs means either genuinely large objects or too many threads for the eden size.

**Prefer fixing the code to tuning the TLAB.** If specific types are always allocated outside, make them smaller. Only if that is impossible:

```bash
-XX:TLABSize=N        # initial size; 0 = dynamic
-XX:-ResizeTLAB       # required if you set TLABSize, or it will be recomputed
-XX:MinTLABSize=N     # default 2 KB
```

Because TLABs come out of eden, **enlarging the young generation enlarges TLABs automatically** - usually the better lever.

### Humongous objects under G1

An object at least half a G1 region is allocated straight into contiguous old-generation regions, skipping eden entirely. A short-lived one therefore defeats the generational design and can only be reclaimed by a concurrent cycle. See [gc-tuning.md](gc-tuning.md) for region sizing.

---

## Escape analysis

C2 may prove an object never escapes its creating method and then **not allocate it at all**, keeping its fields in registers. Verified `DoEscapeAnalysis=true` and `EliminateAllocations=true` on all five versions.

This is the main reason a microbenchmark's allocation cost is not the real one: a benchmark's throwaway object escapes nowhere and vanishes; the identical-looking object in your application escapes into a collection and does not. See [methodology.md](methodology.md).

---

## Version notes

Verified by measuring one million allocations per shape on 8u504, 11.0.32.1 and 25.0.4.1, and by `-XX:+PrintFlagsFinal` on all five.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| Object header (compressed oops) | 12 B | 12 B | 12 B | 12 B | 12 B |
| Minimum object size | 16 B | 16 B | 16 B | 16 B | 16 B |
| `UseCompactObjectHeaders` | ✗ | ✗ | ✗ | ✗ | **✓ (8 B header)** |
| Empty object with compact headers | - | - | - | - | **8 B** |
| `String` backing array | `char[]` | `byte[]` | `byte[]` | `byte[]` | `byte[]` |
| 8-char `String` total | **56 B** | 48 B | 48 B | 48 B | 48 B |
| Empty `String` total | **40 B** | 24 B | 24 B | 24 B | 24 B |
| `UseCompressedOops` | true | true | true | true | true |
| `UseTLAB` / `ResizeTLAB` | true | true | true | true | true |
| `-XX:+PrintTLAB` | ✓ | **fatal** | fatal | fatal | fatal |
| `jdk.ObjectAllocationSample` JFR event | ✗ | ✗ | ✓ (16+) | ✓ | ✓ |
| Lazy `ArrayList` / `HashMap` backing array | ✓ | ✓ | ✓ | ✓ | ✓ |

Two findings worth carrying:

- **Compact strings are measurable, not theoretical.** An 8-character `String` costs 56 bytes on 8 and 48 on 11+; an empty one costs 40 against 24. Since `String` commonly occupies around half a Java heap, this is much of the reason a Java 11+ application can run in roughly 75% of the heap the same code needed on 8. See [strings.md](strings.md).
- **Plain object sizes are unchanged from 8 to 25 by default.** Oaks' object-size table is still correct - the change is the *opt-in* compact headers on 25.

## Gotchas

- Agent quotes an object size without stating the JVM and compressed-oops state - a reference is 4 or 8 bytes depending on heap size
- Agent assumes narrowing a field always saves memory - padding means it only pays when it crosses an 8-byte boundary
- Agent assumes compact object headers save 4 bytes on everything - measured saving appears only where the reduction crosses an alignment boundary; `OneInt` is 16 either way
- Agent enables `-XX:+UseCompactObjectHeaders` without checking the AOT cache - the cache records the flag and stops applying
- Agent applies lazy initialisation to a field the common path always uses - pure cost
- Agent writes double-checked locking without `volatile`, or publishes before populating - a data race that will pass every test
- Agent uses double-checked locking for a *non*-thread-safe object - the pattern only publishes safely; it does not make the object safe
- Agent nulls out fields to help the collector - unnecessary unless a long-lived structure holds a stale reference
- Agent makes a field a member when it is used in one method - a local falls out of scope for free
- Agent instantiates a collection in a field that is often unused - the reference costs 8 bytes, the object graph costs hundreds
- Agent builds a canonicalising cache with strong keys - that is a leak; weak keys are the point
- Agent disables TLABs, or sets `TLABSize` without `-XX:-ResizeTLAB` - the value is recomputed and the setting is silently ignored
- Agent tunes TLABs before checking allocation-outside-TLAB events - some is normal near a young collection
- Agent sizes a heap just over 32 GB - compressed oops switch off; a 31 GB heap usually performs better
- Agent trusts a microbenchmark's allocation cost - escape analysis removes benchmark allocations that survive in real code
- Agent uses `-XX:+PrintTLAB` on 11+ - unrecognised and fatal; use `-Xlog:gc+tlab=trace`

## Related

- [object-lifecycle.md](object-lifecycle.md) · [heap-analysis.md](heap-analysis.md) · [strings.md](strings.md) · [collections-performance.md](collections-performance.md) · [gc-tuning.md](gc-tuning.md) · [native-memory.md](native-memory.md) · [jit-compiler.md](jit-compiler.md) · [methodology.md](methodology.md) · [flags.md](flags.md)
