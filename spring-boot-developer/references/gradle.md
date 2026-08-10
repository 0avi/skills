# Gradle

The Gradle equivalent of [maven.md](maven.md). Read that file for the reasoning; this one is the syntax and the Gradle-specific traps.

Use the **Kotlin DSL** (`build.gradle.kts`) for new projects - it gives type-safe accessors, real IDE completion and errors at configuration time rather than at task execution.

## Plugins and dependency management

```kotlin
plugins {
    java
    id("org.springframework.boot") version "<current 4.x>"
    id("io.spring.dependency-management") version "<current>"
}

group = "com.example"
version = "1.0.0-SNAPSHOT"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}
```

The **toolchain** is the important line. It pins the JDK that compiles the code, downloading it if necessary, so every machine and CI agent builds identically. `sourceCompatibility` only sets the bytecode level and leaves the compiling JDK to chance - java-developer makes the same point.

`io.spring.dependency-management` applies the Boot BOM so versions are omitted below. Alternatively use Gradle's native platform support:

```kotlin
dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:<current 4.x>"))
}
```

Either works. Do not use both.

## Dependencies

```kotlin
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")

    runtimeOnly("org.postgresql:postgresql")
    runtimeOnly("org.flywaydb:flyway-database-postgresql")

    annotationProcessor("org.springframework.boot:spring-boot-configuration-processor")

    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-postgresql")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
```

The starter table in [maven.md](maven.md) applies unchanged - including that **Flyway is not transitive on Boot 4**.

Use the right configuration; this is where Gradle differs most from Maven:

| Configuration | Meaning |
|---|---|
| `implementation` | Needed to compile and run. Not exposed to consumers |
| `api` | Needed to compile and **exposed** to consumers (java-library plugin only) |
| `runtimeOnly` | Needed at runtime only - JDBC drivers, Flyway database modules |
| `compileOnly` | Needed to compile only |
| `annotationProcessor` | Runs at compile time |
| `testImplementation` / `testRuntimeOnly` | The test equivalents |

Putting everything on `implementation` works but slows incremental builds; `api` in a library leaks your dependencies into every consumer's compile classpath, so reach for it deliberately.

## Tests

```kotlin
tasks.withType<Test> {
    useJUnitPlatform()
    testLogging {
        events("passed", "skipped", "failed")
        exceptionFormat = TestExceptionFormat.FULL
    }
}
```

`useJUnitPlatform()` is **required** - without it Gradle looks for JUnit 4 and reports "no tests found" while every test is silently skipped. This is the single most common Gradle-with-Spring-Boot mistake.

`exceptionFormat = FULL` gives you the whole stack trace in CI output, which is the difference between diagnosing a failure from the log and having to reproduce it.

## The Boot plugin

```kotlin
springBoot {
    buildInfo()
}

tasks.named<BootBuildImage>("bootBuildImage") {
    imageName = "${System.getenv("DOCKER_REGISTRY")}/${project.name}:${project.version}"
}
```

`buildInfo()` generates the build metadata Actuator exposes at `/actuator/info` ([observability.md](observability.md)).

`bootBuildImage` builds an OCI image with buildpacks - no Dockerfile ([containerization-and-native.md](containerization-and-native.md)).

## Coverage and formatting

```kotlin
plugins {
    jacoco
    id("com.diffplug.spotless") version "<current>"
}

tasks.jacocoTestCoverageVerification {
    violationRules {
        rule {
            limit {
                counter = "LINE"
                value = "COVEREDRATIO"
                minimum = "0.80".toBigDecimal()
            }
        }
    }
}

tasks.check {
    dependsOn(tasks.jacocoTestCoverageVerification)
}

spotless {
    java {
        importOrder()
        removeUnusedImports()
        formatAnnotations()
        palantirJavaFormat()
    }
}
```

`tasks.check { dependsOn(...) }` is required - unlike Maven's phase binding, a Gradle verification task does nothing unless something depends on it. A configured-but-unwired JaCoCo rule is a common false sense of security.

