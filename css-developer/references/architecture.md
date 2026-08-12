# Architecture: Where Does This Declaration Go

There is one question, and a project either has a mechanical answer or it does not: **given a new
declaration, which file does it go in, and what beats it?** Every methodology below is an attempt to
answer that. Understanding what each was solving matters more than picking one, because most of them
were solving a problem the language has since fixed.

## The methodologies, and what has changed under them

| Methodology | Author | The idea | Where it stands now |
| ----------- | ------ | -------- | ------------------- |
| **BEM** | Yandex | `.block__element--modifier`. Flat, single-class selectors, so specificity stays at 0,1,0 and names carry the structure | **The naming half is still the best default.** Its specificity discipline is now better served by layers |
| **OOCSS** | Nicole Sullivan | Separate structure from skin, and container from content | Absorbed into everything since. Its lasting contribution is the idea that a pattern and its decoration are different things |
| **SMACSS** | Jonathan Snook | Base, Layout, Module, State, Theme | The categories are sound. The state layer is the part still worth copying verbatim |
| **ITCSS** | Harry Roberts | Settings, Tools, Generic, Elements, Objects, Components, Utilities. An inverted triangle where reach decreases as specificity increases, enforced by **source order** | **The most important of the five, and the most changed.** See below |
| **The 7-1 pattern** | Kitty Giraudel, Sass Guidelines | Seven folders and one entry file. The most widely repeated Sass folder convention there is | **Two durable ideas and five folders you probably do not want.** See below, because this one is recommended far more often than it is understood |
| **CUBE CSS** | Andy Bell | Composition, Utility, Block, Exception. "An extension of CSS rather than a reinvention", where "the cascade and inheritance are embraced, not avoided" | The best fit for a modern, layer-based, token-driven project. Its composition and utility split maps cleanly onto layers |

### The thing worth understanding about ITCSS

ITCSS's whole mechanism was **source order**. Because a later rule of equal specificity wins, ITCSS
ordered concatenated files from least to most specific, and the specificity graph was how you checked
it. Harry Roberts' graph plots specificity on the y axis against position in the stylesheet on the x
axis: healthy is a steady upward trend, unhealthy is "peaks and troughs" where a high-specificity
selector appears early and everything after it has to climb back over.

ITCSS was, in other words, **a careful manual simulation of cascade layers, built because cascade
layers did not exist**. They do now, and they do it better: layer order is explicit rather than
implied by file concatenation, it survives files loading in any order, and it beats specificity
outright instead of merely arranging it. See [cascade-and-layers.md](cascade-and-layers.md).

This is not a criticism of ITCSS. It is the reason the verdict below is what it is.

### The 7-1 pattern, since it is the one people are told is best

"7-1" means **seven folders and one file**. That is the whole name, and the counting is the least
important part of it, which is why hearing the name repeatedly does not teach you anything.

The seven folders, as Sass Guidelines specifies them:

| Folder | Holds | Still a good idea |
| ------ | ----- | ----------------- |
| `abstracts/` | Every global variable, function, mixin and placeholder. "It should not output a single line of CSS when compiled on its own" | **Yes.** This is one of the two durable ideas |
| `base/` | Reset, typography, bare element rules | Yes, as the `reset` and `base` layers |
| `components/` | Buttons, cards, widgets | Yes |
| `layout/` | Header, footer, navigation, grid | Yes, as the `layout` layer |
| `pages/` | Page-specific styles, one file per page | **No.** See below |
| `themes/` | Theme variations | **No longer.** A theme is now a short block of custom property overrides, not a directory |
| `vendors/` | Third-party CSS, copied in | **Superseded** by `@import url(...) layer(vendor)`, which does not require copying anything |

And the one file, `main.scss`, which "should not contain anything but `@import` and comments",
importing in this order: abstracts, vendors, base, layout, components, pages, themes.

**The two ideas worth taking, and they are both already rules in this skill:**

1. **One entry file that contains nothing but imports.** It is the architecture, and keeping logic
   out of it is what makes it readable. This skill states it as its own rule below.
2. **A folder whose files emit zero CSS.** Variables, mixins and functions compile to nothing, so
   they can be loaded from anywhere without duplicating output. Also its own rule below.

