# Row-Level Security

RLS attaches a predicate to a table that PostgreSQL adds to every query against it. It is the mechanism that makes shared-schema multi-tenancy safe, and it has three failure modes that are all silent.

## Enabling

```sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE  ROW LEVEL SECURITY;

CREATE POLICY invoices_tenant_isolation ON invoices
    USING      (tenant_id = current_setting('app.tenant_id', true)::bigint)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::bigint);
```

Both `ALTER` statements are needed:

- **`ENABLE`** turns on policy evaluation. With RLS enabled and **no** policies, the table denies everything - which is the correct fail-closed default, and a genuinely confusing state to hit by accident.
- **`FORCE`** applies policies to the **table owner** too. Without it the owner is exempt, so an application role that owns its tables silently ignores every policy. See [security-and-roles.md](security-and-roles.md).

## `USING` and `WITH CHECK`

Two independent predicates doing different jobs:

| | Applies to | Effect when false |
|---|---|---|
| `USING` | Rows being **read** or targeted: `SELECT`, and the rows an `UPDATE`/`DELETE` can see | Row is invisible. No error |
| `WITH CHECK` | Rows being **written**: `INSERT`, and the new value of an `UPDATE` | Error: `new row violates row-level security policy` |

**If `WITH CHECK` is omitted, `USING` is reused for writes.** That is usually right, but relying on it is a mistake worth avoiding: it is not obvious to a reader, and for a policy where the read and write rules genuinely differ, the default is silently wrong.

The asymmetry matters. Without a `WITH CHECK`, nothing stops inserting a row belonging to another tenant - you simply cannot see it afterwards. Invisible is not the same as prevented.

An `UPDATE` is checked twice: `USING` decides which rows it may touch, `WITH CHECK` validates what they become. That is what stops a tenant moving a row to another tenant.

## The three silent failures

### 1. Superuser and `BYPASSRLS`

**Superusers and roles with `BYPASSRLS` ignore row security unconditionally.** No policy, no `FORCE`, nothing overrides it.

```sql
SELECT current_user, rolsuper, rolbypassrls
FROM   pg_roles WHERE rolname = current_user;
```

If the application connects as a superuser, every policy in the database is inert and nothing indicates it. This is the most consequential misconfiguration in a multi-tenant PostgreSQL deployment.

Test RLS by switching effective role rather than opening a new connection:

```sql
CREATE ROLE app_user LOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO app_user;
SET ROLE app_user;
-- run the tests
RESET ROLE;
```

### 2. `SET` instead of `SET LOCAL` under pooling

The most dangerous one, because it leaks data with no error.

`SET app.tenant_id = '42'` is **session-scoped**. It persists on the physical connection until something changes it, across transaction boundaries. Connection pools - PgBouncer in transaction mode, HikariCP, any pool - hand the same physical connection to unrelated requests and do **not** reset custom GUCs on return.

One tenant's context leaks into another tenant's request. No exception, no empty result. Just the wrong customer's data, returned successfully.

```sql
SET       app.tenant_id = '42';   -- wrong under any pool
SET LOCAL app.tenant_id = '42';   -- reverts at COMMIT or ROLLBACK
```

Because `SET` does not accept a placeholder, parameterise via `set_config`, whose third argument means transaction-local:

```sql
SELECT set_config('app.tenant_id', $1, true);
```

`SET LOCAL` only works **inside a transaction block**. In autocommit it does not survive to the next statement - which fails closed rather than leaking, but is still broken.

In Spring, the interceptor must be ordered to run **after** `@Transactional` has opened the transaction, issuing the `set_config` as the first statement. See [application-integration.md](application-integration.md).

Prove it once:

```sql
BEGIN;
SET LOCAL app.tenant_id = 'a';
SELECT current_setting('app.tenant_id', true);   -- 'a'
COMMIT;
SELECT current_setting('app.tenant_id', true);   -- NULL. Reverted.

BEGIN;
SET app.tenant_id = 'b';
COMMIT;
SELECT current_setting('app.tenant_id', true);   -- still 'b'. Persisted.
```

