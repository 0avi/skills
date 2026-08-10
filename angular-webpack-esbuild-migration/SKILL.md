---
name: angular-webpack-esbuild-migration
description: Migrates an Angular project off a webpack-based builder (@angular-builders/custom-webpack, or @angular-devkit/build-angular:browser) to Angular's native esbuild builder - the application builder, or browser-esbuild as a stepping stone. Trigger when moving an Angular app off webpack or custom-webpack, switching to the application or esbuild builder, speeding up slow Angular production builds, removing webpack.config.js / babel-loader / core-js polyfills, moving Karma to the Jest builder, or fixing the errors that appear after the switch - TS2307 on package "/src/" or "/dist/" imports, TS2612 "will overwrite the base property", TS2729 "used before its initialization", zone.js/dist paths, SCSS "~" url() paths, a stray "browser/" output subfolder, or CommonJS bundle warnings. Works for any Angular version and any repo state, including multi-project workspaces and partially migrated repos.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# Angular webpack → esbuild Migration Guidelines

Covers any Angular version currently on a webpack builder. The destination is the esbuild **application builder** on Angular 17+, or **browser-esbuild** as a stepping stone on 16.

1. **Always determine the Angular major and the destination builder before editing anything.** The builder's package name changed at 20, the application builder does not exist before 17, and the option shapes differ between them. Advice that is correct on 19 will not load on 16.

2. **Inventory first and let it set the scope.** Which steps apply depends entirely on what the project actually uses. Never work the steps blind - read `angular.json`, `webpack.config.js`, `polyfills.ts`, `tsconfig.json` and `package.json`, and run the inventory sweep in [audit-and-baseline.md](references/audit-and-baseline.md), before editing anything.

3. **The new compiler errors are real bugs, not migration noise.** TS2612 and TS2729 are genuine defects the webpack build silently swallowed. Fix the code. Never reach for `@ts-ignore`, `@ts-nocheck`, `skipLibCheck`, or a loosened `tsconfig` - that moves a compile failure to runtime.

4. **On Windows, never mass-edit with `sed -i`.** In Git Bash it rewrites every scanned file to LF, producing thousands of spurious diffs that bury the real ones. Use PowerShell's `[System.IO.File]::ReadAllText`/`WriteAllText`, which preserves each file's original line endings, or targeted single-file edits. See [troubleshooting.md](references/troubleshooting.md) T8.

5. **Build after every batch of fixes, never once at the end.** Each build reveals the next layer of errors. Fixing blind and building once wastes time and buries the signal.

6. **A green build is not a finished migration.** The dev server must start, tests must compile, the output must land where the backend serves it, and the UI must be smoke-tested. See [checklist.md](references/checklist.md).

7. **Every step is idempotent.** On a partially migrated repo, re-run the inventory sweep and do only what it still finds; repeating a completed step is a no-op. Commit or stash first so the diff stays reviewable.

Every reference carries a **`## Version notes`** section stating what changes across Angular majors, and a **`## Gotchas`** list of the specific mistakes agents make in that area. Read the gotchas even when skimming.

## Determining the Destination Builder

**Step 1.** Read the Angular major from `package.json` (`@angular/core`), not from a global CLI install - a globally installed CLI is frequently a different major.

**Step 2.** Map the major to a destination builder - 20+ `@angular/build:application`, 17-19 `@angular-devkit/build-angular:application`, 16 `@angular-devkit/build-angular:browser-esbuild`, below 16 upgrade Angular first. Use whichever package name exists in the installed CLI.

**Step 3.** Confirm the current builder actually contains `webpack`. If it does not, this skill probably does not apply - stop and confirm with the user rather than migrating something already migrated.

**Step 4.** In a multi-project workspace, resolve this per project. Migrate every `projectType: "application"`; leave every `projectType: "library"` alone - libraries build with ng-packagr, not the browser or esbuild builder.

Read [angular-versions.md](references/angular-versions.md) for the full matrix, the repo-state rules, and the Karma-versus-Jest decision.

## The Migration, In Order

| # | Step | Read |
|---|---|---|
| 0 | Angular major, destination builder, repo state | [angular-versions.md](references/angular-versions.md) |
| 1 | Inventory the workspace, capture a baseline to measure against | [audit-and-baseline.md](references/audit-and-baseline.md) |
| 2 | Resolve peer deps, remove webpack-era packages, clean the npm scripts | [packages.md](references/packages.md) |
| 3 | Swap the builders, fix `outputPath`, delete `webpack.config.js` | [angular-json.md](references/angular-json.md) |
| 4 | Strip `polyfills.ts` back to what evergreen browsers need | [polyfills.md](references/polyfills.md) |
| 5 | Retarget the tsconfigs - `moduleResolution: "bundler"` is the load-bearing change | [typescript-config.md](references/typescript-config.md) |
| 6 | Fix SCSS `~` prefixes and `url()` resolution | [styles-and-assets.md](references/styles-and-assets.md) |
| 7 | Optionally move Karma to the Jest builder | [test-runner.md](references/test-runner.md) |
| 8 | Work the build errors - the longest step | [troubleshooting.md](references/troubleshooting.md) |
| 9 | Gate before declaring the migration done | [checklist.md](references/checklist.md) |

Steps 2-7 are edits and step 8 is a loop; interleave them. Do not batch all the edits and build once.

**Out of scope:** replacing CommonJS dependencies with ESM equivalents. CJS packages produce *warnings*, not errors - `allowedCommonJsDependencies` handles them and the build succeeds. Swapping `lodash` for `lodash-es` or `moment` for `date-fns` is general dependency hygiene that would be equally valid on webpack, and each swap is an API change with its own regression risk. The one place it connects is T10, where a lost webpack optimisation plugin causes a bundle regression whose proper fix is an ESM-native replacement. Record that regression and treat the replacement as separate work.

Expect roughly **50-70 % faster production builds** and the removal of the webpack, babel and IE-polyfill dependency tree. Expect also a set of pre-existing defects the lenient webpack compiler hid. Both halves are normal.

## When the Build Throws Errors

Each entry in [troubleshooting.md](references/troubleshooting.md) is symptom → cause → fix. Index by the error you actually have:

| Error / symptom | Entry |
|---|---|
| `ERESOLVE` on install | T1 |
| `TS2307` on `pkg/src/...` or `pkg/dist/...` | T2 |
| `TS2612` will overwrite the base property | T3 |
| `TS2729` used before its initialization | T4 |
| `Could not resolve "~assets/..."`, or a wrong relative path | T5 |
| Blank page or 404 after a successful build | T6 |
| `TS2307` on `zone.js/dist/...` | T7 |
| Thousands of CRLF/LF "changes" on Windows | T8 |
| Non-ESM / CommonJS warnings | T9 |
| Bundle grew - a webpack plugin has no esbuild equivalent | T10 |
| `async` not exported from `@angular/core/testing` | T11 |
| Jest builder: duplicate spec filenames collide | T12 |
| Jest builder: Windows path-quoting validation error | T13 |
| "Test suite must contain at least one test" | T14 |

## Checklist

- **Migration Checklist**: Every rule in one scannable list, plus the five that cause the most damage and the typical before/after metrics. Use this as the gate before declaring Phase 1 done. Read [checklist.md](references/checklist.md)
