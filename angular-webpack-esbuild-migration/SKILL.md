---
name: angular-webpack-esbuild-migration
description: >-
  Migrate any Angular project off a webpack-based builder
  (@angular-builders/custom-webpack, or @angular-devkit/build-angular:browser)
  to Angular's native esbuild builder — the application builder
  (@angular-devkit/build-angular:application or @angular/build:application), or
  browser-esbuild as a stepping stone. Use this whenever someone is moving an
  Angular app off webpack or custom-webpack, switching to the application or
  esbuild builder, trying to speed up slow Angular production builds, removing
  webpack.config.js / babel-loader / core-js polyfills, or fixing errors that
  appear after the switch — TS2307 on package "/src/" or "/dist/" imports,
  TS2612 "will overwrite the base property", TS2729 "used before its
  initialization", zone.js/dist paths, SCSS "~" url() paths, a stray "browser/"
  output subfolder, CommonJS bundle warnings, or moving Karma to the Jest
  builder. Works for any Angular version and any repo state, including
  multi-project workspaces and partially migrated repos.
license: MIT
metadata:
  version: 1.0.0
  author: Avinay Basnet
compatibility: >-
  Targets Angular's esbuild builders: the application builder needs Angular 17+
  (use browser-esbuild on 16 as a stepping stone; upgrade Angular first below
  16). Validated on Angular 19 / @angular-devkit/build-angular 19.2.x. Bundled
  scripts are dependency-free Node ESM and run on any Angular-supported Node.
---

# Angular webpack → esbuild migration

A staged, battle-tested procedure for moving any Angular project from a
webpack-based builder (`@angular-builders/custom-webpack:browser` or
`@angular-devkit/build-angular:browser`) to Angular's native esbuild
application builder.

The payoff is large and consistent — roughly **50–70 % faster production
builds**, far better code splitting, and the removal of a whole webpack + babel
+ IE-polyfill dependency tree. The cost is a handful of pre-existing issues the
old, lenient webpack compiler hid that the stricter esbuild/Angular compiler now
surfaces. This skill walks through both halves.

It is written to apply to **any Angular version and any repo state** — read the
applicability notes next so you target the right builder and scope, then work
the steps. (The procedure was validated end-to-end on a real Angular 19
production app; the version-specific bits are called out where they matter.)

## Applicability — versions and repo states

Version- and repo-agnostic, with a few honest constraints. `scripts/audit.mjs`
prints your Angular major and which path applies.

**Angular version — pick the destination builder:**

- **17+** → the application builder. Named `@angular-devkit/build-angular:application`
  in 17–19; from Angular 20 it also ships as `@angular/build:application`. This is
  the main path below — use whichever package name exists in your installed CLI.
- **16** → the full application builder isn't available yet. Use
  `@angular-devkit/build-angular:browser-esbuild` as a drop-in stepping stone: it
  runs the same esbuild pipeline but accepts the old browser-builder options
  (keep `main`/string `polyfills`/string `outputPath`). Do the polyfill, SCSS,
  tsconfig, and source fixes below; defer the `application`-builder-specific
  changes (entry-point rename, object `outputPath`) until you reach 17+.
- **below 16** → esbuild builders don't exist; upgrade Angular first
  (`ng update @angular/core @angular/cli`) as a separate task, then return here.

**Test runner.** The native Jest builder (`@angular-devkit/build-angular:jest`)
is experimental and only on recent versions. If it's unavailable or you'd rather
not adopt it, the **Karma builder also runs on esbuild from 16+** — keep Karma
and skip the Jest steps (1.3 test block, 1.6, T12–T14). The Jest move is the
recommended end state, not a hard requirement.

**Repo state:**

- **Multi-project workspaces** — repeat the per-project steps (builder swap,
  `outputPath`, entry point, polyfills) for **every `projectType: "application"`**
  project in `angular.json`. **Leave `projectType: "library"` projects alone** —
  they build with ng-packagr, not the browser/esbuild builder. The audit lists
  every project and its builder.
- **Partially migrated repos** — every step is idempotent. Re-run the audit; it
  flags only what's left, and repeating a done step is a no-op. Safe to resume.
- **Dirty working tree** — commit or stash first so the migration diff stays
  reviewable and the CRLF recovery in T8 stays simple.

## How to work through a migration

This is an iterative build-fix loop, not a one-shot edit. A few principles make
it go smoothly — they matter enough to state up front:

1. **Inventory before you touch anything.** Which steps apply depends entirely
   on what the project actually uses. Run the audit (Step 0) first; let its
   output decide your scope. Read `angular.json`, `webpack.config.js`,
   `polyfills.ts`, `tsconfig.json`, and `package.json` before editing them.
