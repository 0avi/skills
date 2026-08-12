# Pagination Across the Wire

`postgresql-developer` owns keyset pagination and why `OFFSET` degrades on large tables.
`spring-boot-developer` owns repository and controller mechanics. **This page owns the envelope**:
what a `Page<T>` actually looks like on the wire, why the default shape is a liability in a
contract, and what the client should be typed against.

Every JSON body below was captured over real HTTP from a Spring Boot application, on 3.5.16 and
4.1.0.

## The default envelope leaks the implementation

A controller returning `Page<Item>` with no configuration, on **Boot 3.5.16**:

```json
{"content":[{"id":1,"name":"a"},{"id":2,"name":"b"}],
 "pageable":{"pageNumber":0,"pageSize":20,
             "sort":{"empty":true,"sorted":false,"unsorted":true},
             "offset":0,"unpaged":false,"paged":true},
 "last":false,"totalElements":30,"totalPages":2,"first":true,"size":20,"number":0,
 "sort":{"empty":true,"sorted":false,"unsorted":true},
 "numberOfElements":2,"empty":false}
```

Thirteen top-level keys, of which the client needs perhaps four. `pageable`, `paged`, `unpaged`,
`numberOfElements`, `empty` and the two `sort` objects are the internal state of `PageImpl`, a
Spring Data class, published as your API. Nothing in your codebase declares this shape, so
nothing protects it: it changes when Spring Data changes.

It already has. **Boot 4.1.0 returns the same keys in alphabetical order:**

```json
{"content":[...],"empty":false,"first":true,"last":false,"number":0,"numberOfElements":2,
 "pageable":{"offset":0,"pageNumber":0,"pageSize":20,"paged":true,
             "sort":{"empty":true,"sorted":false,"unsorted":true},"unpaged":false},
 "size":20,"sort":{...},"totalElements":30,"totalPages":2}
```

Semantically identical, textually different. Any snapshot or golden-file test over the raw body
fails on upgrade, and so does anything that parsed by position rather than by key.

## Return `PagedModel<T>` explicitly

`new PagedModel<>(page)` as the controller's return type produces this, **byte-identical on
3.5.16 and 4.1.0**:

```json
{"content":[{"id":1,"name":"a"},{"id":2,"name":"b"}],
 "page":{"size":20,"number":0,"totalElements":30,"totalPages":2}}
```

Four metadata fields, nested under `page`, stable across both majors. This is the shape to put in
the OpenAPI document and generate a client against.

## The property that only works on one major

Spring Data documents `spring.data.web.pageable.serialization-mode=VIA_DTO` to make `Page`
returns serialise as `PagedModel` without changing the controller signature. Measured:

| Boot version | With `spring-boot-starter-web` and `spring-data-commons` | Result |
| ------------ | -------------------------------------------------------- | ------ |
| 3.5.16 | property set | Works. `Page<Item>` returns the `PagedModel` envelope |
| 4.1.0 | property set | **Silently ignored.** The full `PageImpl` envelope is still returned |

The cause is not that the property was removed. **Boot 4 split the single
`spring-boot-autoconfigure` jar into per-technology modules**, and
`spring.data.web.pageable.serialization-mode` now ships in **`spring-boot-data-commons`**. An
application depending only on `spring-boot-starter-web` and `spring-data-commons` has the
`PagedModel` class but not the auto-configuration that reads the property, so the property binds to
nothing.

Confirmed by experiment, not inference: adding `spring-boot-data-commons` to the same Boot 4.1.0
project and changing nothing else makes the property take effect, and `Page<Item>` then returns
`{"content":[...],"page":{"size":20,"number":0,"totalElements":30,"totalPages":2}}`.

**This generalises well beyond pagination.** Spring binds properties silently: an unrecognised
one is ignored, not rejected. So on a Boot 3 to Boot 4 upgrade, any `spring.*` property that
quietly stops working is probably declared in a module the application no longer depends on.
Prefer the explicit return type over the property, because a wrong return type does not compile
and a missing property says nothing at all.

## What the client should be typed against

- **Type the envelope explicitly** in the OpenAPI document. Do not let a generator infer it from
  a `PageImpl` example, or the thirteen-key shape becomes your published contract.
- **Never send `sort` state back** as the client received it. The sort belongs in the request as
  a simple parameter the server validates, not as a round-tripped object.
- **`totalElements` costs a `COUNT`.** For an infinite-scroll or keyset list, ask whether the
  client needs a total at all; if it only needs "is there more", a boolean is cheaper than a
  count over a large table. `postgresql-developer` has the query side.
- **Keyset pagination does not fit this envelope.** A keyset response is a page of rows plus an
  opaque cursor, with no page number and usually no total. Model it as its own response type with
  a `nextCursor` string, and keep the cursor opaque to the client so the server can change what it
  encodes.

## Version notes

| Concern | 3.5.16 | 4.1.0 |
| ------- | ------ | ----- |
| Default `Page<T>` serialisation | Full `PageImpl` envelope, declaration order | Full `PageImpl` envelope, **alphabetical** order |
| `PagedModel<T>` as return type | `{content, page:{size,number,totalElements,totalPages}}` | Identical |
| `spring.data.web.pageable.serialization-mode=VIA_DTO` | Works | Ignored unless `spring-boot-data-commons` is a dependency |

Widely repeated claim, **measured false on both versions**: that Boot 3.3 made `PagedModel` the
default for applications not using `@EnableSpringDataWebSupport`. The default is still the full
`PageImpl` envelope on 3.5.16 and 4.1.0. Do not assume the shape; request it and look.

## Gotchas

- Agent returns `Page<T>` from a controller and treats the response as an API - that publishes
  Spring Data's internals. Return `PagedModel<T>`
- Agent sets `serialization-mode=VIA_DTO` on Boot 4 and assumes it took effect - it binds to
  nothing without `spring-boot-data-commons`. Check the response, not the property
- Agent writes a snapshot test over the raw page body - key order changed between 3.5 and 4.1, so
  it fails on upgrade for no semantic reason
- Agent types the client from the default envelope - `pageable`, `paged`, `unpaged` and
  `numberOfElements` then appear in the generated TypeScript, and removing them later is a
  breaking change
- Agent maps `totalElements` to a TS `number` - it is a count and fits a double, so this one is
  fine. Do not reflexively string it
- Agent round-trips the `sort` object back to the server as a filter
- Agent adds `totalElements` to a keyset endpoint - the count defeats the reason for using keyset
- Agent exposes the keyset cursor as a structured object - now the encoding is part of the
  contract. Keep it an opaque string
- Agent uses `number` for the page index client-side and `page` in the query string, or the
  reverse - the envelope says `number`, the request parameter is `page`. They are different names
  for the same thing and the mismatch is a common off-by-one
- Agent assumes `size` in the response equals the requested size - it is the requested page size,
  not the number of elements returned. That is `numberOfElements`, or `content.length`

## Related

- [type-pipeline.md](type-pipeline.md) · [problem-detail.md](problem-detail.md)
