# Relationships

Every relationship has a cardinality on both sides and an optionality on both sides. Getting all four right is most of data modelling. Two shapes - polymorphic associations and hierarchies - deserve their own treatment because the obvious implementation of each is wrong.

## One-to-many

The default relationship. The foreign key goes on the **many** side.

```sql
CREATE TABLE invoices (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id bigint NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
    ...
);
CREATE INDEX invoices_customer_id_idx ON invoices (customer_id);
```

Optionality is expressed by nullability: `NOT NULL` means every invoice must have a customer. Make it `NOT NULL` unless the spec genuinely permits an orphan, because a nullable foreign key means every query joining through it needs to decide what to do about the nulls.

## One-to-one

Three implementations, in decreasing order of preference:

**Same table.** If the relationship is truly one-to-one and mandatory, they are one entity. Combine them. This is the right answer more often than people expect.

**Shared primary key.** When the optional half is genuinely separable - rarely accessed, much wider, or owned by a different module:

```sql
CREATE TABLE user_profiles (
    user_id bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    bio     text,
    avatar  bytea
);
```

The primary key *is* the foreign key, which enforces one-to-one structurally. No extra unique constraint needed.

**Foreign key plus `UNIQUE`.** Only when the relationship is optional on both sides:

```sql
person_id bigint UNIQUE REFERENCES people (id)
```

Legitimate reasons to split a one-to-one: a wide, rarely-read column set that would otherwise be TOASTed on every scan; a genuinely optional extension; different access control on the two halves; or a hot/cold split for update-heavy tables where you want HOT updates. See [mvcc-and-vacuum.md](mvcc-and-vacuum.md).

## Many-to-many

A junction table. Its primary key is the pair.

```sql
CREATE TABLE course_enrolments (
    student_id bigint NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    course_id  bigint NOT NULL REFERENCES courses  (id) ON DELETE RESTRICT,
    enrolled_at timestamptz NOT NULL DEFAULT now(),
    grade      text,
    PRIMARY KEY (student_id, course_id)
);
-- The PK indexes (student_id, course_id). Add the reverse for the other direction.
CREATE INDEX course_enrolments_course_id_idx ON course_enrolments (course_id);
```

Three things routinely got wrong:

1. **Adding a surrogate `id`.** It permits duplicate pairs unless you also add the unique constraint you were trying to avoid. Use the composite key. The exception is when the junction row is itself referenced by other tables, where a single-column key is genuinely more convenient.
2. **Forgetting the reverse index.** The composite primary key indexes `(student_id, course_id)`, so "which courses is this student on" is fast and "who is on this course" is a sequential scan. PG18's skip scan helps if `student_id` has low cardinality, which for a student table it does not. Add the second index. See [composite-and-covering-indexes.md](composite-and-covering-indexes.md).
3. **Naming it after the mechanism.** If the relationship has a domain name - `enrolment`, `membership`, `assignment` - use it. Once it carries its own attributes it is an entity, not a join.

**Do not use an array instead.** `students.course_ids bigint[]` cannot have a foreign key, cannot carry `enrolled_at` or `grade`, and cannot answer "who is on this course" without a GIN index and a containment query that is slower than a join.

## Self-references and hierarchies

```sql
CREATE TABLE categories (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_id bigint REFERENCES categories (id) ON DELETE RESTRICT,
    name      text NOT NULL
);
CREATE INDEX categories_parent_id_idx ON categories (parent_id);
```

This is the **adjacency list**, and it is the correct default. It is simple, it is normalised, moves are a single-row update, and PostgreSQL traverses it with a recursive CTE. See [ctes.md](ctes.md).

Note it does not prevent cycles. A `CHECK` cannot see other rows. Prevent them with a trigger, or by accepting the risk and adding a depth limit to the recursive query so a cycle produces a bounded result rather than an infinite loop.

The alternatives exist for specific read patterns:

| Model | Read a subtree | Move a subtree | Ancestors of a node | Use when |
|---|---|---|---|---|
| **Adjacency list** | Recursive CTE | One row | Recursive CTE | **Default.** Write-heavy, moderate depth |
| **Materialised path** (`'/1/7/23/'`) | `LIKE '/1/7/%'` with a B-tree index | Rewrite the subtree | String split, no join | Read-heavy, shallow, rarely moved |
| **`ltree`** (extension) | `path <@ '1.7'` with GiST | Rewrite the subtree | Built-in operators | Same as above, with proper operators and indexing |
| **Closure table** | Simple join | Delete and reinsert O(descendants × ancestors) rows | Simple join | Read-heavy both directions, deep trees, rare writes |
| **Nested sets** | Range query | **Rewrites most of the table** | Range query | Almost never. The write cost is prohibitive |

Do not reach past the adjacency list without a measured read problem. `ltree` is the best of the alternatives for a category tree, because it gives you real operators and a GiST index rather than string manipulation.

## Polymorphic associations

The shape where one table references *one of several* parent tables. A `comments` table where a comment belongs to a post, a photo, or a video.

The naive implementation, which most ORMs generate:

