# Security and Roles

A role is a user or a group; PostgreSQL does not distinguish them. A role with `LOGIN` can connect; a role without it is used as a group.

Roles are **cluster-wide**, not per database. Privileges are per object.

## Role structure

Separate ownership from use. The application role must not own the tables it writes to.

```sql
-- Owns the schema. Used only by migrations.
CREATE ROLE app_owner NOLOGIN;

-- Group roles carrying privileges.
CREATE ROLE app_readwrite NOLOGIN;
CREATE ROLE app_readonly  NOLOGIN;

-- Login roles, holding no privileges of their own.
CREATE ROLE app_service   LOGIN PASSWORD '...' IN ROLE app_readwrite;
CREATE ROLE reporting     LOGIN PASSWORD '...' IN ROLE app_readonly;
CREATE ROLE migrator      LOGIN PASSWORD '...' IN ROLE app_owner;
```

Why the separation matters:

- **The owner can `DROP` and `ALTER` its objects, and that cannot be revoked.** It is inherent to ownership. If the application role owns the tables, a SQL injection reaches `DROP TABLE`.
- **The owner bypasses RLS** unless `FORCE ROW LEVEL SECURITY` is set. An application role that owns its tables silently ignores every policy.
- Granting a person or service into a group role means offboarding is one `REVOKE`, not an audit of every object.

## Attributes

```sql
CREATE ROLE x LOGIN PASSWORD '...'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION
    CONNECTION LIMIT 20
    VALID UNTIL '2027-01-01';
```

These default to the safe value, so listing them is documentation rather than necessity - with two exceptions worth being explicit about:

- **`SUPERUSER`** bypasses every permission check and every RLS policy. No application should ever connect as one.
- **`BYPASSRLS`** ignores all row-level security. It exists for backup and replication tooling.

Check what you actually have:

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
FROM   pg_roles WHERE rolcanlogin ORDER BY rolname;
```

An application connecting as `postgres` is the most common serious misconfiguration in a PostgreSQL deployment, and it makes every RLS policy in the database inert.

## Privileges

```sql
-- Connect and see the schema
GRANT CONNECT ON DATABASE appdb TO app_readwrite;
GRANT USAGE   ON SCHEMA billing TO app_readwrite;

-- Table privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO app_readwrite;
GRANT SELECT ON ALL TABLES IN SCHEMA billing TO app_readonly;

-- Sequences: needed for INSERT into a table with an identity column
GRANT USAGE ON ALL SEQUENCES IN SCHEMA billing TO app_readwrite;
```

**`USAGE` on the schema is required before any table privilege has effect.** A `GRANT SELECT` on a table in a schema the role cannot use is silently useless, and the resulting `permission denied for schema` confuses people who have just granted table access.

### Default privileges

`GRANT ... ON ALL TABLES` applies only to tables that **exist right now**. A table created tomorrow has no grants.

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA billing
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_readwrite;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA billing
    GRANT SELECT ON TABLES TO app_readonly;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA billing
    GRANT USAGE ON SEQUENCES TO app_readwrite;
```

**`FOR ROLE app_owner` is essential.** Default privileges are keyed to the role that **creates** the object. Omitting it defaults to the role running the statement, so objects created later by a different role get nothing. This is the most common way default privileges silently fail.

Without this, every migration that adds a table also has to remember a `GRANT`, and one day it will not.

### Column and row level

```sql
GRANT SELECT (id, name, created_at) ON customers TO app_readonly;   -- not email
GRANT UPDATE (status) ON orders TO support_staff;                   -- only that column
```

Row-level restrictions are RLS. See [row-level-security.md](row-level-security.md).

### `PUBLIC`

`PUBLIC` is an implicit role containing everyone. Several things are granted to it by default:

```sql
REVOKE ALL ON SCHEMA public FROM PUBLIC;          -- 14 and earlier: allows CREATE
REVOKE CONNECT ON DATABASE appdb FROM PUBLIC;     -- every role can connect by default
REVOKE EXECUTE ON FUNCTION f(int) FROM PUBLIC;    -- new functions are public by default
```

