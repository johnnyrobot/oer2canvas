import { writeZip } from '../engine/export/zip'
import { readZipParts, ZipReadError, PRESENTATION_PACKAGE_LIMITS } from './zip-read'

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

  await expect(readZipParts(patched, () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'malformed',
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

/**
 * Rewrites every uncompressed-size field (central directory and local header)
 * to `declared`, leaving the payload untouched — which is exactly what a
 * hand-built hostile archive does.
 */
function patchUncompressedSizes(zip: Uint8Array, declared: number): Uint8Array {
  const patched = zip.slice()
  const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength)
  for (let at = 0; at + 4 <= patched.length; at += 1) {
    const signature = view.getUint32(at, true)
    if (signature === 0x02014b50) view.setUint32(at + 24, declared, true)
    if (signature === 0x04034b50) view.setUint32(at + 22, declared, true)
  }
  return patched
}
