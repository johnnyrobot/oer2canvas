import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, writeZip } from './zip'

const utf8 = (s: string) => new TextEncoder().encode(s)
const read = (b: Uint8Array, at: number) =>
  b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)

/**
 * The test that matters: a REAL unzip, not our own idea of correctness.
 *
 * The output is bytes in a published format, so anything less than a third-party
 * reader agreeing is just this file marking its own homework.
 */
function roundTrip(bytes: Uint8Array): { list: string; extract: (name: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'))
  const path = join(dir, 'a.zip')
  writeFileSync(path, bytes)
  execFileSync('unzip', ['-t', path])
  execFileSync('unzip', ['-o', '-q', path, '-d', dir])
  return {
    list: execFileSync('unzip', ['-l', path], { encoding: 'utf8' }),
    extract: (name) => readFileSync(join(dir, name), 'utf8'),
  }
}

test('crc32 matches the known IEEE check value', () => {
  // The standard "check" vector: CRC-32 of "123456789" is 0xCBF43926.
  expect(crc32(utf8('123456789'))).toBe(0xcbf43926)
  expect(crc32(new Uint8Array())).toBe(0)
})

test('a real unzip accepts the archive and the bytes survive', async () => {
  const body = '<html><body>' + 'compress me '.repeat(200) + '</body></html>'
  const zip = await writeZip([
    { name: 'imsmanifest.xml', data: utf8('<manifest/>') },
    { name: 'wiki_content/page-1.html', data: utf8(body) },
  ])
  const { list, extract } = roundTrip(zip)
  expect(list).toContain('imsmanifest.xml')
  expect(list).toContain('wiki_content/page-1.html')
  expect(extract('imsmanifest.xml')).toBe('<manifest/>')
  // Byte-identical, which is the whole point: the cartridge publishes the exact
  // markup the audit passed.
  expect(extract('wiki_content/page-1.html')).toBe(body)
})

test('stored entries round-trip too, so deflate can be bisected out', async () => {
  const zip = await writeZip([{ name: 'a.txt', data: utf8('hello') }], { compress: false })
  expect(roundTrip(zip).extract('a.txt')).toBe('hello')
  // Method 0 in the local header.
  expect(zip[8]! | (zip[9]! << 8)).toBe(0)
})

test('deflate actually shrinks compressible content', async () => {
  const data = utf8('a'.repeat(5000))
  const packed = await writeZip([{ name: 'a.txt', data }])
  const stored = await writeZip([{ name: 'a.txt', data }], { compress: false })
  expect(packed.length).toBeLessThan(stored.length / 2)
  expect(roundTrip(packed).extract('a.txt')).toBe('a'.repeat(5000))
})

// A "compressed" entry larger than its input is a real outcome for tiny files,
// and paying for it would be silly.
test('an incompressible tiny entry falls back to stored', async () => {
  const zip = await writeZip([{ name: 'a.txt', data: utf8('x') }])
  expect(zip[8]! | (zip[9]! << 8)).toBe(0)
  expect(roundTrip(zip).extract('a.txt')).toBe('x')
})

test('byte-level: signatures and counts land where the format says', async () => {
  const zip = await writeZip([{ name: 'a.txt', data: utf8('hi') }], { compress: false })
  expect(read(zip, 0)).toBe(0x04034b50)
  // End of central directory, 22 bytes from the end with no comment.
  const eocd = zip.length - 22
  expect(read(zip, eocd)).toBe(0x06054b50)
  expect(zip[eocd + 8]! | (zip[eocd + 9]! << 8)).toBe(1) // entries on disk
  expect(zip[eocd + 10]! | (zip[eocd + 11]! << 8)).toBe(1) // entries total
})

// Determinism is what makes a golden reviewable and "did this change?"
// answerable. The cartridge carries its real timestamp in its filename instead.
test('the same content produces byte-identical archives', async () => {
  const entries = [{ name: 'a.txt', data: utf8('same') }]
  expect(Array.from(await writeZip(entries))).toEqual(Array.from(await writeZip(entries)))
})

test('an empty archive is still a valid one', async () => {
  const zip = await writeZip([])
  expect(zip).toHaveLength(22)
  expect(read(zip, 0)).toBe(0x06054b50)
})

// Above the format's 32-bit ceilings a zip written with these headers is
// silently corrupt. A refusal naming the limit beats an archive Canvas rejects
// with its own error message.
test('too many entries is refused loudly, not written corrupt', async () => {
  const many = Array.from({ length: 65536 }, (_, i) => ({ name: `f${i}`, data: new Uint8Array() }))
  await expect(writeZip(many)).rejects.toThrow(/zip64 is not implemented/)
})
