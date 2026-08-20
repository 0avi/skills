# var

**Use `var` for local variables - go all in, consistently rather than sparingly.** A codebase that uses it only for "obvious" cases draws an arbitrary line nobody agrees on; consistency is what makes it readable.

`var` is not dynamic typing. The type is fixed at compile time and unchanged in the bytecode.

```java
// ✅ identical types, identical bytecode, less noise
var tradesByAccount = new HashMap<String, List<Trade>>();
var reader = new BufferedReader(new FileReader(path));
```

Benefits: removes the redundant left-hand type, fewer imports, smaller diffs, less churn when a return type changes.

**If a user objects that it hides types, point out that Java already infers lambda parameter types and nobody writes `(String s) ->`.** If inference is acceptable there, it is acceptable here.

## Name the data, not the type

This is the condition attached to going all in. `var` shifts the reader's information source from the type to the name, so the name must carry it.

```java
// ❌ the name repeats the type and says nothing
var list = repository.findAll();
var map = new HashMap<String, BigDecimal>();
var str = record.getName();

// ✅ the name says what the data is
var overdueInvoices = repository.findAll();
var balanceByAccount = new HashMap<String, BigDecimal>();
var customerName = record.getName();
```

A `List<Customer>` is rarely "a list of customers" - it is `activeCustomers`, `customersAwaitingReview`, `customersToNotify`.

## Suffix `Optional` locals with `Opt`

```java
var personOpt = findPerson(id);            // Optional<Person>
return personOpt.map(Person::name).orElse("Unknown");
```

Without the suffix, `person.map(...)` reads as though `Person` has a `map` method.

## Keep the explicit type here

| Case | Why |
| ---- | --- |
| Fields, parameters, return types | `var` is illegal - and public signatures should always state their types |
| You want the interface, not the implementation | `List<String> names = new ArrayList<>();` - `var` infers `ArrayList` |
| A numeric literal whose width matters | `long timeoutMillis = 30_000L;` - `var` infers `int` |

`var` also cannot be declared without an initialiser or initialised to `null`; the compiler rejects both.

## One variable per declaration, declared where it is used

Two rules that `var` makes easier to keep rather than harder:

- **One variable per declaration.** `int a, b;` is out. With `var` this is not even a choice: `var a = 1, b = 2;` is rejected outright with `'var' is not allowed in a compound declaration`. The exception is a `for` loop header.
- **Declare a local close to its first use**, not in a block of declarations at the top of the method. Minimising the scope is the point, and it is what lets the name stay short.

Write `long` literals with an uppercase `L` suffix: `30_000L`, never `30_000l`, which is indistinguishable from `30_0001` in most fonts.

## Version notes

`var` for local variables is **Java 10**. `var` for lambda parameters is **Java 11**.

| Position | Since |
| -------- | ----- |
| Local variables, `for` loop variables, try-with-resources | 10 |
| Lambda parameters, as in `(var a, var b) -> ...` | 11 |
| Inside record patterns, where it also signals "not narrowed" | 21, with the patterns themselves |

On Java 8 and 9 there is no `var`, so the "go all in" rule does not apply and the "name the data, not the type" rule becomes the whole of the advice. Nothing about `var` has changed between 10 and 25.

## Gotchas

- Agent writes `var x = null` or `var x;` - both rejected. `var` needs an initialiser with an inferable type
- Agent uses `var` for a field or a method parameter - rejected. It is local variables only
- Agent writes `var a = 1, b = 2;` - rejected with `'var' is not allowed in a compound declaration`. Split it into two lines
- Agent writes a `long` literal with a lowercase `l` suffix - use `L`; `30_000l` reads as `30_0001`
- Agent writes `var names = new ArrayList<String>()` and then passes it where `List<String>` is expected by reference-assigning it elsewhere - `var` infers `ArrayList<String>`, the implementation type, which leaks into anything inferring from it
- Agent writes `var total = 0` and assigns a `long` later - inferred `int`, so the assignment fails or silently truncates. Declare `long total = 0`
- Agent writes `var result = someMethod()` where the method returns a wildcard or intersection type - the inferred type can be unnameable, and the error surfaces far from the declaration
- Agent uses `var` with a diamond, as in `var list = new ArrayList<>()` - infers `ArrayList<Object>`, which is almost never wanted
- Agent applies `var` only to "obvious" cases - the arbitrary line is the thing this page argues against. Be consistent
- Agent keeps a name like `list`, `map` or `str` after switching to `var` - the name is now the reader's only information source
- Agent drops the `Opt` suffix on an `Optional` local - `person.map(...)` then reads as though `Person` has a `map` method

## Related

- [record-patterns.md](record-patterns.md) - `var` inside record patterns, where it changes meaning, not just verbosity
- [optional-and-null.md](optional-and-null.md)
