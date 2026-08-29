import { pngHeaderDeclaring, RASTER_FIXTURES } from './testing/raster-fixtures'
import {
  isPackagedReference, packagedArchivePath, packagedAssetName, packagedReference,
  prepareAssets, sniffRaster,
  type PreparedAsset,
} from './assets'
import { PARSER_PROBE_LIMITS } from './parser-limit-values'

test.each(['png', 'jpeg', 'gif', 'webp'] as const)('sniffs %s and reads its true size', (key) => {
  const fixture = RASTER_FIXTURES[key]
  const sniffed = sniffRaster(fixture.bytes)
  expect(sniffed).toMatchObject({ mediaType: fixture.mediaType, width: 16, height: 16 })
})

test('refuses bytes that are not a validated raster', () => {
  expect(sniffRaster(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined()
  expect(sniffRaster(new Uint8Array([0, 1, 2, 3]))).toBeUndefined()
})

test('refuses a truncated header rather than guessing a size', () => {
  expect(sniffRaster(RASTER_FIXTURES.png.bytes.slice(0, 12))).toBeUndefined()
})

test('the sniffed type wins over a lying declared type', async () => {
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/gif', originPart: 'word/media/image1.bin', data: RASTER_FIXTURES.png.bytes },
  ])
  expect(prepared.get(0)).toMatchObject({ mediaType: 'image/png', extension: 'png' })
})

test('names an asset from its origin basename plus a hash suffix', () => {
  const name = packagedAssetName('word/media/image1.png', 'a3f91c2e5d6b7a8c', 'png')
  expect(name).toBe('image1-a3f91c2e.png')
  expect(packagedArchivePath(name)).toBe('web_resources/oer2canvas/image1-a3f91c2e.png')
  expect(packagedReference(name)).toBe('$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png')
})

test('falls back to a safe slug when the origin name is unusable', () => {
  expect(packagedAssetName('', 'a3f91c2e5d6b7a8c', 'png')).toBe('image-a3f91c2e.png')
  expect(packagedAssetName('media/../../etc/passwd', 'a3f91c2e5d6b7a8c', 'png')).toBe('passwd-a3f91c2e.png')
  expect(packagedAssetName('media/Ünïcødé Näme!.png', 'a3f91c2e5d6b7a8c', 'png')).toBe('unicode-name-a3f91c2e.png')
})

test('identical bytes prepare to one identity regardless of origin name', async () => {
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'a/one.png', data: RASTER_FIXTURES.png.bytes },
    { id: 1, mediaType: 'image/png', originPart: 'b/two.png', data: RASTER_FIXTURES.png.bytes },
  ])
  // Same content hash, so the same archive entry — which issue 07 proved Canvas
  // resolves to a single File shared across pages.
  expect((prepared.get(0) as { sha256: string }).sha256).toBe((prepared.get(1) as { sha256: string }).sha256)
  expect((prepared.get(0) as { archivePath: string }).archivePath)
    .toBe((prepared.get(1) as { archivePath: string }).archivePath)
})

test('the packaged name is carried on every occurrence, never recomputed from its own originPart', async () => {
  // Regression for a real hazard: a downstream consumer that recomputes
  // `packagedAssetName` from an asset's OWN `originPart` instead of using the
  // `name` carried on the record would get a different filename for the
  // second occurrence than the archive entry that content actually landed
  // at — the page would reference `first-occurrence-<hash>.png` while the
  // cartridge shipped `second-occurrence-<hash>.png`.
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'assets/first-occurrence.png', data: RASTER_FIXTURES.png.bytes },
    { id: 1, mediaType: 'image/png', originPart: 'assets/second-occurrence.png', data: RASTER_FIXTURES.png.bytes },
  ])
  const first = prepared.get(0) as PreparedAsset
  const second = prepared.get(1) as PreparedAsset

  // One archive identity, shared...
  expect(second.name).toBe(first.name)
  expect(second.archivePath).toBe(first.archivePath)
  // ...but provenance stays per-occurrence: each keeps its own originPart.
  expect(first.originPart).toBe('assets/first-occurrence.png')
  expect(second.originPart).toBe('assets/second-occurrence.png')
  // Recomputing from the second occurrence's own originPart would NOT
  // reproduce the name it was actually given — proof that a consumer must
  // use `.name` as carried, not `packagedAssetName(asset.originPart, ...)`.
  expect(packagedAssetName(second.originPart, second.sha256, second.extension)).not.toBe(second.name)
})

