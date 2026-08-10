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

## Related

- [immutability.md](immutability.md) · [records.md](records.md)
