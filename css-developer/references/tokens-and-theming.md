# Design Tokens and Theming

A token is a named value you style against instead of a literal. Every project has them; the question
is whether they were designed or accumulated. This page covers the tiering, the one decision that
determines what can ever be themed, and the several ways a token dies without anything reporting it.

## The three tiers

```css
:root {
  /* Tier 1, primitive: a value with no meaning */
  --blue-600: #378add;
  --grey-900: #131517;

  /* Tier 2, semantic: meaning, no component */
  --color-accent: var(--blue-600);
  --color-bg-page: var(--grey-900);

  /* Tier 3, component: one component's use of a semantic token */
  --button-primary-bg: var(--color-accent);
}
```

**The rule that matters: a component reads tier 2 or tier 3, never tier 1.** Re-theming means
changing tier 1 values or re-pointing tier 2. A component that reads `--blue-600` directly cannot be
re-themed without finding every usage, and you will miss some.

Tier 3 is optional and most projects do not need it. Add it when a component has several themeable
properties that a designer wants to control independently, or when a component library expects to be
configured through custom properties. Do not create tier 3 tokens mechanically for every component;
that produces a thousand indirections that all resolve to the same six values.

The common failure is not skipping a tier, it is **documenting tiers you do not have**. A theme file
with banner comments for three levels, an empty level 1, and raw hex literals sitting in level 2 is
worse than an honest flat list, because every reader believes the indirection exists.

## The decision that determines what can be themed

```scss
$space-md: 1rem;              // preprocessor variable: substituted at build time, gone from output
--color-accent: #378add;      // custom property: present in the browser, overridable at runtime
```

A preprocessor variable becomes a literal in the compiled CSS. Nothing can change it afterwards. A
custom property is live: it inherits, it can be overridden per element, per media query, per theme,
and it can be read and written from script.

**So: anything you may ever want to vary at runtime must be a custom property.** Not "anything that
looks like a colour". The test is runtime variability, and applying it honestly usually moves more
than people expect:

| Value | Usually | Because |
| ----- | ------- | ------- |
| Colours | Custom property | Themes, dark mode, high contrast |
| Spacing scale | **Custom property, more often than people think** | Compact and comfortable density modes, user-scalable spacing |
| Font families | Custom property | Theming, and per-locale overrides |
| Type scale | Custom property | Larger-text preferences |
| Radii, shadows | Custom property | Brand-level theming |
| Breakpoint values | Preprocessor variable | Cannot be used in a media query condition anyway |
| Z-index scale | Either | Rarely varies at runtime |
| Build-time maths and loops | Preprocessor | Not a runtime concern |

The most common regret is putting the spacing scale in preprocessor variables, because it works
perfectly until the first request for a density setting, and by then every component has a compiled
literal.

Breakpoints are the genuine exception: **a custom property cannot be used in a media query
condition**, so breakpoint values stay preprocessor variables or get hardcoded. That is a language
limitation, not a design choice.

## Naming

Name by role, never by appearance. `--color-danger` survives a rebrand; `--color-red` becomes a lie
the day danger turns orange. Same for `--space-md` over `--space-16`.

Keep one flat, predictable prefix and shape: `--color-*`, `--space-*`, `--font-*`, `--radius-*`,
`--shadow-*`, `--z-*`. A prefix per project (`--acme-color-accent`) is worth it only when your CSS
ships into pages you do not control, where collisions are real.

## Theming: system preference plus an explicit choice

Almost every application needs both: follow the operating system by default, and let the user
override it. The two mechanisms are a media query and a selector, and **combining them wrong silently
loses the user's choice.**

Measured on Chromium 151, Firefox 153 and WebKit 26.5, with the system set to dark and the document
carrying `data-theme="light"`:

```css
[data-theme="light"] { --bg: white; }                            /* 0,1,0 */
@media (prefers-color-scheme: dark) { :root { --bg: black; } }    /* 0,1,0 */
```

**The system preference wins and the user's explicit choice is ignored.** A media query adds no
specificity, but `:root` is a pseudo-class, so it scores **0,1,0**, exactly the same as the attribute
selector. The two tie, and source order decides. Whichever block is written last wins, which makes
this bug depend on file ordering and therefore on your bundler.

