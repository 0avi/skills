# Spring Batch

Boot 4 ships **Spring Batch 6**. The API changed significantly from 5, and drastically from 4, so most examples an agent has seen are wrong.

## Four rules that break most generated code

1. **Do not add `@EnableBatchProcessing`.** Boot auto-configures the `JobRepository`, `JobOperator` and transaction manager. Adding the annotation **disables** that auto-configuration and you lose every wired bean.
2. **The default job repository is resourceless** - in memory, nothing persisted. No restart after a crash, no audit trail. Persistent `BATCH_*` tables need `spring-boot-starter-batch-jdbc`.
3. **`JobLauncher` and `JobExplorer` are consolidated into `JobOperator`.** Inject `JobOperator` and call `start(job, params)`.
4. **`chunk(500, txManager)` is Batch 5.** Batch 6 takes the size alone, with `.transactionManager(…)` as a separate call. `JobBuilderFactory` and `StepBuilderFactory` have been gone since Batch 5.

## Is Batch the right tool?

It earns its complexity on **large, restartable, auditable** bulk work. For anything smaller, something lighter is better:

| Need | Use |
|---|---|
| A nightly job over millions of rows, resumable after a crash | Spring Batch |
| A periodic task over a bounded set | `@Scheduled` + a paged query ([async-and-scheduling.md](async-and-scheduling.md)) |
| Fire-and-forget work triggered by a request | `@Async` |
| Durable per-item work with retry | A message queue ([messaging.md](messaging.md)) |

Batch brings metadata tables, a job repository and a chunk model. If you do not need restartability, you are paying for infrastructure you will not use.

## Dependencies

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-batch-jdbc</artifactId>
</dependency>
```

Plain `spring-boot-starter-batch` gives the resourceless repository. That is fine for a job you can simply re-run from the start, and wrong for anything that must resume.

## Job and step

```java
@Configuration
class OrderExportJobConfig {

    @Bean
    Job orderExportJob(JobRepository jobRepository, Step exportStep) {
        return new JobBuilder("orderExportJob", jobRepository)
                .incrementer(new RunIdIncrementer())
                .listener(exportCompletionListener())
                .start(exportStep)
                .build();
    }

    @Bean
    Step exportStep(JobRepository jobRepository,
                    PlatformTransactionManager transactionManager,
                    ItemReader<Order> reader,
                    ItemProcessor<Order, OrderRow> processor,
                    ItemWriter<OrderRow> writer) {

        return new StepBuilder("exportStep", jobRepository)
                .<Order, OrderRow>chunk(500)
                .transactionManager(transactionManager)
                .reader(reader)
                .processor(processor)
                .writer(writer)
                .faultTolerant()
                .skip(FlatFileParseException.class)
                .skipLimit(50)
                .build();
    }
}
```

Inject the `PlatformTransactionManager` Boot created - never construct one.

**`chunk(500)` is the commit interval and the transaction boundary**: read 500, process each, hand all 500 to the writer, commit, repeat. It is also the unit of restart and of rollback. Too small means a commit per handful of rows; too large means a long transaction and more work lost on failure. A few hundred to a few thousand is the usual range.

## Restartability and job parameters

A `JobInstance` is identified by its **identifying** job parameters. Launch a completed job with the same ones and you get:

```
JobInstanceAlreadyCompleteException: A job instance already exists and is complete
```

That is deliberate - Batch refuses to redo finished work. Two ways to get a fresh run:

```java
// A: RunIdIncrementer on the job (above) bumps run.id on each launch
// B: add a unique identifying parameter yourself
var params = new JobParametersBuilder()
        .addString("region", "EU")                            // identifying - part of the key
        .addLocalDate("businessDate", LocalDate.now())         // identifying
        .addString("requestId", requestId, false)              // NON-identifying
        .toJobParameters();
