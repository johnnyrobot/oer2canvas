import { createCommonsSearch, parseCommonsLicense } from './commons'

const page = (title: string, extmetadata: Record<string, { value: string }>, categories: string[] = []) => ({
  title,
  imageinfo: [{ url: `https://upload.wikimedia.org/${title}`, thumburl: `https://upload.wikimedia.org/thumb/${title}`, width: 1200, height: 800, mime: 'image/jpeg', descriptionurl: `https://commons.wikimedia.org/wiki/${title}`, extmetadata }],
  categories: categories.map((c) => ({ title: c })),
})
const envelope = (pages: unknown[]) => new Response(JSON.stringify({ query: { pages: Object.fromEntries(pages.map((p, i) => [String(i + 1), p])) } }), { status: 200 })

test('parses licence short names into the allowed set and drops the rest', () => {
  expect(parseCommonsLicense('CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0')).toEqual({ kind: 'by-sa', name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0' })
  expect(parseCommonsLicense('CC BY 2.0', 'https://creativecommons.org/licenses/by/2.0')).toEqual({ kind: 'by', name: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0' })
  expect(parseCommonsLicense('CC0', 'https://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ kind: 'cc0', name: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' })
  expect(parseCommonsLicense('Public domain', undefined)).toEqual({ kind: 'pd', name: 'Public domain' })
  expect(parseCommonsLicense('CC BY-NC 4.0', 'x')).toBeUndefined()
  expect(parseCommonsLicense('CC BY-ND 4.0', 'x')).toBeUndefined()
  expect(parseCommonsLicense('CC BY-NC-SA 4.0', 'x')).toBeUndefined()
  expect(parseCommonsLicense('GFDL', 'x')).toBeUndefined()
  expect(parseCommonsLicense(undefined, undefined)).toBeUndefined()
})

test('search keeps allowed licences, drops NC/ND/unknown and do-not-use categories, strips HTML from Artist', async () => {
  const fetch = vi.fn(async () => envelope([
    page('File:A.jpg', { LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0' }, Artist: { value: '<a href="x">Jane Doe</a>' }, ObjectName: { value: 'A' } }),
    page('File:B.jpg', { LicenseShortName: { value: 'CC BY-NC 4.0' }, LicenseUrl: { value: 'y' } }),
    page('File:C.jpg', { Artist: { value: 'Nobody' } }),
    page('File:D.jpg', { LicenseShortName: { value: 'CC0' }, LicenseUrl: { value: 'z' } }, ['Category:Copyright violations']),
    page('File:E.jpg', { LicenseShortName: { value: 'Public domain' } }, ['Category:PD-old']),
  ]))
  const hits = await createCommonsSearch({ fetch }).search('students', { licenses: ['cc0', 'by', 'by-sa', 'pd'] })
  expect(hits.map((h) => h.id)).toEqual(['File:A.jpg', 'File:E.jpg'])
  expect(hits[0]).toMatchObject({ provider: 'commons', title: 'A', creator: 'Jane Doe', license: { kind: 'by' }, sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg', width: 1200, height: 800, mediaType: 'image/jpeg' })
  const url = (fetch.mock.calls[0] as unknown as [string])[0]
  expect(url).toContain('origin=*')
  expect(url).toContain('gsrnamespace=6')
  expect(url).toContain(encodeURIComponent('students'))
})

test('the licence filter narrows results', async () => {
  const fetch = vi.fn(async () => envelope([
    page('File:A.jpg', { LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'u' } }),
    page('File:B.jpg', { LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'u' } }),
  ]))
  const hits = await createCommonsSearch({ fetch }).search('x', { licenses: ['by'] })
  expect(hits.map((h) => h.id)).toEqual(['File:A.jpg'])
})

test('a non-OK response rejects with a readable message and no vendor text', async () => {
  const fetch = vi.fn(async () => new Response('<html>vendor', { status: 503 }))
  await expect(createCommonsSearch({ fetch }).search('x', { licenses: ['by'] })).rejects.toThrow(/^Wikimedia Commons could not be reached \(HTTP 503\)\.$/)
})

test('a fetch that throws rejects with a message that names the provider, not the browser error', async () => {
  const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
  await expect(createCommonsSearch({ fetch }).search('x', { licenses: ['by'] })).rejects.toThrow(/Wikimedia Commons could not be reached from this browser/)
})
