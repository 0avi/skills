# The Cascade and Cascade Layers

Almost every "CSS is unpredictable" complaint is a cascade question answered by guessing. The cascade
is fully deterministic and interoperable. This page states the rules, and every rule below was
measured rather than recalled.

## How a winner is chosen

When two declarations set the same property on the same element, they are compared in this order and
the first difference decides it:

1. **Origin and importance.** Author `!important` beats author normal. User and user-agent origins
   sit outside this and behave in the opposite direction for `!important`.
2. **Cascade layer order.** For normal declarations, later layer wins, and **unlayered wins over
   everything layered**. For `!important` declarations the whole order **reverses**.
3. **Specificity.** Only now. `id, class, type` counted as three numbers.
4. **Source order.** Last one wins.

The step that surprises people is that **layer order is checked before specificity**. That is the
entire reason layers solve the problem that `!important` was being used for.

## The measured rules

Run against **Chromium 151.0.7922.34, Firefox 153.0 and WebKit 26.5**. Every case produced identical
computed values in all three engines, with **zero disagreement**.

| Behaviour | Measured result |
| --------- | --------------- |
| Layer order source | Comes from the `@layer` statement, **not** from where the blocks appear. `@layer a, b;` followed by a `b` block and then an `a` block resolves to `b` winning |
| Unlayered normal versus layered | **Unlayered wins**, even when written first in the file. Unlayered is effectively the last and highest layer |
| Layer order versus specificity | A selector at **0,1,0 in a later layer beats 1,3,0 in an earlier layer** |
| `!important` across layers | **Reverses** layer order. The **first** declared layer's important declaration wins |
| Layered versus unlayered `!important` | **Layered wins.** Unlayered important is the weakest important |
| Nested layers | Order within their parent, addressable as `parent.child` |
| `revert-layer` | Rolls the property back to the value from the previous layer |
| Anonymous `@layer { }` blocks | Each one is a separate, later layer, and can never be added to again |
| Adding to an existing named layer | Keeps the layer's **original** position, no matter how late the new block appears |
| `style` attribute versus a normal layered declaration | The attribute wins |
| `style` attribute versus a layered `!important` | **The layered important wins** |
| `:where()` | Contributes zero specificity, so `:where(#a#a#a)` loses to `#a` |
| `@import url(x) layer(vendor)` | Works. Puts a stylesheet you cannot edit into a layer you control |
| A `layer` attribute on `<link>` | **Honoured by no engine.** The stylesheet stays unlayered and therefore beats every layer |
| `@import` following any style rule | **Dropped silently** |
| `@import` following a `@layer` statement | Still honoured. So declaring layer order first is safe |

## Using layers as the architecture

Declare the entire order once, in the first file the browser loads, before anything else:

```css
@layer reset, tokens, base, layout, components, utilities;
```

That single line is the architecture. It fixes precedence for the whole project before a single
selector exists, and files can then be loaded in any order without changing the outcome. Six names
is usually enough; the exact set belongs to your project, and the mapping onto files is in
[architecture.md](architecture.md).

Then every rule goes into a layer:

```css
@layer components {
  .card { padding: var(--space-md); background: var(--color-surface); }
}
```

Three rules make this hold:

- **Nothing may be unlayered.** One unlayered file beats the whole system. If you take one thing from
  this page, take that.
- **Never use an anonymous layer.** `@layer { }` creates a layer you cannot name, cannot reopen and
  cannot reorder. There is no case where it is the right choice in application code.
- **A layer is declared once and appended to freely.** You do not need to keep a layer's contents
  together, because appending preserves the original position. This is what makes layers work across
  hundreds of files.

## Third-party CSS you cannot edit

This is the problem `!important` was invented for and the problem layers actually solve. A component
library, a reset, a map or editor widget: you want its styles beneath yours, and you cannot modify
its source.

```css
/* first file the browser loads, and nothing may precede the @import except @layer or @charset */
@layer vendor, tokens, components, utilities;

@import url("node_modules/some-library/dist/library.css") layer(vendor);

@layer components {
  .card { border-radius: 0; }   /* 0,1,0 and it still wins */
}
```

The library is now in the lowest layer. **Your single class beats anything it ships, including its
long descendant selectors, without one `!important`.**