Two fixes, both measured to work in all three engines:

```css
/* Fix 1: raise the override's specificity. Order no longer matters. Prefer this one. */
:root[data-theme="light"] { --bg: white; }                        /* 0,2,0 */
@media (prefers-color-scheme: dark) { :root { --bg: black; } }    /* 0,1,0 */

/* Fix 2: keep 0,1,0 and rely on order, with the override written last */
@media (prefers-color-scheme: dark) { :root { --bg: black; } }
[data-theme="light"] { --bg: white; }
```

Fix 1 is the one to use, because fix 2 is correct only for as long as nobody reorders the files.

The full pattern, with defaults that hold when no preference is expressed:

```css
:root {
  --color-bg: white;              /* light is the default */
  --color-text: #111;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root { --color-bg: #131517; --color-text: #d0d3d8; color-scheme: dark; }
}

:root[data-theme="light"] { --color-bg: white;   --color-text: #111;    color-scheme: light; }
:root[data-theme="dark"]  { --color-bg: #131517; --color-text: #d0d3d8; color-scheme: dark; }
```

**Set `color-scheme` alongside every theme.** It is what makes form controls, scrollbars, and the
canvas behind your page follow the theme. Without it you get white scrollbars and light-styled
`<select>` elements in a dark theme, and people then chase that with `!important` on individual
controls instead of setting the one property. Widely available since 2024-08-03.

Put theme definitions in the `tokens` layer, not scattered across component files. See
[cascade-and-layers.md](cascade-and-layers.md).

## The ways a token dies silently

Measured on all three engines. Every one of these produces **no error, no warning, and no visible
clue at the point of the mistake**:

| Mistake | What actually happens |
| ------- | --------------------- |
| `---color: red` (three dashes) | A perfectly valid custom property, named `---color`. It is **not** `--color`, so every `var(--color)` falls back or fails, and nothing anywhere reports it |
| `--c: #black` | Also a valid declaration. Any token sequence is legal in a custom property, so this parses cleanly. The failure happens later, at substitution |
| `background: var(--c)` where `--c: #black` | The property becomes **unset**, computing to `rgba(0, 0, 0, 0)` |
| `background: var(--c, green)` where `--c: #black` | **Still `rgba(0, 0, 0, 0)`.** The fallback does **not** rescue it, because a fallback applies only when the property is not set, and here it is set to something invalid |
| A descendant reads the same bad token | **Also broken.** The invalid value inherits, so one bad token poisons every consumer at any depth, and their own fallbacks do not save them either |

That last pair is the important one. The `var()` fallback is widely believed to be a safety net for
bad values. **It is not.** It is a safety net for *missing* values only.

The fix, and the only mechanism that turns this class of bug into a defined outcome:

```css
@property --color-accent {
  syntax: '<color>';
  inherits: true;
  initial-value: #378add;
}
```

Measured: with the property registered, `--color-accent: #black` now computes to the
**`initial-value`** instead of failing silently. Registration gives a token a type, and an invalid
value is rejected at parse time rather than poisoning everything downstream.

The catch is availability. `@property` is **newly available only, since 2024-07-09**, and not yet
widely available, so treat it as a hardening measure on top of a modern floor rather than as the
foundation. Two cheaper mitigations that work everywhere:

- **Lint it.** `custom-property-pattern` catches the triple dash and `color-no-invalid-hex` catches
  `#black`. Both are in the standard stylelint config, both are one-line fixes, and both find these
  bugs in code that has passed human review. See [enforcement.md](enforcement.md).
- **Never write a literal in a component.** If components only ever read tokens, there is exactly one
  file where a bad literal can be introduced.

## User preference queries

These are theming inputs, not accessibility extras, and they belong next to your token definitions:

| Query | Widely available since | Use |
| ----- | ---------------------- | --- |
| `prefers-color-scheme` | Long established | Dark and light themes |
| `prefers-reduced-motion` | 2022-07-15 | **Reduce or remove animation and transitions.** Non-negotiable if you animate anything |
| `forced-colors` | 2025-03-12 | Windows high contrast mode. Your colours are replaced; check that meaning survives |
| `prefers-reduced-transparency` | Not yet | Blur and translucency alternatives |

