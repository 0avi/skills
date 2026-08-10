# var

**Use `var` for local variables — go all in, consistently rather than sparingly.** A codebase that uses it only for "obvious" cases draws an arbitrary line nobody agrees on; consistency is what makes it readable.

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

A `List<Customer>` is rarely "a list of customers" — it is `activeCustomers`, `customersAwaitingReview`, `customersToNotify`.

## Suffix `Optional` locals with `Opt`

```java
var personOpt = findPerson(id);            // Optional<Person>
return personOpt.map(Person::name).orElse("Unknown");
```

Without the suffix, `person.map(...)` reads as though `Person` has a `map` method.

## Keep the explicit type here

| Case | Why |
| ---- | --- |
| Fields, parameters, return types | `var` is illegal — and public signatures should always state their types |
| You want the interface, not the implementation | `List<String> names = new ArrayList<>();` — `var` infers `ArrayList` |
| A numeric literal whose width matters | `long timeoutMillis = 30_000;` — `var` infers `int` |

`var` also cannot be declared without an initialiser or initialised to `null`; the compiler rejects both.

## Related

- [record-patterns.md](record-patterns.md) — `var` inside record patterns, where it changes meaning, not just verbosity
- [optional-and-null.md](optional-and-null.md)
