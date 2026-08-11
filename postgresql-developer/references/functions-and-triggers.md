# Functions and Triggers

Logic in the database is powerful and, in the wrong place, invisible. The default should be the application; the database earns the logic when it must hold regardless of which client writes.

## When logic belongs in the database

**Yes:**

- **Invariants that must hold no matter who writes.** Prefer a constraint; use a trigger only when the rule is genuinely not expressible as one. See [constraints.md](constraints.md).
- **Logic that would otherwise be reimplemented in several services.** One function beats three implementations that drift.
- **Multi-step work over large data where round trips dominate.** Applying interest to a million accounts, or a state machine over a batch. Moving a million rows to the application and back is pure waste.
- **Audit trails**, where the point is that no code path can skip them. See [temporal-and-history.md](temporal-and-history.md).
- **RLS helper predicates**, which must run inside the policy. See [row-level-security.md](row-level-security.md).

**No:**

- **Business workflow.** It changes often, needs testing, review and staged rollout, and none of that is easier in PL/pgSQL.
- **Anything calling out to the network.** A function that makes an HTTP call inside a transaction holds locks for the duration of the call and the transaction cannot be rolled back if the call has side effects.
- **Complex logic simply because it is faster there.** Measure first. The saving is round trips, not computation.

The real cost of database logic is that it is invisible: it does not appear in application code, it is not in the same repository unless migrations are disciplined, and a developer debugging an unexpected value has no reason to suspect it. Whatever you put there, keep in migrations under version control.

## Functions and procedures

```sql
CREATE OR REPLACE FUNCTION billing.order_total(p_order_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT coalesce(sum(quantity * unit_price), 0)
    FROM   billing.order_items
    WHERE  order_id = p_order_id;
$$;
```

Prefer `LANGUAGE sql` over `plpgsql` for anything that is a single query - it can be inlined into the calling query, which `plpgsql` never can. That inlining is a substantial performance difference, and it is the reason a small `plpgsql` wrapper around one `SELECT` can be many times slower.

**Procedures** (`CREATE PROCEDURE`, called with `CALL`) return nothing and can `COMMIT` mid-body. That makes them the right tool for batch loops that must commit incrementally:

```sql
CREATE PROCEDURE archive_old_orders() LANGUAGE plpgsql AS $$
DECLARE moved integer;
BEGIN
    LOOP
        WITH batch AS (
            SELECT id FROM orders WHERE placed_at < now() - interval '2 years'
            LIMIT 10000 FOR UPDATE SKIP LOCKED
        )
        DELETE FROM orders o USING batch b WHERE o.id = b.id;
        GET DIAGNOSTICS moved = ROW_COUNT;
        EXIT WHEN moved = 0;
        COMMIT;
    END LOOP;
END $$;
```

A function cannot do that - it runs inside the caller's transaction.

## Volatility: the attribute that changes plans

Every function is `VOLATILE`, `STABLE` or `IMMUTABLE`. **`VOLATILE` is the default**, and it is the pessimistic one.

| Class | Promise | Effect |
|---|---|---|
| `IMMUTABLE` | Same inputs always give the same result, forever | Can be constant-folded at plan time. **Required for index expressions** |
| `STABLE` | Same result within one statement | Can be used in an index scan condition; evaluated once per statement where possible |
| `VOLATILE` | Anything | Re-evaluated for every row. Blocks many optimisations |

Getting this wrong is expensive in both directions.

**Under-declaring** - leaving a pure function `VOLATILE` - means it is called once per row and cannot be used in an index condition. A `VOLATILE` function in a `WHERE` clause forces a sequential scan with a per-row function call.

**Over-declaring** is worse: an `IMMUTABLE` function that is not actually immutable produces **silently wrong results** from any index built on it, and only a `REINDEX` fixes it. Never mark a function `IMMUTABLE` to make `CREATE INDEX` stop complaining. See [partial-and-expression-indexes.md](partial-and-expression-indexes.md).

The line: anything reading a table is at most `STABLE`. Anything using `now()` is `STABLE` (it is fixed within a transaction). Anything using `clock_timestamp()` or `random()` is `VOLATILE`. Pure computation on the arguments is `IMMUTABLE`.

`PARALLEL SAFE` is a separate declaration and also defaults to the restrictive value. A `PARALLEL UNSAFE` function anywhere in a query **disables parallelism for the whole query**, which can be a large and mysterious slowdown.

