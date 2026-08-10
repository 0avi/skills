# Migration Checklist

Every rule in the skill, in one scannable list. Use it as the gate before
declaring the migration done, or as a review pass over a migration someone else
performed. Most of these are silent failures that surface later - at runtime, in
CI, or in a code review buried under line-ending noise.

## The five that cause the most damage

| | Rule | Why it is the worst |
|---|---|---|
| 1 | **`outputPath` object form, verified with `ls`** | The build succeeds and the backend serves nothing. Reaches production more often than any other item (T6) |
| 2 | **Never suppress TS2612 or TS2729** | Both are genuine defects the webpack build swallowed. `@ts-ignore` converts a compile error into a runtime one |
| 3 | **On Windows, PowerShell `ReadAllText`/`WriteAllText` - never `sed -i`** | Rewrites thousands of files to LF, burying every real change in the diff (T8) |
| 4 | **`zone.js/testing` in the test setup only** | Never fails the build. Ships test-only async patching to production |
| 5 | **Removing SCSS `~` is only half the fix** | The resolution base changed too. A wrong-but-resolvable path builds green and 404s in the browser (T5) |

## Scope and preparation

| # | Rule | Reference |
|---|---|---|
| 1 | Read the Angular major from `@angular/core` in `package.json`, never from a globally installed CLI | [angular-versions.md](angular-versions.md) |
| 2 | Map the major to the destination builder - 20+ `@angular/build:application`, 17-19 `@angular-devkit/build-angular:application`, 16 `browser-esbuild`, below 16 upgrade first | [angular-versions.md](angular-versions.md) |
| 3 | Confirm the current builder actually contains `webpack` before migrating anything | [angular-versions.md](angular-versions.md) |
| 4 | Migrate every `projectType: "application"`; leave every `projectType: "library"` alone | [angular-versions.md](angular-versions.md) |
| 5 | Commit or stash first - the diff must stay reviewable and T8 recovery depends on it | [angular-versions.md](angular-versions.md) |
| 6 | On a partially migrated repo, re-run the inventory sweep and do only what it still finds | [angular-versions.md](angular-versions.md) |
| 7 | Run the inventory sweep before any edit and let it set the scope | [audit-and-baseline.md](audit-and-baseline.md) |
| 8 | Capture the baseline - build time, `main`, `polyfills`, total initial, warning count - and keep `baseline.log` | [audit-and-baseline.md](audit-and-baseline.md) |
| 9 | Run the baseline through `node_modules/.bin/ng`, not a global `ng` | [audit-and-baseline.md](audit-and-baseline.md) |
| 10 | Treat the sweep's TS2612/TS2729 hits as a worklist to verify, not as compiler output | [audit-and-baseline.md](audit-and-baseline.md) |

## Packages

| # | Rule | Reference |
|---|---|---|
| 11 | Run `npm install --dry-run` and resolve `ERESOLVE` **before** removing anything | [packages.md](packages.md) · T1 |
| 12 | Every Angular-ecosystem package major matches the Angular major - `@angular/*`, `@angular/cdk`, `@angular/material`, `@ngrx/*` | [packages.md](packages.md) |
| 13 | `legacy-peer-deps=true` only for conflicts in packages you do not control, and documented in `.npmrc` | [packages.md](packages.md) |
| 14 | `@angular-builders/custom-webpack` uninstalled | [packages.md](packages.md) |
| 15 | Webpack, babel, webpack-plugin and IE-shim packages removed - grep outside `webpack.config.js` before removing anything ambiguous | [packages.md](packages.md) |
| 16 | `--max-old-space-size` removed from the npm scripts - esbuild runs outside the Node heap | [packages.md](packages.md) |
| 17 | `--build-optimizer` removed from the npm scripts - webpack-only | [packages.md](packages.md) |

## angular.json