```

The `false` flag marks a parameter non-identifying: recorded and available, but excluded from the instance key.

**A failed job is different.** Relaunched with the *same* parameters, it resumes - completed steps are skipped and the failed step restarts from the last committed chunk. That only works with the **JDBC** repository; the resourceless one forgets everything when the JVM exits.

So there is a real tension: always adding a unique parameter guarantees a fresh instance and **destroys resume-on-failure**. Decide which you want. For a nightly job keyed on business date, the date is the natural identifying parameter and you want resume.

In Batch 6, `JobParameter` is an immutable record carrying its own name and `JobParameters` holds a `Set<JobParameter>`; the builder above is unchanged.

## Readers

```java
@Bean
@StepScope
JdbcPagingItemReader<Order> orderReader(DataSource dataSource,
                                        @Value("#{jobParameters['businessDate']}") LocalDate businessDate) {

    var queryProvider = new PostgresPagingQueryProvider();
    queryProvider.setSelectClause("select id, customer_id, total_amount");
    queryProvider.setFromClause("from orders");
    queryProvider.setWhereClause("where placed_on = :businessDate");
    queryProvider.setSortKeys(Map.of("id", Order.ASCENDING));    // unique, mandatory

    return new JdbcPagingItemReaderBuilder<Order>()
            .name("orderReader")
            .dataSource(dataSource)
            .queryProvider(queryProvider)
            .parameterValues(Map.of("businessDate", businessDate))
            .pageSize(500)                                        // match the chunk size
            .rowMapper(new OrderRowMapper())
            .build();
}
```

Three things that cause silent data corruption:

- **`@StepScope` is required** to read `jobParameters`. Without it the bean is created at context startup, when no job is running, and `@Value("#{jobParameters[…]}")` cannot resolve.
- **A paging reader needs a deterministic sort on a unique column.** Without one the database may return rows in a different order per page, so rows are **skipped or processed twice**. No error - just wrong output.
- **Never page on a column the writer mutates in the same job.** If the writer flips `status` from `PENDING` to `DONE` while the reader pages `WHERE status = 'PENDING'`, the result set shifts under the cursor and whole pages are missed. Page on an immutable id, or snapshot the set first.

Thread safety: `JdbcCursorItemReader` is **not** thread-safe. `JdbcPagingItemReader` and `JpaPagingItemReader` are. For a non-thread-safe reader in a multi-threaded step, wrap it in `SynchronizedItemStreamReader`.

For JPA readers, be aware the persistence context grows across a chunk - `JpaPagingItemReader` clears it per page, but a large chunk with associations can still exhaust the heap. Prefer JDBC readers for pure ETL.

## Processors

```java
@Component
class OrderProcessor implements ItemProcessor<Order, OrderRow> {

    @Override
    public OrderRow process(Order order) {
        if (order.total().isZero()) {
            return null;        // ⚠ null FILTERS the item - not written, not an error
        }
        return OrderRow.from(order);
    }
}
```

Returning `null` silently drops the item. That is the filtering feature, and a footgun when you returned `null` by accident expecting pass-through.

## Writers

Since Batch 5 the writer receives a `Chunk<? extends T>`, not a `List`:

```java
@Override
public void write(Chunk<? extends OrderRow> chunk) {
    repository.saveAll(chunk.getItems());
}
```

For SQL, the batched JDBC writer issues one `addBatch()` rather than a statement per row:

```java
@Bean
JdbcBatchItemWriter<OrderRow> orderWriter(DataSource dataSource) {
    return new JdbcBatchItemWriterBuilder<OrderRow>()
            .dataSource(dataSource)
            .sql("insert into order_export (id, total) values (:id, :total)")
            .beanMapped()
            .build();
}
```

**The writer runs inside the chunk transaction.** Never send an email, publish to a broker or call a webhook from a writer - if the chunk rolls back, you have already done it. Bind that to job completion instead ([transactions.md](transactions.md)).

## Launching

Boot runs every `Job` bean at startup by default. In a web application that is almost never what you want:

```yaml
spring:
  batch:
    job:
      enabled: false
    jdbc:
      initialize-schema: never
```

```java
@Component
class OrderExportScheduler {

    private final JobOperator jobOperator;
    private final Job orderExportJob;

    @Scheduled(cron = "0 0 2 * * *", zone = "Europe/London")
    void runNightly() throws JobExecutionException {
        var params = new JobParametersBuilder()
                .addLocalDate("businessDate", LocalDate.now(clock).minusDays(1))
                .toJobParameters();
        jobOperator.start(orderExportJob, params);
    }
}
```

Use `start(Job, JobParameters)`; the `start(String, Properties)` overload is deprecated for removal.

**The default `JobOperator` is synchronous** - `start(…)` blocks until the whole job finishes, so a nightly job blocks the scheduler thread for its entire duration and delays every other scheduled task ([async-and-scheduling.md](async-and-scheduling.md)). For fire-and-forget, configure it with an async `TaskExecutor`.

A scheduled job in a multi-replica deployment runs once per replica. Batch's own instance-key check turns that into `JobInstanceAlreadyCompleteException` on the losers rather than duplicate work - which is protection, not a design. Claim the run explicitly if it matters.

## Metadata schema

`initialize-schema: always` lets Batch DDL your database at startup. Fine for a throwaway environment, wrong for production. Set `never` and ship the schema as a [Flyway](flyway.md) migration - the canonical scripts live in `spring-batch-core` under `org/springframework/batch/core/schema-*.sql`.

Upgrading an existing Boot 3 database: Batch 6 renamed `BATCH_JOB_SEQ` to `BATCH_JOB_INSTANCE_SEQ`. Add a migration for the rename or the upgraded application will not start.

## Listeners

Work that must happen once the whole job succeeded, not per chunk:

```java
@Bean
JobExecutionListener exportCompletionListener() {
    return new JobExecutionListener() {
        @Override
        public void afterJob(JobExecution execution) {
            if (execution.getStatus() == BatchStatus.COMPLETED) {
                notifier.exportReady(execution.getJobParameters());   // all chunks committed
            } else {
                alerting.jobFailed(execution.getJobInstance().getJobName(),
                        execution.getAllFailureExceptions());
            }
        }
    };
}
```

Always handle the failure branch. A batch job that fails silently at 2am is discovered by whoever needs the output.

## Fault tolerance

```java
.faultTolerant()
.skip(FlatFileParseException.class)
.skipLimit(50)
.retry(TransientDataAccessException.class)
.retryLimit(3)
```

Skip and retry are different: skip discards the item and continues, retry re-attempts it. Skipping a malformed row makes sense; skipping a database failure hides an outage. **Always set a skip limit** - unlimited skips can "succeed" having processed nothing. Use a `SkipListener` to record what was skipped, or you have silent data loss.

## Testing

`spring-batch-test` provides `JobLauncherTestUtils`:

```java
@SpringBootTest
@SpringBatchTest
@Testcontainers
class OrderExportJobTest {

