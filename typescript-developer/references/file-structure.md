# File Structure

## Encoding and characters

Source files are **UTF-8**.

The only whitespace character permitted in source is the ASCII horizontal space (0x20). Tabs are not used for indentation, and any other whitespace inside a string literal must be escaped - a literal tab or non-breaking space in a string is invisible in review and survives into production.

Prefer named escapes over numeric ones: `\'`, `\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, `\v` rather than `\x0a` or `
`.

Non-ASCII characters are allowed directly when they are what the code means:

```typescript
const units = 'μs';                     // clear
const units = 'μs';                // obscures the intent
const zeroWidth = '​';             // correct - a printed ZWSP is invisible
```

The rule is legibility: use the character when a reader can see it, the escape when they cannot.

## Order

Exactly one blank line between each section that is present:

1. Copyright, if the project requires it
2. `@fileoverview` JSDoc, if present
3. Imports
4. Implementation

```typescript
/**
 * @fileoverview Parses and validates MTD submission payloads.
 */

import {readFile} from 'node:fs/promises';

import type {Submission} from './submission.js';

export async function loadSubmission(path: string): Promise<Submission> { … }
```

## `@fileoverview`

Optional, and worth having only when it says something the filename does not. A file called `submission-parser.ts` does not need `@fileoverview Submission parser.`

Use it for the things the reader cannot infer: what the file is *for*, dependencies or side effects that would surprise, and any usage constraint. Keep it short - a file that needs paragraphs of preamble is usually two files.

## File names

`kebab-case.ts`, matching the primary export where there is one - `order-service.ts` exports `OrderService`. Test files sit beside the source as `order-service.test.ts` (or `.spec.ts`, consistently one or the other across the project).

Do not name a file `index.ts` to make an import shorter. A tree of `index.ts` files makes every editor tab read `index.ts` and every stack trace ambiguous. Barrel files have a narrower legitimate use - see [imports-and-exports.md](imports-and-exports.md).

## One concept per file

Files are not size-limited, but a file exporting several unrelated things is harder to name and harder to import from. If naming the file requires `and`, split it.

## Version notes

Version-agnostic. Encoding, ordering and naming are unchanged across 5.x, 6.0 and 7.0.

One adjacent change worth knowing: with `moduleDetection: "force"` - recommended in [tsconfig.md](tsconfig.md) - every file is a module regardless of whether it imports anything, so a file cannot accidentally contribute to global scope.

## Gotchas

- Agent puts imports above the `@fileoverview` - the order is copyright, overview, imports, implementation
- Agent writes an `@fileoverview` that restates the filename - omit it unless it adds something
- Agent leaves a literal tab or non-breaking space inside a string - escape it; it is invisible in review
- Agent escapes printable non-ASCII characters - write `'μs'`, not `'μs'`
- Agent uses a numeric escape where a named one exists - `\n`, not `\x0a`
- Agent creates `index.ts` files to shorten import paths - every tab and stack frame then reads `index.ts`
- Agent puts several unrelated exports in one file - if the name needs "and", split it

## Related

- [imports-and-exports.md](imports-and-exports.md) · [naming.md](naming.md) · [comments-and-jsdoc.md](comments-and-jsdoc.md) · [tsconfig.md](tsconfig.md)
