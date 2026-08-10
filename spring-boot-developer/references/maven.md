# Maven

The rest of this skill is build-tool agnostic. This file and [gradle.md](gradle.md) are the two places build configuration lives.

## The parent

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version><!-- current 4.x --></version>
    <relativePath/>
</parent>

<properties>
    <java.version>21</java.version>
</properties>
```

The parent supplies dependency management, plugin management, sensible compiler settings and resource filtering. If your organisation already has a corporate parent, import the BOM instead:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-dependencies</artifactId>
            <version><!-- current 4.x --></version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

You then lose the plugin management, so `spring-boot-maven-plugin` needs its version declared.

**Declare no version for anything the BOM manages** - Hibernate, Jackson, Testcontainers, JUnit, Micrometer and several hundred others. Overriding one is how you get a `NoSuchMethodError` at runtime that the build never warned about. See [boot-versions.md](boot-versions.md).

## Starters

One starter per technology. Boot 4 renamed several; the old names still resolve but are deprecated.

| Need | Starter |
|---|---|
| Web / REST | `spring-boot-starter-webmvc` (was `-web`) |
| JPA | `spring-boot-starter-data-jpa` |
| **Flyway** | `spring-boot-starter-flyway` - **not transitive on Boot 4**; without it migrations silently never run |
| Validation | `spring-boot-starter-validation` - not brought in by the web starter |
| Security | `spring-boot-starter-security` |
| OAuth2 resource server | `spring-boot-starter-security-oauth2-resource-server` (was `-oauth2-resource-server`) |
| AOP | `spring-boot-starter-aspectj` (was `-aop`) |
| Actuator | `spring-boot-starter-actuator` |
| Testing (web) | `spring-boot-starter-webmvc-test` |
| Testing (persistence) | `spring-boot-starter-data-jpa-test` |

The Boot 4 `-test` starters are self-contained - do **not** add `spring-boot-starter-test` alongside one. `spring-boot-starter-classic` exists as a migration aid, not a destination.

## The Boot plugin

```xml
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
    <configuration>
        <image>
            <name>${docker.registry}/${project.artifactId}:${project.version}</name>
        </image>
    </configuration>
    <executions>
        <execution>
            <goals>
                <goal>build-info</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

`build-info` generates `META-INF/build-info.properties`, which Actuator exposes at `/actuator/info` - so the running application can tell you exactly which version it is ([observability.md](observability.md)). It costs nothing and settles a surprising number of incidents.

In a multi-module build, the plugin belongs **only in the runnable module**. In the parent it tries to repackage every module, including the ones that are libraries.

**Optional dependencies are excluded from the repackaged jar on Boot 4.** If you rely on one at runtime, set `<includeOptional>true</includeOptional>`.

## Plugins worth configuring

None of these are required. Each buys something specific.

### Configuration metadata

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-configuration-processor</artifactId>
    <optional>true</optional>
</dependency>
```

Generates IDE autocomplete and documentation for your `@ConfigurationProperties` types ([configuration.md](configuration.md)). Cheapest win in this file.

### Test coverage

```xml
<plugin>
    <groupId>org.jacoco</groupId>
    <artifactId>jacoco-maven-plugin</artifactId>
    <executions>
        <execution><goals><goal>prepare-agent</goal></goals></execution>
        <execution>
            <id>report</id>
            <phase>verify</phase>
            <goals><goal>report</goal></goals>
        </execution>
        <execution>
            <id>check</id>
            <phase>verify</phase>
            <goals><goal>check</goal></goals>
            <configuration>
                <rules>
                    <rule>
                        <element>BUNDLE</element>
                        <limits>
                            <limit>
                                <counter>LINE</counter>
                                <value>COVEREDRATIO</value>
                                <minimum>0.80</minimum>
                            </limit>
                        </limits>
                    </rule>
                </rules>
            </configuration>
        </execution>
    </executions>
</plugin>
```

Coverage is a **floor that stops regression**, not a target. A team optimising for the number writes tests that execute code without asserting anything, and the metric goes up while the suite gets worse. Set it near where you already are and ratchet slowly.

### Formatting

```xml
<plugin>
    <groupId>com.diffplug.spotless</groupId>
    <artifactId>spotless-maven-plugin</artifactId>
    <configuration>
        <java>
            <importOrder/>
            <removeUnusedImports/>
            <formatAnnotations/>
            <palantirJavaFormat/>
        </java>
    </configuration>
    <executions>
        <execution>
            <goals><goal>check</goal></goals>
            <phase>validate</phase>
        </execution>
    </executions>
