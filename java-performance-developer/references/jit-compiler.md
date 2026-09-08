# The JIT Compiler

Nothing controls the performance of a Java application more than the JIT compiler - and almost nothing here should be tuned. This file exists mainly so you can recognise when the compiler *is* the problem (rare, but real) and rule it out fast (common).

| Tuning | Verdict |
| ------ | ------- |
| `-XX:ReservedCodeCacheSize=N` | **The one worth changing** - and only if the JVM says the code cache is full |
| `-XX:+TieredCompilation` | Leave on. Default `true` on all versions |
| `-XX:TieredStopAtLevel=1` | Only for genuinely short-lived processes. Never for a server |
| `-XX:CICompilerCount=N` | Only when several JVMs share a host, or on a 1-CPU container |
| `-XX:+PrintCompilation` | Diagnostic, not a tuning. Useful once, noisy always |
| `-XX:CompileThreshold=N` | **Does nothing under tiered compilation.** Ignore the advice you have read |
| `MaxInlineSize`, `FreqInlineSize` | Practically never. See the trap below |
| `-XX:-DoEscapeAnalysis` | Never, unless chasing a suspected compiler bug |
| `-XX:+UseJVMCICompiler` (Graal JIT) | Interesting, not a default. See the version notes |

**If a profile shows a method you expected to be fast sitting at the top, the compiler is worth a look. Otherwise it is not.**

---

## What it does, and why it waits

Java compiles to bytecode, then the JVM compiles bytecode to machine code *while the program runs*. That timing is the whole design: the compiler waits so it can watch.

Consider `b = obj1.equals(obj2)`. Interpreted, the JVM must look up `obj1`'s actual type each time to find the right `equals`. After observing that `obj1` has been a `String` every time, the compiler can emit a direct call to `String.equals` and skip the lookup - and inline it. It also inserts a guard, so if `obj1` is ever something else the code is thrown away and recompiled. That is **deoptimisation**, and it is the price of speculating.

Two reasons not to compile immediately: code executed once is cheaper to interpret than to compile, and code executed a million times deserves optimisations that require knowing how it behaves. Hence "hot spots".

### Tiered compilation and its five levels

Two compilers, and since Java 8 they work together rather than as a choice:

- **C1** - compiles early, optimises lightly. Faster to good-enough code.
- **C2** - waits for profile data, optimises aggressively. Slower to better code.

```
0  Interpreted
1  C1, trivial method - fully optimised, no profiling (nothing to learn)
2  C1, limited profiling - used when the C2 queue is backed up
3  C1, full profiling     - the normal path
4  C2                      - the destination for genuinely hot code
```

The expected path is **0 → 3 → 4**. Methods start interpreted, get C1-compiled with profiling, and the hot ones are recompiled by C2. Trivial methods stop at level 1 because there is nothing to profile. Level 2 appears when C2 is saturated: the JVM takes the method out of C2's queue, gives it cheaper C1 code now, and revisits later. **Frequent level 2 in a compilation log means the C2 queue is backed up** - the only actionable signal in the whole log, and the fix is more compiler threads if CPU allows, or less code.

Verified `true` on 8u504, 11.0.32.1, 17.0.20.1, 21.0.12 and 25.0.4.1. The old `-client` / `-server` / `-d64` selectors are long gone; on any modern JDK they are either ignored or fatal.

---

## The code cache: the one thing that bites

Compiled code lives in a fixed-size native region. **When it fills, compilation stops** and the JVM runs interpreted from then on - a catastrophic, silent slowdown for a large application.

```
Java HotSpot(TM) 64-Bit Server VM warning: CodeCache is full. Compiler has been disabled.
Java HotSpot(TM) 64-Bit Server VM warning: Try increasing the code cache size using -XX:ReservedCodeCacheSize=
```

That warning is easy to lose in a log, so check directly:

```bash
jcmd <pid> Compiler.codecache                 # 11+ : per-segment used/free
jcmd <pid> Compiler.CodeHeap_Analytics        # 11+ : detailed
# or watch the Memory Pool "Code Cache" charts in jconsole
```

Verified defaults, identical across versions apart from rounding:

