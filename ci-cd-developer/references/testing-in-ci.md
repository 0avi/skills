# Testing in CI

Running tests in a pipeline, as distinct from writing them. The pipeline concerns are: which suites run when, how they get real dependencies, how they parallelise without interfering, and what happens to the results.

| Concern | Position |
| ------- | -------- |
| Real dependencies | **Testcontainers.** Never an in-memory substitute for the production database |
| Where suites run | Fast suites on pull requests, everything on the main branch |
| Parallelism | Isolate state per test first, then shard |
| Results | **Published as an artifact** and surfaced on the pull request, not buried in a log |
| The pyramid | A pipeline shape, not a philosophy: many fast, few slow |

---

## The pyramid as a pipeline shape

| Layer | Count | Duration | Runs on |
| ----- | ----- | -------- | ------- |
| Unit | Thousands | Whole suite under a few minutes | Every push |
| Integration / component | Hundreds | 5-15 min | Every push |
| Contract | Tens | Fast | Every push |
| End-to-end / smoke | **A handful** | 5-20 min | After deploy to a real environment |

The shape exists because of **cost per unit of confidence**. An end-to-end test that exercises everything is worth having; a hundred of them is a pipeline nobody waits for and a flake source nobody can maintain.

**End-to-end tests belong after a deploy**, against a running environment, not against a docker-compose approximation of one. That is what makes them worth their cost.

## Real dependencies with Testcontainers

Use the real database, the real broker, the real cache:

```java
@Testcontainers
class OrderRepositoryTest {
    @Container
    static final PostgreSQLContainer<?> DB =
        new PostgreSQLContainer<>("postgres:18-alpine");   // pin the version
}
```

**Never use H2 as a stand-in for PostgreSQL.** Two independent problems: the SQL dialects differ, so tests pass against behaviour production does not have; and your migrations either do not run or run differently, which means the schema under test is not the schema you deploy. That second one is the serious one, and it is why [`spring-boot-developer`](../../spring-boot-developer/SKILL.md) takes the same position.

Pipeline requirements:

- **A container runtime on the runner.** Present on GitHub-hosted Linux runners; **not** on Windows or macOS hosted runners in the same form. Check before assuming.
- **One container per suite, not per test.** Startup dominates otherwise. Reuse a static container and isolate *within* it - a schema or key prefix per test.
- **Pin the image version.** `postgres:latest` makes the test environment drift under you, and it will drift at the worst time.

### Service containers as the alternative

Where the platform offers native service containers - GitHub `services:`, GitLab `services:`, Azure DevOps container resources - they start faster because the platform manages the lifecycle, but they are less portable and cannot easily be used from a local run. Testcontainers runs identically on a laptop, which is usually worth more.

## Isolation before parallelism

Sharding a suite that shares state converts a passing suite into a flaky one. Fix isolation first:

| Shared thing | Isolation |
| ------------ | --------- |
| Database | A schema (or database) per test class, or transactional rollback per test |
| Redis or cache | A key prefix per test |
| Port | Bind to port 0 and read the assigned port |
| Temp files | A unique temp directory per test, cleaned up |
| Static or singleton state | Reset in setup, or remove the singleton |
| Clock | Injected, never `Instant.now()` in code under test |

Then shard:

```yaml
strategy:
  fail-fast: false
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: mvn -B verify -Dsurefire.shard=${{ matrix.shard }} -Dsurefire.shards=4
```

**Measure before sharding.** Four shards each spending three minutes on dependency restore and container startup, to save two minutes of test execution, is a net loss. This is the single most common parallelisation error, and it is invisible unless you compare critical-path duration. See [caching.md](caching.md).

## Pull request against main branch

| | Pull request | Main branch |
| --- | ------------ | ----------- |
| Unit | All | All |
| Integration | Yes | Yes |
| End-to-end | Usually not - too slow, too flaky | Yes, after deploy |
| Performance | No | Scheduled, not per-commit |
| Duration budget | Minutes | Longer tolerated |

Two constraints that are not optional:

- **Fork pull requests get no secrets** on GitHub. Any test needing a credential cannot run there, so it must not be a required check for forks, or the contribution path is blocked. See [actions-security.md](actions-security.md).
- **Performance tests do not belong on every commit.** Shared runners have variable performance, so per-commit results are noise. Run them on a schedule on consistent hardware, and see [`java-performance-developer`](../../java-performance-developer/SKILL.md) for why a hand-rolled timing comparison misleads.

## Results are an artifact

A test result buried in a job log is not usable. Publish it:

```yaml
- uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a  # v7.0.1
  if: always()                     # results matter most when the job failed
  with:
    name: test-results
    path: '**/target/surefire-reports/*.xml'
```

**`if: always()` is the important part.** Without it, the upload is skipped precisely when the job failed and you needed the report.

Publish JUnit XML so the platform can render which test failed rather than making a human read the log, and retain it long enough for an incident review. Result history is also what makes flake detection possible. See [flaky-tests.md](flaky-tests.md).

## Version notes

- **Testcontainers needs a container runtime.** Available on hosted Linux runners; Windows and macOS hosted runners differ. Verify rather than assuming.
- **Container reuse** (`testcontainers.reuse.enable`) speeds local runs and is generally not appropriate in CI, where isolation matters more than startup.
- **`mvn verify`, not `mvn test`** - `test` skips integration tests and packaging. See [java-build.md](java-build.md).
- **Docker 29.7.2** is present on this machine; a workflow was executed locally through `act`, but no test suite was run for this skill.
- **Not verified here:** Testcontainers behaviour, sharding gains and hosted-runner service containers. Cited from tool documentation and standard practice.

## Gotchas

- Agent uses H2 instead of the production database engine - different dialect, and the real migrations do not run
- Agent starts a container per test - startup dominates the suite; one per class or suite, isolated within
- Agent uses `postgres:latest` in a test - the test environment drifts under you
- Agent shards before isolating shared state - converts a passing suite into a flaky one
- Agent shards without measuring - repeated setup across shards often costs more than the tests saved
- Agent puts end-to-end tests on every pull request - slow, flaky, and they belong after a deploy to a real environment
- Agent runs performance tests per commit on shared runners - runner variance makes the result noise
- Agent makes a secret-dependent test a required check - fork pull requests cannot run it, so contributions are blocked
- Agent omits `if: always()` on result upload - the report is missing exactly when the job failed
- Agent leaves results only in the log - nobody can see which test failed without reading it
- Agent lets tests depend on execution order - randomise order in CI so the dependency surfaces at once
- Agent assumes hosted Windows and macOS runners can run Linux containers - they cannot, in the same way

## Related

- [flaky-tests.md](flaky-tests.md) · [quality-gates.md](quality-gates.md) · [java-build.md](java-build.md) · [frontend-build.md](frontend-build.md) · [caching.md](caching.md) · [runners.md](runners.md) · [actions-security.md](actions-security.md) · [`spring-boot-developer`](../../spring-boot-developer/SKILL.md) · [`postgresql-developer`](../../postgresql-developer/SKILL.md) · [checklist.md](checklist.md)
