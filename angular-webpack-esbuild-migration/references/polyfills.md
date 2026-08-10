# Polyfills and zone.js

Two files, and the boundary between them is the thing that goes wrong: `polyfills.ts` is the application's, `test-setup.ts` (or the old `test.ts`) is the test runner's. `zone.js/testing` belongs only in the second.

## `src/polyfills.ts`

Replace the whole file with what evergreen browsers actually need:

```typescript
import '@angular/localize/init';
import './zone-flags';   // only if the project has this file; otherwise omit
import 'zone.js';
```

Keep `@angular/localize/init` only if the project uses `$localize` or Angular i18n. Keep `./zone-flags` only if that file exists.

Remove everything else:

| Remove | Why |
|---|---|
| all `core-js/*` imports | ES5/IE shims; evergreen browsers implement these natively |
| `formdata-polyfill` | Same |
| `regenerator-runtime/runtime` | Babel's async transform runtime; esbuild does not need it |
| `import * as process from 'process'; window['process'] = process;` | A webpack shim for Node globals. esbuild does not inject it, and nothing in application code should be reading `process` |
| `import 'zone.js/testing'` | Belongs in the test setup only - see below |

The `process` shim is worth a moment: if removing it breaks something, that code was reading a Node global in a browser bundle. Fix the reader, do not restore the shim.

## The `zone.js/testing` boundary

`zone.js/testing` patches the async APIs so `fakeAsync` and `waitForAsync` work. In the application bundle it is dead weight that also changes async scheduling behaviour in production.

| File | Imports |
|---|---|
| `src/polyfills.ts` | `zone.js` |
| `src/test-setup.ts` (Jest) or `src/test.ts` (Karma) | `zone.js` **and** `zone.js/testing` |

This is the single most common polyfill mistake in the migration, and it does not fail the build.

## `src/test.ts` - the zone.js path change

If the project still has the pre-0.11 pattern:

```typescript
import 'zone.js/dist/zone';
import 'zone.js/dist/zone-testing';
import 'zone.js/dist/long-stack-trace-zone';
// …
```

zone.js ≥ 0.11 removed the `dist/` directory. Replace the whole block with:

```typescript
import 'zone.js';
import 'zone.js/testing';
```

Confirm the layout before writing it:

```bash
ls node_modules/zone.js/          # fesm2015/ and bundles/, no dist/
```

This is T7. It surfaces as `TS2307` on the test build, not the app build, so a green `ng build` says nothing about it.

If you are also moving to the Jest builder, `test.ts` is replaced wholesale by `test-setup.ts` - see [test-runner.md](test-runner.md). Do that instead of fixing `test.ts` in place.

## Verifying the polyfill reduction

The polyfills chunk is the cleanest single measure of this step. Compare against the baseline:

```bash
grep polyfills baseline.log
```

A drop of 60-75 % gzip is typical for a project that carried a full IE polyfill stack. No change means the old imports are still being pulled in - usually via a `zone-flags` file that itself imports `core-js`.

## Version notes

Version-agnostic. `polyfills.ts` content, the `zone.js/testing` boundary and the zone.js `dist/` removal depend on the zone.js version (≥ 0.11), not the Angular major - and every Angular on a supported line ships a zone.js past that point.

The one Angular-bound detail is in `angular.json`, not here: `polyfills` is an array on the application builder and a string on `browser-esbuild` (Angular 16). See [angular-json.md](angular-json.md).

## Gotchas

- Agent leaves `import 'zone.js/testing'` in `polyfills.ts` - it belongs in the test setup only; ships dead weight and alters production async scheduling
- Agent omits `zone.js/testing` from the test setup - `fakeAsync` and `waitForAsync` then fail at runtime with an unhelpful message
- Agent keeps `core-js` imports "to be safe" - they are IE shims; keeping them defeats the polyfill reduction entirely
- Agent restores the `process` shim when something breaks - fix the code reading a Node global in a browser bundle instead
- Agent removes `@angular/localize/init` from a project that uses `$localize` - check before removing
- Agent keeps `zone.js/dist/*` paths - removed in zone.js 0.11; fails the test build with TS2307 (T7)
- Agent fixes `test.ts` in place while also moving to the Jest builder - `test-setup.ts` replaces it
- Agent declares the step done without checking the polyfills chunk size - no change means the old imports are still reachable, usually through `zone-flags`

## Related

- [angular-json.md](angular-json.md) · [test-runner.md](test-runner.md) · [typescript-config.md](typescript-config.md) · [audit-and-baseline.md](audit-and-baseline.md) · [troubleshooting.md](troubleshooting.md)