| # | Rule | Reference |
|---|---|---|
| 18 | Build builder swapped; `customWebpackConfig` block deleted | [angular-json.md](angular-json.md) |
| 19 | Entry point renamed `main` → `browser` (application builder only; keep `main` on `browser-esbuild`) | [angular-json.md](angular-json.md) |
| 20 | `polyfills` is an array (application builder only) | [angular-json.md](angular-json.md) |
| 21 | **`outputPath` uses the object form** with `"browser": ""`, or the backend's static path was updated in the same commit | [angular-json.md](angular-json.md) · T6 |
| 22 | `ls <outputPath>/` run after the first build - `index.html` is where the server expects it | [angular-json.md](angular-json.md) · T6 |
| 23 | `allowedCommonJsDependencies` built from actual build warnings, nothing speculative | [angular-json.md](angular-json.md) · T9 |
| 24 | `namedChunks`, `vendorChunk`, `buildOptimizer`, `aot`, `es5BrowserSupport` all removed | [angular-json.md](angular-json.md) |
| 25 | Every `es5` configuration block removed from **both** the `build` and `serve` architects | [angular-json.md](angular-json.md) |
| 26 | Serve builder swapped to `dev-server` | [angular-json.md](angular-json.md) |
| 27 | Budgets re-baselined against the new chunking, not raised until the error stopped | [angular-json.md](angular-json.md) |
| 28 | `webpack.config.js` deleted, after accounting for every plugin it configured | [angular-json.md](angular-json.md) · T10 |

## Polyfills and zone.js

| # | Rule | Reference |
|---|---|---|
| 29 | `polyfills.ts` reduced to `@angular/localize/init` (if used), `./zone-flags` (if present), `zone.js` | [polyfills.md](polyfills.md) |
| 30 | All `core-js/*`, `formdata-polyfill`, `regenerator-runtime/runtime` imports removed | [polyfills.md](polyfills.md) |
| 31 | The webpack `process` shim removed - and any code reading `process` fixed, not the shim restored | [polyfills.md](polyfills.md) |
| 32 | **`zone.js/testing` in the test setup only**, never in `polyfills.ts` | [polyfills.md](polyfills.md) |
| 33 | `zone.js/dist/*` paths replaced with `zone.js` + `zone.js/testing` | [polyfills.md](polyfills.md) · T7 |
| 34 | Polyfills chunk actually shrank against the baseline - no change means the old imports are still reachable | [polyfills.md](polyfills.md) |

## TypeScript

| # | Rule | Reference |
|---|---|---|
| 35 | `moduleResolution: "bundler"` in the root tsconfig - non-negotiable | [typescript-config.md](typescript-config.md) |
| 36 | `target` / `module` / `lib` matched to what the CLI generates for that Angular major, not copied blind | [typescript-config.md](typescript-config.md) |
| 37 | Internal `/src/` and `/dist/` package imports rewritten to the package root | [typescript-config.md](typescript-config.md) · T2 |
| 38 | No `paths` mapping reintroducing a package's internal path | [typescript-config.md](typescript-config.md) · T2 |
| 39 | Subclass `@Input`/`@Output` properties re-declaring a base property marked `declare` | T3 |
| 40 | Class fields initialized from a constructor-injected service moved into the constructor body | T4 |
| 41 | Spec tsconfig `target` off `es5` | [typescript-config.md](typescript-config.md) |
| 42 | `src/tsconfig-es5.app.json` deleted, along with every architect reference to it | [typescript-config.md](typescript-config.md) |
| 43 | **No `skipLibCheck`, `@ts-ignore`, `@ts-nocheck` or `strict: false`** added to silence a migration error | [typescript-config.md](typescript-config.md) |

## Styles and assets

| # | Rule | Reference |
|---|---|---|
| 44 | Every SCSS `~` prefix removed | [styles-and-assets.md](styles-and-assets.md) · T5 |
| 45 | **Every `url()` base recomputed relative to the SCSS file's own location** - removing `~` alone leaves a silent 404 | [styles-and-assets.md](styles-and-assets.md) · T5 |
| 46 | Path-building SCSS *variables* fixed, not only inline `url()` calls | [styles-and-assets.md](styles-and-assets.md) |
| 47 | Fonts and images verified in the browser's network tab, not by a green build | [styles-and-assets.md](styles-and-assets.md) |
| 48 | Anything `copy-webpack-plugin` was copying now covered by the `assets` array | [styles-and-assets.md](styles-and-assets.md) |

## Tests