```sql
-- Do not do this.
CREATE TABLE comments (
    id                bigint PRIMARY KEY,
    commentable_type  text   NOT NULL,   -- 'post' | 'photo' | 'video'
    commentable_id    bigint NOT NULL,
    body              text   NOT NULL
);
```

**This has no foreign key and cannot have one.** A foreign key names exactly one referenced table. The consequences are not theoretical:

- Nothing prevents `commentable_id = 99999` pointing at a row that never existed.
- Deleting a post leaves its comments behind, forever, invisible.
- Joining requires a `CASE` or three `LEFT JOIN`s, and the planner has no idea what it is joining to.
- The index on `(commentable_type, commentable_id)` cannot help the planner estimate anything, because the type column determines the meaning of the id column.

### Three alternatives, all with real foreign keys

**Exclusive-arc: one nullable column per parent, with a check.** Best when the number of parents is small and fixed.

```sql
CREATE TABLE comments (
    id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    post_id  bigint REFERENCES posts  (id) ON DELETE CASCADE,
    photo_id bigint REFERENCES photos (id) ON DELETE CASCADE,
    video_id bigint REFERENCES videos (id) ON DELETE CASCADE,
    body     text NOT NULL,
    CONSTRAINT comments_exactly_one_parent CHECK (
        num_nonnulls(post_id, photo_id, video_id) = 1
    )
);
```

`num_nonnulls()` makes the constraint readable. Real referential integrity, real cascades. The cost is a column per parent and a schema change to add a fourth.

**A shared supertype.** Best when the parents genuinely share an identity.

```sql
CREATE TABLE content_items (
    id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('post','photo','video'))
);
CREATE TABLE posts    (id bigint PRIMARY KEY REFERENCES content_items (id) ON DELETE CASCADE, ...);
CREATE TABLE photos   (id bigint PRIMARY KEY REFERENCES content_items (id) ON DELETE CASCADE, ...);
CREATE TABLE comments (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_item_id bigint NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
    body            text NOT NULL
);
```

One foreign key, arbitrarily many subtypes, no schema change to add one. The cost is an extra join to reach the concrete row, and a shared sequence.

**Separate tables per parent** - `post_comments`, `photo_comments`. Correct when the comment shapes actually differ. Wrong when they are identical, because every query becomes a `UNION`.

If a polymorphic association already exists in the schema and cannot be changed, say so, and add a periodic reconciliation query that finds orphans, since the database cannot.

## Optional relationships and the null

A nullable foreign key means "this relationship may not exist". Before adding one, check whether the absence has a name. `orders.cancelled_by_user_id IS NULL` might mean "not cancelled", in which case the real model is a status column plus a check tying the two together:

```sql
CHECK ((status = 'cancelled') = (cancelled_by_user_id IS NOT NULL))
```

That constraint is what stops the two columns disagreeing. See [constraints.md](constraints.md) and [null-handling.md](null-handling.md).

## Version notes

- **18** - `NOT NULL` constraints are catalogued and can be `NOT VALID`, making it practical to add mandatory relationships to large existing tables. Skip scan slightly reduces the cost of a missing reverse index on a low-cardinality junction column, but does not remove the need for one.
- **14+** - `ALTER TABLE ... DETACH PARTITION CONCURRENTLY`, relevant when a one-to-many child is partitioned.

`num_nonnulls()`, recursive CTEs, `ltree` and composite foreign keys behave identically across 14 to 18.

## Gotchas

- Agent creates a polymorphic association with a `type` plus `id` pair - no foreign key is possible, orphans accumulate silently, and deletes leave dangling children
- Agent adds a surrogate `id` to a junction table - duplicate pairs become possible unless the unique constraint is added anyway
- Agent creates a junction table and indexes only the direction the primary key covers - the reverse lookup is a sequential scan
- Agent uses an array of ids instead of a junction table - no referential integrity, no attributes on the relationship, no efficient reverse lookup
- Agent implements a one-to-one with two tables when the relationship is mandatory - they are one entity
- Agent implements a one-to-one with a plain foreign key and no `UNIQUE` - nothing enforces the "one"
- Agent reaches for nested sets or a closure table without a measured read problem - the adjacency list plus a recursive CTE is the right default
- Agent writes a recursive CTE over an adjacency list with no depth limit - a cycle produces an infinite loop, and nothing in the schema prevents cycles
- Agent makes a foreign key nullable by default - decide optionality deliberately; a nullable key forces every joining query to handle the nulls
- Agent adds a nullable foreign key where the absence has a meaning - model the meaning as a status and tie the two with a check
- Agent picks `ON DELETE CASCADE` for a polymorphic replacement without checking whether the child is a record - cascades destroy audit trails

## Related

- [requirements-to-schema.md](requirements-to-schema.md) · [constraints.md](constraints.md) · [keys-and-identifiers.md](keys-and-identifiers.md) · [normalisation.md](normalisation.md) · [ctes.md](ctes.md) · [null-handling.md](null-handling.md) · [composite-and-covering-indexes.md](composite-and-covering-indexes.md)