| | 8u504 | 11.0.32.1 | 17.0.20.1 | 21.0.12 | 25.0.4.1 |
| --- | ----- | --------- | --------- | ------- | -------- |
| `ReservedCodeCacheSize` | 240 MB | 240 MB | 240 MB | 240 MB | 240 MB |
| `InitialCodeCacheSize` | 2.44 MB | 2.44 MB | 2.44 MB | 2.44 MB | 2.44 MB |
| `SegmentedCodeCache` | **absent** | `true` | `true` | `true` | `true` |

240 MB is generous, so exhaustion now mostly happens in very large applications or where something generates classes at runtime. There is no way to predict the requirement - if you hit the limit, double or quadruple it. The cost of over-reserving is a virtual memory *reservation*, not a commitment, so on a 64-bit host with address space to spare it is nearly free. On a 32-bit JVM, where the whole process is capped at ~4 GB, it is not.

**From Java 11 the cache is segmented into three heaps** (verified `SegmentedCodeCache` absent on 8, `true` on 11+):

| Segment | Holds | Verified default (11+) |
| ------- | ----- | ---------------------- |
| `NonNMethodCodeHeapSize` | JVM internal code, adapters | ~5.6 MB |
| `ProfiledCodeHeapSize` | C1 code, which is transient | ~117 MB |
| `NonProfiledCodeHeapSize` | C2 code, which is long-lived | ~117 MB |

Tune the total with `ReservedCodeCacheSize` and let it divide. Sizing the segments individually is almost never right.

**Two of the three errata in Oaks' book, found by running the flags.** *Java Performance* 2nd ed names `-XX:ProfiledCodeHapSize` and `-XX:NonProfiledCodeHapSize` - "Hap", not "Heap". Neither exists on any version; the real flags are `ProfiledCodeHeapSize` and `NonProfiledCodeHeapSize`. And the book names `-XX:MaxFreqInlineSize=N` for the frequent-inlining threshold, which **does not exist on 8, 11, 17, 21 or 25** - the real flag is `FreqInlineSize`, verified at 325 on all five. **That one is in both editions**, body text and index alike, so it is a long-standing error rather than a 2nd-edition slip. Copying either from the book produces a JVM that refuses to start.

---

## Inlining

The most valuable optimisation the compiler performs, and the reason encapsulation is free in Java. Given:

```java
Point p = getPoint();
p.setX(p.getX() * 2);
```

the compiled code is effectively `p.x = p.x * 2` - no calls at all. Disabling inlining costs over 50% of throughput on typical code, which is the measure of how much work it is doing.

Two thresholds, both verified identical on all five versions:

- `-XX:MaxInlineSize=35` - bytecode size below which any method may be inlined.
- `-XX:FreqInlineSize=325` - bytecode size below which a *frequently called* method may be inlined.

**The commonly repeated advice to raise `MaxInlineSize` is mostly pointless, and the reasoning is worth internalising.** Raising it lets a method be inlined *the first time it is called*. But a method that matters is called often, and once it is hot the 325-byte threshold already applies. So raising the small threshold mainly shortens warm-up and rarely changes steady-state performance. The corollary is the actionable rule: **keep hot methods under 325 bytes of bytecode** and inlining takes care of itself.

`-XX:+PrintInlining` requires a debug JVM build, so on a production JDK you cannot see inlining decisions directly. Infer from the profile instead: small methods near the top that should have vanished are the signal.

---

## Escape analysis

C2's most sophisticated optimisation. If an object provably cannot be reached outside the method that created it, the compiler may skip the synchronisation on it, keep its fields in registers, and **not allocate it at all** - scalar replacement.

```java
for (int i = 0; i < 100; i++) {
  Factorial f = new Factorial(i);   // never escapes the loop body
  list.add(f.getFactorial());       // so `f` may never be allocated,
}                                   // and its synchronized method need not lock
```

Verified `DoEscapeAnalysis=true` and `EliminateAllocations=true` on all five versions. Leave both on. This is the optimisation that most often makes a microbenchmark meaningless - a benchmark's throwaway object escapes nowhere and vanishes, while the real application's identical-looking object escapes and does not.

Historic advice to disable it dates from bugs long fixed. If you genuinely suspect it, the right response is to simplify the method, not to disable a global optimisation.

---

## Deoptimisation

Two things in a compilation log look alarming and are usually healthy.

**"made not entrant"** - the compiled code may no longer be entered. Two causes:

1. **A speculation was invalidated.** Code compiled assuming `sph` is always a `StockPriceHistoryImpl` meets a `StockPriceHistoryLogger`; the assumption dies and so does the code.
2. **Tiered compilation working normally.** When C2 finishes a method, the C1 version is made not entrant. **This is the common case** - a tiered log is full of these and it means the code got faster.

