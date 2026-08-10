# tsconfig

Most of this skill's rules are only advice unless the compiler enforces them. This is the configuration that does.

## The baseline

Derived from Matt Pocock's [TSConfig Cheat Sheet](https://www.totaltypescript.com/tsconfig-cheat-sheet), with the additions noted below.

```jsonc
{
  "compilerOptions": {
    // Correctness
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,

    // Module semantics
    "module": "nodenext",              // or "preserve" when a bundler emits
    "moduleResolution": "nodenext",    // or "bundler"
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",

    // Output
    "target": "es2022",
    "lib": ["es2022"],                 // add "dom" for browser code
    "outDir": "dist",
    "sourceMap": true,
    "declaration": true,

    // Interop
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,

    // Explicit on 6.0+
    "types": ["node"]
  }
}
```

`target: "es2022"` is a deliberate floor rather than a ceiling - it is the version at which `#private` fields, static blocks and `Error.cause` are native rather than downlevelled. Going higher is fine; going lower reintroduces emit that this skill's rules assume is gone.

## What `strict` does not cover

`strict: true` is nine flags. Three of the most valuable checks are outside it.

### `noUncheckedIndexedAccess` - enable it

Without it, TypeScript lies about every array index and every index-signature read:

```typescript
const users: string[] = [];
const first = users[0];        // typed string. It is undefined.
first.toUpperCase();           // compiles, throws
```

With it, `first` is `string | undefined` and you must handle it. This is the single highest-value flag outside `strict`, and the one most often missing.

It is noisy on an existing codebase. Enable it on new work; on existing code, enable and fix rather than enable and suppress.

### `exactOptionalPropertyTypes` - enable on new code

Distinguishes "absent" from "present and `undefined`":

```typescript
interface Options { timeout?: number }

const a: Options = {};                  // ok - absent
const b: Options = { timeout: undefined };  // error with the flag on
```

That distinction is real - `'timeout' in b` is `true` - and code that spreads or merges options objects gets it wrong constantly. The flag is genuinely disruptive to retrofit, so: on for new projects, deliberate migration for existing ones. Not in the baseline above for that reason; add it when starting fresh.

### `verbatimModuleSyntax` - enable it

Imports and exports are emitted exactly as written. Anything with a `type` modifier is dropped; anything without it stays. No inference about what was "only a type".

This is what makes [imports-and-exports.md](imports-and-exports.md)'s `import type` rule mechanically enforced rather than aspirational, and it catches mixing `require` into an ESM file. The one incompatibility: it cannot work with a build that emits both ESM and CJS from the same source, because its whole purpose is preventing an `import` from becoming a `require`.

## The rest, briefly

| Option | Why |
|---|---|
| `isolatedModules` | Guarantees each file can be transpiled alone - required by esbuild, swc, Babel and Node's stripper |
| `moduleDetection: "force"` | Every file is a module. Stops a file without imports leaking globals |
| `noImplicitOverride` | `override` must be explicit; catches a renamed base method silently becoming a new one |
| `noFallthroughCasesInSwitch` | Enforces the fallthrough rule in [control-flow.md](control-flow.md) at the compiler rather than the linter |
| `skipLibCheck` | Skips checking `.d.ts` in dependencies. Pragmatic - you cannot fix their types, and it is a large build-time saving |
| `declaration` | Required for a library; harmless otherwise |

### Deliberately not in the baseline

`noUnusedLocals` and `noUnusedParameters` - leave these to the linter. As compiler options they fail the build mid-edit, when you have commented out a line and not yet deleted its import. As lint rules they surface identically without blocking. Matt Pocock's cheat sheet calls this family too noisy for the compiler, and that is the reason.

`noImplicitReturns` is a matter of taste; enable it if the team wants every branch explicit.

## `erasableSyntaxOnly`

Bans every construct that is not a pure type annotation: **`enum`, `namespace`, parameter properties**. Ambient declarations (`declare`) are exempt.

**Enable it.** Three reasons, and the first is sufficient:

1. This skill bans `enum` and `namespace` anyway ([enums-and-constants.md](enums-and-constants.md), [disallowed-features.md](disallowed-features.md)). The flag turns two review rules into compiler errors.
2. Node runs `.ts` directly by stripping types, and its stripper cannot handle anything that emits. Without the flag you find out at runtime.
3. Every non-`tsc` transpiler - esbuild, swc - treats these as special cases. Not using them removes a class of toolchain divergence.

The one real cost is parameter properties, which are widely used in Angular and NestJS DI. See [classes.md](classes.md); if the framework requires them, leave the flag off and hold the enum and namespace bans by lint instead.

## `isolatedDeclarations`

Requires explicit return types on everything exported, so `.d.ts` files can be generated per-file without type-checking. In a large monorepo that turns declaration emit from a serial bottleneck into a parallel one.

Worth it for a published library or a monorepo with many packages. Overhead without payoff for an application. It also, as a side effect, enforces the explicit-return-type habit that [type-inference.md](type-inference.md) treats as optional.

## Reading an existing config

Follow `extends` to the end before concluding anything - a project that looks lax often inherits `@tsconfig/strictest`, and one that looks strict may override it two files down.

```bash
npx tsc --showConfig      # the fully resolved config, after all extends
```

Use that output, not the file you happened to open. Then check the three flags this skill's advice depends on most: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.

## Version notes

- **6.0+** - `strict`, `module: esnext`, `noUncheckedSideEffectImports: true` and a floating `target` are the defaults; `types` defaults to `[]`, so ambient type packages must be listed explicitly. `target: es5` and `moduleResolution: node`/`classic` are gone.
- **7.0** - additionally removes `baseUrl`, `downlevelIteration`, `module: amd`/`umd`/`systemjs`, and forbids disabling `esModuleInterop`, `allowSyntheticDefaultImports` or `alwaysStrict`. `rootDir: ./` and `stableTypeOrdering: true` become defaults.
- **5.x** - none of the above are defaults; set `strict`, `module` and `types` explicitly. `erasableSyntaxOnly` needs 5.8+, `isolatedDeclarations` 5.5+, `verbatimModuleSyntax` 5.0+.

## Gotchas

- Agent sets `strict: true` and calls the project strict - `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax` are all outside it
- Agent omits `noUncheckedIndexedAccess` - every array index then lies about being defined
- Agent enables `exactOptionalPropertyTypes` on a large existing codebase mid-task - it is a deliberate migration, not a flag flip
- Agent judges strictness from the file it opened instead of `tsc --showConfig` - `extends` chains hide both directions
- Agent sets `noUnusedLocals` in the compiler - it fails the build mid-edit; the lint rule reports the same thing without blocking
- Agent leaves `types` unset on 6.0+ and loses ambient globals - it defaults to `[]` now
- Agent sets `target` below `es2022` - `#private` and `Error.cause` start downlevelling, and several rules here assume they do not
- Agent enables `verbatimModuleSyntax` on a project that dual-publishes ESM and CJS from one source - fundamentally incompatible
- Agent enables `erasableSyntaxOnly` on an Angular or NestJS codebase without checking - parameter-property DI stops compiling
- Agent disables `skipLibCheck` for rigour - it only checks dependency `.d.ts` files you cannot fix, at real build cost

## Related

- [typescript-versions.md](typescript-versions.md) · [enforcement.md](enforcement.md) · [imports-and-exports.md](imports-and-exports.md) · [enums-and-constants.md](enums-and-constants.md) · [classes.md](classes.md) · [arrays-and-collections.md](arrays-and-collections.md)
