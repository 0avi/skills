# Phase 2+ — CommonJS dependency modernization

Phase 1 gets the build green. The remaining work is progressively replacing CJS
dependencies with their ESM equivalents to recover bundle size and unlock
tree-shaking. **Each dependency is its own phase** — scope and effort depend
entirely on the project's dependency tree, so there is no fixed list.

## Identify your follow-on phases

```bash
# Every CJS warning the build emits
ng build --configuration production 2>&1 | grep "CommonJS or AMD"

# For each warned package, how many files import it
grep -rl "from 'package-name'" src | wc -l
grep -rl "require('package-name')" src | wc -l
```

Prioritize by:

1. **Bundle impact** — packages pulled into the initial chunk hurt load time
   most.
2. **File count** — more files = more migration effort; do low-count ones first
   to build momentum.
3. **ESM availability** — confirm an ESM version or alternative exists before
   starting.

## General CJS → ESM pattern (per dependency)

1. **Check whether an ESM build exists:**

   ```bash
   node -e "const p=require('./node_modules/pkg/package.json'); console.log(p.exports || p.module || 'CJS only')"
   ```

2. **Upgrade or replace:**
   - Same package, newer ESM version: `npm install pkg@latest`.
   - Different package (ESM alternative): `npm uninstall old && npm install new`.
   - No ESM alternative: leave it in `allowedCommonJsDependencies` and accept the
     warning.

3. **Codemod the imports** (use `scripts/codemod.mjs` on Windows for CRLF
   safety); scope-check first with `grep -rl "from 'old-pkg'" src | wc -l`.

4. **Remove the package from `allowedCommonJsDependencies`.** If the build still
   warns, the CJS path isn't fully gone — keep going.

5. **Measure the bundle delta** before and after each phase.

## Illustrative CJS → ESM swaps

These are *common patterns*, not a prescription — always run the audit commands
above rather than assuming any package is present.

| CJS package | ESM path | Notes |
|---|---|---|
| `lodash` | `lodash-es` | Named imports only — `import { debounce } from 'lodash-es'`; default import does not tree-shake |
| `moment` | `date-fns` or `dayjs` | API change required; not a drop-in swap |
| `d3` v4 | `d3` v7 | Same package, ESM in v7; `d3.event` removed — handlers receive the event as first argument |
| `jspdf` v1 | `jspdf` v2+ | Constructor signature changed in v2 |
| `pdfmake` v0.1 | `pdfmake` v0.2+ | Partial ESM; verify tree-shaking with your usage |
| `jquery` | — | Removal depends on whether a loaded library hard-depends on it at runtime; assess before attempting |
