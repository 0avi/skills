# Data-Oriented Programming

Records, sealed types, patterns and enums are pieces of **one** design style, not four unrelated features. Use them together.

| Feature | Role | Expresses |
| ------- | ---- | --------- |
| **Records** | Compose data | **AND** — a `Person` is a name *and* an age *and* an address |
| **Sealed types** | Constrain data | **OR** — an `Address` is a street address *or* a military address |
| **Patterns** | Operate on data | Test, extract and bind, over nested structures |
| **Enums** | Validate data | **ONE OF** — a closed set, checked at compile time |

State the shape of the domain, then let the compiler check the code handles all of it:

```java
public enum FilingStatus { DRAFT, SUBMITTED, ACCEPTED, REJECTED }

public sealed interface Address permits StreetAddress, MilitaryAddress {}
public record StreetAddress(String line, String city, String postcode) implements Address {}
public record MilitaryAddress(String unit, String bfpo) implements Address {}

public record Client(String reference, Address address, FilingStatus status) {
  public Client {
    Objects.requireNonNull(reference, "reference");
    Objects.requireNonNull(address, "address");
    Objects.requireNonNull(status, "status");
  }
}

// behaviour lives outside the data; the compiler proves this is complete
static String postalLabel(Client client) {
  return switch (client) {
    case Client(var ref, StreetAddress(var line, var city, var postcode), _)
        -> ref + "\n" + line + "\n" + city + "\n" + postcode;
    case Client(var ref, MilitaryAddress(var unit, var bfpo), _)
        -> ref + "\n" + unit + "\nBFPO " + bfpo;
  };
}
```

(The `_` for the unused `status` component requires **Java 22**; on 21 write `var ignoredStatus`.)

No `default`, no `instanceof` chain, no `getClass()` comparison — and adding a third `Address` alternative breaks the build until handled.

## Move away from the middle ground

| Object-oriented | Bean world | **Data-oriented** |
| --------------- | ---------- | ----------------- |
| Mutable objects | Mutable-ish beans | **Immutable** records |
| Inheritance | Composition, loosely | Sealed choices |
| Encapsulated state | Selectively exposed | **Transparent** data |
| Behaviour with the data | Data in beans, behaviour in services | Behaviour separate and stateless |
| Polymorphic dispatch | Ad hoc | Pattern matching |
| Open extension | Open extension | Closed, enumerable alternatives |

Most Java sits in the middle column — half-mutable, types that are partly data and partly behaviour. **Push towards the right-hand column, and above all towards immutability.**

## Where records belong

```
  HTTP/JSON  ──▶  record  ──▶  service logic  ──▶  record  ──▶  database
  (boundary)      (data)       (behaviour)         (data)       (boundary)
```

- **JSON → record inbound.** A payload is a snapshot of what the caller sent; it never needs to change afterwards.
- **Record → database outbound.** A row written or read is data at a point in time.

## Validate at the boundaries

- Validate on **construction**, in the record's compact constructor, so an invalid instance cannot exist.
- Do it at the **edge**: deserialisation, request handling, message consumption, file parsing.
- **Do not re-validate internally.** If every method defensively re-checks, you have doubled the code for nothing.
- **Let types carry the validation.** A `FilingStatus` enum cannot hold nonsense; a `String status` can. A `LocalDate` cannot be 31 February; a `String` can.

## Keep component types simple

`String`, `int`, `long`, `BigDecimal`, `LocalDate`, `UUID`, enums, other records. Never a service, connection, lambda, `Clock` or builder — a type holding collaborators is behaviour, keep it in a class.

## It is a whole-system commitment

**Half-adopting this is worse than not adopting it.** A codebase where some payloads are records and some are mutable beans, some hierarchies sealed and some open, some types validating on construction and some in a service, gets the costs of both styles and the benefits of neither — and because frameworks take different code paths for records and beans, the inconsistency shows up as behavioural surprises rather than untidiness.

Decide at system level, record the decision, apply it consistently:

- Keep data separate from behaviour.
- Keep data immutable.
- Records for AND, sealed for OR, patterns to operate, enums to validate.
- Validate at the boundaries; trust the interior.

## Related

- [records.md](records.md) · [sealed-types.md](sealed-types.md) · [patterns.md](patterns.md) · [record-patterns.md](record-patterns.md) · [switch.md](switch.md) · [immutability.md](immutability.md) · [beans-vs-records.md](beans-vs-records.md)
