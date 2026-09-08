# Strings

`String` is the most common object in Java and commonly occupies around half a Java heap. That makes it the highest-leverage single type for memory work - and the place where a lot of folklore has outlived the facts.

| Technique | Effort | Verdict |
| --------- | ------ | ------- |
| **Compact strings** | None - automatic on 9+ | Measured 40 → 24 bytes empty, 56 → 48 bytes for 8 chars |
| **Never concatenate in a loop** | Trivial | **The penalty is quadratic, so there is no single multiplier.** JMH: 1.3× at 10 iterations, 32× at 1,000, **320× at 10,000.** Always apply |
| **String deduplication** (`+UseStringDeduplication`) | One flag, G1 only | Test it. ~10% expected; can cost memory if few duplicates |
| **`intern()`** | Code change plus table sizing | Only with measured duplicate pressure, and size the table |
| **A custom canonicalising map** | More code | Often better than `intern()` - resizes itself |
| **Pre-encoding to `byte[]`** | Fiddly | Rarely. Usually loses to per-call encoder overhead |

---

## Compact strings: free, and measurable

Java 8 stores every `String` as `char[]` - 16 bits per character regardless of content. From Java 9, a `String` whose characters all fit in Latin-1 is stored as `byte[]` with a one-byte coder field. Verified by allocating a million of each, `-Xmx3g`:

| | 8u504 | 11.0.32.1 | 25.0.4.1 |
| --- | ----- | --------- | -------- |
| `new String(new char[0])` | **40 B** | 24 B | 24 B |
| `new String(8 chars)` | **56 B** | 48 B | 48 B |
| Backing array type | `char[]` | `byte[]` | `byte[]` |

Verified `CompactStrings` absent on 8 and `true` on 11, 17, 21 and 25.

**Given that strings are often half the heap, this is most of the reason the same application runs in roughly 75% of the heap on 11+ that it needed on 8.** Two ways to spend it: cut the maximum heap by ~25% at equal performance, or keep the heap and absorb more load. It is on by default; `-XX:-CompactStrings` exists and there is essentially no reason to use it. The only theoretical case against is an application where *every* string needs UTF-16 anyway, where the coder check is a small cost with no saving.

Beware exaggerated claims. It is easy to construct a heap-starved example where Java 8 thrashes and Java 11 does not, and report a three-to-ten-times speedup. Real applications see a memory reduction and a modest GC reduction, not a transformation.

---

## Concatenation

**This is the rule that matters, and it holds on every version: never concatenate in a loop.**

Measured, 6-iteration loop, compiled and run on each JDK (ns per completed loop, ±10% between runs):

| Configuration | Single expression `a + ":" + b` | Concat **in a loop** | `StringBuilder` in a loop |
| ------------- | ------------------------------- | -------------------- | ------------------------- |
| javac 8 → JDK 8 | 40.7 | **199.5** | 83.2 |
| javac 11 → JDK 11 | 43.2 | **174.6** | 113.7 |
| javac 25 → JDK 25 | 38.9 | **202.7** | 82.4 |
| javac 25 `--release 8` → JDK 25 | 40.8 | **160.1** | 71.7 |

**Concatenating in a loop is quadratic, and quoting one multiplier for it is the mistake.** The ratio depends entirely on the iteration count you happened to measure, so the useful form is the curve. Measured with JMH on Temurin 25.0.4.1 (3 forks, 5 warm-up + 6 measurement iterations), appending an 8-character literal `n` times:

| `n` | `s += "abcdefgh"` | `StringBuilder.append` | Presized `StringBuilder` | Penalty |
| --- | ----------------- | ---------------------- | ------------------------ | ------- |
| 10 | 0.122 ± 0.002 µs | 0.097 ± 0.008 µs | 0.079 ± 0.007 µs | **1.3×** |
| 100 | 3.754 ± 0.043 µs | 1.146 ± 0.172 µs | 0.769 ± 0.066 µs | **3.3×** |
| 1,000 | 336.3 ± 4.2 µs | 10.563 ± 1.113 µs | 8.296 ± 0.951 µs | **31.8×** |
| 10,000 | 36,343.8 ± 2,921.5 µs | 113.6 ± 17.1 µs | 63.7 ± 4.8 µs | **319.8×** |