## `SECURITY DEFINER`

A function runs as the caller (`SECURITY INVOKER`, the default) or as its **owner** (`SECURITY DEFINER`). The latter is how you grant a narrow, audited capability without granting the underlying privilege.

```sql
CREATE FUNCTION support.lookup_customer(p_id bigint)
RETURNS TABLE (id bigint, name text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT id, name, email FROM public.customers WHERE id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION support.lookup_customer(bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION support.lookup_customer(bigint) TO support_staff;
```

Four rules, all mandatory:

1. **`SET search_path` explicitly.** Without it a caller can manipulate their own `search_path` to shadow an object your function references, and your code runs theirs with the owner's privileges. This is a documented, exploited privilege-escalation pattern, not a theoretical one.
2. **Name `pg_temp` last**, or set `search_path = ''` and fully qualify everything. If `pg_temp` is not named, it is searched first and any user can shadow objects with temporary ones.
3. **`REVOKE EXECUTE FROM PUBLIC`** immediately. New functions are executable by `PUBLIC` by default.
4. **Own it with a dedicated role** that has exactly the privileges the function needs and is never used for login.

Note the two independent gates: **object privileges** and **RLS**. `BYPASSRLS` only opens the second. A `SECURITY DEFINER` function whose owner has `BYPASSRLS` but no `GRANT SELECT` on the table still fails with `permission denied`, raised from inside the function body. Both are required. See [security-and-roles.md](security-and-roles.md).

## Triggers

```sql
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER orders_set_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    WHEN (OLD.* IS DISTINCT FROM NEW.*)
    EXECUTE FUNCTION set_updated_at();
```

The `WHEN` clause is evaluated **before** the function is called, so it avoids the call entirely for no-op updates. Cheaper than checking inside the body.

### Timing and scope

| | `BEFORE` | `AFTER` |
|---|---|---|
| `FOR EACH ROW` | Can modify `NEW`; return `NULL` to cancel the operation | Row is written. `NEW`/`OLD` readable, return value ignored |
| `FOR EACH STATEMENT` | Runs once, no `NEW`/`OLD` | Runs once. Use transition tables |

- **`BEFORE ROW`** for defaulting and validating a row.
- **`AFTER ROW`** for anything touching other tables - audit, cascades, notifications. The row is committed to the statement by then.
- **`INSTEAD OF`** only on views, to make a complex view writable.

**A `BEFORE ROW` trigger returning `NULL` silently cancels the operation.** No error, no row, and `ROW_COUNT` is zero. Forgetting `RETURN NEW` in a `BEFORE` trigger discards every write to that table, which is a spectacular and confusing bug.

Transition tables give a statement trigger the whole change set at once, which is far more efficient than a row trigger firing thousands of times:

```sql
CREATE TRIGGER orders_audit
    AFTER UPDATE ON orders
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION audit_changes();
```

### Ordering

Multiple triggers on the same event fire in **alphabetical order by name**. That is the only control there is, and it means a trigger's behaviour can change because someone added one named earlier in the alphabet. If order matters, encode it in the names (`01_validate`, `02_audit`) and say so in a comment.

### Costs

- **Every write pays.** A trigger that updates a parent row means all children of one popular parent serialise on that row lock.
- **Recursion.** A trigger that writes to a table with a trigger that writes back loops until `max_stack_depth`. `pg_trigger_depth()` guards it.
- **Invisibility.** A value changing with no application code responsible is a genuinely hard debugging session.
- **`RETURNING` shows post-`BEFORE`-trigger values**, which is occasionally surprising.

Triggers do **not** fire on `TRUNCATE` (except statement-level `TRUNCATE` triggers) or on `COPY` with certain options, so anything relying on a trigger for correctness has holes. This is the main argument for a constraint over a trigger where a constraint will do.

## PL/pgSQL essentials

```sql
CREATE FUNCTION transfer(p_from bigint, p_to bigint, p_amount numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_balance numeric;
BEGIN
    SELECT balance INTO STRICT v_balance
    FROM accounts WHERE id = p_from FOR UPDATE;

    IF v_balance < p_amount THEN
        RAISE EXCEPTION 'insufficient funds: % < %', v_balance, p_amount
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE accounts SET balance = balance - p_amount WHERE id = p_from;
    UPDATE accounts SET balance = balance + p_amount WHERE id = p_to;
EXCEPTION
    WHEN no_data_found THEN
        RAISE EXCEPTION 'account % not found', p_from;
END $$;
```

