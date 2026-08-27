/**
 * A ZIP writer, in about 150 lines and with no new runtime dependency.
 *
 * `.imscc` is a zip. The alternative was `fflate`, and the argument for owning
 * this is not "fewer dependencies" — three versus four is not worth anyone's
 * hour. It is that this writer only ever WRITES, only ever emits stored or
 * deflated entries, and never reads, so it is small enough that the dependency
 * would cost more to keep current than the code costs to own. It also comes with
 * an unusually clean test: the output is bytes in a published format, so the
 * check is a round trip through a real `unzip`, not an assertion about our own
 * idea of correctness.
 *
 * `CompressionStream('deflate-raw')` does the hard half. It is a browser global,
 * and it is also a Node global, which is why these tests run in the fast `unit`
 * project rather than needing a browser — verified, not assumed.
 *
 * ZIP64 IS NOT IMPLEMENTED, AND THE LIMITS ARE ENFORCED RATHER THAN HOPED FOR.
 * The 32-bit fields overflow at 4 GiB and the entry count at 65535; past either,
 * a zip written with these headers is silently corrupt. A refusal that names the
 * limit is a much better day than an archive Canvas rejects with its own error
 * message, so both throw.
 */

export interface ZipEntry {
  /** Path within the archive, `/`-separated. */
  name: string
  data: Uint8Array
}

const MAX_SIZE = 0xffffffff
const MAX_ENTRIES = 0xffff

/** CRC-32 (IEEE 802.3), table-driven and built once. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw')
  const writer = cs.writable.getWriter()
  // Cast because TS 7 models `Uint8Array` as `Uint8Array<ArrayBufferLike>`,
  // whose buffer may be a `SharedArrayBuffer`, while `BufferSource` demands a plain
  // `ArrayBuffer`. Nothing here ever produces a shared buffer — every array in this
  // module is allocated by `new Uint8Array` or `TextEncoder` — so the narrowing is
  // sound, and the alternative is threading a generic parameter through the file.
  void writer.write(bytes as unknown as BufferSource)
  void writer.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

/**
 * DOS date/time. Fixed by default, and that is deliberate: a timestamp read from
 * the clock makes every build of the same content a different archive, which
 * defeats byte-level goldens and makes "did this change?" unanswerable. The
 * cartridge carries its real timestamp in its FILENAME, where a human can see it.
 */
const DOS_EPOCH = { time: 0, date: 33 } // 1980-01-01 00:00, the format's own zero

class Writer {
  private parts: Uint8Array[] = []
  length = 0

  push(b: Uint8Array): void {
    this.parts.push(b)
    this.length += b.length
  }

  /** Little-endian, which is what every field in the format is. */
  u16(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]))
  }

  u32(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]))
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const p of this.parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
}

/**
 * Build the archive.
 *
 * `compress: false` emits stored (method 0) entries, which are valid zip and
 * need no compression at all — a useful bisection point if an import ever fails,
 * because it removes the deflate stream from the list of suspects.
 */
export async function writeZip(
  entries: readonly ZipEntry[],
  { compress = true }: { compress?: boolean } = {},
): Promise<Uint8Array> {
  if (entries.length > MAX_ENTRIES) {
    throw new RangeError(
      `zip: ${entries.length} entries exceeds the ${MAX_ENTRIES} this writer supports (zip64 is not implemented)`,
    )
  }

  const encoder = new TextEncoder()
  const body = new Writer()
  const central = new Writer()

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const raw = entry.data
    const deflated = compress ? await deflateRaw(raw) : undefined
    // Stored when deflate did not help. A "compressed" entry LARGER than its
    // input is a real outcome for tiny or already-compressed files, and paying
    // for it would be silly.
    const useDeflate = deflated !== undefined && deflated.length < raw.length
    const payload = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0

    if (raw.length > MAX_SIZE || payload.length > MAX_SIZE) {
      throw new RangeError(
        `zip: "${entry.name}" exceeds the 4 GiB this writer supports (zip64 is not implemented)`,
      )
    }

    const crc = crc32(raw)
    const offset = body.length

    body.u32(0x04034b50)          // local file header signature
    body.u16(20)                  // version needed
    body.u16(0)                   // flags
    body.u16(method)
    body.u16(DOS_EPOCH.time)
    body.u16(DOS_EPOCH.date)
    body.u32(crc)
    body.u32(payload.length)
    body.u32(raw.length)
    body.u16(nameBytes.length)
    body.u16(0)                   // extra field length
    body.push(nameBytes)
    body.push(payload)

    central.u32(0x02014b50)       // central directory header signature
    central.u16(20)               // version made by
    central.u16(20)               // version needed
    central.u16(0)                // flags
    central.u16(method)
    central.u16(DOS_EPOCH.time)
    central.u16(DOS_EPOCH.date)
    central.u32(crc)
    central.u32(payload.length)
    central.u32(raw.length)
    central.u16(nameBytes.length)
    central.u16(0)                // extra
    central.u16(0)                // comment
    central.u16(0)                // disk number start
    central.u16(0)                // internal attributes
    central.u32(0)                // external attributes
    central.u32(offset)           // offset of local header
    central.push(nameBytes)
  }

  const out = new Writer()
  const cdOffset = body.length
  out.push(body.concat())
  out.push(central.concat())
  out.u32(0x06054b50)             // end of central directory signature
  out.u16(0)                      // this disk
  out.u16(0)                      // disk with the central directory
  out.u16(entries.length)         // entries on this disk
  out.u16(entries.length)         // entries total
  out.u32(central.length)
  out.u32(cdOffset)
  out.u16(0)                      // comment length
  return out.concat()
}
