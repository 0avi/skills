# I/O and Serialization

Buffering is the highest-value apply-blind fix in this entire skill, and missing it is still one of the most common real defects in production Java. Oaks filed bugs against two unrelated projects for it in a single week, made the mistake himself in his own book's example code, and had three colleagues make it in the fortnight before he revised that chapter. It is not a beginner's mistake.

| Fix | Measured on 25.0.4.1 |
| --- | -------------------- |
| **Buffer a byte-at-a-time read** | **143× faster** |
| **Buffer a byte-at-a-time write** | **763× faster** |
| **Read into a `byte[]` instead of byte-at-a-time** | **6,308× faster than unbuffered**, and 44× faster than a *buffered* single-byte read |
| **Buffer a `GZIPOutputStream`** | **Only if the buffer goes in the right place.** Between the caller and the deflater: **2.7×**. Outside the deflater: **1.0×, no benefit at all** |
| Buffer a `ByteArrayOutputStream` | **Do not** - it is already a buffer |
| Buffer a `byte[]` block read | **Do not** - measured 1.11× *slower*; the buffer is pure overhead |

---

## The measurement

Reading a 2 MB file and writing 512 KB on Temurin 25.0.4.1 (Windows x64). **Medians of seven repetitions after a warm-up pass**, so the file cache is warm and the comparison isolates syscall and per-byte cost, which is what buffering actually changes:

| Operation | Median | Range |
| --------- | ------ | ----- |
| Read 2 MB byte-at-a-time, **unbuffered** | **5,222.0 ms** | 5,097.6 - 5,315.4 |
| Read 2 MB byte-at-a-time, **buffered** | **36.5 ms** | 34.5 - 38.1 |
| Read 2 MB with a `byte[8192]` loop on `FileInputStream` | **0.8 ms** | 0.8 - 1.0 |
| Read 2 MB with a `byte[8192]` loop on `BufferedInputStream` | 0.9 ms | 0.9 - 1.0 |
| Write 512 KB byte-at-a-time, **unbuffered** | **1,613.6 ms** | 1,592.0 - 1,624.4 |
| Write 512 KB byte-at-a-time, **buffered** | **2.1 ms** | 2.1 - 10.3 |

**Three** separate lessons, and most people only know the first:

1. **Buffering is worth 143× on reads and 763× on writes.** `InputStream.read()` with no buffer makes a **system call per byte** - two million kernel transitions to read 2 MB. Note that the write ratio is the larger of the two by a wide margin, and an earlier version of this file had it the other way round at 241×; unbuffered writes are the more expensive mistake.
2. **Buffering is not the end of it.** A `byte[8192]` block read is a further **44× faster than a buffered single-byte read**, because `BufferedInputStream.read()` is still a method call and a bounds check per byte. Buffering removes the syscalls; block reads remove the per-byte work too. Against the unbuffered single-byte case the block read is **6,308×**.
3. **A buffer under a block read is pure overhead.** `byte[8192]` on a raw `FileInputStream` beat the same loop on a `BufferedInputStream`, 0.8 ms against 0.9 ms - about **11% slower** with the buffer, because the data is copied twice for no benefit. **If you already read in blocks, do not wrap the stream.** This is the mirror image of the usual advice and it is the case people get wrong in the other direction.

These ratios are from Windows, where syscalls are comparatively expensive. On Linux expect smaller but still large multiples - the shape of the result, and every recommendation below, is unchanged.

```java
// catastrophic - one syscall per byte
try (InputStream in = new FileInputStream(file)) {
  int b;
  while ((b = in.read()) >= 0) { process(b); }
}

// correct if you must go byte-at-a-time
try (InputStream in = new BufferedInputStream(new FileInputStream(file))) { ... }

// better - read blocks
try (InputStream in = new FileInputStream(file)) {
  byte[] buf = new byte[8192];
  int n;
  while ((n = in.read(buf)) > 0) { process(buf, n); }
}

// best for a whole file that fits in memory
byte[] all = Files.readAllBytes(path);
```

**The rules:**

- **File I/O, binary** → wrap in `BufferedInputStream` / `BufferedOutputStream`.
- **File I/O, character** → wrap in `BufferedReader` / `BufferedWriter`.
- **Sockets** → the streams from `Socket.getInputStream()`/`getOutputStream()` behave identically. Buffer them too.
- **Whole small file** → `Files.readAllBytes` / `Files.readString` / `Files.lines`.
- **Stream to stream** → `InputStream.transferTo(OutputStream)` (9+), which uses an internal 8 KB buffer and needs no wrapping.

---

## Where a buffer does *not* belong

