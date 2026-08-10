# Local Development

The goal is that a new developer clones the repository, runs one command, and has a working application with a real database. Anything else - a wiki page of setup steps, a shared development database, "ask someone for the credentials" - costs a day per joiner and drifts out of date.

## Docker Compose support

Boot starts the services in your `compose.yaml` when the application starts, and wires the connection details automatically - no `spring.datasource.url` in any properties file.

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-docker-compose</artifactId>
    <scope>runtime</scope>
    <optional>true</optional>
</dependency>
```

`runtime` and `optional` matter: the dependency must not reach production, where the services are real.

```yaml
# compose.yaml
services:
  postgres:
    image: 'postgres:18-alpine'
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - '5432'

  redis:
    image: 'redis:7-alpine'
    ports:
      - '6379'

  mailpit:
    image: 'axllent/mailpit:v1.29'
    ports:
      - '1025'
      - '8025:8025'      # web UI on a fixed port so you can open it
```

Boot detects these by image name and applies the same `ConnectionDetails` mechanism as `@ServiceConnection` in tests ([testcontainers.md](testcontainers.md)) - the two are the same machinery, which is why local and test environments stay consistent for free.

**Leave container ports unmapped** (`- '5432'`, not `- '5432:5432'`) unless you need to attach a client. Boot reads the mapped port; a fixed one clashes with anything else running Postgres.

**Match the image tags to production.** Developing against PostgreSQL 18 and deploying to 15 is the divergence this setup exists to prevent.

```yaml
spring:
  docker:
    compose:
      lifecycle-management: start_and_stop   # or start_only to leave them running
```

`start_only` is often nicer day to day - containers survive application restarts, so you keep your data and skip the startup wait.

## Devtools

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-devtools</artifactId>
    <scope>runtime</scope>
    <optional>true</optional>
</dependency>
```

Restarts the application when classes change and disables template and static-resource caching. Automatically disabled in a fully packaged application, and excluded from the repackaged jar - but keep `optional` so it cannot leak into another module's classpath.

Devtools is a **local convenience, not a development platform**. Its restart is a classloader trick that occasionally produces confusing failures - `ClassCastException` between two copies of the same class is the classic. If something inexplicable happens, do a full restart before debugging it.

## Profiles

```
application.yml            shared defaults - safe if run with no profile
application-local.yml      developer machine
application-test.yml       automated tests
application-prod.yml       production (no secrets)
```

Run with `-Dspring-boot.run.profiles=local`, or set `SPRING_PROFILES_ACTIVE=local`.

The no-profile default must be **safe**. If someone runs the jar without a profile it must not reach production. See [configuration.md](configuration.md).

Secrets never live in any of these files - a gitignored `.env` or your platform's secret store.

## Seed data

```java
@Component
@Profile("local")
class DevDataSeeder implements ApplicationRunner {

    private final CustomerRepository customers;

    DevDataSeeder(CustomerRepository customers) {
        this.customers = customers;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (customers.count() > 0) {
            return;
        }
        customers.save(Customer.create(EmailAddress.of("dev@example.com")));
    }
}
```

Profile-scoped and idempotent. Development data does **not** belong in a Flyway migration - migrations run everywhere, including production, and cannot be changed afterwards ([flyway.md](flyway.md)).

## A task runner

A short list of named commands beats a wiki page. [Task](https://taskfile.dev/) is one option; a `Makefile` or a `scripts/` directory works as well. What matters is that the commands are in the repository and discoverable.

```yaml
# Taskfile.yml
version: '3'

vars:
  MVNW: '{{if eq OS "windows"}}mvnw.cmd{{else}}./mvnw{{end}}'

tasks:
  default:
    cmds: [ task: --list ]

  build:
    desc: Format, compile, and run all tests
    cmds:
      - "{{.MVNW}} clean spotless:apply verify"

  test:
    desc: Run tests only
    cmds:
      - "{{.MVNW}} test"

  run:
    desc: Run the application with the local profile
    cmds:
      - "{{.MVNW}} spring-boot:run -Dspring-boot.run.profiles=local"

  image:
    desc: Build an OCI image with buildpacks
    cmds:
      - "{{.MVNW}} spring-boot:build-image -DskipTests"

  db:
    desc: Open a psql shell against the local database
    cmds:
      - docker compose exec postgres psql -U app -d app
```

Give every task a `desc` so `task --list` is the documentation. The wrapper handles the Windows/POSIX split, so the same commands work for everyone ([maven.md](maven.md)).

## Fast feedback

- Keep `spring.jpa.open-in-view=false` locally too. It is the setting that makes N+1 problems fail loudly in development instead of quietly in production ([spring-data-jpa.md](spring-data-jpa.md)).
- `logging.level.org.hibernate.SQL=DEBUG` when you need to see queries. Turn it off again - it is noisy enough to hide real output.
- Boot's failure analyzers turn common startup failures into readable messages. Read the whole message before scrolling to the stack trace; the answer is usually in it.
- `spring.jpa.hibernate.ddl-auto=validate` locally as well, so schema drift fails at startup rather than at the first query.

## If on Boot 3.5.x

Docker Compose support (3.1+), devtools, profiles and `ConnectionDetails` all behave identically. The only difference is elsewhere in the build - Flyway arriving transitively, starter names ([boot-versions.md](boot-versions.md)).

## Gotchas

- Agent puts `spring-boot-docker-compose` on `implementation` - it must be `runtime` and `optional` so it cannot reach production
- Agent maps fixed host ports in `compose.yaml` - clashes with anything else running the same service
- Agent uses different image versions locally and in production - that is the divergence this setup prevents
- Agent adds `spring.datasource.url` alongside Compose support - Boot wires it; the manual value can conflict
- Agent seeds development data in a Flyway migration - it reaches production and cannot be changed
- Agent writes a non-idempotent seeder - it duplicates rows on every restart
- Agent commits a `.env` or puts secrets in `application-local.yml`
- Agent makes the no-profile default point at production
- Agent debugs a devtools classloader oddity as if it were an application bug - do a full restart first
- Agent turns `open-in-view` on locally to make a `LazyInitializationException` go away - that hides an N+1 until production

## Related

- [configuration.md](configuration.md) · [flyway.md](flyway.md) · [testcontainers.md](testcontainers.md) · [maven.md](maven.md) · [containerization-and-native.md](containerization-and-native.md)
