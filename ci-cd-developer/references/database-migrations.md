# Database Migrations

Where most teams actually break production. Not because migrations are hard, but because **a deployment is reversible and a migration is not**, and pipelines are usually designed as though both were.

This file owns migrations as a *delivery* concern: when they run, what gates them, and how they constrain deployment strategy. Schema design, indexing and locking behaviour belong to [`postgresql-developer`](../../postgresql-developer/SKILL.md).

| Question | Answer |
| -------- | ------ |
| Where does a migration run? | **Its own pipeline step, before the new code is serving traffic**, never from application startup |
| What makes a deploy reversible? | The migration being **backwards compatible** with the currently running code |
| How do I make a breaking change? | **Expand, deploy, migrate data, deploy again, contract.** Never in one release |
| Can I roll back a migration? | Sometimes, and never assume it. Design so you do not need to |
| What about zero-downtime? | It is a property of the *schema change*, not of the deployment tool |

---

## The rule that prevents almost every incident

**Every migration must leave the schema working for the code that is currently running, as well as the code about to run.**

That is forced on you by every zero-downtime deployment strategy, because all of them run two versions of the application simultaneously - a rolling update, a canary, a blue-green cutover with connection draining, a Cloudflare gradual deployment, a Cloudflare Containers rollout. During that window the old code and the new code both talk to one database.

So `ALTER TABLE ... DROP COLUMN` in the same release that stops using the column will break the old instances still serving traffic. The column has to go in a **later** release.

## Expand and contract

The pattern, which takes at least two deployments by construction:

| Step | Deploy | Schema action | Code state |
| ---- | ------ | ------------- | ---------- |
| 1 | Deploy A | **Expand**: add the new column, nullable, no constraint | Writes both old and new; reads old |
| 2 | - | Backfill existing rows | unchanged |
| 3 | Deploy B | Add the constraint once data is valid | Reads new; still writes both |
| 4 | Deploy C | **Contract**: drop the old column | Uses new only |
| | | | |

Renaming a column is the canonical worked example, and it is **never** `ALTER TABLE ... RENAME COLUMN` in a live system:

```sql
-- deploy A: expand
ALTER TABLE invoice ADD COLUMN total_pence bigint;          -- nullable

-- code A writes both columns, reads total_pounds

-- backfill, in batches, outside the deploy
UPDATE invoice SET total_pence = (total_pounds * 100)::bigint
 WHERE total_pence IS NULL AND id BETWEEN ? AND ?;

-- deploy B: code reads total_pence, still writes both
ALTER TABLE invoice ALTER COLUMN total_pence SET NOT NULL;

-- deploy C: contract
ALTER TABLE invoice DROP COLUMN total_pounds;
```

Four steps to rename a column feels absurd until the first time a one-step rename takes an application down mid-deploy.

**The two-deploy rule, stated plainly:** any schema change that removes or narrows something requires at least two deployments, separated by enough time to be confident the earlier one is stable.

## Where the migration step goes

```
build ──> test ──> deploy to env ──┬── 1. run migrations   (expand-only)
                                    └── 2. roll out new code
```

Migrations run **before** the new code takes traffic, and because they are expand-only they are safe for the code already running.

**Never migrate from application startup.** It looks convenient and fails in four ways: N instances race to migrate concurrently; a rollout that starts M new pods runs M migration attempts; a failed migration turns into a crash loop rather than a failed pipeline step; and the application needs DDL privileges permanently, which is a standing risk. Use a dedicated step with its own credentials.

### Gating in a pipeline

```yaml
- name: Validate migrations
  run: flyway validate            # checksums match what was applied
- name: Show pending
  run: flyway info                # what is about to run, in the log
- name: Migrate
  run: flyway migrate
- name: Roll out
  run: kubectl set image ...
```

Three gates worth having:

1. **Checksum validation** on every environment. Flyway's `validate` catches an edited migration file, which is the most common way environments silently diverge.
2. **A destructive-statement check on pull requests.** Grep the diff for `DROP`, `TRUNCATE`, `ALTER COLUMN ... TYPE`, `NOT NULL` additions and `RENAME`, and require an explicit acknowledgement label. Cheap, and it catches the one-step rename before review fatigue does not.
3. **Migration-only dry run against a restored production copy** for anything large. A migration that is instant on an empty test database can lock a large table for minutes.

