# Native Memory and Footprint

Everything the JVM uses that is not the Java heap. This is where "the heap looks fine but the container keeps getting killed" lives, and it is the half of Java memory that most people never look at.

| Consumer | Typical size | Bounded by | Grows with |
| -------- | ------------ | ---------- | ---------- |
| **Java heap** | 50-60% of footprint | `-Xmx` | Live data |
| **Thread stacks** | 1 MB reserved each | `-Xss` × thread count | Thread count |
| **Code cache** | Up to 240 MB reserved | `ReservedCodeCacheSize` | Compiled methods |
| **Metaspace** | 20 MB up, **unbounded by default** | `MaxMetaspaceSize` | Classes loaded |
| **GC structures** | Varies sharply by collector | Collector choice | Heap size |
| **Direct byte buffers** | Application-dependent | `MaxDirectMemorySize` | NIO usage |
| **Native libraries** | Invisible to NMT | Nothing | Whatever they do |

**The heap is only part of the footprint, and the part outside it is what gets containers OOM-killed.** Size a container from the total, not from `-Xmx`.

---

## Reserved is not committed

The distinction that makes every footprint number make sense.

Given `-Xms512m -Xmx2048m`, the JVM tells the OS it may eventually need 2 GB - a **reservation**, a promise the address space will be there. It initially uses 512 MB - **committed**, actually backed by memory.

**Only committed memory matters for performance.** Over-reserving costs nothing on a 64-bit host with address space to spare. So a 2.5 GB "virtual size" in `top` next to 380 MB of real usage is normal and not a problem.

Two cases where reservations do matter: a 32-bit JVM, where the whole process is capped near 4 GB, so a 3.5 GB heap reservation leaves 0.5 GB for everything else regardless of what is committed; and a host whose total virtual memory is limited, where one JVM's large reservation can prevent a second JVM from starting.

**Thread stacks are the exception, and the behaviour changed.** Measured with the same program (63 threads, `-Xms256m -Xmx1g`) on both JVMs:

| | 8u504 | 25.0.4.1 |
| --- | ----- | -------- |
| Thread reserved | 61,699 KB | 64,713 KB |
| Thread **committed** | **61,699 KB** | **3,665 KB** |

**Java 8 commits the full stack reservation up front; Java 25 commits only the pages actually touched.** Forty extra threads cost ~60 MB of real memory on 8 and under 4 MB on 25. For a thread-heavy application in a memory-limited container this is one of the strongest concrete arguments for upgrading, and it explains why the same code needs a bigger container on 8.

On Unix, **RSS** approximates committed memory; on Windows, the **working set**. Both slightly overcount (shared library pages are counted per process) and slightly undercount (committed pages already paged out). **RSS below committed memory is a warning sign** - the OS is struggling to keep the JVM resident, and you are heading for swapping.

---

## Native Memory Tracking

The JVM's own accounting of its native allocations. **It must be enabled at startup**; there is no way to turn it on later.

```bash
-XX:NativeMemoryTracking=summary     # the useful mode; ~5-10% footprint overhead
-XX:NativeMemoryTracking=detail      # adds call sites; for JVM engineers
```

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory baseline           # mark now
jcmd <pid> VM.native_memory summary.diff       # ...and later, what changed
```

Real output from 25.0.4.1, `-Xms256m -Xmx1g`, 63 threads, a 32 MB direct buffer, 200 live 256 KB arrays:

```
Total: reserved=2598038KB, committed=380866KB
       malloc: 52938KB #8486, peak=52789KB #8488
       mmap:   reserved=2545100KB, committed=327928KB

