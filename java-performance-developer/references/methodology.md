# Measurement Methodology

Everything else in this skill depends on this file. Most performance conclusions that turn out to be wrong were wrong here - not in the fix, but in the measurement that motivated it.

| Test kind | What it is | Trust it for | Do not trust it for |
| --------- | ---------- | ------------ | ------------------- |
| **Microbenchmark** | One small operation in isolation | Choosing between two implementations of the same small thing | Anything about the whole application. Overstates synchronisation cost badly |
| **Mesobenchmark** | One module or one endpoint, real code, subset of features | Module-level regression testing, day-to-day comparison | Absolute numbers, capacity planning |
| **Macrobenchmark** | The whole application with its real external systems | The only thing that answers "how fast is it" | Fast iteration - it is slow and expensive to run |

**Verdict: measure the real application whenever you can, and treat microbenchmark results as a hypothesis rather than a result.** A complex system is more than the sum of its parts: connection buffers consume heap, code is optimised differently when the call graph is bigger, CPU caches behave differently on longer code paths, and none of that appears in a microbenchmark.

---

## Never hand-roll a microbenchmark

The four ways a hand-written Java microbenchmark lies. Each has bitten experienced engineers, and the code below looks reasonable.

```java
// BROKEN - every line of this is a trap
public void doTest() {
  double result;
  for (int i = 0; i < warmups; i++) { result = fib(50); }   // warm-up
  long then = System.currentTimeMillis();
  for (int i = 0; i < loops; i++) { result = fib(50); }     // measure
  System.out.println("Elapsed: " + (System.currentTimeMillis() - then));
}
```

1. **The result is never read, so the compiler deletes the work.** Dead code elimination is entirely permitted to remove the loop body. The measured time approaches the cost of an empty loop, and it will do so regardless of which implementation of `fib` you plug in - so the benchmark cannot possibly answer the question it was written to answer.
2. **The input never varies, so the compiler hoists the call.** `fib(50)` is loop-invariant; one evaluation can serve every iteration. And a single input value tells you nothing about the input range that matters in production.
3. **Profile pollution.** The JIT optimises from observed types, call frequency and stack depth. In a benchmark harness those are all different from the real application, so the compiled code is different code. A method that inlines in the benchmark may not inline in production, and vice versa.
4. **GC behaviour is unrepresentative.** An implementation that allocates heavily looks fine in a single-threaded benchmark - short-lived garbage dies cheaply in the young generation. Run the same code on 40 threads and those objects get promoted, and the "faster" implementation is now the slower one.

**Use JMH.** It exists because these problems are real and hard, it is what the JDK team uses for the JDK's own regression tests, and it works on 8 and later.

```xml
<!-- JMH is a test-scoped dependency; it needs its annotation processor -->
<dependency>
  <groupId>org.openjdk.jmh</groupId><artifactId>jmh-core</artifactId>
  <version>1.37</version><scope>test</scope>
</dependency>
<dependency>
  <groupId>org.openjdk.jmh</groupId><artifactId>jmh-generator-annprocess</artifactId>
  <version>1.37</version><scope>test</scope>
</dependency>
```

```java
@State(Scope.Benchmark)
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Fork(value = 5)                       // 5 separate JVMs - catches per-JVM luck
@Warmup(iterations = 5, time = 10)
@Measurement(iterations = 5, time = 10)
public class InternBenchmark {

  @Param({"1", "10000"})               // sweep the input range, don't pick one value
  private int count;

  private String[] input;

  @Setup(Level.Iteration)              // outside the measured window
  public void setup() {
    input = new String[count];
    for (int i = 0; i < count; i++) input[i] = randomString();
  }

  @Benchmark
  public void intern(Blackhole bh) {
    for (String s : input) bh.consume(s.intern());   // consume() defeats DCE
  }
}
```

The four things this buys you, each addressing one trap above: `Blackhole.consume` makes the result observably used; `@Param` sweeps the input range; `@Setup` moves fixture cost outside the measurement; and `@Fork(5)` runs five fresh JVMs so a single unlucky compilation plan cannot masquerade as a result.