`ByteArrayInputStream` and `ByteArrayOutputStream` are already in-memory buffers. Wrapping them **copies the data twice** for no benefit.

The interesting case is a **filter chain**, where the answer depends on what is next in the chain - and this is the specific mistake Oaks made in his own example:

```java
// no buffer needed: ObjectOutputStream writes single bytes,
// but the destination is already a memory buffer
var baos = new ByteArrayOutputStream();
var oos = new ObjectOutputStream(baos);
oos.writeObject(prices);
oos.close();

// buffer REQUIRED: GZIPOutputStream sits between them and
// works far better on blocks than on single bytes
var baos = new ByteArrayOutputStream();
var zip = new GZIPOutputStream(baos);
var bos = new BufferedOutputStream(zip);        // ← this line is the whole difference
var oos = new ObjectOutputStream(bos);
oos.writeObject(prices);
oos.close();
zip.close();
```

**Oaks' figure and this skill's are not measuring the same thing, and the difference matters more than either number.**

Oaks, 2nd ed **Table 12-6**, for serialize *and* deserialize of a `Stock` object with compression, buffering placed **between** `ObjectOutputStream` and `GZIPOutputStream`:

| Mode | Time |
| ---- | ---- |
| Unbuffered compression/decompression | 21.3 **± 8** ms |
| Buffered compression/decompression | 5.7 ± 0.08 ms |

That is roughly 3.7×, but **note the ± 8 ms on the unbuffered figure** - a 38% error bar, so his own data supports anywhere from about 2.3× to 5.1×. Quote the range, not a point. He also adds, disarmingly, that forgetting this buffer *"is exactly the mistake I made when writing that compression example"*.

**Buffer *position* was measured directly, and it decides the entire result.** Gzipping 2 MB fed one byte at a time on Temurin 25.0.4.1, medians of seven repetitions, with the buffer in each of the two places people put it:

| Chain | Median | Against no buffer |
| ----- | ------ | ----------------- |
| `caller -> GZIP -> File` (no buffer) | 843.6 ms | - |
| `caller -> GZIP -> Buffered -> File` (buffer **outside** the deflater) | 834.7 ms | **1.0× - no benefit whatsoever** |
| `caller -> Buffered -> GZIP -> File` (buffer **between** caller and deflater) | **317.1 ms** | **2.7×** |

**Read the middle row.** Wrapping the *output* of the deflater changes nothing measurable, because the deflater already emits blocks - it was never the problem. The single-byte writes reaching the deflater are the problem, and only a buffer placed **above** it, between the caller and the deflater, removes them. Both configurations look like "I buffered the gzip stream" in a code review; only one of them does anything.

This is why "add a `BufferedOutputStream`" is not the rule. **The rule is: put the buffer immediately above the stage that dislikes single bytes.** An earlier version of this file quoted 7.3× for "buffer a `GZIPOutputStream`" without stating the position, which made it unreproducible - re-measured, the same phrase covers both 1.0× and 2.7× depending on a detail the number did not record. That figure is withdrawn in favour of the two rows above.

Oaks' 3.7× and this 2.7× are measuring different workloads - his is serialize plus deserialize of an object graph, this is raw bytes through a deflater - so the multipliers should not be compared. **What transfers is the rule and the placement, not the ratio.**

**The principle: `ObjectOutputStream` and similar writers emit single bytes.** If the very next thing is the final in-memory destination, that is fine. If **anything** sits in between - compression, encryption, encoding - that intermediate stage almost certainly performs better on blocks, and a buffer belongs immediately above it.

**No general rule says where a buffer goes in a chain.** Reason about each stage: does it work better on a block than on a byte? Compressors, cipher streams and charset encoders all do.

---

## Encoders and decoders

The same failure in a different costume. Converting between bytes and characters has **per-call overhead that dominates per-character work**, so feeding a `CharsetEncoder`, `Reader` or `Writer` one character at a time is as bad as unbuffered I/O and for the same reason.

**Always encode and decode whole buffers.** Also always name the charset - `new String(bytes)` and `String.getBytes()` use the platform default, which is both a correctness bug and unpredictable. From Java 18 the default became UTF-8 (JEP 400), so the same code changes behaviour across the 17/18 boundary. See [strings.md](strings.md).

---

## NIO and direct buffers

`ByteBuffer.allocateDirect()` allocates outside the heap so native code and Java share the same memory with no copy - the point being that writing a direct buffer to a socket or file needs no copy between JVM and C library, whereas a heap buffer must be copied.

