/** Build the browser-local LibreTexts catalog from the public Commons API. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const output = resolve(root, process.env.LIBRETEXTS_CATALOG_OUTPUT ?? 'public/catalogs/libretexts.json')
const endpoint = new URL(process.env.LIBRETEXTS_CATALOG_URL ?? 'https://commons.libretexts.org/api/v1/search/books-v2')
endpoint.searchParams.set('limit', '10000')
endpoint.searchParams.set('page', '1')
endpoint.searchParams.set('sort', 'title')

const response = await fetch(endpoint, {
  headers: { accept: 'application/json', 'user-agent': 'oer2canvas-catalog-builder/1.0 (+https://johnnyrobot.dev)' },
  signal: AbortSignal.timeout(20_000),
})
if (!response.ok) throw new Error(`LibreTexts Commons returned HTTP ${response.status}`)
const payload = await response.json()
if (!Array.isArray(payload.results)) throw new Error('LibreTexts Commons returned no results array')

const licenses = {
  ccby: ['CC BY', 'https://creativecommons.org/licenses/by/4.0/'],
  ccbync: ['CC BY-NC', 'https://creativecommons.org/licenses/by-nc/4.0/'],
  ccbyncnd: ['CC BY-NC-ND', 'https://creativecommons.org/licenses/by-nc-nd/4.0/'],
  ccbyncsa: ['CC BY-NC-SA', 'https://creativecommons.org/licenses/by-nc-sa/4.0/'],
  ccbynd: ['CC BY-ND', 'https://creativecommons.org/licenses/by-nd/4.0/'],
  ccbysa: ['CC BY-SA', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  publicdomain: ['Public Domain', 'https://creativecommons.org/publicdomain/mark/1.0/'],
  arr: ['All Rights Reserved'],
}

const books = payload.results.flatMap((raw) => {
  const id = String(raw.bookID ?? '').trim()
  const title = String(raw.title ?? '').trim()
  const slug = String(raw.links?.online ?? '').trim()
  if (!id || !title || !slug) return []
  const author = String(raw.author ?? '').trim()
  const license = licenses[String(raw.license ?? '').toLowerCase()]
  return [{
    source: 'libretexts', id, slug, title,
    ...(raw.subject ? { subject: String(raw.subject).trim() } : {}),
    ...(raw.thumbnail ? { coverUrl: String(raw.thumbnail).trim() } : {}),
    ...(raw.license ? { license: license?.[0] ?? String(raw.license), ...(license?.[1] ? { licenseUrl: license[1] } : {}) } : {}),
    authors: author ? author.split(/\s*(?:;|\band\b)\s*/i).filter(Boolean) : [],
    catalog: String(raw.library ?? '').trim(),
  }]
})
books.sort((a, b) => a.title.localeCompare(b.title))

if (books.length < 500) throw new Error(`LibreTexts catalog unexpectedly contained only ${books.length} books`)
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), books })}\n`)
console.log(`wrote ${books.length} LibreTexts books to ${output}`)