| # | Rule | Reference |
|---|---|---|
| 49 | The Jest move was a deliberate choice, not an assumed prerequisite - Karma runs on esbuild from 16 | [test-runner.md](test-runner.md) |
| 50 | The Jest builder verified to exist in the installed CLI before being configured | [test-runner.md](test-runner.md) |
| 51 | `src/test-setup.ts` created and `src/test.ts` removed - not both present | [test-runner.md](test-runner.md) |
| 52 | Spec tsconfig `types` changed `jasmine` → `jest`; stale `files` removed; `test-setup.ts` added to `include` | [test-runner.md](test-runner.md) |
| 53 | `karma*`, `jasmine*`, `@types/jasmine*`, `protractor` removed; `karma.conf.js` deleted; the `test` npm script updated | [test-runner.md](test-runner.md) |
| 54 | `async()` renamed to `waitForAsync()` across all specs | T11 |
| 55 | Duplicate spec basenames found and one of each pair excluded | T12 |
| 56 | `@ts-nocheck` used only on generated stubs that were already failing - never on a spec that was passing | T14 |

## Process and acceptance

| # | Rule | Reference |
|---|---|---|
| 57 | Built after every batch of fixes, not once at the end | [SKILL.md](../SKILL.md) |
| 58 | On Windows, all mass edits done with the PowerShell form - never `sed -i` | T8 |
| 59 | `git status` shows only real changes, no CRLF/LF noise | T8 |
| 60 | The dev server starts | [angular-json.md](angular-json.md) |
| 61 | Tests compile and the runner executes | [test-runner.md](test-runner.md) |
| 62 | The UI smoke-tested in a browser - routing, fonts, images, a real data flow | - |
| 63 | Any bundle regression from a lost webpack optimisation plugin recorded in the report, not hidden | T10 |
| 64 | Results compared against `baseline.log` and reported as numbers | [audit-and-baseline.md](audit-and-baseline.md) |

## Typical Phase 1 metrics

From a real production migration - Angular 19, ~560 TS files, several heavy CJS
dependencies, an active IE-polyfill stack:

| Metric | Before (webpack) | After (esbuild) | Change |
|---|---|---|---|
| Production build time | 5m 31s | 2m 13s | **−60 %** |
| Main chunk (gzip) | 561 kB | 57 kB | **−90 %** (better code splitting) |
| Polyfills (gzip) | 41 kB | 12 kB | **−72 %** (IE shims removed) |
| Total initial (gzip) | 759 kB | 949 kB | +25 % (locale-stripping plugin loss) |
| Packages removed | - | ~270 packages | webpack + babel tree gone |

The **+25 % total initial** is a known regression from a webpack
locale-stripping plugin with no esbuild equivalent (T10). It resolves when the
affected dependency is replaced with an ESM-native alternative - which is
separate work, not part of this migration. Report it; do not hide it and do not
try to fix it here.

Your numbers will vary, but the **build-time win of 50-70 % is consistent**
across projects. The bundle-size delta depends entirely on how many IE polyfills
and webpack build-time optimisation plugins the project relied on. A regression
here is a finding to report, not a failure to hide.

## Version notes

Rules 19, 20 and 21 are application-builder only - on `browser-esbuild`
(Angular 16) keep `main`, the string `polyfills` and the string `outputPath`.
Rules 49-56 apply only if you take the optional Jest move. Rule 54 applies from
Angular 12, rule 56 from Angular 15. Everything else holds on every version.

## Gotchas

- Agent declares the migration done on a green build alone - rules 60-64 are all post-build
- Agent walks this list before the build is green - it is a gate, not a plan; the plan is the ordered table in [SKILL.md](../SKILL.md)
- Agent checks rule 21 by reading `angular.json` - rule 22 exists because the config is not the evidence
- Agent skips the metrics comparison because the build "feels faster" - report numbers against `baseline.log`
- Agent hides the T10 bundle regression to make the report look clean - it is expected and has a documented resolution
- Agent applies the Jest rules (49-56) to a project that deliberately stayed on Karma

## Related

- [SKILL.md](../SKILL.md) · [audit-and-baseline.md](audit-and-baseline.md) · [troubleshooting.md](troubleshooting.md) · [angular-json.md](angular-json.md)
