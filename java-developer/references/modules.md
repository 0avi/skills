# Modules (JPMS)

**Do not modularise application code.** Do not add `module-info.java` to an application, and do not suggest it as an architecture solution.

Modules were built to let the JDK lock down its own internals so it could evolve. They solved that problem. They do not solve application structure.

## Why to refuse it

State these when a user asks to modularise an application:

- **Boundaries are not enforced.** Encapsulation is a property of the *module path*, not of `module-info.java`. On the class path, `module-info.class` is ignored and every package is readable. Any guarantee that depends on how the artefact is launched is not a guarantee.
- **Split packages are fatal** - two modules cannot share a package, and many established libraries do.
- **Reflective frameworks require `opens`**, which teams over-broaden until everything is open and nothing was gained.
- **Non-modular dependencies** force reliance on automatic module names derived from JAR filenames, which authors explicitly warn against.

## Enforce architecture with these instead

| Need | Use |
| ---- | --- |
| Compile-time boundary between subsystems | Separate Maven/Gradle modules with declared dependencies |
| Layering, naming, dependency-direction rules | ArchUnit, asserted as ordinary tests |
| Hiding a class from its own subsystem's callers | Package-private visibility |

These hold regardless of how the code is launched.

## When modules are correct

Adopt them only for:

- **`jlink` / `jpackage`** self-contained runtime images or native packages - required, and the size reduction is substantial.
- **A published library** whose consumers have asked for module support. Budget for testing both the class path and the module path; consumers will use both, and behaviour differs.
- **A genuine plugin architecture** using `provides` / `uses` service binding.

## Rules for existing modular code

- Keep `module-info.java` minimal; export the smallest surface that compiles.
- Prefer qualified exports (`exports x to y`) over unqualified.
- Use `opens` for the specific packages a framework reflects over. Never `open module`.
- Run CI on the module path - it is the only configuration where the declarations take effect.
- Group the directives in a conventional order, one blank line between blocks: **`requires`, `exports`, `opens`, `uses`, `provides`**. A `module-info.java` is read far more often than it is written, and a consistent order is what makes a diff to it legible. Modifiers on a `requires` go `transitive static`, in that order.
- A `module-info.java` has no package declaration, and the module declaration takes the place of the class declaration. Annotations on it go one per line after the doc comment.

## Version notes

JPMS is **Java 9**, and the verdict on this page has not changed since: do not modularise application code on any release from 9 to 25.

| Related feature | Since |
| --------------- | ----- |
| `module-info.java`, `exports`, `opens`, `requires`, `provides` / `uses` | 9 |
| `jlink` | 9 |
| `jpackage` | 14 |
| `import module java.base;` module import declarations | 25, and also to avoid - see [smaller-features.md](smaller-features.md) |

On Java 8 none of this exists, which is one fewer decision to make. Sealed types (17) interact with modules: a sealed hierarchy's permitted subtypes must share a module, or a package in an unnamed module. That is the one place where module boundaries affect ordinary code, and it is covered in [sealed-types.md](sealed-types.md).

## Gotchas

- Agent adds `module-info.java` to solve a package-structure or layering problem - encapsulation is a property of the module path, not the file. Use build modules or ArchUnit
- Agent adds `module-info.java` and keeps launching on the class path - `module-info.class` is then ignored entirely and nothing is enforced
- Agent broadens to `open module` to make a reflective framework work - that opens everything and the exercise was pointless
- Agent adds `requires` for a non-modular JAR and relies on the automatic module name - derived from the filename, and library authors warn against depending on it
- Agent hits a split package and works around it with `--patch-module` - two modules cannot share a package; the workaround will not survive
- Agent modularises to shrink a container image - `jlink` is the reason to do that, and it is a packaging decision, not an architecture one
- Agent runs CI only on the class path for a modular library - the declarations only take effect on the module path, so both need testing
- Agent uses unqualified `exports` when one consumer needs the package - prefer `exports x to y`

## Related

- [smaller-features.md](smaller-features.md) - module import declarations, also to avoid
