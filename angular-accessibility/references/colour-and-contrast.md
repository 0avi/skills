# Colour and Contrast

The one part of accessibility that is arithmetic rather than judgement, which makes it the part worth
settling with numbers instead of opinions. It is also the part designers argue about, so having the
computation to hand ends the argument quickly.

Every ratio on this page was computed with the WCAG 2.x relative luminance formula, not read from a
tool.

## The thresholds

| Text | Level AA | Level AAA |
| ---- | -------- | --------- |
| Normal text | **4.5:1** | 7:1 |
| Large text, 18.66px bold or 24px regular and above | **3:1** | 4.5:1 |
| Non-text: UI component boundaries, focus indicators, meaningful graphics | **3:1** (1.4.11) | - |

Non-text contrast is the one that gets missed. A form input whose border is a pale grey against white
fails 1.4.11 even when the text inside it passes 1.4.3, and so does a focus ring that is too light
against the background it sits on.

## Computed, so the margin is visible

```
  pair                      ratio   AA 4.5:1  AA large 3:1  AAA 7:1
  #767676 on #ffffff         4.54     pass          pass     FAIL
  #777777 on #ffffff         4.48     FAIL          pass     FAIL
  #999999 on #ffffff         2.85     FAIL          FAIL     FAIL
  #0d6efd on #ffffff         4.50     pass          pass     FAIL
  #6c757d on #ffffff         4.69     pass          pass     FAIL
  #ffc107 on #ffffff         1.63     FAIL          FAIL     FAIL
  #ffffff on #ffc107         1.63     FAIL          FAIL     FAIL
  #000000 on #ffc107        12.88     pass          pass     pass
```

Four things worth taking from that table:

- **`#767676` passes and `#777777` fails.** One hex digit. This is why "it looks fine" is not an
  argument and why a designer's mid-grey needs checking rather than eyeballing. `#767676` is
  effectively the lightest neutral grey that passes AA on white.
- **`#999999` is a very common placeholder and secondary-text colour, and it fails everything** at
  2.85:1. If placeholder text carries information, that is a defect; if it does not, it should not be
  the only place the information appears.
- **A warning yellow is unreadable with either white or black by the same margin - except it is not.**
  `#ffc107` with white is 1.63:1 and fails; with black it is 12.88:1 and passes comfortably. Amber and
  yellow surfaces need dark text, always, and this is the single most common brand-colour failure.
- **A colour can pass by 0.005.** `#0d6efd` is 4.50:1. Anything that close should be treated as
  failing, because rounding in one tool and truncation in another will disagree, and a hover or
  disabled variant will certainly fall below.

## Never encode meaning in colour alone

WCAG 1.4.1 Use of Colour. In an accountancy interface the usual offenders are:

- A red figure meaning a negative or an overdue amount. Add a minus sign, brackets, or the word.
- A red field border as the only indication of a validation failure. The message and the
  programmatic association are what make it perceivable; see the forms reference when written.
- A status shown only as a coloured dot or chip. Add the word, or a shape difference, not just a hue.
- A required field marked only by a red asterisk with no accessible name for the asterisk.

This is not detectable by any automated rule, because it requires knowing what the colour means.

## Things the ratio does not tell you

- **Opacity changes the effective colour.** `color: #767676` at `opacity: 0.6` is not 4.54:1 any more,
  and neither is grey text over a background image or a gradient. Compute against the colour that is
  actually rendered.
- **Disabled controls are exempt from 1.4.3**, which is not permission to make them invisible. If a
  user cannot read what a disabled button says, they cannot tell why they are stuck.
- **A focus indicator must contrast with the background it appears on**, including the focused
  component's own background. A default browser outline removed and replaced with a pale ring is a
  regression even though the ring exists.
- **Dark mode is a second palette with the same obligation.** Every pair has to be recomputed; a light
  grey that passes on white will not pass on a dark surface, and inverted brand colours rarely do.
- **Large text is defined by rendered size**, so a heading scaled down at a narrow viewport may cross
  from the 3:1 threshold to the 4.5:1 one.

## Version notes

**Version-agnostic and framework-agnostic.** The relative luminance formula and the 4.5:1 and 3:1
thresholds are unchanged from WCAG 2.0 through 2.2, and nothing about an Angular or CDK upgrade
affects them.

| Concern | Detail |
| ------- | ------ |
| WCAG 2.2 | Adds no text-contrast criterion. It adds **2.4.11 Focus Not Obscured (Minimum)** at AA, which is about a focused element being hidden behind sticky headers or overlays rather than about its contrast |
| WCAG 2.2 | **2.4.13 Focus Appearance** is AAA, so a focus indicator has an explicit size and contrast requirement only at AAA. At AA the indicator still has to satisfy 1.4.11 non-text contrast |
| axe | `color-contrast` is one of only three `wcag2aa`-tagged rules, and it cannot evaluate text over an image or a gradient - it reports those as needing review, and a CI job that ignores incomplete results silently drops them |
| APCA | The perceptual algorithm discussed for a future WCAG version is **not** part of 2.2. Conform to the ratio |

## Gotchas

- Agent eyeballs a grey as "probably fine" - `#767676` passes and `#777777` fails
- Agent uses `#999999` for secondary or placeholder text, at 2.85:1
- Agent puts white text on an amber or yellow brand colour - `#ffc107` with white is 1.63:1, with
  black 12.88:1
- Agent accepts a 4.50:1 result as passing without noting there is no margin for hover and disabled
  variants
- Agent computes the ratio for the base colour and ignores `opacity`, a gradient, or a background image
- Agent checks the light palette and never recomputes for dark mode
- Agent removes the default focus outline and replaces it with a ring that does not contrast with the
  component's own background
- Agent treats the disabled-control exemption as licence to make disabled text unreadable
- Agent signals validation failure, negative amounts or status with colour alone
- Agent ignores axe's `incomplete` results, which is where text over images ends up
- Agent reaches for APCA numbers - not part of WCAG 2.2

## Related

- [automated-testing.md](automated-testing.md) · [route-change-focus.md](route-change-focus.md)
