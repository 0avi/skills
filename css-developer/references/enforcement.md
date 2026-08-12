# Enforcement

An architecture nobody checks is a preference. This page is about turning the decisions in the rest
of the skill into something a machine rejects, and it is the half of style management that is almost
always missing.

## Four questions, not one

"Do you lint your CSS?" is four separate questions, and projects routinely answer yes to the first
and no to the rest:

1. Is there a lint **config**?
2. Is the linter an actual **dependency**?
3. Is it wired to a **script** anyone runs?
4. Does **CI fail** when it reports a problem?

A real measurement of what happens when the answer is yes, no, no, no. A project with 38 SCSS files
carried a `.stylelintrc.json` declaring a `px` ban, a hex-colour ban and a 0,2,0 specificity ceiling.
stylelint appeared nowhere in `package.json` and nowhere in the lockfile. Running that project's own
config over that project's own files, with stylelint 17.14.1:

**1,244 problems. All 38 files affected.**

| Count | Rule | What it was |
| ----- | ---- | ----------- |
| 718 | `unit-disallowed-list` | The `px` ban the config declared |
| 123 | `color-no-hex` | The hex ban the config declared |
| 38 | a rule name that no longer exists | See [Stale rule names](#stale-rule-names-fail-loudly-not-quietly) |
| 27 | `selector-max-specificity` | Breaches of the project's own 0,2,0 ceiling |
| 3 | `selector-pseudo-element-no-unknown` | A framework-specific pseudo-element that is not CSS |
| 1 | `color-no-invalid-hex` | `#black`, a colour that does not exist |
| 1 | `custom-property-pattern` | `---token` with three dashes, permanently unreachable |

The last two are the point. **Both were real bugs, both had survived human review, and both were
one-line fixes that the project's existing config would have caught the first time anyone ran it.**
The documentation even instructed contributors to obey a linter that could not run.

So: before advising on rules, check that the tool is installed and wired. A config file is
documentation of intent, and intent does not lint.

## Installing from zero

For plain CSS:

```bash
npm i -D stylelint@17 stylelint-config-standard@40
```

```json
{ "extends": ["stylelint-config-standard"] }
```

For SCSS, add the SCSS config, which brings the `stylelint-scss` plugin and the SCSS parser with it:

```bash
npm i -D stylelint@17 stylelint-config-standard-scss@17
```

```json
{ "extends": ["stylelint-config-standard-scss"] }
```

Then wire it, because this is the step that gets skipped:

```json
{ "scripts": { "lint:css": "stylelint \"src/**/*.{css,scss}\"", "lint:css:fix": "stylelint \"src/**/*.{css,scss}\" --fix" } }
```

And make CI run `lint:css`. A lint script that only a developer runs locally is question three
answered without question four.

**Indented `.sass` is the weakest case.** stylelint needs a custom syntax to parse it, and the
available one, `postcss-sass`, was last published in June 2022. If enforcement matters to you and you
have a free choice, that is a concrete argument for SCSS over indented Sass. See
[preprocessor-or-not.md](preprocessor-or-not.md).

## What the standard configs actually give you

Measured, so you know where the floor is rather than guessing:

| Config | Own rules | Inherits |
| ------ | --------- | -------- |
| `stylelint-config-recommended` 18.0.0 | 41 | nothing |
| `stylelint-config-standard` 40.0.0 | 41 | recommended, so **82 total** |
| `stylelint-config-recommended-scss` | 34 | recommended |
| `stylelint-config-standard-scss` 17.0.0 | 22 | standard and recommended-scss |

stylelint 17.14.1 ships **149 built-in rules**, so the standard config turns on roughly half. What it
gives you for free is worth knowing, because several of these catch the traps documented elsewhere in
this skill:

- `no-invalid-position-at-import-rule` catches an `@import` placed after a style rule, which is
  otherwise dropped silently. See [cascade-and-layers.md](cascade-and-layers.md).
- `custom-property-no-missing-var-function`, `declaration-block-no-duplicate-custom-properties` and
  `custom-property-pattern` cover part of the token failure surface.
- `layer-name-pattern` enforces a naming convention on layers.
- `no-descending-specificity`, `selector-pseudo-element-no-unknown`, `property-no-unknown`,
  `declaration-property-value-no-unknown`, `at-rule-no-deprecated`.

**One important gap, measured:** `color-no-invalid-hex` is enabled by
`stylelint-config-recommended-scss` but **not** by `stylelint-config-standard`. So a plain-CSS
project on the standard config **does not catch `#black`**. Enable it explicitly.

## The rules worth adding, in priority order

None of these are on by default. Each maps to a decision made elsewhere in this skill.

| Rule | Setting | Catches |
| ---- | ------- | ------- |
| `no-unknown-custom-properties` | `true` | **A `var()` referring to a token that is never defined.** The single highest-value addition. Measured: it flags both `var(--typo)` and the consumer side of a mistyped definition |
| `color-no-invalid-hex` | `true` | `#black` and friends, if you are on plain CSS |
| `selector-max-specificity` | e.g. `"0,3,0"` | Selectors escalating to win fights. Set it to what your architecture allows, not to an aspiration |
| `declaration-no-important` | `true` | Every `!important`. Once you have layers this should be achievable, with a narrow allowance for a reduced-motion block |
| `unit-disallowed-list` | e.g. `["px"]` | A rem-only policy, if you have one. Expect a large initial count |
| `color-no-hex` | `true` | Literals in components, forcing everything through tokens |
| `max-nesting-depth` | `2` or `3` | Preprocessor nesting that quietly manufactures specificity |
| `custom-property-pattern` | a kebab-case regex | The triple-dash token, and inconsistent naming |
| `selector-class-pattern` | a regex for your convention | BEM or whatever you chose, actually enforced |
| `selector-max-id` | `0` | IDs used for styling |

Turn them on one at a time in an existing project. Enabling five at once on a codebase like the one
measured above produces a thousand errors and the branch gets abandoned.

## What stylelint cannot do

Be honest about the boundary, because the most important rule in this skill is not enforceable by the
linter.

**There is no rule requiring a declaration to live inside a `@layer`.** Checked against all 149
built-in rules: the only layer-related rule is `layer-name-pattern`, which validates layer *names*.
Since unlayered styles beat every layer, the one thing you most want checked is the thing stylelint
will not check.

Until a rule exists, enforce it structurally rather than by lint:

- One entry file owns the `@layer` statement and every `@import`. Nothing else imports anything.
- A CI grep is crude but works: fail if any file under your style directory contains a top-level
  selector outside a layer. It is imperfect on nested syntax, and imperfect beats absent.
- Review rule: a new stylesheet that does not open with `@layer` does not merge.

## Stale rule names fail loudly, not quietly

The 38-count row above was the most instructive finding. The project's config contained:

```json
{ "rules": { "scss/at-import-no-partial-leading-underscore": null } }
```

That rule **no longer exists**. `stylelint-scss` 7.2.0 ships 72 rules, and this one was renamed to
`load-no-partial-leading-underscore` when Sass moved from `@import` to the load rules. The result was
not a silent no-op:

```
styles.scss:1  [error]  Unknown rule scss/at-import-no-partial-leading-underscore.
```

**Once per file, 38 errors, and setting the rule to `null` did not suppress it.** Two consequences:
after any linter or plugin upgrade, run it once and read the errors rather than only the count; and a
config disabling a rule you have never seen fire is worth checking against the current rule list.

## Specificity as a measurable property

The specificity graph, Harry Roberts' idea, plots every selector's specificity against its position in
the concatenated output. A healthy sheet trends upward: low-specificity resets and elements first,
components later. Sawtooth spikes mean a rule was written to beat something above it, which is the
signature of the problem layers solve.

You do not need a tool to benefit from the idea. `selector-max-specificity` set to your architecture's
ceiling gives you the same discipline as a hard failure rather than a chart, and the 27 breaches found
above were all real design problems. Two of them were malformed selectors that no human had noticed.

## Dead CSS, honestly

Finding unused CSS is genuinely unsolved for any application with dynamic class names, conditional
rendering or class strings built at runtime. Coverage tooling tells you what was not used *on the
pages you visited*, which is not the same as unused. Treat every report as a candidate list requiring
human confirmation, never as a delete list.

This is the strongest practical argument for utility-first styling, which cannot accumulate dead CSS
by construction, and it is worth stating plainly rather than pretending the two methods are equal on
this axis. See [utility-vs-semantic.md](utility-vs-semantic.md).

## Other tools

- **oxlint 1.78.0 does not lint CSS.** Measured: given a `.css` file it reports "No files found to
  lint". If a project uses the oxc toolchain for JavaScript, its CSS is unchecked unless stylelint is
  added separately.
- **Biome 2.5.8**: I could not execute it in the environment where this was verified, so **this skill
  makes no claim about its CSS linting**. Check its current documentation before choosing it, and do
  not assume parity with stylelint's rule count.
- **Lightning CSS 1.33.0** and **PostCSS 8.5.26** transform rather than lint. Useful for downlevelling
  to an older floor; not a substitute for a linter.
- **Formatting is not linting.** A formatter makes the file consistent and has no opinion about
  specificity, tokens or layers. A project with a formatter and no linter has answered a different
  question.

## Version notes

Everything above was measured with **stylelint 17.14.1**, `stylelint-config-standard` 40.0.0,
`stylelint-config-recommended` 18.0.0, `stylelint-config-standard-scss` 17.0.0 and `stylelint-scss`
7.2.0.

| Concern | Detail |
| ------- | ------ |
| Rule counts | Move between minor versions. Re-enumerate rather than trusting a remembered number, exactly as the stale-name failure above demonstrates |
| stylelint major upgrades | Have historically removed all stylistic rules in favour of formatters. If a config still sets those, expect unknown-rule errors |
| `stylelint-scss` | Rules renamed from `at-import-*` to `load-*` in step with Sass deprecating `@import` |
| `no-unknown-custom-properties` | Only sees properties defined in the files it lints. Tokens injected at runtime or defined in an unlinted file produce false positives |

## Gotchas

- Agent writes a lint config and never checks that the linter is installed, scripted and in CI
- Agent reports a clean lint run as evidence of quality when the run linted nothing
- Agent enables ten rules at once on a legacy codebase, produces a thousand errors, and the work is
  abandoned
- Agent sets `selector-max-specificity` to an aspiration rather than to what the architecture allows,
  so the rule is disabled within a week
- Agent assumes `stylelint-config-standard` catches invalid hex colours. It does not; only the SCSS
  config enables that rule
- Agent assumes a rule exists to require styles be inside a layer. None does
- Agent disables a rule by name without checking the name is still valid, and gets one hard error per
  file rather than a silent no-op
- Agent treats a coverage-based unused-CSS report as a delete list
- Agent adds a formatter and reports that linting is now handled
- Agent assumes the JavaScript linter covers CSS. oxlint does not, measured
- Agent lints only `src` and misses the global style directory, which is where the highest-impact
  rules live

## Related

- [cascade-and-layers.md](cascade-and-layers.md) · [architecture.md](architecture.md) · [tokens-and-theming.md](tokens-and-theming.md) · [preprocessor-or-not.md](preprocessor-or-not.md) · [checklist.md](checklist.md)
