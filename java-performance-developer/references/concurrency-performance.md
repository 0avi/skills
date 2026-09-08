# Concurrency Performance

Threading performance is mostly not about tuning - there are few JVM flags and they do little. It is about sizing pools correctly and limiting the effect of synchronisation.

This file owns the **performance** of concurrency: sizing, contention, measurement. The virtual thread and `StructuredTaskScope` **APIs** belong to [`java-developer`](../../java-developer/SKILL.md); what follows is what changes about sizing and measurement once they are in use.

| Concern | Rule |
| ------- | ---- |
| **Pool size** | As many threads as will be *simultaneously executing plus simultaneously blocked* |
| **Too many threads** | Actively harmful when the bottleneck is downstream - can be catastrophic |
| **Amdahl's law** | The serial fraction is the ceiling. 20% serial caps eight CPUs at 3.3× |
| **Synchronisation** | **16.7 ns uncontended** against a 1.3 ns plain-field control; the memory barriers, not the lock, are often the cost |
| **CAS** | **6.4 ns uncontended** against a 1.3 ns plain-field control; better under light contention, worse under extreme |
| **False sharing** | Rare but severe - measured serialisation of independent work |

---

## Amdahl's law is the ceiling

```
Speedup = 1 / ((1 - P) + P/N)
```

With `P` the parallel fraction and `N` the threads. **If 20% of the work is serialised, eight CPUs buy 3.3×, not 8×** - over half the theoretical gain lost to one fifth of the code.

This is why limiting the serialised section matters more than any other concurrency work, and why "add more threads" stops helping so abruptly. When scaling flattens, find the serial section rather than raising the thread count.

---

## Sizing a thread pool

**There is no formula, because the answer depends on what the tasks do.** Start from the two extremes.

### CPU-bound work: threads = CPUs

Oaks measured 10,000 stock history calculations (pure computation, no I/O) on four single-threaded cores:

| Threads | Seconds | % of baseline |
| ------- | ------- | ------------- |
| 1 | 55.2 | 100% |
| 2 | 28.3 | 51.2% |
| 4 | **13.9** | **25.1%** |
| 8 | 14.3 | 25.9% |
| 16 | 14.5 | 26.2% |

Near-linear to the core count, then flat with a slight penalty. **For CPU-bound work, more threads than cores can never help** - there is no CPU for them to use, and they add scheduling and coordination cost.

### The same test on hyper-threaded cores

Two real cores presenting as four CPUs:

| Threads | Seconds | % of baseline |
| ------- | ------- | ------------- |
| 1 | 55.7 | 100% |
| 2 | 28.1 | 50.4% |
| 4 | 25.5 | **45.7%** |
| 8 | 25.7 | 46.1% |

Scaling is linear to the two *physical* cores, then the two hyper-threads add only ~9%. **Hyper-threads are not cores.** Expect 20-40% from the second hardware thread, so eight hardware threads on four cores deliver roughly 5-6× one core, not 8×. Size for the work, but predict from cores.

### I/O-bound work: threads = concurrent blocked calls

A thread waiting on a socket uses no CPU, so a pool sized to the core count leaves the machine idle. Oaks' worked example: two CPUs, 900 ms in the database and 100 ms of processing per request. The CPU supports 20 requests/second, and at any moment ~20 requests are blocked - so the pool needs **at least 20 threads**, not 2, even though only 2 can compute at once.

**The rule: enough threads for those simultaneously executing *plus* those simultaneously blocked.**

### Too many threads is worse than too few

The case that makes this urgent. Oaks drove a REST server from a client and increased *client* threads while the server was already CPU-saturated:

| Client threads | Average response time | % of baseline |
| -------------- | --------------------- | ------------- |
| 1 | 0.022 s | 100% |
| 2 | 0.022 s | 100% |
| 4 | 0.024 s | 109% |
| 8 | 0.046 s | 209% |
| 16 | 0.093 s | 422% |
| 32 | 0.187 s | **885%** |

The client machine had spare CPU throughout. **Adding threads made response time nearly nine times worse**, because the load went into a component that was already saturated - the general principle from [triage.md](triage.md), in its most vivid form.

The trap is the reasoning that leads there: "the server has spare CPU and requests are queued, so add threads." If the queue is caused by a *downstream* constraint, more threads make it worse. **This is why self-tuning pools that add threads when work is pending are frequently wrong** - they can see the queue and the local CPU, and not the reason for the queue.