**Read the last column downward: the penalty grows by roughly 10× for every 10× in `n`.** That is the quadratic law made visible, and it is why an earlier version of this file's "2-2.5×" was misleading rather than merely imprecise - that figure is only true for `n` somewhere around 10 to 50, and the loops that actually hurt in production are the ones with thousands of iterations, where the true cost is two to three orders of magnitude.

The two comparison columns are linear, as they should be: `StringBuilder` grows 0.097 to 113.6 µs across a 1,000× increase in `n`, and **presizing it buys a further 1.2-1.8×** on top - worth doing when the final length is known, but a second-order effect next to not concatenating in the first place.

The reason is visible in the bytecode: each `s = s + i + ","` builds a *new* string from the whole accumulated value, so the work at iteration `k` is proportional to `k` and the total is proportional to `n²`.

```java
// BAD - a fresh String per iteration, quadratic
String s = "";
for (int i = 0; i < k; i++) { s = s + i + ","; }

// GOOD
StringBuilder b = new StringBuilder();
for (int i = 0; i < k; i++) { b.append(i).append(','); }
return b.toString();
```

The precise rule: **concatenation on a single logical line is fine; inside a loop it is only acceptable if the result is not carried into the next iteration.** This is Oaks' own example of "premature optimisation" that is really just writing good code - it costs nothing to write correctly.

### The compiler strategy changed, but the payoff did not show up here

Verified with `javap` on the same source:

```java
static String f(String a, int b) { return a + ":" + b; }
```

- **javac 8** emits `new StringBuilder`, three `append` calls and `toString` - six instructions.
- **javac 11 and javac 25** emit a single `invokedynamic makeConcatWithConstants`, which lets the runtime pick and cache a strategy.
- **javac 25 with `--release 8`** falls back to the `StringBuilder` form.

That last line is the operationally important one: **the strategy is chosen by the compiler and gated by `--release`, not by the JDK that runs the code.** A project targeting release 8 gets the old bytecode even when built and run on 25, which is why this is one of the rare cases where recompiling changes performance.

**Honest reporting of what I measured: single-expression concatenation came out at ~39-43 ns in every configuration, including `--release 8` on JDK 25.** I did not reproduce a meaningful speedup from the indified strategy. Oaks reports a larger gap (49.4 ns against 77.0 ns) for a concatenation involving a `double`, where the Java 8 strategy bailed out to a slower path; my case concatenated `String + String + int`, which the Java 8 strategy handled well. So the fair statement is: **the indified strategy helps most where the Java 8 one bailed out - notably `double` and other non-`String`/`int` types - and is roughly neutral for simple string-and-int concatenation.** Do not promise a general concatenation speedup from recompiling.

---

## Duplicate strings

Duplicates are extremely common and easy to miss. In Eclipse MAT: **Query Browser → Java Basics → Group By Value**, with `java.lang.String` as the argument. Real heaps routinely show hundreds of thousands of copies of the same handful of values.

Three remedies, in increasing order of effort.

### G1 string deduplication: one flag

```bash
-XX:+UseG1GC -XX:+UseStringDeduplication
```

Verified `UseStringDeduplication` present and `false` by default on all five versions, and `StringDeduplicationAgeThreshold=3` on all five. Requires G1 (8u20+).

Background threads make duplicate strings **share one backing array**. It is off by default for three reasons, and the third is the one that catches people: it lengthens G1's young and mixed phases slightly; it needs a background thread; and **if there are few duplicates it uses *more* memory**, because tracking every candidate costs bookkeeping. JVM engineers estimate ~10% benefit typically. **Test it rather than assuming.**

