# Beans vs Records

**Records do not replace beans.** They are a different language feature with different semantics, and converting one to the other is not a syntactic change. Decide per system which you are using, and apply it consistently.

## Say "bean", not "JavaBean"

The JavaBeans specification (1997) is about components manipulated visually in a builder: `BeanInfo`, `PropertyEditor`, `Introspector`, AWT event handling, arrays rather than collections. Almost nothing modern uses any of it.

What we write took the `get` / `is` / `set` naming convention and discarded the rest, so "bean" is an **entirely informal** convention with no specification. The practical consequence to remember: **every framework implements its own reader and writer, and they differ** - on boolean `is` vs `get`, on constructor vs setter binding, on how records are handled, on how `Optional` is handled. Framework surprises usually trace back to this.

## The differences that matter

| | Bean | Record | Generated bean |
| --- | --- | --- | --- |
| Accessor naming | `getName()` / `isActive()` | `name()` / `active()` | Configurable |
| Mutable | Usually yes | **No** | Choice (usually immutable) |
| Encapsulation | Selective | **None - fully transparent** | Selective |
| `equals` / `hashCode` / `toString` | Hand-written or IDE-pasted, and rots | Generated, always correct | Generated, always correct |
| Builder | No | No | **Yes** |
| Derived / computed properties | Yes | Awkward | Yes |
| Can extend a class | Yes | **No** | Yes |
| Destructurable by a record pattern | No | **Yes** | No |
| Add a property compatibly | Yes | Constructor signature changes | Yes |
| Framework support | Broad, mature | Varies - **different code path** | Broad (it *is* a bean) |

## The cliff edge

The record syntax is attractive enough that people convert for the syntax alone, then hit the limits in the table above. The sharpest failure: **frameworks frequently take a completely different code path for records** - different constructor discovery, accessor discovery, validation and null handling. A conversion that looks purely cosmetic can change runtime behaviour.

Pick one and be disciplined:

- **All in on records** - accept the limits. Validate at the boundary, keep components simple, never reach for computed properties or inheritance. Suits the data-oriented style; see [data-oriented-programming.md](data-oriented-programming.md).
- **Or an explicit split** - e.g. records for inbound/outbound payloads and domain values; beans for anything a framework owns or anything with behaviour.

**Ad hoc conversion because the syntax is nicer is the failure mode.** A codebase half-way across the cliff edge gets the costs of both styles and the benefits of neither, and the inconsistency surfaces as behavioural surprises rather than untidiness.

## Generate beans - never hand-write them

Do not hand-write `equals` / `hashCode` / `toString`, and do not let the IDE paste them: IDE output is a snapshot, so adding a field six months later leaves them silently wrong.

| Tool | Verdict |
| ---- | ------- |
| [Immutables](https://immutables.github.io/) | **Adopt.** Standard annotation processor; immutable implementations with builders from an abstract type or interface |
| [Joda-Beans](https://www.joda.org/joda-beans/) | **Adopt.** Annotation processor plus a runtime meta-bean model - a properly specified reflection API rather than the informal convention |
| [Lombok](https://projectlombok.org/) | **Avoid.** It does not generate source - it mutates the compiler's AST through an internal API it is not supposed to use. So it breaks on new JDK releases and has to be fixed before you can upgrade, it confuses IDEs, debuggers and coverage tools, and the code you read is not the code that compiles. The annotation processors above produce real, readable, debuggable source and cost nothing extra |

**A generated immutable bean is frequently the better answer than a record** for long-lived types: immutability and correctness, without the transparency, the constructor-arity fragility, or the accessor-naming mismatch.

On an existing Lombok codebase, match the surrounding code and raise it rather than mixing styles file by file. Removing Lombok is its own change, on its own commit.

## Rules summary

- Record when the type is a transparent bundle of data with a stable shape.
- Generated immutable bean when you need a builder, evolvability, derived properties, or bean-convention accessors.
- Mutable bean only where a framework demands one - confined to that boundary.
- If you must hand-write `equals`, use the pattern idiom in [patterns.md](patterns.md).

## Version notes

The comparison on this page only becomes a decision from **Java 16**, where records exist. Below that the answer is always a bean, and the only question is whether it is generated or hand-written - generated, per this page.

| Consideration | Version detail |
| ------------- | -------------- |
| Records as an option at all | 16 |
| Records destructurable by a pattern, which is a real advantage over beans | 21 |
| Immutables, Joda-Beans | Annotation processors, so they follow your compiler rather than the language version |
| Lombok | Versioned against the JDK's internal compiler API, so a JDK upgrade can be blocked until Lombok catches up |

That last row is the version-specific reason for the verdict, not a matter of taste: because Lombok manipulates the compiler's AST through an internal API, each new JDK release can break it, and the project cannot upgrade until a fixed Lombok ships. An annotation processor generating ordinary source has no such coupling.

## Gotchas

- Agent converts beans to records file by file because the syntax is nicer - that is the cliff edge this page is about. Decide per system
- Agent converts a bean a framework binds to, and assumes the behaviour is identical - frameworks frequently take a different code path for records, with different constructor discovery, validation and null handling
- Agent adds a derived or lazily computed property to a record - that is the signal a generated bean was the right choice
- Agent adds a field to a record used across a module boundary - the canonical constructor signature changes and every caller breaks. A bean adds a property compatibly
- Agent hand-writes or IDE-pastes `equals` / `hashCode` / `toString` - a snapshot that rots the next time a field is added
- Agent adds Lombok to a codebase that does not have it - the verdict is avoid
- Agent strips Lombok out of a file it is touching for an unrelated reason - removing Lombok is its own change on its own commit
- Agent writes `getName()` on a record or `name()` on a bean - each convention belongs to its own model, and mixing them defeats every framework's reader
- Agent says "JavaBean" when it means bean - there is no specification behind what we write, which is exactly why framework behaviour differs

## Related

- [records.md](records.md) · [immutability.md](immutability.md) · [data-oriented-programming.md](data-oriented-programming.md)