The critical trap: **this only works through `@import`.** A `layer` attribute on `<link
rel="stylesheet">` is honoured by no engine, measured. A `<link>`ed stylesheet is unlayered, and
unlayered beats every layer, so loading vendor CSS with a `<link>` puts it **above** your entire
architecture. If a build tool or framework injects vendor CSS as a `<link>`, you must route it
through a CSS file that imports it into a layer, or you have no layering at all.

Two further constraints on `@import`:

- It must precede every style rule. One rule above it and **it is dropped silently**, measured. A
  `@layer` statement above it is fine.
- It blocks rendering and cannot be bundled as efficiently as a direct include, so use it for the
  layer assignment and let your bundler inline where it can.

## What to do instead of `!important`

`!important` in author CSS means one of three things, and all three have a better answer:

| You reached for it because | Do this instead |
| -------------------------- | --------------- |
| A third-party rule is winning | Put the third party in a lower layer with `@import ... layer()` |
| Another of your own rules is winning | The two rules belong in different layers. Decide which layer, once |
| A utility class is losing to a component class | Put utilities in the last layer. That is what the last layer is for |

If you inherit `!important` declarations, note that removing them changes behaviour in a way that is
hard to predict, **because important declarations resolve in reverse layer order**. An important
declaration in your earliest layer is currently beating every later one. Migrate by introducing the
layer structure first, then removing important declarations from the lowest layer upward.

`revert-layer` is the tool for the narrow case where a lower layer had it right:

```css
@layer components {
  .card--plain { box-shadow: revert-layer; }   /* take the shadow from whatever layer set it below */
}
```

## Keeping specificity out of the argument

Layers make specificity mostly irrelevant, which is the point. Two mechanisms help further:

- **`:where()` contributes zero specificity**, measured. Use it for resets and for broad defaults
  that must be trivially overridable: `:where(ul, ol) { padding-inline-start: 0; }` can be beaten by
  any single class.
- **`:is()` takes the specificity of its most specific argument**, which is why it is a convenience
  and not a specificity tool. Reaching for `:is()` to reduce specificity is a common and silent
  mistake.

## Version notes

**Cascade layers are widely available since 2024-09-14** and newly available since 2022-03-14, per
the `web-features` dataset. There is no polyfill worth using; the feature is either there or your
floor is older than 2022, which is its own problem. See
[modern-css-floors.md](modern-css-floors.md).

| Concern | Detail |
| ------- | ------ |
| `revert-layer` | Shipped with layers. Same availability |
| `@scope` | From the same spec author and **not** widely available, newly available only since 2025-12-12. Do not build an architecture on it yet |
| Sass and layers | `@layer` is plain CSS and passes through Sass untouched. But Sass `@use` load order and CSS layer order are different things, and confusing them is a real bug. See [preprocessor-or-not.md](preprocessor-or-not.md) |
| Native nesting inside layers | Works, and nesting is widely available only since 2026-06-11 |
| Devtools | Chromium, Firefox and WebKit all display layer names in the styles pane. If a rule shows as struck through, read the layer label before changing specificity |

## Gotchas

- Agent adds `!important` to win a conflict, which makes precedence positional and reverses the
  order the project's other important declarations resolve in
- Agent raises specificity to win a conflict when the losing rule is simply in an earlier layer, so
  the selector grows and the problem returns
- Agent leaves the reset or the vendor CSS unlayered, so it beats every layer and the architecture
  does nothing
- Agent loads vendor CSS with `<link ... layer="vendor">`, which no engine honours. The result looks
  like layering and is the exact opposite
- Agent places `@import` after a style rule, so it is dropped and nothing reports it
- Agent uses `@layer { }` anonymously, producing a layer that cannot be reopened or reordered
- Agent assumes layer order comes from where the blocks appear rather than from the `@layer`
  statement
- Agent assumes `!important` beats everything, and does not know a layered important beats an
  unlayered important and the `style` attribute
- Agent uses `:is()` believing it lowers specificity. It takes the specificity of its most specific
  argument; `:where()` is the zero one
- Agent introduces layers to only part of the codebase, leaving the rest unlayered and therefore
  above the new system
- Agent removes an inherited `!important` without checking which layer it is in, and the replacement
  loses to a later layer

## Related

- [architecture.md](architecture.md) · [utility-vs-semantic.md](utility-vs-semantic.md) · [preprocessor-or-not.md](preprocessor-or-not.md) · [modern-css-floors.md](modern-css-floors.md) · [enforcement.md](enforcement.md)
