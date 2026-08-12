# Accessibility Review Checklist

For a review pass over an Angular application claiming WCAG 2.2 AA. Each rule links to the reference
that explains when it does not apply. Anything about the internals of a single widget belongs to the
official `angular-developer` skill, not here.

**Establish the claim first.** 2.1 AA and 2.2 AA differ by six criteria at A and AA, and five of those
six have no automated rule, so a review against the wrong version misses exactly the things that are
new.

## The five that cause the most damage

| # | Failure | Why it survives review | Reference |
| - | ------- | ---------------------- | --------- |
| 1 | Focus not moved on route change | Invisible to a mouse user, to every automated rule, and to component tests | [route-change-focus.md](route-change-focus.md) |
| 2 | "axe is clean" reported as conformance | 30 of axe's 105 rules are not WCAG at all, and five of the six criteria new in 2.2 have no rule | [automated-testing.md](automated-testing.md) |
| 3 | Errors shown as a red border with no `aria-invalid` or `aria-describedby` | The form works perfectly with a mouse and a screen | [form-errors.md](form-errors.md) |
| 4 | Paste blocked on a password or OTP field | Fails 3.3.8 outright, and is usually one line of code | [wcag22-criteria.md](wcag22-criteria.md) |
| 5 | Focus lost when a dialog closes | Only reproducible from the keyboard, and only noticed by people who rely on it | [route-change-focus.md](route-change-focus.md) |

## Keyboard and focus

| # | Rule | Reference |
| - | ---- | --------- |
| 6 | Focus moves to the new view on every navigation, to a heading or wrapper with `tabindex="-1"` | [route-change-focus.md](route-change-focus.md) |
| 7 | Focus moves after the view exists, never in a guard or resolver, and is guarded under SSR | [route-change-focus.md](route-change-focus.md) |
| 8 | Focus is not stolen on non-navigation state changes: filters, polls, sorts | [route-change-focus.md](route-change-focus.md) |
| 9 | The page title updates on navigation | [route-change-focus.md](route-change-focus.md) |
| 10 | A skip link exists, targets a stable element, and is visible when focused | [route-change-focus.md](route-change-focus.md) |
| 11 | Modals trap focus with the CDK, close on `Escape`, and make the background inert | [route-change-focus.md](route-change-focus.md) |
| 12 | Closing a dialog restores focus to the trigger, not to the body | [route-change-focus.md](route-change-focus.md) |
| 13 | Every task can be completed with the keyboard alone, walked end to end | [automated-testing.md](automated-testing.md) |
| 14 | A focused element is never entirely hidden behind a sticky header, footer or banner (2.4.11) | [wcag22-criteria.md](wcag22-criteria.md) |

## Forms

| # | Rule | Reference |
| - | ---- | --------- |
| 15 | `aria-invalid` on the control, `aria-describedby` pointing at a message `id` that exists | [form-errors.md](form-errors.md) |
| 16 | The message container is always rendered, so the reference never dangles | [form-errors.md](form-errors.md) |
| 17 | An error summary appears on failed submit, with links to each invalid field | [form-errors.md](form-errors.md) |
| 18 | Announced once: focus the summary **or** use a live region, never both | [form-errors.md](form-errors.md) |
| 19 | Validation is announced on submit, not per keystroke | [form-errors.md](form-errors.md) |
| 20 | The submit button is not disabled while the form is invalid | [form-errors.md](form-errors.md) |
| 21 | Radios and checkboxes are in a `fieldset` with a `legend`; no `placeholder` as label | [form-errors.md](form-errors.md) |
| 22 | Required state uses the `required` attribute, not an asterisk alone | [form-errors.md](form-errors.md) |
| 23 | The same information is not requested twice in one flow (3.3.7) | [wcag22-criteria.md](wcag22-criteria.md) |

## Colour and visual

