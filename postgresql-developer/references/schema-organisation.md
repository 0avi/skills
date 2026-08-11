# Schema Organisation

A PostgreSQL **cluster** contains databases; a **database** contains schemas; a **schema** contains tables, views, functions and types. Choosing the level at which to divide a system is an architecture decision with consequences that are hard to reverse.

## Database or schema

The decision turns on one hard limit:

**A connection is bound to exactly one database. A single query, and a single transaction, can never span two databases.** This is not a performance characteristic that can be tuned around; it is architectural. `dblink` and `postgres_fdw` can read across databases but give you no atomicity.

| | Same database, different schemas | Different databases |
|---|---|---|
| Cross-boundary query | Yes, plain SQL | No |
| Cross-boundary transaction | Yes | Never |
| Cross-boundary foreign key | Yes | No |
| Shared roles | Yes, roles are cluster-wide | Yes, roles are cluster-wide |
| Shared extensions | No, installed per database | No |
| Connection pooling | One pool | One pool per database |
| Isolation of a bad query | Weak | Strong |
| `pg_dump` granularity | Per schema or whole database | Per database |

**Default to one database with several schemas.** Reach for separate databases only when you want the isolation badly enough to give up joins and transactions permanently: genuinely unrelated applications, or a per-tenant physical separation requirement. See [multi-tenancy.md](multi-tenancy.md).

## Dividing into schemas

Divide by **bounded context**, not by technical layer:

```
billing.invoices        good - a domain
identity.users          good - a domain
catalogue.products      good - a domain

app.everything          bad  - not a division
data.users              bad  - a layer, not a context
views.customer_summary  bad  - groups by object type
```

Grouping by object type (`tables`, `views`, `functions`) is always wrong. It splits things that change together and joins things that do not.

Two schemas that are genuinely useful beyond domain schemas:

- **`extensions`** - a home for extension objects, keeping `public` clean and letting you exclude them from dumps.
- **`private`** or **`internal`** - helper functions that policies and views call but no application role may execute directly. Central to the RLS pattern in [row-level-security.md](row-level-security.md).

## `search_path`

`search_path` is the ordered list of schemas PostgreSQL searches for an unqualified name, and the schema an unqualified `CREATE` lands in.

```sql
SHOW search_path;      -- "$user", public
SET search_path TO billing, public;
```

`"$user"` resolves to a schema named after the current role, if one exists. It usually does not, and is silently skipped.

**The first writable entry is where unqualified `CREATE` statements land.** A migration that forgets to qualify a table name creates it wherever `search_path` happens to point, which differs between the migration tool, `psql` and the application. Qualify object names in migrations, always.

### `search_path` is a security boundary

An attacker who controls `search_path` controls which function or operator your code resolves to. Create a `public.upper(text)` that logs its argument, put a schema earlier in the path, and every unqualified `upper()` call runs the attacker's version.

This matters in exactly one place with real consequence: **`SECURITY DEFINER` functions**, which run with the owner's privileges. Every one must pin its `search_path`:

```sql
CREATE FUNCTION private.audit_write(p_msg text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp   -- mandatory
AS $$ ... $$;
```

`pg_temp` goes **last**, explicitly. If it is not named, PostgreSQL searches it first, and any user can create a temporary object that shadows a real one. Naming it last is what closes that hole. Setting `search_path = ''` and fully qualifying every name inside the body is the strictest form and is worth it for anything security-sensitive.

See [security-and-roles.md](security-and-roles.md).

## The `public` schema

`public` is created in every database. Its behaviour changed:

- **14 and earlier**: `PUBLIC` (meaning every role) holds `CREATE` on it. Any role that can connect can create tables there.
- **15 and later**: `CREATE` on `public` is revoked from `PUBLIC`, and the schema is owned by `pg_database_owner`. Only the database owner can create objects there by default.

This breaks migrations that worked on 14 and run as a non-owner role. The fix is an explicit grant to the role that runs migrations, not reverting the security improvement:

```sql
GRANT CREATE ON SCHEMA public TO migration_role;
```

For a new database on any version, the cleanest position is to not use `public` at all: revoke it, create named schemas, and grant deliberately.

```sql
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA billing AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA billing TO app_readwrite;
```

## Extensions

An extension installs into one schema in one database. It is not cluster-wide, and it is not inherited by new databases unless installed into `template1`.

```sql
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
```

Then add `extensions` to `search_path`, or qualify the operators. Keeping extensions out of `public` makes dumps cleaner and upgrades less surprising. Some extensions (`pg_stat_statements`) are cluster-level shared libraries loaded via `shared_preload_libraries` and only expose a view per database - those still need `CREATE EXTENSION` in each database where you want the view.

See [extensions.md](extensions.md).

## Ownership

Objects are owned by the role that created them. The owner can `DROP` and `ALTER` them, and that cannot be revoked - it is inherent, not a grant.

**Do not let the application role own the schema.** Separate them:

| Role | Owns | Can do |
|---|---|---|
| `app_owner` | Every schema and table | DDL. Used only by migrations |
| `app_readwrite` | Nothing | `SELECT`/`INSERT`/`UPDATE`/`DELETE`. Used by the application |
| `app_readonly` | Nothing | `SELECT`. Used by reporting and replicas |

If the application role owns the tables, a SQL injection reaches `DROP TABLE`, and the role also bypasses RLS unless `FORCE ROW LEVEL SECURITY` is set. Both problems disappear with a separate owner.

Grants apply only to objects that exist when the grant runs. New tables need `ALTER DEFAULT PRIVILEGES`, keyed to the role that will create them:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA billing
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_readwrite;
```

Without this, every migration that adds a table also has to remember a `GRANT`, and one day it will not. See [security-and-roles.md](security-and-roles.md).

## Version notes

- **15+** - `CREATE` on `public` is revoked from `PUBLIC`, and `public` is owned by `pg_database_owner`. Migrations running as a non-owner need an explicit `GRANT CREATE ON SCHEMA public`.
- **14 and earlier** - any role that can connect can create objects in `public`. Revoke it manually.

Everything else here is unchanged across 14 to 18.

## Gotchas

- Agent proposes separate databases for modules that need to be queried together - a transaction can never span two databases, and that cannot be worked around
- Agent divides schemas by object type or layer rather than by domain - splits what changes together
- Agent writes unqualified object names in a migration - the object lands wherever `search_path` points, which differs by client
- Agent writes a `SECURITY DEFINER` function without `SET search_path` - a caller can hijack name resolution and run their own code with the owner's privileges
- Agent sets `search_path` in a `SECURITY DEFINER` function but omits `pg_temp` - unnamed, it is searched first, and any user can shadow objects with temporary ones
- Agent assumes an extension installed in one database is available in others - extensions are per-database
- Agent has the application role own the tables - injection then reaches DDL, and the owner bypasses RLS without `FORCE`
- Agent grants on existing tables and stops - new tables get no grants until `ALTER DEFAULT PRIVILEGES` is set for the creating role
- Agent hits `permission denied for schema public` on 15+ and grants broadly to `PUBLIC` - grant `CREATE` to the migration role instead
- Agent relies on `"$user"` in `search_path` - the schema usually does not exist and the entry is silently skipped

## Related

- [security-and-roles.md](security-and-roles.md) · [multi-tenancy.md](multi-tenancy.md) · [extensions.md](extensions.md) · [naming-and-conventions.md](naming-and-conventions.md) · [migrations.md](migrations.md) · [row-level-security.md](row-level-security.md)
