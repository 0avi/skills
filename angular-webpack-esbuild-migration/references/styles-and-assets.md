# Styles and Assets

One change, two failure modes, and the second is the one that catches people who thought they had finished the first.

## The `~` prefix is gone

`~` was a webpack css-loader convention meaning "resolve from `node_modules` or a configured root". esbuild does not understand it:

```
✘ [ERROR] Could not resolve "~assets/fonts/MyFont.woff2" [plugin angular-css-resource]
```

Remove it. The inventory sweep in [audit-and-baseline.md](audit-and-baseline.md) lists every occurrence.

## Removing `~` is not sufficient - the base changed too

esbuild resolves `url()` **relative to the SCSS file's own location on disk**, not to the project root. So dropping the `~` and leaving the rest produces a path that resolves against the wrong base - usually with no build error at all, just a missing font or image at runtime.

```scss
// SCSS file at: src/scss/_variables.scss
// Asset at:     src/assets/fonts/MyFont.woff2

$font-path: '~assets/fonts';    // wrong - webpack ~ prefix, build error
$font-path: 'assets/fonts';     // wrong - resolves to src/scss/assets/fonts/, silent 404
$font-path: '../assets/fonts';  // correct - one level up from src/scss/
```

Compute the path from the SCSS file to the asset, per file. Files at different depths need different prefixes; a single find-and-replace across the tree will be wrong for some of them.

## Fix the variables, not every `url()`

Most projects build asset paths through a SCSS variable and interpolate it. Fixing the variable propagates everywhere it is used:

```scss
$font-path: '../assets/fonts';

@font-face {
  src: url('#{$font-path}/MyFont.woff2') format('woff2');
}
```

Find the path-building variables first:

```bash
grep -rn "assets/" src --include="*.scss" | grep -E "\\\$[a-z-]+ *:"
```

Only then work the inline `url()` calls that remain. Doing it the other way round means editing dozens of call sites that a single variable fix would have covered.

## Verify at runtime, not at build

A wrong-but-resolvable path produces a green build. Check the actual output:

```bash
ng build --configuration production
ls dist/<app>/media/          # hashed asset output
```

Then load the app and check the network tab for 404s on fonts and images. The build passing tells you the `~` prefixes are gone; only the browser tells you the bases are right.

Full treatment in T5.

## Assets configuration

The `assets` array in `angular.json` carries over unchanged in shape. Two things to check:

- **Globs still match.** The application builder is stricter about a glob that matches nothing - a stale entry that webpack silently ignored may now warn.
- **`copy-webpack-plugin` entries have somewhere to go.** If `webpack.config.js` was copying files the `assets` array does not cover, add them to `assets` before deleting the config. See [packages.md](packages.md).

## Version notes

Version-agnostic. `url()` resolution relative to the importing file is esbuild behaviour, not Angular behaviour, and applies identically on `browser-esbuild` (Angular 16) and every application-builder version. The `~` prefix stopped being meaningful the moment the builder stopped being webpack.

## Gotchas

- Agent strips `~` and stops - the base also changed; the path now resolves relative to the SCSS file, usually to a silent 404
- Agent applies one relative prefix across the whole tree - files at different depths need different prefixes
- Agent fixes inline `url()` calls and misses the path-building SCSS variable - fix the variable first; it propagates
- Agent treats a green build as proof - a wrong-but-resolvable path builds fine and 404s in the browser
- Agent deletes `webpack.config.js` while `copy-webpack-plugin` was copying assets the `assets` array does not cover
- Agent adds a `stylePreprocessorOptions.includePaths` entry to make `~`-style bare paths work again - that reintroduces a root-relative convention the rest of the codebase no longer follows

## Related

- [angular-json.md](angular-json.md) · [packages.md](packages.md) · [troubleshooting.md](troubleshooting.md) · [audit-and-baseline.md](audit-and-baseline.md)
