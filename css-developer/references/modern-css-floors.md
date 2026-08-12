# Support Floors: What Is Safe To Use

Guidance about browser support goes stale faster than any other kind, and it goes stale in **both**
directions: features you were told to avoid are now safe, and features you assume are safe are not.
This page is a dated snapshot plus a method, and the method matters more than the snapshot.

## What Baseline actually means

Two states, and conflating them is the most common mistake:

- **Newly available**: the feature works in the current version of every core browser. It says nothing
  about the versions people are still running.
- **Widely available**: **30 months** after newly available. Verified arithmetic against the dataset:
  cascade layers went newly available 2022-03-14 and widely available 2024-09-14, exactly 30 months
  later; native nesting 2023-12-11 and 2026-06-11.

So "newly available" means *shipped everywhere*, and "widely available" means *shipped everywhere long
enough that old versions have drained*. **Default to widely available.** Reach into newly available
deliberately, with a fallback, and never for something structural.

## The table, computed

Generated from the `web-features` dataset, version **3.34.3**, on **12/08/2026**. Dates are when the
feature reached that state.

**Widely available. Use without ceremony.**

| Feature | Since |
| ------- | ----- |
| Custom properties | 2019-10-05 |
| `prefers-reduced-motion` | 2022-07-15 |
| `:is()`, `:where()` | 2023-07-21 |
| Logical properties | 2024-03-20 |
| `color-scheme` | 2024-08-03 |
| **Cascade layers** | **2024-09-14** |
| `contain`, `<dialog>`, `:focus-visible` | 2024-09-14 |
| `forced-colors` | 2025-03-12 |
| **Container queries** | **2025-08-14** |
| `color-mix()`, `oklch()`, `oklab()`, `lab()` | 2025-11-09 |
| Subgrid | 2026-03-15 |
| **Native nesting** | **2026-06-11** |
| **`:has()`** | **2026-06-19** |

**Newly available only. Deliberate use with a fallback.**

| Feature | Since |
| ------- | ----- |
| `light-dark()`, `text-wrap: balance` | 2024-05-13 |
| `@property` | 2024-07-09 |
| `@starting-style` | 2024-08-06 |
| Relative colour syntax | 2024-09-16 |
| Popover | 2025-01-27 |
| `content-visibility` | 2025-09-15 |
| View transitions | 2025-10-14 |
| **`@scope`** | **2025-12-12** |
| Container style queries | 2026-05-19 |
| `field-sizing` | 2026-06-16 |

**Limited availability. Progressive enhancement only.**

Anchor positioning · `if()` · `text-box` · `accent-color`, which is limited because Safari support
arrives only in 26.2, and which almost everyone assumes is long safe.

## What the snapshot changes

Three things worth acting on, because they invert widely-repeated advice:

**Native nesting and `:has()` became widely available in June 2026**, two months before this was
written. Guidance from 2024 or 2025 treats both as risky. It is no longer correct. If a project avoids
nesting in plain CSS or avoids `:has()` on support grounds, that reason has expired.

**`@scope` is not widely available and will not be until mid-2028** on the 30-month rule. It is
tempting, it comes from the same spec author as cascade layers, and it is the natural answer to style
leakage. **Do not build an architecture on it yet.** Layers are the widely available mechanism. See
[cascade-and-layers.md](cascade-and-layers.md).

**`@property` is newly available only.** It is the one mechanism that turns a silently dead custom
property into a defined fallback, which makes it genuinely valuable, and it cannot be your only
defence. Pair it with linting. See [tokens-and-theming.md](tokens-and-theming.md).

## Choosing a floor for a real project

The floor is a product decision, not a taste decision, and it comes from data:

1. **Look at your analytics.** Actual browser and version distribution for your actual users. A UK
   public-sector service, an internal tool on managed devices, and a consumer app have three different
   answers, and only one of them can be guessed at.
2. **Write the floor down** where engineers will see it, with a date and a review interval. An
   undocumented floor is re-derived from feelings in every code review.