On **15+**, `CREATE` on `public` is already revoked from `PUBLIC`. `CONNECT` on a database and `EXECUTE` on functions are still granted to `PUBLIC` on every version.

Revoking `CONNECT` from `PUBLIC` on every database, then granting it explicitly, is the pattern that makes database-per-tenant isolation actually hold.

## Inheritance

```sql
CREATE ROLE app_service LOGIN INHERIT   IN ROLE app_readwrite;   -- default
CREATE ROLE dba_person  LOGIN NOINHERIT IN ROLE app_owner;
```

`INHERIT` means the role automatically has its group's privileges. `NOINHERIT` means it must `SET ROLE` explicitly to use them.

`NOINHERIT` is a real safety mechanism for human accounts with elevated rights: routine work runs without them, and using them is a deliberate act. It is the `sudo` model, and it shrinks the blast radius of a mistyped command.

For service accounts, `INHERIT` is right - a service should not be issuing `SET ROLE`.

## `SECURITY DEFINER` and the two gates

The narrow escape hatch: a function that runs with its **owner's** privileges, so callers get one specific capability without holding the underlying privilege.

```sql
CREATE FUNCTION support.lookup_customer(p_id bigint)
RETURNS TABLE (id bigint, name text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT id, name, email FROM public.customers WHERE id = p_id; $$;

REVOKE EXECUTE ON FUNCTION support.lookup_customer(bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION support.lookup_customer(bigint) TO support_staff;
ALTER FUNCTION support.lookup_customer(bigint) OWNER TO support_lookup_owner;
```

**There are two independent security gates**, and this catches everyone the first time:

1. **Object privileges** - `GRANT`/`REVOKE`. "May this role touch this table at all?" Checked first, unconditionally, for every role including superusers and `BYPASSRLS` roles.
2. **Row-level security** - "which rows?" Only evaluated once gate 1 has passed.

`BYPASSRLS` only opens **gate 2**. A role with `BYPASSRLS` and no `GRANT SELECT` on a table is flatly denied with `permission denied for table`, surfacing from inside the function body. To read across all tenants, the function's owner needs **both** the grant and `BYPASSRLS`. Either alone is insufficient.

**`SET search_path` is mandatory** on any `SECURITY DEFINER` function. Without it, a caller can manipulate their own `search_path` to shadow an object the function references, and your code runs theirs with the owner's privileges. Name `pg_temp` explicitly and last, or use `search_path = ''` and fully qualify everything. See [functions-and-triggers.md](functions-and-triggers.md).

## Passwords and authentication

```
scram-sha-256
```

`ALTER SYSTEM SET password_encryption = 'scram-sha-256';` and re-set every password afterwards - changing the setting does not re-hash existing ones.

`md5` is deprecated and weak. Check for stragglers:

```sql
SELECT rolname FROM pg_authid WHERE rolpassword LIKE 'md5%';
```

Better than passwords, where available:

- **Certificate authentication** (`cert`) for service-to-service.
- **IAM authentication** on RDS, Cloud SQL and Azure - short-lived tokens, no stored secret.
- **OAuth** (18+) via the `oauth` method in `pg_hba.conf`.

`pg_hba.conf` is evaluated top to bottom, first match wins. A permissive early line makes every later line irrelevant, so put the most specific rules first. Never `trust` on anything reachable from a network.

`ALTER ROLE ... VALID UNTIL` gives credentials an expiry, which forces rotation to be a real process rather than an aspiration.

## Auditing

`log_statement = 'ddl'` catches schema changes cheaply. `'all'` is enormous and logs parameters, including personal data.

`pgaudit` gives structured, filterable audit logging by object and operation class, and is available on most managed platforms. For regulated environments it is the standard answer.

Record who did what at the application level too - the database role is usually a shared service account and tells you nothing about which human acted. Carry the application user in a session variable set with `SET LOCAL`. See [temporal-and-history.md](temporal-and-history.md).

## Encryption