- **`INTO STRICT`** raises `no_data_found` or `too_many_rows`. Plain `INTO` silently leaves the variable `NULL` when nothing matches, which then propagates as a NULL through the rest of the function.
- **Prefix parameters** (`p_`) and locals (`v_`). A parameter with the same name as a column makes `WHERE id = id` a tautology matching every row. See [naming-and-conventions.md](naming-and-conventions.md).
- **An `EXCEPTION` block creates a subtransaction** on every entry, whether or not an exception occurs. In a loop that is thousands of subtransactions, and past 64 in one transaction it overflows a shared cache and degrades the whole cluster. Do not put an exception handler inside a loop. See [transactions-and-isolation.md](transactions-and-isolation.md).
- **`RAISE EXCEPTION ... USING ERRCODE`** gives the application a SQLSTATE it can branch on, rather than matching on message text.
- **Dynamic SQL must use `format()` with `%I` and `%L`**, never concatenation:
  ```sql
  EXECUTE format('SELECT * FROM %I WHERE id = %L', p_table, p_id);
  ```
  `%I` quotes an identifier, `%L` quotes a literal. String concatenation here is SQL injection inside the database.

## Testing

Functions and triggers need tests as much as application code, and they are the part most often untested.

`pgTAP` provides assertions in SQL. Otherwise, test through the application against a real PostgreSQL instance, and test the trigger by writing directly to the table rather than through the code path that normally does - the whole point is that it works regardless of path. See [testing.md](testing.md).

## Version notes

- **18** - `OLD`/`NEW` aliases in `RETURNING` reduce the need for triggers that capture previous values; virtual generated columns can replace some `BEFORE` triggers, but cannot be indexed.
- **17+** - PL/pgSQL performance improvements; `MERGE ... RETURNING`.
- **14+** - SQL-standard function bodies (`BEGIN ATOMIC`), which are parsed at creation time so dependencies are tracked and typos are caught immediately:
  ```sql
  CREATE FUNCTION f(a int) RETURNS int LANGUAGE sql
  BEGIN ATOMIC SELECT a * 2; END;
  ```
- **12+** - generated columns replace the commonest "derive a column" trigger.

Volatility classes, trigger timing, `SECURITY DEFINER` semantics and the subtransaction limit are identical across 14 to 18.

## Gotchas

- Agent writes a `BEFORE ROW` trigger without `RETURN NEW` - every write to that table is silently discarded
- Agent writes a `SECURITY DEFINER` function without `SET search_path` - a caller can hijack name resolution and run their own code as the owner
- Agent sets `search_path` but omits `pg_temp` - unnamed, it is searched first and can be used to shadow objects
- Agent creates a function and does not `REVOKE EXECUTE FROM PUBLIC` - it is executable by everyone by default
- Agent leaves a pure function `VOLATILE` - called once per row, and unusable in an index expression
- Agent marks a function `IMMUTABLE` to satisfy `CREATE INDEX` - the index is then silently wrong
- Agent leaves a function `PARALLEL UNSAFE` - disables parallelism for every query that calls it
- Agent wraps a single query in `plpgsql` - it cannot be inlined; `LANGUAGE sql` can
- Agent puts an `EXCEPTION` block inside a loop - a subtransaction per iteration, overflowing the 64-entry cache
- Agent uses `INTO` without `STRICT` - a missing row leaves the variable NULL and the error surfaces much later
- Agent names a parameter the same as a column - `WHERE id = id` matches every row
- Agent builds dynamic SQL by concatenation - injection; use `format()` with `%I` and `%L`
- Agent relies on trigger execution order without naming them to control it - they fire alphabetically
- Agent uses a trigger where a constraint or generated column would do - triggers do not fire on `TRUNCATE` and are invisible at the call site
- Agent puts an HTTP call in a function - holds locks for the duration and cannot be rolled back
- Agent adds a counter-maintaining trigger to a high-write table without noting the hotspot - all children of one parent serialise on that row

## Related

- [constraints.md](constraints.md) · [security-and-roles.md](security-and-roles.md) · [row-level-security.md](row-level-security.md) · [temporal-and-history.md](temporal-and-history.md) · [transactions-and-isolation.md](transactions-and-isolation.md) · [partial-and-expression-indexes.md](partial-and-expression-indexes.md) · [normalisation.md](normalisation.md) · [testing.md](testing.md)