**What has not aged well:**

- **That import order is source-order precedence**, the same manual simulation as ITCSS, and
  `@layer` replaces it. Under 7-1, moving a file between two folders changes which rule wins. That
  is exactly the fragility layers remove.
- **`pages/` is an anti-pattern in a component-based application.** A rule you can only understand
  by knowing which URL the user is on cannot be reasoned about locally, and it is the usual origin
  of a stylesheet nobody dares delete. If a page needs unique styling, it has a component.
- **`themes/` as a folder implies themes are large.** They are not any more. A complete second
  theme is a handful of custom property overrides. See [tokens-and-theming.md](tokens-and-theming.md).
- **Nobody uses seven folders.** Real projects use three or four, which is fine, and means the
  number in the name describes almost no actual codebase.

**So: 7-1 is not "best".** It is a reasonable Sass folder convention from the mid-2010s whose two
good ideas this skill keeps, whose ordering half is superseded by cascade layers, and whose
remaining value is that it gave people a default when they had none. If you already order by layer
and keep your abstracts silent, you have the whole benefit and the folder count is yours to choose.

## The verdict

**Take ITCSS's ordering insight, implement it as cascade layers rather than as source order, and use
BEM for naming unless you have chosen utility-first.** Do not adopt any methodology wholesale as a
folder structure, because the folder structure is the least important part of all of them and the part
people copy first.

A layer set that works for most projects:

```css
@layer reset, tokens, base, layout, components, utilities;
```

| Layer | Contains | Rough ITCSS equivalent |
| ----- | -------- | ---------------------- |
| `reset` | Normalisation, `box-sizing`, sensible defaults. Third-party resets go here | Generic |
| `tokens` | Custom property definitions and theme blocks. Emits only `:root`-level declarations | Settings, but now emitting CSS |
| `base` | Bare element styles: headings, links, form controls, tables | Elements |
| `layout` | Reusable arrangement patterns that carry no decoration. Stack, grid, sidebar | Objects, or CUBE's Composition |
| `components` | Designed UI pieces. The bulk of your CSS | Components |
| `utilities` | Single-purpose overrides. Last, so they win **without `!important`** | Utilities |

Add a `vendor` layer **first** if you consume third-party component CSS, so your single classes beat
whatever it ships. Add an `overrides` layer last only if you genuinely need an escape hatch, and treat
anything in it as debt with a name.

The utilities layer is where the payoff is most obvious. In ITCSS, utilities carried `!important` by
convention, because that was the only way to guarantee a helper beat a component. As the last layer,
**a utility at 0,1,0 beats a component at 0,3,0 with no important declaration at all**, measured. If
your project still has `!important` on its helpers, that is a leftover from a constraint that no
longer applies.

## Files, and the one file that matters

Folder shape is largely taste. Two things are not:

**One entry file owns the layer statement and every import.** That file is the architecture, it should
be short enough to read in one screen, and nothing else in the project should import anything.

```scss
// styles.scss - the only file that decides order
@layer reset, tokens, base, layout, components, utilities;

@use 'reset';
@use 'tokens';
@use 'base';
@use 'layout';
@use 'components';
@use 'utilities';
```

**Files that define no CSS must be unable to emit any.** Variables, mixins and functions belong in
files that produce zero bytes of output. In Sass this is what `@use` and `@forward` give you; the
failure mode is a partial that defines a mixin and also, three lines down, a stray rule, which then
gets emitted once per importing file. See [preprocessor-or-not.md](preprocessor-or-not.md).

Beyond that, the split that holds up best is **by feature, not by type**, once a project is past a
few dozen components. A `card/` folder containing the card's markup, logic and styles is easier to
delete than a `components/_card.scss` twelve directories away from its template. The counter-argument
is that global concerns then have no home, which is what the layer list above is for.

## Global versus local

Every project has both, and the boundary should be a decision rather than an accident:

- **Global** is anything a component may rely on without importing it: tokens, resets, element
  defaults, layout primitives, utilities. All of it lives in the layers before `components`.
- **Local** is everything a single component owns. It may read tokens and it may not redefine them.