</plugin>
```

A build-time formatter, not a runtime dependency. Bind `check` to the build and run `spotless:apply` locally; that ends formatting discussion in review permanently. Any consistent formatter does the job - the value is in having one, not in which.

### Build provenance

```xml
<plugin>
    <groupId>io.github.git-commit-id</groupId>
    <artifactId>git-commit-id-maven-plugin</artifactId>
    <configuration>
        <failOnNoGitDirectory>false</failOnNoGitDirectory>
        <generateGitPropertiesFile>true</generateGitPropertiesFile>
        <includeOnlyProperties>
            <includeOnlyProperty>^git.branch$</includeOnlyProperty>
            <includeOnlyProperty>^git.commit.id.abbrev$</includeOnlyProperty>
            <includeOnlyProperty>^git.commit.time$</includeOnlyProperty>
        </includeOnlyProperties>
    </configuration>
    <executions>
        <execution><goals><goal>revision</goal></goals></execution>
    </executions>
</plugin>
```

Surfaces the exact commit at `/actuator/info`. `failOnNoGitDirectory=false` keeps builds working from a source archive. Restrict the properties - the full set includes the committer's name and email, which you probably do not want on an endpoint.

## Multi-module

```
my-app/
├── pom.xml                 (packaging: pom)
├── my-app-domain/          pure Java
├── my-app-application/     use cases - depends on domain
├── my-app-infrastructure/  JPA, HTTP clients - depends on domain
└── my-app-web/             the runnable Boot application
```

| Module | May depend on |
|---|---|
| `domain` | nothing |
| `application` | `domain` |
| `infrastructure` | `domain`, `application` |
| `web` | all |

- `<dependencyManagement>` in the parent, never `<dependencies>` - the latter puts the dependency on every module's classpath.
- `${project.version}` for inter-module dependencies.
- `spring-boot-maven-plugin` in the runnable module only.
- Maven does not prevent a cycle from being *designed*, only from being built. Enforce direction with ArchUnit ([archunit.md](archunit.md)).

**Reach for multi-module deliberately.** It is rung four of the ladder in [code-organization.md](code-organization.md) - real enforcement, real ceremony. A single module with feature packages is the right default until a boundary genuinely needs the build to enforce it.

## Reproducibility and hygiene

- **Commit the Maven wrapper** (`mvnw`, `mvnw.cmd`, `.mvn/`). Everyone and CI then build with the same Maven version.
- `mvn verify`, not `mvn install`, in CI - `install` writes to a shared local repository and creates order dependencies between builds.
- `mvn dependency:tree` when a version surprises you; `mvn dependency:analyze` finds declared-unused and used-undeclared dependencies.
- Add `dependency-check` or your platform's scanner to CI. A dependency with a known CVE is the most likely security problem in a typical Spring application.

## If on Boot 3.5.x

Same structure. The differences are starter names (`-web`, `-aop`, `-oauth2-*` without the `security-` prefix), Flyway arriving transitively so no explicit starter is needed, `spring-boot-starter-test` rather than the per-technology `-test` starters, and optional dependencies being included in the repackaged jar by default.

## Gotchas

- Agent declares a version for a BOM-managed dependency - the BOM decides; overriding causes runtime `NoSuchMethodError`
- Agent adds `spring-boot-starter-data-jpa` and expects Flyway to run on Boot 4 - add `spring-boot-starter-flyway`
- Agent assumes the web starter brings validation - add `spring-boot-starter-validation`
- Agent adds `spring-boot-starter-test` next to a Boot 4 `-test` starter - they are self-contained
- Agent uses `spring-boot-starter-web` / `-aop` / `-oauth2-resource-server` on Boot 4 - renamed (old names deprecated, still resolve)
- Agent puts `spring-boot-maven-plugin` in the parent POM - runnable module only
- Agent puts `<dependencies>` in the parent instead of `<dependencyManagement>` - adds them to every module
- Agent relies on an optional dependency at runtime on Boot 4 - set `<includeOptional>true</includeOptional>`
- Agent sets a coverage target well above current coverage - the team games the metric
- Agent publishes the full git-commit-id property set - it includes committer name and email
- Agent runs `mvn install` in CI - use `verify`
- Agent omits the Maven wrapper - builds differ between machines
- Agent reaches for multi-module before a boundary needs enforcing - feature packages first

## Related

- [gradle.md](gradle.md) · [boot-versions.md](boot-versions.md) · [code-organization.md](code-organization.md) · [containerization-and-native.md](containerization-and-native.md) · [observability.md](observability.md) · [configuration.md](configuration.md)