- **In transit**: `ssl = on`, and require it in `pg_hba.conf` with `hostssl`. Clients should use `sslmode=verify-full` - `require` alone does not check the certificate and does not prevent a man-in-the-middle.
- **At rest**: PostgreSQL has no built-in transparent encryption. Use filesystem or volume encryption, which every managed platform provides.
- **Column level**: `pgcrypto` for specific fields. Note that an encrypted column cannot be indexed for range queries or sorted meaningfully, and key management becomes your problem. Encrypt narrowly.

## An audit checklist

```sql
-- Superusers and RLS bypass
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
FROM pg_roles WHERE rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb;

-- Who can log in, and do any lack an expiry
SELECT rolname, rolvaliduntil, rolconnlimit FROM pg_roles WHERE rolcanlogin;

-- What PUBLIC can still do
SELECT table_schema, table_name, privilege_type
FROM   information_schema.role_table_grants WHERE grantee = 'PUBLIC';

-- Object ownership: is the application role owning anything?
SELECT schemaname, tablename, tableowner FROM pg_tables
WHERE  schemaname NOT IN ('pg_catalog','information_schema');

-- SECURITY DEFINER functions without a pinned search_path
SELECT n.nspname, p.proname, p.proconfig
FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE  p.prosecdef
AND    (p.proconfig IS NULL OR NOT p.proconfig::text LIKE '%search_path%');

-- Tables with RLS enabled but no policies, or policies but no RLS
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
       (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid) AS policies
FROM   pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE  c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema');
```

That last query is worth running regularly. A table with RLS enabled and zero policies denies everything; a table with policies and RLS not enabled enforces nothing.

## Version notes

- **18** - OAuth authentication method in `pg_hba.conf`, with `oauth_validator_libraries`.
- **16+** - `pg_maintain`, `pg_use_reserved_connections` and other predefined roles, reducing the need to grant superuser for routine maintenance.
- **15+** - `CREATE` on `public` revoked from `PUBLIC` by default; `security_invoker` views, which matter for RLS. See [views.md](views.md).
- **14+** - predefined roles `pg_read_all_data` and `pg_write_all_data`, which are far better than granting superuser to a reporting user.

Role attributes, the two-gate model, default privileges and `SECURITY DEFINER` semantics are identical across 14 to 18.

## Gotchas

- Agent has the application connect as `postgres` or another superuser - every permission check and every RLS policy becomes inert
- Agent has the application role own its tables - injection reaches DDL, and the owner bypasses RLS without `FORCE`
- Agent grants on existing tables and stops - new tables get nothing until `ALTER DEFAULT PRIVILEGES` is set
- Agent sets default privileges without `FOR ROLE <owner>` - they key to the wrong creating role and silently do not apply
- Agent grants table privileges without `USAGE` on the schema - the grant has no effect and the error names the schema
- Agent grants `INSERT` on a table with an identity column but not `USAGE` on the sequence - inserts fail
- Agent gives a role `BYPASSRLS` and expects it to read a table with no grant - `BYPASSRLS` opens the RLS gate only
- Agent writes a `SECURITY DEFINER` function without `SET search_path` - a caller can hijack name resolution and run their own code as the owner
- Agent creates a function and does not revoke `EXECUTE` from `PUBLIC` - executable by everyone by default
- Agent leaves `CONNECT` granted to `PUBLIC` - every role can connect to every database
- Agent uses `md5` password encryption - deprecated and weak; changing the setting does not re-hash existing passwords
- Agent uses `sslmode=require` - it encrypts but does not verify the certificate; use `verify-full`
- Agent enables RLS but writes no policies - the table denies everything
- Agent writes policies but never enables RLS - they are inert
- Agent puts a permissive rule early in `pg_hba.conf` - first match wins, so every later rule is unreachable

## Related

- [row-level-security.md](row-level-security.md) · [schema-organisation.md](schema-organisation.md) · [functions-and-triggers.md](functions-and-triggers.md) · [multi-tenancy.md](multi-tenancy.md) · [views.md](views.md) · [connections-and-pooling.md](connections-and-pooling.md) · [temporal-and-history.md](temporal-and-history.md) · [migrations.md](migrations.md)
