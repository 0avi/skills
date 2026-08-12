# Utility Classes Versus Semantic Classes

This skill takes no side. It is uncompromising about the boundary, because the failure mode in real
projects is not either method, it is running both with no rule about which wins.

## The two methods

The same button. **Utility-first**, where the design decisions live in the markup and there is no
stylesheet for this component:

```html
<button class="rounded-md bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent-dim">
  Start
</button>
```

**Semantic**, where the markup names a thing and the stylesheet says what it looks like:

```html
<button class="btn btn--primary">Start</button>
```
```css
@layer components {
  .btn { padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); font-weight: 600; }
  .btn--primary { background: var(--color-accent); color: var(--color-on-accent); }
}
```

## The honest trade

| | Utility-first | Semantic |
| --- | ------------- | -------- |
| Naming | No naming problem, which removes an entire category of argument | You must invent and police names |
| Dead code | **Cannot accumulate.** Unused utilities are never generated | Accumulates invisibly, and nobody dares delete it |
| Changing every button | Find and replace across templates, or extract a component | One edit |
| Reading a template | Verbose, but what renders is fully visible | Concise, but you must open another file to know anything |
| Reviewing a change | Diff shows the visual change directly | Diff shows a class name; the visual effect is elsewhere |
| Where a designer's change lands | Many templates | One rule |
| Onboarding | Learn a utility vocabulary once, then nothing per project | Learn this project's names, every project |

Two rows deserve emphasis because they are usually asserted rather than argued.

**Dead code is a genuine asymmetry, not a matter of taste.** Finding unused CSS is unsolved for any
application with conditional rendering or runtime-built class strings. Utility-first sidesteps the
problem by construction. Semantic CSS does not, and no tool reliably fixes it. See
[enforcement.md](enforcement.md).

**"Utility classes are ugly" is not an argument, and neither is "semantic classes are cleaner".** Both
are about reading preference, both are real, and neither predicts maintainability.

## The five boundary rules

These are the opinionated part, and they apply whichever method you chose.

### 1. One method is the project default, and the choice is written down

In a README, a CLAUDE.md, or a comment at the top of the entry stylesheet. The other method needs a
stated reason per use. A project where the answer is "it depends who wrote it" has no method, and every
subsequent rule here is unenforceable.

### 2. Tokens are the shared layer

This is the rule that does the real work, because it makes the choice matter far less than the
argument suggests. Both methods consume the **same** custom properties:

```css
/* one definition */
:root { --color-accent: oklch(60% 0.15 250); }

/* semantic consumes it */
.btn--primary { background: var(--color-accent); }

/* the utility framework's config consumes the same token, not a copy of the value */
/* so bg-accent and .btn--primary can never drift */
```

Configure your utility framework to read your tokens rather than to hold its own palette. Then a
rebrand is one edit under either method, and a project that mixes both stays visually coherent even
while its class strategy is inconsistent.

The anti-pattern is a utility framework holding one palette while the stylesheet holds another. They
will diverge, and the divergence will be invisible until someone screenshots two pages side by side.

### 3. Utilities go in the last layer, and never override a component class

```css
@layer reset, tokens, base, layout, components, utilities;
```

With utilities last, a utility at 0,1,0 beats a component at 0,3,0 with **no `!important`**, measured.
That is the mechanism. The discipline is separate: **if a component needs a utility to look right, the
component is wrong.**

The exception that is not an exception: **spacing between components belongs to the parent, not to the
component.** `<div class="card mt-4">` is not a utility overriding a component; it is the parent
laying out its children, and it is correct. A card should not know what sits above it. See
[architecture.md](architecture.md).

### 4. A semantic class earns its existence

It qualifies if it **recurs**, has **states**, or is **themed**. One-off arrangement is utilities or a
layout primitive. A class named `.dashboard-header-title-wrapper` used once is a name invented to
avoid writing three declarations, and it will outlive the markup it was made for.

### 5. Conflicts are settled by layer order, once, never by `!important`

If a utility loses to a component, the layer order is wrong, and it is wrong for the whole project
rather than for this element. Fix it in the `@layer` statement, not at the call site. See
[cascade-and-layers.md](cascade-and-layers.md).

This matters more than it sounds, because `!important` **reverses** layer order, so the first
`!important` in a layered project quietly makes precedence positional in a way nobody expects.

## Choosing, if you must choose

If there are no constraints and someone insists on a recommendation: **utility-first suits product
teams shipping many one-off screens, semantic suits a small number of heavily reused, heavily themed
components.** A design-system package that other people consume should be semantic, because its
consumers cannot be required to adopt your utility framework.

That is a weak preference, and it should lose to any of: the team already knows one, the framework
already ships one, or a designer already works in one.

## Version notes

Nothing here depends on a CSS version except rule 3, which needs cascade layers, **widely available
since 2024-09-14**.

| Concern | Detail |
| ------- | ------ |
| Utility frameworks | Change their configuration format between majors, including where the token bridge in rule 2 is declared. Check the current documentation rather than assuming the previous major's shape |
| Older utility frameworks | Generated `!important` on utilities by default, because layers did not exist. If yours still does, that is now switchable and should be switched |
| Native nesting | Widely available 2026-06-11. Makes semantic components tidier without a preprocessor, which slightly narrows the tooling argument for utility-first |

## Gotchas

- Agent mixes both methods on one element with no rule about which wins, then reaches for `!important`
  when the result is wrong
- Agent lets the utility framework hold its own palette alongside the project's tokens, so the two
  drift invisibly
- Agent puts utilities in an early layer, so they lose to components, and concludes utilities need
  `!important`
- Agent treats `mt-4` on a component as a violation of rule 3. Spacing between components belongs to
  the parent
- Agent invents a semantic class for a single-use arrangement, adding a name nobody will dare delete
- Agent extracts a component the first time two elements look similar, before the pattern is real
- Agent argues the two methods are equivalent on dead code. They are not
- Agent changes a project's method halfway through a codebase, leaving two conventions and no rule
- Agent recommends a method without asking what the team and the framework already use

## Related

- [cascade-and-layers.md](cascade-and-layers.md) · [architecture.md](architecture.md) · [tokens-and-theming.md](tokens-and-theming.md) · [enforcement.md](enforcement.md)
