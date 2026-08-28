/**
 * Identity, verification and naming for raster assets packaged into a cartridge.
 *
 * The declared `mediaType` comes from the source document's own metadata and is
 * never trusted: type and extension are decided by sniffing the signature, and
 * intrinsic size is read from the same header. An asset whose size cannot be
 * read is refused rather than shipped without width/height, because those
 * attributes are what let the audit frame reserve the true box for an image it
 * deliberately never fetches.
 */
import { sha256Hex } from './common'
import { PARSER_PROBE_LIMITS } from './parser-limit-values'

export const PACKAGED_ASSET_DIRECTORY = 'oer2canvas'
// Exported so `allowlist.ts` can fence on the same literal it validates
// against here, rather than keeping a second copy that could drift out of
// sync and silently loosen that boundary.
export const FILEBASE = '$IMS-CC-FILEBASE$'

export type AssetRejection = 'unavailable' | 'unsupported-type' | 'too-large' | 'too-many'

export interface PreparedAsset {
  assetId: number
  sha256: string
  name: string
  archivePath: string
  reference: string
  mediaType: string
  extension: string
  width: number
  height: number
  bytes: Uint8Array
  originPart: string
}

export interface SniffedRaster {
  mediaType: string
  extension: string
  width: number
  height: number
}

const starts = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.every((byte, index) => bytes[offset + index] === byte)

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8)

/** PNG: IHDR is fixed at offset 16 and is always the first chunk. */
function png(bytes: Uint8Array): SniffedRaster | undefined {
  if (bytes.length < 24 || !starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return undefined
  if (!starts(bytes, [0x49, 0x48, 0x44, 0x52], 12)) return undefined
  return { mediaType: 'image/png', extension: 'png', width: u32be(bytes, 16), height: u32be(bytes, 20) }
}

/** GIF: logical screen descriptor is little-endian, immediately after the header. */
function gif(bytes: Uint8Array): SniffedRaster | undefined {
  if (bytes.length < 10 || !starts(bytes, [0x47, 0x49, 0x46, 0x38])) return undefined
  return { mediaType: 'image/gif', extension: 'gif', width: u16le(bytes, 6), height: u16le(bytes, 8) }
}

/** WebP: VP8/VP8L/VP8X each store size differently; all sit inside a RIFF container. */
function webp(bytes: Uint8Array): SniffedRaster | undefined {
  if (bytes.length < 30 || !starts(bytes, [0x52, 0x49, 0x46, 0x46]) || !starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return undefined
  }
  const chunk = String.fromCharCode(...bytes.slice(12, 16))
  const found = (width: number, height: number): SniffedRaster =>
    ({ mediaType: 'image/webp', extension: 'webp', width, height })
  if (chunk === 'VP8 ') return found(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff)
  if (chunk === 'VP8L') {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)
    return found((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8X') {
    const dim = (i: number) => (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16)) + 1
    return found(dim(24), dim(27))
  }
  return undefined
}

/** JPEG: walk the marker chain to the first frame header, which carries the size. */
function jpeg(bytes: Uint8Array): SniffedRaster | undefined {
  if (bytes.length < 4 || !starts(bytes, [0xff, 0xd8])) return undefined
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined
    const marker = bytes[offset + 1]!
    // SOF0..SOF15, excluding the non-frame markers DHT (c4), JPGA (c8) and DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mediaType: 'image/jpeg', extension: 'jpg', height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7) }
    }
    offset += 2 + u16be(bytes, offset + 2)
  }
  return undefined
}

/**
 * Sniffs the actual bytes against the four supported signatures and reads
 * intrinsic size from the same header. Returns `undefined` both for content
 * that is not one of these four formats at all (e.g. SVG, or a declared
 * `image/*` type that lies) AND for a truncated or otherwise corrupt header
 * of a real format (e.g. a PNG cut off before its `IHDR` chunk) — the two
 * cases are deliberately NOT distinguished, because there is no reliable
 * signal to distinguish "not this format" from "this format, broken" without
 * guessing. Both are refused identically: an asset this function can't read
 * a true size for must never be shipped.
 */
export function sniffRaster(bytes: Uint8Array): SniffedRaster | undefined {
  const found = png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes)
  if (!found || found.width <= 0 || found.height <= 0) return undefined
  return found
}

/**
 * A handful of ordinary Latin letters have no Unicode decomposition mapping
 * at all, so `normalize('NFKD')` below leaves them untouched and they would
 * otherwise survive to the final `[^a-z0-9]` reduction and get flattened to a
 * hyphen instead of folding to a readable letter (e.g. "Ünïcødé" losing its
 * `o` rather than becoming "unicode"). This table is deliberately small — the
 * common cases likely to appear in real document or author names (Nordic,
 * German, Polish, and the French/Latin ligatures) — not a general
 * transliteration engine. Anything outside it still degrades safely to a
 * hyphen, which is an acceptable trade-off for a filename slug.
 */
