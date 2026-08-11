# Immutable Collections

## Which API to use

| API | Immutable? | Use for |
| --- | ---------- | ------- |
| `List.of` / `Set.of` / `Map.of` | Yes | Literal collections. Reject `null`; randomised iteration order - see below |
| `List.copyOf` / `Set.copyOf` / `Map.copyOf` | Yes | **Defensive copies.** Copies *and* freezes |
| `Stream.toList()` | Yes | Terminal stream operation - prefer over `Collectors.toList()`, which returns a mutable `ArrayList` |
| Guava `ImmutableList` / `ImmutableSet` / `ImmutableMap` | Yes | When iteration order matters, or you need a builder |
| `Collections.unmodifiable*` | **No** | Avoid - a read-only *view* over a collection someone else may still mutate |

## Never rely on `Set.of` / `Map.of` iteration order

`Set.of` and `Map.of` deliberately randomise iteration order **on every JVM run** (the salt derives from JVM start time). Anything that iterates, streams, or calls `toString()` on them is non-deterministic across runs. This silently produces tests that pass locally and fail in CI.

```java
// ❌ FLAKY - order differs every run
var codes = Map.of("GB", 44, "FR", 33, "BE", 32);
assertEquals("{GB=44, FR=33, BE=32}", codes.toString());

// ✅ assert on content
assertEquals(44, codes.get("GB"));
assertEquals(Map.of("GB", 44, "FR", 33, "BE", 32), codes);   // Map.equals ignores order
```

When order is part of the contract, use a type that guarantees it:

```java
// ✅ Guava - immutable and insertion-ordered
var codes = ImmutableMap.of("GB", 44, "FR", 33, "BE", 32);

// ✅ JDK only
Map<String, Integer> codes = Collections.unmodifiableMap(
    new LinkedHashMap<>(Map.of("GB", 44, "FR", 33, "BE", 32)));
```

There is no `SequencedMap.of` / `SequencedSet.of` factory, so Guava is the cleaner answer where order matters. `List.of` is unaffected - lists are ordered by definition.

## Rules

- Default to `List.of` / `Set.of` / `Map.of` for literals, `copyOf` for defensive copies.
- Use `Stream.toList()`, not `Collectors.toList()`.
- Never let a test, log format or serialised output depend on `Set.of` / `Map.of` order.
- Remember `Set.of` / `Map.of` throw on `null` elements and on duplicate keys - they are not drop-in replacements for a `HashMap` that tolerated either.

## Version notes

The table at the top of this page spans five releases, and the two entries it recommends most are the two newest:

| API | Since |
| --- | ----- |
| `Collectors.toList()`, `Collections.unmodifiable*` | 8 |
| `List.of` / `Set.of` / `Map.of` | 9 |
| `List.copyOf` / `Set.copyOf` / `Map.copyOf` | 10 |
| `Stream.toList()` | 16 |
| `SequencedCollection`, so `getFirst()` / `getLast()` / `reversed()` | 21 |

On Java 8 none of the factory methods exist: use `Collections.unmodifiableList(new ArrayList<>(...))` and accept that it is a view over a copy you control. `Stream.toList()` is Java 16, so on 8 to 15 `Collectors.toList()` is the only option and the mutability caveat above stands unavoidably.

## Gotchas

- Agent treats `Stream.toList()` and `List.copyOf(...)` as interchangeable - both are unmodifiable, but **`Stream.toList()` accepts `null` elements and `List.copyOf` throws `NullPointerException`**. They are not the same guarantee
- Agent calls `Map.of` with more than ten pairs - rejected at compile time; `Map.of` has a ten-pair ceiling. Use `Map.ofEntries`, or Guava's builder
- Agent migrates a `HashMap` that held a `null` value to `Map.of` - throws `NullPointerException` at construction, not at use
- Agent migrates a map that had a duplicate key to `Map.of` - throws `IllegalArgumentException`, where `HashMap` silently kept the last value
- Agent writes `List.of(null)` - it compiles, then throws at runtime. The compiler will not catch this one
- Agent reaches for `Collections.unmodifiableList` for a defensive copy - it wraps a live list. Mutating the original is visible through the wrapper; `copyOf` snapshots
- Agent asserts on `Map.of(...).toString()` or on the first element of a `Set.of` - the order differs between JVM runs, so it passes locally and fails in CI
- Agent fixes a flaky order-dependent test by sorting the assertion instead of using an ordered type - use `ImmutableMap` or a `LinkedHashMap` when order is part of the contract
- Agent calls `.add()` on a `Stream.toList()` result expecting an `ArrayList` - it is `ImmutableCollections$ListN` and throws `UnsupportedOperationException`
- Agent uses `Set.of` for a value that arrives from user input where duplicates are possible - duplicates throw rather than collapse

## Related

- [immutability.md](immutability.md) · [records.md](records.md)
