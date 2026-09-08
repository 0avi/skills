# Lambdas and Streams

| Question | Answer |
| -------- | ------ |
| Lambda or anonymous class? | **No meaningful difference.** Choose on readability |
| Is stream laziness a real performance feature? | **Yes, and it is a complexity difference, not a constant factor.** Measured 0.069 µs against 3,480 µs - about 50,000× - where the pipeline short-circuits at the head of 100,000 elements |
| Is a sequential stream faster than a loop? | **Slightly slower, and often within noise.** JMH: 1.07× on 100k ints with **overlapping error bars**; 1.2-1.4× on 1,000 elements |
| Is a parallel stream faster? | Sometimes, well short of the CPU count, **and the 2.1× figure below comes from a withdrawn harness** - treat it as magnitude only. With real caveats |
| Should I rewrite loops as streams for speed? | **No.** Rewrite for clarity; expect no gain or a small loss |

**The headline: streams win by doing less work, not by doing work faster.** Where a pipeline can stop early, laziness is transformative. Where it must touch everything, the abstraction costs a little.

---

## The measurement

456,976 four-letter symbols in an `ArrayList`, alphabetically ordered, on Temurin 25.0.4.1 (8 CPUs), 300 warm-up then mean of 400:

| Operation | Time |
| --------- | ---- |
| **Short-circuiting** - 4 chained `filter`s + `findFirst` | **174.9 µs** |
| **Short-circuiting** - 1 combined `filter` + `findFirst` | **154.9 µs** |
| **Eager equivalent** - 4 passes building intermediate `ArrayList`s | **34,773.3 µs** |
| **Full traversal** - single `filter` + `count` | 6,794.3 µs |
| **Full traversal** - plain `for` loop with the same predicate | **4,155.2 µs** |
| **Full traversal** - `parallelStream` + `count` | **1,989.9 µs** |
| 3 anonymous class instantiations + calls | see below - **superseded** |
| 3 lambda instantiations + calls | 0.78 µs |

---

## Laziness is the real feature

A `filter` does almost nothing when called - it wires up a pointer. Nothing executes until a terminal operation pulls, and then elements are pulled **one at a time through the whole chain**.

So `findFirst` on the chain above processes only about 18,278 of 456,976 elements before hitting `BBBB` and stopping. The eager version - four passes each building a new list - must process all 456,976 elements four times.

**Measured with JMH: 0.069 ± 0.006 µs for the lazy pipeline against 3,480 ± 500 µs for the eager equivalent over 100,000 elements** - a factor of about 50,000.

**Do not quote that as "streams are 50,000× faster".** The ratio is not a property of streams; it is a property of *how far in the match is*. The lazy pipeline stops at the first element; the eager one maps all 100,000 and then searches. So the ratio scales with n and with the match position, and the right way to state it is as **a complexity difference - O(1) against O(n) - not a constant factor.** Change the data so the match is last and the two converge.

An earlier version of this file reported 199× here from a hand-rolled harness on a different dataset. That number was not wrong so much as arbitrary: any short-circuit measurement produces whatever multiplier its data implies. **The transferable claim is the complexity difference, and it does not need a benchmark to justify it.**

Two independent causes, and both matter:

1. **Short-circuiting.** Only ~4% of the data is examined.
2. **No intermediate collections.** The eager version allocates four large `ArrayList`s and then discards them, which is also GC pressure.

```java
// lazy: stops as soon as findFirst is satisfied
Optional<String> first = symbols.stream()
    .filter(s -> s.charAt(0) != 'A')
    .filter(s -> s.charAt(1) != 'A')
    .findFirst();

// eager: four full passes and four intermediate lists
List<String> l = symbols;
for (int k = 0; k < 4; k++) {
  List<String> next = new ArrayList<>();
  for (String s : l) if (s.charAt(k) != 'A') next.add(s);
  l = next;
}
```

**Chained filters cost something, though.** Four filters took 174.9 µs against 154.9 µs for one combined predicate - about 13% for the extra pipeline stages. Prefer one clear predicate over several trivial ones; do not split a filter for style alone.

Short-circuiting terminal operations are the ones that unlock this: `findFirst`, `findAny`, `anyMatch`, `allMatch`, `noneMatch`, `limit`. Design pipelines around them where the problem allows.