2. **Build after every batch of fixes, not once at the end.** Each build reveals
   the next layer of errors. Trying to fix everything blind and building once
   wastes time and buries the signal.
3. **The new compiler errors are real bugs, not noise.** TS2612 and TS2729 are
   genuine issues the webpack build silently swallowed. Fix the code — do not
   paper over them with `skipLibCheck`, `// @ts-ignore`, or by loosening
   `tsconfig`. That just moves the failure to runtime.
4. **On Windows, never mass-edit with `sed -i`.** In Git Bash it rewrites every
   scanned file's line endings to LF, producing thousands of spurious diffs (see
   T8). Use `scripts/codemod.mjs` (line-ending-safe) or targeted single-file
   edits instead.
5. **"Build succeeds" ≠ "migration done."** A green build is one acceptance
   criterion of many: the dev server must start, tests must compile, the output
   must land where the backend serves it, and the UI must be smoke-tested.

## Bundled scripts

Both are dependency-free Node ESM — run them from the Angular project root.

- **`scripts/audit.mjs`** — read-only inventory across **all projects** in the
  workspace. Prints everything that determines scope: each project's builder and
  type (and which to migrate vs. skip), the Angular major and the destination
  builder for that version, webpack plugins/loaders, ES5 configs, legacy polyfill
  count, SCSS `~` paths, internal `/src/` & `/dist/` imports, TS2729-candidate
  class fields, TS2612-candidate subclass `@Input`/`@Output`s, `outputPath` form,
  Angular-ecosystem version mismatches, `zone.js/dist` test imports, `async()`
  specs, and duplicate spec filenames. Run `node path/to/audit.mjs`
  (add `--json` for machine output). It surfaces build-time errors statically, so
  you catch them even before the first `ng build`.
- **`scripts/codemod.mjs`** — line-ending-safe mass find/replace, the safe
  alternative to `sed -i` on Windows. e.g.
  `node codemod.mjs --dir src --ext .ts --from "from 'pkg/src/x'" --to "from 'pkg'"`
  (add `--dry` to preview). Use it for import rewrites and the `async →
  waitForAsync` rename.

## Step 0 — Inventory

```bash
node path/to/angular-esbuild-migration/scripts/audit.mjs .
```

The report tells you which of the steps below apply. If the builder line does
**not** contain `webpack`, this skill probably doesn't apply — stop and confirm.

Pay special attention to two things the audit surfaces that fail *silently* and
late, not at install time:

- **Internal package imports** (`from 'some-pkg/src/...'` or `.../dist/...`).
  `moduleResolution: "bundler"` (required by the application builder) enforces
  package `exports` maps, so these become invisible to TypeScript even though
  the files exist on disk. Surface them now; fix them in Step 1.9 / T2.
- **`outputPath` as a string.** The application builder emits into
  `<outputPath>/browser/`. If a backend (Spring Boot, nginx, …) serves from the
  base path, that silently breaks serving (T6). Plan the object-form fix.

## Phase 0 — Capture a baseline

Do this **before any code change** — you cannot measure the improvement without
it.

```bash
npm install
{ time node_modules/.bin/ng build --configuration production 2>&1; } 2>&1 | tee baseline.log
grep -E "Initial total|Build at|real" baseline.log
```

Record: build time, `main` chunk raw/gzip, `polyfills` raw/gzip, total initial
raw/gzip, and the warning count.

## Phase 1 — Core migration

Work these in order, building after the `angular.json` / config changes and
again after each batch of error fixes.

### 1.1 — Resolve pre-existing peer-dependency mismatches

A clean install will fail on mismatches the existing `node_modules` was masking.
Surface them first:

```bash
npm install --dry-run 2>&1 | grep ERESOLVE
```

The usual culprit is Angular-ecosystem packages left behind during an Angular
upgrade. **Rule:** every `@angular/*`, `@angular/cdk`, `@angular/material`,
`@ngrx/*`, etc. must have a major version matching the Angular major in use — a
`@angular/cdk@17` in an Angular 19 app breaks the clean install. Fix the
versions in `package.json`.

If a private/third-party package creates an *unresolvable* conflict you don't
control, add `legacy-peer-deps=true` to `.npmrc` — and document why, because it
silences peer resolution for all installs.

### 1.2 — Remove webpack-era packages

Always remove the custom-webpack builder:

```bash
npm uninstall @angular-builders/custom-webpack
```

