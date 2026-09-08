# Heap Analysis

Finding out what is actually filling the heap. Optimising memory without this is guesswork - you can spend a day saving 640 bytes on an object the application allocates once.

| Tool | Use for | Cost |
| ---- | ------- | ---- |
| **`jcmd GC.heap_info`** | Committed against used, per generation | Trivial |
| **`jcmd GC.class_histogram`** | "Which class is eating the heap" - the usual first answer | **Forces a full GC** |
| **`jcmd GC.heap_dump`** | Everything, for offline analysis | Full GC plus a long pause writing the file |
| **Eclipse MAT** | Real analysis: dominators, paths to roots, dump comparison | Offline |
| **JFR `ObjectAllocationSample`** | *Where* allocation happens, not just what survives | ~1-2%, 16+ |

**Histogram first, dump second.** A histogram takes seconds and answers most questions. A dump is large, slow and requires patience - worth it when the histogram is not enough.

---

## Histograms

```bash
jcmd <pid> GC.class_histogram | head -25
```

```
 num     #instances         #bytes  class name
----------------------------------------------
   1:        789087       31563480  java.math.BigDecimal
   2:        172361       14548968  [C
   3:         13224       13857704  [B
   4:        184570        5906240  java.util.HashMap$Node
   5:         14848        4188296  [I
   6:        172720        4145280  java.lang.String
```

JNI array notation: `[C` is `char[]`, `[B` is `byte[]`, `[I` is `int[]`, `[Ljava.lang.Object;` is `Object[]`.

**Expect `[C`/`[B`, `String`, `Object[]` and `HashMap$Node` near the top** - that is a normal Java heap and tells you nothing. What matters is a domain class that should not be there, or a JDK class in an implausible quantity. In the example, 789,087 live `BigDecimal` instances is the finding: the application creates them as transients, so they should not survive.

**`GC.class_histogram` forces a full GC**, so it reports the live set - which is what you want, and means never running it inside a measurement window. `jmap -histo <pid>` skips the collection and therefore includes garbage; `jmap -histo:live <pid>` forces one. Prefer `jcmd`.

Histograms are small enough to capture on every automated test run, and a diff across runs is often the earliest sign of a leak.

---

## Shallow, retained and deep

Three sizes, and confusing them is the most common analysis error.

- **Shallow** - the object alone. References counted as 4 or 8 bytes; targets not counted.
- **Deep** - the object plus everything reachable from it, shared or not.
- **Retained** - the memory that would be **freed if this object were collected**: itself plus everything reachable *only* through it.

```
        ┌─────────────┐        ┌────────────┐
        │ String Trio │        │  Flute Duo │
        └──────┬──────┘        └─────┬──────┘
          ┌────┴────┬───────────┐    │
          ▼         ▼           ▼    ▼
       Sally     David       Michael ◄── two parents
```

`String Trio`'s **retained** size covers itself, `Sally` and `David` - not `Michael`, which survives because `Flute Duo` still points at it. Its **deep** size includes `Michael`.

**Retained is the actionable number**, because it answers "what do I get back". Deep size overstates the benefit for any shared graph.

Objects with large retained sizes are **dominators**. If a few dominate the heap, the job is easy: make fewer, hold them shorter, shrink them, or simplify their graph.

---

## When nothing dominates

The common and harder case. Oaks' example: a 1.4 GB heap whose largest single retained set was **6 MB**, and part of the classloading framework at that. Everything else was shared, so no object's removal freed much.

Two moves.

**Switch to the histogram view.** Aggregating by class showed 7 million `TreeMap$Entry` objects retaining 1.4 GB. Individually trivial, collectively the whole heap. **Aggregate by type when no instance dominates.**

**Then trace incoming references to find where sharing begins.** Do *not* jump to GC roots - references fan out in reverse, so a shared object has many roots and the list is useless. Instead expand incoming references until a duplicate path appears. In that case each entry had two referents: a `ConcurrentHashMap` holding session attributes, and a `WeakHashMap` acting as a global cache. That is the finding - the same objects retained by two independent structures.

**Start from collections, not entries.** Look at `HashMap` rather than `HashMap$Node`, and find the biggest ones. Entry objects are numerous and anonymous; the collection has an owner with a name.

---

## Heap dumps

```bash
jcmd <pid> GC.heap_dump /path/out.hprof          # full GC first (default)
jcmd <pid> GC.heap_dump -all /path/out.hprof     # skip the GC; includes garbage
jmap -dump:live,file=/path/out.hprof <pid>       # equivalent via jmap
```

