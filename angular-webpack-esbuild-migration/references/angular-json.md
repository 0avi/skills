# angular.json

The builder swap. Apply every change below to **each `projectType: "application"`** project; skip `library` projects entirely.

## Swap the build builder

```diff
- "builder": "@angular-builders/custom-webpack:browser",
+ "builder": "@angular-devkit/build-angular:application",
```

Use the name that exists in the installed CLI - see [angular-versions.md](angular-versions.md). Delete the `customWebpackConfig` block entirely; there is nothing to preserve from it that the application builder reads.

## Rename the entry point, make polyfills an array

Application builder only. On the `browser-esbuild` stepping stone (Angular 16) keep `main` and the string `polyfills`.

```diff
- "main": "src/main.ts",
- "polyfills": "src/polyfills.ts",
+ "browser": "src/main.ts",
+ "polyfills": ["src/polyfills.ts"],
```

`main` is not deprecated-but-accepted here - the application builder does not know the key. Leaving it produces a schema error, or worse, a build with no entry point.

## Fix `outputPath` - the one that fails silently

The application builder emits into `<outputPath>/browser/`:

```
dist/my-app/
  browser/          ← files land here
    index.html
```

The build succeeds. If a backend serves from `dist/my-app/`, it now serves nothing. Use the object form so `browser` appends nothing:

```diff
- "outputPath": "dist/my-app",
+ "outputPath": { "base": "dist/my-app", "browser": "" }
```

**Verify with `ls` after the first successful build**, not by reading the config. This is T6, and it is the single most common way a "successful" migration reaches a broken deployment.

If the serving layer is under your control and you would rather adopt the default layout, that is also valid - but then update the backend's static path in the same commit. What must not happen is the two drifting apart.

## Add `allowedCommonJsDependencies`

Build once without it, collect the `is not ESM` warnings, then list each package name:

```json
"allowedCommonJsDependencies": ["some-cjs-package", "another-one"]
```

These are warnings, not errors - the build succeeds either way, so nothing here blocks the migration. The list is a **ratchet**: removing a name later is how you verify a dependency has genuinely moved to ESM.

Do not add packages speculatively. A name in the list for a package that no longer warns hides the fact that the work is already done.

## Remove options the application builder does not have

| Option | Why it goes |
|---|---|
| `namedChunks` | No equivalent |
| `vendorChunk` | No equivalent - the application builder chunks differently |
| `buildOptimizer` | Webpack-only |
| `aot` | Always on; the flag is ignored |
| `es5BrowserSupport` | Gone with IE support |
| any `es5` configuration block | Remove from **both** `build` and `serve` architects |
| `tsConfig` pointing at `tsconfig-es5.app.json` | Delete the file too - see [typescript-config.md](typescript-config.md) |

The `es5` configuration in the `serve` architect is the one usually missed, because the build passes without touching it and the failure only appears when someone runs `ng serve --configuration es5`.

## Swap the serve builder

```diff
- "builder": "@angular-builders/custom-webpack:dev-server",
+ "builder": "@angular-devkit/build-angular:dev-server",
```

On Angular 20+, `@angular/build:dev-server`.

## Check the budgets

The application builder enforces `budgets` strictly, and the chunking change moves bundle sizes around considerably - usually a much smaller `main` and a different initial total. Expect budget errors that reflect nothing but the new chunking. Re-baseline the budgets against the real output rather than raising them until the error stops.

## Delete `webpack.config.js`

```bash
rm webpack.config.js
```

Only after the builder swap is in place and you have accounted for every plugin it configured - the inventory sweep lists them. A plugin doing build-time optimisation with no esbuild equivalent is T10; note the regression and move on rather than trying to replicate it now.

## Version notes

- **20+** - `@angular/build:application` and `@angular/build:dev-server`. Option shape is the same as 17-19.
- **17-19** - `@angular-devkit/build-angular:application`. The shape documented above.
- **16** - `browser-esbuild`. Keep `main`, keep the string `polyfills`, keep the string `outputPath`. Everything else on this page - removing the webpack options, the `es5` blocks, `allowedCommonJsDependencies`, deleting `webpack.config.js` - still applies.

## Gotchas

- Agent leaves `outputPath` as a string - files land in a `browser/` subdirectory and the backend silently serves nothing (T6)
- Agent fixes `outputPath` in the config and never runs `ls` on the output - verify the file location, not the config
- Agent renames `main` to `browser` on Angular 16 - `browser-esbuild` takes the old option shape
- Agent leaves `polyfills` as a string on the application builder - it must be an array
- Agent keeps the `customWebpackConfig` block - nothing in it is read; remove it with the builder
- Agent removes the `es5` block from `build` but not from `serve` - the failure surfaces later, on someone else's machine
- Agent populates `allowedCommonJsDependencies` speculatively - build first, then list only what actually warns
- Agent raises the budgets until the error stops - re-baseline them against the new chunking instead
- Agent edits only the first project in a multi-project workspace - every application project needs the same edits
- Agent deletes `webpack.config.js` before accounting for its plugins - a build-time optimisation plugin with no esbuild equivalent is a bundle regression you need to know about (T10)

## Related

- [angular-versions.md](angular-versions.md) · [typescript-config.md](typescript-config.md) · [polyfills.md](polyfills.md) · [test-runner.md](test-runner.md) · [troubleshooting.md](troubleshooting.md)
