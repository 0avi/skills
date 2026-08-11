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

## Version notes

Records require **Java 16**. The other APIs used on this page are older: `List.copyOf` needs 10, `String.strip()` in the compact constructor needs 11.

| Release | What this page gives you |
| ------- | ------------------------ |
| 8 to 15 | No records at all. Generate an immutable bean instead - see [beans-vs-records.md](beans-vs-records.md) |
| 16 | Records, with the generated members described above |
| 21 | Record patterns, so records become destructurable - see [record-patterns.md](record-patterns.md) |
| 22 | `_` for components a pattern does not need |

Nothing about a record declaration or its generated members changed between 16 and 25: a record written for 16 compiles unchanged on 25.

## Gotchas

- Agent writes `getName()` accessors on a record - the accessor is `name()`, and a framework reflecting for `getName()` finds nothing
- Agent uses a record as a JPA `@Entity` - JPA needs a no-arg constructor and non-final fields. A record can be a DTO or a projection, never an entity
- Agent assigns `this.name = name` inside the compact constructor - the compiler rejects it. Assign the *parameter*; the field assignment is implicit at the end
- Agent writes both a compact and a canonical constructor - rejected. Pick one
- Agent adds an instance field to the record body - rejected. Only `static` fields are permitted
- Agent writes `abstract record`, or `record ... extends` - both rejected. Records are implicitly final and have a fixed superclass
- Agent writes `final record` - legal but redundant, and it reads as though the modifier is doing something
- Agent adds Lombok annotations to a record - the members already exist, and Lombok is banned. See [beans-vs-records.md](beans-vs-records.md)
- Agent copies a collection defensively in the constructor, then overrides the accessor to hand back the caller's original - the copy achieved nothing
- Agent validates inside an accessor rather than the compact constructor - too late, the invalid instance already exists
- Agent keeps an array component and overrides `equals` to fix it - now `hashCode`, `toString` and the accessor all need overriding too, and destructuring still binds an aliased array
- Agent logs a whole record for debugging - the generated `toString()` prints every component, so `ClientProfile[reference=R1, nino=QQ123456C, accountNumber=12345678]` lands in the log verbatim

## Related

- [beans-vs-records.md](beans-vs-records.md) · [record-patterns.md](record-patterns.md) · [sealed-types.md](sealed-types.md) · [immutability.md](immutability.md)
