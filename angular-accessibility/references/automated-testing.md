# Automated Testing, and What It Cannot See

An automated accessibility check is a lint pass. It is worth having in CI, and it is not evidence of
conformance. This page quantifies the gap so the claim can be made precisely rather than as a
slogan.

Every number below was produced by enumerating axe-core's own rule metadata at version **4.13.0**,
not from documentation.

## What axe actually covers

```
total rules                105
rules mapped to any WCAG     75
rules mapped to no WCAG      30
```

Thirty of its rules are `best-practice` only: real advice, no conformance requirement behind them.
So a team that treats every axe finding as a compliance failure over-reports by roughly a third, and
a team that fixes every axe finding has still not addressed most of WCAG.

Per level, the rule sets are much smaller than the totals suggest:

| Tag | Rules |
| --- | ----- |
| `wcag2a` | 62 |
| `wcag2aa` | **3** - `color-contrast`, `meta-viewport`, `valid-lang` |
| `wcag21a` | 1 - `label-content-name-mismatch` |
| `wcag21aa` | 3 - `autocomplete-valid`, `avoid-inline-spacing`, `css-orientation-lock` |
| `wcag22a` | **0** |
| `wcag22aa` | **1** - `target-size` |

**WCAG 2.2 added six criteria at A and AA. axe covers one of them.** The new A and AA criteria are
3.2.6 Consistent Help, 3.3.7 Redundant Entry, 2.4.11 Focus Not Obscured (Minimum), 2.5.7 Dragging
Movements, 2.5.8 Target Size (Minimum) and 3.3.8 Accessible Authentication (Minimum). The single
`target-size` rule is 2.5.8. So on a project claiming 2.2 AA, **automation has nothing to say about
five of the six things that are new about the claim.**

## The specific blind spots

Searched axe's whole rule set: there is **no rule** for any of these.

| Concern | Rules found |
| ------- | ----------- |
| Live regions and announcements | none |
| Reflow at 320 CSS pixels | none |
| Dragging movements, 2.5.7 | none |
| Consistent help, 3.2.6 | none |
| Accessible authentication, 3.3.8 | none |

That is not a criticism of axe. Every one of those requires knowing what the page is *for*, and no
static rule can. But it means the following are undetectable by CI and must be checked by a person:

- **Whether an announcement happened at the right moment**, or at all. A live region that is present
  in the DOM and never updated passes every rule.
- **Whether focus went somewhere sensible.** `focus-order-semantics` checks that focusable things
  have appropriate roles; nothing checks that focus is in a useful place after an action.
- **Whether the reading order matches the visual order.** CSS can reorder a grid or flex container
  without touching the DOM.
- **Whether an error message is associated with the field it describes**, as opposed to merely
  existing on the page.
- **Whether the keyboard path completes the task.** Nine `cat.keyboard` rules exist, and none of them
  attempts the journey.
- **Whether alternative text is correct.** `image-alt` checks presence. "image123.png" passes.

## Where automation is genuinely strong

Do not throw it away; it is very good at the mechanical layer, and these are the categories worth
enabling deliberately:

| Category | Rules | Value |
| -------- | ----- | ----- |
| `cat.aria` | 25 | ARIA misuse: invalid attributes, bad role nesting, references to missing ids. High value, tedious to check by hand |
| `cat.forms` | 5 | `label`, `select-name`, `form-field-multiple-labels`, `label-title-only`, `autocomplete-valid` |
| `cat.keyboard` | 9 | `tabindex`, `nested-interactive`, `scrollable-region-focusable`, `skip-link`, `bypass` |
| `cat.color` | 3 | `color-contrast`, `color-contrast-enhanced`, `link-in-text-block` |

`nested-interactive` and `scrollable-region-focusable` are the two worth knowing about, because both
catch real defects that are invisible on inspection: a button inside a button, and a scrolling region
a keyboard cannot reach.

## Running it, and what to assert

- **Set the tags explicitly.** A default run is not a 2.2 AA run. Choose the level you are claiming,
  and add `best-practice` separately if you want the advice without conflating it with conformance.
- **Fail the build on WCAG-tagged violations, report the rest.** Two thresholds, because they mean
  different things.
- **Test components, not just pages.** Component-level checks catch ARIA misuse close to the change
  that caused it. `angular-developer` owns the harness; the `axe.run(fixture.nativeElement)` shape is
  the point of contact.
- **Check the state, not just the initial render.** Open the dialog, submit the invalid form, expand
  the accordion, then run the check. Most defects are in states the default render never reaches.
- **Never report "axe passes" as "accessible".** Say what was checked and at which level, which is
  both honest and more useful.

## Version notes

**axe-core 4.13.0.** Rule counts move between minor versions as rules are added and re-tagged, so
re-run the enumeration rather than trusting these numbers after an upgrade:

```js
const axe = require('axe-core');
const rules = axe.getRules();
// count by tag, and count rules whose tags contain no /^wcag\d/ entry
```

| Concern | Detail |
| ------- | ------ |
| WCAG 2.1 AA versus 2.2 AA | Six additional criteria at A and AA. axe covers one. A project that moved its claim from 2.1 to 2.2 without new manual checks has not changed anything it verifies |
| 4.1.1 Parsing | **Removed in WCAG 2.2.** axe tags the affected rules `wcag2a-obsolete`, so they will still report unless excluded. Do not spend effort on them for a 2.2 claim |
| `target-size` | The only 2.2 rule. It is 2.5.8, Level AA, and it is the one new criterion CI can hold you to |
| Angular version | Irrelevant to axe itself; it affects only how the test harness mounts the component |

## Gotchas

- Agent reports a clean axe run as WCAG conformance - 30 of 105 rules are not WCAG at all, and five
  of the six criteria new in 2.2 have no rule
- Agent runs axe with default tags on a project claiming 2.2 AA, so the claim and the check are
  about different standards
- Agent counts `best-practice` violations as compliance failures
- Agent checks only the initial render, so no dialog, no error state and no expanded panel is ever
  tested
- Agent adds axe to CI and never fails the build on it, which is indistinguishable from not having it
- Agent trusts `image-alt` to mean the alt text is useful - it checks presence only
- Agent assumes a live region works because it is in the DOM - nothing verifies it announced
- Agent leaves `wcag2a-obsolete` rules enabled while claiming 2.2, and fixes 4.1.1 Parsing findings
  that no longer exist in the standard
- Agent uses axe as the reason not to test with a keyboard - the nine keyboard rules do not attempt
  the task
- Agent scans a page behind a login without authenticating the scanner, so the CI job passes on the
  login screen forever

## Related

- [route-change-focus.md](route-change-focus.md) · [colour-and-contrast.md](colour-and-contrast.md)
