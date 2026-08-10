# Troubleshooting (T1-T14)

Every entry below was hit on a real production migration. Each is
symptom → cause → fix. **Index by the error you actually have** - do not read
this file top to bottom, and do not pre-emptively apply fixes for errors that
have not appeared.

- [T1 - `ERESOLVE` on `npm install`](#t1)
- [T2 - `TS2307: Cannot find module 'pkg/src/...'`](#t2)
- [T3 - `TS2612`: will overwrite the base property](#t3)
- [T4 - `TS2729`: used before its initialization](#t4)
- [T5 - `Could not resolve "~assets/..."` / wrong relative path](#t5)
- [T6 - Blank page / 404 after a successful build (`outputPath`)](#t6)
- [T7 - `TS2307: Cannot find module 'zone.js/dist/...'`](#t7)
- [T8 - CRLF/LF explosion on Windows](#t8)
- [T9 - Non-ESM / CommonJS warnings](#t9)
- [T10 - Bundle grows: webpack plugin has no esbuild equivalent](#t10)
- [T11 - `async` not exported from `@angular/core/testing`](#t11)
- [T12 - Jest builder: duplicate spec filenames collide](#t12)
- [T13 - Jest builder: Windows path-quoting bug](#t13)
- [T14 - "Your test suite must contain at least one test"](#t14)

> **Windows mass-edits:** several fixes below need a project-wide string
> replacement. On Windows use the PowerShell form
> (`[System.IO.File]::ReadAllText`/`WriteAllText`), which preserves each file's
> original line endings. Never `sed -i` - it corrupts line endings across the
> whole tree on Windows (see T8). The `sed` forms shown are Linux/macOS only.

---

<a id="t1"></a>
## T1: `ERESOLVE` on `npm install`

**Symptom:** `npm error ERESOLVE could not resolve`.

**Cause:** Pre-existing peer-dependency mismatches that the existing
`node_modules` was masking. They surface on a clean install.

**Fix:** Correct the version in `package.json` if you control it. For conflicts
involving packages you cannot change, add `legacy-peer-deps=true` to `.npmrc`
and document why - it silences a real version conflict for all installs.

Full treatment in [packages.md](packages.md).

---

<a id="t2"></a>
## T2: `TS2307: Cannot find module 'some-package/src/models'`

**Symptom:** Build fails with `TS2307` for imports like
`from '@some-package/src/models'` or `from '@some-package/dist/something'`.

**Cause:** `moduleResolution: "bundler"` enforces the package's `exports` map.
Internal paths (`/src/`, `/dist/`) not listed in `exports` are now invisible to
TypeScript even though the files exist on disk. A common culprit is `@ngrx/*`
internal paths.

**Fix:** Replace with the public root import, after confirming the type is
re-exported at the package root:

```bash
grep -r "export.*YourType" node_modules/some-package/src/index.d.ts
```

Then rewrite every file. PowerShell (line-ending-safe - use this on Windows):

```powershell
Get-ChildItem -Path src -Filter "*.ts" -Recurse | ForEach-Object {
    $c = [System.IO.File]::ReadAllText($_.FullName)
    $n = $c -replace "from 'some-package/src/models'", "from 'some-package'"
    if ($c -ne $n) { [System.IO.File]::WriteAllText($_.FullName, $n) }
}
```

`sed` (Linux/Mac only - never on Windows, see T8):

```bash
find src -name "*.ts" -exec sed -i "s|from 'some-package/src/models'|from 'some-package'|g" {} +
```

If the type genuinely is not re-exported at the package root, that is an upstream
packaging gap. Raise it - do not add a `paths` mapping that reintroduces the deep
import under another name. See [typescript-config.md](typescript-config.md).

---

<a id="t3"></a>
## T3: `TS2612: Property 'X' will overwrite the base property`

**Symptom:**
`TS2612: Property 'someInput' will overwrite the base property in 'BaseComponent'. If this is intentional, add an initializer. Otherwise, add a 'declare' modifier.`

**Cause:** The Angular compiler plugin (stricter in the application builder)
flags a subclass property that re-declares a base-class property without
`declare`. The old webpack compiler silently swallowed this.

**Fix:** Add `declare` to the subclass property:

```diff
- @Input() someInput: boolean;
+ @Input() declare someInput: boolean;
```

Find all occurrences by grepping for the property names in the error output.

---

<a id="t4"></a>
## T4: `TS2729: Property 'X' is used before its initialization`

**Symptom:** `TS2729: Property 'myService$' is used before its initialization.`

**Cause:** A class field has an inline initializer referencing a
constructor-injected service. Under ES2022 class semantics, TypeScript's
control-flow analysis sees the field initializer as potentially running before
the constructor parameter is assigned.

**Triggering pattern:**

```typescript
class MyComponent {
  private result$ = this.myService.getData(); // ← uses myService
  constructor(private readonly myService: MyService) {}
}
```

**Fix:** Move the initializer into the constructor body:

```typescript
class MyComponent {
  private result$!: Observable<Data>;
  constructor(private readonly myService: MyService) {
    this.result$ = this.myService.getData();
  }
}
```

**Cascading dependencies:** if field B's initializer references field A and A is
also being moved, move both in the same constructor block.

**Overloaded-function type pitfalls:** if the field type was inferred via
`ReturnType<typeof overloadedFn>` or `ReturnType<SomeClass['overloadedMethod']>`,
TS may resolve the wrong overload (e.g. `.value` becomes `unknown`). Replace with
an explicit concrete type:

```typescript
// Before - ambiguous overload resolution
private ctrl!: ReturnType<FormBuilder['control']>;
// After - explicit
private ctrl!: FormControl<string | null>;
```

`FormBuilder.control()` and ngrx's `createEffect()` are common offenders.

---

<a id="t5"></a>
## T5: `Could not resolve "~assets/..."` or wrong relative path after removing `~`

**Symptom:**
`✘ [ERROR] Could not resolve "~assets/fonts/MyFont.woff2" [plugin angular-css-resource]`,
or, after removing `~`, a file-not-found at runtime.

**Cause (two parts):** (1) the `~` prefix was a webpack CSS-loader convention
esbuild doesn't understand; (2) after removing it, esbuild resolves `url()`
relative to the **SCSS file's location on disk**, not the project root - so a
file at `src/scss/` referencing `url('assets/fonts/foo.woff2')` looks for
`src/scss/assets/fonts/foo.woff2`.

**Fix:** Compute the path relative from the SCSS file to the actual asset:

```scss
// SCSS file at: src/scss/_variables.scss   Asset at: src/assets/fonts/MyFont.woff2
$font-path: '~assets/fonts';   // wrong: webpack ~ prefix
$font-path: 'assets/fonts';    // wrong: no ~, but wrong base
$font-path: '../assets/fonts'; // correct: one level up from src/scss/
```

Fixing a path-building SCSS *variable* propagates through interpolation without
touching every `url()` call.

Note the middle case: it produces **no build error**, only a 404 at runtime. A
green build does not clear this entry. Full treatment in
[styles-and-assets.md](styles-and-assets.md).

---

<a id="t6"></a>
## T6: Backend serves a blank page / 404 after a successful build (`outputPath`)

**Symptom:** `ng build` completes, but the backend (Spring Boot, nginx, …)
returns a 404 or blank page; files are missing from the expected directory.

**Cause:** With `outputPath` as a string, the application builder creates a
`browser/` subdirectory:

```
dist/my-app/
  browser/        ← files land here, not at dist/my-app/
    index.html
```

**Fix:** Use the object form so `browser` appends nothing:

```json
"outputPath": { "base": "dist/my-app", "browser": "" }
```

**Verify immediately** after the first successful build - `ls <outputPath>/` and
confirm `index.html` is where the server expects it. Verifying the config
instead of the output is how this reaches production.

Full treatment in [angular-json.md](angular-json.md).

---

<a id="t7"></a>
## T7: `TS2307: Cannot find module 'zone.js/dist/...'`

**Symptom:** Test build fails on `zone.js` import paths.

**Cause:** zone.js ≥ 0.11 removed the `dist/` directory; many projects still have
the pre-0.11 pattern (`import 'zone.js/dist/long-stack-trace-zone';` etc.).

**Fix:** Replace the whole block with `import 'zone.js';` plus
`import 'zone.js/testing';`. Confirm with `ls node_modules/zone.js/` - there
should be `fesm2015/` and `bundles/` but no `dist/`.

If you are also moving to the Jest builder, `test-setup.ts` replaces `test.ts`
wholesale - do that instead of fixing this file in place. See
[polyfills.md](polyfills.md) and [test-runner.md](test-runner.md).

---

<a id="t8"></a>
## T8: CRLF/LF line-ending explosion on Windows

**Symptom:** `git status` shows 2000-5000 modified files; most differ only in
line endings (CRLF → LF). `git diff` shows far fewer real changes.

**Cause:** `sed -i` in Git Bash on Windows rewrites every scanned file as LF -
even files with no match. With `core.autocrlf=true`, the index stored CRLF, so
every touched file now looks changed.

**Recovery:**

```bash
git diff --ignore-cr-at-eol --name-only | sort > real_changes.txt
git status --short | awk '{print $NF}' | sort > status_all.txt
comm -23 status_all.txt real_changes.txt | xargs git restore --
git status --short | wc -l   # should match wc -l real_changes.txt
```

**Prevention:** add a `.gitattributes`:

```
* text=auto
*.sh text eol=lf
*.png binary
*.jpg binary
*.woff binary
*.woff2 binary
*.ttf binary
*.eot binary
```

**Rule:** on Windows, use PowerShell
`[System.IO.File]::ReadAllText`/`WriteAllText` - it reads a file, replaces only
the matched substrings, and writes it back, so untouched bytes including CRLF
endings survive and `git status` shows only real changes. Never `sed -i` for
tree-wide replacements.

---

<a id="t9"></a>
## T9: Non-ESM warnings for private or legacy packages

**Symptom:**
`▲ [WARNING] Module 'some-package' used by '...' is not ESM`.

**Cause:** The package ships a CJS/UMD bundle. esbuild wraps it but warns.

**Fix:** Add it to `allowedCommonJsDependencies` in `angular.json`. These are
warnings, not errors - the build succeeds, and nothing here blocks the
migration. Add only what actually warns; a speculative entry hides the fact that
a package has already moved to ESM.

The real fix is upstream ESM support, which is **outside this migration**.
Replacing a CJS dependency is an API change with its own regression risk and
would be equally valid on webpack. Leave the entry in the list and treat the
replacement as separate work.

---

<a id="t10"></a>
## T10: Webpack plugin has no esbuild equivalent - bundle grows after migration

**Symptom:** Initial bundle size increases noticeably after removing webpack.

**Cause:** Some webpack plugins do build-time tree-shaking/filtering esbuild has
no equivalent for - e.g. `MomentLocalesPlugin` (strips non-default moment
locales, ~750 KB), `ContextReplacementPlugin` for locales, or custom
`DefinePlugin` dead-code elimination (partially replaceable via the esbuild
`define` option in `angular.json`).

**Mitigation, in order:** (1) replace the underlying package with an ESM-native,
tree-shakeable alternative - the correct long-term fix, belongs in Phase 2+;
(2) write a custom esbuild plugin (complex, non-standard); (3) accept the
regression temporarily and document it in your metrics.

**Do not** spend the migration replicating webpack plugins, and do not start
option (1) inside it either - an ESM dependency swap is separate work with its
own regression risk. Record the regression in your metrics, state it in the
report, and move on. This is the one migration outcome that legitimately looks
like a step backwards, and hiding it is worse than carrying it.

---

<a id="t11"></a>
## T11: `async` from `@angular/core/testing` not found

**Symptom:** `TS2305: Module '"@angular/core/testing"' has no exported member
'async'` across many spec files.

**Cause:** `async()` was deprecated in Angular 10 and removed in Angular 12;
auto-generated spec stubs still use it. The replacement is `waitForAsync()`.

**Fix** - PowerShell (line-ending-safe; use this on Windows):

```powershell
Get-ChildItem -Path 'src' -Recurse -Filter '*.spec.ts' | ForEach-Object {
  $c = [System.IO.File]::ReadAllText($_.FullName)
  if ($c -match '{ async,') {
    $c = $c -replace '{ async,', '{ waitForAsync,' -replace 'async\(', 'waitForAsync('
    [System.IO.File]::WriteAllText($_.FullName, $c)
  }
}
```

---

<a id="t12"></a>
## T12: Angular Jest builder - duplicate spec filenames collide

**Symptom:**
`Two output files share the same path but have different contents: foo.component.spec.mjs`.

**Cause:** The experimental Angular Jest builder (19.x) uses only the filename -
not the full path - as the esbuild output name, so two same-named specs in
different directories collide.

**Fix:** Find duplicates and exclude one of each pair:

```bash
find src -name "*.spec.ts" | xargs -I{} basename {} | sort | uniq -d   # list dupes
find src -name "<duplicate>.spec.ts"                                   # locate each
```

```json
"test": {
  "builder": "@angular-devkit/build-angular:jest",
  "options": {
    "tsConfig": "src/tsconfig.spec.json",
    "polyfills": ["src/test-setup.ts"],
    "exclude": ["src/path/to/duplicate/foo.component.spec.ts"]
  }
}
```

(The inventory sweep in [audit-and-baseline.md](audit-and-baseline.md) lists duplicate spec basenames for you.)

---

<a id="t13"></a>
## T13: Angular Jest builder Windows path-quoting bug

**Symptom (Windows only):** the build step succeeds, then
`Validation Error: Directory ."C:\...\dist\test-out\{uuid}" in the rootDir option was not found.`

**Cause:** The builder invokes Jest via Node `execFile` with
`--rootDir="${testOut}"` (quotes included). `execFile` doesn't go through a
shell, so Jest receives the literal quotes as part of the path.

**Impact:** Windows local dev only - Linux/Mac/CI is unaffected.

**Workaround - run Jest directly after the build step (the UUID changes each
run, so the two steps must be sequential):**

```bash
node node_modules/@angular/cli/bin/ng.js test 2>/dev/null || true   # compiles specs, then fails at Jest
LATEST=$(ls -t dist/test-out/ | head -1)
node --experimental-vm-modules node_modules/jest/bin/jest.js \
  --rootDir="dist/test-out/$LATEST" \
  --config=node_modules/@angular-devkit/build-angular/src/builders/jest/jest.config.mjs \
  --testEnvironment=jsdom --no-cache \
  --testMatch="<rootDir>/**/*.mjs" \
  --setupFilesAfterEnv="<rootDir>/jest-global.mjs" \
  --setupFilesAfterEnv="<rootDir>/polyfills.mjs" \
  --setupFilesAfterEnv="<rootDir>/init-test-bed.mjs" \
  --testPathIgnorePatterns="<rootDir>/jest-global\\.mjs" \
  --testPathIgnorePatterns="<rootDir>/polyfills\\.mjs" \
  --testPathIgnorePatterns="<rootDir>/init-test-bed\\.mjs" \
  --testPathIgnorePatterns="<rootDir>/chunk-.*\\.mjs"
```

Fix expected in a future `@angular-devkit/build-angular` release.

---

<a id="t14"></a>
## T14: "Your test suite must contain at least one test" at runtime

**Symptom:** Many spec suites fail with
`Test suite failed to run - Your test suite must contain at least one test.`

**Cause:** CLI-generated stubs use `declarations: [SomeComponent]` in
`TestBed.configureTestingModule`. In Angular 15+, components are standalone -
passing them to `declarations` throws synchronously before any `it()` registers,
so Jest sees an empty suite. **This is pre-existing, not caused by Karma to Jest**:
the same stubs failed the same way under Karma.

**Long-term fix:** rewrite stubs to use standalone imports:

```typescript
TestBed.configureTestingModule({
  imports: [SomeStandaloneComponent, ...requiredDependencies],
}).compileComponents();
```

**Short-term (stub-only projects):** add `// @ts-nocheck` to suppress
compile-time errors on stubs, accept the runtime failures, and write real tests
when the components stabilize.

This is the **only** sanctioned suppression in the whole migration, and it is
narrow: generated stubs that contained no real assertions and were already
failing. Never apply it to a spec that was passing.

## Version notes

Most entries are version-agnostic, but five are bounded:

| Entry | Bound |
|---|---|
| T2, T4 | Arrive with `moduleResolution: "bundler"` and `target: "es2022"` - whichever Angular version you make those changes on |
| T7 | zone.js ≥ 0.11, which every supported Angular ships |
| T11 | `async()` removed from `@angular/core/testing` in Angular 12 |
| T12, T13 | The experimental Jest builder only. Not applicable if you stay on Karma ([test-runner.md](test-runner.md)) |
| T14 | Angular 15+, where components are standalone by default |

T3, T5, T6 and T9 apply on `browser-esbuild` (Angular 16) exactly as they do on
the application builder - the strictness comes from esbuild and the Angular
compiler plugin, not from the builder's option shape.

## Gotchas

- Agent reads this file top to bottom and pre-applies fixes - index by the error actually emitted; several entries will not apply
- Agent suppresses TS2612 or TS2729 rather than fixing them - both are real defects the webpack build swallowed
- Agent adds `skipLibCheck` for a TS2307 - it skips `.d.ts` checking and does nothing for module resolution
- Agent uses `sed -i` for a T2 or T11 mass replacement on Windows - that is T8; use the PowerShell form
- Agent treats a green build as clearing T5 or T6 - both fail silently after a successful build
- Agent applies the T14 `@ts-nocheck` to real specs - it is scoped to already-failing generated stubs
- Agent chases T13 in CI - Windows local dev only
- Agent tries to replicate a webpack optimisation plugin during Phase 1 (T10) - record the regression and move on
- Agent reports the migration as done with T5 or T10 outstanding - one is a runtime 404, the other a measured regression; both belong in the report

## Related

- [packages.md](packages.md) · [angular-json.md](angular-json.md) · [typescript-config.md](typescript-config.md) · [polyfills.md](polyfills.md) · [styles-and-assets.md](styles-and-assets.md) · [test-runner.md](test-runner.md) · [checklist.md](checklist.md)
