# Style Layer Review Checklist

For a review pass over an existing project's CSS. Each rule links to the reference that explains when
it does not apply. Written for reviewing code that already exists, not for generating new code.

**Establish the setup first.** Preprocessor, method, whether a token layer exists, whether anything
lints, and what the browser floor is. Several rules below apply to only one of the answers.

## The five that cause the most damage

| # | Failure | Why it survives review | Reference |
| - | ------- | ---------------------- | --------- |
| 1 | Any stylesheet left unlayered in a project that uses layers | It looks like a normal file, and unlayered beats **every** layer, so the architecture silently does nothing | [cascade-and-layers.md](cascade-and-layers.md) |
| 2 | A lint config present but the linter not installed, scripted or in CI | Reviewers see the config and conclude the rules are enforced. Measured on one project: 1,244 waiting problems, including two real bugs | [enforcement.md](enforcement.md) |
| 3 | `!important` used to settle a conflict | Each one appears to work. It also **reverses** layer order, so it changes how every other important declaration resolves | [cascade-and-layers.md](cascade-and-layers.md) |
| 4 | A Sass variable in a custom property value without `#{}` | Compiles clean, parses clean, and produces a permanently dead token that poisons every descendant | [preprocessor-or-not.md](preprocessor-or-not.md) |
| 5 | `container-type` on an element sized by its contents | The element collapses to zero width with no error in any engine | [responsive-and-layout.md](responsive-and-layout.md) |

## Cascade and layers

| # | Rule | Reference |
| - | ---- | --------- |
| 6 | A single `@layer` statement declares the whole order, in one entry file loaded first | [cascade-and-layers.md](cascade-and-layers.md) |
| 7 | Every rule in the project is inside a layer, including resets and third-party CSS | [cascade-and-layers.md](cascade-and-layers.md) |
| 8 | Third-party CSS is layered via `@import url(...) layer(name)`, never via a `layer` attribute on `<link>`, which no engine honours | [cascade-and-layers.md](cascade-and-layers.md) |
| 9 | No `@import` appears after a style rule, where it is dropped silently | [cascade-and-layers.md](cascade-and-layers.md) |
| 10 | No anonymous `@layer { }` blocks, which cannot be reopened or reordered | [cascade-and-layers.md](cascade-and-layers.md) |
| 11 | Utilities are the last layer and carry no `!important` | [architecture.md](architecture.md) |
| 12 | Selectors have not been escalated to win a fight that layer order should settle | [cascade-and-layers.md](cascade-and-layers.md) |
| 13 | `:where()` is used for zero-specificity defaults; `:is()` is not mistaken for a specificity reducer | [cascade-and-layers.md](cascade-and-layers.md) |

## Architecture

| # | Rule | Reference |
| - | ---- | --------- |
| 14 | One entry file owns the layer statement and every import; nothing else imports anything | [architecture.md](architecture.md) |
| 15 | Files intended to define only variables, mixins or functions emit zero CSS | [architecture.md](architecture.md) |
| 16 | No component styles another component through a descendant selector | [architecture.md](architecture.md) |
| 17 | Nesting depth is capped at two or three levels and enforced, in plain CSS as well as in a preprocessor | [architecture.md](architecture.md) |
| 18 | Class names describe role, not appearance | [architecture.md](architecture.md) |
| 19 | Layer membership is not also encoded in class-name prefixes, where the two can disagree | [architecture.md](architecture.md) |
| 20 | Global concerns live in layers before `components`; components own only themselves | [architecture.md](architecture.md) |

## Tokens and theming

| # | Rule | Reference |
| - | ---- | --------- |
| 21 | Components read semantic or component tokens, never a raw primitive | [tokens-and-theming.md](tokens-and-theming.md) |
| 22 | Documented token tiers actually exist. An empty primitive tier is worse than an honest flat list | [tokens-and-theming.md](tokens-and-theming.md) |
| 23 | Anything that may vary at runtime is a custom property, not a preprocessor variable. Check spacing specifically | [tokens-and-theming.md](tokens-and-theming.md) |
| 24 | Every `var()` resolves to a token that is actually defined | [enforcement.md](enforcement.md) |
| 25 | No custom property name has three leading dashes | [tokens-and-theming.md](tokens-and-theming.md) |
| 26 | The explicit theme override beats the system preference. Both `:root` and `[data-theme]` score 0,1,0, so verify by specificity, not by hope | [tokens-and-theming.md](tokens-and-theming.md) |
| 27 | `color-scheme` is set alongside every theme, so form controls and scrollbars follow it | [tokens-and-theming.md](tokens-and-theming.md) |
| 28 | `prefers-reduced-motion` is handled once, globally, if anything animates | [tokens-and-theming.md](tokens-and-theming.md) |
| 29 | There is exactly one source of truth for token values | [tokens-and-theming.md](tokens-and-theming.md) |

## Method

| # | Rule | Reference |
| - | ---- | --------- |
| 30 | The project's default method is written down somewhere a contributor will find it | [utility-vs-semantic.md](utility-vs-semantic.md) |
| 31 | A utility framework reads the project's tokens rather than holding its own palette | [utility-vs-semantic.md](utility-vs-semantic.md) |
| 32 | Utilities do not override component classes. Spacing between components on the parent is not a violation | [utility-vs-semantic.md](utility-vs-semantic.md) |
| 33 | Every semantic class recurs, has states, or is themed | [utility-vs-semantic.md](utility-vs-semantic.md) |

## Preprocessor and floor