**"made zombie"** - code previously made not entrant is now reclaimable, freeing code cache. Also healthy.

Oaks measured the throughput cost of the first case on a REST server: 24.4 OPS on the standard path, 24.1 with the logging implementation, 24.3 with the two intermingled so the compiler could never settle. **Deoptimisation cost essentially nothing.** Do not chase it in a log unless you are also seeing a real regression.

---

## Compiler threads

Compilation happens on background threads, on priority queues where hotter methods jump ahead - which is why compilation IDs appear out of order and why that is not a defect.

Verified `CICompilerCount=4` on this 8-CPU host for all five versions. The default scales with CPU count (roughly one third to C1, the rest to C2, minimum one each):

| CPUs | C1 | C2 | Total |
| ---- | -- | -- | ----- |
| 1 | 1 | 1 | 2 |
| 2 | 1 | 1 | 2 |
| 4 | 1 | 2 | 3 |
| 8 | 1 | 2 | 3 |
| 16 | 2 | 6 | 8 |
| 32 | 3 | 7 | 10 |
| 64 | 4 | 8 | 12 |

Two cases for lowering it: a **1-CPU container**, where fewer compiler threads leave more for the application during warm-up (Oaks measured ~10% faster initial work, an advantage that disappears once compilation settles); and **many JVMs on one host**, where each sizes to the whole machine independently. On 8u192+ and all later versions this is computed from the container's CPU limit - see [containers.md](containers.md).

Raising it almost never helps. If spare CPU exists, spend it on something that lasts longer than warm-up.

---

## The flags that do nothing

`-XX:CompileThreshold=N` (verified 10000 on all five) **has no effect when tiered compilation is enabled**, which it is by default everywhere. Under tiering the thresholds that matter are `Tier3InvocationThreshold` (200) and `Tier4InvocationThreshold` (5000), both verified identical across all five versions. Recommendations to lower `CompileThreshold` are Java 7-era advice and are inert today.

The counter mechanism is still worth understanding, because it explains a real phenomenon. Compilation triggers on invocation count plus loop back-edge count - but **the counters decay at safepoints**, so they measure *recent* hotness. A method called steadily but not often may never reach C2 even in a process running for months. These are "lukewarm" methods, and they are why tiered compilation wins: C1 compiles them, so they are never left interpreted. `Tier3InvocationThreshold` and `Tier4InvocationThreshold` exist if you want to move those lines; there is rarely a reason to.

`-XX:+BackgroundCompilation` (verified `true` everywhere) can be disabled, or `-Xbatch` used, to make execution wait for compilation. That is a determinism tool for experiments, not a performance tuning.

### On-stack replacement

A long-running loop cannot wait for its enclosing method to be re-entered. OSR compiles the loop and swaps it in *while it is running*, which is why `%` appears in `PrintCompilation` output and why OSR entries often appear much later than their compilation ID suggests. Nothing to tune; recognise it so you do not misread the log.

---

## CPU-specific instructions

The JIT emits instructions for the CPU it finds. `-XX:UseAVX=N` selects the Intel AVX level (0 none, 1 AVX, 2 AVX2, 3 AVX-512) and `-XX:UseSSE=N` the SSE level. **Verified `UseAVX=2` and `UseSSE=4` on all five versions** on this host.

AVX-512 had a rocky history: enabled by default in early Java 11, disabled again by 11.0.6 after real-world problems. That history is why `UseAVX=2` remains the effective default. Almost no application should touch these; the exception is scientific or vector-heavy code on hardware where you have measured a difference.

---

## Version notes

