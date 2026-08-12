# The OpenAPI Document and the Generated Client

`spring-boot-developer`'s `openapi.md` owns springdoc configuration on the server.
`typescript-developer` owns what good TypeScript looks like. **This page owns the round trip**:
what springdoc actually puts in the document, what the generator makes of it, and the three
places where the generated client is wrong about the server that produced it.

Everything below was measured: a real Boot application, its own `/v3/api-docs`, fed to
`openapi-generator-cli` 7.24.0 with the `typescript-angular` generator. Documents from Boot
3.5.16 with springdoc 2.9.0 and Boot 4.1.0 with springdoc 3.1.0 were **identical**, so the type
mapping story does not change with either major.

## What springdoc emits

| Java | Document |
| ---- | -------- |
| `Long`, `long` | `{"type":"integer","format":"int64"}` |
| `BigDecimal` | `{"type":"number"}` - **no format at all** |
| `Instant` | `{"type":"string","format":"date-time"}` |
| `LocalDateTime` | `{"type":"string","format":"date-time"}` |
| `OffsetDateTime` | `{"type":"string","format":"date-time"}` |
| `ZonedDateTime` | `{"type":"string","format":"date-time"}` |
| `LocalDate` | `{"type":"string","format":"date"}` |
| `LocalTime` | `{"type":"string"}` - no format |
| `Duration` | `{"type":"string"}` - no format |
| `UUID` | `{"type":"string","format":"uuid"}` |
| `byte[]` | `{"type":"string","format":"byte"}` |
| enum | `{"type":"string","enum":["DRAFT","SUBMITTED"]}` |

Two rows are the whole problem:

- **`BigDecimal` is a bare `number`.** It is indistinguishable in the document from a genuine
  `double`. See the fix section: this is why the correction cannot be made client-side.
- **Four different Java types all become `string/date-time`.** `Instant` and `LocalDateTime` mean
  different things - one is a moment, one is ambiguous without a zone - and the document cannot
  tell them apart. A client generated from the document cannot know which it received. See
  [dates-and-times.md](dates-and-times.md).

## What the generator produces

```ts
export interface Types {
    id?: number;              // Long, via integer/int64
    primitiveLong?: number;
    amount?: number;          // BigDecimal, via bare number
    instant?: string;
    date?: string;
    localDateTime?: string;
    localTime?: string;
    uuid?: string;
    bytes?: string;
    status?: Types.StatusEnum;
}
```

Four things to notice, two good and two not:

- **Identifiers and money are `number`.** The corruption documented in
  [type-pipeline.md](type-pipeline.md) is now compiled into the client. Nothing downstream can
  detect it.
- **Every property is optional.** springdoc emitted no `required` array, so the generator marked
  all thirteen `?`. The compiler will not tell you that a mandatory field is missing, which is
  most of the value you were expecting from generating types at all. Fix it on the server, with
  validation annotations or `@Schema(requiredMode = REQUIRED)`, not by hand-editing.
- **Dates come out as `string`, not `Date`.** Good, and worth knowing because it is easy to assume
  otherwise: `typescript-angular` 7.24.0 has no date option in `config-help` and maps both
  `format: date` and `format: date-time` to `string`. A generator that maps them to `Date` would
  reintroduce the date-only shift.
- **Enums become a `const` object plus a union type**, not a TypeScript `enum`, which matches what
  `typescript-developer` requires. No override needed.

## Where the client is wrong about its own server

**`ProblemDetail` is the sharpest case.** springdoc declares it with a `properties` map, because
Spring's `ProblemDetail` class exposes a `getProperties()` getter, so the generator emits:

```ts
export interface ProblemDetail {
    type?: string;
    title?: string | null;
    status?: number;
    detail?: string | null;
    instance?: string | null;
    properties?: { [key: string]: any | null; };
}
```

But the server **flattens** custom properties to the top level. The same application that produced
that document returns:

```json
{"type":"...","title":"Duplicate client","status":422,"detail":"...","instance":"/problem",
 "clientRef":"R-1001","violations":["reference must be unique"]}
```