The rule that keeps this honest: **a component never styles another component.** If a card needs its
buttons to look different, that variation belongs to the button, expressed as a modifier or a token,
not as a descendant selector reaching out of the card. Descendant selectors that cross component
boundaries are how a codebase becomes impossible to change, and they are the single most common
architectural fault in a large stylesheet.

## Naming

If you are using semantic classes, **BEM by default**: `.card`, `.card__title`, `.card--featured`.
It is unfashionable, it is verbose, and it has one property nothing else does, which is that you can
tell what a class does and where it lives from the class alone.

What matters more than the convention:

- **One convention, enforced.** `selector-class-pattern` in stylelint takes a regex, so the
  convention becomes a build failure rather than a review comment. See
  [enforcement.md](enforcement.md).
- **Name by role, not appearance.** `.card--featured`, not `.card--gold`.
- **Do not encode the layer in the class name.** ITCSS' `o-` and `c-` prefixes existed to signal which
  source-order tier a class belonged to. The `@layer` it lives in now says that, and it says it to
  the browser rather than to the reader.

Once layers are in place, naming stops carrying precedence and only has to carry meaning, which makes
the naming argument much smaller than it used to be.

## Nesting depth

Preprocessor nesting, and now native nesting, silently manufacture specificity. Every level of
nesting compounds into the generated selector, and a three-level nest reads as tidy source and
compiles to something no later rule can beat.

Cap it at **two levels**, three if you must, and enforce it with `max-nesting-depth`. Use nesting for
what it is good at, which is grouping a block's modifiers and states next to the block, and not as a
way to mirror your DOM tree in your stylesheet.

The `&`-concatenation pattern deserves a specific warning: `&__title` inside `.card` is convenient and
it makes the class name **ungreppable**. Searching a codebase for `card__title` finds nothing. On a
small project that is a fair trade; on a large one it is not, and the decision should be deliberate
rather than inherited from a tutorial.

## Version notes

| Concern | Detail |
| ------- | ------ |
| Cascade layers | Widely available since 2024-09-14. Everything in the verdict above depends on this and on nothing else |
| Native CSS nesting | Widely available since 2026-06-11, so the nesting-depth discipline now applies to plain CSS too and not only to preprocessors |
| `:where()` for zero-specificity defaults | Widely available. Useful in the `reset` and `base` layers |
| ITCSS, BEM, SMACSS, OOCSS | Predate cascade layers. Their specificity mechanisms are superseded; their categorisation and naming are not |
| CUBE CSS | Written after layers existed and assumes the cascade is an ally, which is why it needs the least adaptation |

## Gotchas

- Agent copies a methodology's folder structure and none of its ordering discipline, which is the
  half that did the work
- Agent recommends the 7-1 pattern as current best practice without saying that its import-order
  half is superseded by layers, and that `pages/` and `themes/` are no longer wanted
- Agent creates seven folders because the name contains a seven, several of which then stay empty
- Agent creates a `pages/` folder, producing rules that can only be understood by knowing which URL
  the user is on
- Agent adds `!important` to utility classes, reproducing an ITCSS convention that exists only because
  layers did not
- Agent puts the layer statement in more than one file, or in a file whose load order is not
  guaranteed, so the architecture depends on the bundler
- Agent lets a partial that should only define mixins also emit a rule, which then duplicates per
  importing file
- Agent nests to four or five levels because the source looks tidy, and creates selectors nothing can
  override
- Agent writes descendant selectors that reach from one component into another
- Agent keeps ITCSS `o-` and `c-` prefixes alongside layers, so precedence is now encoded twice, in
  the name and in the layer, and the two can disagree
- Agent uses `&__element` concatenation throughout a large codebase, making every class name
  unsearchable
- Agent debates naming conventions at length in a project that has no layer order, which is the
  problem that actually causes the pain
- Agent invents a new layer per component, defeating the point of a small, readable order

## Related

- [cascade-and-layers.md](cascade-and-layers.md) · [utility-vs-semantic.md](utility-vs-semantic.md) · [preprocessor-or-not.md](preprocessor-or-not.md) · [tokens-and-theming.md](tokens-and-theming.md) · [enforcement.md](enforcement.md)
