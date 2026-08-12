---
name: angular-accessibility
description: Takes an Angular application to WCAG 2.2 AA conformance, covering everything outside a single widget. Trigger when focus is not moved or restored after a route change or a dialog closes, when a screen reader announces nothing after an async update, when validation errors are invisible to assistive technology, when colour contrast or target size must be checked, when a keyboard user is trapped or cannot escape, when axe reports clean but the page is still unusable, or when the criteria new in WCAG 2.2 must be met. Install the official angular-developer skill alongside it; that owns ARIA roles, keyboard interaction and focus within a component, and this skill never restates it.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# Accessibility Beyond the Widget

The official `angular-developer` skill's `angular-aria.md` covers nine widget patterns - Accordion,
Listbox, Combobox, Menu, Tabs, Toolbar, Tree, Grid - with their ARIA attributes, arrow-key
navigation, roving tabindex and focus **within** the component. Its own framing is that its
directives handle the accessibility logic while you supply structure and styling.

**This skill owns everything outside a single widget**, which is where conformance is actually won
or lost: what happens between components, across navigations, and at the level of the page.

## What this skill does not own

| Ask about | Use instead |
| --------- | ----------- |
| ARIA roles and attributes for a listbox, combobox, menu, tabs, tree or grid | the official `angular-developer` skill |
| Arrow-key navigation, roving tabindex, `activedescendant` inside one component | the official `angular-developer` skill |
| Component structure, signals, forms API, routing mechanics | the official `angular-developer` skill |
| Tailwind or component styling as such | not covered here; see the roadmap's styling item |

1. **Establish the target before giving guidance.** Which WCAG version and level is being claimed
   (2.1 AA and 2.2 AA differ by six A and AA criteria), the Angular major, and whether
   `@angular/cdk` is a dependency. Advice that assumes the CDK is wrong without it.

2. **This skill owns only what is outside one widget.** Never restate the nine patterns. If a claim
   is about the internals of a single component, it belongs to `angular-developer`.

3. **An automated tool cannot tell you whether you conform.** Verified on axe-core 4.13.0: 105
   rules, of which **30 map to no WCAG criterion at all**, and exactly **one** maps to a criterion
   new in WCAG 2.2. There is no rule for live regions, reflow, dragging movements, consistent help
   or accessible authentication. Treat a clean axe run as the floor, never the verdict. See
   [automated-testing.md](references/automated-testing.md).

4. **Use `@angular/cdk/a11y` rather than hand-rolling.** `LiveAnnouncer`, `FocusTrap`,
   `InteractivityChecker`, `FocusMonitor` and `AriaDescriber` all exist and are tested. A
   hand-written focus trap will miss `inert`, shadow DOM, and the case where the trap's own
   contents change.

5. **Focus after a route change is your job, and nothing warns you.** Angular's router ships
   configurable scroll restoration and **no focus API whatsoever**. See
   [route-change-focus.md](references/route-change-focus.md).

6. **Test keyboard first, then a screen reader, then automation.** In that order, because the first
   two find what the third cannot see, and the third is the only one that can run in CI.

Every reference carries a **`## Version notes`** section stating what differs across Angular 19 to
21, `@angular/cdk` versions and WCAG 2.1 to 2.2, and a **`## Gotchas`** list of the specific
mistakes agents make in that area. Read the gotchas even when skimming. Where a claim is
computable it has been computed: the contrast ratios and the axe rule counts are program output.

## Determining the target

**Step 1.** The claim. Ask which standard is being conformed to. "Accessible" is not a target;
"WCAG 2.2 AA" is. For UK public-facing services this is usually 2.2 AA, and the Equality Act 2010
duty is on the outcome rather than on a version.

**Step 2.** `package.json` for `@angular/core` and whether `@angular/cdk` is present. Without the
CDK, live announcements and focus traps have to be written by hand, and the guidance changes.

**Step 3.** Whether an automated check already runs in CI, and with which ruleset. A project running
axe with only the default tags is not checking the same things as one running `wcag22aa`.

**Step 4.** Whether the application is server-rendered. Hydration changes when focus can be moved,
because the element may not exist during the first render.

## Topics

- **Automated testing and its limits**: what axe actually covers, measured rule by rule, what it
  cannot see, and the manual checks that replace the missing coverage. Read
  [automated-testing.md](references/automated-testing.md)
- **Focus across route changes**: the router's missing focus API, where focus goes by default, skip
  links, and announcing the new page. Read [route-change-focus.md](references/route-change-focus.md)
- **Colour and contrast**: the ratios, computed, including the one-hex-digit difference between
  passing and failing, non-text contrast, and never encoding meaning in colour alone. Read
  [colour-and-contrast.md](references/colour-and-contrast.md)
- **Form errors**: the three associations that make a validation failure perceivable, the Angular
  trap of a dangling `aria-describedby`, error summaries, and announcing exactly once. Read
  [form-errors.md](references/form-errors.md)
- **What WCAG 2.2 added**: the nine new criteria, the one that was removed, and the five new manual
  checks that come with moving a claim from 2.1 AA. Read
  [wcag22-criteria.md](references/wcag22-criteria.md)

## Symptom index

| Symptom | Read |
| ------- | ---- |
| axe passes and a keyboard user still cannot complete the task | [automated-testing.md](references/automated-testing.md) |
| The CI a11y job never fails, on any page | [automated-testing.md](references/automated-testing.md) |
| Tab goes to the top of the page, or nowhere, after navigating | [route-change-focus.md](references/route-change-focus.md) |
| A screen reader says nothing when the route changes | [route-change-focus.md](references/route-change-focus.md) |
| A designer's grey text fails and nobody can say why | [colour-and-contrast.md](references/colour-and-contrast.md) |
| A warning button is unreadable in white text | [colour-and-contrast.md](references/colour-and-contrast.md) |
| A red border is the only sign a field is invalid | [form-errors.md](references/form-errors.md) |
| A screen reader reads the same error twice | [form-errors.md](references/form-errors.md) |
| The form validates but the submit button is unreachable | [form-errors.md](references/form-errors.md) |
| A focused row disappears behind a sticky header | [wcag22-criteria.md](references/wcag22-criteria.md) |
| A password manager cannot be used to log in | [wcag22-criteria.md](references/wcag22-criteria.md) |
| Reordering is only possible by dragging | [wcag22-criteria.md](references/wcag22-criteria.md) |
| Focus jumps to the top of the page when a dialog closes | [route-change-focus.md](references/route-change-focus.md) |
| The claim moved from 2.1 AA to 2.2 AA and nothing else changed | [wcag22-criteria.md](references/wcag22-criteria.md) |

## Checklist

- **Accessibility review checklist**: 38 rules for a review pass over an existing application, the
  five most damaging first, each linked to its reference. Read
  [checklist.md](references/checklist.md)