const NON_DECOMPOSING_LETTERS: Record<string, string> = {
  ø: 'o', Ø: 'o',
  æ: 'ae', Æ: 'ae',
  œ: 'oe', Œ: 'oe',
  đ: 'd', Đ: 'd',
  ł: 'l', Ł: 'l',
  ß: 'ss',
}
const NON_DECOMPOSING_LETTERS_PATTERN = new RegExp(`[${Object.keys(NON_DECOMPOSING_LETTERS).join('')}]`, 'g')

export function packagedAssetName(originPart: string, sha256: string, extension: string): string {
  const basename = originPart.split(/[\\/]/).pop() ?? ''
  const slug = basename
    .replace(/\.[^.]*$/, '')
    .replace(NON_DECOMPOSING_LETTERS_PATTERN, (letter) => NON_DECOMPOSING_LETTERS[letter]!)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'image'}-${sha256.slice(0, 8)}.${extension}`
}

export const packagedArchivePath = (name: string): string => `web_resources/${PACKAGED_ASSET_DIRECTORY}/${name}`
export const packagedReference = (name: string): string => `${FILEBASE}/${PACKAGED_ASSET_DIRECTORY}/${name}`

/**
 * Exactly our own reference form and nothing else. Anchored, with no traversal,
 * query, encoded separator, or foreign prefix — this predicate is what the
 * allowlist widens `img.src` by, so every character it admits is a decision.
 */
const PACKAGED_REFERENCE = /^\$IMS-CC-FILEBASE\$\/oer2canvas\/[A-Za-z0-9._-]+\.(?:png|jpe?g|gif|webp)$/

export function isPackagedReference(value: string): boolean {
  return PACKAGED_REFERENCE.test(value) && !value.includes('..')
}

export async function prepareAssets(
  assets: readonly { id: number; mediaType: string; originPart: string; data: Uint8Array }[],
): Promise<Map<number, PreparedAsset | { rejected: AssetRejection }>> {
  const prepared = new Map<number, PreparedAsset | { rejected: AssetRejection }>()
  // Identity is content, not position: two assets with byte-identical content
  // (the same image embedded twice under different document paths) must land
  // on the same archive entry, keyed off whichever origin was seen first —
  // Canvas itself resolves duplicate uploads sharing content to one `File`, so
  // shipping two entries for it would just be dead weight in the cartridge and
  // an ambiguous target for the reference that points at it.
  const byHash = new Map<string, { name: string; archivePath: string; reference: string }>()
  let total = 0
  for (const [index, asset] of assets.entries()) {
    if (index >= PARSER_PROBE_LIMITS.maximumAssetCount) {
      prepared.set(asset.id, { rejected: 'too-many' })
      continue
    }
    if (asset.data.byteLength === 0) {
      prepared.set(asset.id, { rejected: 'unavailable' })
      continue
    }
    if (asset.data.byteLength > PARSER_PROBE_LIMITS.maximumIndividualAssetBytes) {
      prepared.set(asset.id, { rejected: 'too-large' })
      continue
    }
    total += asset.data.byteLength
    if (total > PARSER_PROBE_LIMITS.maximumAssetBytes) {
      prepared.set(asset.id, { rejected: 'too-large' })
      continue
    }
    const sniffed = sniffRaster(asset.data)
    if (!sniffed) {
      prepared.set(asset.id, { rejected: 'unsupported-type' })
      continue
    }
    // `sha256Hex` is typed against `ArrayBuffer | Uint8Array<ArrayBuffer>`; a
    // `Uint8Array` arriving from elsewhere (e.g. a DataView-backed slice) may
    // carry the wider `ArrayBufferLike`, which isn't assignable. `sha256Hex`
    // itself already takes a defensive copy of anything that isn't literally
    // an `ArrayBuffer` (so an in-flight digest can't observe the caller
    // mutating the source afterwards) — passing `.slice().buffer` here does
    // that ONE required copy ourselves and hands over a concrete `ArrayBuffer`,
    // so `sha256Hex` takes its `bytes instanceof ArrayBuffer` branch and skips
    // its own copy. Passing `.slice()` (a `Uint8Array`) instead would still
    // typecheck but would silently double the copy for every asset, up to
    // 4 MiB each.
    const sha256 = await sha256Hex(asset.data.slice().buffer)
    let identity = byHash.get(sha256)
    if (!identity) {
      const name = packagedAssetName(asset.originPart, sha256, sniffed.extension)
      identity = { name, archivePath: packagedArchivePath(name), reference: packagedReference(name) }
      byHash.set(sha256, identity)
    }
    prepared.set(asset.id, {
      assetId: asset.id,
      sha256,
      name: identity.name,
      archivePath: identity.archivePath,
      reference: identity.reference,
      mediaType: sniffed.mediaType,
      extension: sniffed.extension,
      width: sniffed.width,
      height: sniffed.height,
      bytes: asset.data,
      originPart: asset.originPart,
    })
  }
  return prepared
}