```
Benchmark             (count)  Mode  Cnt    Score    Error  Units
InternBenchmark.intern      1  avgt   25   35.412 ±  1.884  ns/op
InternBenchmark.intern  10000  avgt   25  ... 
```

**Read the `Error` column, not just `Score`.** It is the 99.9% confidence half-interval. If two variants' `Score ± Error` ranges overlap, you have not measured a difference - you have measured noise. Raise `@Fork` and `@Measurement` until they separate, or accept that the difference is too small to matter and go find a bigger one.

`@Setup(Level.Invocation)` is the exception to reach for last: per-invocation fixture work makes JMH's averaging unreliable, so use it only when the measured method itself is long.

---

## Throughput, response time and elapsed time are three different goals

Optimising one can degrade another, so pick deliberately and state which you picked.

| Metric | Client behaviour | What "better" means | Use for |
| ------ | ---------------- | ------------------- | ------- |
| **Elapsed time** (batch) | N/A - fixed work | Finishes sooner | Batch jobs, CLI tools, builds |
| **Throughput** (TPS/RPS/OPS) | Zero think time, saturating | More operations per second | Capacity, cost per request |
| **Response time** | Fixed think or cycle time | Lower latency at a fixed load | Interactive services, SLOs |

A throughput test with think time is not a throughput test - with a fixed client count and a fixed cycle time the throughput is *pinned by arithmetic*, and the only variable left is response time. Know which one you are running.

**A response time reported alongside a throughput number is not comparable across runs unless the throughput matched.** 500 OPS at 0.5 s beats 400 OPS at 0.3 s. Compare like for like or not at all.

### Think time and cycle time differ, and it matters

```java
// think time: sleep is fixed, so throughput drifts with response time
while (!done) { executeOperation(); Thread.sleep(30_000); }

// cycle time: total period is fixed, so throughput is constant
while (!done) { long t = executeOperation(); Thread.sleep(30_000 - t); }
```

Cycle time is what you want for a response-time test, because it holds the offered load constant while you change the server. With think time, a server that gets slower also gets *less loaded*, which flatters it.

---

## Use percentiles, and always look at the average too

```
Typical run:   times 1-5 s     → average 2.35 s,  90th percentile 4.0 s
One outlier:   nineteen at ~1 s, one at 100 s
                               → average 5.95 s,  90th percentile 1.0 s   ← reversed
```

The average and the percentile swap places in the presence of an outlier, and each is blind to a different failure. **Report both.** If you may only have one, take a percentile - improving it helps the majority of users. But an average far above the 90th percentile is itself the finding: it says a small number of requests are catastrophically slow, and in Java that usually means GC pauses. Go to [triage.md](triage.md) Branch A.

---

## Deciding whether a difference is real

Programs do not produce the same number twice. Comparing two averages by eye is how imaginary regressions get chased and real ones get dismissed.

| Baseline | Specimen |
| -------- | -------- |
| 1.0 s | 0.5 s |
| 0.8 s | 1.25 s |
| 1.2 s | 0.5 s |
| **avg 1.0 s** | **avg 0.75 s** |

That looks like a 25% improvement. Student's t-test puts the p-value at about 0.43 - meaning there is a **43% probability the two are actually the same**, so confidence in any difference at all is only 57%. Adding three more samples per side drops p to ~0.11 and raises confidence to ~89%. The averages did not move; the confidence did.

- The **p-value** is the probability the two series have the same underlying performance. Low p means a real difference.
- Convention treats p < 0.1 as significant (90% confidence). The threshold is arbitrary - p = 0.11 is not significant at 90% and is significant at 89%.
- A failed significance test means **inconclusive**, not "no difference". Usually it means too few samples.

**Statistical significance is not statistical importance.** A 1% regression at p = 0.01 is real and probably not worth anyone's afternoon; a 10% regression at p = 0.2 is uncertain and worth investigating first. Chase the size, then establish the confidence.

JMH does this for you, which is another reason to use it. For macrobenchmark runs, script the t-test - Apache Commons Math `TTest` is one line - rather than eyeballing a report.

---

## Warm-up

