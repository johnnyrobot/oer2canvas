import { writeZip } from '../engine/export/zip'
import { readZipParts, ZipReadError, PRESENTATION_PACKAGE_LIMITS } from './zip-read'
import { patchUncompressedSizes } from './testing/presentation-fixtures'

const utf8 = (value: string) => new TextEncoder().encode(value)

test('reads only the parts the caller asked for', async () => {
  const bytes = await writeZip([
    { name: 'ppt/presentation.xml', data: utf8('<p:presentation/>') },
    { name: 'ppt/media/image1.png', data: new Uint8Array(1024) },
    { name: 'ppt/slides/slide1.xml', data: utf8('<p:sld/>') },
  ])
  const parts = await readZipParts(bytes, (path) => path.endsWith('.xml'))

  expect([...parts.keys()].sort()).toEqual(['ppt/presentation.xml', 'ppt/slides/slide1.xml'])
  expect(parts.get('ppt/slides/slide1.xml')).toBe('<p:sld/>')
})

test('a stored (uncompressed) entry reads back identically', async () => {
  // `writeZip` stores rather than deflates when deflate does not help, so both
  // methods appear in real packages and both must round-trip.
  const bytes = await writeZip([{ name: 'content.xml', data: utf8('<x/>') }], { compress: false })
  const parts = await readZipParts(bytes, () => true)

  expect(parts.get('content.xml')).toBe('<x/>')
})

test('refuses a package with more entries than the ceiling', async () => {
  const entries = Array.from(
    { length: PRESENTATION_PACKAGE_LIMITS.maximumPackageEntries + 1 },
    (_unused, index) => ({ name: `part${index}.xml`, data: utf8('<x/>') }),
  )
  const bytes = await writeZip(entries)

  await expect(readZipParts(bytes, () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'resource-limit',
    message: expect.stringMatching(/entries/),
  })
})

test('refuses a part whose declared size exceeds the ceiling, before inflating it', async () => {
  // A quarter of `maximumIndexedPartBytes` in source characters is enough to
  // exceed the ceiling once repeated, without building the ~33 MB string that
  // repeating to the full ceiling count would require just to test an 8 MiB cap.
  const oversized = utf8('<x/>'.repeat(PRESENTATION_PACKAGE_LIMITS.maximumIndexedPartBytes / 4 + 1))
  const bytes = await writeZip([{ name: 'big.xml', data: oversized }])

  await expect(readZipParts(bytes, () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'resource-limit',
  })
})

test('refuses an entry whose header lies about its uncompressed size', async () => {
  // The classic zip-bomb shape: a small declared size hiding a large payload.
  // Patching the central-directory AND local-header size fields to 4 leaves a
  // valid-looking archive whose inflate must be stopped mid-stream.
  const bytes = await writeZip([{ name: 'lie.xml', data: utf8('<x/>'.repeat(100_000)) }])
  const patched = patchUncompressedSizes(bytes, 4)

  // The message, not just the code, is asserted: a reader that dropped the
  // mid-stream cap would inflate the whole payload and refuse afterwards at
  // the length compare, which also throws `code: 'malformed'`. Only the
  // cancel-branch message proves the stream was actually stopped mid-flight.
  await expect(readZipParts(patched, () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'malformed',
    message: expect.stringMatching(/inflated past the size/),
  })
})

test('refuses a part name that escapes the package', async () => {
  const bytes = await writeZip([{ name: '../../etc/passwd', data: utf8('x') }])

  await expect(readZipParts(bytes, () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'malformed',
    message: expect.stringMatching(/path/),
  })
})

test('refuses bytes with no end-of-central-directory record', async () => {
  await expect(readZipParts(new Uint8Array(64), () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'malformed',
  })
})

test('refuses an entry whose compressed bytes are corrupt, not merely its declared size', async () => {
  // A truncated or partially downloaded upload is the most likely real bad
  // input a user hits, and it corrupts the compressed bytes themselves rather
  // than lying about any size field — every other malformed test in this file
  // patches a header, this one patches the payload. The platform's deflate
  // decoder reports this as a raw `TypeError` (Node's carries
  // `code: 'Z_DATA_ERROR'` and an empty message), which is not a
  // `ZipReadError` and must be translated rather than left to escape as-is.
  const bytes = await writeZip([{ name: 'corrupt.xml', data: utf8('<x/>'.repeat(1_000)) }])
  const corrupted = corruptCompressedBytes(bytes, 'corrupt.xml')

  await expect(readZipParts(corrupted, () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'malformed',
    message: expect.stringMatching(/corrupt|inflat/i),
  })
})

/**
 * Flips a handful of bytes inside `entryName`'s compressed payload, leaving
 * every size and offset field untouched. This is what corrupts a deflate
 * stream WITHOUT tripping any of the size or path checks the other tests in
 * this file already cover — it can only be caught by the decoder itself
 * failing to inflate it.
 */
function corruptCompressedBytes(zip: Uint8Array, entryName: string): Uint8Array {
  const corrupted = zip.slice()
  const view = new DataView(corrupted.buffer, corrupted.byteOffset, corrupted.byteLength)
  const decoder = new TextDecoder('utf-8')
  for (let at = 0; at + 4 <= corrupted.length; at += 1) {
    if (view.getUint32(at, true) !== 0x04034b50) continue
    const compressedSize = view.getUint32(at + 18, true)
    const nameLength = view.getUint16(at + 26, true)
    const extraLength = view.getUint16(at + 28, true)
    const name = decoder.decode(corrupted.subarray(at + 30, at + 30 + nameLength))
    if (name !== entryName) continue
    const dataAt = at + 30 + nameLength + extraLength
    for (let offset = 0; offset < Math.min(8, compressedSize); offset += 1) {
      corrupted[dataAt + offset] = corrupted[dataAt + offset]! ^ 0xff
    }
    return corrupted
  }
  throw new Error(`no local header found for "${entryName}"`)
}
