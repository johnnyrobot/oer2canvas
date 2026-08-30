import { crc32 } from '../engine/export/zip'

/**
 * A ZIP reader, the deliberate counterpart to `engine/export/zip.ts`'s writer.
 *
 * That module states it "only ever WRITES", and that this is what makes owning it
 * cheaper than a dependency. This one changes that bargain, so it is scoped to
 * exactly what the presentation index needs: enumerate the central directory, and
 * inflate the NAMED parts a caller asks for. A deck with a thousand media files
 * inflates none of them.
 *
 * IT TRUSTS NOTHING IT READS. Every ceiling is checked before or during inflation,
 * never after: a reader that inflates first and asks questions later has no ceiling.
 * Every part's CRC is verified against its central-directory record, which is what
 * catches an entry whose header lies about what it holds.
 */

export class ZipReadError extends Error {
  readonly code: 'malformed' | 'resource-limit'

  constructor(code: ZipReadError['code'], message: string) {
    super(message)
    this.name = 'ZipReadError'
    this.code = code
  }
}

/**
 * REASONED bounds, not measured ones — they have no benchmark fixture and no
 * `DOCUMENT_IMPORT_LIMIT_EVIDENCE` entry, exactly like `maximumAssetPixels` in
 * `parser-limit-values.ts`. They exist to bound a hostile archive, not to describe
 * a legitimate deck.
 *
 * `maximumPackageEntries`: a 200-slide deck carries a slide, a layout reference, and
 * often a notes part each, plus masters, themes, and media — low hundreds of parts.
 * 4,096 is an order of magnitude above anything legitimate and still refuses an
 * archive built to make the central-directory walk itself the attack.
 *
 * `maximumIndexedPartBytes`: this bounds the TOTAL of the XML we inflate, not the
 * package. Slide XML is kilobytes; 8 MiB across every indexed part is far above any
 * real deck while staying half of `maximumInputBytes`, so indexing can never inflate
 * to more than the file we already accepted.
 */
export const PRESENTATION_PACKAGE_LIMITS = Object.freeze({
  maximumPackageEntries: 4_096,
  maximumIndexedPartBytes: 8 * 1024 * 1024,
})

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** The format's own maximum trailing-comment length, plus the 22-byte record. */
const MAX_EOCD_SCAN = 0xffff + 22

function malformed(message: string): ZipReadError {
  return new ZipReadError('malformed', `This package is not a readable archive: ${message}`)
}

function resourceLimit(message: string): ZipReadError {
  return new ZipReadError('resource-limit', message)
}

/**
 * A part path must stay inside the package. `..` segments, absolute paths, and
 * backslash separators are all refused rather than normalized: a package that
 * needs normalizing to be safe is a package we have no reason to trust.
 */
function safePartPath(name: string): string {
  if (name.startsWith('/') || name.includes('\\') || /(^|\/)\.\.(\/|$)/.test(name)) {
    throw malformed(`a part path escapes the package (${name})`)
  }
  return name
}

function findEndOfCentralDirectory(view: DataView): number {
  const from = Math.max(0, view.byteLength - MAX_EOCD_SCAN)
  for (let at = view.byteLength - 22; at >= from; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at
  }
  throw malformed('no end-of-central-directory record')
}

/**
 * Inflate, refusing the moment output passes `declared`.
 *
 * The cap is enforced INSIDE the read loop rather than on the finished buffer,
 * because "check the size after decompressing it" is the bomb working exactly as
 * intended. A stream that stops early is the whole defence.
 */