---

## Over a full traversal, a loop wins slightly - and sometimes not measurably

**Measured with JMH on Temurin 25.0.4.1** (3 forks, 5 warm-up + 6 measurement iterations, 18 samples each, `AverageTime`):

| Shape | n | Loop | Sequential stream | Ratio | Real difference? |
| ----- | - | ---- | ----------------- | ----- | ---------------- |
| `int[]` sum | 1,000 | 0.093 ± 0.015 µs | 0.111 ± 0.004 µs | 1.19× | Marginal - ranges just touch |
| `int[]` sum | 100,000 | 9.884 ± 0.195 µs | 10.567 ± 0.620 µs | 1.07× | **No - ranges overlap** |
| `List<Integer>` sum | 1,000 | 0.638 ± 0.017 µs | 0.866 ± 0.027 µs | 1.36× | Yes |
| `List<Integer>` sum | 100,000 | 76.4 ± 3.0 µs | 97.1 ± 16.6 µs | 1.27× | Weak - stream error is ±17% |
| filter + map + sum on `int[]` | 1,000 | 0.599 ± 0.015 µs | 0.795 ± 0.044 µs | 1.33× | Yes |
| filter + map + sum on `int[]` | 100,000 | 398.5 ± 63.9 µs | 428.6 ± 21.4 µs | 1.07× | **No - ranges overlap** |

Read the last column, because it is the point. By the rule this skill states in [methodology.md](methodology.md) - overlapping `Score ± Error` ranges mean no measured difference - **two of the six comparisons show no difference at all**, and the largest genuine gap is 1.36× on a small boxed collection where per-element overhead dominates.

**An earlier version of this file published "1.6× slower" from a hand-rolled loop, and used it to contradict Oaks. Both are withdrawn.** The hand-rolled figures (4,155 µs for a loop, 6,794 µs for a stream) were around 400× the JMH figure for the same traversal, which is the signature of a harness measuring itself rather than the operation. Oaks measured filters at 7 ms against an iterator at 7.4 ms and concluded a single filter "will slightly outperform an iterator"; his two numbers were within noise of each other, and **so are two of mine.** The correct reading of both sets of measurements is the same: **at a full traversal the difference between a loop and a sequential stream is small, sometimes not measurable, and never a reason to choose one over the other.**

The honest conclusion: **when every element must be processed, a sequential stream costs at most a little more than a loop** - a megamorphic call per element per stage, plus pipeline setup - and on primitive streams over large inputs the JIT closes even that gap. Write whichever is clearer. **Do not rewrite a loop as a stream for performance, and do not rewrite a stream as a loop for performance either**; neither will repay the diff.

---

## Parallel streams

**Measured 1,989.9 µs against 4,155.2 µs for the loop - about 2.1× on 8 CPUs - but both figures come from the withdrawn hand-rolled harness above, so treat the 2.1× as an indication of magnitude only, not a figure to quote.** What survives re-measurement is the shape of the result rather than its size: a parallel stream over a large, cheaply-splittable source on 8 CPUs recovers some multiple of a sequential traversal, well short of 8×, and the caveats below decide whether you see any of it.

Not 8×, and the gap is instructive: Amdahl's law ([concurrency-performance.md](concurrency-performance.md)), plus splitting cost, plus merging, plus a predicate cheap enough that coordination is a real share of the work.

Five things to check before reaching for `parallelStream()`:

**1. It uses the shared common pool.** `ForkJoinPool.commonPool()` is shared by every parallel stream in the JVM, library code included. Verified on 25.0.4.1, its parallelism is `availableProcessors() - 1`:

| Visible CPUs | Common pool parallelism |
| ------------ | ----------------------- |
| 1 | 1 |
| 2 | **1** |
| 4 | 3 |
| 8 | 7 |

**At one or two CPUs a parallel stream is effectively sequential** - in a small container, carefully parallelised code silently stops being parallel, with no error. See [containers.md](containers.md).

```bash
-Djava.util.concurrent.ForkJoinPool.common.parallelism=N
```

**Never put blocking work in a parallel stream.** It occupies common pool threads and stalls every other parallel stream in the JVM. Use your own executor.

