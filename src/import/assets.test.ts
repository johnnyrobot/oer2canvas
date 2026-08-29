import { RASTER_FIXTURES } from './testing/raster-fixtures'
import {
  isPackagedReference, packagedArchivePath, packagedAssetName, packagedReference,
  prepareAssets, sniffRaster,
  type PreparedAsset,
} from './assets'
import { PARSER_PROBE_LIMITS } from './parser-limit-values'

/**
 * A PNG header declaring `width` x `height`, with no image data behind it.
 * `sniffRaster` reads dimensions from the IHDR alone, which is exactly the
 * property an attacker exploits: a tiny file can claim an enormous bitmap.
 */
function pngHeaderDeclaring(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const be = (value: number, at: number) => {
    bytes[at] = (value >>> 24) & 0xff
    bytes[at + 1] = (value >>> 16) & 0xff
    bytes[at + 2] = (value >>> 8) & 0xff
    bytes[at + 3] = value & 0xff
  }
  be(width, 16)
  be(height, 20)
  return bytes
}

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
