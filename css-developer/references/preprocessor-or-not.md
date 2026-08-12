# CSS, SCSS or Sass: Which To Pick

The answer changed. Most of what people used a preprocessor for is now in the language, so a
recommendation written in 2020 is now wrong. This page explains what the three options actually
are, gives a straight recommendation, and covers the most common case, which is a utility
framework such as Tailwind. Everything is measured against **Dart Sass 1.102.0** and **Tailwind
4.3.3**.

## The three things, and what they actually are

The names are confusing because they describe two different levels.

- **CSS** is the language browsers run. No build step.
- **Sass** is a **language** that compiles to CSS. It has **two syntaxes**.
- **SCSS** is one of those two syntaxes, in `.scss` files. It is a strict superset of CSS: any
  valid CSS file is a valid SCSS file.
- **The indented syntax**, in `.sass` files, is the other one. Same language, same compiler, same
  features. No braces, no semicolons, indentation is the structure.

So "SCSS versus Sass" is not a feature comparison. **It is the same compiler with two spellings.**
Anything one can do, the other can do. Choosing between them is purely a syntax preference, with
one practical asymmetry covered below.

The same component, three ways:

**CSS.** Native nesting, custom properties, no build step:

```css
.card {
  padding: 1rem;
  background: var(--color-surface);

  .title { font-weight: 700; }
  &:hover { background: var(--color-surface-hover); }
}
```

**SCSS**, in `.scss`. Note it is the CSS above plus a compile-time variable:

```scss
$pad: 1rem;

.card {
  padding: $pad;
  background: var(--color-surface);

  .title { font-weight: 700; }
  &:hover { background: var(--color-surface-hover); }
}
```

**Indented syntax**, in `.sass`. Identical meaning, different spelling:

```sass
$pad: 1rem

.card
  padding: $pad
  background: var(--color-surface)

  .title
    font-weight: 700

  &:hover
    background: var(--color-surface-hover)
```

Two notes on the CSS example, both measured on Chromium 151, Firefox 153 and WebKit 26.5:

- Native nesting accepts a **bare** nested selector. `.title { }`, `& .title { }` and even a bare
  type selector such as `span { }` all work in all three engines. The early restriction requiring
  `&` before an element selector is gone.
- `&:hover` needs the `&` because it is attaching to the parent rather than descending from it.
  That is true in CSS and in Sass alike.

## The recommendation

**Start new projects in plain CSS. Add SCSS only when you need to generate rules from data. Do
not start a new project in the indented syntax.**

That is a real reversal, and the reasoning is specific rather than fashionable:

- **Nesting, variables and colour manipulation are the three things almost everyone installed Sass
  for, and all three are now native.** Native nesting became widely available on 2026-06-11.
- **Custom properties are strictly better than Sass variables**, not merely equivalent, because
  they exist at runtime. A Sass variable cannot be themed, inspected in devtools, or overridden per
  component. See [tokens-and-theming.md](tokens-and-theming.md).
- **`oklch()` and `color-mix()` are strictly better than `darken()` and `lighten()`**, which work
  in sRGB and produce perceptually uneven ramps. That is why hand-picked palettes exist.
- SCSS remains genuinely useful for one thing, **build-time generation**, and that is a real need
  in design systems and utility layers. It is not a general need.
- The indented syntax loses on tooling, not on merit. Linting `.sass` needs a custom syntax whose
  package was **last published in June 2022**. If enforcement matters, that is a concrete cost with
  no compensating benefit, since the language is identical. See [enforcement.md](enforcement.md).

**A project already on SCSS should stay on SCSS.** Migrating off is not worth doing for its own
sake. Migrate `@import` to `@use`, which is worth doing, and leave the rest alone.

## Which to pick when