Both pause the application for as long as it takes to write, which for a large heap is substantial. Automate capture rather than trying to be present:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/dumps
-XX:+HeapDumpBeforeFullGC        # diagnostic only - very expensive
-XX:+HeapDumpAfterFullGC
```

`HeapDumpOnOutOfMemoryError` should be on in production. It costs nothing until the failure and it is often the only chance to diagnose it.

**Use Eclipse MAT.** It computes retained sizes and dominator trees, finds paths to GC roots, runs OQL, produces a leak-suspect report, and - critically - **compares two dumps**. The bundled tools do not do most of that. Give MAT plenty of heap of its own; analysing a 4 GB dump needs several gigabytes.

Before dumping, drain the finalizer queue so objects that are about to be freed do not appear as live:

```bash
jcmd <pid> GC.run_finalization
jcmd <pid> GC.finalizer_info      # check whether anything was queued
```

---

## Finding a leak

**A leak is growth in the live set, so the only reliable indicator is occupancy after a full GC.** Peaks in a sawtooth graph prove nothing.

```bash
jcmd <pid> GC.run && jcmd <pid> GC.heap_info     # repeat over time; watch the floor
jstat -gcutil <pid> 5000                          # watch O after each FGC increments
```

Then two dumps minutes or hours apart, compared in MAT. The class whose instance count grows without bound names the leak.

**Collection classes are the usual culprit** - something is added and never removed. The fix is application logic: remove entries when they stop being needed. A weak or soft reference collection makes the problem self-limiting but is not free ([object-lifecycle.md](object-lifecycle.md)).

**Look at `Inflater`/`Deflater` counts too.** They are far too small to matter in the heap, but a large number signals **native** memory that has not been released, which is a different investigation ([native-memory.md](native-memory.md)).

### Where allocation happens

A histogram shows what *survived*; it does not show what is being *created*. For allocation pressure - high GC frequency with a stable live set - the question is where objects come from:

```bash
jfr print --events jdk.ObjectAllocationSample recording.jfr        # 16+
jfr print --events jdk.ObjectAllocationOutsideTLAB recording.jfr   # 11+
```

`ObjectAllocationSample` gives the allocating stack trace, which is usually the fastest route from "GC runs constantly" to the line responsible. Sampled, so it is cheap enough for production.

---

## The class loader leak

Metaspace fills, `OutOfMemoryError: Metaspace` follows, and raising `MaxMetaspaceSize` only delays it.

The mechanism: a container creates a class loader per deployment. Redeploy, and the old loader should become unreachable, letting its classes' metadata be freed. **If anything still references the old loader - most often a thread whose context class loader was never reset - none of its classes can be unloaded.** Repeat over a development day and metaspace fills.

```bash
jcmd <pid> VM.metaspace                # 11+ : breakdown, including waste
jcmd <pid> VM.classloader_stats        # 8+  : per-loader class and byte counts
jcmd <pid> VM.classloaders             # 11+ : the loader tree
jmap -clstats <pid>                     # 8   : -permstat on very old builds
```

Many instances of the same loader class is the signature. Then find what retains them in MAT - usually a thread, a `ThreadLocal`, a JDBC driver registration, a shutdown hook or a logging framework.

**Bound metaspace deliberately.** Its default maximum is unlimited, so an unbounded loader leak consumes the machine. A maximum converts that into a diagnosable `OutOfMemoryError`. Note the leak also holds `Class` and loader objects in the *main* heap, so a heap `OutOfMemoryError` often arrives first.

---

## The out-of-memory taxonomy

**Read the message.** Six causes, and only two are "the heap is too small".

| Message | Cause | First move |
| ------- | ----- | ---------- |
| `Java heap space` | Live set exceeds the heap | Dump and look for a leak before raising `-Xmx` |
| `GC overhead limit exceeded` | ~98% of time in GC, reclaiming <2% | Almost always a leak |
| `Metaspace` | Class metadata exhausted | Class loader leak; `VM.classloader_stats` |
| `unable to create new native thread` | **Usually an OS thread limit** (`ulimit -u`), not memory | Count threads; check the limit |
| `Direct buffer memory` (17+: `Cannot reserve N bytes of direct buffer memory`) | `MaxDirectMemorySize` reached | **Check for `-XX:+DisableExplicitGC` first** - it removes the reclamation trigger and produces this with no leak present. Then leak, then cap |
| `Requested array size exceeds VM limit` | One array over the implementation limit | An algorithmic bug |

### `GC overhead limit exceeded`

Thrown only when **all** of these hold:

- Time in full GCs exceeds `GCTimeLimit` (verified **98** on all five versions).
- A full GC reclaims less than `GCHeapFreeLimit` (verified **2**, i.e. 2%).
- Both true for **five consecutive** full GCs (not tunable).
- `-XX:+UseGCOverheadLimit` is on (the default).

So more than five consecutive full GCs without this error is normal - the JVM was reclaiming more than 2% each time. Raising `GCHeapFreeLimit` makes the JVM give up sooner, which is occasionally what you want in a container that should restart.

A useful detail: if the first two conditions hold for **four** consecutive cycles, the JVM clears **every soft reference** before the fifth. That often prevents the error outright - and a mass soft-reference clearing in the reference log is itself the diagnosis ([object-lifecycle.md](object-lifecycle.md)).

### The JVM often survives an `OutOfMemoryError`

It kills the thread that hit it. That thread's objects then become collectable, so the JVM frequently recovers and continues - degraded - while other threads run. Server frameworks catch it per request and carry on.

Two consequences. The error can sit in a log for hours before anyone notices. And a JVM that has thrown one is in an unknown state - some request failed halfway through. In a container, prefer failing fast:

```bash
-XX:+ExitOnOutOfMemoryError
```

Let the orchestrator restart a clean process. Verified available from 8u92.

---

## Version notes

Verified by `-XX:+PrintFlagsFinal` and `jcmd <pid> help` on 8u504, 11.0.32.1, 17.0.20.1, 21.0.12 and 25.0.4.1.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| `GC.class_histogram`, `GC.heap_dump`, `GC.heap_info` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GC.class_stats` | ✓ | **✗** | ✗ | ✗ | ✗ |
| `VM.classloader_stats` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `VM.classloaders` (tree) | ✗ | ✓ | ✓ | ✓ | ✓ |
| `VM.metaspace` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `jhat` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `jhsdb` (post-mortem on a core file) | ✗ | ✓ | ✓ | ✓ | ✓ |
| `jdk.ObjectAllocationSample` JFR event | ✗ | ✗ | ✓ (16+) | ✓ | ✓ |
| `GCTimeLimit` / `GCHeapFreeLimit` | 98 / 2 | 98 / 2 | 98 / 2 | 98 / 2 | 98 / 2 |
| `ExitOnOutOfMemoryError` | 8u92+ | ✓ | ✓ | ✓ | ✓ |
| Metaspace (rather than permgen) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `PermSize` / `MaxPermSize` | ignored+warn | ignored+warn | **fatal** | fatal | fatal |