### 3. Fail-open predicates

The policy must return **zero rows** when the tenant context is missing or wrong, never every row.

```sql
-- Correct: unset setting gives NULL, comparison is UNKNOWN, no rows.
USING (tenant_id = current_setting('app.tenant_id', true)::bigint)

-- WRONG: unset setting exposes everything.
USING (
    current_setting('app.tenant_id', true) IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::bigint
)
```

That second form appears when someone tries to "make admin queries work". It makes a missing session variable equivalent to full access, which is exactly backwards.

The `true` second argument to `current_setting` means "return NULL if unset" rather than raising an error. That is what makes the correct form fail closed. Without it, a missing setting raises `unrecognized configuration parameter`, which is noisier but also safe.

A related trap: **a string mismatch is silent**. `tenant-a` versus `tenant_a` returns an empty result, not an error - the same mechanism as an unset variable. An RLS query returning unexpectedly nothing is very often this, not an absence of data.

## Policy structure

```sql
CREATE POLICY name ON table
    [AS { PERMISSIVE | RESTRICTIVE }]
    [FOR { ALL | SELECT | INSERT | UPDATE | DELETE }]
    [TO role_name]
    [USING (expression)]
    [WITH CHECK (expression)];
```

**Permissive policies are `OR`ed together; restrictive policies are `AND`ed.** Default is permissive.

```sql
-- Anyone may see their own tenant's rows...
CREATE POLICY tenant_read ON invoices FOR SELECT TO app_user
    USING (tenant_id = current_setting('app.tenant_id', true)::bigint);

-- ...and auditors may see everything.
CREATE POLICY auditor_read ON invoices FOR SELECT TO auditor
    USING (true);

-- But nobody, ever, sees purged rows. RESTRICTIVE, so it ANDs with the above.
CREATE POLICY hide_purged ON invoices AS RESTRICTIVE
    USING (purged_at IS NULL);
```

A restrictive policy is the way to add a rule that cannot be widened by adding another permissive policy later. Use it for anything that is genuinely absolute.

Separate policies per command are worth writing when the rules differ - a tenant that may `SELECT` all its rows but only `UPDATE` its own drafts.

## Performance

RLS predicates are added to the query and are subject to the same rules as any other predicate.

**Index the policy columns.** A policy on `tenant_id` with no index on `tenant_id` means every query sequentially scans. In a shared-schema design, `tenant_id` leads every composite index. See [composite-and-covering-indexes.md](composite-and-covering-indexes.md).

**Wrap function calls in a scalar subquery.** A bare function call in a policy can be re-evaluated per row; wrapping it makes it an InitPlan evaluated once:

```sql
USING (tenant_id = (SELECT current_setting('app.tenant_id', true)::bigint))
```

The difference is large on big tables. The same applies to any helper function.

**Keep policies simple.** A policy containing a subquery over another table runs that subquery for every row of every query on the table. If the check is genuinely complex, put it in a `STABLE SECURITY DEFINER` function in a private schema, and wrap the call:

```sql
CREATE FUNCTION private.is_team_member(p_team_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.team_members
        WHERE team_id = p_team_id
          AND user_id = current_setting('app.user_id', true)::bigint
    );
$$;
REVOKE EXECUTE ON FUNCTION private.is_team_member(bigint) FROM PUBLIC;

CREATE POLICY team_access ON documents
    USING ((SELECT private.is_team_member(team_id)));
```

`STABLE` lets PostgreSQL cache the result within a statement. `SECURITY DEFINER` lets it read a table the caller cannot - and therefore needs the `search_path` pinned. See [functions-and-triggers.md](functions-and-triggers.md).

## Views and RLS

A view executes with its **owner's** privileges by default, so a view over an RLS-protected table evaluates policies as the view owner - which can expose every tenant's rows to anyone who can select from the view.

```sql
CREATE VIEW my_invoices WITH (security_invoker = true) AS SELECT * FROM invoices;
```

