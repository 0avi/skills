# Inventory and Baseline

Two things happen before any edit: establish what actually needs migrating, and capture the numbers you will be judged against. Neither is optional and neither can be done afterwards.

## The inventory sweep

Run all of these from the Angular project root - the directory containing `angular.json`. Everything here is read-only. Record what each returns; the results define the scope.

### Scope and version

```bash
# Angular major - authoritative, unlike a globally installed CLI
node -p "require('./package.json').dependencies['@angular/core']"

# Every project, its type, and its current builder
node -p "Object.entries(require('./angular.json').projects).map(([n,p])=>\
\`\${n}  \${p.projectType}  \${p.architect?.build?.builder}\`).join('\n')"
```

Migrate every `projectType: "application"`; skip every `library`. If no builder contains `webpack`, this skill probably does not apply - stop and confirm rather than migrating something already migrated.

```bash
# Angular-ecosystem majors that do not match the Angular major
node -p "const d={...require('./package.json').dependencies,...require('./package.json').devDependencies};\
const a=d['@angular/core'].replace(/[^0-9]/,'').split('.')[0];\
Object.entries(d).filter(([k,v])=>/^@(angular|ngrx)\//.test(k)&&v.replace(/[^0-9]/,'').split('.')[0]!==a).join('\n')"
```

### Config surface

```bash
grep -n "outputPath" angular.json                       # string form? plan the object fix (T6)
grep -nE '"(namedChunks|vendorChunk|buildOptimizer|aot|es5BrowserSupport)"' angular.json
grep -n "es5" angular.json                              # check BOTH build and serve architects
grep -nE "plugins|loader|Plugin" webpack.config.js 2>/dev/null
```

### Source

```bash
# Legacy polyfills
grep -nE "core-js|formdata-polyfill|regenerator-runtime|from 'process'" src/polyfills.ts

# SCSS tilde paths - and the path-building variables, which matter more (T5)
grep -rn "~" src --include="*.scss" | grep -E "url\(|@import|@use"
grep -rn "assets/" src --include="*.scss" | grep -E '\$[a-z-]+ *:'

# Internal package imports - invisible under bundler resolution (T2)
grep -rnE "from '[^']*/(src|dist)/" src --include="*.ts"

# TS2729 candidates: a field initializer referencing an injected service (T4)
grep -rn --include="*.ts" -B2 "= this\.[a-zA-Z]*\." src | grep -E "private|readonly|protected"

# TS2612 candidates: @Input/@Output in a class that extends something (T3)
grep -rlE "extends " src --include="*.ts" | xargs grep -ln "@Input\|@Output"
```

### Tests

```bash
grep -rn "zone.js/dist" src --include="*.ts"                        # T7
grep -rln "\basync(" src --include="*.spec.ts"                      # T11
find src -name "*.spec.ts" -exec basename {} \; | sort | uniq -d    # T12
```

**The sweep defines the scope.** Do not work the steps in [SKILL.md](../SKILL.md) blind - several will not apply to a given project, and running them anyway produces edits that have to be reverted.

On Windows without Git Bash, run these through PowerShell's `Select-String` rather than translating them by hand.

### The two that fail late

Most of what the sweep finds fails loudly at the first build. These two fail *silently*, well after install, and are worth acting on before you get there.

**Internal package imports** - `from 'some-pkg/src/...'` or `.../dist/...`. `moduleResolution: "bundler"`, which the application builder requires, enforces the package's `exports` map. These paths become invisible to TypeScript even though the files are on disk. Nothing warns at install time. Fix in [typescript-config.md](typescript-config.md) / T2.

**`outputPath` as a string.** The application builder emits into `<outputPath>/browser/`. If a backend - Spring Boot, nginx - serves from the base path, the build succeeds and serving silently breaks. Plan the object-form fix now. See [angular-json.md](angular-json.md) / T6.

### Why sweep for source defects before building

The TS2612 and TS2729 greps read source rather than compiling. Both are therefore known before the first `ng build` - which matters, because that first build typically fails on dozens at once, and a list gathered in advance is far easier to work through than a wall of compiler output.

These greps are heuristics, not a type-checker: they over-report. Treat the output as a worklist to verify, not a set of confirmed errors. The authoritative list is whatever the compiler emits.

## The baseline

Do this **before any code change**. You cannot measure the improvement afterwards, and "the build feels faster" is not a migration report.

```bash
npm install
{ time node_modules/.bin/ng build --configuration production 2>&1; } 2>&1 | tee baseline.log
grep -E "Initial total|Build at|real" baseline.log
```

Record five numbers:

- Production build wall time
- `main` chunk, raw and gzip
- `polyfills` chunk, raw and gzip
- Total initial, raw and gzip
- Warning count

Keep `baseline.log`. [checklist.md](checklist.md) carries the typical deltas to compare against, including the one metric that commonly regresses.

Run the build through `node_modules/.bin/ng` rather than a global `ng` - a globally installed CLI is frequently a different major and will not produce a comparable number.

## Version notes

Version-agnostic. The sweep reads the Angular major from `package.json`; [angular-versions.md](angular-versions.md) maps it to a destination builder. The baseline procedure is identical on every version; only the numbers differ.

## Gotchas

- Agent skips the sweep and works the steps in order - most will not apply; scope comes from what the sweep finds
- Agent skips the baseline and starts editing - the improvement then cannot be measured, and a bundle regression cannot be distinguished from a pre-existing one
- Agent runs the baseline with a global `ng` - use `node_modules/.bin/ng`; the global CLI is often a different major
- Agent inventories only the first project in a multi-project workspace - enumerate every project from `angular.json`
- Agent treats the TS2612/TS2729 greps as confirmed errors - they over-report; verify each against the compiler
- Agent takes the greps as exhaustive - they are heuristics; the compiler remains the authority on what is actually broken
- Agent runs the sweep, then ignores the internal-import and `outputPath` findings because the build is still green - both fail silently and late
- Agent deletes `baseline.log` before the final comparison - it is the only record of the before state

## Related

- [angular-versions.md](angular-versions.md) · [packages.md](packages.md) · [angular-json.md](angular-json.md) · [typescript-config.md](typescript-config.md) · [checklist.md](checklist.md)
