# Naming and Conventions

Naming in PostgreSQL is not only style. Unquoted identifiers fold to lower case, so a name that looks mixed-case in the DDL is not the name that exists in the catalogue, and the difference surfaces as a confusing error much later.

## The folding rule

PostgreSQL folds unquoted identifiers to **lower case**. The SQL standard says upper case; PostgreSQL deviates deliberately and documents it.

```sql
CREATE TABLE UserAccounts (userId int);   -- actually creates useraccounts(userid)
SELECT * FROM useraccounts;               -- works
SELECT * FROM UserAccounts;               -- works, folds to the same thing
SELECT * FROM "UserAccounts";             -- ERROR: relation "UserAccounts" does not exist
```

Quoting makes the name case-sensitive and permanently so. `"UserAccounts"` and `useraccounts` are two different tables that can coexist.

**Use `snake_case` and never quote identifiers.** Once one quoted mixed-case identifier exists, every query, every migration, every ORM mapping and every ad-hoc `psql` session must quote it forever. This is the most common self-inflicted wound in a PostgreSQL schema, and it is usually inherited from an ORM that generated `camelCase` DDL.

If you are handed a schema that already has quoted mixed-case names, match it and say so. Renaming is correct but is a breaking change across every consumer.

## Tables

| | Convention |
|---|---|
| Case | `snake_case` |
| Number | **Singular** or **plural**, but pick one and never mix |
| Prefixes | No `tbl_`, no `t_`. The catalogue already knows it is a table |
| Junction tables | Both sides, alphabetical: `order_product`, or a domain name if one exists (`enrolment` beats `course_student`) |

Singular versus plural is genuinely arbitrary and the argument is not worth having. Plural (`users`, `orders`) reads better in `FROM` clauses; singular (`user`, `order`) matches the entity and the class name. **Plural avoids a real problem**: `user` and `order` are reserved words in SQL, so singular forces you to quote exactly the two tables every schema has. Prefer plural for that reason alone.

Check before naming anything:

```sql
SELECT * FROM pg_get_keywords() WHERE word = 'order';
```

## Columns

| | Convention |
|---|---|
| Case | `snake_case` |
| Primary key | `id`, or `<entity>_id` if the codebase uses that consistently |
| Foreign key | `<referenced_table_singular>_id`: `customer_id`, `order_id` |
| Booleans | A predicate that reads true: `is_active`, `has_shipped`, `can_edit`. Never `active_flag`, never `deleted` where `is_deleted` is meant |
| Timestamps | `created_at`, `updated_at`, `deleted_at`, `shipped_at`. The `_at` suffix signals `timestamptz` |
| Dates | `_date` or `_on`: `birth_date`, `invoiced_on`. Signals `date`, not `timestamptz` |
| Amounts | Include the unit or currency when it is not obvious: `amount_gbp`, `weight_kg`, `duration_seconds` |
| Counts | `_count`: `login_count` |

Do not repeat the table name in the column: `users.name`, not `users.user_name`. The exception is the primary key, where `users.user_id` is defensible because it makes `USING (user_id)` joins possible and makes the column self-describing in a wide result set.

Do not encode the type in the name. `name_text`, `price_numeric` and `id_int` all become lies the first time the type changes.

## Constraints and indexes

PostgreSQL generates names automatically. Generated names are fine for primary keys, and bad for everything else, because they collide and truncate at 63 bytes and tell you nothing in an error message.

Name every constraint you write:

| Object | Pattern | Example |
|---|---|---|
| Primary key | `<table>_pkey` (the default) | `orders_pkey` |
| Foreign key | `<table>_<column>_fkey` | `orders_customer_id_fkey` |
| Unique | `<table>_<columns>_key` | `users_email_key` |
| Check | `<table>_<column>_check` or a name describing the rule | `orders_total_positive_check` |
| Exclusion | `<table>_<columns>_excl` | `bookings_room_period_excl` |
| Index | `<table>_<columns>_idx` | `orders_customer_id_created_at_idx` |
| Partial index | add the condition | `orders_customer_id_active_idx` |
| Trigger | `<table>_<event>_<action>` | `orders_before_update_set_timestamp` |

These match what PostgreSQL generates, so a schema where some names are explicit and some are default still looks uniform.

A named check constraint is what the application sees when it fails:

```
ERROR: new row for relation "orders" violates check constraint "orders_total_positive_check"
```

That is actionable. `orders_check1` is not.

**63 bytes is the identifier limit.** Longer names are silently truncated, which turns two long index names into one collision. `orders_customer_id_created_at_status_idx` is 41 bytes and fine; keep an eye on generated names on wide composite indexes over long table names.

## Schemas

Lower case, singular, named for a bounded context rather than a layer: `billing`, `identity`, `catalogue`. Not `app`, `data`, `tables`. See [schema-organisation.md](schema-organisation.md).

## Enum-like values

The skill's position on `CREATE TYPE ... AS ENUM` is in [data-types.md](data-types.md): prefer `text` plus a `CHECK`, or a lookup table. Whichever you use, the stored values need a convention.

Use **lower `snake_case`** for stored codes: `pending`, `awaiting_payment`, `part_shipped`. Upper case (`PENDING`) is a common alternative and is fine if applied consistently; what is not fine is mixing, or storing display text (`Awaiting payment`) in a status column. Display text belongs in the application or a lookup table's label column, because it is translated and it changes.

## Functions

`snake_case`, named as a verb phrase: `calculate_order_total`, `assert_tenant_access`. A function returning a boolean reads as a predicate: `is_tenant_member`, `has_active_subscription`.

Argument names are prefixed to avoid ambiguity with column names, which is a real and confusing bug in PL/pgSQL:

```sql
CREATE FUNCTION get_orders(p_customer_id bigint) RETURNS SETOF orders AS $$
  SELECT * FROM orders WHERE customer_id = p_customer_id;   -- unambiguous
$$ LANGUAGE sql STABLE;
```

Without the prefix, `WHERE customer_id = customer_id` is a tautology matching every row. See [functions-and-triggers.md](functions-and-triggers.md).

## Version notes

Version-agnostic. Identifier folding, quoting and the 63-byte limit are unchanged across 14 to 18.

The reserved-word list grows slowly between majors. `pg_get_keywords()` reflects the server you are connected to, so check against the target version rather than a remembered list.

## Gotchas

- Agent generates `camelCase` or `PascalCase` identifiers - unquoted they fold to lower case, and quoted they force quoting everywhere forever
- Agent quotes identifiers "to be safe" - quoting is what creates the case-sensitivity problem, not what avoids it
- Agent names a table `user` or `order` - reserved words, requiring quotes on exactly the tables you use most
- Agent leaves constraints unnamed - the application then reports `orders_check1` on failure, which identifies nothing
- Agent names a boolean `deleted` or `status_flag` - it does not read as a predicate at the call site
- Agent uses `created` or `create_date` for a `timestamptz` - `_at` for timestamps, `_date`/`_on` for dates, consistently
- Agent prefixes tables with `tbl_` or columns with `col_` - the catalogue already records what each object is
- Agent mixes singular and plural table names in one schema - pick one; the inconsistency costs more than either choice
- Agent puts the type in the column name - `price_numeric` becomes wrong the moment the type changes
- Agent writes a PL/pgSQL argument with the same name as a column - the comparison becomes a tautology matching every row
- Agent stores display text in a status column - it is translated and it changes; store a code

## Related

- [schema-organisation.md](schema-organisation.md) · [data-types.md](data-types.md) · [constraints.md](constraints.md) · [sql-style.md](sql-style.md) · [functions-and-triggers.md](functions-and-triggers.md)