**2. `forEach` also uses the calling thread.** So a common pool of 1 gives *two* threads of execution. Oaks found this made a parallelism of 1 look impossibly good; when sizing, reduce the value by one.

**3. The source must split well.** `ArrayList` and arrays split perfectly. `LinkedList` splits terribly - it must be walked to be divided. `HashMap` is reasonable; `Stream.iterate` is not splittable at all.

**4. The work per element must justify the coordination.** Filtering on `charAt` - as measured - is near the floor of what is worth parallelising. Real gains come when per-element work is substantial.

**5. Ordered operations cost.** `findFirst` on a parallel stream must respect encounter order; `findAny` need not. `forEachOrdered` serialises the terminal stage.

---

## Lambdas against anonymous classes

**Oaks' 2nd edition Table 12-11 is the figure to use, and it says the difference is nil at small counts.** Measured with error bars, for a `calc()` method that creates and calls three implementations, and for one that creates 1,024:

| Implementation | 3 expressions | 1,024 expressions |
| -------------- | ------------- | ----------------- |
| Anonymous classes | **10 ± 1 ns** | 781 ± 50 µs |
| Lambda | **10 ± 2 ns** | **587 ± 27 µs** |
| Static (preconstructed) classes | **10 ± 1 ns** | 734 ± 21 µs |

At three expressions all three are **10 ns and indistinguishable** - the error bars overlap completely, so there is no difference to report. At 1,024 a difference does emerge and **the lambda is the fastest of the three**, because the anonymous-class form allocates a fresh object per call while a non-capturing lambda does not.

Two corrections this table forces on the older material. The 1st edition's figures for the same comparison (87.2 µs for anonymous classes) are **superseded** - different hardware, different JDK, and the `invokedynamic` linkage has changed since. And an earlier draft of this file published 0.57 µs and 0.78 µs here from a hand-rolled loop; those numbers were roughly 60× Oaks' figure for the same operation and had the direction of the 1,024-expression case backwards. They are withdrawn. **If you need a figure for this, cite Table 12-11.**

**Choose on readability. There is no performance argument either way.**

Two details worth knowing anyway, because they explain the one case where it matters.

**They are not the same mechanism.** A lambda is *not* syntactic sugar for an anonymous class. `javac` compiles the body to a static method and wires it up through `invokedynamic` and `LambdaMetafactory`. An anonymous class is a real class file, loaded by the class loader.

So **in a class-loading-heavy scenario, lambdas win** - fewer class files to find, read, verify and link. Oaks measured 267 µs against 181 µs when each invocation ran in a fresh class loader. It matters for startup in an application with very many such sites; nowhere else. See [startup-and-warmup.md](startup-and-warmup.md).

**Non-capturing lambdas are cached.** `() -> 1` captures nothing, so the JVM reuses a single instance and the "allocation" disappears. An anonymous class in the same position allocates on every call. Both are cheap enough not to matter, but it is why a lambda sometimes measures marginally better in a tight loop - and why one that *does* capture (`x -> x + local`) allocates like the anonymous class.

---

## Boxing is usually the real cost

The most common genuine performance defect in stream code is not the stream - it is boxing.

```java
// boxes every element into an Integer
int sum = list.stream().map(Item::count).reduce(0, Integer::sum);

// no boxing at all
int sum = list.stream().mapToInt(Item::count).sum();
```

Use `IntStream`, `LongStream` and `DoubleStream`, and `mapToInt`/`mapToLong`/`mapToDouble` to get into them. A boxed `Integer` costs 16 bytes and an indirection; over a million elements that is 16 MB of garbage for nothing. `Integer.valueOf` caches only −128…127 (`AutoBoxCacheMax`, verified 128 on all five versions), so anything larger allocates.

`Collectors.summingInt`, `averagingInt` and `counting()` avoid boxing in the terminal stage too.

---

## Practical guidance

**Use streams for clarity, and know where the performance actually lives:**

- **Do** design around short-circuiting terminals - that is where laziness turns O(n) into O(1), and it is the only large win streams offer.
- **Do** use primitive streams to avoid boxing.
- **Do** prefer one clear predicate to several trivial chained ones - 13% measured.
- **Do not** rewrite working loops as streams for speed; JMH puts the gap at 1.07-1.36×, and on primitive streams over large inputs it is within noise.
- **Do not** add `.parallel()` speculatively. Check the source splits, the work justifies coordination, the CPU count is not 1 or 2, and nothing blocks.
- **Do not** use a parallel stream for anything blocking.