`prefers-reduced-motion` is the one that gets forgotten, and forgetting it is easy to detect: if a
project has transitions or keyframes and zero occurrences of the query, it does not honour the
preference. Handle it once, globally, in the `base` layer:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This is the one place `!important` is justified, because it must beat author styles it cannot know
about. If your project is fully layered you can instead put this in the last layer and drop the
important declarations.

Contrast ratios and the question of whether a token pair is legible are **not** in scope here. Our
accessibility skill owns the arithmetic and the criteria; this page owns only the mechanism for
getting a value to the right place.

## Where tokens live before they are CSS

Three live answers, and the right one depends on whether a designer is in the loop:

| Approach | When | Cost |
| -------- | ---- | ---- |
| **The stylesheet is the source of truth** | Solo or engineering-led work, no design handoff | No pipeline, no sync problem, and no machine-readable definition for anything else to consume |
| **DTCG JSON**, the Design Tokens Community Group format, `{"color":{"accent":{"$value":"#378add","$type":"color"}}}` | A design tool is the source of truth | A generation step, and a rule about who may edit what |
| **`DESIGN.md`**, a YAML frontmatter format with a linter and exporters, from Google Labs, at 0.4.0 | You want the tokens and the design rationale in one reviewable file | Pre-1.0, so expect movement |

This skill endorses none of the three. It does insist on one thing: **there is exactly one source of
truth.** The failure is not choosing wrong, it is having tokens in a design file, in a stylesheet, and
in a preprocessor variable file, with nothing checking that they agree. Every project that has done
this has discovered a divergence, usually while shipping.

## Version notes

| Feature | Status |
| ------- | ------ |
| Custom properties | Widely available since 2019-10-05. No caveats |
| `color-scheme` | Widely available since 2024-08-03 |
| `prefers-reduced-motion` | Widely available since 2022-07-15 |
| `forced-colors` | Widely available since 2025-03-12 |
| `@property` | **Newly available only, since 2024-07-09.** Use as hardening, not as foundation |
| `light-dark()` | **Newly available only, since 2024-05-13.** Tempting for two-theme token files, and too new for a broad floor |
| `color-mix()` and `oklch()` | Widely available since 2025-11-09. Makes generating tints and shades from one primitive practical, rather than hand-picking ten hex values |
| Relative colour syntax | **Newly available only, since 2024-09-16** |

Availability dates are from the `web-features` dataset, version 3.34.3. Re-check rather than trusting
these numbers a year from now. See [modern-css-floors.md](modern-css-floors.md).

## Gotchas

- Agent writes documentation for three token tiers and leaves the primitive tier empty, so every
  reader believes an indirection exists that does not
- Agent has components read primitive tokens directly, which makes re-theming a search and replace
- Agent puts the spacing scale in preprocessor variables, and it is unthemeable forever after
- Agent tries to use a custom property in a media query condition, which is not possible
- Agent writes the system preference block after the explicit theme override, so both score 0,1,0 and
  the system silently overrides the user's choice
- Agent believes `:root` has zero specificity. It is a pseudo-class at 0,1,0
- Agent omits `color-scheme`, then fixes the resulting light scrollbars and form controls one control
  at a time with `!important`
- Agent believes `var(--x, fallback)` protects against a bad value in `--x`. It only protects against
  `--x` being missing
- Agent writes `---token` with three dashes, producing a valid but permanently unreachable property
- Agent puts an invalid value in one token and breaks every descendant that reads it, with no error
  anywhere
- Agent names tokens after appearance, so `--color-red` outlives the decision to make danger orange
- Agent animates without ever handling `prefers-reduced-motion`
- Agent keeps tokens in a design file, a stylesheet and a variables file, with nothing verifying that
  the three agree
- Agent computes contrast ratios here instead of deferring to the accessibility skill that owns them

## Related

- [cascade-and-layers.md](cascade-and-layers.md) · [architecture.md](architecture.md) · [preprocessor-or-not.md](preprocessor-or-not.md) · [modern-css-floors.md](modern-css-floors.md) · [enforcement.md](enforcement.md)
