# Focus and Announcement Across a Route Change

This is the single most common real-world failure in an Angular application, and the framework does
not warn about it, because from the framework's point of view nothing is wrong.

## The asymmetry, measured

Checked against `@angular/router` **21.2.19**, across every shipped type definition:

| Symbol | Occurrences |
| ------ | ----------- |
| `withInMemoryScrolling` | 7 |
| `withViewTransitions` | 7 |
| `scrollPositionRestoration` | 1 |
| `anchorScrolling` | 1 |
| any API named `*Focus*` | **0** |
| the string `focus` | 1, and it is prose in a comment |

**The router will restore your scroll position and has no opinion about focus at all.** The one
mention is in the documentation for `withExperimentalPlatformNavigation`, describing what the
browser's Navigation API would provide: "Native scroll and focus restoration support by the browser,
without the need for custom implementations." That feature is labelled "CRITICAL: This feature is
_highly_ experimental and should not be used in production."

So there is a signposted future in which the platform handles this, and it is not available now.
Until then it is application code.

## What actually happens by default

A user clicks a link inside a list, the route changes, the old component is destroyed. Focus was on
that link. The link no longer exists, so the browser resets focus to the document body.

The consequences, in order of how often they are reported as bugs:

- **The next Tab press starts from the top of the document**, so a keyboard user re-traverses the
  header and navigation on every single page change.
- **A screen reader announces nothing.** There was no page load, so no document title announcement.
  The user hears silence and has no way to know the view changed.
- **Any "skip to content" link is useless**, because it targets an element in a view that has just
  been replaced.

None of this shows up for a mouse user, in any automated check, or in a component test.

## What to do

**Move focus deliberately on every navigation.** The target is the new view's first heading, or a
container that wraps it. Two rules make it work rather than merely happen:

- The target needs `tabindex="-1"` to be focusable at all. Do **not** use `tabindex="0"`, which adds
  a permanent, pointless tab stop.
- Focus must move **after** the new view exists. In a resolver or a guard, the component is not
  rendered yet.

Announce the change as well as moving focus. Moving focus to a heading gets the heading read; it does
not tell the user which page they are on if the heading is generic. The CDK's `LiveAnnouncer` is the
mechanism, and `@angular/cdk/a11y` ships it - see the CDK inventory in the version notes below.

**Keep the page title in step.** The title is what the browser and many assistive technologies use to
identify the view, and Angular's `Title` service is the supported way to set it. A single-page
application that never updates its title looks like one page to anything outside the DOM, including
browser history and tab lists.

**Do not move focus on every state change.** A filter re-running, a table sorting, a poll returning:
none of those are navigations, and stealing focus during them is worse than leaving it alone. Focus
moves on deliberate user navigation, and announcements cover the rest.

**Handle SSR.** Under server-side rendering the element does not exist during the first render, so a
focus call must be guarded until the browser has hydrated. This is the one place where the rendering
strategy changes the code rather than just the timing.

## The skip link, correctly

A skip link is the cheap fix for a long header, and it is also the thing most often broken by SPA
navigation:

- It must target an element that exists **after** navigation, so target a stable wrapper rather than
  a per-view element.
- The target needs `tabindex="-1"`.
- It must be visible when focused. A skip link hidden with `display: none` is not focusable at all,
  which is the most common way it silently stops working.
- axe has a `skip-link` rule, so this one is partly checkable in CI - one of the few in this area
  that is. See [automated-testing.md](automated-testing.md).

## Dialogs and panels: the same problem, a different trigger

A dialog opening is a view change without a navigation, and it has the same three obligations plus
one. **Do not hand-roll any of this**; `@angular/cdk/a11y` ships tested primitives and the mistakes
below are what hand-rolling produces.

| Need | CDK primitive | What goes wrong without it |
| ---- | ------------- | -------------------------- |
| Keep Tab inside the dialog | `CdkTrapFocus` / `ConfigurableFocusTrap` | Tab escapes to the page behind, which is still there and still clickable |
| Decide what is actually focusable | `InteractivityChecker` | A hand-rolled trap picks the wrong first element, or one that is `disabled` or `hidden` |
| Announce something with no focus target | `LiveAnnouncer` | Silence |
| Know how the user is interacting | `InputModalityDetector` | Focus rings shown for mouse users, or hidden from keyboard users |

The obligation hand-rolled traps almost always miss: **restore focus to the element that opened the
dialog when it closes.** Not the body, not the top of the page - the trigger. If the trigger no
longer exists, focus its nearest surviving container. Without this, closing a dialog from a table row
sends the user back to the start of the document.

Also: `Escape` must close anything modal, and the content behind must be genuinely inert rather than
merely covered by an overlay.

## Version notes

**Verified against `@angular/router` 21.2.19 and `@angular/cdk` 21.2.14.**

The router has had no focus API for as long as it has had scroll restoration, so nothing here is new
in 21 and nothing is expected to change until the Navigation API interop leaves experimental status.
Watch `withExperimentalPlatformNavigation`: when it becomes supported, focus restoration moves to the
browser and most of this page becomes unnecessary.

`@angular/cdk/a11y` 21.2.14 ships all of the following, confirmed present in its type definitions:
`LiveAnnouncer`, `CdkAriaLive`, `FocusTrap`, `FocusTrapFactory`, `ConfigurableFocusTrap`,
`ConfigurableFocusTrapFactory`, `CdkTrapFocus`, `FocusTrapManager`, `FocusMonitor`,
`InteractivityChecker`, `AriaDescriber`, `HighContrastModeDetector`, `InputModalityDetector`,
`ListKeyManager`, `ActiveDescendantKeyManager`, `TreeKeyManager`, `A11yModule`.

| Concern | Detail |
| ------- | ------ |
| `withViewTransitions` | Animates the transition. It does not move focus, and a transition in progress can make a focus change land on an element that is still animating |
| SSR | Focus cannot be moved before hydration. Guard on the platform |
| WCAG | Route-change focus is not one criterion. It is how 2.4.3 Focus Order and 4.1.3 Status Messages are satisfied in an SPA, which is why no single rule tests it |

## Gotchas

- Agent assumes the router handles focus because it handles scrolling - measured, there is no focus
  API at all
- Agent uses `tabindex="0"` on the focus target, adding a permanent tab stop to a heading
- Agent moves focus in a resolver or guard, before the view exists
- Agent moves focus on every state change, so a filter or a poll steals focus mid-typing
- Agent announces the route change but does not move focus, so Tab still starts from the top
- Agent moves focus but announces nothing, so the user hears one generic heading and cannot tell
  which page they are on
- Agent never updates the page title, so history, tab lists and assistive technology all see one page
- Agent adds a skip link hidden with `display: none`, which cannot receive focus
- Agent points a skip link at a per-view element that is destroyed on navigation
- Agent calls `focus()` during SSR and crashes the server render
- Agent tests this with a mouse and concludes it works. It is only visible from the keyboard
- Agent reaches for `withExperimentalPlatformNavigation` to solve it - it is explicitly not for
  production

## Related

- [automated-testing.md](automated-testing.md) · [colour-and-contrast.md](colour-and-contrast.md)