So `problem.properties.clientRef` compiles and is `undefined` at runtime, and
`problem.clientRef` is correct at runtime and does not compile. **Both directions are broken, and
the document is the thing that is wrong.** Declare your error payloads as your own schema rather
than leaning on the framework's, and see [problem-detail.md](problem-detail.md).

**`Page<T>` is the second case.** Returning `Page<T>` produces `PageItem`, `PageableObject` and
`SortObject` interfaces in the client, so `paged`, `unpaged`, `offset` and `numberOfElements`
become part of your published type surface. [pagination.md](pagination.md) has the fix.

## Fixing it: the document, not the generator

The generator's `--type-mappings` keys are codegen's **internal type names**, not OpenAPI formats.
Measured on 7.24.0:

| Mapping | Effect on `Long` |
| ------- | ---------------- |
| `long=string` | **works** |
| `integer+int64=string` | **works** |
| `int64=string` | no effect |
| `Long=string` | no effect |

For `BigDecimal` **only `number=string` works**, and it maps *every* format-less number to a
string - which is exactly the problem, because springdoc gave `BigDecimal` and a genuine `double`
the same declaration. `decimal=string`, `double=string`, `BigDecimal=string` and `float=string`
all have no effect.

**So fix the server.** Make the document say what you mean:

- Serialise the value as a string and declare it as one, so the document and the wire agree. The
  server-side mechanism is `spring-boot-developer`'s territory; the requirement is that
  `components.schemas` ends up with `{"type":"string"}` for that property.
- Then every generator in every language is correct without flags, and a second consumer of the
  same API does not have to rediscover the workaround.
- Use `long=string` as a stopgap for identifiers only, and only while the document is being fixed.
  It works because `int64` is distinguishable. Money is not, so there is no stopgap for it.

## Regeneration discipline

- **Generate in CI and fail the build on a diff**, or commit the output and regenerate on every
  contract change. Either is fine; "regenerate when someone remembers" is not.
- **Never hand-edit generated output.** Rule 3 of this skill. A hand-edit survives until the next
  generation and then vanishes, usually in someone else's branch.
- **Keep the generated types separate from your domain types.** The generated `Types` is a wire
  shape. Map it at the boundary into something with branded ids and parsed decimals, once.
- **Diff the document, not just the client.** A document diff is reviewable; a regenerated client
  diff is mostly noise, and a breaking change looks identical to a formatting change.

## Version notes

| Concern | Result |
| ------- | ------ |
| springdoc 2.9.0 on Boot 3.5.16 versus springdoc 3.1.0 on Boot 4.1.0 | **Identical** documents for the same types. Nothing in this page changes between the two |
| `typescript-angular` date handling | `string` for both `date` and `date-time` in generator 7.24.0. No date option exists in `config-help` |
| `typescript-angular` enum handling | `const` object plus union type, not `enum` |
| `--type-mappings` key names | Codegen internal names, so `long`, not `int64`. Verify with a generation, because the wrong key fails silently |

The generator is versioned independently of both Angular and Spring Boot, and it is the component
most likely to change behaviour under you. Pin it, and re-check the emitted types on upgrade.

## Gotchas

- Agent trusts the generated client because it came from the server's own document - the
  `ProblemDetail` case above is generated from the document and contradicts the runtime
- Agent hand-edits a generated model to fix a type - gone on the next generation
- Agent adds `--type-mappings=int64=string` and assumes it worked - wrong key, no effect, no error.
  The key is `long`
- Agent maps `number=string` to fix money and silently strings every genuine `double` in the API
- Agent accepts an all-optional generated interface - springdoc emitted no `required` array, so the
  compiler is doing nothing for you. Fix the server
- Agent treats `format: date-time` as meaning an instant - `Instant`, `LocalDateTime`,
  `OffsetDateTime` and `ZonedDateTime` all produce it
- Agent uses the generated wire type as the domain model throughout the app - every component then
  depends on the generator's output
- Agent regenerates and commits without reading the document diff - the breaking change is in the
  document, not in the client
- Agent generates from a document fetched from a running dev server that is behind the branch
- Agent pins nothing, so the client shape changes when the generator does

## Related

- [type-pipeline.md](type-pipeline.md) · [dates-and-times.md](dates-and-times.md) · [problem-detail.md](problem-detail.md) · [pagination.md](pagination.md)
