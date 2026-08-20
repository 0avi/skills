# Smaller Language Features

**Know these features, but do not adopt one merely because it is new.** Several were aimed at newcomers and single-file scripts, not production codebases. Each entry states the verdict - follow it rather than hedging.

| Feature | Version | Verdict |
| ------- | ------- | ------- |
| Text blocks | 15 | **Adopt** |
| Unnamed variables `_` | 22 | **Adopt** (still explain why unused) |
| Markdown doc comments `///` | 23 | **Adopt for new code**; convert existing opportunistically, never en masse |
| Instance `main` / compact source files | 25 | **Adopt for scripts**; neutral for applications |
| Module import declarations | 25 | **Avoid** in application code |

---

## Text blocks - adopt

```java
var query = """
    SELECT client_ref, year_end
      FROM engagements
     WHERE status = ?
     ORDER BY year_end DESC
    """;
```

Incidental leading whitespace is stripped based on the closing delimiter's indentation. `\` at end of line suppresses the newline; `\s` keeps trailing spaces.

Layout rules worth holding to, because they are what make the stripping predictable:

- The opening `"""` goes on **its own line**, never with content after it.
- The closing `"""` sits at the indentation the content should be stripped to, and code may follow it on the same line.
- Every content line is indented at least as far as the delimiters. Indent one further and that line keeps the extra space.
- A text block's contents are exempt from any column limit, so do not wrap SQL to satisfy a formatter.

**Turn on `-Xlint:text-blocks`**, which warns about inconsistent white space in the indentation - the mistake that silently changes the string. See [enforcement.md](enforcement.md).

**Never interpolate into SQL, HTML or shell commands.** Text blocks make embedding these pleasant, which is exactly what makes the injection mistake tempting.

```java
// ❌ SQL injection
var query = """
    SELECT * FROM engagements WHERE client_ref = '%s'
    """.formatted(clientRef);

// ✅ parameterise
var query = """
    SELECT * FROM engagements WHERE client_ref = ?
    """;
try (var ps = connection.prepareStatement(query)) {
  ps.setString(1, clientRef);
}
```

Use text blocks for the static part; pass the variable part through the appropriate parameterisation mechanism.

---

## Unnamed variables - adopt

`_` declares a deliberately unused variable and makes the compiler enforce the claim, replacing conventions like `ignored`.

```java
// ✅
try {
  doWork();
} catch (IOException _) {
  // no recovery possible here - the caller retries
}
total = items.stream().reduce(0, (a, _) -> a);
```

Valid for `catch` parameters, lambda parameters, `for` loop variables, `try`-with-resources variables, and pattern components.

**Still add a comment saying why.** `_` states "unused", not "why unused" - and in a `catch` block, ask first whether the exception *should* be unused. A swallowed exception is more often a bug than a decision.

---

## Markdown doc comments - adopt for new code

```java
/// Returns the **net** amount after deductions.
///
/// @param gross the gross amount, not null
/// @return the net amount, not null
```

Javadoc tags work as normal; `[Text](url)` and `` `code` `` behave as expected. New or substantially rewritten code uses `///`; existing code is converted only as you touch it, **never en masse**.

`///` is one of three doc-comment features worth adopting, alongside `{@return}` (16) and `{@snippet}` (18), and all three are owned by [javadoc.md](javadoc.md) - including the rule that their availability tracks the **javadoc tool version rather than `--release`**.

---

## Instance `main` and compact source files - adopt for scripts

```java
// Java 25: no class declaration, no static, no String[] args
void main() {
  IO.println("Hello");
}
```

`java.lang.IO` and an implicit `java.base` module import are available. Use for scripts, examples and anything run via `java Foo.java`. In an application the entry point is one line in the whole codebase, so it changes little - but there is no longer any reason to write the full `public static void main(String[] args)` incantation.

---

## Module import declarations - avoid

```java
import module java.base;   // imports every exported package of the module
```

Good for scripts and compact source files, where it is implicit anyway. **Do not adopt in application code:**

- It is a wildcard import with a far larger blast radius, and **wildcard imports are not used** - `import java.util.*;` and static wildcards alike. State that as its own rule; the module form is the extreme case of it, not a separate question.
- Adopting it would require coordinated changes across IDEs, Checkstyle and static analysis, none of which is happening.
- There is no coherent halfway rule - "`java.base` wholesale but nothing else" is arbitrary.

Keep explicit imports and let the IDE manage them. See [modules.md](modules.md).

## Version notes

The verdict table at the top of this page carries each feature's release. Two details are sharper than that table suggests:

| Detail | Behaviour |
| ------ | --------- |
| `String.formatted()` | Resolves as far back as `--release 13`, earlier than text blocks themselves. Text blocks need 15, so 15 is the floor for the idiom on this page |
| `_` as a variable name | **Compiles on Java 8** as an ordinary identifier called `_`, is rejected from 9 to 21, and is an unnamed variable from 22 |
| `java.lang.IO` and `IO.println` | 25, alongside compact source files |
| `import module java.base;` | 25 |

The `_` behaviour is the one to watch. On a Java 8 project `catch (IOException _)` compiles, but `_` is just a variable name, so the claim that "the compiler enforces it is unused" is false there: it is an ordinary binding that happens to be ignored. From 9 to 21 the same line fails with `use -source 22 or higher to enable unnamed variables`.

## Gotchas

- Agent generates `_` on a project below 22 - either a compile error (9 to 21) or, on 8, a silently ordinary variable that the compiler will not police
- Agent interpolates a variable into a text block with `.formatted()` for SQL, HTML or a shell command - that is the injection this page warns about. Parameterise
- Agent uses a text block for a single-line string - it buys nothing and adds a trailing newline decision
- Agent forgets that the closing delimiter's indentation sets the strip level, so moving the `"""` changes the string's content
- Agent adds a trailing newline to a text block without noticing - the closing delimiter on its own line means the content ends with `\n`. Put the delimiter on the content's last line to suppress it
- Agent swallows an exception with `catch (Exception _)` and adds no comment - `_` states unused, never why. Ask first whether the exception should be unused at all
- Agent converts a whole codebase's Javadoc to `///` in one pull request - the page says opportunistically, never en masse
- Agent adds `import module java.base;` to application code because it is new and shorter - the verdict is avoid
- Agent tidies a long import list into `import java.util.*;` - wildcard imports are not used either, static ones included. Let the IDE manage explicit imports
- Agent rewrites an application's `public static void main` to the instance form as a modernisation - it is one line in the codebase and changes nothing. Adopt it for scripts

## Related

- [java-versions.md](java-versions.md) - which of these the project can use
