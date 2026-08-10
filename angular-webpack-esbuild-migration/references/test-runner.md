# Test Runner - Karma to Jest

**This step is optional.** The Karma builder runs on esbuild from Angular 16, so the build migration is complete without it. The Angular Jest builder is experimental and only on recent versions. Confirm it exists before proposing the move:

```bash
ls node_modules/@angular-devkit/build-angular/src/builders/jest 2>/dev/null
```

If it is absent, keep Karma and skip this file along with T12-T14. Do not present the Jest move as a prerequisite - coupling it to the builder swap doubles the size of a migration that was already going to surface pre-existing test defects.

## What the move actually costs

Expect the test suite to get *worse* before it gets better, for reasons that predate the migration. Generated spec stubs across a typical Angular codebase carry two latent defects that Karma also failed on, but which are easier to ignore there: `async()` removed in Angular 12 (T11), and `declarations: [StandaloneComponent]` throwing before any `it()` registers (T14).

Budget for that. A large red suite after the switch usually means the suite was already broken, not that the switch broke it.

## The builder

```json
"test": {
  "builder": "@angular-devkit/build-angular:jest",
  "options": {
    "tsConfig": "src/tsconfig.spec.json",
    "polyfills": ["src/test-setup.ts"]
  }
}
```

```bash
npm install -D jest jest-environment-jsdom @types/jest
```

## `src/test-setup.ts`

Replaces `src/test.ts` wholesale. Do not fix `test.ts` in place and also create this.

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

`zone.js/testing` goes **here and only here** - never in `polyfills.ts`. See [polyfills.md](polyfills.md).

Drop `@angular/localize/init` if the project does not use `$localize`.

`destroyAfterEach: false` matches the legacy behaviour most existing suites were written against. On a suite you are willing to fix, `true` is the better setting - it catches component teardown leaks. Changing it is a separate task from the migration.

## `src/tsconfig.spec.json`

```diff
- "types": ["jasmine", "node"],
+ "types": ["jest", "node"],
- "files": ["test.ts", "polyfills.ts"],
  "include": [
+   "test-setup.ts",
    "**/*.spec.ts",
    "**/*.d.ts"
  ]
```

Leaving `"jasmine"` in `types` produces plausible-looking type errors where Jasmine and Jest matcher signatures disagree - the suite compiles against the wrong globals.

## Remove the Karma stack

```bash
npm uninstall karma karma-chrome-launcher karma-coverage karma-jasmine \
  karma-jasmine-html-reporter jasmine-core @types/jasmine protractor
rm karma.conf.js src/test.ts
```

Remove any `karma*`, `jasmine*`, `@types/jasmine*` and `protractor` entry present - the exact set varies. Check for a `test` script in `package.json` still pointing at Karma.

## The three Jest-builder defects

All three are documented in [troubleshooting.md](troubleshooting.md); they are listed here because they are near-certain on a real project rather than merely possible.

| Symptom | Cause | Entry |
|---|---|---|
| `Two output files share the same path` | The builder uses the spec *filename*, not the path, as the esbuild output name - two same-named specs in different directories collide | T12 |
| `Directory ."C:\...\{uuid}" in the rootDir option was not found` | The builder passes `--rootDir="…"` through `execFile`, so Jest receives the literal quotes. **Windows local dev only**; Linux and CI are unaffected | T13 |
| `Your test suite must contain at least one test` | Stubs use `declarations: [SomeComponent]` for a standalone component, which throws before any `it()` registers. **Pre-existing** - the same stubs failed under Karma | T14 |

The inventory sweep in [audit-and-baseline.md](audit-and-baseline.md) lists duplicate spec basenames for T12 before you hit them.

## Version notes

- The Jest builder is **experimental and recent**. Verify it exists in the installed CLI rather than assuming from the Angular major.
- **Angular 16+** - the Karma builder runs on esbuild, so staying on Karma is a complete and supported end state.
- **Angular 12+** - `async()` is removed from `@angular/core/testing`; specs must use `waitForAsync()` (T11). This is independent of the runner.
- **Angular 15+** - components are standalone by default, which is what makes the `declarations:` stubs throw (T14).
- T13 is a builder bug, not a version behaviour; expect it to be fixed in a future `@angular-devkit/build-angular` release.

## Gotchas

- Agent treats the Jest move as required - Karma runs on esbuild from 16; this step is optional
- Agent writes the Jest builder config without checking the builder exists in the installed CLI
- Agent puts `zone.js/testing` in `polyfills.ts` instead of `test-setup.ts`
- Agent creates `test-setup.ts` and leaves `test.ts` in place - the new file replaces it
- Agent leaves `"jasmine"` in the spec tsconfig `types` - matcher signatures then disagree with the runtime
- Agent leaves `"files": ["test.ts", "polyfills.ts"]` in the spec tsconfig - both references are now wrong
- Agent forgets to add `test-setup.ts` to `include`
- Agent blames the migration for a red suite - T11 and T14 are pre-existing defects the Karma run was also failing
- Agent chases T13 on CI - it is a Windows-only path-quoting bug; Linux and CI are unaffected
- Agent fixes T14 with `@ts-nocheck` on real specs - that is sanctioned only for generated stubs that were already failing

## Related

- [polyfills.md](polyfills.md) · [typescript-config.md](typescript-config.md) · [angular-json.md](angular-json.md) · [angular-versions.md](angular-versions.md) · [troubleshooting.md](troubleshooting.md)
