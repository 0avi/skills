# What WCAG 2.2 Added

If a project's claim moved from 2.1 AA to 2.2 AA, this page is the whole difference. Read from the
[WCAG 2.2 specification](https://www.w3.org/TR/WCAG22/) rather than from memory or a blog summary.

## The nine new criteria

| Criterion | Level | In an Angular application |
| --------- | ----- | ------------------------- |
| **2.4.11 Focus Not Obscured (Minimum)** | **AA** | A focused element must not be entirely hidden by other content. Sticky headers, sticky footers, cookie banners and toolbars are the cause: tab down a long page and the focused row disappears behind the sticky bar |
| 2.4.12 Focus Not Obscured (Enhanced) | AAA | As above, but not even partially obscured |
| 2.4.13 Focus Appearance | AAA | Minimum size and contrast for the focus indicator itself. At AA the indicator still has to satisfy 1.4.11 non-text contrast |
| **2.5.7 Dragging Movements** | **AA** | Anything draggable needs a single-pointer alternative. A CDK drag-and-drop list, a reorderable table, a slider or a kanban board all need buttons or a menu that achieve the same thing |
| **2.5.8 Target Size (Minimum)** | **AA** | Targets at least 24 by 24 CSS pixels, with exceptions for inline links and spacing. Icon-only buttons and dense table action columns are where this fails |
| **3.2.6 Consistent Help** | **A** | If a help mechanism exists - contact link, chat, help page - it appears in the same relative order on every page that has it. A help link that moves between the header and the footer fails |
| **3.3.7 Redundant Entry** | **A** | Do not ask for the same information twice in one process. Multi-step wizards are the offender: re-entering an address at step four that was given at step one |
| **3.3.8 Accessible Authentication (Minimum)** | **AA** | No cognitive function test as the only way to authenticate. **Blocking paste into a password or one-time-code field fails this**, because it forces the user to transcribe from a password manager |
| 3.3.9 Accessible Authentication (Enhanced) | AAA | As above, without the object-recognition exception |

**Six of the nine are at A or AA**, so those six are the ones an AA claim depends on: 2.4.11, 2.5.7,
2.5.8, 3.2.6, 3.3.7 and 3.3.8.

## One criterion was removed

**4.1.1 Parsing is obsolete and removed in WCAG 2.2.** Effort spent on duplicate-`id` and
malformed-markup findings no longer counts toward a 2.2 claim. axe still ships the affected rules,
tagged `wcag2a-obsolete`, so they will keep reporting unless excluded - see
[automated-testing.md](automated-testing.md). A project still claiming 2.0 or 2.1 must continue to
satisfy it.

## Only one of the six is automatable

Verified against axe-core 4.13.0: the `wcag22aa` tag matches exactly one rule, `target-size`, which is
2.5.8. There is **no rule** for dragging movements, consistent help, or accessible authentication, and
none for 2.4.11.

So the practical consequence of moving a claim from 2.1 AA to 2.2 AA is **five new manual checks**:

- **Focus obscured (2.4.11).** Tab through a long page with every sticky element present. This is a
  keyboard walk, and it takes a minute per layout.
- **Dragging (2.5.7).** For each draggable thing, complete the same task without dragging.
- **Consistent help (3.2.6).** Compare the position of the help affordance across several pages.
- **Redundant entry (3.3.7).** Walk the longest multi-step flow and note anything asked twice.
- **Accessible authentication (3.3.8).** Try to paste a password and a one-time code. Try to complete
  login with a password manager only.

The last one is worth checking first, because it is usually a single line of code causing the failure
and it affects every user of the application.

## Version notes

**Read from the W3C Recommendation.** The criteria and levels above are the 2.2 additions; 2.1's
criteria all carry forward unchanged apart from the removal of 4.1.1.

| Concern | Detail |
| ------- | ------ |
| 2.0, 2.1, 2.2 | Additive apart from the 4.1.1 removal. Conforming to 2.2 AA means conforming to everything in 2.1 AA except 4.1.1, plus the six above |
| Which to claim | For a UK public-facing service 2.2 AA is the current expectation. The Equality Act 2010 duty is on the outcome, not on a version number, so a version claim is evidence rather than a defence |
| Angular version | Irrelevant. None of these criteria is framework-specific, which is exactly why the official Angular skill does not cover them |
| axe | Adds rules over time. Re-run the tag enumeration in [automated-testing.md](automated-testing.md) after an upgrade rather than assuming the coverage is still one rule |

## Gotchas

- Agent moves a claim from 2.1 AA to 2.2 AA and changes nothing it verifies - five of the six new
  criteria have no automated rule
- Agent blocks paste on a password or OTP field, failing 3.3.8, usually for a security reason that is
  not one
- Agent adds a sticky header or a cookie banner and never tabs the page afterwards, so 2.4.11 fails
  silently on every long view
- Agent ships CDK drag-and-drop as the only way to reorder, failing 2.5.7
- Agent sizes icon-only buttons by the icon rather than the target, so a 16px icon becomes a 16px
  target and fails 2.5.8
- Agent moves the help link between header and footer across pages, failing 3.2.6
- Agent re-asks for an address or an email later in a wizard, failing 3.3.7
- Agent spends effort on 4.1.1 Parsing findings for a 2.2 claim - the criterion no longer exists
- Agent treats 2.4.13 Focus Appearance as an AA requirement - it is AAA. The AA obligation on a focus
  indicator comes from 1.4.11
- Agent claims conformance without recording what was tested. The claim is a statement about evidence

## Related

- [automated-testing.md](automated-testing.md) · [route-change-focus.md](route-change-focus.md) · [form-errors.md](form-errors.md) · [colour-and-contrast.md](colour-and-contrast.md)