Remove these **if present** (not every project has all of them): the webpack
ecosystem (`webpack`, `webpack-bundle-analyzer`, `webpack-merge`); the babel
pipeline (`@babel/core`, `@babel/preset-env`, `babel-loader`, other `@babel/*`
helpers — esbuild transpiles natively); webpack-specific plugins (anything whose
name contains `webpack`, e.g. `copy-webpack-plugin`,
`moment-locales-webpack-plugin`); and IE/ES5 runtime shims (`formdata-polyfill`,
`process`, `regenerator-runtime`).

The pattern: anything that exists only to support webpack's JS-based pipeline or
IE compatibility can go. When unsure, check whether it's referenced anywhere
outside `webpack.config.js` or `polyfills.ts`. Then verify a clean install
(`npm install`, plus `--legacy-peer-deps` if Step 1.1 required it).

### 1.3 — `angular.json`

**Swap the build builder** and delete the `customWebpackConfig` block entirely.
Use the builder name that exists in your installed CLI — `@angular/build:application`
on Angular 20+, `@angular-devkit/build-angular:application` on 17–19, or
`@angular-devkit/build-angular:browser-esbuild` on 16 (see Applicability):

```diff
- "builder": "@angular-builders/custom-webpack:browser",
+ "builder": "@angular-devkit/build-angular:application",
```

Do this for **every `projectType: "application"` project** in `angular.json`;
skip `library` projects.

**Rename the entry-point key and make `polyfills` an array** (application builder
only — on the `browser-esbuild` stepping stone keep `main` and string
`polyfills`):

```diff
- "main": "src/main.ts",
- "polyfills": "src/polyfills.ts",
+ "browser": "src/main.ts",
+ "polyfills": ["src/polyfills.ts"],
```

**Fix `outputPath` (critical).** The application builder defaults to
`<outputPath>/browser/`. To preserve a flat layout for a backend that serves the
base path directly, use the object form:

```diff
- "outputPath": "dist/my-app",
+ "outputPath": { "base": "dist/my-app", "browser": "" }
```

`browser: ""` appends nothing, so files land at `dist/my-app/` as before.

**Add `allowedCommonJsDependencies`** for each CJS package that warns. Build once
without it, collect the warnings, then list each package name. Later, removing a
name is how you verify it's been migrated to ESM.

**Remove options the application builder doesn't have:** `namedChunks`,
`vendorChunk`, `buildOptimizer`, `aot` (always on; flag ignored),
`es5BrowserSupport`, any `es5` configuration block (in both `build` and
`serve`), and any `tsConfig` pointing at a `tsconfig-es5.app.json`.

**Swap the serve builder:**

```diff
- "builder": "@angular-builders/custom-webpack:dev-server",
+ "builder": "@angular-devkit/build-angular:dev-server",
```

**Migrate the test builder** from Karma to Angular's native Jest builder —
*optional and version-dependent* (see Applicability). The Jest builder is
experimental and only on recent versions; if it's unavailable, keep Karma (it
runs on esbuild from 16+) and skip this block plus Steps 1.6 and T12–T14. Full
walk-through (test-setup file, `tsconfig.spec.json` edits, packages to remove,
and the Jest-builder gotchas T12–T14) is in
`references/troubleshooting.md` and `references/checklist.md`; the short version:

```json
"test": {
  "builder": "@angular-devkit/build-angular:jest",
  "options": { "tsConfig": "src/tsconfig.spec.json", "polyfills": ["src/test-setup.ts"] }
}
```

```bash
npm install -D jest jest-environment-jsdom @types/jest
```

Create `src/test-setup.ts` (replaces `src/test.ts`):

```typescript
import '@angular/localize/init';
import 'zone.js';
import 'zone.js/testing';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
  { teardown: { destroyAfterEach: false } },
);
```

In `src/tsconfig.spec.json`: change `"types": ["jasmine", "node"]` →
`["jest", "node"]`, drop `"files": ["test.ts", "polyfills.ts"]`, and add
`"test-setup.ts"` to `include`. Remove the Karma/Jasmine/Protractor
devDependencies (`karma*`, `jasmine*`, `@types/jasmine*`, `protractor`) and
delete `karma.conf.js` and `src/test.ts`.

### 1.4 — Delete `webpack.config.js`

```bash
rm webpack.config.js
```

### 1.5 — `src/polyfills.ts`

Replace the whole file with only what evergreen browsers need:

```typescript
import '@angular/localize/init';
import './zone-flags';   // only if the project has this file; otherwise omit
import 'zone.js';
```