```bash
-Xlog:gc+stringdedup*=debug          # 11+
-XX:+PrintStringDeduplicationStatistics   # 8 only; fatal on 11+
```

Note what is shared: **only the backing array, not the `String` object.** Two identical 16-character strings cost 44-52 bytes each before deduplication and about 64 bytes total after - a real saving, but less than interning, which would leave one object of ~40 bytes.

Candidates are strings promoted out of the young generation, plus strings that survive to a tenuring age of 3 (`StringDeduplicationAgeThreshold`). **Short-lived strings are never deduplicated**, which is correct - there is no point spending CPU on something about to die.

### `intern()`: effective, and it needs the table sized

`String.intern()` returns a canonical instance from a JVM-internal table. That table is a **fixed-size** hash table in native memory - it does not resize itself, unlike `HashMap`.

Verified `StringTableSize`: **60013 on 8u504**, **65536 on 11, 17, 21 and 25**. On 25, `-XX:+PrintStringTableStatistics` confirms 65,536 buckets at 8 bytes each - a 524,288-byte footprint.

With ~65,000 buckets you can hold roughly 32,000 interned strings before collisions start turning bucket lookups into linked-list walks. Oaks measured the consequence starkly: interning 10 million strings against the pre-8u40 default of 1,009 buckets took **2.3 hours**; with the table sized to 1 million it took **30.4 seconds**. The mechanism is unchanged, only the default improved.

```bash
-XX:StringTableSize=1000003          # prefer a prime
-XX:+PrintStringTableStatistics      # verify: average bucket size should be ~1
```

Read `Average bucket size` and `Maximum bucket size`. Averages in the tens mean the table is far too small. Over-sizing costs 8 bytes per bucket in **native** memory - a few thousand extra buckets is a rounding error, so err large.

Interned strings are held with weak references, so an interned string with no other reference can be collected - which is why a benchmark that discards its strings shows a small table and no problem at all, and why such a benchmark tells you nothing.

**`intern()` does not make comparison faster.** The popular idea that interning enables `==` misses the cost: `intern()` must compute the hash, which walks the whole string, exactly as `equals` does. `equals` also short-circuits on unequal lengths. Interning pays only if the same strings are compared repeatedly *and* were already interned for another reason. Intern to save memory, not to speed up comparison.

### A custom canonicalising map

```java
private static final Map<String, String> CANONICAL = new ConcurrentHashMap<>();

static String canonical(String s) {
  String existing = CANONICAL.putIfAbsent(s, s);
  return existing != null ? existing : s;
}
```

The advantage over `intern()` is decisive in practice: **it resizes itself**, so there is no table to tune and no per-application sizing exercise. Oaks measured a well-tuned string table at ~2.4 s for a million interns and a self-sizing custom map at ~2.7 s - slightly slower, far more robust.

The cost is that you must manage it. A plain `ConcurrentHashMap` holds strong references, so **it is a leak unless you bound it or clear it**. Use it where the set of values is naturally bounded - enum-like codes, column names, currency codes, tenant identifiers - and use an explicit LRU or a weak-reference map otherwise.

---

## Encoding

Java strings are UTF-16 internally (or Latin-1 `byte[]` from 9+); the outside world is mostly UTF-8. Encoding and decoding is therefore constant, and **the cost is dominated by per-call overhead, not per-character work**.

Consequence: **always encode and decode whole buffers, never a character at a time.** Feeding single characters to a `CharsetEncoder` or `Reader` is one of the more common real performance defects, and it is the same failure as unbuffered I/O - see [io-performance.md](io-performance.md).

Always name the charset explicitly. `new String(bytes)` and `String.getBytes()` use the platform default, which is a correctness bug as well as an unpredictable performance one. From Java 18 the default is UTF-8 (JEP 400), so the same code silently changes behaviour across the 17/18 boundary - another reason to be explicit.

Pre-encoding constant strings into `byte[]` and writing the bytes directly is occasionally worthwhile for static server output, but it usually loses: mixing raw byte writes with encoded writes can force buffer flushes, and encoding one large block costs barely more than a small one, so many small encoder calls interleaved with byte writes is slower than one call encoding everything.

