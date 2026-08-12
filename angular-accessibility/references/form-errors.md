# Form Errors an Assistive Technology Can Perceive

The official `angular-developer` skill's `reactive-forms.md` and `signal-forms.md` own the forms API:
controls, validators, value updates. **Checked directly: neither mentions `aria-invalid`,
`aria-describedby`, error announcement, error summaries, or focusing the first invalid field.** So a
form built entirely by the book can be correct, validated, and completely unusable without sight.

## The default failure

A red border, a message in a `div` under the field, and a disabled submit button. To a screen reader
user: the border is invisible, the message is unassociated text somewhere on the page, and the submit
button simply stops working with no explanation. Nothing announces, nothing links, nothing moves.

Three associations fix it, and all three are needed:

- **`aria-invalid` on the control** so its state is exposed, not just its colour.
- **`aria-describedby` on the control pointing at the message's `id`** so the message is read as part
  of the field rather than as loose text.
- **A programmatic label**, which the forms references do cover, because `aria-describedby` describes
  a field that must already have a name.

## The Angular-specific trap

The message element usually renders conditionally on `touched` or `dirty`. That means
**`aria-describedby` points at an element that does not exist yet**, and a reference to a missing `id`
is worse than no reference: some assistive technologies announce nothing, and the field looks
described when it is not.

Two ways out, and the first is better:

- Render the message container **always** and populate it conditionally, so the `id` is stable and the
  description is empty rather than dangling.
- Or bind `aria-describedby` conditionally too, so the attribute appears and disappears with the
  element. Correct, and easy to get subtly out of step.

This one is partly checkable in CI: axe's `cat.aria` group includes reference validation, so an
`aria-describedby` pointing at a missing `id` is one of the few things in this file automation will
catch. See [automated-testing.md](automated-testing.md).

## Announcing, without announcing twice

- **Announce on submit, not per keystroke.** A live region that fires on every input event reads
  partial validation state continuously and is worse than silence.
- **Put an error summary at the top of the form** on failed submit: a heading, a count, and a list of
  links to each invalid field. This is the single highest-value addition, because it gives every user
  a route to the problems rather than a hunt.
- **Move focus to the summary, and then do not also announce it.** If focus lands on the summary
  heading, it is read; wrapping it in an `aria-live` region as well produces a double announcement.
  Pick one mechanism per event.
- **Focus the summary or the first invalid field, not both.** The summary is better when there are
  several errors, the field is better when there is one.
- **Use the CDK's `LiveAnnouncer`** for the cases where nothing receives focus, such as an async
  validator resolving or a background save failing. `@angular/cdk/a11y` ships it; the mistake to
  avoid is announcing state the user did not ask about.

## The rest of the form

- **Never mark required with an asterisk alone.** The character may not be announced, and if it is, it
  is read as "star". Use the `required` attribute so the state is exposed, and put the word in the
  label or a legend explaining the convention.
- **Do not disable the submit button while the form is invalid.** A disabled control is removed from
  the tab order, so a keyboard user reaches the end of the form and finds nothing. Leave it enabled,
  let submit fail, and show the summary. This is contested design advice, and it is the accessible
  option.
- **Group related controls in a `fieldset` with a `legend`.** For radios and checkboxes this is what
  supplies the question; without it each option is announced with no context.
- **Do not use `placeholder` as the label.** It disappears on input, it usually fails contrast (see
  [colour-and-contrast.md](colour-and-contrast.md)), and it is not a programmatic name.
- **Autocomplete tokens matter.** `autocomplete-valid` is one of only three `wcag21aa`-tagged axe
  rules, and correct tokens are also what makes 3.3.7 Redundant Entry practical - see
  [wcag22-criteria.md](wcag22-criteria.md).

## Version notes

**The ARIA mechanics are version-agnostic** and unchanged across Angular 19 to 21. What changes is
where the binding goes:

| Concern | Detail |
| ------- | ------- |
| Reactive and template-driven forms | `aria-invalid` and `aria-describedby` are ordinary attribute bindings. Neither forms API supplies them, on any version |
| Signal forms | Newer in the official skill's coverage, and it changes how validity is read, not what has to be exposed. The three associations above are unchanged |
| `@angular/cdk/a11y` | `LiveAnnouncer` and `CdkAriaLive` confirmed present in 21.2.14. Without the CDK, a hand-rolled `aria-live` container is the fallback and needs the same "announce once" discipline |
| WCAG | This page is how 3.3.1 Error Identification, 3.3.3 Error Suggestion and 4.1.3 Status Messages are satisfied. 4.1.3 is the one people miss, because it has no visual symptom at all |

## Gotchas

- Agent shows an error with a red border and no `aria-invalid`, so the state is colour-only
- Agent renders the message conditionally and leaves `aria-describedby` pointing at a missing `id`
- Agent announces validation on every keystroke, producing continuous partial output
- Agent moves focus to the error summary **and** wraps it in `aria-live`, so it is announced twice
- Agent focuses both the summary and the first invalid field, so the summary is skipped
- Agent disables the submit button while invalid, removing it from the tab order and leaving a
  keyboard user with no way to trigger validation
- Agent marks required fields with a bare asterisk and no `required` attribute
- Agent uses `placeholder` as the label
- Agent puts radios or checkboxes in a `div` rather than a `fieldset` with a `legend`
- Agent adds `role="alert"` to a container that is always present, so it announces on first render
  before the user has done anything
- Agent relies on the summary alone and never associates messages with fields, so a user who tabs
  straight into a field hears no error

## Related

- [automated-testing.md](automated-testing.md) · [wcag22-criteria.md](wcag22-criteria.md) · [colour-and-contrast.md](colour-and-contrast.md)