Remove everything else: all `core-js/*` imports, `formdata-polyfill`,
`regenerator-runtime/runtime`, the webpack `process` shim
(`import * as process from 'process'; window['process'] = process;`), and — if
present — `import 'zone.js/testing'` (that belongs **only** in `test-setup.ts`,
never in app polyfills).

### 1.6 — `src/test.ts` (if not already replaced in 1.3)

zone.js ≥ 0.11 removed the `dist/` paths. Replace the whole block of
`import 'zone.js/dist/...'` lines with a single `import 'zone.js/testing';`
(verify with `ls node_modules/zone.js/ | grep testing`).

### 1.7 — Delete `src/tsconfig-es5.app.json`

```bash
rm src/tsconfig-es5.app.json 2>/dev/null || true
```

### 1.8 — `src/tsconfig.spec.json`

Change `"target": "es5"` → `"target": "es2020"`.

### 1.9 — `tsconfig.json` (root)

```diff
- "module": "es2020",
+ "module": "es2022",
- "moduleResolution": "node",
+ "moduleResolution": "bundler",
- "target": "es2018",
+ "target": "es2022",
- "lib": ["es2017", "dom", "es2015.promise"]
+ "lib": ["es2022", "dom", "dom.iterable"]
```

`moduleResolution: "bundler"` is the **non-negotiable** change — it's required
by the application builder and is what makes internal `/src/` and `/dist/`
package imports break (see Step 0 and T2). Fix those imports with
`scripts/codemod.mjs`.

The `target`/`module`/`lib` values above suit Angular 17+. On a different
version, match what the CLI generates for a fresh project of that version (run
`ng new` in a temp dir, or check the Angular update guide) rather than copying
these verbatim — esbuild down-levels as needed, so the exact target matters far
less than `moduleResolution: "bundler"`.

### 1.10 — SCSS `~` paths

The `~` prefix was a webpack CSS-loader convention. esbuild resolves `url()`
relative to the **SCSS file's own location on disk**, not the project root. For
each hit (the audit lists them), replace `~` with a path relative to the SCSS
file — e.g. `url('~assets/img/bg.png')` in `src/scss/` becomes
`url('../assets/img/bg.png')`. Fix SCSS *variables* that build paths too
(`$font-path: '~assets/fonts'` → `'../assets/fonts'`); a variable fix propagates
through interpolation without touching every `url()`. Details and the failure
mode are in T5.

### 1.11 — `package.json` scripts

Remove `--max-old-space-size` flags (esbuild is a native Go binary outside the
Node heap, so the flag is dead weight) and any `--build-optimizer` (webpack-only,
doesn't exist in the application builder):

```diff
- "build": "node --max-old-space-size=8192 ./node_modules/@angular/cli/bin/ng build",
+ "build": "ng build --configuration production",
- "start": "node --max-old-space-size=8192 ./node_modules/@angular/cli/bin/ng serve",
+ "start": "ng serve",
```

## When the build throws errors

The stricter compiler surfaces pre-existing issues. Each has a named entry with
symptom → cause → fix in **`references/troubleshooting.md`** (T1–T14):

| Error / symptom | Entry |
|---|---|
| `ERESOLVE` on install | T1 |
| `TS2307` on `pkg/src/...` or `pkg/dist/...` | T2 |
| `TS2612` will overwrite the base property | T3 |
| `TS2729` used before its initialization | T4 |
| `Could not resolve "~assets/..."` / wrong relative path | T5 |
| Blank page / 404 after a successful build | T6 |
| `TS2307` on `zone.js/dist/...` | T7 |
| Thousands of CRLF/LF "changes" on Windows | T8 |
| Non-ESM / CommonJS warnings | T9 |
| Bundle grew (no esbuild equivalent for a webpack plugin) | T10 |
| `async` not exported from `@angular/core/testing` | T11 |
| Jest builder: duplicate spec filenames collide | T12 |
| Jest builder: Windows path-quoting validation error | T13 |
| "Test suite must contain at least one test" | T14 |

## Before calling Phase 1 done

Walk the checklist in **`references/checklist.md`** — the things most commonly
missed (outputPath serve path, SCSS variables, `zone.js/testing` placement,
removed `es5`/`namedChunks`/`vendorChunk`/`buildOptimizer` options, duplicate
specs, etc.) plus the typical before/after metrics so you can sanity-check your
results.

## After the build is green — Phase 2+

Phase 1 gets the build working. The remaining work is progressively replacing
CommonJS dependencies with ESM equivalents to recover bundle size and unlock
tree-shaking. That's its own staged effort, documented in
**`references/cjs-modernization.md`**.
