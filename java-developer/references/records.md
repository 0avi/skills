# Records

A record is a shallowly immutable group of fields with a name.

```java
public record Person(String name, int age) {}
```

Generated: `private final` fields, a canonical constructor, an accessor per component named `name()` **not `getName()`**, plus `equals`, `hashCode` and `toString` over all components. Records are implicitly `final` and cannot extend a class.

**Use records for:** data crossing a boundary (request/response bodies, message payloads, database rows) and domain values (money, identifiers, date ranges).

## Always validate in the compact constructor

This is what makes the record trustworthy everywhere downstream - including in record patterns, where an unvalidated `null` component is awkward to handle.

```java
public record Person(String name, int age) {
  public Person {
    Objects.requireNonNull(name, "name");
    if (name.isBlank()) {
      throw new IllegalArgumentException("name must not be blank");
    }
    if (age < 0) {
      throw new IllegalArgumentException("age must not be negative: " + age);
    }
    name = name.strip();   // assigning the parameter normalises the field
  }
}
```

## Never use an array component

Arrays cannot be made immutable, and every generated member is wrong for them: `equals`/`hashCode` use identity, `toString` prints `[B@1b6d3586`. Fixing it means overriding the accessor, `equals`, `hashCode` and `toString` - at which point the record has bought you nothing.

```java
// ❌
public record Document(String name, byte[] content) {}

// ✅
public record Document(String name, List<Byte> content) {}
public record Document(String name, ByteString content) {}   // or a purpose-built immutable type
```

## Never use a mutable component

A record is only *shallowly* immutable - `final` stops the reference changing, not the object.

```java
// ❌ caller keeps a live reference and can rewrite the invoice
public record Invoice(String reference, List<InvoiceLine> lines) {}

// ✅ defensive copy in the compact constructor
public record Invoice(String reference, List<InvoiceLine> lines) {
  public Invoice {
    lines = List.copyOf(lines);   // copies, freezes, and rejects nulls
  }
}
```

Also avoid components typed as a mutable bean, `Date`, `Calendar`, or `StringBuilder`.

## Prefer basic component types

`String`, `int`, `long`, `BigDecimal`, `LocalDate`, `UUID`, enums, and other records. Enums are especially valuable - they constrain the value to a known set **and** validate it at compile time, needing no constructor check.

Never put a service, connection, lambda, `Clock` or builder in a record. A type holding collaborators is behaviour, not data.

## Check what `toString()` exposes

A record's generated `toString()` prints **every component** - records have no encapsulation at all. If a record carries personal data, credentials, tokens, bank details or tax identifiers, they will land in the logs the first time anyone writes `log.info("processing {}", record)`.

```java
// ❌ logs the NINO and account number in plain text
public record ClientProfile(String reference, String nino, String accountNumber) {}

// ✅ redact
public record ClientProfile(String reference, String nino, String accountNumber) {
  @Override
  public String toString() {
    return "ClientProfile[reference=" + reference + ", nino=***, accountNumber=***]";
  }
}
```

Better: keep sensitive values out of logged records, behind a dedicated type whose own `toString()` is safe.

## Do not use a record when you need

- A computed or lazily cached property.
- To add a field without breaking existing constructor callers.
- One property hidden from serialisation.
- To extend a base class.
- Bean-convention accessors for a framework that reflects over `getName()`.

Records are **fully transparent**, irrevocably. That is what makes destructuring, `equals` and serialisation automatic - and why a record is the wrong tool for anything with a hidden invariant or an evolving representation. Read [beans-vs-records.md](beans-vs-records.md) before committing a codebase to records.

## Rules summary

- Always validate in the compact constructor.
- Never an array component; never a mutable component.
- Prefer basic, immutable component types.
- Check `toString()` for sensitive data; override to redact.
- Never add derived state, lazy caching, or overridden accessors - if you want those, generate a bean.

## Related

- [beans-vs-records.md](beans-vs-records.md) · [record-patterns.md](record-patterns.md) · [sealed-types.md](sealed-types.md) · [immutability.md](immutability.md)
