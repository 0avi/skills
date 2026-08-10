# Enforcement

A style rule that nothing checks is a suggestion. This maps the skill's rules onto the tool that actually enforces each one, and is honest about which are left to review.

Three tiers, and prefer the highest available for any given rule:

| Tier | Enforces | Cost of a violation |
|---|---|---|
| **Compiler** (`tsc`) | Type correctness, and via flags several style rules | Build fails |
| **Linter** (typescript-eslint) | Everything requiring type information but not a type error | CI fails |
| **Formatter** (Prettier) | Everything purely visual | Auto-fixed |
| **Review** | Judgement - naming quality, when a suppression is justified | Nothing catches it |

Push a rule up a tier wherever you can. `noFallthroughCasesInSwitch` in the compiler beats the equivalent lint rule; a formatter beats both for quoting.

## Prerequisite: typed linting

Most valuable rules here need type information, which means the linter must be given the program:

```js
// eslint.config.js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
);
```

Without `projectService`, every type-aware rule below silently does nothing. A config that looks strict but omits it is the most common way a codebase believes it is linted and is not.

`strictTypeChecked` already carries most of the `any` discipline, promise handling and assertion rules. Start from it rather than assembling rules one at a time.

## Rule map

### Compiler-enforced

| Skill rule | Flag |
|---|---|
| Array access may be undefined | `noUncheckedIndexedAccess` |
| No unmarked `switch` fallthrough | `noFallthroughCasesInSwitch` |
| `override` must be explicit | `noImplicitOverride` |
| Type-only imports marked | `verbatimModuleSyntax` |
| No `enum`, `namespace`, parameter properties | `erasableSyntaxOnly` |
| Optional means absent, not `undefined` | `exactOptionalPropertyTypes` |

### Linter-enforced

| Skill rule | Rule |
|---|---|
| No `any` | `@typescript-eslint/no-explicit-any`, plus the `no-unsafe-*` family for `any` that leaks in from untyped code |
| Every promise handled | `@typescript-eslint/no-floating-promises`, `no-misused-promises` |
| `await` only thenables | `@typescript-eslint/await-thenable`, `require-await` |
| Only throw `Error` | `@typescript-eslint/only-throw-error` |
| No `!` non-null assertions | `@typescript-eslint/no-non-null-assertion` |
| No pointless assertions | `@typescript-eslint/no-unnecessary-type-assertion`, `no-unnecessary-condition` |
| `import type` for type-only imports | `@typescript-eslint/consistent-type-imports` |
| Interfaces for object shapes | `@typescript-eslint/consistent-type-definitions` |
| `T[]` vs `Array<T>` | `@typescript-eslint/array-type` |
| `Record` over index signatures | `@typescript-eslint/consistent-indexed-object-style` |
| No namespaces | `@typescript-eslint/no-namespace` |
| No wrapper types, no bare `{}` | `@typescript-eslint/no-wrapper-object-types`, `no-empty-object-type`, `no-unsafe-function-type` |
| Exhaustive `switch` over a union | `@typescript-eslint/switch-exhaustiveness-check` |
| `readonly` where never reassigned | `@typescript-eslint/prefer-readonly` |
| The naming table | `@typescript-eslint/naming-convention` |
| `const` over `let`, never `var` | core `prefer-const`, `no-var` |
| One declaration per statement | core `one-var` |
| `===` | core `eqeqeq` (`"always", {null: "ignore"}` to permit `== null`) |
| Braces on control statements | core `curly` |
| No `eval`, `with`, `debugger` | core `no-eval`, `no-with`, `no-debugger` |

### No enum rule exists

typescript-eslint has no rule banning enum *declarations* - only rules governing their members. Ban them with syntax matching:

```js
{
  rules: {
    'no-restricted-syntax': [
      'error',
      { selector: 'TSEnumDeclaration', message: 'Use a literal union or an `as const` object. See enums-and-constants.md.' },
    ],
  },
}
```

`erasableSyntaxOnly` also catches this, at the compiler. Use whichever the project can enable; if it can enable both, do.

### Formatter, not linter

Quote style, semicolons, trailing commas, line width, indentation. Configure Prettier once and stop discussing them:

```json
{ "singleQuote": true, "semi": true, "trailingComma": "all", "printWidth": 100 }
```

`singleQuote` and `semi` are Google's rules. Disable any lint rule that overlaps the formatter - two tools with opinions about the same character is a fight nobody wins.

## What only review catches

Be explicit about this rather than implying the toolchain is complete:

- **Whether a name is descriptive.** `naming-convention` checks the casing, never the meaning. `data`, `handleIt`, `Manager` all pass.
- **Whether a suppression is justified.** The linter sees the `@ts-expect-error` comment; only a human judges the reason next to it.
- **Whether an abstraction earns its cost.** Mapped and conditional types, deep generics - [advanced-types.md](advanced-types.md)'s restraint rule is unenforceable.
- **Whether the type models the domain.** A `string` that should be a branded `UserId`, a boolean pair that should be a discriminated union. Type-correct and wrong.
- **Whether the error handling is right.** `only-throw-error` checks you threw an `Error`; it cannot tell you the failure should have been a `Result`.

This is what the `## Gotchas` list in each reference is for - the failure modes that pass every check.

## TypeScript 7.0 breaks this

**typescript-eslint cannot run on TypeScript 7.0.** npm refuses the install with `ERESOLVE`; the programmatic API it needs does not exist until 7.1. Everything in the linter column above goes away.

Three options, in order of preference:

1. **Stay on 6.0** until 7.1. The recommended path - see [typescript-versions.md](typescript-versions.md).
2. **Run 6.0 alongside 7.0**, aliased, with the linter pointed at 6.0 and `tsc` at 7.0.
3. **Adopt 7.0 alone and accept unenforced style.** Only defensible for a codebase with no lint gate today.

If option 3 is chosen, push everything possible down to the compiler tier first - `erasableSyntaxOnly`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes` all still work, and between them they cover more of this skill than people expect.

## Version notes

- **6.0** - everything above works. The recommended baseline for that reason.
- **7.0** - compiler and formatter tiers work; the entire linter tier does not, until 7.1.
- **5.x** - all lint rules work. `erasableSyntaxOnly` needs 5.8+; `exactOptionalPropertyTypes` and `verbatimModuleSyntax` need 5.0+. typescript-eslint v8 renamed `no-throw-literal` to `only-throw-error` and split `ban-types` into `no-empty-object-type`, `no-unsafe-function-type` and `no-wrapper-object-types` - on v7 or earlier the old names apply.

## Gotchas

- Agent writes an ESLint config without `projectService` - every type-aware rule silently does nothing while appearing configured
- Agent assembles rules individually instead of extending `strictTypeChecked` - misses most of the `any` and promise coverage
- Agent looks for a typescript-eslint rule that bans enums - none exists; use `no-restricted-syntax` on `TSEnumDeclaration`, or `erasableSyntaxOnly`
- Agent enforces quoting or semicolons with lint rules - that is the formatter's job, and the two will fight
- Agent uses `no-throw-literal` or `ban-types` on typescript-eslint v8 - both were renamed or split
- Agent puts a rule in the linter that the compiler could enforce - a build failure beats a CI failure
- Agent proposes TypeScript 7.0 for a linted codebase - the linter cannot install
- Agent presents the rule map as complete coverage - naming quality, suppression justification and domain modelling have no automated check

## Related

- [tsconfig.md](tsconfig.md) · [typescript-versions.md](typescript-versions.md) · [naming.md](naming.md) · [any-and-unknown.md](any-and-unknown.md) · [checklist.md](checklist.md)