/**
 * Every extension in this system is an OUTPUT of `sniffRaster`, never an
 * input to a decision — `originPart`'s trailing `.png`/`.svg` is provenance
 * for the display name only, and `prepareAssets` never reads it to decide
 * whether to accept an asset or what to call its format. The earlier "sniffed
 * type wins over a lying declared type" test above already mismatches
 * `originPart` against true content (a `.bin` name, `image/gif` declared,
 * real PNG bytes) but only for the ACCEPT path. What is new here is the
 * REFUSAL arm — content that a name would suggest is fine but the sniff
 * rejects — and the `.name` assertion pinning that the winning extension in
 * the emitted filename is the sniffed one, not the one from `originPart`.
 * Without this, nothing would notice a future regression that started
 * trusting the filename instead of the sniff to decide acceptance — e.g. a
 * "fast path" that skips sniffing when the name already looks like a
 * supported image.
 */
test('refusal is decided by content, never by the origin filename', async () => {
  const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
  // An SVG wearing a .png name is still refused: the declared mediaType and
  // the origin path both claim PNG, but the bytes are not a raster this
  // system understands, and content wins.
  const disguised = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'media/diagram.png', data: svgBytes },
  ])
  expect(disguised.get(0)).toEqual({ rejected: 'unsupported-type' })

  // ... and a real PNG wearing a .svg name still packages, with the sniffed
  // extension rather than the one in its path — the archive entry and the
  // reference must be internally consistent with what the bytes actually are,
  // not with what the source document happened to call them.
  const mislabelled = await prepareAssets([
    { id: 0, mediaType: 'image/svg+xml', originPart: 'media/diagram.svg', data: RASTER_FIXTURES.png.bytes },
  ])
  expect(mislabelled.get(0)).toMatchObject({ mediaType: 'image/png', extension: 'png' })
  expect((mislabelled.get(0) as { name: string }).name).toMatch(/\.png$/)
})

test('rejects an oversized asset and an over-count document', async () => {
  const huge = new Uint8Array(4 * 1024 * 1024 + 1)
  huge.set(RASTER_FIXTURES.png.bytes)
  const overSize = await prepareAssets([{ id: 0, mediaType: 'image/png', originPart: 'a.png', data: huge }])
  expect(overSize.get(0)).toEqual({ rejected: 'too-large' })

  const many = Array.from({ length: 65 }, (_, index) => ({
    id: index, mediaType: 'image/png', originPart: `a${index}.png`, data: RASTER_FIXTURES.png.bytes,
  }))
  const overCount = await prepareAssets(many)
  expect(overCount.get(64)).toEqual({ rejected: 'too-many' })
})

test('a small file declaring an enormous bitmap is refused', async () => {
  // The attack is a DECLARED size, not a large file: these bytes are 24 long.
  const bomb = pngHeaderDeclaring(20_000, 20_000)
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'word/media/bomb.png', data: bomb },
  ])
  expect(prepared.get(0)).toEqual({ rejected: 'too-many-pixels' })
})

test('an image just under the pixel budget still packages', async () => {
  const side = Math.floor(Math.sqrt(PARSER_PROBE_LIMITS.maximumAssetPixels)) - 1
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'a.png', data: pngHeaderDeclaring(side, side) },
  ])
  expect(prepared.get(0)).toMatchObject({ width: side, height: side })
})

test('an image just over the pixel budget is refused', async () => {
  const side = Math.ceil(Math.sqrt(PARSER_PROBE_LIMITS.maximumAssetPixels)) + 1
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'a.png', data: pngHeaderDeclaring(side, side) },
  ])
  expect(prepared.get(0)).toEqual({ rejected: 'too-many-pixels' })
})

/**
 * The two tests above straddle the cap by ~19,000 px either side, which pins
 * that a cap exists but NOT which comparison enforces it: flipping `>` to `>=`
 * in `prepareAssets` leaves both of them green. This pair sits ON the boundary
 * and one pixel-row past it, so the operator itself is pinned — an image of
 * exactly `maximumAssetPixels` must package, and the smallest step beyond it
 * must not.
 */
test('an image of exactly the pixel budget packages, and one row more is refused', async () => {
  const cap = PARSER_PROBE_LIMITS.maximumAssetPixels
  const width = 8_000
  // Derived, not hardcoded — but the derivation only lands exactly on the
  // boundary if the cap divides evenly. If the cap ever changes to something
  // that does not, this fails loudly here rather than quietly reverting to a
  // near-boundary test that pins nothing.
  expect(cap % width).toBe(0)
  const height = cap / width

  const exactly = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'a.png', data: pngHeaderDeclaring(width, height) },
  ])
  expect(exactly.get(0)).toMatchObject({ width, height })

  const oneRowMore = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'a.png', data: pngHeaderDeclaring(width, height + 1) },
  ])
  expect(oneRowMore.get(0)).toEqual({ rejected: 'too-many-pixels' })
})