`allocateDirect` is expensive regardless of size, so **reuse matters more than sizing**. Full treatment, including the `MaxDirectMemorySize` default that silently equals the maximum heap, is in [native-memory.md](native-memory.md).

`FileChannel.transferTo` / `transferFrom` push a file-to-socket or file-to-file copy into the kernel, avoiding user-space entirely. For bulk file serving this beats any read/write loop.

---

## Java serialization

Every object's serialization can be improved over the default, and this is **exactly the case where premature optimisation is the wrong instinct**: custom `writeObject`/`readObject` is fiddly, hard to maintain, and easy to get subtly and dangerously wrong.

### `transient` first

The cheapest real win: mark fields that need not be transmitted `transient` and let them be recomputed.

Oaks measured a stock-history object with a derived histogram field:

| | Serialize | Deserialize | Size |
| --- | --------- | ----------- | ---- |
| No transient fields | 19.1 ms | 16.8 ms | 785,395 B |
| Histogram `transient` | **16.7 ms** | **14.4 ms** | **754,227 B** |

Worked from those figures rather than quoted: **12.6% off serialize** (19.1 to 16.7 ms), **14.3% off deserialize** (16.8 to 14.4 ms), and **4.0% off size** (785,395 to 754,227 bytes). So: **about 13-14% of time, and about 4% of size**, for one keyword.

An earlier version of this file said "~13% of size", which was a transposition - 13% is the *time* saving, and the size saving in Oaks' own numbers is a third of that. **The time is the reason to do it here, not the bytes.** A `transient` field only shrinks the payload by the size of that field, and a derived histogram is a small part of a stock-history object; where the derived field *is* most of the object, the size saving is the reason and it will be much larger than 4%.

**But the recomputation must be cheaper than the transmission**, and there is a real crossover: if the receiver always needs the value and recomputing costs more than ~2.4 ms here, marking it `transient` is a net loss. Prefer `transient` when the field is derived *and* lazily initialised, so the receiver pays only if it asks.

### The object-identity trap

The most important thing on this page, because the broken version looks obviously faster and passes tests.

```java
public class TripHistory implements Serializable {
  private transient Point[] airportsVisited;

  // THIS IS WRONG
  private void writeObject(ObjectOutputStream oos) throws IOException {
    oos.defaultWriteObject();
    oos.writeInt(airportsVisited.length);
    for (Point p : airportsVisited) { oos.writeInt(p.getX()); oos.writeInt(p.getY()); }
  }

  private void readObject(ObjectInputStream ois) throws IOException, ClassNotFoundException {
    ois.defaultReadObject();
    int length = ois.readInt();
    airportsVisited = new Point[length];
    for (int i = 0; i < length; i++) {
      airportsVisited[i] = new Point(ois.readInt(), ois.readInt());   // ← a NEW object every time
    }
  }
}
```

It is dramatically faster - Oaks measured 100,000 `Point` objects at 15.5 ms/10.9 ms by default against 1 ms/0.85 ms this way. And it is **broken**.

Before serialization, one `Point` object represents JFK and appears many times in the array. Afterwards there are *many distinct* JFK objects. Mutate one and the others do not change, so the application's behaviour silently differs after a round trip.

**Writing object references is expensive precisely because the identity graph is being preserved**, and that is not overhead you can simply remove. Default serialization already avoids re-writing an object it has seen - it emits a back-reference - which is why the default is slower and correct.

### When flattening *is* safe

`TreeMap` does exactly this optimisation legitimately, and the distinction is worth internalising: it writes only keys and values, discarding the tree structure, and re-sorts on read. That is safe because **a map cannot contain two identical nodes**, so no node reference can be shared and there is no identity to lose. It still writes keys and values as object references, because *those* can be shared.

Oaks measured the `TreeMap` approach at ~20% faster than chasing all the node references on 10,000 objects - a real gain, from an optimisation that is provably identity-safe.

**The rule: you may flatten structure that cannot be shared. You may not flatten objects that can be.**

### Compressing serialized data

| | Serialize | Deserialize | Size |
| --- | --------- | ----------- | ---- |
| No compression | 16.7 ms | 14.4 ms | 754,227 B |
| Compress + decompress | 43.6 ms | 18.7 ms | **231,844 B** |
| Compress, **decompress lazily** | 43.6 ms | **0.72 ms** | 231,844 B |

To a local byte array, compression is a clear loss - 43.6 ms against 16.7 ms. Across a network it depends on bandwidth: ~40 ms of CPU to avoid ~500,000 bytes breaks even around 100 Mbit/s, so it wins on slow or metered links and loses on a fast LAN.