| # | Rule | Reference |
| - | ---- | --------- |
| 34 | No single file is both a preprocessor file and a utility framework's entry point. Tailwind 4.3.3 accepts a `.scss` file, reports success, and emits the Sass syntax verbatim as invalid CSS | [preprocessor-or-not.md](preprocessor-or-not.md) |
| 35 | The preprocessor is earning its place. Nesting, variables and colour functions alone no longer justify one | [preprocessor-or-not.md](preprocessor-or-not.md) |
| 36 | No `@import` in Sass. It duplicates shared partials and is removed in Dart Sass 3.0.0 | [preprocessor-or-not.md](preprocessor-or-not.md) |
| 37 | `@use` carries a namespace rather than `as *` | [preprocessor-or-not.md](preprocessor-or-not.md) |
| 38 | Correctness does not depend on `@use` ordering in a layered project | [preprocessor-or-not.md](preprocessor-or-not.md) |
| 39 | The browser floor is written down, dated, and derived from analytics | [modern-css-floors.md](modern-css-floors.md) |
| 40 | Newly available features are used only where the unsupported result is acceptable. `@scope` is not an architecture | [modern-css-floors.md](modern-css-floors.md) |
| 41 | No `@supports` guards around features that are widely available | [modern-css-floors.md](modern-css-floors.md) |
| 42 | Colour ramps use `oklch()` or `color-mix()` rather than sRGB `darken()` and `lighten()` | [preprocessor-or-not.md](preprocessor-or-not.md) |

## Responsive

| # | Rule | Reference |
| - | ---- | --------- |
| 43 | Components adapt with container queries; media queries are for page layout and user preferences | [responsive-and-layout.md](responsive-and-layout.md) |
| 44 | A container query targets descendants of the container, never the container itself | [responsive-and-layout.md](responsive-and-layout.md) |
| 45 | Breakpoints are few, set in `rem`, and named for layouts rather than devices | [responsive-and-layout.md](responsive-and-layout.md) |
| 46 | Logical properties are the default | [responsive-and-layout.md](responsive-and-layout.md) |
| 47 | `minmax()` track minimums are wrapped in `min(..., 100%)` so nothing overflows the viewport | [responsive-and-layout.md](responsive-and-layout.md) |
| 48 | `clamp()` bounds are `rem`-based, so text still responds to the user's font size | [responsive-and-layout.md](responsive-and-layout.md) |

## Enforcement

| # | Rule | Reference |
| - | ---- | --------- |
| 49 | The linter is a dependency, wired to a script, and failing CI. Four separate checks | [enforcement.md](enforcement.md) |
| 50 | `no-unknown-custom-properties` is enabled. It is off by default and catches the highest-value class of bug | [enforcement.md](enforcement.md) |
| 51 | `color-no-invalid-hex` is enabled explicitly on a plain-CSS project, where the standard config does not enable it | [enforcement.md](enforcement.md) |
| 52 | Every rule name in the config still exists. A stale name is one hard error per file, not a silent no-op | [enforcement.md](enforcement.md) |
| 53 | `selector-max-specificity` and `max-nesting-depth` are set to what the architecture allows, not to an aspiration | [enforcement.md](enforcement.md) |
| 54 | Unused-CSS reports are treated as candidate lists requiring confirmation, never as delete lists | [enforcement.md](enforcement.md) |

## Version notes

Every rule holds against the state of CSS on **12/08/2026**. Version dependence is narrow:

| Rule | Depends on |
| ---- | ---------- |
| 6 to 13 | Cascade layers, widely available since 2024-09-14. On an older floor the ITCSS source-order approach is the fallback, and rules 6 to 10 do not apply |
| 43, 44, 47 | Container queries, widely available since 2025-08-14 |
| 17 | Applies to plain CSS only since native nesting went widely available on 2026-06-11 |
| 36, 37, 38, 42 | A Sass project. Irrelevant to plain CSS |
| 34 | A utility framework being present. Measured against Tailwind 4.3.3; the v3 configuration model differs |
| 40 | The dated availability table, which moves. Re-check rather than trusting a remembered status |
| 50 to 53 | stylelint 17.14.1 rule names and default configs. Rule sets move between minors |
| 26 | Measured browser behaviour, stable across Chromium 151, Firefox 153 and WebKit 26.5 |

## Gotchas

- Agent reviews without first establishing the preprocessor, method, token layer, enforcement and floor,
  so it applies rules that do not apply
- Agent reviews the CSS and never checks whether the linter is installed, which is rule 2 and the
  highest-yield check on the list
- Agent treats this as a generation guide. It is written for a review pass
- Agent reports every finding at equal weight. The first five are worth more than the rest combined
- Agent flags `mt-4` on a component as a boundary violation when it is the parent laying out children
- Agent checks token definitions and never checks that every `var()` resolves
- Agent verifies the theme override works in one browser at one system setting, missing that the bug
  only appears when the system preference and the explicit choice disagree
- Agent recommends `@scope` or `@property` as a fix without stating that neither is widely available
- Agent counts `!important` occurrences without checking which layer each is in, so the migration order
  is wrong

## Related

- [cascade-and-layers.md](cascade-and-layers.md) · [architecture.md](architecture.md) · [tokens-and-theming.md](tokens-and-theming.md) · [preprocessor-or-not.md](preprocessor-or-not.md) · [utility-vs-semantic.md](utility-vs-semantic.md) · [modern-css-floors.md](modern-css-floors.md) · [responsive-and-layout.md](responsive-and-layout.md) · [enforcement.md](enforcement.md)