    @Autowired JobLauncherTestUtils jobLauncherTestUtils;

    @Test
    void exportsPlacedOrders() throws Exception {
        var execution = jobLauncherTestUtils.launchJob(new JobParametersBuilder()
                .addLocalDate("businessDate", LocalDate.of(2026, 8, 9))
                .toJobParameters());

        assertThat(execution.getStatus()).isEqualTo(BatchStatus.COMPLETED);
        assertThat(exportRepository.count()).isEqualTo(3);
    }
}
```

Test a step in isolation with `launchStep("exportStep", params)`. Test the **restart** path too: fail a job mid-way, relaunch with the same parameters, assert it resumes rather than reprocessing. That is the feature you added the JDBC repository for, and it is the one nobody tests.

## If on Boot 3.5.x

Spring Batch **5**, and the differences are exactly the four rules at the top, inverted:

- The job repository is JDBC-backed by default - no `-batch-jdbc` starter exists or is needed.
- Inject `JobLauncher` to launch and `JobExplorer` to query; `JobOperator` does not combine them.
- `chunk(500, transactionManager)` is the correct form.
- The sequence is `BATCH_JOB_SEQ`.

`@EnableBatchProcessing` should still be omitted, `@StepScope` is still required, `Chunk` is still the writer signature, and the reader rules are unchanged. Batch 6 also dropped Micrometer's global static registry, so a Boot 4 job needs an `ObservationRegistry` bean wired to the `MeterRegistry` for metrics to appear ([observability.md](observability.md)).

## Gotchas

- Agent adds `@EnableBatchProcessing` - it **disables** Boot's auto-configuration
- Agent uses `spring-boot-starter-batch` and expects restart or an audit trail - Batch 6's default repository is in-memory
- Agent uses `JobBuilderFactory` / `StepBuilderFactory` - removed in Batch 5
- Agent calls `.chunk(500, txManager)` on Batch 6 - `.chunk(500)` then `.transactionManager(...)`
- Agent injects `JobLauncher` or `JobExplorer` on Boot 4 - both are now `JobOperator`
- Agent calls `jobOperator.start("jobName", properties)` - deprecated for removal; use `start(Job, JobParameters)`
- Agent omits `@StepScope` on a reader using `jobParameters` - the expression cannot resolve at context startup
- Agent writes a paging query with no `ORDER BY`, or a non-unique one - pages silently skip and duplicate rows
- Agent pages on a column the writer mutates - the result set shifts and pages are missed
- Agent uses `JdbcCursorItemReader` in a multi-threaded step - not thread-safe
- Agent returns `null` from a processor expecting pass-through - `null` filters the item out
- Agent writes `write(List<? extends T>)` - the signature is `Chunk<? extends T>`
- Agent sends email or publishes events from the writer - it runs inside the chunk transaction; use `afterJob`
- Agent leaves jobs running at startup in a web application - set `spring.batch.job.enabled=false`
- Agent lets `initialize-schema: always` DDL production - use `never` plus a Flyway migration
- Agent reuses a Boot 3 Batch schema on Boot 4 - `BATCH_JOB_SEQ` was renamed to `BATCH_JOB_INSTANCE_SEQ`
- Agent adds a unique parameter on every run for a job that should resume - that destroys restartability
- Agent sets no skip limit - the job can "succeed" having skipped everything
- Agent handles only the success branch in `afterJob` - a job failing at 2am must alert
- Agent blocks the scheduler thread with a synchronous `JobOperator` - configure an async `TaskExecutor`
- Agent tests only the happy path - test the restart-after-failure path

## Related

- [flyway.md](flyway.md) · [transactions.md](transactions.md) · [async-and-scheduling.md](async-and-scheduling.md) · [messaging.md](messaging.md) · [observability.md](observability.md) · [testcontainers.md](testcontainers.md)