## Rollback, honestly

| Change | Reversible? |
| ------ | ----------- |
| Add a nullable column | Yes, trivially |
| Add an index | Yes |
| Add a constraint | Yes, but re-adding may be slow |
| Backfill data | **No.** The previous values are gone unless you kept them |
| Drop a column | **No.** The data is gone |
| Change a column type | **Usually no.** Lossy in one direction |

Down-migrations are worth writing for the reversible cases and are a **fiction** for the rest. A `down` script that drops the column it added is fine; a `down` script claiming to reverse a backfill is a lie that will be trusted at 3am.

So the operating position is **roll forward**. Keep changes small enough that fixing forward is fast, and keep the schema backwards compatible so the *code* can roll back freely even when the schema cannot. That asymmetry is the whole point of expand and contract: it makes the risky component reversible by keeping the irreversible one compatible. See [rollback.md](rollback.md).

## Interaction with each deployment strategy

| Strategy | Migration constraint |
| -------- | -------------------- |
| **Rolling** | Two versions run for the whole rollout. Expand-only, always |
| **Canary** | Same, and for longer. Expand-only, and the canary must not write data the old version cannot read |
| **Blue-green** | Both environments usually share one database, so this is **not** the escape hatch people expect. Expand-only still required |
| **Recreate** (downtime) | The only case where a one-step breaking change is safe, and it costs an outage |
| **Cloudflare gradual deployment** | Two Worker versions serve simultaneously. Expand-only |
| **Cloudflare Containers rollout** | New Worker code meets old instances during the 10%/90% rollout. Expand-only, and the same discipline applies to the Worker-to-container interface |

**Blue-green does not solve migrations.** Two application environments in front of one database is still two code versions against one schema.

## Version notes

| Tool | Notes |
| ---- | ----- |
| **Flyway** | Versioned SQL files with a checksum table. `validate`, `info`, `migrate`. The default for Spring Boot |
| **Liquibase** | XML/YAML/SQL changelogs, with rollback support declared per changeset |
| **Alembic, EF Core, ActiveRecord** | Same shape, framework-specific |

- **`flyway validate` is the highest-value command** and the most skipped. Run it in every environment before migrating.
- **Baselining an existing database** is a one-time operation that must be done deliberately; getting it wrong makes the first migration destructive.
- **Postgres specifics** - which DDL takes which lock, `CREATE INDEX CONCURRENTLY`, adding a `NOT NULL` column with a default - belong to [`postgresql-developer`](../../postgresql-developer/SKILL.md). This file does not restate them.
- **Not verified here:** no migration was executed for this skill. The pattern is standard and the tool commands are cited from their documentation.

## Gotchas

- Agent writes a one-step `RENAME COLUMN` or `DROP COLUMN` - breaks every instance still running the old code during the rollout
- Agent runs migrations from application startup - concurrent racing instances, crash loops instead of pipeline failures, and permanent DDL privileges
- Agent assumes blue-green avoids the problem - both environments share the database, so two code versions still meet one schema
- Agent writes a `down` migration that claims to reverse a backfill - the old values are gone; this is a lie that gets trusted during an incident
- Agent plans to "roll back the migration" as an incident response - design to roll forward, and keep the schema compatible so the code can roll back
- Agent tests a migration only against an empty database - locking and duration are functions of table size; test against a production-sized copy
- Agent skips `flyway validate` - an edited migration file then diverges environments silently
- Agent adds a `NOT NULL` column with no default in one step - fails or locks, depending on engine and version
- Agent puts the migration step after the code rollout - the new code hits the old schema for the duration
- Agent backfills millions of rows inside the migration step - a long-running transaction and a blocked pipeline; batch it outside the deploy
- Agent gives the application's runtime credentials DDL rights so startup migration works - a standing privilege that should belong only to the migration step

## Related

- [rollback.md](rollback.md) · [deployment-strategies.md](deployment-strategies.md) · [environments-and-promotion.md](environments-and-promotion.md) · [pipeline-design.md](pipeline-design.md) · [target-kubernetes.md](target-kubernetes.md) · [target-cloudflare-workers.md](target-cloudflare-workers.md) · [target-cloudflare-containers.md](target-cloudflare-containers.md) · [`postgresql-developer`](../../postgresql-developer/SKILL.md) · [checklist.md](checklist.md)