test('the ordinary fixtures are nowhere near the pixel budget', async () => {
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'a.png', data: RASTER_FIXTURES.png.bytes },
  ])
  expect(prepared.get(0)).toMatchObject({ width: 16, height: 16 })
})

test('recognises only its own reference form', () => {
  expect(isPackagedReference('$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png')).toBe(true)
  // Every rejection below is a way the allowlist could otherwise be widened.
  expect(isPackagedReference('$IMS-CC-FILEBASE$/oer2canvas/../../etc/passwd')).toBe(false)
  expect(isPackagedReference('$IMS-CC-FILEBASE$/oer2canvas/a.png?x=1')).toBe(false)
  expect(isPackagedReference('$IMS-CC-FILEBASE$/oer2canvas/a%2Fb.png')).toBe(false)
  expect(isPackagedReference('$IMS-CC-FILEBASE$/elsewhere/a.png')).toBe(false)
  expect(isPackagedReference('$IMS-CC-FILEBASE$/oer2canvas/a.svg')).toBe(false)
  expect(isPackagedReference('https://example.com/a.png')).toBe(false)
})

/**
 * A JPEG whose marker chain a `+2+length` walker and a real decoder disagree
 * about — the parser differential that made the decoded-pixel cap bypassable.
 *
 * WHY this is possible at all: not every JPEG marker carries a length. `FF01`
 * (TEM) and `FFD0`–`FFD7` (RSTn) are STANDALONE — libjpeg-turbo, and therefore
 * Chrome, steps over them by two bytes and reads no length. A walker that
 * assumes every marker is followed by a 2-byte length instead reads the next
 * two bytes as one: after the `FFD0` here that is the `FF01` sitting behind it,
 * so it skips 0xFF01 = 65281 bytes and lands deep inside a comment segment's
 * attacker-chosen padding. Whatever bytes sit at that offset are then read as
 * the frame header. The walker sees a decoy `SOF0` declaring 16x16 — 256 px,
 * far under `maximumAssetPixels` — while the browser walks past the comment to
 * the REAL `SOF0` and decodes 8000x6000: 48 MP, roughly 192 MB of RGBA. The cap
 * would be enforced against a header the browser never reads.
 */
function jpegWithDesyncedMarkerChain(): Uint8Array {
  const COMMENT_LENGTH = 65_296 // declared by the COM header, so its payload runs to 65303
  const DECOY_AT = 65_285 // exactly where a `+2+length` walk lands: inside that payload
  const REAL_AT = 65_304 // exactly where a decoder that skips RSTn/TEM arrives: past it
  const bytes = new Uint8Array(REAL_AT + 19)
  bytes.fill(0x41) // comment padding — ordinary bytes, nothing load-bearing about them
  const be16 = (value: number, at: number) => {
    bytes[at] = (value >>> 8) & 0xff
    bytes[at + 1] = value & 0xff
  }
  bytes.set([0xff, 0xd8], 0) // SOI
  bytes.set([0xff, 0xd0], 2) // RST0 — standalone, so a real decoder steps two bytes
  bytes.set([0xff, 0x01], 4) // TEM — also standalone, AND the two bytes a
  //                            length-assuming walker misreads as a 65281-byte length
  bytes.set([0xff, 0xfe], 6) // COM, whose payload is where the decoy hides
  be16(COMMENT_LENGTH, 8)
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], DECOY_AT) // decoy SOF0, buried in the comment
  be16(16, DECOY_AT + 5)
  be16(16, DECOY_AT + 7)
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], REAL_AT) // the frame header Chrome reaches
  be16(6000, REAL_AT + 5)
  be16(8000, REAL_AT + 7)
  return bytes
}

test('a jpeg whose marker chain cannot be walked deterministically is refused', async () => {
  const desynced = jpegWithDesyncedMarkerChain()
  expect(sniffRaster(desynced)).toBeUndefined()

  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/jpeg', originPart: 'word/media/desync.jpg', data: desynced },
  ])
  // `unsupported-type`, NOT `too-many-pixels`: the refusal happens at the sniff,
  // before any size claim exists to measure. There is no size here we are
  // entitled to believe — which is the whole reason this is refused rather than
  // measured. It keeps its blocking finding and its visible placeholder either
  // way, so nothing publishes with a silent hole.
  expect(prepared.get(0)).toEqual({ rejected: 'unsupported-type' })
})