| # | Rule | Reference |
| - | ---- | --------- |
| 24 | Text meets 4.5:1, or 3:1 for large text, computed against the rendered colour | [colour-and-contrast.md](colour-and-contrast.md) |
| 25 | Component borders, focus indicators and meaningful graphics meet 3:1 (1.4.11) | [colour-and-contrast.md](colour-and-contrast.md) |
| 26 | Ratios recomputed for dark mode, hover and disabled variants | [colour-and-contrast.md](colour-and-contrast.md) |
| 27 | `opacity`, gradients and background images accounted for, not just the base colour | [colour-and-contrast.md](colour-and-contrast.md) |
| 28 | No meaning carried by colour alone: negatives, statuses, validation | [colour-and-contrast.md](colour-and-contrast.md) |
| 29 | Targets are at least 24 by 24 CSS pixels (2.5.8) | [wcag22-criteria.md](wcag22-criteria.md) |

## WCAG 2.2 additions and tooling

| # | Rule | Reference |
| - | ---- | --------- |
| 30 | Every draggable interaction has a single-pointer alternative (2.5.7) | [wcag22-criteria.md](wcag22-criteria.md) |
| 31 | Help affordances appear in the same relative order across pages (3.2.6) | [wcag22-criteria.md](wcag22-criteria.md) |
| 32 | Paste works in password and one-time-code fields; login is possible with a password manager (3.3.8) | [wcag22-criteria.md](wcag22-criteria.md) |
| 33 | No effort spent on 4.1.1 Parsing for a 2.2 claim; `wcag2a-obsolete` rules excluded | [wcag22-criteria.md](wcag22-criteria.md) |
| 34 | axe tags set explicitly to the level being claimed, not left at defaults | [automated-testing.md](automated-testing.md) |
| 35 | WCAG-tagged violations fail the build; `best-practice` findings are reported separately | [automated-testing.md](automated-testing.md) |
| 36 | Checks run against real states: dialog open, form invalid, panel expanded | [automated-testing.md](automated-testing.md) |
| 37 | axe `incomplete` results are reviewed, not discarded - text over images lands there | [colour-and-contrast.md](colour-and-contrast.md) |
| 38 | The conformance claim records what was tested and at which level | [wcag22-criteria.md](wcag22-criteria.md) |

## Version notes

Every rule holds on Angular 19 to 21 with `@angular/cdk` present. Version dependence is narrow:

| Rule | Depends on |
| ---- | ---------- |
| 11, 12 | `@angular/cdk/a11y`. Without the CDK these must be hand-rolled, and the primitives listed in [route-change-focus.md](route-change-focus.md) are what you are reimplementing |
| 14, 29, 30, 31, 32, 33 | The claim being **2.2**, not 2.1. On a 2.1 claim these do not apply and 4.1.1 still does |
| 34, 35 | axe-core version. Rule counts and tags move between minors; re-enumerate rather than trusting a remembered number |
| 6, 7 | Angular's router having no focus API, true as of 21.2.19. If `withExperimentalPlatformNavigation` becomes supported, focus restoration moves to the browser |

## Gotchas

- Agent reviews without establishing whether the claim is 2.1 or 2.2 - six rules above apply only to
  one of them
- Agent runs the automated check and stops, so rules 6 to 14 and 30 to 32 are never examined
- Agent reports every finding as a conformance failure, including `best-practice` ones
- Agent reviews the default render only, so no dialog, error state or expanded panel is tested
- Agent reviews with a mouse. Rules 6 to 13 are only visible from the keyboard
- Agent flags widget-internal ARIA against this list - that belongs to the official
  `angular-developer` skill
- Agent treats the checklist as a generation guide. It is written for a review pass over code that
  already exists

## Related

- [automated-testing.md](automated-testing.md) · [route-change-focus.md](route-change-focus.md) · [form-errors.md](form-errors.md) · [colour-and-contrast.md](colour-and-contrast.md) · [wcag22-criteria.md](wcag22-criteria.md)