A self-tuning pool typically gets 80-90% of achievable performance, and over-sizing usually costs only a little. But when it goes wrong it goes wrong badly, and only testing finds it.

### Minimum size and pre-creation

**Set core and maximum equal in most cases.** The argument for a small minimum is saving resources while idle, but the system must be sized for peak anyway - and if it cannot survive peak, a small minimum does not help. Meanwhile a small minimum means paying thread creation during the first burst.

Where they differ, keep the idle timeout in the **minutes** (10-30), not seconds: a thread created for a 5-second burst, idle 5 seconds, then destroyed 5 seconds before the next burst is the worst of both.

Idle threads are cheap - the object is small, and on Java 9+ stacks commit lazily ([native-memory.md](native-memory.md)). The exception is very large pools: 1,980 idle threads alongside 20 busy ones measurably degrades throughput, so a pool that can grow to thousands does need a sensible minimum.

`ThreadPoolExecutor` creates core threads on demand, not at construction, so the first requests pay for creation. `prestartAllCoreThreads()` avoids that.

---

## `ThreadPoolExecutor`: the queue decides the behaviour

The most surprising part of the API. **The queue type - not the size parameters - determines when new threads are created**, and two of the three combinations ignore one of your parameters entirely.

| Queue | Behaviour | Which size is honoured |
| ----- | --------- | ---------------------- |
| `SynchronousQueue` | New thread per task up to maximum; **then rejects immediately** | Both. No queueing at all |
| Unbounded (`LinkedBlockingQueue`) | Never rejects; **maximum is ignored** | Core only - it *is* the pool size |
| Bounded (`ArrayBlockingQueue`) | Runs at core size until the queue is **full**, then grows | Both, but only under a full queue |

The bounded case surprises people. With core 4, maximum 8 and a queue of 10: tasks arrive, four threads run, the queue fills to 10 - **still four threads**. Only when a task arrives at a *full* queue does a fifth thread start. Reaching 8 threads requires 7 running, 10 queued and another arriving.

The design intent is throttling: run at core size normally, and add threads only when the backlog proves it necessary. The flaw is that the pool cannot know *why* the backlog exists - if it is a downstream constraint, adding threads is the wrong response, as measured above.

**Recommendation: keep it simple.** Do not use the `Executors` factory methods, which give unbounded queues or unbounded thread counts and therefore no control over memory:

```java
// core == maximum, bounded queue, explicit rejection
var pool = new ThreadPoolExecutor(
    nThreads, nThreads,
    0L, TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(queueCapacity),
    new ThreadPoolExecutor.AbortPolicy());
```

### Bound the queue, and reject properly

An unbounded queue converts overload into unbounded memory growth and unbounded latency. A task sitting in a queue for three seconds is usually worthless - the user has left - and it still consumes a thread when it finally runs.

30,000 queued tasks at 50 ms each takes 6 minutes to drain; at 1 second each, over 8 hours. **Bound the queue so overload is visible and fast**, then handle rejection: a REST server should return **429** or **503** immediately rather than accepting work it cannot do in time. Returning a fast error under overload is what stops the death spiral.

---

## `ForkJoinPool`

For divide-and-conquer algorithms, where a task must wait for subtasks it created. A `ThreadPoolExecutor` cannot do this - a waiting thread is unavailable, so a recursive algorithm would need one thread per subtask. `fork()`/`join()` suspends the parent so the thread can run other tasks.

**It is not a general-purpose pool.** Oaks measured counting values in a 2-million-element array:

| Threads | `ForkJoinPool` (leaf 10) | `ThreadPoolExecutor` (4 partitions) |
| ------- | ------------------------ | ----------------------------------- |
| 1 | 125 ms | **1.7 ms** |
| 4 | 37.7 ms | **0.55 ms** |

Two orders of magnitude worse - the cost of creating and managing 4 million task objects for work that partitions trivially. **When the work partitions evenly, partition it and use a plain pool.**

### Where it wins: unbalanced work

Make the per-element cost proportional to position, so the first partition is far more expensive:

| Threads | `ForkJoinPool` | `ThreadPoolExecutor` |
| ------- | -------------- | -------------------- |
| 1 | 22.0 s | 21.7 s |
| 4 | **5.6 s** | 9.7 s |

Now fork/join wins decisively, through **work stealing**: each thread has its own deque and steals from others when idle. The plain pool's thread that drew the expensive first partition works alone while three sit idle.