Verified by `-XX:+PrintFlagsFinal` and by launching each JVM.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| `TieredCompilation` default | true | true | true | true | true |
| `SegmentedCodeCache` | **absent** | true | true | true | true |
| `ReservedCodeCacheSize` | 240 MB | 240 MB | 240 MB | 240 MB | 240 MB |
| `CompileThreshold` (inert under tiering) | 10000 | 10000 | 10000 | 10000 | 10000 |
| `Tier3/Tier4InvocationThreshold` | 200 / 5000 | 200 / 5000 | 200 / 5000 | 200 / 5000 | 200 / 5000 |
| `MaxInlineSize` / `FreqInlineSize` | 35 / 325 | 35 / 325 | 35 / 325 | 35 / 325 | 35 / 325 |
| `DoEscapeAnalysis` | true | true | true | true | true |
| `UseAVX` / `UseSSE` | 2 / 4 | 2 / 4 | 2 / 4 | 2 / 4 | 2 / 4 |
| `EnableJVMCI` / `UseJVMCICompiler` | **absent** | false | false | false | false |
| Graal compiler module | absent | `jdk.internal.vm.compiler` | `jdk.internal.vm.compiler` | `jdk.internal.vm.compiler` | **`jdk.graal.compiler`** |
| `UseAOT` + `jaotc` (old-style AOT) | absent | **✓** | **removed** | removed | removed |
| `Compiler.codecache` / `CodeHeap_Analytics` via jcmd | ✗ | ✓ | ✓ | ✓ | ✓ |
| `-client` / `-server` / `-d64` | ignored | `-d64` fatal | fatal | fatal | fatal |

Three findings worth stating plainly:

- **The Graal JIT is still present on 25, but the module was renamed.** Verified with `--list-modules`: `jdk.internal.vm.compiler` on 11, 17 and 21, and **`jdk.graal.compiler`** on 25.0.4.1. `-XX:+UnlockExperimentalVMOptions -XX:+EnableJVMCI -XX:+UseJVMCICompiler` starts successfully on 11, 17 and 25. Oaks' figures for it are long superseded - the compiler has moved several times since - so treat it as worth an experiment on a compute-bound workload and nothing more. **Not verified here:** whether Graal was actually used for compilation, only that the JVM started and the module exists.
- **Old-style AOT was a Java 11-only feature.** Verified: `UseAOT` is absent on 8, present on 11 where `-XX:+UseAOT` reports `mixed mode, aot`, and absent from 17, 21 and 25; the `jaotc` binary is present on 11 and absent from 17 and 25. So Oaks' entire `jaotc` / `-XX:AOTLibrary` section applies to exactly one release and was removed by JEP 410. Its replacement is the AOT cache in [startup-and-warmup.md](startup-and-warmup.md).
- **`-XX:+PrintGCDetails`-style leniency does not extend here.** `-d64` is fatal from 11 on.

## Gotchas

- Agent recommends `-XX:CompileThreshold=N` - inert under tiered compilation, which is the default everywhere
- Agent recommends `-XX:MaxFreqInlineSize` - does not exist on any version; the flag is `FreqInlineSize`. This is an erratum in Oaks' book
- Agent recommends `-XX:ProfiledCodeHapSize` or `-XX:NonProfiledCodeHapSize` - misspellings in the book; the real flags contain `Heap`
- Agent recommends `-client`, `-server` or `-d64` - no-ops on 8, and `-d64` is fatal from 11
- Agent reads "made not entrant" as a defect - under tiering it usually means C2 replaced C1, i.e. the code got faster
- Agent chases deoptimisation without a matching regression - measured throughput cost is close to nil
- Agent sets `-XX:TieredStopAtLevel=1` on a server to improve startup - caps it at C1 code forever
- Agent disables escape analysis or inlining as a "safe" measure - both are large, correct wins
- Agent raises `MaxInlineSize` to get more inlining - hot methods already qualify under the 325-byte threshold; keep hot methods small instead
- Agent leaves `-XX:+PrintCompilation` on in production - high-volume output, and it is a diagnostic
- Agent tries `-XX:+PrintInlining` on a product JVM - requires a debug build
- Agent raises `CICompilerCount` to speed warm-up - rarely helps; lowering it helps on 1-CPU containers and shared hosts
- Agent recommends `-XX:+UseAOT` or `jaotc` - Java 11 only, removed in 17; use the AOT cache on 24+
- Agent assumes the Graal JIT was removed - the module is present on 25, renamed to `jdk.graal.compiler`
- Agent tunes `UseAVX` speculatively - default 2 on every version tested, and AVX-512 was disabled by default for good reason
- Agent ignores a "CodeCache is full" warning - compilation stops and everything runs interpreted from that point

## Related

- [startup-and-warmup.md](startup-and-warmup.md) · [methodology.md](methodology.md) · [tooling.md](tooling.md) · [allocation.md](allocation.md) · [triage.md](triage.md) · [containers.md](containers.md) · [flags.md](flags.md) · [java-versions.md](java-versions.md)