---

## Version notes

Verified by measurement on 8u504, 11.0.32.1 and 25.0.4.1, by `javap` on all three, and by `-XX:+PrintFlagsFinal` on all five.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| `CompactStrings` | **absent** | true | true | true | true |
| `String` backing array | `char[]` | `byte[]` | `byte[]` | `byte[]` | `byte[]` |
| Empty `String` size | 40 B | 24 B | 24 B | 24 B | 24 B |
| 8-char `String` size | 56 B | 48 B | 48 B | 48 B | 48 B |
| Concat bytecode from `javac` | `StringBuilder` | `invokedynamic` | `invokedynamic` | `invokedynamic` | `invokedynamic` |
| `StringTableSize` default | **60013** | 65536 | 65536 | 65536 | 65536 |
| `UseStringDeduplication` | ✓ (8u20+) | ✓ | ✓ | ✓ | ✓ |
| `StringDeduplicationAgeThreshold` | 3 | 3 | 3 | 3 | 3 |
| `+PrintStringDeduplicationStatistics` | ✓ | **fatal** | fatal | fatal | fatal |
| `+PrintStringTableStatistics` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Default charset | platform | platform | platform | **UTF-8** (18+) | UTF-8 |

Three version notes worth carrying:

- **`--release 8` keeps the old concat bytecode** even on javac 25 - verified. A project that has moved its runtime to 25 but left `--release 8` in the build has not moved its string concatenation.
- **`-XX:+PrintStringDeduplicationStatistics` is fatal from 11.** Use `-Xlog:gc+stringdedup*=debug`.
- **The default charset became UTF-8 at Java 18**, so unqualified `getBytes()` changes behaviour between 17 and 21. Name the charset.

## Gotchas

- Agent concatenates in a loop - **quadratic**: JMH measured 1.3× at 10 iterations but **320× at 10,000**. Never quote a single multiplier for this
- Agent replaces every single-line concatenation with a `StringBuilder` - measured no faster, and less readable; the JIT already handles the single-expression case
- Agent promises a general concatenation speedup from recompiling on 11+ - not reproduced here for `String + String + int`; the gain is concentrated where the Java 8 strategy bailed out, such as `double`
- Agent enables `-XX:+UseStringDeduplication` without measuring - it can *increase* memory when duplicates are few, and it needs G1
- Agent expects deduplication to share the `String` objects - only the backing arrays are shared
- Agent calls `intern()` without sizing the string table - the table is fixed-size, and Oaks measured 2.3 hours against 30 seconds for the same work
- Agent interns strings to make `==` comparison faster - `intern()` walks the string to hash it, exactly as `equals` does
- Agent benchmarks `intern()` while discarding the strings - the table's weak keys clear them, so the benchmark never fills the table
- Agent builds a canonicalising `ConcurrentHashMap` with no bound - a strong-reference leak; bound it or use weak references
- Agent uses `-XX:+PrintStringDeduplicationStatistics` on 11+ - fatal; use `-Xlog:gc+stringdedup*=debug`
- Agent feeds single characters to an encoder or `Reader` - the cost is per call, not per character; encode whole buffers
- Agent relies on the platform default charset - a correctness bug, and the default changed to UTF-8 at Java 18
- Agent claims compact strings give a three-to-ten-times speedup - that only happens in a deliberately heap-starved test; expect a memory reduction and modest GC relief
- Agent leaves `--release 8` in the build and reports the runtime as 25 - the emitted bytecode is still Java 8's

## Related

- [allocation.md](allocation.md) · [collections-performance.md](collections-performance.md) · [heap-analysis.md](heap-analysis.md) · [io-performance.md](io-performance.md) · [object-lifecycle.md](object-lifecycle.md) · [gc-tuning.md](gc-tuning.md) · [methodology.md](methodology.md) · [flags.md](flags.md)