**Choose by balance: even work → partition and use a plain pool; uneven work → `ForkJoinPool`.**

Tuning the leaf threshold matters. For the balanced case, ending recursion at 500,000 (four tasks) matched the plain pool. For the unbalanced case, smaller leaves kept winning until they flattened between 1,000 and 10,000. Java's own quicksort switches to insertion sort at 47 elements. **There is no universal value - measure it.**

### The common pool and parallel streams

`parallelStream()` and most of `Arrays.parallelSort` use `ForkJoinPool.commonPool()`. Verified on 25.0.4.1 by varying `-XX:ActiveProcessorCount`, its parallelism is **`max(1, availableProcessors() - 1)`** - measured 1, 1, 2, 3, 7 at 1, 2, 3, 4 and 8 CPUs. **The floor of 1 is why 1 and 2 CPUs behave identically**, and why a plain `n - 1` formula is wrong at the bottom of the range:

| Visible CPUs | Common pool parallelism |
| ------------ | ----------------------- |
| 1 | 1 |
| 2 | **1** |
| 4 | 3 |
| 8 | 7 |

**At one or two CPUs, parallel streams are effectively sequential.** In a small container, carefully parallelised code silently stops being parallel - no error, no warning. See [containers.md](containers.md).

```bash
-Djava.util.concurrent.ForkJoinPool.common.parallelism=N
```

Lower it when several JVMs share a host or when other work needs CPU; raise it when common-pool tasks block on I/O. One subtlety: `forEach` on a parallel stream **also uses the calling thread**, so a common pool of 1 gives two threads of execution. Reduce the desired value by one when sizing.

**Never submit blocking work to the common pool.** It is shared by every parallel stream in the JVM, including library code, and blocking it stalls all of them. Use your own pool.

---

## Synchronisation cost

Measured on 25.0.4.1, uncontended, 20 million operations:

| Mechanism | ns/op |
| --------- | ----- |
| Plain field increment | ~0.3 (unreliable - see below) |
| `AtomicLong.incrementAndGet` (CAS) | **5.0** |
| `synchronized` block | **16.708 ± 0.641** |

The plain figure is not trustworthy: a non-volatile increment in a tight loop is exactly what the JIT eliminates, and 0.3 ns is faster than a memory round trip. Read it as "effectively free". The CAS and `synchronized` figures are meaningful because both require real memory barriers.

**Re-measured with JMH** on Temurin 25.0.4.1, `AverageTime` in ns/op, single-threaded and uncontended, against a plain-field control:

| Operation | ns/op | Against the control |
| --------- | ----- | ------------------- |
| Plain field increment (**control**) | 1.347 ± 0.026 | - |
| `volatile` increment | 6.532 ± 0.691 | 4.8× |
| `AtomicLong.incrementAndGet` (CAS) | **6.387 ± 0.337** | 4.7× |
| `LongAdder.increment` | 7.821 ± 0.254 | 5.8× |
| `ReentrantLock` lock/unlock | 15.414 ± 0.349 | 11.4× |
| `synchronized` block | **16.708 ± 0.641** | 12.4× |

**So uncontended synchronisation is ~16-17 ns and uncontended CAS ~6.4 ns**, against a ~1.3 ns floor. Three things in that table are worth more than the headline:

- **`volatile` and CAS are indistinguishable here** (6.532 ± 0.691 against 6.387 ± 0.337 - the ranges overlap). Both are paying for the same memory barrier, and the compare-and-swap itself is nearly free on top of it.
- **`LongAdder` is *slower* than `AtomicLong` uncontended** (7.821 against 6.387), which is exactly right and exactly why it is not a drop-in upgrade. It trades a little single-threaded cost for striping that only pays under contention. Reach for it when a profile shows contention on a counter, not before.
- **`synchronized` and `ReentrantLock` are within about 8% of each other** (16.708 against 15.414). Choose between them on features - `tryLock`, fairness, timed acquisition, and on Java 21-23 the virtual-thread pinning behaviour - never on this number.

An earlier version of this file gave ~18 ns and ~5 ns from a hand-rolled harness with an untrustworthy control that read 0.3 ns for a plain increment. The magnitudes held up; the control did not, and the `volatile`/CAS and `LongAdder` comparisons above were not visible at all without one. Contended costs cannot be measured meaningfully in a microbenchmark - with two threads hammering one lock, contention approaches 100%, which no real application does. Microbenchmarks **systematically and severely overstate** lock cost; that is the single most common way threading benchmarks mislead. See [methodology.md](methodology.md).