-           Java Heap (reserved=1048576KB, committed=264192KB)
-               Class (reserved=1048657KB, committed=209KB)   (classes #760)
-              Thread (reserved=64713KB, committed=3665KB)    (threads #63)
-                Code (reserved=247927KB, committed=7603KB)
-                  GC (reserved=70497KB, committed=55177KB)
-            Compiler (reserved=200KB, committed=200KB)
-            Internal (reserved=1341KB, committed=1341KB)
-               Other (reserved=32768KB, committed=32768KB)   ← the direct buffer
-              Symbol (reserved=1130KB, committed=1130KB)
-  Shared class space (reserved=16384KB, committed=14016KB)   ← CDS
-           Metaspace (reserved=65548KB, committed=268KB)
```

Note the shape: **2.5 GB reserved against 381 MB committed**, and the heap is 264 MB of that 381 MB - about 69%. GC structures are the next largest at 55 MB, which is G1's remembered sets and card tables.

**The `Other` category is where direct byte buffers appear on Java 25 - not `Internal`.** Verified by allocating exactly 32 MB and finding `Other (reserved=32768KB, committed=32768KB)`. On 8u504 the same allocation appeared in `Internal` (42,411 KB, against 1,341 KB on 25). Oaks' book states direct buffers show up under `Internal`, which was correct for 8 and 11 and is **wrong for current releases**. Look in `Other` first, then `Internal`.

### What NMT cannot see

**NMT tracks HotSpot's own allocations only.** It sits below the JDK, so it misses everything allocated by a shared library loaded via `System.loadLibrary` - third-party native code *and* the JDK's own native libraries.

That is why **native memory leaks are usually invisible to NMT**. The pools NMT reports mostly have upper bounds; a process whose RSS grows without limit while NMT's committed total stays flat is leaking in a native library. The arithmetic is the diagnosis: RSS 10 GB, NMT committed 6 GB → 4 GB is coming from somewhere NMT cannot see.

For that, you need OS-level tools: a mixed-language profiler that traces `malloc` and `mmap`, or a debugging allocator. Note that libraries frequently allocate via `mmap` rather than `malloc`, so `malloc`-only interposers miss them.

---

## Thread stacks

```bash
-Xss512k        # per-thread native stack; default 1 MB (320 KB on 32-bit Windows)
```

**On a 64-bit JVM there is usually no reason to change this**, given lazy commit from Java 9 onward. Reduce it when memory is genuinely constrained and the thread count is high. Many applications run fine at 256 KB; few need the full 1 MB. The downside is a `StackOverflowError` on a deeply recursive call path, so measure the deepest stack you actually have before cutting it.

`OutOfMemoryError: unable to create new native thread` has **three causes and only two are memory**:

1. A 32-bit JVM at its ~4 GB process ceiling.
2. Genuinely exhausted virtual memory.
3. **An OS limit on processes or threads** - on Linux, `ulimit -u`, where each Java thread counts as a process. Attempting the 1,025th thread against a 1,024 limit throws this error with nothing whatsoever to do with memory.

`-Xss` helps with the first two and does nothing for the third, which is the most common. Check `ulimit -u` before touching `-Xss`.

---

## Direct byte buffers

`ByteBuffer.allocateDirect()` and `FileChannel.map()` allocate outside the heap. The point is zero-copy: writing to a direct buffer and handing it to a socket or file needs no copy between the JVM and the C library, whereas a heap buffer must be copied.

**`allocateDirect()` is expensive regardless of size**, so reuse matters more than sizing:

- **Thread-local buffers** - no synchronisation, no pool bookkeeping. The risk is that every thread eventually holds a buffer at its high-water mark.
- **An object pool** - better when threads are many and sizes vary.
- **Slicing one large buffer** with `slice()` - works well only when all slices are the same size, because a direct buffer cannot be compacted and fragments exactly like a heap.

```bash
-XX:MaxDirectMemorySize=N     # 0 = default
```

Verified `MaxDirectMemorySize=0` on all five versions, where 0 means "use the default". In current 8 and all later releases the effective default equals the **maximum heap size** - so a 4 GB heap silently permits another 4 GB of direct buffers, and the total footprint can be twice what `-Xmx` suggests. Set it explicitly when you care about the footprint ceiling.

Track actual usage through the `java.nio.BufferPool.direct` and `.mapped` MBeans, which report count and total capacity.

`OutOfMemoryError: Direct buffer memory` (on 17+, `Cannot reserve N bytes of direct buffer memory`) means the cap was hit. Three causes, in the order worth checking:

1. **`-XX:+DisableExplicitGC` is set.** Check this *first*: it is the cheapest to rule out and it produces exactly this error with no leak present. A direct buffer's native block is freed by a `Cleaner` that only runs after a collection, and `java.nio.Bits.reserveMemory()` calls `System.gc()` to force that collection when a reservation will not fit. Disabling explicit GC removes the only reclamation trigger. **Measured: the same workload succeeds by default on all five versions and fails after filling the cap exactly once with the flag set.** See [garbage-collection.md](garbage-collection.md).
2. **A genuine leak** - buffers still strongly reachable. Confirm with a heap dump; direct `ByteBuffer` objects are small on-heap, so look at their count and their referrers, not their retained size.
3. **The cap is simply too low** for the concurrency level. Each in-flight NIO operation may hold a buffer.

---

## Native memory in the JDK's own libraries

Two JDK classes routinely cause native growth that looks like a leak.

**`Inflater` and `Deflater`** (zip, gzip, and every stream built on them) allocate native memory in a platform library. You are expected to call `end()`, or to close the stream, which calls it for you. Forget, and the memory is released only when the object is collected and its `Cleaner` runs. The objects are small, so in a large heap with infrequent full GCs they can survive for hours - **indistinguishable from a leak while it is happening**. If the `Inflater` itself leaks in Java code, it is a real, permanent native leak.

The diagnosis is neat: take a heap dump and count `Inflater` and `Deflater` instances. They are too small to matter in the heap, so a large number of them is a signal about *native* memory rather than heap memory.

**Byte buffers** as above.

### glibc arenas: a Linux-specific false leak

`malloc` in glibc partitions native memory into per-thread arenas to reduce lock contention. Native memory is never compacted, so those arenas fragment - and the arena count defaults to **8 × CPU count**, which on a large machine is a lot of independently fragmenting pools.

The signature is an `OutOfMemoryError` reporting native memory exhaustion together with many small (typically 64 KB) mappings in `/proc/<pid>/smaps`. The remedy:

```bash
export MALLOC_ARENA_MAX=2      # or 4
```

It is common in containers and on many-core hosts, and it is worth knowing because nothing in the JVM's own instrumentation points to it.

---

## Large pages

The OS maps memory in pages, with the hottest mappings cached in **translation lookaside buffers**. TLB entries are a limited hardware resource, so a larger page size means fewer entries cover the same memory and a higher hit rate. For a JVM with a multi-gigabyte heap this is a measurable win.

```bash
-XX:+UseLargePages              # verified false by default on all five versions
-XX:+UseTransparentHugePages    # Linux only; absent from Windows builds
```

Two Linux mechanisms with very different behaviour:

**Traditional huge pages** are reserved at boot, **locked in memory and never swapped** - which is exactly what you want for a heap. Set-up: read `Hugepagesize` from `/proc/meminfo` (usually 2 MB), compute pages needed for the heap plus ~10%, write it to `/proc/sys/vm/nr_hugepages`, persist it in `/etc/sysctl.conf`, and raise `memlock` in `/etc/security/limits.conf` for the user.

**Transparent huge pages** are allocated on demand, and both differences hurt Java. They **can be swapped**, defeating the main benefit. And allocation may force the kernel to defragment physical memory *while the JVM waits* - if that happens during a heap expansion inside a GC, it adds hundreds of milliseconds to a pause. `/sys/kernel/mm/transparent_hugepage/enabled` takes `always`, `madvise` or `never`, and distributions differ (`madvise` on Ubuntu, `always` on RHEL-family, and cloud images often override).

**For predictable pause times, prefer traditional huge pages and set THP to `madvise`.** THP usually helps on average and is the more likely source of an unexplained pause spike.

Verification differs in a way worth knowing: with traditional huge pages misconfigured the JVM prints a warning and falls back; with `UseTransparentHugePages` unavailable it says **nothing**. And on a Windows edition without large-page support, `-XX:+UseLargePages` is silently ignored - verified absent as a concept from these Windows builds, where `UseTransparentHugePages` does not exist at all.

---

## Compressed oops and the 32 GB cliff

A 64-bit reference is 8 bytes against 4 on 32-bit, so a naive 64-bit JVM stores twice the pointer data and gets less useful heap per gigabyte. **Compressed ordinary object pointers** store a 32-bit value and exploit 8-byte object alignment: the low three bits are always zero, so the JVM shifts left by 3 on load and right by 3 on store. That addresses 2³⁵ bytes - **32 GB** - with 4-byte references.

Verified `UseCompressedOops=true` on all five versions, and it is enabled automatically whenever the maximum heap is under 32 GB.

**The consequence is a genuine cliff.** Cross 32 GB and every reference doubles, so a **31 GB heap frequently outperforms a 33 GB heap** - the larger heap holds less useful data and collects more often. If you must exceed 32 GB, go substantially beyond it; plan on 38 GB or more before the extra capacity offsets the pointer cost, since roughly 20% of a typical heap is references.

Why not 36 bits for 64 GB? That would require 16-byte object alignment, and the padding wasted between objects would exceed the pointer saving.

---

## Reducing the footprint

In priority order:

1. **The heap** - the largest single consumer. See [gc-tuning.md](gc-tuning.md).
2. **Thread count**, not stack size, on 9+ where stacks commit lazily. Fewer threads is the real lever.
3. **The code cache**, if you have reserved far more than `Compiler.codecache` shows in use.
4. **Metaspace**, by bounding it - mainly as a guard against class loader leaks.
5. **The collector.** GC structures were 55 MB of a 381 MB footprint in the measurement above; Serial's are far smaller, ZGC's and Shenandoah's larger.
6. **Direct buffers**, by capping `MaxDirectMemorySize` explicitly rather than inheriting `-Xmx`.

---

## Version notes

Verified with `-XX:+PrintFlagsFinal` and by running the same program under NMT on each JVM.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| Thread stacks committed eagerly | **✓ (full reservation)** | ✗ | ✗ | ✗ | **✗ (lazy)** |
| Direct buffers reported under | `Internal` | `Internal` | `Other`¹ | `Other`¹ | **`Other`** |
| NMT `summary.diff` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `AutoShutdownNMT` flag | ✓ | ✓ | absent | absent | **absent** |
| `jcmd VM.metaspace` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `Shared class space` in NMT | ✗ | ✗ | ✓ | ✓ | ✓ |
| `MaxDirectMemorySize` default | 0 (= `-Xmx`) | 0 | 0 | 0 | 0 |
| `UseCompressedOops` default | true | true | true | true | true |
| `UseLargePages` default | false | false | false | false | false |
| `UseTransparentHugePages` | Linux only | Linux only | Linux only | Linux only | Linux only |
| `UseCompactObjectHeaders` | ✗ | ✗ | ✗ | ✗ | **✓** |

¹ Verified directly on 8u504 (`Internal`) and 25.0.4.1 (`Other`). The 17 and 21 entries are inferred from the category's introduction and were **not** individually verified here.

- **`AutoShutdownNMT` is gone from 17+.** On 8 and 11, NMT would disable itself under memory or CPU pressure - precisely when you needed it - and `-XX:-AutoShutdownNMT` kept it alive. On 17+ the flag is absent and does not need disabling.
- **Java 8's eager stack commit is the single biggest footprint difference** between 8 and later releases for thread-heavy applications: 61.7 MB against 3.7 MB committed for the same 63 threads.
- **`UseCompactObjectHeaders` is a Java 25 product flag** that reduces headers from 12 bytes to 8. It shrinks the heap rather than native memory, but it interacts here: it is recorded into an AOT cache, so enabling it invalidates one built without it. See [allocation.md](allocation.md).

## Gotchas

- Agent sizes a container from `-Xmx` - the heap was ~69% of committed footprint in the measurement here; the rest still needs room
- Agent reads a large virtual size in `top` as a problem - reservations are free on 64-bit; look at RSS or working set
- Agent looks for direct byte buffers in NMT's `Internal` on a modern JVM - they are in `Other` from 17; `Internal` was correct for 8 and 11
- Agent expects NMT to find a native leak - NMT sees only HotSpot's own allocations, not shared libraries
- Agent forgets NMT must be enabled at **startup** - there is no way to turn it on later
- Agent leaves NMT `detail` on in production - `summary` is the operational mode
- Agent lowers `-Xss` to cut memory on Java 9+ - stacks commit lazily there; reduce thread count instead
- Agent treats `unable to create new native thread` as a memory problem - most often `ulimit -u`, where `-Xss` cannot help
- Agent ignores that `MaxDirectMemorySize` defaults to the maximum heap - a 4 GB heap silently permits 4 GB more off-heap
- Agent chases an `Inflater`/`Deflater` count in a heap dump as a heap problem - they are small; the count is a signal about native memory
- Agent misses `MALLOC_ARENA_MAX` on a many-core Linux host - arena fragmentation looks exactly like a leak
- Agent recommends transparent huge pages for a latency-sensitive service - they can be swapped and their allocation can stall a GC pause
- Agent sets a heap just over 32 GB - compressed oops switch off and a 31 GB heap usually performs better
- Agent expects a warning when `UseTransparentHugePages` is unavailable - traditional huge pages warn, THP is silent
- Agent assumes `RSS < committed` is efficient - it means the OS cannot keep the JVM resident, and swapping is next

## Related

- [containers.md](containers.md) · [gc-tuning.md](gc-tuning.md) · [heap-analysis.md](heap-analysis.md) · [allocation.md](allocation.md) · [object-lifecycle.md](object-lifecycle.md) · [triage.md](triage.md) · [tooling.md](tooling.md) · [flags.md](flags.md) · [java-versions.md](java-versions.md)
