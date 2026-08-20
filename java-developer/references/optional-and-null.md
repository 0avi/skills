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

// ✅ overloads, and mark the nullable one
public void register(String name) { register(name, null); }
public void register(String name, @Nullable String nickname) { ... }
```

Two things follow from choosing overloads. **Keep them contiguous** - methods sharing a name form one unbroken group with no other member in between, even where modifiers differ, because a reader comparing the overloads should not have to scroll past unrelated code. And **mark the nullable parameter**, since the overload pair is exactly where a reader needs to know which argument may be `null`. That is what [nullness.md](nullness.md) is for.

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

**Those markers already exist.** You do not have to wait for the language feature: JSpecify's `@Nullable` and `@NullMarked` cover parameters, fields, array elements and generic type arguments today, and NullAway checks them. `Optional` on return types plus JSpecify everywhere else is the complete policy, and [nullness.md](nullness.md) is the other half of this page.

## Version notes

`Optional` is Java 8, but **most of the API this page recommends is not**, and the recommended-methods table above spans four releases:

| Member | Since |
| ------ | ----- |
| `map`, `flatMap`, `filter`, `orElse`, `orElseGet`, `orElseThrow(Supplier)`, `ifPresent`, `get` | 8 |
| `or(Supplier)`, `stream()`, `ifPresentOrElse` | 9 |
| `orElseThrow()` no-arg | 10 |
| `isEmpty()` | 11 |

This matters because [java-versions.md](java-versions.md) grants Java 8 an explicit hall pass, and **on Java 8 none of the fluent chains on this page compile**. There, keep the `Optional` return type - that is the part carrying the benefit - and write the fallback with nested `orElseGet` rather than `or`. `Objects.requireNonNullElse` also needs 9, `var` needs 10, and `isBlank()` needs 11.

## Gotchas

- Agent chains `.isPresent()` then `.get()` - the exact shape this page bans
- Agent writes `.get()` - `orElseThrow()` reads the same and names the failure. It needs Java 10; on 8 or 9 use `orElseThrow(NoSuchElementException::new)`
- Agent writes `.orElse(expensive())` - `orElse` always evaluates its argument, even when the value is present. Use `orElseGet`
- Agent maps through a function that can return `null` - `map` folds that into `empty()`, so "absent" and "present but null" become indistinguishable
- Agent returns `Optional<List<T>>` - return an empty list. Absence and emptiness are the same thing for a collection
- Agent puts `Optional` on a record component - it is not `Serializable`, it allocates per instance, and it makes the component's absence expressible two ways
- Agent puts `Optional` on a controller parameter or a `@ConfigurationProperties` field - binders expect a plain value or `null`
- Agent uses `Optional.of` at a boundary where `null` genuinely arrives - `of` throws; `ofNullable` is the adapter
- Agent uses `Optional::stream` or `or` on a Java 8 project - both are Java 9
- Agent wraps an already-`Optional` return in another `Optional` - use `flatMap`, not `map`

## Related

- [nullness.md](nullness.md) - JSpecify `@Nullable` and `@NullMarked`, the other half of this policy
- [var.md](var.md) - the `Opt` suffix for `Optional` locals
- [record-patterns.md](record-patterns.md) - where `null` re-enters via pattern matching
- [switch.md](switch.md) - `case null`
- [exceptions-and-resources.md](exceptions-and-resources.md) - when absence is an exception instead
- [java-versions.md](java-versions.md) - the Java 8 hall pass this page's API surface collides with