The coverage-as-a-floor argument from [maven.md](maven.md) applies.

## Multi-project

```kotlin
// settings.gradle.kts
rootProject.name = "my-app"
include("domain", "application", "infrastructure", "web")
```

```kotlin
// build.gradle.kts (root)
plugins {
    id("org.springframework.boot") version "<current 4.x>" apply false
    id("io.spring.dependency-management") version "<current>" apply false
}

subprojects {
    apply(plugin = "java")
    apply(plugin = "io.spring.dependency-management")

    the<DependencyManagementExtension>().imports {
        mavenBom(SpringBootPlugin.BOM_COORDINATES)
    }
}
```

```kotlin
// domain/build.gradle.kts - pure Java, no Spring
dependencies { }

// web/build.gradle.kts - the runnable application
plugins {
    id("org.springframework.boot")
}

dependencies {
    implementation(project(":application"))
    implementation(project(":infrastructure"))
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
}
```

`apply false` at the root then applying the Boot plugin only in the runnable module is the Gradle equivalent of Maven's "boot plugin in the runnable module only". Applying it to every subproject makes Gradle try to build an executable jar from your library modules.

Gradle enforces the dependency direction the build file declares, but not the design. Use ArchUnit ([archunit.md](archunit.md)).

## Build performance

Gradle's advantage over Maven is incremental builds and caching. Turn them on:

```properties
# gradle.properties
org.gradle.caching=true
org.gradle.parallel=true
org.gradle.configuration-cache=true
```

The configuration cache is strict about build scripts reading system state at configuration time - the migration is usually small and the payoff is large on a multi-project build.

**Commit the Gradle wrapper** (`gradlew`, `gradlew.bat`, `gradle/wrapper/`) so everyone builds with the same Gradle version. Check `gradle/wrapper/gradle-wrapper.properties` uses an HTTPS distribution URL.

## Version catalogs

For a multi-project build, keep versions in one place:

```toml
# gradle/libs.versions.toml
[versions]
springBoot = "<current 4.x>"
testcontainers = "<managed by the BOM - omit>"

[libraries]
postgresql = { module = "org.postgresql:postgresql" }

[plugins]
springBoot = { id = "org.springframework.boot", version.ref = "springBoot" }
```

```kotlin
dependencies {
    runtimeOnly(libs.postgresql)
}
```

Type-safe, refactorable, and one place to look. Do not add versions for anything the Boot BOM manages - a catalog entry with an explicit version silently overrides it, which is exactly the failure the BOM exists to prevent.

## If on Boot 3.5.x

Structure is identical. The differences are the same as Maven's: starter names, Flyway arriving transitively, `spring-boot-starter-test` rather than per-technology `-test` starters, and Testcontainers 1.x coordinates ([testcontainers.md](testcontainers.md)).

## Gotchas

- Agent omits `useJUnitPlatform()` - every test is silently skipped and the build passes
- Agent configures JaCoCo verification without wiring it into `check` - the rule never runs
- Agent applies the Boot plugin to every subproject - library modules cannot be repackaged as executables
- Agent uses `sourceCompatibility` instead of a toolchain - the compiling JDK is then whatever the machine has
- Agent puts a JDBC driver on `implementation` - `runtimeOnly`
- Agent puts everything on `api` in a library - leaks dependencies into every consumer's compile classpath
- Agent adds a version for a BOM-managed dependency, including in a version catalog - the BOM decides
- Agent applies both `io.spring.dependency-management` and a `platform(...)` BOM - pick one
- Agent omits the Gradle wrapper - builds differ between machines
- Agent adds `spring-boot-starter-test` next to a Boot 4 `-test` starter
- Agent forgets `spring-boot-starter-flyway` on Boot 4 - migrations silently never run

## Related

- [maven.md](maven.md) · [boot-versions.md](boot-versions.md) · [containerization-and-native.md](containerization-and-native.md) · [testcontainers.md](testcontainers.md) · [archunit.md](archunit.md)
