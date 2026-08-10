# Imports and Exports

## The four import forms

| Form | Syntax | Use |
|---|---|---|
| Named | `import {thing} from './x.js';` | The default for your own code |
| Namespace | `import * as x from './x.js';` | When pulling many symbols from one large API |
| Default | `import thing from 'pkg';` | **Only** for third-party code that offers nothing else |
| Side-effect | `import './polyfill.js';` | Only for modules whose entire purpose is the side effect |

### Named versus namespace

Named imports by default. Switch to a namespace import when the alternative is a long list of renames:

```typescript
// Renaming every symbol to disambiguate - use a namespace instead
import {Item as TableviewItem, Header as TableviewHeader, Row as TableviewRow} from './tableview.js';

// Better
import * as tableview from './tableview.js';
let item: tableview.Item | undefined;
```

But keep named imports for symbols whose names already read clearly, especially common test and utility functions - `testing.describe(...)` is worse than `describe(...)`, not better.

### Renaming

Rename to resolve a genuine collision, to give a generated or cryptic name meaning, or to disambiguate - `import {from as observableFrom}`. Not to shorten something that was already clear.

## Exports

### Named exports only

```typescript
export class OrderService { … }        // yes
export default class OrderService { }  // no
```

A default export has no canonical name, so `import Foo from './bar.js'` and `import Baz from './bar.js'` are both legal and both compile. Rename the class and no import updates. Every consumer invents its own name for the same thing, and no search finds them all.

The exception is a third-party package that only offers a default. Import it, and re-export it by name if it is used widely.

### Export only what is used elsewhere

Everything exported is API you have to keep working. A helper used once in the same file is not exported. This is also what makes a file safe to change: the compiler can prove a non-exported symbol has no other callers.

### `export let` is banned

```typescript
export let currentUser = null;   // no
```

Consumers see a value that changes underneath them, with no way to observe the change, and the behaviour differs across re-export chains. Export a function instead:

```typescript
let currentUser: User | null = null;
export function getCurrentUser(): User | null {
  return currentUser;
}
```

Where the exported value depends on a condition, resolve it first and export the result:

```typescript
function pickApi() {
  return useOtherApi() ? OtherApi : RegularApi;
}
export const SomeApi = pickApi();
```

### No container classes

```typescript
// A class used purely as a namespace
export class Constants {
  static readonly MAX_RETRIES = 3;
  static parse(s: string) { … }
}

// Just export them
export const MAX_RETRIES = 3;
export function parse(s: string) { … }
```

The module *is* the namespace. A static-only class adds a layer that cannot be tree-shaken and cannot be imported piecemeal.

## `import type` and `export type`

With `verbatimModuleSyntax` on ([tsconfig.md](tsconfig.md)), what you write is what is emitted - so the `type` modifier is load-bearing, not decorative.

```typescript
import type {Order} from './order.js';        // erased entirely
import {createOrder} from './order.js';       // emitted

import {type Order, createOrder} from './order.js';   // also fine
```

Use `import type` when the symbol is only ever used in type position. Getting this wrong in either direction has consequences: mark a value as `type` and it vanishes at runtime; leave a type unmarked and you have created a real module dependency, which can pull a whole subtree into a bundle or introduce a cycle.

Re-exporting a type needs `export type`, or per-file transpilers cannot tell whether to emit the re-export:

```typescript
export type {Submission} from './submission.js';
```

`@typescript-eslint/consistent-type-imports` will fix these automatically.

## Modules, not namespaces

```typescript
namespace Rocket { … }        // banned
/// <reference path="..."/>   // banned
import x = require('mydep');  // banned
```

ES modules are the module system. A `namespace` emits a runtime object, so it is not erasable, and it duplicates what a file already gives you. See [disallowed-features.md](disallowed-features.md).

## Import paths

**Relative for your own code**, so the tree can be moved:

```typescript
import {parse} from './submission-parser.js';
import {log} from '../logging/logger.js';
```

`baseUrl` was deprecated in 6.0 and removed in 7.0 - do not add it. Where deep relative paths become unreadable, use `paths` resolved relative to the tsconfig, or a workspace package boundary, which is usually the better answer since it makes the dependency explicit.

### The `.js` extension

Under `moduleResolution: "nodenext"`, relative imports need an explicit extension, and it is **`.js`, in a `.ts` file**:

```typescript
import {parse} from './parser.js';   // correct - even though the file is parser.ts
```

This looks wrong and is not. The specifier describes the *emitted* module graph, which TypeScript does not rewrite. Under `moduleResolution: "bundler"`, extensions are optional because the bundler resolves them - so this rule is set by your resolution mode, not by preference.

### Package `exports`

For a published package, declare the entry points:

```jsonc
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./testing": { "types": "./dist/testing.d.ts", "default": "./dist/testing.js" }
  }
}
```

An `exports` map closes off deep imports into internals, which is what makes them safe to change. Consumers reaching into `pkg/dist/...` are depending on your build layout.

## Barrel files

A barrel - `index.ts` re-exporting a directory - costs more than it looks. Importing one symbol loads the module graph of everything the barrel touches, which slows builds, defeats tree-shaking in some bundlers, and is a reliable source of circular imports.

Use one at a genuine package boundary, where it *is* the public API. Do not use one per directory for convenience.

## Version notes

- **7.0** - `baseUrl` removed; `esModuleInterop` and `allowSyntheticDefaultImports` cannot be disabled.
- **6.0** - `moduleResolution: node` and `classic` removed; use `nodenext` or `bundler`. `baseUrl` deprecated. `module` defaults to `esnext`, and `noUncheckedSideEffectImports: true` makes a side-effect import of a missing module an error.
- **5.x** - `verbatimModuleSyntax` from 5.0; before it, `importsNotUsedAsValues` and `isolatedModules` covered part of the same ground less precisely.

## Gotchas

- Agent writes a default export - named exports only; a default export has no canonical name
- Agent uses `export let` - export a getter function
- Agent creates a static-only class to group constants - the module is already the namespace
- Agent exports a helper used only in its own file - every export is API you must keep working
- Agent omits `.js` on a relative import under `nodenext` - the extension describes the emitted graph and is required
- Agent adds `.ts` instead of `.js` - the specifier names the output file
- Agent strips `import type` because "it compiles either way" - with `verbatimModuleSyntax` it does not, and an unmarked type import creates a real runtime dependency
- Agent marks a value `import type` - it disappears at runtime
- Agent re-exports a type without `export type` - per-file transpilers cannot resolve it
- Agent adds `baseUrl` to tidy up import paths - deprecated in 6.0, removed in 7.0
- Agent creates a barrel `index.ts` per directory - build cost, broken tree-shaking, and cycles
- Agent uses a namespace import for two symbols - named imports read better
- Agent uses named imports with five renames to disambiguate - that is the case for a namespace import

## Related

- [file-structure.md](file-structure.md) · [tsconfig.md](tsconfig.md) · [disallowed-features.md](disallowed-features.md) · [naming.md](naming.md) · [typescript-versions.md](typescript-versions.md)
