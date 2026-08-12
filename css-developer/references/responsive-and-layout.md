# Responsive Design and Layout

This page is verdicts and mechanisms, not a catalogue of layouts. There is one central claim: **the
viewport is the wrong thing to measure**, and it has been for a year.

## Container queries are the default now

A media query asks how wide the **window** is. Almost always, what you needed to know was how wide the
**component's space** is. Those coincide only when a component appears in exactly one place, which is
true right up until someone reuses it in a sidebar.

```css
.card-area { container-type: inline-size; }

@container (min-width: 30rem) {
  .card { display: grid; grid-template-columns: 8rem 1fr; }
}
```

That card is now correct in a full-width page, in a two-column grid and in a 300px sidebar, and it
never learns which one it is in. **Container queries have been widely available since 2025-08-14**, so
the usual reason for not using them has expired.

Three mechanical facts, measured on Chromium 151, Firefox 153 and WebKit 26.5, all three agreeing:

**1. `container-type: inline-size` applies size containment, and that can collapse the element.** An
`inline-block` box containing text measured **264px** wide. The identical box with
`container-type: inline-size` measured **0px**. Containment means the element's inline size must be
computable without looking at its contents, so a shrink-to-fit box has nothing left to size itself
from.

The rule that follows: **put `container-type` on a wrapper whose width is set by its own parent**, never
on an element that is sized by its contents. Grid and flex items, and any block-level element in normal
flow, are fine. Inline-block, floats, table cells and anything using `width: max-content` are not.

**2. A container cannot query itself.** A rule inside `@container` never matches the element carrying
`container-type`, measured. It matches only that element's **descendants**. So you always need one more
element than feels necessary: the container, and the thing that responds. Trying to make one element do
both silently does nothing, with no error.

**3. Container query units are the useful companion.** `cqi` is 1% of the container's inline size, so
`font-size: clamp(1rem, 4cqi, 1.5rem)` scales type against the component rather than the window.

Media queries keep exactly two jobs: **page-level layout**, where the viewport genuinely is the
question, and **user preference queries**, which are not about size at all. See
[tokens-and-theming.md](tokens-and-theming.md).

## Breakpoints

Breakpoints multiply because each one is added to fix one screenshot, and none are ever removed. Two
rules keep the count down:

- **Add a breakpoint when the layout breaks, not at a device width.** Device-named breakpoints encode a
  2012 hardware landscape and were never accurate even then.
- **Keep the total small.** Most interfaces need two or three page-level breakpoints once components
  handle their own adaptation via container queries. If a project has eight, most of them are compensating
  for components that cannot adapt themselves.

Use the range syntax, which is widely available and reads as what it means:

```css
@media (width >= 48rem) { }
```

Set breakpoints in `rem`, not `px`, so they respond to the user's font size. A `px` breakpoint means a
user who has doubled their text size gets the desktop layout with unreadable text.

Breakpoint values must be preprocessor variables or literals, because **a custom property cannot be used
in a media query condition.**

## Logical properties by default

```css
padding-inline: 1rem;        /* not padding-left and padding-right */
margin-block-end: 2rem;      /* not margin-bottom */
border-inline-start: 2px;    /* not border-left */
inset-inline-end: 0;         /* not right */
```

Widely available since 2024-03-20. Use them as the default, not as an internationalisation task. The
reason is simple: they cost nothing today and they are the entire difference between a layout that
mirrors correctly in a right-to-left locale and one that has to be re-audited property by property when
that requirement arrives.

The exception is genuinely physical relationships: a drop shadow's offset, or a decorative element
pinned to the physical left of a viewport, stay physical.

## Intrinsic sizing over measured sizing

Prefer letting content and the available space decide:

```css
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr)); gap: var(--space-md); }
```

That is a responsive grid with **no breakpoints at all**. It reflows at every width, not at three.