Three notes:

- **On Java 8, permgen is already gone** - it was replaced by metaspace *in* Java 8. Verified: `-XX:MaxPermSize` is accepted-and-ignored with a warning on **both 8 and 11**, and **unrecognised and fatal from 17**. So a Java 7-era command line survives two LTS releases and then fails on the third - which is precisely why these flags persist in scripts for a decade.
- **`jhat` was the bundled dump analyser on 8 and is gone from 11 onward.** Nothing bundled replaced it; use Eclipse MAT.
- **`ObjectAllocationSample` (16+) is the single best addition** to this toolkit in the last decade - allocation stack traces cheap enough for production. On 8 and 11 you need `ObjectAllocationOutsideTLAB`, which sees only a subset, or an instrumenting profiler.

## Gotchas

- Agent raises `-Xmx` in response to `OutOfMemoryError: Java heap space` without checking for a leak - that postpones the failure
- Agent treats every `OutOfMemoryError` as a heap problem - six causes; read the message
- Agent tries to fix `Metaspace` exhaustion with `-Xmx` - metaspace is sized separately
- Agent reads `unable to create new native thread` as memory pressure - usually `ulimit -u`
- Agent diagnoses a leak from peak heap in a sawtooth graph - the indicator is occupancy *after a full GC*
- Agent runs `GC.class_histogram` or `jmap -histo:live` during a measurement - both force a full GC
- Agent uses `jmap -histo` without `:live` and treats it as the live set - it includes garbage
- Agent reports `[C`, `String` and `Object[]` at the top of a histogram as the finding - that is every Java heap
- Agent confuses deep with retained size - retained is what you get back; deep overstates it for shared graphs
- Agent traces straight to GC roots for a shared object - references fan out in reverse; find where sharing begins
- Agent starts from `HashMap$Node` rather than the owning `HashMap` - entries are anonymous, collections have owners
- Agent looks only at the heap when allocation pressure is the problem - a histogram shows survivors, not creation; use `ObjectAllocationSample`
- Agent takes one heap dump to find a leak - you need two, compared
- Agent forgets to drain the finalizer queue before dumping - about-to-die objects appear live
- Agent leaves metaspace unbounded on a server that redeploys - a loader leak then consumes the machine
- Agent leaves a JVM running after an `OutOfMemoryError` in a container - it is in an unknown state; prefer `-XX:+ExitOnOutOfMemoryError`
- Agent enables `-XX:+HeapDumpBeforeFullGC` in production - extremely expensive; diagnostic only
- Agent uses `PermSize`/`MaxPermSize` - ignored with a warning on 8 and 11, **fatal from 17**

## Related

- [triage.md](triage.md) · [allocation.md](allocation.md) · [object-lifecycle.md](object-lifecycle.md) · [native-memory.md](native-memory.md) · [gc-tuning.md](gc-tuning.md) · [collections-performance.md](collections-performance.md) · [strings.md](strings.md) · [tooling.md](tooling.md) · [flags.md](flags.md)
