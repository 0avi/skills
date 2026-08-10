# Angular Versions and Repo States

Two things decide the shape of the migration: the Angular major, which fixes the destination builder, and the repo state, which fixes the scope. Establish both before editing; the inventory sweep in [audit-and-baseline.md](audit-and-baseline.md) covers both.

## The destination builder

| Angular major | Destination builder | Notes |
|---|---|---|
| **20+** | `@angular/build:application` | The builder moved to its own package. `@angular-devkit/build-angular:application` still resolves as an alias, but prefer the new name |
| **17-19** | `@angular-devkit/build-angular:application` | The main path. Validated end-to-end on 19 / build-angular 19.2.x |
| **16** | `@angular-devkit/build-angular:browser-esbuild` | The application builder does not exist yet. This is a drop-in stepping stone |
| **below 16** | none - upgrade first | esbuild builders do not exist. Run `ng update @angular/core @angular/cli` as a separate task, then return |

Use whichever package name exists in the installed CLI. Check before writing it:

```bash
ls node_modules/@angular/build/package.json 2>/dev/null && echo "use @angular/build:application"
```

### What `browser-esbuild` does and does not change

`browser-esbuild` runs the same esbuild pipeline but accepts the **old browser-builder option shape**. On Angular 16 that means:

| Option | `browser-esbuild` (16) | `application` (17+) |
|---|---|---|
| Entry point | `"main": "src/main.ts"` | `"browser": "src/main.ts"` |
| Polyfills | `"polyfills": "src/polyfills.ts"` (string) | `"polyfills": ["src/polyfills.ts"]` (array) |
| Output | `"outputPath": "dist/app"` (string, flat) | object form needed to stay flat - see [angular-json.md](angular-json.md) |

So on 16 you get the whole compiler-strictness payload - the TS2612, TS2729, SCSS `~`, `moduleResolution` and polyfill work is identical - without the `angular.json` key renames. Do the source and config work now; defer the entry-point rename and the `outputPath` object form until you reach 17+.

The compiler-strictness work is the bulk of the effort. Doing it on 16 and finishing at 17+ is a legitimate two-stage migration, not a half-measure.

## The test runner

The native Jest builder (`@angular-devkit/build-angular:jest`) is **experimental and only on recent versions**. It is the recommended end state, not a requirement.

**The Karma builder also runs on esbuild from Angular 16.** If the Jest builder is unavailable, or you would rather not adopt an experimental builder, keep Karma and skip [test-runner.md](test-runner.md) entirely along with T12-T14. You still get the esbuild build; you simply do not get the Jest move.

Do not present the Jest move as a prerequisite. It is a separable decision, and coupling it to the builder swap doubles the size of a migration that was already going to surface pre-existing test defects.

## Repo states

### Multi-project workspaces

Repeat the per-project steps - builder swap, `outputPath`, entry point, polyfills - for **every `projectType: "application"`** in `angular.json`.

**Leave `projectType: "library"` projects alone.** Libraries build with ng-packagr (`@angular-devkit/build-angular:ng-packagr`), which is not a webpack builder and is not affected by any of this. The inventory sweep in [audit-and-baseline.md](audit-and-baseline.md) enumerates every project with its type and builder, so the split is explicit.

The root-level files - `tsconfig.json`, `.npmrc`, `.gitattributes` - are shared. Change them once, then verify every project still builds, not just the one you were working on.

### Partially migrated repos

Every step in this skill is idempotent. Re-run the inventory sweep; it surfaces only what is left, and repeating a completed step is a no-op. A repo where someone swapped the builder but never fixed `outputPath`, or fixed the polyfills but not the tsconfig, is a normal starting point - resume from what the sweep reports rather than starting over.

### Dirty working tree

Commit or stash before starting. Two reasons, and the second is the sharp one: the migration diff stays reviewable, and the CRLF recovery procedure in T8 depends on being able to distinguish migration changes from pre-existing ones.

## Angular ecosystem version alignment

Independent of the builder, every Angular-ecosystem package major must match the Angular major - `@angular/*`, `@angular/cdk`, `@angular/material`, `@ngrx/*`. A `@angular/cdk@17` in an Angular 19 app breaks the clean install that the migration forces. The existing `node_modules` was masking it. See [packages.md](packages.md).

## Version notes

This file is the version reference; the matrix above is the summary. The version-bound decisions elsewhere in the skill are: the builder name and option shape ([angular-json.md](angular-json.md)), the `target`/`module`/`lib` values ([typescript-config.md](typescript-config.md)), the Jest builder's availability ([test-runner.md](test-runner.md)), and `waitForAsync` replacing `async` from Angular 12 (T11). Everything else is version-agnostic.

## Gotchas

- Agent reads the Angular version from a globally installed CLI - read `@angular/core` in `package.json`; the global CLI is frequently a different major
- Agent writes `@angular-devkit/build-angular:application` on Angular 16 - that builder does not exist there; use `browser-esbuild`
- Agent writes `@angular/build:application` on Angular 19 - that package does not exist before 20
- Agent renames `main` to `browser` on the `browser-esbuild` stepping stone - that builder takes the old option shape; the rename belongs at 17+
- Agent migrates a `projectType: "library"` project - libraries use ng-packagr and are unaffected
- Agent migrates only the first project in a multi-project workspace - every application project needs the same treatment
- Agent treats the Karma → Jest move as mandatory - Karma runs on esbuild from 16; the Jest builder is experimental and optional
- Agent starts on a dirty tree - the migration diff becomes unreviewable and T8 recovery stops working
- Agent restarts from step 1 on a partially migrated repo - re-run the inventory sweep and do only what it still finds

## Related

- [audit-and-baseline.md](audit-and-baseline.md) · [angular-json.md](angular-json.md) · [typescript-config.md](typescript-config.md) · [test-runner.md](test-runner.md) · [packages.md](packages.md)
