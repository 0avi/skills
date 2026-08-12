---
name: css-developer
description: Organises, writes and maintains the style layer of a web project, independent of any framework or component library. Trigger when choosing between plain CSS, SCSS and Sass or asking what the difference is, when a utility framework such as Tailwind sits alongside a preprocessor, when a stylesheet has grown unmanageable, when specificity fights or important declarations are spreading, when a third-party stylesheet must be overridden, when design tokens or theming must be set up or repaired, when deciding between utility classes and semantic classes, when a style rule mysteriously does not apply, when a browser support floor must be established, or when style linting must be introduced to a project that has none. Covers plain CSS, SCSS and indented Sass, and recommends which to pick. Deliberately takes no position on which UI or component library you use.
license: MIT
metadata:
  author: Avinay Basnet
  version: '1.0'
---

# Organising, Writing and Managing CSS

CSS does not become unmaintainable because people write bad declarations. It becomes
unmaintainable because **nobody decided where a declaration goes, and nothing checks**. Every
symptom that gets blamed on the language - specificity wars, `!important` creep, dead rules nobody
dares delete, a theme that half works - is a consequence of those two omissions.

This skill is about the decisions and the enforcement. It is framework-agnostic and library-agnostic
on purpose: which component library you use is your choice, and none of the guidance here changes
based on it.

