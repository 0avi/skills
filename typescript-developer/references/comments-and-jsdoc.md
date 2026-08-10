# Comments and JSDoc

## Which form

**JSDoc `/** … *\/` for documentation a consumer reads.** It surfaces in editor tooltips and generated docs.

**Line comments `//` for notes to whoever edits the code next.** Implementation detail, a non-obvious reason, a caveat.

Multi-line implementation commentary uses stacked `//` lines, not a `/* … */` block. No decorative boxes or banner comments.

```typescript
/** Loads a submission, or throws if the reference is unknown. */
export async function load(reference: string): Promise<Submission> {
  // The upstream index is eventually consistent, so a submission created in the
  // last few seconds may not be visible yet. Callers retry.
  …
}
```

## Never repeat the types

TypeScript already carries the types. Repeating them in JSDoc creates a second source of truth that silently goes stale:

```typescript
/**
 * @param {string} reference The reference.       // no - the type is in the signature
 * @returns {Promise<Submission>}                 // no
 */
```

These tags are banned outright, because TypeScript expresses each one directly:

| Banned tag | TypeScript equivalent |
|---|---|
| `@private`, `@protected`, `@public` | `#`, `private`, `protected` |
| `@override` | The `override` keyword |
| `@implements`, `@extends` | `implements`, `extends` |
| `@enum` | An `as const` object ([enums-and-constants.md](enums-and-constants.md)) |
| `@type`, `@typedef` | A type annotation or a type alias |
| Types inside `@param`/`@returns` | The signature |

## What to document

Not everything. A comment restating the code is worse than none - it is a second thing to keep correct, and it trains readers to skim.

```typescript
/** Gets the name. */
getName(): string { return this.#name; }        // adds nothing
```

Document what the signature cannot say:

- **Why**, when the reason is not obvious. This is the highest-value comment there is.
- **Constraints and preconditions** - "must be called after `connect()`", "reference must be uppercase".
- **Failure behaviour** - what it throws and when.
- **Units and formats** - "timeout in milliseconds", "ISO 8601". Better still, put it in the name (`timeoutMs`) or the type (a branded type - see [advanced-types.md](advanced-types.md)).
- **Side effects** that a caller would not expect.
- **Non-obvious complexity or ordering guarantees.**

```typescript
/**
 * Submits a return to HMRC.
 *
 * Idempotent on `correlationId`: resubmitting with the same id returns the
 * original receipt rather than filing twice.
 *
 * @param correlationId Caller-generated; must be stable across retries.
 * @throws {SubmissionRejectedError} When the gateway rejects the payload.
 */
```

## Form

Single line when it fits, otherwise `/**` and `*/` on their own lines:

```typescript
/** One line. */

/**
 * A longer description that does not fit, wrapped to the project's line
 * width, with a blank line before any tags.
 */
```

Markdown is supported and worth using - backticks for code, lists for enumerations, and prefer a list over a comma-separated sentence when enumerating.

Tags come last, one per line, each starting a new line. `@param` for each parameter that needs explanation, not mechanically for all of them. `@returns` when the return value needs saying beyond its type.

## `@deprecated`

Always give the replacement. A deprecation with no alternative is a complaint:

```typescript
/** @deprecated Use `submitReturn()`. Removed in v4. */
```

## TODOs

```typescript
// TODO(OWNER-1234): Remove the fallback once every client is on v3.
```

A bare `// TODO` with no owner or issue is a permanent fixture. Include a ticket reference or a name, and what condition resolves it.

Same for a suppression comment: `@ts-expect-error` needs a reason and an exit condition ([any-and-unknown.md](any-and-unknown.md)).

## Commented-out code

Delete it. Version control has it. Commented-out code is never updated alongside the code around it, so by the time anyone considers restoring it, it no longer works.

## `@fileoverview`

Only when it says something the filename does not. See [file-structure.md](file-structure.md).

## Version notes

Version-agnostic. One adjacent change: 6.0 defaults `types: []`, so a JSDoc reference to a global from an ambient package resolves only if that package is listed ([tsconfig.md](tsconfig.md)).

## Gotchas

- Agent writes types into `@param` or `@returns` - the signature has them, and the copy goes stale
- Agent uses `@private`, `@override`, `@implements` or `@enum` - TypeScript expresses each directly
- Agent writes `/** Gets the name. */` over `getName()` - restates the code
- Agent documents every parameter mechanically - document the ones that need it
- Agent uses `/* … */` for a multi-line implementation note - stack `//` lines
- Agent writes a banner or box comment
- Agent documents *what* the code does rather than *why* - the code already says what
- Agent omits the units on a numeric parameter - put them in the name or the type
- Agent writes `@deprecated` with no replacement
- Agent leaves a bare `// TODO` with no owner, ticket or resolving condition
- Agent leaves commented-out code in place
- Agent writes an `@fileoverview` that restates the filename

## Related

- [file-structure.md](file-structure.md) · [naming.md](naming.md) · [any-and-unknown.md](any-and-unknown.md) · [advanced-types.md](advanced-types.md) · [enums-and-constants.md](enums-and-constants.md)