The `min(20rem, 100%)` is the part usually omitted, and omitting it is the classic overflow bug: with a
bare `minmax(20rem, 1fr)`, a viewport narrower than 20rem produces a column wider than the screen and
horizontal scrolling on the whole page.

Related tools worth defaulting to: `gap` rather than margins on children, since gap does not apply on
the outside; `min()`, `max()` and `clamp()` rather than a breakpoint for anything that varies smoothly;
and `aspect-ratio` rather than the padding hack.

## Flex or grid

The real distinction is not "one dimension versus two":

- **Grid when the parent decides the arrangement.** The layout is known and the children fill it.
- **Flex when the children decide.** Content-sized items distributing themselves, wrapping as needed.

The practical tell: if you are writing `flex-basis` values that add up to a plan, you wanted grid. If
you are writing `grid-template-columns` with only `auto` values, you wanted flex.

Two defaults worth knowing: flex items have `min-width: auto`, which is why a long unbroken string
overflows a flex container and why `min-width: 0` fixes it. And grid's `1fr` means `minmax(auto, 1fr)`,
so it also refuses to shrink below content size, which is why `minmax(0, 1fr)` is the fix for the same
class of overflow.

## Fluid type

```css
h1 { font-size: clamp(1.75rem, 1.25rem + 2vw, 3rem); }
```

Set the middle term so the value scales from a `rem` base plus a viewport term. Two constraints that are
not optional:

- **Both ends must be `rem`-based.** A `clamp()` bounded in `vw` alone ignores the user's font size
  entirely, which fails the requirement that text be resizable.
- **Prefer `cqi` over `vw`** inside a component, so type scales against the component and not the window.

Do not apply fluid type to everything. Body text at a fixed comfortable size is usually correct, and
scaling it with the viewport makes long-form reading worse on large screens.

## Version notes

| Feature | Status |
| ------- | ------ |
| Container queries | **Widely available since 2025-08-14** |
| Container query units, `cqi` and friends | Shipped with container queries |
| Container **style** queries | **Newly available only, since 2026-05-19.** Different feature, much newer |
| Logical properties | Widely available since 2024-03-20 |
| Media query range syntax | Widely available |
| Subgrid | Widely available since 2026-03-15 |
| `text-wrap: balance` | **Newly available only, since 2024-05-13.** Safe as an enhancement, since unbalanced headings are merely less pretty |
| `field-sizing` | **Newly available only, since 2026-06-16** |
| `:has()` | Widely available since 2026-06-19. Enables parent-driven layout that previously needed script |

Dates from the `web-features` dataset 3.34.3. See [modern-css-floors.md](modern-css-floors.md).

## Gotchas

- Agent uses media queries for component-level adaptation, so the component only works at the width it
  was designed for
- Agent puts `container-type` on an element sized by its contents, and the element collapses to zero
  width with no error. Measured in all three engines
- Agent writes a container query expecting it to style the container itself. It only styles descendants
- Agent adds a breakpoint per device name rather than per broken layout
- Agent sets breakpoints in `px`, so a user with enlarged text gets the desktop layout
- Agent tries to use a custom property in a media query condition
- Agent writes `minmax(20rem, 1fr)` without `min()`, causing page-wide horizontal scroll below 20rem
- Agent reaches for a breakpoint where `auto-fit`, `clamp()` or `min()` would need none
- Agent uses physical properties by default, then treats right-to-left support as a later audit
- Agent debugs a flex overflow for an hour without knowing that flex items default to `min-width: auto`
- Agent writes `clamp()` with `vw`-only bounds, so text no longer responds to the user's font size
- Agent applies fluid type to body copy, making long-form reading worse on large screens
- Agent confuses container **style** queries with container **size** queries. They are 9 months apart in
  availability

## Related

- [modern-css-floors.md](modern-css-floors.md) · [architecture.md](architecture.md) · [tokens-and-theming.md](tokens-and-theming.md) · [utility-vs-semantic.md](utility-vs-semantic.md)
