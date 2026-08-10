# Modules (JPMS)

**Do not modularise application code.** Do not add `module-info.java` to an application, and do not suggest it as an architecture solution.

Modules were built to let the JDK lock down its own internals so it could evolve. They solved that problem. They do not solve application structure.

## Why to refuse it

State these when a user asks to modularise an application:

- **Boundaries are not enforced.** Encapsulation is a property of the *module path*, not of `module-info.java`. On the class path, `module-info.class` is ignored and every package is readable. Any guarantee that depends on how the artefact is launched is not a guarantee.
- **Split packages are fatal** — two modules cannot share a package, and many established libraries do.
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

- **`jlink` / `jpackage`** self-contained runtime images or native packages — required, and the size reduction is substantial.
- **A published library** whose consumers have asked for module support. Budget for testing both the class path and the module path; consumers will use both, and behaviour differs.
- **A genuine plugin architecture** using `provides` / `uses` service binding.

## Rules for existing modular code

- Keep `module-info.java` minimal; export the smallest surface that compiles.
- Prefer qualified exports (`exports x to y`) over unqualified.
- Use `opens` for the specific packages a framework reflects over. Never `open module`.
- Run CI on the module path — it is the only configuration where the declarations take effect.

## Related

- [smaller-features.md](smaller-features.md) — module import declarations, also to avoid