### The memory barrier is often the real cost

The Java Memory Model requires that leaving a synchronised block flushes modified values to main memory, and entering one sees other threads' flushes. `volatile` and CAS carry the same requirement.

This is why the `Vector` loop in [collections-performance.md](collections-performance.md) was slow despite being uncontended: `size()` and `get()` are both synchronised, so every element forced register flushes. **The effect grows with the CPU's register count** - that code ran fine for years on small hardware and became a bottleneck on a large SPARC machine. As core counts and cache hierarchies grow, this class of problem becomes more likely, not less.

### CAS against locks

| Contention | Winner |
| ---------- | ------ |
| None | CAS clearly (**6.4 ns against 16.7 ns**, both JMH with a control) |
| Light to moderate | **CAS, often by a lot** |
| Extreme | Traditional synchronisation - CAS retries burn CPU |
| Read-only | **CAS - no contention at all on reads** |

CAS is optimistic: read, compute, swap if unchanged, retry otherwise. Under heavy contention the retries themselves consume CPU, and there is a crossover - in practice only on very large machines with many threads on one value.

**For contended counters, use `LongAdder` rather than `AtomicLong`.** It keeps per-thread cells and sums them on read, so writers do not contend at all. The trade-offs: more memory, and a slower `sum()` that must walk the cells. Under contention it beats `AtomicLong` substantially; uncontended it behaves much the same.

### Avoiding synchronisation entirely

**Thread-local state is never contended.** `ThreadLocalRandom` exists precisely because a shared `Random` serialises on `next()`. Oaks measured 10,000 numbers on four threads:

| Approach | Elapsed |
| -------- | ------- |
| `ThreadLocalRandom` | **52 µs** |
| New `Random` per call | 135 µs |
| One shared `Random` | **3,763 µs** |

Two lessons. The shared instance is 70× worse than thread-local. And **creating a new `Random` each time - which also removes contention - is still 2.6× worse than thread-local**, because seeding is expensive. Removing contention is not enough; you must also avoid re-initialisation. That is the case for `ThreadLocal`: it eliminates contention *and* reuses an expensive object.

`NumberFormat`, `DateFormat`, `MessageDigest` and `SimpleDateFormat` are the classic candidates - not thread-safe, expensive to construct, used constantly.

---

## False sharing

Rare, hard to find, and severe. Two threads writing *different* variables that share a CPU cache line invalidate each other's line on every write.

```java
public class DataHolder {
  public volatile long l1;   // these four are likely
  public volatile long l2;   // adjacent in memory and
  public volatile long l3;   // therefore in one cache line
  public volatile long l4;
}
```

Four threads, each incrementing its own field - no shared variables, no locks, no contention. Oaks measured:

| Threads | Elapsed |
| ------- | ------- |
| 1 | 0.8 ms |
| 2 | 5.7 ms |
| 3 | 10.4 ms |
| 4 | **15.5 ms** |

**Perfectly serialised despite zero logical sharing.** Removing `volatile` lets the values live in registers and the test completes in ~0.7 ms regardless of thread count - which is also the tell: the cost appears only where a write must reach memory, so it clusters around `volatile`, CAS and synchronised exits.

Finding it is genuinely hard. No standard JDK tool reports it. Intel VTune infers it from cache-miss events; a native profiler showing a high cycles-per-instruction on a simple instruction inside a loop is a hint. Even Intel's own manual says the primary means is **code inspection** - so the practical approach is to suspect it when a loop over per-thread data is inexplicably slow and scales negatively.

Two fixes:

1. **Write less often.** Accumulate in a local variable and store once at the end. Almost always the right answer, and it also removes the barriers.
2. **Pad.** Awkward: array padding usually fails because the JVM reorders fields; primitive padding works but is verbose, and the right amount depends on the CPU's cache line size.

`@jdk.internal.vm.annotation.Contended` (`@sun.misc.Contended` on 8) does this properly, but it is **restricted to JDK classes** unless you set `-XX:-RestrictContended`, and on 11+ using it needs `--add-exports`. It is how `Thread` and `ConcurrentHashMap` pad their own hot fields. `-XX:-EnableContended` disables that internal padding to save memory - rarely a good trade.

---

## Virtual threads change the question

