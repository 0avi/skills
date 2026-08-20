# Javadoc

Doc comments gained three features worth adopting and one habit worth dropping. The verdicts:

| Feature | Version | Verdict |
| ------- | ------- | ------- |
| `{@return ...}` inline tag | 16 | **Adopt** for any accessor-shaped method |
| `{@snippet ...}` inline tag | 18 | **Adopt** in place of `<pre>{@code ...}</pre>` |
| Markdown doc comments `///` | 23 | **Adopt for new code**; convert existing opportunistically, never en masse |
| `<p>` between paragraphs, `<ul>` lists, escaped `&lt;` | 8 | Unavoidable in `/** */` comments; the reason to prefer `///` |

---

## Where Javadoc is required

**Every visible class, member and record component**, where visible means `public` for a top-level class, and `public` or `protected` in a visible class.

Two exceptions, and one trap in the second:

- **Self-explanatory members.** A `getFoo()` with genuinely nothing to say beyond "the foo" needs none.
- **Overrides.** A method overriding a supertype method inherits the documentation.

The trap: "self-explanatory" is not a licence to skip a term the reader will not know. A record component named `canonicalName` still needs documenting if a typical reader has no idea what canonical means here. Skip the comment only when it would add nothing, never when writing it would be awkward.

**Document record components with `@param` on the record declaration**, not on the accessors:

```java
/// A client's filing position for one tax year.
///
/// @param reference the client reference, in the form `C-00000`
/// @param yearEnd the accounting year end
/// @param status where the return has reached in the filing cycle
public record FilingPosition(String reference, LocalDate yearEnd, FilingStatus status) {}
```

## The summary fragment

The first sentence is the only part that appears in class and method indexes, so it carries the weight.

Write a **fragment** - a noun or verb phrase, capitalised and punctuated as though it were a sentence. Not a complete sentence, and never a preamble:

```java
// ❌ preamble that says nothing
/** This method returns the customer ID. */
/** A {@code Client} is a class that represents a client. */

// ❌ a bare block tag with no summary at all
/** @return the customer ID */

// ✅
/** Returns the customer ID. */

// ✅ better, since the tag and the summary are the same sentence
/** {@return the customer ID} */
```

`{@return X}` expands to both the summary sentence and the `@return` tag. Use it whenever the summary would only have restated the return value, which is most accessors.

## Block tags

Order: **`@param`, `@return`, `@throws`, `@deprecated`.** None of the four ever appears with an empty description - an empty tag is worse than no tag, because it looks answered.

## Snippets, not `<pre>{@code}`

```java
/// Batches submissions for the bulk endpoint.
///
/// {@snippet lang=java :
///   submissions.stream()
///       .gather(Gatherers.windowFixed(100))
///       .forEach(client::submitBatch);
/// }
```

`{@snippet}` beats `<pre>{@code ...}</pre>` because the snippet can be **an external file region** that the build compiles, so it cannot rot:

```java
/// {@snippet file="BatchExample.java" region="submit"}
```

An inline snippet is still just text. A file-based snippet in a compiled test source set is the version that stays true.

## Markdown doc comments

```java
/// Returns the **net** amount after deductions.
///
/// Deductions apply in the order:
///   - allowances
///   - reliefs
///
/// @param gross the gross amount, not null
/// @return the net amount, not null
```

Javadoc tags work as normal, and `[Text](url)` and `` `code` `` behave as expected. Every `///` line in a run forms one comment; a blank line without `///` ends it.

- New or substantially rewritten code: use `///`.
- Existing code: convert only as you touch it. **Do not open a pull request rewriting every doc comment** - no bulk tooling exists, the diff is enormous, nested HTML mangles easily, and the benefit is cosmetic.

## Check it compiles

```bash
javadoc -Xdoclint:all -d target/apidocs $(find src/main/java -name '*.java')
```

`-Xdoclint:all` catches a broken `@param` name, a missing `@return`, a malformed tag and a dangling reference. Add `-Xlint:dangling-doc-comments` to javac for the related mistake of a `/** */` comment sitting where it documents nothing. See [enforcement.md](enforcement.md).

## Version notes

Doc comments are processed by the **javadoc tool**, not by `javac`, so their floors behave differently from every other page in this skill: **`--release` does not gate them.**

Measured on JDK 21: `javadoc --release 8` rendered both `{@return the customer ID}` and a `{@snippet}` block, emitting `snippet-container` markup in the generated HTML. So a project targeting Java 8 bytecode can use both tags, provided the JDK running javadoc is new enough.

| Feature | Needs a javadoc tool of at least |
| ------- | -------------------------------- |
| `{@return}` | 16 |
| `{@snippet}` | 18 |
| Markdown `///` | 23 |

Those three floors are the documented ones; only their behaviour on 21 and 25 was measured here, because no JDK 16 or 18 was available. The direction of the finding is what matters: **check the JDK that runs javadoc, not the `release` property.**

`///` is inert rather than broken below 23: it compiles as an ordinary comment on any release and simply produces no documentation.

## Gotchas

- Agent writes `/** @return the customer ID */` with no summary - a bare block tag. Use `{@return the customer ID}`
- Agent opens a doc comment with "This method returns" or "A Foo is a" - the summary is a fragment, not a sentence about the code
- Agent leaves an empty `@param` or `@throws` - an empty tag reads as answered and is worse than omitting it
- Agent documents record components on the generated accessors - they go as `@param` on the record declaration
- Agent skips a record component's documentation citing the self-explanatory exception when the component name uses a domain term the reader will not know
- Agent converts a whole codebase's doc comments to `///` in one pull request - opportunistically, never en masse
- Agent uses `///` on a project below 23 and reports the documentation as improved - it compiles as an ordinary comment and produces nothing
- Agent decides `{@return}` is unavailable because `maven.compiler.release` is 11 - the javadoc tool version governs, not `release`
- Agent writes an inline `{@snippet}` and treats it as verified - only a file-based snippet from a compiled source set cannot rot
- Agent adds `<p>` tags inside a `///` comment - that is the HTML habit `///` exists to remove

## Related

- [smaller-features.md](smaller-features.md) - the other post-Java-8 features with a per-feature verdict
- [records.md](records.md) - documenting components, and what `toString()` exposes
- [enforcement.md](enforcement.md) - `-Xdoclint:all` and `-Xlint:dangling-doc-comments`
- [java-versions.md](java-versions.md)