`security_invoker` (**15+**) evaluates permissions and policies as the **caller**. **Any view over an RLS-protected table should have it.** On 14 this option does not exist, which is a real constraint on using views alongside RLS. See [views.md](views.md).

## Leakproof functions

A non-leakproof function in a `WHERE` clause can be evaluated **before** the RLS filter, and can leak values through an error message:

```sql
SELECT * FROM invoices WHERE some_function(account_number);
```

If that function raises an error including its argument, a caller learns values from rows they cannot see. PostgreSQL only pushes down functions marked `LEAKPROOF` past a security barrier, and only superusers may mark a function leakproof.

This is a narrow attack, but it is why `security_barrier` exists on views and why the planner is conservative about pushing predicates through RLS.

## Testing

Test as the **actual application role**, in a transaction, with the session variable set the way the application sets it. Not as superuser, not as the owner.

```sql
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('app.tenant_id', '1', true);
SELECT count(*) FROM invoices;                      -- only tenant 1
INSERT INTO invoices (tenant_id, ...) VALUES (2, ...);  -- must be rejected
ROLLBACK;
```

Three cases every RLS test suite needs:

1. **The happy path** - a tenant sees its own rows.
2. **Cross-tenant read** - tenant 1 cannot see tenant 2's rows.
3. **Cross-tenant write** - tenant 1 cannot insert or update a row into tenant 2. This is the one people omit, and it is the one `WITH CHECK` exists for.

And one more, worth automating: **no session variable at all returns zero rows.** That is the fail-closed property, and it is what a fail-open predicate silently breaks.

See [testing.md](testing.md).

## Version notes

- **15+** - `security_invoker` views, which is the correct default for any view over an RLS table and is genuinely missing on 14.
- **15+** - publication row filters, which let logical replication respect a tenant boundary. Note that replication roles typically have `BYPASSRLS`, so RLS is not a replication boundary by itself.
- **14+** - `pg_read_all_data`, which grants read access without superuser but **does not** bypass RLS.

Policy semantics, `FORCE`, `BYPASSRLS` and the `SET LOCAL` behaviour are identical across 14 to 18.

## Gotchas

- Agent uses `SET` instead of `SET LOCAL` for the tenant variable - pools do not reset custom GUCs, so one tenant's context silently leaks into another's request
- Agent uses `SET LOCAL` outside a transaction block - it does not survive to the next statement
- Agent writes a policy that returns all rows when the session variable is unset - a missing setting must return zero rows
- Agent omits `FORCE ROW LEVEL SECURITY` - the table owner bypasses every policy
- Agent has the application connect as superuser or with `BYPASSRLS` - every policy is inert, with no indication
- Agent omits `WITH CHECK` - cross-tenant inserts succeed and are merely invisible afterwards
- Agent enables RLS and writes no policies - the table denies everything
- Agent writes policies and forgets to enable RLS - they are inert
- Agent tests RLS as superuser or as the table owner - neither is subject to policies
- Agent does not test the cross-tenant **write** case - that is precisely what `WITH CHECK` guards
- Agent does not index the policy column - every query sequentially scans
- Agent calls a function bare in a policy instead of wrapping it in `(SELECT ...)` - re-evaluated per row
- Agent puts a subquery over another table directly in a policy - it runs per row
- Agent creates a view over an RLS table without `security_invoker` - policies evaluate as the view owner
- Agent debugs an empty RLS result as missing data - a string mismatch in the tenant value produces the same silent empty result
- Agent assumes RLS constrains logical replication - replication roles typically have `BYPASSRLS`

## Related

- [multi-tenancy.md](multi-tenancy.md) · [security-and-roles.md](security-and-roles.md) · [connections-and-pooling.md](connections-and-pooling.md) · [functions-and-triggers.md](functions-and-triggers.md) · [views.md](views.md) · [testing.md](testing.md) · [application-integration.md](application-integration.md) · [composite-and-covering-indexes.md](composite-and-covering-indexes.md)