3. **Encode it if you can.** A `browserslist` or equivalent turns the decision into build behaviour
   rather than a convention.
4. **Re-check quarterly.** These dates move, and the whole point of a dated snapshot is that it has an
   expiry.

Then measure candidate features against the floor rather than against Baseline in the abstract. If your
floor is newer than Baseline widely available, more is open to you than this page suggests.

## `@supports`, used properly

`@supports` tests **declarations**, and there are two other forms people forget:

```css
@supports (container-type: inline-size) { /* property and value */ }
@supports selector(:has(a))              { /* a selector */ }
@supports at-rule(@scope)                { /* an at-rule, where implemented */ }
```

Three rules for using it well:

- **Enhance, do not gate.** Write the version that works everywhere, then improve it inside
  `@supports`. The inverse, a fallback inside `@supports not (...)`, is harder to read and duplicates
  the maintenance.
- **Do not test a widely available feature.** `@supports (display: grid)` in 2026 is noise that implies
  a doubt that does not exist. It also survives forever, because nobody dares delete it.
- **Not everything is detectable.** Rendering quality, layout algorithm bugs, and whether a property is
  *honoured* rather than merely *parsed* are all invisible to `@supports`.

The honest test for reaching into newly available territory: **if the feature simply did not work, is
the result acceptable?** A view transition that does not animate is fine. A layout that depends on
anchor positioning and gets none is not.

## Downlevelling

**Lightning CSS** 1.33.0 and **PostCSS** 8.5.26 can compile some modern syntax down to an older floor,
which changes the calculus for a few features: nesting and some colour syntax can be authored modern
and shipped old. Two limits:

- **Only syntax downlevels, never behaviour.** Nesting can be flattened. Container queries cannot be
  emulated, and neither can layers, because both are runtime cascade behaviour rather than syntax.
- Every transform adds output size and a build dependency. Check whether your floor still needs it;
  many projects carry downlevelling for features that went widely available years ago.

## Version notes

Support data from the **`web-features`** dataset, version **3.34.3**. That package is the same data
source behind Baseline reporting, so it is checkable rather than anecdotal:

```bash
npm i web-features
node -e "const {features}=require('web-features'); console.log(features['cascade-layers'].status)"
```

| Concern | Detail |
| ------- | ------ |
| This table's shelf life | Months, not years. Two entries changed state within the eight weeks before it was written |
| The 30-month rule | Verified arithmetic in the dataset, not a claim from documentation |
| `caniuse` versus Baseline | Both are fine; Baseline gives one answer where `caniuse` gives a matrix. Use Baseline for a policy and `caniuse` for a specific browser question |
| Per-feature partial support | A feature can be widely available while a sub-feature is not. `accent-color` is the cautionary case, where the property is limited on Safari version grounds alone |

## Gotchas

- Agent states support from memory. Two features on this page changed state within eight weeks of it
  being written
- Agent treats "newly available" as safe, when it only means the current version of each browser
- Agent avoids `:has()` and native nesting on support grounds. Both went widely available in June 2026
- Agent builds an architecture on `@scope`, which is newly available only, when `@layer` is the widely
  available answer
- Agent assumes `accent-color` is long safe. It is limited availability
- Agent wraps widely available features in `@supports`, leaving noise nobody will ever remove
- Agent writes the fallback inside `@supports not (...)`, inverting the enhancement so the simple path
  is the special case
- Agent assumes a build tool can downlevel container queries or layers. Only syntax downlevels;
  cascade behaviour does not
- Agent picks a floor from a feeling rather than from analytics, and never writes it down
- Agent uses `@supports` to detect something undetectable, such as whether a property is honoured
  rather than parsed

## Related

- [cascade-and-layers.md](cascade-and-layers.md) · [tokens-and-theming.md](tokens-and-theming.md) · [responsive-and-layout.md](responsive-and-layout.md) · [preprocessor-or-not.md](preprocessor-or-not.md)
