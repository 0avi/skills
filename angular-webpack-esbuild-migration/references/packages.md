# Packages and Scripts

Three changes to `package.json`, in this order: resolve the peer-dependency mismatches the existing `node_modules` was hiding, remove the webpack-era tree, then clean the dead flags out of the scripts.

Order matters. Removing packages before resolving the mismatches produces an `ERESOLVE` you cannot attribute.

## 1 - Resolve pre-existing peer-dependency mismatches

The migration forces a clean install, and a clean install fails on mismatches the current `node_modules` was masking. Surface them first:

```bash
npm install --dry-run 2>&1 | grep ERESOLVE
```

**The rule:** every Angular-ecosystem package major must match the Angular major in use - `@angular/*`, `@angular/cdk`, `@angular/material`, `@ngrx/*`. A `@angular/cdk@17` in an Angular 19 app breaks the install. The usual cause is packages left behind during an earlier Angular upgrade, which kept working because nothing forced a resolution.

Fix the versions in `package.json`.

If a private or third-party package creates a genuinely **unresolvable** conflict you do not control, add `legacy-peer-deps=true` to `.npmrc` - and document why, in the file and wherever the team keeps decisions. It silences peer resolution for *all* installs, not just this one, so it is a standing liability rather than a migration workaround.

## 2 - Remove the webpack-era tree

Always, when moving off custom-webpack:

```bash
npm uninstall @angular-builders/custom-webpack
```

Then remove these **if present** - not every project has all of them:

| Group | Packages |
|---|---|
| Webpack itself | `webpack`, `webpack-bundle-analyzer`, `webpack-merge` |
| The babel pipeline | `@babel/core`, `@babel/preset-env`, `babel-loader`, other `@babel/*` helpers |
| Webpack-specific plugins | anything with `webpack` in the name - `copy-webpack-plugin`, `moment-locales-webpack-plugin` |
| IE and ES5 runtime shims | `formdata-polyfill`, `process`, `regenerator-runtime` |

esbuild transpiles natively, so the babel pipeline has no remaining purpose.

**The pattern:** anything that exists only to support webpack's JS-based pipeline, or IE compatibility, can go. When unsure whether a package is load-bearing, check whether it is referenced anywhere outside `webpack.config.js` and `polyfills.ts`:

```bash
grep -rl "package-name" src/ *.js *.json --exclude-dir=node_modules
```

Removing `moment-locales-webpack-plugin` is the one with a visible cost - it was stripping locales at build time and esbuild has no equivalent, so the bundle grows. That is expected and is T10; do not try to replicate it during Phase 1.

Verify a clean install afterwards (`npm install`, plus `--legacy-peer-deps` if step 1 required it).

## 3 - Clean the npm scripts

```diff
- "build": "node --max-old-space-size=8192 ./node_modules/@angular/cli/bin/ng build",
+ "build": "ng build --configuration production",
- "start": "node --max-old-space-size=8192 ./node_modules/@angular/cli/bin/ng serve",
+ "start": "ng serve",
```

Two flags to remove:

- **`--max-old-space-size`** - esbuild is a native Go binary running outside the Node heap. The flag is dead weight, and leaving it in implies a memory constraint that no longer exists.
- **`--build-optimizer`** - webpack-only. The application builder has no such option and will reject or ignore it.

## Version notes

Version-agnostic. The package removals, the peer-dependency rule and the dead script flags are the same on every Angular major. The only version-bound part is *which* Angular-ecosystem major counts as matching - see [angular-versions.md](angular-versions.md).

## Gotchas

- Agent removes packages before running `npm install --dry-run` - the resulting `ERESOLVE` cannot be attributed to a cause
- Agent adds `legacy-peer-deps=true` to work around a mismatch it could have fixed - use it only for conflicts in packages you do not control, and document it
- Agent removes `@babel/*` packages that a non-webpack tool still uses - grep outside `webpack.config.js` first
- Agent leaves `@angular-builders/custom-webpack` installed after swapping the builder - it is dead weight and implies the old builder is still reachable
- Agent keeps `--max-old-space-size` in the build script - esbuild runs outside the Node heap
- Agent keeps `--build-optimizer` - a webpack-only flag with no application-builder equivalent
- Agent panics at the bundle growth after removing a locale-stripping plugin - expected and documented as T10; record it and move on
- Agent upgrades Angular itself as part of this step - version alignment means matching the *existing* Angular major, not moving to a new one

## Related

- [angular-versions.md](angular-versions.md) · [audit-and-baseline.md](audit-and-baseline.md) · [angular-json.md](angular-json.md) · [troubleshooting.md](troubleshooting.md)
