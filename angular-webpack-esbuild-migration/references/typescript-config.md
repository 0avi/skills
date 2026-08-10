# TypeScript Configuration

One change here is load-bearing and the rest are housekeeping. `moduleResolution: "bundler"` is required by the application builder, and it is what breaks internal package imports across the codebase.

## Root `tsconfig.json`

```diff
- "module": "es2020",
+ "module": "es2022",
- "moduleResolution": "node",
+ "moduleResolution": "bundler",
- "target": "es2018",
+ "target": "es2022",
- "lib": ["es2017", "dom", "es2015.promise"]
+ "lib": ["es2022", "dom", "dom.iterable"]
```

**`moduleResolution: "bundler"` is non-negotiable** - the application builder requires it.

The `target` / `module` / `lib` values above suit Angular 17+. On a different major, match what the CLI generates for a fresh project of that version rather than copying these verbatim:

```bash
cd $(mktemp -d) && npx @angular/cli@<major> new probe --skip-install --defaults && cat probe/tsconfig.json
```

esbuild down-levels as needed, so the exact `target` matters far less than the resolution mode.

### What `bundler` resolution breaks

It enforces the package's `exports` map. Any import reaching into a package's internals - `from 'some-pkg/src/models'`, `from 'some-pkg/dist/thing'` - becomes invisible to TypeScript even though the file is on disk. `@ngrx/*` internals are the usual offender.

This fails at **build** time, not install time, and nothing warns beforehand. The inventory sweep in [audit-and-baseline.md](audit-and-baseline.md) lists every occurrence.

Fix by importing from the package root, after confirming the type is actually re-exported there:

```bash
grep -r "export.*YourType" node_modules/some-package/src/index.d.ts
```

```powershell
Get-ChildItem -Path src -Filter "*.ts" -Recurse | ForEach-Object {
    $c = [System.IO.File]::ReadAllText($_.FullName)
    $n = $c -replace "from 'some-package/src/models'", "from 'some-package'"
    if ($c -ne $n) { [System.IO.File]::WriteAllText($_.FullName, $n) }
}
```

On Windows use that form, never `sed -i` - see T8. Full treatment in T2.

If a type genuinely is not re-exported at the root, that is an upstream packaging gap. Raise it; do not work around it by adding a `paths` mapping that reintroduces the deep import under a different name.

### What `target: "es2022"` surfaces

ES2022 class-field semantics change when field initializers run relative to constructor parameters. A field initialized from a constructor-injected service now produces **TS2729**:

```typescript
class MyComponent {
  private result$ = this.myService.getData();          // TS2729
  constructor(private readonly myService: MyService) {}
}
```

This is a real ordering hazard, not a compiler quirk. Move the initializer into the constructor body. Full treatment, including the cascading-field and overload-resolution cases, in T4.

## `src/tsconfig.spec.json`

```diff
- "target": "es5",
+ "target": "es2020",
```

If you are moving to the Jest builder, this file needs more than the target - `types`, `files` and `include` all change. See [test-runner.md](test-runner.md) and do both at once.

## Delete `src/tsconfig-es5.app.json`

```bash
rm src/tsconfig-es5.app.json 2>/dev/null || true
```

Remove the `es5` configuration blocks that referenced it from **both** the `build` and `serve` architects in [angular-json.md](angular-json.md). A deleted tsconfig with a live reference is a build failure that only appears when someone selects that configuration.

## What not to do when the build fails

The stricter compiler surfaces pre-existing defects. Every one of these is a way of hiding a bug rather than fixing it:

| Do not | Because |
|---|---|
| `"skipLibCheck": true` to silence TS2307 | It does not even apply - `skipLibCheck` skips `.d.ts` checking, not module resolution |
| `@ts-ignore` / `@ts-nocheck` on a TS2612 or TS2729 | Both are real defects; suppressing them moves the failure to runtime |
| `"strict": false` | Unrelated to any migration error, and a large unreviewed behaviour change |
| Reverting to `moduleResolution: "node"` | The application builder requires `bundler`; the build will not work |
| A `paths` mapping onto a package's internal path | Reintroduces the deep import the `exports` map deliberately closed |

The one sanctioned suppression is `@ts-nocheck` on **generated spec stubs that were already failing before the migration** - see T14. That is documented technical debt in throwaway files, not a fix.

## Version notes

- **17+** - the values above.
- **16** - `moduleResolution: "bundler"` still applies; `browser-esbuild` uses the same resolution. Match `target`/`module`/`lib` to what Angular 16's CLI generates.
- **20+** - same shape; re-check against a freshly generated project, as the defaults have moved over time.

The TS2729 exposure arrives with `target: "es2022"`, so it appears on whichever version you make that change - not at a particular Angular major.

## Gotchas

- Agent leaves `moduleResolution: "node"` - the application builder requires `bundler`
- Agent reverts to `"node"` when TS2307 appears - the errors are the point; fix the imports
- Agent adds `skipLibCheck: true` to silence TS2307 - it does not affect module resolution and hides nothing but `.d.ts` errors
- Agent adds a `paths` mapping onto `pkg/src/...` - that reintroduces the deep import the `exports` map closed
- Agent copies the `target`/`lib` values verbatim onto a different Angular major - generate a fresh project and match it
- Agent suppresses TS2729 with a definite-assignment `!` and leaves the initializer in place - the ordering hazard is still there; move the initializer into the constructor
- Agent uses `sed -i` for the internal-import rewrite on Windows - use the PowerShell form (T8)
- Agent deletes `tsconfig-es5.app.json` but leaves the `es5` architect configuration referencing it - fails when that configuration is selected
- Agent changes the spec tsconfig target but not `types`/`files`/`include` while moving to Jest - do the whole file at once

## Related

- [angular-json.md](angular-json.md) · [test-runner.md](test-runner.md) · [troubleshooting.md](troubleshooting.md) · [audit-and-baseline.md](audit-and-baseline.md) · [polyfills.md](polyfills.md)
