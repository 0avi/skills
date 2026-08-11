## Available skills

| Skill | What it does |
| ----- | ------------ |
| [`ngrx-signal-store-developer`](ngrx-signal-store-developer/SKILL.md) | Generates and refactors NgRx `@ngrx/signals` **SignalStore** code and provides architectural guidance for `signalStore`, `withState` / `withComputed` / `withMethods` / `withProps` / `withHooks`, `rxMethod` / `signalMethod`, `withEntities`, the events plugin, reusable `signalStoreFeature`, and `TestBed` testing. This is the signals-based store, **not** the Redux-style `@ngrx/store`; the skill covers when to prefer each and how to migrate. |
| [`angular-webpack-esbuild-migration`](angular-webpack-esbuild-migration/SKILL.md) | Migrates an Angular project off a webpack-based builder (`@angular-builders/custom-webpack`, or `@angular-devkit/build-angular:browser`) to Angular's native esbuild builder - the **application builder** on 17+, or `browser-esbuild` as a stepping stone on 16. Covers the builder swap, `outputPath`, polyfills, `moduleResolution: "bundler"`, SCSS `~` paths, the optional Karma → Jest move, and every compiler error the stricter pipeline surfaces. |
| [`typescript-developer`](typescript-developer/SKILL.md) | Generates modern TypeScript and provides architectural guidance, derived from the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) and extended to current practice: tsconfig and strictness flags, ES modules, classes and `#private`, the type system (`satisfies`, nullability, generics, `any` vs `unknown`, branded types, discriminated unions), literal unions in place of enums, decorators, async and promises, `using` resource management, naming, JSDoc and testing. Targets TypeScript 6.0 with 7.0 readiness. Every departure from the Google guide is recorded in [google-style-deltas.md](typescript-developer/references/google-style-deltas.md). |
| [`postgresql-developer`](postgresql-developer/SKILL.md) | Designs PostgreSQL schemas from requirements, makes database architecture decisions, writes SQL, and diagnoses slow queries, for **PostgreSQL 14-18**. Covers schema design from a spec, multi-tenancy (shared schema + RLS, schema-per-tenant, database-per-tenant), data types and keys, constraints, SQL authoring (joins, aggregation, window functions, CTEs, upserts, keyset pagination, full-text search, JSONB), indexing and `EXPLAIN`, statistics and the planner, transactions and isolation, locking, MVCC and vacuum, lock-aware migrations, roles and row-level security, connection pooling, configuration, backups, replication, and testing with Testcontainers. Pairs with [`java-developer`](java-developer/SKILL.md) and [`spring-boot-developer`](spring-boot-developer/SKILL.md). |
| [`java-developer`](java-developer/SKILL.md) | Generates modern Java code and provides architectural guidance for Java 8-25: immutability, records, sealed types, pattern matching, `switch` expressions, `Optional` vs `null`, `var`, text blocks, JPMS modules, bean generation, data-oriented programming, and version migration. Codifies Stephen Colebourne's _New Java Best Practices_. |
| [`spring-boot-developer`](spring-boot-developer/SKILL.md) | Generates modern Spring Boot code and provides architectural guidance for Boot **4.x and 3.5.x** in one skill: package structure and Spring Modulith, REST APIs with RFC 9457 `ProblemDetail`, Jackson 3, Spring Data JPA, transactions, Flyway, caching, Spring Security 7, JWT and OAuth2, HTTP interface clients, resilience, messaging, configuration, Actuator observability, virtual threads, Spring Batch 6, Spring AI and MCP, and Testcontainers-based testing. Pairs with [`java-developer`](java-developer/SKILL.md). |

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
