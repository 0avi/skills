# Frontend Build in CI

Building an Angular or other npm application in a pipeline. The framework's own guidance covers *how* to build; this file covers what changes when a machine does it repeatedly and something must be promoted afterwards.

| Practice | Apply blind? |
| -------- | ------------ |
| `npm ci`, never `npm install` | **Yes** |
| Commit the lockfile | **Yes** |
| Pin the Node major, with `distribution`-equivalent precision | **Yes** |
| Cache `~/.npm`, never `node_modules` | **Yes** |
| Bundle budgets as a gate | **Yes** - a ceiling, reported below it |
| `--prod` / production configuration in CI | **Yes** |
| Sharding the test suite | Measure first |

---

## `npm ci` against `npm install`

| | `npm ci` | `npm install` |
| --- | -------- | ------------- |
| Reads | **Lockfile only** | `package.json`, may update the lockfile |
| Lockfile | Fails if out of sync | **Rewrites it** |
| `node_modules` | Deletes and recreates | Mutates in place |
| Reproducible | **Yes** | No |

`npm install` in CI can resolve different versions than the lockfile pins, which means the artifact you test is not the one the lockfile describes. Worse, it can rewrite the lockfile inside the job, so the drift is invisible and uncommitted.

**`npm ci` failing is a useful signal**: it means `package.json` and the lockfile disagree, which is a real defect to fix in the repository rather than to work around in the pipeline.

## Caching: the `node_modules` trap

```yaml
- uses: actions/setup-node@<sha>
  with:
    node-version: '24'
    cache: npm                 # caches ~/.npm, keyed on the lockfile
- run: npm ci
```

**Cache `~/.npm` (the download cache) and let `npm ci` install from it.** Do not cache `node_modules`:

- It contains **platform-specific compiled native modules**. Restoring a Linux `node_modules` on a different image, architecture or Node major produces failures that look like application bugs.
- It contains postinstall output that may embed absolute paths.
- `npm ci` deletes it anyway, so the restore is wasted.

This is the most common frontend caching error and it produces the most confusing failures. See [caching.md](caching.md).

## Pin the Node version

```yaml
- uses: actions/setup-node@<sha>
  with:
    node-version: '24'         # a major you chose
```

Do not use `node-version: 'latest'` or rely on whatever the runner image ships, because the runner image rolls. Node majors change bundler behaviour, native module ABI and occasionally output, so an unpinned Node version is an unpinned build.

Add `engines` in `package.json` and `--engine-strict` so a wrong local Node fails loudly rather than producing a subtly different build.

## Bundle budgets as a gate

Bundle size is the frontend equivalent of a performance regression test, and unlike most performance checks it is **deterministic**, which makes it safe to gate on.

```jsonc
// angular.json
"budgets": [
  { "type": "initial", "maximumWarning": "500kB", "maximumError": "600kB" },
  { "type": "anyComponentStyle", "maximumWarning": "4kB" }
]
```

Set the **error** ceiling meaningfully above current size so it catches a step change rather than normal growth, and let the warning report. A budget set exactly at current size blocks the next legitimate feature and gets raised reflexively, which trains everyone to raise it.

Report the delta on the pull request. "Initial bundle grew 180kB" in a comment is more likely to be acted on than a threshold nobody sees until it fires.

## What gets promoted

A frontend build produces **static files**, which changes the promotion story:

| Target | What is promoted |
| ------ | ---------------- |
| Served by a backend | The files, inside the backend's artifact - one deployable |
| CDN or object storage | The **directory of files**, with content-hashed names |
| Container (nginx) | An **image digest**, as everywhere else |
| Cloudflare Workers or Pages | A **version**. See [target-cloudflare-workers.md](target-cloudflare-workers.md) |

**Content-hashed filenames are what make a static deployment safe**, because `main.abc123.js` is immutable and can be cached forever while `index.html` is not cached and points at the current hashes. Deploying `index.html` before the hashed assets it references produces a window of broken loads, so **upload assets first, then the entry point.**

The environment-configuration rule still applies: a bundle with a baked-in API URL is one artifact per environment, which is not promotion. Load configuration at runtime - a fetched config file or a template-substituted placeholder - so one bundle serves every environment. See [environments-and-promotion.md](environments-and-promotion.md).

## Testing

- **Karma is deprecated.** Current Angular projects use Vitest or Jest; a project still on Karma is on borrowed time, and the migration is covered by [`angular-webpack-esbuild-migration`](../../angular-webpack-esbuild-migration/SKILL.md).
- **Headless browser tests need the browser present.** Hosted Linux runners include Chrome; verify rather than assuming, and install Playwright browsers explicitly with `npx playwright install --with-deps`.
- **Playwright browser downloads are large.** Cache them keyed on the Playwright version, or the install dominates the job.
- **End-to-end tests belong after a deploy**, not against a dev server. See [testing-in-ci.md](testing-in-ci.md).

## Version notes

| | Notes |
| --- | ----- |
| Node | **25.8.0** and npm **11.11.0** present on this machine |
| `npm ci` | Requires a lockfile; `lockfileVersion` 3 is current |
| Angular CLI | `ng build` defaults to the production configuration in current majors |
| Karma | Deprecated; Vitest or Jest is current |

- **`node-version: 'lts/*'` still moves**, just more slowly. Pin the major.
- **The runner image's default Node is not stable.** Always use `setup-node`.
- **Not verified here:** no frontend build was executed for this skill. Node and npm are present but were not exercised; cited from tool documentation.

## Gotchas

- Agent uses `npm install` in CI - can resolve versions the lockfile does not pin, and may rewrite the lockfile inside the job
- Agent caches `node_modules` - platform-specific native modules break across images and Node majors, and `npm ci` deletes it anyway
- Agent works around an `npm ci` failure instead of fixing the lockfile - the failure was the useful signal
- Agent relies on the runner image's default Node - the image rolls, so the build is unpinned
- Agent sets a bundle budget at exactly the current size - blocks the next feature and gets raised reflexively
- Agent bakes the API URL into the bundle - one artifact per environment, so nothing is promoted
- Agent deploys `index.html` before the hashed assets it references - a window of broken page loads
- Agent serves content-hashed assets with no caching, or `index.html` with long caching - exactly backwards
- Agent assumes Playwright browsers are present - install them explicitly and cache them by Playwright version
- Agent runs end-to-end tests against a dev server - not the artifact that will be deployed
- Agent leaves a project on Karma - deprecated; plan the migration

## Related

- [caching.md](caching.md) · [testing-in-ci.md](testing-in-ci.md) · [quality-gates.md](quality-gates.md) · [environments-and-promotion.md](environments-and-promotion.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [target-cloudflare-workers.md](target-cloudflare-workers.md) · [`typescript-developer`](../../typescript-developer/SKILL.md) · [`angular-webpack-esbuild-migration`](../../angular-webpack-esbuild-migration/SKILL.md) · [checklist.md](checklist.md)