async function inflateRaw(payload: Uint8Array, declared: number): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  // Errors are swallowed here, not ignored: if the read loop below cancels the
  // reader early (the oversized-declared-size case), the writable side's
  // pending write rejects with an AbortError that nothing awaits it. Left
  // uncaught, that becomes an unhandled rejection outside this function's own
  // control flow; the actual failure is still surfaced, because the read loop
  // throws its own `malformed` before this promise is ever inspected.
  void writer.write(payload as unknown as BufferSource).catch(() => {})
  void writer.close().catch(() => {})

  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    // A corrupted deflate stream — the shape a truncated or partially
    // downloaded upload actually takes — throws a raw `TypeError` straight
    // from the platform's zlib binding (Node's carries `code: 'Z_DATA_ERROR'`
    // and an empty message) rather than any error this module defines. Only
    // the read itself is wrapped: the size-cap refusal just below throws its
    // own `ZipReadError` outside this try, and must reach the caller
    // unchanged rather than being redescribed as a decompression failure.
    let step: ReadableStreamReadResult<Uint8Array>
    try {
      step = await reader.read()
    } catch (cause) {
      const reason =
        cause && typeof cause === 'object' && 'code' in cause && typeof (cause as { code: unknown }).code === 'string'
          ? (cause as { code: string }).code
          : cause instanceof Error && cause.message
            ? cause.message
            : String(cause)
      throw malformed(`a compressed part is corrupt and could not be inflated (${reason})`)
    }
    if (step.done) break
    total += step.value.length
    if (total > declared) {
      await reader.cancel()
      throw malformed('an entry inflated past the size its header declared')
    }
    chunks.push(step.value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

export async function readZipParts(
  bytes: Uint8Array,
  wanted: (path: string) => boolean,
): Promise<Map<string, string>> {
  if (bytes.byteLength < 22) throw malformed('too short to hold an archive')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndOfCentralDirectory(view)
  const entryCount = view.getUint16(eocd + 10, true)
  if (entryCount > PRESENTATION_PACKAGE_LIMITS.maximumPackageEntries) {
    throw resourceLimit(
      `This package has ${entryCount} entries; the browser limit is ` +
      `${PRESENTATION_PACKAGE_LIMITS.maximumPackageEntries}.`,
    )
  }

  const decoder = new TextDecoder('utf-8', { fatal: false })
  const parts = new Map<string, string>()
  let indexedBytes = 0
  let at = view.getUint32(eocd + 16, true)

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw malformed('a central-directory entry is truncated')
    }
    const method = view.getUint16(at + 10, true)
    const expectedCrc = view.getUint32(at + 16, true)
    const compressedSize = view.getUint32(at + 20, true)
    const uncompressedSize = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localOffset = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength

    // Path safety is checked for EVERY entry, not only wanted ones: a package
    // carrying a traversal path is malformed whether or not we meant to read it.
    safePartPath(name)
    if (!wanted(name)) continue

    // Declared size is checked BEFORE the payload is touched, so an entry that
    // announces a gigabyte costs nothing to refuse.
    indexedBytes += uncompressedSize
    if (indexedBytes > PRESENTATION_PACKAGE_LIMITS.maximumIndexedPartBytes) {
      throw resourceLimit(
        'The XML parts of this package exceed the 8 MiB the slide index may inflate.',
      )
    }

    if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw malformed(`the local header for "${name}" is missing`)
    }
    // The local header's own extra field may differ in length from the central
    // one, so the data offset is computed from the LOCAL record. Reading the
    // central length here is a classic off-by-a-few that yields garbage.
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataAt = localOffset + 30 + localNameLength + localExtraLength
    if (dataAt + compressedSize > bytes.byteLength) throw malformed(`"${name}" is truncated`)
    const payload = bytes.subarray(dataAt, dataAt + compressedSize)

    let inflated: Uint8Array
    if (method === 0) {
      if (payload.length !== uncompressedSize) throw malformed(`"${name}" has an inconsistent size`)
      inflated = payload
    } else if (method === 8) {
      inflated = await inflateRaw(payload, uncompressedSize)
      if (inflated.length !== uncompressedSize) {
        throw malformed(`"${name}" inflated to a size its header did not declare`)
      }
    } else {
      throw malformed(`"${name}" uses an unsupported compression method (${method})`)
    }

    // The CRC is the archive's own statement about its contents. Checking it is
    // what turns "the sizes look plausible" into "these are the declared bytes".
    if (crc32(inflated) !== expectedCrc) throw malformed(`"${name}" failed its checksum`)
    parts.set(name, new TextDecoder('utf-8').decode(inflated))
  }

  return parts
}
