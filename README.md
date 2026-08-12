## Available skills

| Skill | What it does |
| ----- | ------------ |
| [`ngrx-signal-store-developer`](ngrx-signal-store-developer/SKILL.md) | Generates and refactors NgRx `@ngrx/signals` **SignalStore** code and provides architectural guidance for `signalStore`, `withState` / `withComputed` / `withMethods` / `withProps` / `withHooks`, `rxMethod` / `signalMethod`, `withEntities`, the events plugin, reusable `signalStoreFeature`, and `TestBed` testing. This is the signals-based store, **not** the Redux-style `@ngrx/store`; the skill covers when to prefer each and how to migrate. |
| [`angular-webpack-esbuild-migration`](angular-webpack-esbuild-migration/SKILL.md) | Migrates an Angular project off a webpack-based builder (`@angular-builders/custom-webpack`, or `@angular-devkit/build-angular:browser`) to Angular's native esbuild builder - the **application builder** on 17+, or `browser-esbuild` as a stepping stone on 16. Covers the builder swap, `outputPath`, polyfills, `moduleResolution: "bundler"`, SCSS `~` paths, the optional Karma → Jest move, and every compiler error the stricter pipeline surfaces. |
| [`typescript-developer`](typescript-developer/SKILL.md) | Generates modern TypeScript and provides architectural guidance, derived from the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) and extended to current practice: tsconfig and strictness flags, ES modules, classes and `#private`, the type system (`satisfies`, nullability, generics, `any` vs `unknown`, branded types, discriminated unions), literal unions in place of enums, decorators, async and promises, `using` resource management, naming, JSDoc and testing. Targets TypeScript 6.0 with 7.0 readiness. Every departure from the Google guide is recorded in [google-style-deltas.md](typescript-developer/references/google-style-deltas.md). |
| [`postgresql-developer`](postgresql-developer/SKILL.md) | Designs PostgreSQL schemas from requirements, makes database architecture decisions, writes SQL, and diagnoses slow queries, for **PostgreSQL 14-18**. Covers schema design from a spec, multi-tenancy (shared schema + RLS, schema-per-tenant, database-per-tenant), data types and keys, constraints, SQL authoring (joins, aggregation, window functions, CTEs, upserts, keyset pagination, full-text search, JSONB), indexing and `EXPLAIN`, statistics and the planner, transactions and isolation, locking, MVCC and vacuum, lock-aware migrations, roles and row-level security, connection pooling, configuration, backups, replication, and testing with Testcontainers. Pairs with [`java-developer`](java-developer/SKILL.md) and [`spring-boot-developer`](spring-boot-developer/SKILL.md). |
| [`java-developer`](java-developer/SKILL.md) | Generates modern Java code and provides architectural guidance for Java 8-25: immutability, records, sealed types, pattern matching, `switch` expressions, `Optional` vs `null`, `var`, text blocks, JPMS modules, bean generation, data-oriented programming, and version migration. Every version floor is verified by compiling the idiom at each release from 8 to 25. |
| [`spring-boot-developer`](spring-boot-developer/SKILL.md) | Generates modern Spring Boot code and provides architectural guidance for Boot **4.x and 3.5.x** in one skill: package structure and Spring Modulith, REST APIs with RFC 9457 `ProblemDetail`, Jackson 3, Spring Data JPA, transactions, Flyway, caching, Spring Security 7, JWT and OAuth2, HTTP interface clients, resilience, messaging, configuration, Actuator observability, virtual threads, Spring Batch 6, Spring AI and MCP, and Testcontainers-based testing. Pairs with [`java-developer`](java-developer/SKILL.md). |
| [`angular-spring-contract`](angular-spring-contract/SKILL.md) | Owns the **contract** between an Angular frontend and a Spring Boot backend, and nothing inside either: the OpenAPI document and what the generator makes of it, the Postgres to Java to wire to TypeScript type pipeline, dates and times, RFC 9457 `ProblemDetail` on the client, auth end to end (token storage, single-flight refresh, 401 mid-request, guards), pagination envelopes, optimistic concurrency, upload limits, and `traceparent` propagation. Install it **alongside** the skills above; it defers everything inside a single layer to them. Every wire format was captured from running Spring Boot 3.5.16 and 4.1.0 applications. |
| [`angular-accessibility`](angular-accessibility/SKILL.md) | Takes an Angular application to **WCAG 2.2 AA**, covering what sits outside a single widget: focus and announcement across route changes and dialogs, perceivable form errors, colour and target size, the criteria new in 2.2, and what automated tooling provably cannot see. A deliberate **gap-filler** for the official [`angular-developer`](https://github.com/angular/skills) skill, which owns widget-level ARIA and is never restated here. Rule counts and contrast ratios are computed, not asserted. |

## Using these skills

Agent Skills are designed to be used with agentic coding tools like Claude Code, Codex, Gemini CLI, Antigravity and more. Activating a skill loads the specific instructions and resources needed for that task.

To use these skills in your own environment you may follow the instructions for your specific tool or use a community tool like [skills.sh](https://skills.sh).

<details open>
<summary><b>npm</b></summary>

```bash
npx skills add https://github.com/0avi/skills
```

</details>

<details>
<summary><b>pnpm</b></summary>

```bash
pnpm dlx skills add https://github.com/0avi/skills
```

</details>

## License

[MIT](LICENSE) © 2026 Avinay Basnet.