On 21+ the sizing question changes shape rather than disappearing. The API belongs to [`java-developer`](../../java-developer/SKILL.md); the performance points here:

- **Pool sizing for blocking I/O stops being the constraint.** One virtual thread per task, unpooled. The "enough threads for the blocked ones" arithmetic no longer applies - that was a workaround for expensive threads.
- **The carrier pool is still sized by CPU count**, so CPU-bound work is bounded exactly as before. Virtual threads do nothing for CPU-bound work.
- **They speed up *concurrent* requests, not a serial fan-out inside one request.** Three sequential REST calls take just as long. That is what `StructuredTaskScope` addresses.
- **Pinning was a hard ceiling before Java 24.** A virtual thread blocked inside `synchronized` could not unmount, so concurrency capped at the carrier count. Fixed in 24 (JEP 491); on 21-23 replace `synchronized` with `ReentrantLock` around blocking calls, as Tomcat did.
- **New diagnostics on 25:** `jcmd <pid> Thread.vthread_scheduler` reports carrier pool state, and `Thread.vthread_pollers` the I/O pollers - verified present on 25.0.4.1 and absent from every earlier version. `jdk.VirtualThreadPinned` JFR events are available from 21.
- **`ThreadLocal` becomes a memory concern.** With one thread per task and millions of tasks, per-thread state multiplies. `ScopedValue` (final in 25) is the replacement.

---

## Monitoring

**JFR is the best route to lock contention** because it comes from inside the JVM:

```bash
jfr print --events jdk.JavaMonitorEnter recording.jfr    # which lock, how long, stack
jfr print --events jdk.ThreadPark recording.jfr
jfr print --events jdk.VirtualThreadPinned recording.jfr # 21+
```

Without JFR, take several thread dumps a few seconds apart and look for repetition:

```bash
for i in 1 2 3 4 5; do jcmd <pid> Thread.print > td-$i.txt; sleep 3; done
```

Interpretation:

| Pattern | Meaning |
| ------- | ------- |
| Many `BLOCKED` on the same monitor, repeatedly | Real contention |
| Many `WAITING` in a pool's `getTask` | Idle. Normal |
| Many in `socketRead0` | Waiting on an external system, not a lock |
| Many in `Throwable.getStackTraceElement` | Excessive exception logging ([exceptions-and-logging.md](exceptions-and-logging.md)) |

**Do not build a profiler from repeated thread dumps.** Safepoint bias and inconsistent snapshots make the attribution unreliable - two threads can appear to hold the same lock. Use them for "blocked, and on what", never "where is time spent".

### JVM thread flags

| Flag | Verdict |
| ---- | ------- |
| `-Xss<size>` | Reduce only in memory-constrained, thread-heavy cases. Default 1 MB |
| `-XX:-UseBiasedLocking` | **Gone.** Disabled by default in 15; accepted on 17, **fatal on 21 and 25** |
| Thread priorities | Do not rely on them at all |

**Thread priorities do not work the way the API suggests.** The OS computes an effective priority dominated by how long a thread has waited, so no thread starves and Java's priority barely registers on Unix. On Windows higher-priority threads run more, but low-priority threads still get substantial CPU. **If some work is more important, express that in application logic or separate pools** - not `setPriority`. Separate pools give crude but real prioritisation: on four CPUs, 12 HTTP threads against 4 EJB threads makes an HTTP request roughly three times likelier to get CPU.

**Biased locking is worth a note** because older material recommends tuning it. It optimised for a lock reacquired by the same thread, and in thread-pool architectures - where different threads take the same lock - the bookkeeping cost more than it saved, so `-XX:-UseBiasedLocking` was a real recommendation. It was disabled by default in Java 15 and removed; verified **unrecognised and fatal on 21 and 25**. `-XX:+UseSpinning` was similarly obsolete and is absent from all five versions.

---

## Version notes