| Situation | Pick | Why |
| --------- | ---- | --- |
| **Using Tailwind or another utility framework** | **Plain CSS** | The two toolchains do not compose. See the next section, which is measured |
| New application, no design system to publish | **Plain CSS** | Nothing on the Sass side is load-bearing any more |
| Generating many rules from a token map, for example a utility or spacing scale | **SCSS** | `@each` over a map has no native equivalent. This is the strongest remaining reason |
| Publishing a component library others consume | **SCSS**, or ship compiled CSS | Consumers cannot be required to adopt your build. Mixins and configurable maps are a real API |
| Existing SCSS codebase | **Stay on SCSS** | Migrate `@import` to `@use` and stop there |
| Existing `.sass` codebase | **Stay**, unless linting matters | Converting syntax is mechanical but gains nothing except tooling |
| You prefer indentation and are working alone | Indented syntax, knowingly | Accept the linting gap. The language is identical |
| Team has no strong view and no generation need | **Plain CSS** | Fewer moving parts, no build step for styles at all |

Note what is **not** on this list: theming, dark mode, design tokens, and layering. None of those
are preprocessor decisions. They are all CSS-level, and the answers in
[tokens-and-theming.md](tokens-and-theming.md) and [cascade-and-layers.md](cascade-and-layers.md)
are the same whichever option you pick.

## If you use Tailwind or another utility framework

This is the most common case, and it has a clear answer: **use plain CSS.** Not as a preference.
The two toolchains genuinely do not compose, and both failure modes are bad. Measured against
Tailwind **4.3.3** and Dart Sass **1.102.0**.

**Failure one: Sass cannot process a Tailwind entry file.** Tailwind 4 is configured in CSS, so
its entry point begins with `@import "tailwindcss"`. Put that in a `.scss` file and Sass tries to
resolve it as a Sass module on disk:

```
Error: Can't find stylesheet to import.
  ╷
1 │ @import "tailwindcss";
```

A hard error. That one is at least loud.

**Failure two, the dangerous one: Tailwind will accept a `.scss` file and silently emit broken
CSS.** Given a `.scss` input containing `$brand: #378add;` and `color: $brand;`, Tailwind 4.3.3
reported success:

```
≈ tailwindcss v4.3.3
Done in 117ms
```

Exit code 0, no error, no warning. The output file contained, verbatim:

```css
$brand: #378add;
.btn {
  color: $brand;
  ...
```

`$brand: #378add;` is not valid CSS and `color: $brand` is not a valid declaration, so the browser
discards both and the button has no colour. **Nothing in the chain reports it.** Tailwind does not
compile Sass; it passed the text straight through.

**Why this happens rather than being a bug to wait out.** Tailwind 4 moved its configuration into
CSS itself, using `@theme` to define tokens:

```css
@import "tailwindcss";

@theme {
  --color-brand: oklch(60% 0.15 250);
}
```

Verified: that generates `--color-brand` plus the `text-brand` and `bg-brand` utilities. The design
tokens are **already** custom properties, defined in CSS, at runtime. A preprocessor sitting above
that adds a compile-time layer between you and the mechanism the tool is built on, in exchange for
features the tool has replaced.

### If you have an existing SCSS codebase and are adopting Tailwind

You do not have to convert everything first. Keep them in **separate files** and join them with a
layered import. Verified end to end:

```scss
// legacy.scss - plain Sass, no Tailwind anything in this file
$radius: 0.5rem;
.legacy-card { border-radius: $radius; .title { font-weight: 700; } }
```

Compile it to CSS as its own step, then in the Tailwind entry, which stays **plain CSS**:

```css
@layer legacy, theme, base, components, utilities;

@import "./legacy.css" layer(legacy);
@import "tailwindcss";

@theme { --color-brand: oklch(60% 0.15 250); }
```

Measured output: Tailwind inlined the Sass-compiled rules correctly wrapped in `@layer legacy`, and
still generated its utilities. Because `legacy` is the first layer, **every Tailwind utility beats
the legacy CSS without `!important`**, which is exactly what you want during a migration. See
[cascade-and-layers.md](cascade-and-layers.md).

The rule to hold onto: **one file is never both.** A file is Sass or it is a Tailwind entry, never
both, and the join is `@import ... layer()`.

## What CSS took back

Every row was a standard reason to reach for a preprocessor, and every one is now native:

| You used Sass for | Native CSS now | Widely available since |
| ----------------- | -------------- | ---------------------- |
| Variables | Custom properties, which work at runtime, as Sass variables never can | 2019-10-05 |
| Nesting | Native nesting | **2026-06-11** |
| Colour manipulation, `darken()` and `lighten()` | `color-mix()`, `oklch()`, `oklab()` | 2025-11-09 |
| Grouping selectors to keep specificity down | `:is()` and `:where()` | 2023-07-21 |
| Faking layer order with source order | `@layer` | 2024-09-14 |
| Component-relative breakpoints | `@container` | 2025-08-14 |
| Maths | `calc()` and friends | Long established |

## What Sass still uniquely gives

Four things, and they are real:

1. **Build-time generation.** Looping over a map to emit many rules has no native equivalent:

   ```scss
   $spaces: (xs: 0.25rem, sm: 0.5rem, md: 1rem, lg: 1.5rem);
   @each $name, $value in $spaces {
     .p-#{$name} { padding: $value; }
   }
   ```

   This is how a utility layer gets generated from a token map without hand-writing it, and it is
   the single strongest remaining argument for a preprocessor. Note that if you are using a utility
   framework, it already does this for you, which is part of why the two overlap so badly.

2. **Mixins that take content blocks.** `@mixin` with `@content` lets you name a pattern and pass a
   body into it. Native CSS has no equivalent.

3. **Values in media query conditions.** A custom property **cannot** be used in a media query
   condition. A Sass variable can, so breakpoint values remain a legitimate preprocessor use.

4. **A real module system with privacy.** `@use`, `@forward`, and members prefixed `_` or `-` being
   private to their module. Compile-time errors for a typo'd variable, where a typo'd custom
   property fails silently at runtime.

## `@use` and `@forward`, and why `@import` must go

**Dart Sass `@import` is deprecated as of 1.80.0 and is removed in Dart Sass 3.0.0.** Version
1.102.0 warns on every use by default:

```
DEPRECATION WARNING [import]: Sass @import rules are deprecated and will be removed in Dart Sass 3.0.0.
```

The practical difference, measured. Two partials each loading a shared partial:

| Loading with | `.shared` blocks in the compiled output |
| ------------ | -------------------------------------- |
| `@import` | **2** |
| `@use` | **1** |

`@import` re-evaluates the file every time it is seen, so shared code is duplicated once per
importer. On a real codebase this is how stylesheets silently double in size, and because the
duplicates are identical, nothing looks wrong. `@use` loads a module once no matter how many files
use it.

`@use` also namespaces, which is the part that takes adjusting:

```scss
@use 'tokens';              // members available as tokens.$primary
@use 'tokens' as t;         // as t.$primary
@use 'tokens' as *;         // unnamespaced, and now you are back to collision risk
```

Prefer a namespace. `as *` recreates the exact problem `@use` was built to solve.

`@forward` is how a folder presents one entry point:

```scss
// _abstracts.scss - the only thing consumers @use
@forward 'abstracts/variables';
@forward 'abstracts/mixins';
```

There is an official migrator, `sass-migrator module`, which handles most of the mechanical work.
Migrate before 3.0.0 rather than after, since the removal is not a warning at that point.

## The interpolation trap

This is the highest-value item on the page, because it produces a **silently dead token** and the
compiler says nothing. Measured with Sass 1.102.0:

```scss
$primary: #378add;

:root {
  --colour-raw: $primary;               // WRONG
  --colour-interpolated: #{$primary};   // correct
}
```

compiles to:

```css
:root {
  --colour-raw: $primary;               /* the literal text, not the value */
  --colour-interpolated: #378add;
}
```

**Sass does not evaluate its own variables inside a custom property value**, because a custom
property may legally contain any token sequence, so Sass passes the text through untouched. The
output is a *valid* custom property whose value is the nonsense string `$primary`, so:

- Sass compiles clean. No error, no warning.
- The CSS parses clean. Custom properties accept arbitrary tokens.
- Every `var(--colour-raw)` then computes to nothing, and its `var()` fallback does **not** rescue
  it.
- The failure inherits to every descendant.

That is four layers of tooling all declining to report it. **Any Sass variable used in a custom
property value must be interpolated with `#{}`.** See
[tokens-and-theming.md](tokens-and-theming.md) for the rest of this failure family, and enable
`no-unknown-custom-properties` in stylelint, which catches the consuming side.

## Sass load order is not cascade order

Two different orderings, routinely confused:

- **Sass load order** determines the order rules appear in the compiled output, which decides
  source-order tie-breaks.
- **Cascade layer order** determines precedence, and it beats specificity outright.

`@layer` is plain CSS and passes through Sass untouched. Once your rules are in layers,
**reordering your `@use` statements no longer changes which rule wins**, which is exactly the
fragility layers exist to remove. A project that still depends on `@use` order for correctness has
not finished adopting layers.

One corollary: `@import url(...) layer(vendor)` in a `.scss` file is a **CSS** `@import`, not a
Sass one, and Sass leaves it alone provided it has a URL or `url()` form. That is how vendor CSS
gets layered from within a Sass entry file, and it is the same mechanism as the Tailwind migration
recipe above.

## A note on resolved selectors

When a linter or a tool reports the "resolved" form of a nested selector, that is the tool's own
resolution and **may not match what Sass emits**. Measured: for

```scss
.parent { .child { &:last-child { color: blue; } } }
```

Sass 1.102.0 emits `.parent .child:last-child`, with no `:is()` wrapper, while stylelint reports
the same rule with an `:is()` wrapper in its message. Both describe the same rule; only the
compiled output determines specificity. If specificity matters to a decision, **read the compiled
CSS**, not a tool's paraphrase of the source.

## Version notes

**Measured against Dart Sass 1.102.0 and Tailwind 4.3.3, on 12/08/2026.**

| Concern | Detail |
| ------- | ------ |
| `@import` in Sass | Deprecated in 1.80.0, **removed in 3.0.0**. Warns by default in 1.102.0 |
| Native nesting | Widely available **2026-06-11**. This is what makes plain CSS a realistic default, and it is recent |
| Tailwind 4 versus Tailwind 3 | Tailwind 3 used a JavaScript config and `@tailwind` directives. Tailwind 4 uses `@import "tailwindcss"` and `@theme` in CSS. Advice about combining Tailwind with Sass written for v3 does not describe v4 |
| Global built-in Sass functions | Being replaced by the `sass:math`, `sass:color` and `sass:map` modules. Prefer `@use 'sass:math'` over bare `percentage()` |
| `darken()` and `lighten()` | Legacy sRGB behaviour. Prefer `color-mix()` or `oklch()` |
| `node-sass` | Long dead. If a project still uses it, that is the first migration, before anything else here |
| `postcss-sass`, for linting indented `.sass` | Last published June 2022 |

## Gotchas

- Agent treats "SCSS versus Sass" as a feature comparison. They are two syntaxes for one language
  with identical capabilities
- Agent recommends Sass for variables, nesting or dark mode, all of which are native and, in the
  case of variables, better native
- Agent puts `@import "tailwindcss"` in a `.scss` file, which is a hard Sass error
- Agent feeds a `.scss` file to Tailwind, which reports success and emits the Sass syntax verbatim
  as invalid CSS, with no warning anywhere
- Agent writes `--token: $sass-var` without interpolation, producing a valid, silent, permanently
  dead custom property
- Agent keeps `@import` because it works, and ships a stylesheet containing several copies of every
  shared partial
- Agent uses `@use 'x' as *` everywhere, discarding the namespacing that was the point of `@use`
- Agent tries to use a custom property in a media query condition
- Agent uses `darken()` and `lighten()` for a colour ramp and gets a perceptually uneven palette
- Agent migrates a working SCSS codebase to plain CSS for its own sake. Staying is the right call;
  only the `@import` to `@use` move is worth doing
- Agent recommends the indented syntax without mentioning that its lint tooling has not been
  published since 2022
- Agent applies Tailwind v3 advice about Sass to a v4 project, where the configuration model is
  entirely different
- Agent assumes reordering `@use` statements changes which rule wins, in a layered project, where
  it does not
- Agent reasons about specificity from a linter's resolved selector rather than the compiled CSS

## Related

- [architecture.md](architecture.md) · [tokens-and-theming.md](tokens-and-theming.md) · [cascade-and-layers.md](cascade-and-layers.md) · [utility-vs-semantic.md](utility-vs-semantic.md) · [enforcement.md](enforcement.md) · [modern-css-floors.md](modern-css-floors.md)