Java code gets faster as it runs: interpreted, then C1, then C2, plus filesystem caches warming, JPA L2 caches filling and connection pools ramping. So there are two legitimate measurements and you must say which you took.

- **Warm measurement** - discard an initial period, then measure. Right for long-running services, and required for microbenchmarks.
- **Cold / end-to-end measurement** - measure from process start. Right for batch jobs, CLI tools, serverless functions, and for the user experience of the first minutes after a deploy.

**Do not default to warm.** For a report generator processing ten thousand elements, nobody cares that the last five thousand were faster; the elapsed time is the product. For a server that takes 45 seconds to reach peak, the users in those 45 seconds are real users.

---

## Test early, test often, and automate all of it

The tension is real: a good performance test needs a mesobenchmark at minimum, repeated enough times to establish significance, which on a large project is days rather than minutes. It cannot gate every commit. It should still run continuously, because a regression found next to the commit that caused it is a different problem from one found at feature freeze.

Three requirements, and the second is the one people skip:

1. **Automate everything** - install, configure, run N times, t-test, report. A test is repeatable only if the environment is, so the harness must also assert the machine is in a known state.
2. **Measure everything, every run, whether or not you think you need it.** CPU, disk, network, memory, the GC log, a JFR recording, periodic thread dumps, and the same from every other machine involved including the database. When a regression appears weeks later, this archive is the only way to find out what changed. Collecting it after the fact means waiting for the next occurrence.
3. **Run on the target system.** Nearly every ergonomic default derives from CPU count and available memory; code is compiled differently per platform; a 4-core laptop cannot exhibit the lock contention a 64-core server will. Extrapolation is prediction, and predictions are wrong.

---

---

## How the figures in this skill were produced

This file tells you never to hand-roll a microbenchmark. That obliges it to say which of this skill's own numbers came from JMH and which did not, because **an earlier draft broke its own rule** and some published multipliers were wrong as a result.

| Class of figure | Method | How to treat it |
| --------------- | ------ | --------------- |
| Flag existence, defaults, types, removal behaviour | Launching Temurin 8u504, 11.0.32.1, 17.0.20.1, 21.0.12 and 25.0.4.1 and reading `-XX:+PrintFlagsFinal` and the exit status | **Solid.** This is not a benchmark; it is an observation, and it reproduces exactly |
| Object sizes and layout | JOL, and `PrintFlagsFinal` for the header configuration | **Solid.** Deterministic, no timing involved |
| Library constants (e.g. the `Arrays.sort` threshold) | Read from each JDK's own `src.zip` | **Solid.** It is the source |
| Footprint, NMT, thread stack commit | `jcmd VM.native_memory` on a running JVM | **Solid** as a magnitude; footprint varies with workload |
| Nanosecond and microsecond timings of Java operations | **JMH**, 3 forks, 5 warmup + 6 measurement iterations, with a control benchmark | Use them, with the error bars |
| Figures quoted from Oaks | The book, edition and table stated at the point of use | Direction and magnitude only. 2014-2020 hardware, Java 7-11 |
| Elapsed-time I/O comparisons | A repeated-run harness, medians reported | Magnitude only. The ratios are large enough to survive the method; the absolute numbers are not portable |
| Whole-process timings (startup) | **Paired and interleaved**: all configurations per round, rotated order, median of per-round ratios, plus a replication | Use the ratios and the IQR. Absolutes are host-specific |

**Where an earlier draft published a hand-rolled timing, it has been withdrawn or replaced**, and the withdrawal is stated at the point of use rather than only here - see the lambda-versus-anonymous-class table in [lambdas-and-streams.md](lambdas-and-streams.md) for the pattern. Two lessons worth keeping, both learned the hard way on this skill:

1. **A control benchmark is not optional.** An earlier exception-cost table listed "no exception at all" at 12 ns. Nothing costs 12 ns; that was the harness, and it meant every small figure in the table was loop overhead rather than the operation. A control that measures the empty case tells you where your floor is, and any result at or below the floor is noise.
2. **A single multiplier hides a scaling law.** "String concatenation in a loop is 2-2.5× slower" is not wrong so much as useless, because the ratio grows with the iteration count - the behaviour is quadratic and the number you quote depends entirely on the `n` you happened to choose. Parameterise with `@Param` and report the curve.
3. **When you cannot use JMH, pair and interleave instead of running passes.** Whole-process measurements - startup time, batch elapsed time, anything you can only observe by launching - cannot go in JMH, and the obvious method is to run configuration A many times, then B many times, and compare the medians. **That method attributes every bit of drift between the two passes to the difference you are measuring.** On this skill it produced 7.1% and 19.0% for the same quantity on the same machine.

   The fix costs nothing: run **all** configurations inside each round, rotate their order so none is always first, and compute the ratio **within** each round before aggregating. Anything that slows a whole round - a background process, thermal throttling, a cache eviction - divides out of that round's ratio. Re-measured that way, the same comparison gave **17.9% and 17.5%** across independent passes, and 40 of 40 rounds agreed on the direction.

   The noise does not disappear, it stops being confounded with the signal: the replication above contained a **1,553 ms outlier against a 205 ms median** and moved the paired result by 0.4 percentage points. **Report the median of per-round ratios, and report how many rounds agreed on the direction** - that count is the cheapest honest significance statement available for this kind of measurement.

## Version notes

Methodology is the most version-stable material in this skill - the statistics do not change. What changes is the tooling around it.

| Item | 8 | 11 | 17 | 21 | 25 |
| ---- | - | -- | -- | -- | -- |
| JMH usable | ✓ | ✓ | ✓ | ✓ | ✓ |
| JFR available in OpenJDK builds for measurement runs | ✗ | ✓ | ✓ | ✓ | ✓ |
| `-Xlog` for machine-parsable GC data | ✗ | ✓ | ✓ | ✓ | ✓ |
| Virtual threads change what a "client thread" costs | ✗ | ✗ | ✗ | ✓ | ✓ |

Two version-specific measurement hazards:

- **Comparing across JDK versions requires holding the collector constant.** The default collector changed from Parallel (8) to G1 (11+) - verified on 8u504 and 11.0.32.1 - so an unqualified "8 versus 17" comparison measures the collector change as well as everything else. Pin `-XX:+UseParallelGC` on both, or `-XX:+UseG1GC` on both, and say which you did.
- **Load generators built on platform threads become the bottleneck sooner than ones built on virtual threads.** On 21+ a client can hold far more concurrent in-flight requests per host, so a harness written for Java 8 may cap the measurement rather than the server.

## Gotchas

- Agent writes a hand-rolled microbenchmark loop with `System.currentTimeMillis()` - dead code elimination, hoisting and profile pollution make it meaningless; use JMH
- Agent reports a JMH `Score` without the `Error` - overlapping confidence intervals mean no measured difference
- Agent draws an application-wide conclusion from a microbenchmark, especially about locks - microbenchmarks overstate contention severely
- Agent compares two averages and declares a regression - run the t-test, or say the result is inconclusive
- Agent treats a failed significance test as proof of no difference - it means inconclusive, usually too few samples
- Agent optimises the average when the SLO is a percentile, or the reverse - they can move in opposite directions
- Agent compares response times between runs whose throughput differed - not comparable
- Agent always discards the warm-up - wrong for batch jobs, CLIs, serverless and post-deploy behaviour
- Agent benchmarks on a laptop and reports the number as production capacity - defaults, compilation and contention all differ
- Agent changes the JDK and the collector in one comparison - pin the collector to isolate the variable
- Agent forgets the load generator can saturate first - check client CPU before believing a ceiling
- Agent measures once and moves on - no variance estimate means no result
- Agent benchmarks with `System.gc()` in the loop - that measures the collector, not the code
- Agent uses `@Setup(Level.Invocation)` for a short method - it breaks JMH's averaging; reserve it for long operations

## Related

- [triage.md](triage.md) · [tooling.md](tooling.md) · [garbage-collection.md](garbage-collection.md) · [jit-compiler.md](jit-compiler.md) · [concurrency-performance.md](concurrency-performance.md) · [java-versions.md](java-versions.md) · [checklist.md](checklist.md)
