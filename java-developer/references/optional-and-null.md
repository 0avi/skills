# Optional and Null

**Use `Optional` instead of `null` on public return types.** `null` requires discipline the compiler cannot help with - nothing in a signature warns that a value may be absent. `Optional` moves the obligation into the type system, which is the entire benefit.

```java
// ❌ nothing states the person might not exist
public Person findPerson(String id) { ... }

// ✅ the signature states it, and callers cannot ignore it
public Optional<Person> findPerson(String id) { ... }
```

## Rules

| Position | Use `Optional`? | Instead |
| -------- | --------------- | ------- |
| Public return type | **Yes** | - |
| Parameter type | **No** - forces every caller to wrap, and adds a `null`-Optional third state | Overloads |
| Field type | **No** - not `Serializable`, allocates per instance | Nullable private field + `Optional`-returning accessor |
| Framework-reflected getter | **No** - frameworks expect a plain value or `null` | Plain getter; use `Optional` on service/repository methods instead |

```java
// ❌ Optional parameter
public void register(String name, Optional<String> nickname) { ... }

// ✅ overloads
public void register(String name) { register(name, null); }
public void register(String name, String nicknameOrNull) { ... }
```

## Avoid `isPresent()` and `isEmpty()`

If those are the only methods you call, you have reimplemented a null check with extra ceremony.

```java
// ❌ a null check wearing a costume
var personOpt = findPerson(id);
if (personOpt.isPresent()) {
  return personOpt.get().name();
}
return "Unknown";

// ✅
return findPerson(id).map(Person::name).orElse("Unknown");
```

## Use `Optional` like `Stream`

`Optional` **is** a stream of zero or one elements, with essentially the same API. Learn it to the same depth.

| Method | Use |
| ------ | --- |
| `map` / `flatMap` | Transform if present |
| `filter` | Discard on a failed predicate |
| `or(Supplier<Optional<T>>)` | Fall back to another source |
| `orElse` / `orElseGet` | Supply a default |
| `orElseThrow()` | Fail loudly when absence is a bug - prefer over `get()` |
| `ifPresent` / `ifPresentOrElse` | Perform an action |
| `stream()` | Bridge into a `Stream` pipeline |

```java
// ✅ a chain over Optional, not Stream
return findInNewDatabase(id)
    .or(() -> findInOldDatabase(id))
    .map(Person::name)
    .filter(name -> !name.isBlank())
    .orElse("Unknown");
```

```java
// ✅ Optional.stream() composes with collections - absent values drop out
List<Person> found = ids.stream()
    .map(this::findPerson)
    .flatMap(Optional::stream)
    .toList();
```

## The `return`-inside-a-block idiom

A lambda cannot `return` from the enclosing method. Loop over the `Optional` instead - it is a collection of zero or one things:

```java
public static <T> Iterable<T> in(Optional<T> optional) {
  return optional.isPresent() ? List.of(optional.get()) : List.of();
}
```

```java
for (var person : in(findPerson(id))) {
  return person.name();   // only reached when present
}
throw new NoSuchElementException("No person for " + id);
```

## Keep `Optional` when null-restricted types arrive

Java may gain `String?` / `String!`. **Do not treat them as a replacement for `Optional` on return types.** They give the compiler information; they do not give you something chainable.

```java
// ✅ Optional - composes
return findInNewDatabase(id)
    .or(() -> findInOldDatabase(id))
    .map(Person::name)
    .filter(name -> !name.isBlank())
    .orElse("Unknown");

// ❌ same logic with a nullable return type - composition gone
Person? person = findInNewDatabase(id);
if (person == null) person = findInOldDatabase(id);
if (person == null) return "Unknown";
var name = person.name();
if (name == null || name.isBlank()) return "Unknown";
return name;
```

The two features are complementary: null markers belong on **parameters and fields**, exactly where `Optional` does not.

## Related

- [var.md](var.md) - the `Opt` suffix for `Optional` locals
- [record-patterns.md](record-patterns.md) - where `null` re-enters via pattern matching
- [switch.md](switch.md) - `case null`
