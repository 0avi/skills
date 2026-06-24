# Phase 1 — "commonly missed" checklist & expected metrics

## Before calling Phase 1 done

Each of these has bitten a real migration. Walk the list before declaring
success — most are silent failures that only show up later (at runtime, in CI,
or in a code review full of line-ending noise).

- [ ] **`outputPath` object form** — does the backend's serve path match? Run
      `ls <outputPath>/` after the first build and confirm `index.html` is there
      (T6).
- [ ] **SCSS `~` paths** — ran the audit / `grep -rn "url('~" src`? Check SCSS
      *variables* that build paths, not just inline `url()` calls (T5).
- [ ] **`zone.js/testing` placement** — it must be in `test-setup.ts` only,
      never in `polyfills.ts`.
- [ ] **`zone.js/dist/*` in old `test.ts`** — replaced with a single
      `import 'zone.js/testing'` (T7).
- [ ] **`async` in spec files** — renamed to `waitForAsync` across all specs
      (Angular 12+; T11).
- [ ] **Duplicate spec filenames** — found with
      `find src -name "*.spec.ts" | xargs basename | sort | uniq -d` and excluded
      one of each pair in the Jest builder options (T12).
- [ ] **Spec stub type errors** — `// @ts-nocheck` on stubs with pre-existing
      type errors (T14).
- [ ] **Windows: Jest builder path-quoting bug** — `ng test` compiles specs but
      the Jest invocation fails; works in Linux CI (T13).
- [ ] **All `es5` configurations** — removed from both `build` and `serve`
      architects?
- [ ] **`namedChunks`, `vendorChunk`, `buildOptimizer`, `aot`** — all removed
      from `angular.json`?
- [ ] **`--max-old-space-size` in npm scripts** — removed? (esbuild is native
      Go, not in the Node heap)
- [ ] **`--build-optimizer` in npm scripts** — removed? (webpack-only flag)
- [ ] **Internal package imports** (`/src/`, `/dist/`) — grepped for them?
      `bundler` resolution breaks these silently at build time, not install time
      (T2).
- [ ] **`@Input()` properties in subclasses** — any needing a `declare` modifier?
      (T3 / TS2612)
- [ ] **Class fields using injected services in initializers** — checked for
      TS2729? (T4)
- [ ] **Angular ecosystem package versions** — every `@angular/*`, `@angular/cdk`,
      `@angular/material`, `@ngrx/*` major matches the Angular major?
- [ ] **Peer-dependency conflicts** — ran `npm install --dry-run` before removing
      packages (T1)?
- [ ] **CRLF noise on Windows** — used `codemod.mjs` / PowerShell, not `sed -i`,
      for mass replacements (T8)?
- [ ] **Budget errors** — the application builder enforces bundle budgets
      strictly; check `budgets` in `angular.json`.
- [ ] **`legacy-peer-deps` need** — if required, documented in `.npmrc` and the
      team wiki.

## Phase 1 metrics — typical results

From a real production migration (Angular 19, ~560 TS files, several heavy CJS
dependencies, an active IE-polyfill stack):

| Metric | Before (webpack) | After (esbuild) | Change |
|---|---|---|---|
| Production build time | 5m 31s | 2m 13s | **−60 %** |
| Main chunk (gzip) | 561 kB | 57 kB | **−90 %** (better code splitting) |
| Polyfills (gzip) | 41 kB | 12 kB | **−72 %** (IE shims removed) |
| Total initial (gzip) | 759 kB | 949 kB | +25 % (locale-stripping plugin loss) |
| Packages removed | — | ~270 packages | webpack + babel tree gone |

The **+25 % total initial** is a known *temporary* regression from a webpack
locale-stripping plugin with no esbuild equivalent (T10). It resolves when the
affected dependency is replaced with an ESM-native alternative in Phase 2+.

Your numbers will vary, but the **build-time win (−50 % to −70 %) is consistent**
across projects. The bundle-size delta depends on how many IE polyfills and
webpack build-time optimization plugins the project relied on. Compare against
the `baseline.log` you captured in Phase 0.