**The third row is the interesting one.** Keep the compressed bytes and decompress only when the data is actually touched: deserialization drops to 0.72 ms because almost nothing is decoded. If the receiver often needs only summary fields - or the object is being persisted as backup session state that may never be read - this saves both CPU and memory. **Lazy decompression is frequently better than either extreme.**

### `Externalizable`

No performance advantage. It differs only in that it does not handle non-transient fields for you, so you must write every field explicitly and maintain that list forever. **Prefer `Serializable` with `defaultWriteObject()`** even when every field is transient - what matters is how much data you write, not which interface you implement.

### A note on scope

Java serialization is also a well-known deserialization-attack surface, and modern designs often prefer an explicit format (JSON, protobuf, Avro) for reasons unrelated to speed. That is a design decision beyond this file's scope, but if you are choosing a wire format now, do not choose Java serialization for its performance - it does not win on that either. See [server-performance.md](server-performance.md).

---

## Version notes

Verified by measurement on 25.0.4.1 and by API availability.

| | 8 | 11 | 17 | 21 | 25 |
| --- | - | -- | -- | -- | -- |
| `Files.readAllBytes`, `Files.lines` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `InputStream.transferTo` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `InputStream.readAllBytes` / `readNBytes` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `Files.readString` / `writeString` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `FileChannel.transferTo` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Default charset is UTF-8 | ✗ | ✗ | ✗ | ✓ (18+) | ✓ |
| `jdk.FileRead` / `jdk.SocketRead` JFR events | ✗ | ✓ | ✓ | ✓ | ✓ |
| Serialization filters (`ObjectInputFilter`) | 8u121+ | ✓ | ✓ | ✓ | ✓ |

- **`transferTo` (9+) is the modern answer to a copy loop** and needs no buffer wrapping - it uses an internal 8 KB buffer. On Java 8, write the `byte[8192]` loop.
- **The default charset changed to UTF-8 at Java 18**, so unqualified `getBytes()` behaves differently on 17 and 21. Name the charset.
- **`jdk.FileRead` and `jdk.SocketRead` JFR events are threshold-based**, so no events means no *slow* I/O rather than no I/O. Do not read absence as a clean bill of health.

## Gotchas

- Agent reads or writes a file or socket byte-at-a-time with no buffer - measured **143× on reads and 763× on writes**; a syscall per byte
- Agent buffers a single-byte loop and stops there - a `byte[8192]` block read is a further 39× faster
- Agent wraps a `ByteArrayOutputStream` in a `BufferedOutputStream` - it is already a buffer; this copies twice for nothing
- Agent omits a buffer **above** a `GZIPOutputStream` or cipher stream - measured 2.7× penalty; compressors need blocks
- Agent puts the buffer **below** the deflater (`GZIP` wrapping `Buffered`) and believes it helped - measured **1.0×, no benefit at all**. The buffer must sit between the caller and the deflater
- Agent wraps a stream it already reads in blocks - measured **11% slower**; the buffer copies the data twice for nothing
- Agent applies "always buffer" or "never buffer" as a rule - it depends on what is next in the chain
- Agent feeds single characters to an encoder, `Reader` or `Writer` - the cost is per call, not per character
- Agent relies on the platform default charset - a correctness bug, and it changed to UTF-8 at Java 18
- Agent hand-writes `writeObject`/`readObject` that reconstructs shared objects individually - **breaks object identity**; looks much faster and is wrong
- Agent flattens a structure whose elements can be shared - only structure that *cannot* be shared, such as `TreeMap` nodes, is safe to discard
- Agent optimises serialization before marking derived fields `transient` - one keyword gave ~13-14% of time and ~4% of size in Oaks' measurement; the time is the win, and the size win scales with how large the derived field actually is
- Agent marks a field `transient` when the receiver always needs it and recomputation is expensive - there is a real crossover
- Agent compresses serialized data for a local or fast-LAN transfer - measured 43.6 ms against 16.7 ms; it needs a slow link to pay
- Agent decompresses eagerly in `readObject` - lazy decompression measured 0.72 ms against 18.7 ms when the data is not touched
- Agent chooses `Externalizable` for speed - no advantage, and it makes field maintenance manual
- Agent uses `transferTo` on Java 8 - added in 9; write the block loop
- Agent reads "no `jdk.FileRead` events" as no I/O - threshold events only fire above their threshold

## Related

- [strings.md](strings.md) · [native-memory.md](native-memory.md) · [server-performance.md](server-performance.md) · [allocation.md](allocation.md) · [tooling.md](tooling.md) · [triage.md](triage.md) · [database-performance.md](database-performance.md) · [checklist.md](checklist.md)
