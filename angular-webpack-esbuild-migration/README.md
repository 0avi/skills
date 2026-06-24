# angular-esbuild-migration

Agent skill for migrating an Angular project from the **webpack-based builder**
(`@angular-builders/custom-webpack:browser` or
`@angular-devkit/build-angular:browser`) to Angular's native **esbuild
application builder** (`@angular-devkit/build-angular:application`).

It encodes a complete, staged procedure validated on a real production migration
(Angular 19, ~560 TS files, custom webpack config), with a named entry for every
error the stricter esbuild/Angular compiler surfaces. Typical result: **50–70 %
faster production builds** and removal of the webpack + babel + IE-polyfill
dependency tree.

It is written to apply to **any Angular version and any repo state** — single or
multi-project workspaces, and partially migrated repos. The application builder
needs Angular 17+; on 16 it uses `browser-esbuild` as a stepping stone, and below
16 it tells you to upgrade Angular first. See the "Applicability" section in
`SKILL.md`.

## What's inside

```
angular-esbuild-migration/
├── SKILL.md                       # workflow: inventory → baseline → Phase 1 steps
├── references/
│   ├── troubleshooting.md         # T1–T14: symptom → cause → fix
│   ├── checklist.md               # "commonly missed" gate + expected metrics
│   └── cjs-modernization.md       # Phase 2+: CommonJS → ESM
└── scripts/
    ├── audit.mjs                  # read-only inventory of what needs migrating
    └── codemod.mjs                # line-ending-safe mass find/replace
```

The two scripts are dependency-free Node ESM and run from the Angular project
root:

```bash
node path/to/angular-esbuild-migration/scripts/audit.mjs .          # inventory
node path/to/angular-esbuild-migration/scripts/codemod.mjs \        # safe rewrite
  --dir src --ext .ts --from "from 'pkg/src/x'" --to "from 'pkg'" --dry
```

## Installing

Drop the `angular-esbuild-migration/` folder into your skills directory (e.g.
`~/.claude/skills/`), or install the packaged `angular-esbuild-migration.skill`
file. Claude consults it automatically when you ask about moving an Angular build
off webpack/custom-webpack to esbuild.

## Scope

- **Phase 1** (the skill's core): builder swap, config/polyfill/tsconfig changes,
  the optional Karma → Jest builder move, and every compiler error that follows.
- **Phase 2+**: progressive CommonJS → ESM dependency modernization.

Validated end-to-end on Angular 19; written to apply to any Angular version on a
webpack builder (application builder requires 17+; `browser-esbuild` on 16).

## License

MIT — see [LICENSE](./LICENSE).
