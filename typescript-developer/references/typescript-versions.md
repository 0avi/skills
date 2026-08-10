# TypeScript Versions

Three lines matter, and the gap between them is unusually wide for TypeScript.

| Line | Shipped | What it is |
|---|---|---|
| **5.x** | through 2025 | The long 5.x series. Still what most codebases are on |
| **6.0** | March 2026 | The last JavaScript-based compiler. A deliberate cleanup release: new defaults, deprecations removed. **The recommended baseline** |
| **7.0** | 8 July 2026 | The Go-native compiler. 8-12× faster, but ships with **no programmatic API** |

## Recommend 6.0, not 7.0 - for now

7.0 is genuinely 8-12× faster on type-checking and uses less memory. It is also, as of now, unable to run the tools that enforce a style guide.

**TypeScript 7.0 ships without a programmatic API.** The compiler is there; the API other tools call into is not. It is expected in 7.1. Until then:

- **typescript-eslint cannot run on it.** Not "degraded" - npm refuses the install outright with `ERESOLVE`, because its peer range caps below the 7.0 line.
- **ts-jest, ts-morph** and anything else that walks the AST or asks the compiler for type information is blocked.
- **Embedded-language tooling** - the template type-checkers behind Vue, Svelte, Astro, MDX and Angular - is blocked.

For a codebase whose style is enforced by lint rules, that is not a cosmetic gap: it removes the enforcement. Adopt 7.0 when 7.1 lands, or run the two side by side (below) if the build-time win is worth the setup now.

None of this is wasted waiting. **Almost all the migration work is the 5.x → 6.0 step**; 6.0 exists to front-load it. A project on 6.0 with no deprecation suppressions is close to 7.0-ready.

## What 6.0 changed

### New defaults

| Option | New default | Consequence |
|---|---|---|
| `strict` | `true` | Was off unless you asked |
| `module` | `esnext` | |
| `target` | floating, currently ~`es2025` | Pin it explicitly if you need a fixed floor |
| `types` | `[]` | **No more automatic `@types/*` discovery.** Every ambient type package must be listed |
| `noUncheckedSideEffectImports` | `true` | A side-effect import of a nonexistent module is now an error |

The `types: []` change is the one that bites on upgrade: globals that "just worked" - Node, Jest, browser test harnesses - stop resolving until listed.

### Removed in 6.0

- **`target: es5`** - the floor is now ES2015. This is the change that expires several older style rules; see [google-style-deltas.md](google-style-deltas.md).
- **`moduleResolution: node`** and **`classic`** - move to `nodenext` or `bundler`.

### Deprecated in 6.0, removed in 7.0

`baseUrl`, remaining ES5 support, module namespaces, `outFile`, `moduleResolution: node`.

`ignoreDeprecations: "6.0"` downgrades these to warnings **on 6.0 only**. Treat it as a migration crutch with a hard expiry: 7.0 does not honour it. A project still carrying it is not 7.0-ready, whatever else is done.

## What 7.0 removed on top

| Removed / now an error | Migrate to |
|---|---|
| `target: es5`, `downlevelIteration` | ES2015+ target |
| `module: amd` / `umd` / `systemjs` / `none` | `esnext` or `nodenext` |
| `moduleResolution: node` / `node10` / `classic` | `nodenext` or `bundler` |
| `baseUrl` | `paths` relative to the tsconfig, or workspace references |
| `esModuleInterop: false`, `allowSyntheticDefaultImports: false` | Cannot be disabled |
| `alwaysStrict: false` | Cannot be disabled |

New in 7.0: `rootDir: ./` by default, and `stableTypeOrdering: true` locked on - which is what makes 7.0's inference match 6.0's rather than drifting.

## Running 6.0 and 7.0 side by side

The supported route while waiting for 7.1. Install 7.0 as `typescript` for the fast type-check, and alias 6.0 for the tools that need the API:

```jsonc
{
  "devDependencies": {
    "typescript": "^7.0.0",
    "typescript6": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

Point the API-dependent tools at the aliased copy and leave `tsc` on 7.0. Verify that both agree on your code - a type error that appears under only one of them is worth understanding before you trust either.

This is real complexity for a real payoff. Take it when the build time hurts; otherwise wait for 7.1.

## Upgrading

```bash
npx tsc --noEmit                 # baseline the current error count first
npm i -D typescript@6
npx tsc --noEmit                 # then work the delta
```

Order of work on the 5.x → 6.0 step:

1. **Add `types: []` and list what you need** - this surfaces the largest number of errors and they are all mechanical.
2. **Replace `moduleResolution: node`** with `nodenext` or `bundler`, then fix the import specifiers that stop resolving ([imports-and-exports.md](imports-and-exports.md)).
3. **Turn on `strict` deliberately**, one flag at a time if the project was not strict. Do not enable it and suppress the fallout.
4. **Remove `ignoreDeprecations`** and fix what it was hiding. This is the actual 7.0 gate.

Do not combine the upgrade with a refactor. A type error during a version bump should be attributable to the version bump.

## Version notes

This file is the version reference. The version-bound decisions elsewhere: the tsconfig defaults and which flags you must now set explicitly ([tsconfig.md](tsconfig.md)); `#private` being native only at target ES2022+ ([classes.md](classes.md)); standard versus experimental decorators ([decorators.md](decorators.md)); `using` requiring ES2022+ and the disposal symbols ([resource-management.md](resource-management.md)); and the lint-enforcement gap on 7.0 ([enforcement.md](enforcement.md)).

## Gotchas

- Agent recommends TypeScript 7.0 for a project that lints - typescript-eslint will not install alongside it
- Agent assumes a failed typescript-eslint install on 7.0 is a version-range bug to force past - the API genuinely does not exist yet; use the side-by-side alias
- Agent upgrades to 6.0 and is surprised that `@types/node` globals vanished - `types: []` is the new default; list them
- Agent leaves `ignoreDeprecations: "6.0"` in place and calls the project 7.0-ready - 7.0 ignores the flag
- Agent reads the version from a global `tsc` - read `devDependencies`
- Agent sets `target: es5` - removed in 6.0
- Agent keeps `moduleResolution: "node"` - removed; use `nodenext` or `bundler`
- Agent keeps `baseUrl` - deprecated in 6.0, gone in 7.0
- Agent enables `strict` and suppresses the resulting errors - that is worse than not enabling it, because the file now looks checked
- Agent bundles the version upgrade with unrelated refactoring - errors stop being attributable

## Related

- [tsconfig.md](tsconfig.md) · [enforcement.md](enforcement.md) · [google-style-deltas.md](google-style-deltas.md) · [imports-and-exports.md](imports-and-exports.md) · [enums-and-constants.md](enums-and-constants.md)