Verified by `-XX:+PrintFlagsFinal` on 8u504, 11.0.32.1, 17.0.20.1, 21.0.12 and 25.0.4.1, by measurement on 25.0.4.1, and by launching each JVM.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| `UseBiasedLocking` | ✓ | ✓ | ✓ (accepted) | **fatal** | fatal |
| `UseSpinning` | **absent** | absent | absent | absent | absent |
| `LongAdder`, `LongAccumulator` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ForkJoinPool.commonPool` parallelism | max(1, CPUs−1) | max(1, CPUs−1) | max(1, CPUs−1) | max(1, CPUs−1) | **max(1, CPUs−1) (verified)** |
| `@Contended` package | `sun.misc` | `jdk.internal.vm.annotation` | same | same | same |
| `RestrictContended` / `EnableContended` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Virtual threads | ✗ | ✗ | ✗ | ✓ | ✓ |
| `synchronized` pins a virtual thread | - | - | - | **✓ (ceiling)** | ✗ (fixed in 24) |
| `jdk.VirtualThreadPinned` JFR event | ✗ | ✗ | ✗ | ✓ | ✓ |
| `Thread.vthread_scheduler` / `vthread_pollers` | ✗ | ✗ | ✗ | ✗ | **✓** |
| `Thread.dump_to_file` | ✗ | ✗ | ✗ | ✓ | ✓ |
| Thread stacks committed lazily | **✗** | ✓ | ✓ | ✓ | ✓ |

Two version traps:

- **`-XX:-UseBiasedLocking` is fatal from 21.** Verified: accepted on 8, 11 and 17, unrecognised on 21 and 25. It is exactly the flag a thread-pool-heavy Java 8 or 11 command line carries, so the upgrade that breaks is 17 → 21, not 11 → 17.
- **Java 8 commits thread stacks eagerly** - 61.7 MB committed for 63 threads against 3.7 MB on 25 ([native-memory.md](native-memory.md)). On 8, thread count is a direct and large memory cost; on 9+ it is mostly not.

## Gotchas

- Agent adds threads because CPU is idle and work is queued - if the constraint is downstream this made response time 9× worse in Oaks' measurement
- Agent sizes a pool to the core count for I/O-bound work - needs enough for the simultaneously *blocked* too
- Agent sizes a pool above the core count for CPU-bound work - cannot help, and adds coordination cost
- Agent counts hyper-threads as cores - the second hardware thread adds 20-40%, not 100%
- Agent uses `Executors.newFixedThreadPool` / `newCachedThreadPool` in production - unbounded queue or unbounded threads; construct `ThreadPoolExecutor` explicitly
- Agent expects a bounded-queue pool to grow when the queue fills - it grows only when a task arrives at an *already full* queue
- Agent sets a maximum pool size with an unbounded queue - the maximum is ignored; core size is the pool size
- Agent leaves the queue unbounded - converts overload into unbounded memory and latency; bound it and return 429/503
- Agent uses `ForkJoinPool` for evenly partitionable work - measured two orders of magnitude worse than partitioning
- Agent leaves the fork/join leaf threshold at an arbitrary value - it dominates the result and must be measured
- Agent submits blocking work to `commonPool()` - shared with every parallel stream in the JVM, including libraries
- Agent expects parallel streams to be parallel in a 1-2 CPU container - common pool parallelism is `CPUs − 1`, verified 1 at both
- Agent concludes lock cost from a microbenchmark - they overstate contention severely
- Agent uses `AtomicLong` for a hot shared counter - `LongAdder` is far better under contention
- Agent removes contention by constructing a new `Random` each call - measured 2.6× worse than `ThreadLocalRandom`; seeding is the cost
- Agent calls several fine-grained synchronised methods in a loop - memory barriers can cost more than one coarse lock
- Agent ignores false sharing when per-thread work scales negatively - measured fully serialised with no logical sharing
- Agent pads fields with arrays to fix false sharing - the JVM reorders them; use primitives or `@Contended`
- Agent recommends `-XX:-UseBiasedLocking` - no effect on 17 (biased locking already gone) and **fatal on 21 and 25**
- Agent uses `Thread.setPriority` to prioritise work - the OS largely ignores it; use separate pools
- Agent builds a profiler from repeated thread dumps - safepoint bias; use them only for "blocked, and on what"
- Agent expects virtual threads to speed up a serial fan-out inside one request - they do not; that is `StructuredTaskScope`
- Agent puts a blocking call inside `synchronized` on Java 21-23 - pins the carrier and caps concurrency; use `ReentrantLock` or upgrade past 24

## Related

- [triage.md](triage.md) · [collections-performance.md](collections-performance.md) · [methodology.md](methodology.md) · [tooling.md](tooling.md) · [containers.md](containers.md) · [native-memory.md](native-memory.md) · [server-performance.md](server-performance.md) · [object-lifecycle.md](object-lifecycle.md) · [flags.md](flags.md) · [java-versions.md](java-versions.md)
