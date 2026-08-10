# Smaller Language Features

**Know these features, but do not adopt one merely because it is new.** Several were aimed at newcomers and single-file scripts, not production codebases. Each entry states the verdict — follow it rather than hedging.

| Feature | Version | Verdict |
| ------- | ------- | ------- |
| Text blocks | 15 | **Adopt** |
| Unnamed variables `_` | 22 | **Adopt** (still explain why unused) |
| Markdown doc comments `///` | 23 | **Adopt for new code**; convert existing opportunistically, never en masse |
| Instance `main` / compact source files | 25 | **Adopt for scripts**; neutral for applications |
| Module import declarations | 25 | **Avoid** in application code |

---

## Text blocks — adopt

```java
var query = """
    SELECT client_ref, year_end
      FROM engagements
     WHERE status = ?
     ORDER BY year_end DESC
    """;
```

Incidental leading whitespace is stripped based on the closing delimiter's indentation. `\` at end of line suppresses the newline; `\s` keeps trailing spaces.

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

## Unnamed variables — adopt

`_` declares a deliberately unused variable and makes the compiler enforce the claim, replacing conventions like `ignored`.

```java
// ✅
try {
  doWork();
} catch (IOException _) {
  // no recovery possible here — the caller retries
}
total = items.stream().reduce(0, (a, _) -> a);
```

Valid for `catch` parameters, lambda parameters, `for` loop variables, `try`-with-resources variables, and pattern components.

**Still add a comment saying why.** `_` states "unused", not "why unused" — and in a `catch` block, ask first whether the exception *should* be unused. A swallowed exception is more often a bug than a decision.

---

## Markdown doc comments — adopt for new code

```java
/// Returns the **net** amount after deductions.
///
/// Deductions are applied in the order:
///   - allowances
///   - reliefs
///
/// @param gross the gross amount, not null
/// @return the net amount, not null
```

Javadoc tags work as normal; `[Text](url)` and `` `code` `` behave as expected.

- New or substantially rewritten code: use `///`.
- Existing code: convert only as you touch it. **Do not open a pull request rewriting every doc comment** — no bulk tooling exists, the diff is enormous, nested HTML mangles easily, and the benefit is cosmetic.

---

## Instance `main` and compact source files — adopt for scripts

```java
// Java 25: no class declaration, no static, no String[] args
void main() {
  IO.println("Hello");
}
```

`java.lang.IO` and an implicit `java.base` module import are available. Use for scripts, examples and anything run via `java Foo.java`. In an application the entry point is one line in the whole codebase, so it changes little — but there is no longer any reason to write the full `public static void main(String[] args)` incantation.

---

## Module import declarations — avoid

```java
import module java.base;   // imports every exported package of the module
```

Good for scripts and compact source files, where it is implicit anyway. **Do not adopt in application code:**

- It is a wildcard import with a far larger blast radius, and wildcard imports have been discouraged in Java for two decades.
- Adopting it would require coordinated changes across IDEs, Checkstyle and static analysis, none of which is happening.
- There is no coherent halfway rule — "`java.base` wholesale but nothing else" is arbitrary.

Keep explicit imports and let the IDE manage them. See [modules.md](modules.md).

## Related

- [java-versions.md](java-versions.md) — which of these the project can use