1. **Establish the setup before giving any advice.** Preprocessor, styling method, whether a token
   layer exists, whether anything lints, and what the browser floor is. Five answers, and they
   change the advice completely. See [Reading an unfamiliar style layer](#reading-an-unfamiliar-style-layer).

2. **Cascade layers are the spine.** One `@layer` statement near the top of one file declares the
   whole architecture, and layer order then beats specificity. Measured on Chromium 151, Firefox 153
   and WebKit 26.5: a selector at specificity **0,1,0 in a later layer beats 1,3,0 in an earlier
   one**. Widely available since 2024-09-14. See [cascade-and-layers.md](references/cascade-and-layers.md).

3. **Two facts about the cascade override intuition, and both cost real time.** First, **unlayered
   normal declarations beat every layer**, regardless of source order, so one unlayered file
   silently outranks the entire system. Second, **`!important` reverses layer order**, so the
   *first* layer wins. `!important` is therefore not a tool but a report that a layer is missing,
   and anyone using it to settle a conflict has made that conflict positional without realising.

4. **Tokens have tiers, and a component may not read the bottom one.** Primitive, semantic,
   component. A component reads semantic or component tokens, never a raw primitive, because
   re-theming means re-pointing the middle tier. Separately: anything you may ever want to change at
   runtime must be a custom property, not a preprocessor variable. See
   [tokens-and-theming.md](references/tokens-and-theming.md).

5. **Two tooling choices, both deliberate and both written down.** **Method:** utility-first or
   semantic classes. The skill takes no side, and is uncompromising about the five boundary rules,
   because the failure in real projects is not either method but mixing them with no rule about
   which wins. **Language:** default to plain CSS, and reach for SCSS only to generate rules from
   data. Nesting, variables and colour manipulation are why people installed Sass and all three are
   now native, with custom properties and `oklch()` being **better** than the Sass equivalents
   rather than merely equal. "SCSS versus Sass" is not a feature comparison; they are two syntaxes
   for one language. **If you use Tailwind, use plain CSS**, because the two toolchains do not
   compose: Sass hard errors on a Tailwind entry file, and Tailwind 4.3.3 will accept a `.scss`
   file, report success, and emit the Sass syntax verbatim as invalid CSS. See
   [utility-vs-semantic.md](references/utility-vs-semantic.md) and
   [preprocessor-or-not.md](references/preprocessor-or-not.md).

6. **A lint config that is not installed is a comment.** Verified on a real project: 38 SCSS files,
   a `.stylelintrc.json` present, stylelint absent from `package.json` and from the lockfile, and
   **1,244 problems** waiting the moment it was actually run, including two silent bugs that had
   survived review. See [enforcement.md](references/enforcement.md).

7. **State the browser floor from data, not from memory.** Support moves, and guidance written
   eighteen months ago is now wrong in both directions. Native nesting and `:has()` only became
   widely available in June 2026; `@scope` still is not. See
   [modern-css-floors.md](references/modern-css-floors.md).

Every reference carries a **`## Version notes`** section stating what depends on which version, and
a **`## Gotchas`** list of the specific mistakes agents make in that area. Read the gotchas even
when skimming. Where a claim is measurable it has been measured: the cascade rules are computed
output from three browser engines, the support dates come from the `web-features` dataset, and the
lint counts come from running the linter.

## Reading an unfamiliar style layer

**Step 1. The preprocessor.** Look for `.css`, `.scss` or `.sass` files, and check the build config
for a preprocessor option. If it is Sass, check whether the code uses `@use` or the deprecated
`@import`, because that single answer determines whether load order is predictable. **If a utility
framework is also present, check whether any single file is both a preprocessor file and the
framework's entry point**, which is a silent breakage rather than an error. See
[preprocessor-or-not.md](references/preprocessor-or-not.md).

**Step 2. The method.** Read one component's markup. Long strings of single-purpose classes mean
utility-first. Short names describing the thing mean semantic. **Both in the same element means the
project has no rule**, and that is the first thing to fix.

**Step 3. The token layer.** Search for custom property definitions. Then check whether components
reference them or hardcode values, and whether the tokens have tiers or are one flat list of
literals. A flat list is not a failure, but it caps what theming can ever do.

**Step 4. Enforcement.** Is there a lint config? Is the linter actually a dependency? Is it wired
into a script and into CI? Those are four separate questions and projects routinely answer yes to
the first and no to the rest.

**Step 5. The floor.** What browsers are supported, and is that written down anywhere or merely
assumed? Without it, every feature decision is a guess.

## Topics

- **The cascade and layers**: how the cascade actually resolves, measured across three engines, and
  how to use `@layer` as the architecture rather than as a trick. Includes layering a third-party
  stylesheet you cannot edit. Read [cascade-and-layers.md](references/cascade-and-layers.md)
- **Architecture**: where a declaration goes. The established methodologies compared with a verdict,
  mapped onto layers, plus entry points, what must never emit CSS, and naming. Read
  [architecture.md](references/architecture.md)
- **Tokens and theming**: the three tiers, the runtime versus compile-time split that decides what
  can ever be themed, theming mechanisms, user preference queries, and the ways a token dies
  silently. Read [tokens-and-theming.md](references/tokens-and-theming.md)
- **Plain CSS, SCSS or Sass, and which to pick**: what the three actually are, the same component
  written three ways, a straight recommendation with a decision table, why a utility framework such
  as Tailwind changes the answer, how to run Sass alongside Tailwind if you already have both, the
  `@use` migration and its removal date, and the load-order trap. Read
  [preprocessor-or-not.md](references/preprocessor-or-not.md)
- **Utility classes versus semantic classes**: the honest trade, and the five boundary rules that
  make the choice matter far less than the argument suggests. Read
  [utility-vs-semantic.md](references/utility-vs-semantic.md)
- **Support floors**: the computed availability table, how to choose a floor, and how to use
  `@supports` without cargo-culting it. Read [modern-css-floors.md](references/modern-css-floors.md)
- **Responsive and layout**: container queries as the default, logical properties, intrinsic sizing,
  and fluid type. Verdicts and mechanisms, not a catalogue of layouts. Read
  [responsive-and-layout.md](references/responsive-and-layout.md)
- **Enforcement**: introducing a linter to a project with none, the rules that catch real bugs, the
  stale-rule-name hazard, specificity graphs, finding dead CSS, and wiring it into CI. Read
  [enforcement.md](references/enforcement.md)

## Symptom index

| Symptom | Read |
| ------- | ---- |
| A rule is clearly more specific and still does not apply | [cascade-and-layers.md](references/cascade-and-layers.md) |
| `!important` is spreading and each one fixes something | [cascade-and-layers.md](references/cascade-and-layers.md) |
| A third-party stylesheet must be overridden and cannot be edited | [cascade-and-layers.md](references/cascade-and-layers.md) |
| Adding `!important` made things worse instead of better | [cascade-and-layers.md](references/cascade-and-layers.md) |
| Nobody can say which file a new rule belongs in | [architecture.md](references/architecture.md) |
| Whether the 7-1 pattern, ITCSS, BEM or CUBE CSS is the one to use | [architecture.md](references/architecture.md) |
| Selectors keep getting longer to win | [architecture.md](references/architecture.md) |
| A colour changed in one place and not another | [tokens-and-theming.md](references/tokens-and-theming.md) |
| Dark mode works except for the parts that do not | [tokens-and-theming.md](references/tokens-and-theming.md) |
| A custom property is set and appears to do nothing | [tokens-and-theming.md](references/tokens-and-theming.md) |
| Colours can be themed but spacing cannot | [tokens-and-theming.md](references/tokens-and-theming.md) |
| Animations run for people who asked for less motion | [tokens-and-theming.md](references/tokens-and-theming.md) |
| Which of CSS, SCSS or Sass to use on a new project | [preprocessor-or-not.md](references/preprocessor-or-not.md) |
| What the difference between SCSS and Sass even is | [preprocessor-or-not.md](references/preprocessor-or-not.md) |
| Whether Sass is still worth having | [preprocessor-or-not.md](references/preprocessor-or-not.md) |
| Tailwind and Sass are both present and styles are silently missing | [preprocessor-or-not.md](references/preprocessor-or-not.md) |
| A declaration is in the built CSS and the browser ignores it | [preprocessor-or-not.md](references/preprocessor-or-not.md) |
| Styles load in a different order than the source suggests | [preprocessor-or-not.md](references/preprocessor-or-not.md) |
| Utility classes and component classes are fighting | [utility-vs-semantic.md](references/utility-vs-semantic.md) |
| Templates carry so many classes they cannot be read | [utility-vs-semantic.md](references/utility-vs-semantic.md) |
| Is this feature safe to use yet | [modern-css-floors.md](references/modern-css-floors.md) |
| A layout breaks when the component is reused somewhere narrower | [responsive-and-layout.md](references/responsive-and-layout.md) |
| Breakpoints have multiplied and nobody knows which apply | [responsive-and-layout.md](references/responsive-and-layout.md) |
| The lint job has never failed | [enforcement.md](references/enforcement.md) |
| Nobody will delete any CSS because nobody knows what is used | [enforcement.md](references/enforcement.md) |

## Checklist

- **Style layer review checklist**: rules for a review pass over an existing project, the most
  damaging first, each linked to its reference. Read [checklist.md](references/checklist.md)