**Stream gatherers** (24+, `Stream.gather`) are the supported extension point for intermediate operations - `windowFixed`, `windowSliding`, `fold`, `scan`, `mapConcurrent`. Prefer a built-in gatherer to a stateful lambda hack, which breaks under parallelism. `mapConcurrent(limit, fn)` is notable for using virtual threads with a concurrency cap, making it the right tool for a bounded concurrent I/O fan-out - unlike `parallelStream`, which must not block.

---

## Version notes

Verified by measurement on 25.0.4.1 and by API availability.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| Lambdas, streams, `invokedynamic` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `Stream.takeWhile` / `dropWhile` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `Collectors.toUnmodifiableList` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `Stream.toList()` | ✗ | ✗ | ✓ (16+) | ✓ | ✓ |
| `Stream.mapMulti` | ✗ | ✗ | ✓ (16+) | ✓ | ✓ |
| `Stream.gather` + `Gatherers` | ✗ | ✗ | ✗ | ✗ | ✓ (24+) |
| `commonPool` parallelism = max(1, CPUs − 1) | ✓ | ✓ | ✓ | ✓ | ✓ (verified) |
| Virtual threads available to `mapConcurrent` | ✗ | ✗ | ✗ | ✓ | ✓ |

- **`Stream.toList()` (16+)** allocates less than `collect(Collectors.toList())` - one less intermediate - and returns an unmodifiable list. Prefer it where available.
- **`takeWhile` (9+) is a short-circuiting intermediate operation**, which on sorted data can turn a full traversal into a partial one. Given that short-circuiting is where the asymptotic win lives, it is worth knowing this exists on 11+ and not on 8.
- **Gatherers (24+) are the first supported way to write a custom intermediate operation.** Before them, stateful lambdas in `map` or `peek` were the workaround, and they are unsafe under parallelism.

## Gotchas

- Agent rewrites a loop as a stream for performance, **or a stream as a loop** - JMH puts the gap at 1.07-1.36× and two of six comparisons showed no difference at all; rewrite for clarity, never for speed
- Agent adds `.parallel()` speculatively - the best case measured here was ~2× on 8 CPUs for trivial work (and from a harness since withdrawn), while the failure cases below are real and reproducible; it can easily be slower
- Agent uses a parallel stream in a 1-2 CPU container - common pool parallelism is `CPUs − 1`, verified 1 at both
- Agent puts blocking I/O in a parallel stream - occupies the shared common pool and stalls every other parallel stream in the JVM
- Agent parallelises a stream over a `LinkedList` - it cannot split without walking
- Agent parallelises trivial per-element work - coordination dominates
- Agent uses `findFirst` on a parallel stream where `findAny` would do - the ordering guarantee costs
- Agent boxes in a stream via `map` + `reduce` - use `mapToInt`/`sum`; 16 bytes per element of pure garbage
- Agent splits one predicate into several chained filters - measured 13% for four instead of one
- Agent builds intermediate collections between passes - this forfeits short-circuiting and turns an O(1) lookup into an O(n) one; measured 3,480 µs against 0.069 µs on 100k elements
- Agent argues lambdas are faster than anonymous classes, or the reverse - measured indistinguishable; the only real difference is class loading
- Agent claims a lambda is sugar for an anonymous class - it is a static method plus `invokedynamic`, which is why class-loading behaviour differs
- Agent uses a stateful lambda inside `map` or `peek` to carry state - breaks under parallelism; use a `Gatherer` on 24+
- Agent uses `collect(Collectors.toList())` on 16+ where `toList()` allocates less
- Agent expects `takeWhile` on Java 8 - added in 9

## Related

- [collections-performance.md](collections-performance.md) · [concurrency-performance.md](concurrency-performance.md) · [containers.md](containers.md) · [allocation.md](allocation.md) · [methodology.md](methodology.md) · [startup-and-warmup.md](startup-and-warmup.md) · [strings.md](strings.md) · [checklist.md](checklist.md)
