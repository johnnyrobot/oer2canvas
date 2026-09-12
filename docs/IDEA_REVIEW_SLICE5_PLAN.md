# IDEA Review — Slice 5 Implementation Plan (open-licensed image search)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the 7.1 panel, search Wikimedia Commons and Openverse for CC0 / CC BY / CC BY-SA / public-domain images, choose one, write its alt text, place it in the section, and have it packaged into the cartridge with TASL attribution in the caption and in the page's Source-and-license block.

**Architecture:** Two search adapters behind one `ImageSearch` port, browser-direct and keyless, each parsing per-result license metadata and dropping anything not in the allowed set. A chosen image is fetched in the browser, prepared through the existing `prepareAssets` sniff/hash/name path, appended to the chapter's `assets`, and recorded as an `image` edit in the `IdeaEdits` map. A new compile step `insertIdeaImages` (after `ensureBlockIds`, before `resolveAlt`) emits the figure markup with a packaged `$IMS-CC-FILEBASE$` reference; `applyIdeaEdits` (after attribution) adds the credit lines. An image-API probe records CORS evidence before the adapters are trusted.

**Tech Stack:** TypeScript, React 19, `fetch`, `DOMParser`, `src/import/assets.ts` (`prepareAssets`, `packagedReference`), Playwright (probe only), Vitest.

**Spec:** `docs/IDEA_REVIEW_SPEC.md` §2.3, §2.7, §6, §7.1, §8 slice 5. Aligned 2026-09-11 with the revised slices 1–2: an image edit is an edit, so it persists in the IDEA document like a wording edit — and because an image edit is only a reference to packaged bytes, the bytes (the `ImportedAsset`) persist beside it, keyed by chapter, and are re-attached to the chapter before its initial compile. Image edits dispatch through `useIdeaReviews.dispatchEdit`; the render that shows the placed figure is slice 2's `IdeaChapterRender` in the aside; `IdeaScreen` keeps every prop from slices 1–4. One refinement recorded here: §6.3 said a new image "enters the accessibility queue". By the time IDEA runs, the queue session is closed, so instead the placement dialog **requires alt text and checks it with the same rules the queue's Save uses** (`altTextIssue`, the 120-character fit), refusing an `error`-severity alt. The rebuilt section is still re-audited through the gate before it can be published. Same guarantee, earlier.

## Global Constraints

- **Only CC0, CC BY, CC BY-SA, and public-domain results are shown.** A result with unparseable or unknown license metadata is dropped, not shown with a warning. (§6.1)
- **No key, no relay.** Both APIs are called anonymously from the browser; Openverse is dropped rather than proxied if its anonymous tier proves unusable. (§6.1)
- **No demographic ranking or filtering.** The instructor's query does that. (§6.2)
- **Attribution is TASL** (Title · Author · Source · License) in the caption and in the Source-and-license block; CC BY-SA adds the share-alike sentence. (§6.4)
- **Block ids are not disturbed**: image insertion runs after `ensureBlockIds`, so existing edit keys stay valid.
- **No network in tests**; `fetch` is injected everywhere.
- **An added image survives a reload as a whole.** The `image` edit and its asset bytes are stored together in the IDEA document (spec §2.7); restore validates both and drops an edit whose asset is missing rather than emit a packaged reference to nothing. *Forget all IDEA reviews* removes both.
- Commit trailer: `Co-Authored-By: Claude <model name> <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `scripts/idea-image-api-probe.mjs` | Evidence: search endpoints and image hosts reachable from a browser origin; writes `docs/evidence/idea-image-api-<date>.md`. |
| `src/engine/idea/images/search.ts` | `ImageSearch`, `ImageHit`, `License`, `ALLOWED_LICENSES`, `tasl()`. |
| `src/engine/idea/images/commons.ts`, `openverse.ts` | Adapters with injected fetch and per-result license parsing. |
| `src/engine/idea/images/fetch-image.ts` | `fetchImageBytes(hit, fetch, signal)` → `Uint8Array`. |
| `src/engine/idea/edits.ts` | `IdeaEdit` gains the `image` kind; `imageEditKey()`. |
| `src/engine/idea/store.ts`, `src/components/idea/useIdeaReviews.ts` (slices 1–2, extended) | The document gains per-chapter `assets`; restore replays image edits and validates their bytes; the hook gains `assetsFor` / `addAsset`. |
| `src/engine/compile/steps/idea-images.ts` | `insertIdeaImages` step. |
| `src/engine/compile/steps/idea-edits.ts` | Credit lines for image edits. |
| `src/engine/compile/steps/index.ts` | Register `insertIdeaImages`. |
| `src/components/idea/useImageSearch.ts`, `ImageSearch.tsx`, `PlaceImageDialog.tsx` | Search UI, results grid, placement + alt + license obligation. |
| `src/components/idea/CategoryPanel.tsx`, `IdeaScreen.tsx`, `copy.ts`, `src/App.tsx` | Entry points in 7.1; asset append + edit dispatch. |
| Docs | `PRIVACY.md`, `README.md`, `docs/IDEA.md`, `docs/RELEASE-ACCEPTANCE.md`, `THIRD-PARTY-NOTICES.md`. |

---

### Task 1: The image-API probe

**Files:**
- Create: `scripts/idea-image-api-probe.mjs`
- Modify: `package.json` (`"verify:idea-image-api": "node scripts/idea-image-api-probe.mjs"`)
- Create by running: `docs/evidence/idea-image-api-<date>.md`

- [ ] **Step 1: Write the probe**

```js
/**
 * Can a browser origin search Commons and Openverse directly, and fetch the
 * image bytes a hit points at? Same method as the LLM probe: a throwaway
 * origin, real fetches from page script, results readable or opaque.
 *
 * Bytes matter as much as search: an image the browser cannot fetch cannot be
 * packaged, and an adapter that finds it would be offering something the app
 * cannot deliver. The table therefore has a column per host that the sample
 * search returned.
 */
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const QUERY = 'students studying'
const COMMONS = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(QUERY)}&gsrlimit=5&prop=imageinfo|categories&iiprop=url|extmetadata|size|mime&iiurlwidth=320&cllimit=50`
const OPENVERSE = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(QUERY)}&license=cc0,by,by-sa&page_size=5`

async function serveForeignOrigin() {
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><title>idea image probe</title>') })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

async function main() {
  const { chromium } = await import('playwright')
  const foreign = await serveForeignOrigin()
  const browser = await chromium.launch({ headless: true })
  const date = new Date().toISOString().slice(0, 10)
  try {
    const page = await browser.newPage()
    await page.goto(`${foreign.origin}/`)
    const result = await page.evaluate(async ({ commons, openverse }) => {
      const get = async (url) => {
        try { const r = await fetch(url); return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : undefined } } catch (e) { return { ok: false, error: String(e) } }
      }
      const bytes = async (url) => {
        try { const r = await fetch(url); const b = await r.arrayBuffer(); return { ok: r.ok, status: r.status, bytes: b.byteLength } } catch (e) { return { ok: false, error: String(e) } }
      }
      const c = await get(commons)
      const o = await get(openverse)
      const commonsUrls = c.json ? Object.values(c.json.query?.pages ?? {}).map((p) => p.imageinfo?.[0]?.thumburl).filter(Boolean).slice(0, 3) : []
      const openverseUrls = o.json ? (o.json.results ?? []).map((r) => r.url).slice(0, 3) : []
      const fetched = []
      for (const u of [...commonsUrls, ...openverseUrls]) fetched.push({ url: u, host: new URL(u).host, ...(await bytes(u)) })
      return { commons: { ok: c.ok, status: c.status, error: c.error, hits: commonsUrls.length }, openverse: { ok: o.ok, status: o.status, error: o.error, hits: openverseUrls.length, rateLimit: undefined }, fetched }
    }, { commons: COMMONS, openverse: OPENVERSE })
    const lines = [
      `# IDEA image APIs — browser-direct probe — ${date}`, '',
      `Origin under test: ${foreign.origin}. Query: "${QUERY}". No key sent.`, '',
      '| Endpoint | Search from page script | Hits |', '| --- | --- | --- |',
      `| Wikimedia Commons | ${result.commons.ok ? `HTTP ${result.commons.status}` : `opaque/failed: ${result.commons.error ?? result.commons.status}`} | ${result.commons.hits} |`,
      `| Openverse (anonymous) | ${result.openverse.ok ? `HTTP ${result.openverse.status}` : `opaque/failed: ${result.openverse.error ?? result.openverse.status}`} | ${result.openverse.hits} |`,
      '', '| Image host | Bytes fetch from page script |', '| --- | --- |',
      ...result.fetched.map((f) => `| ${f.host} | ${f.ok ? `HTTP ${f.status}, ${f.bytes} bytes` : `opaque/failed: ${f.error ?? f.status}`} |`),
      '', 'Reproduce with `npm run verify:idea-image-api`. A provider whose search is opaque is not offered; an image host whose bytes are opaque cannot be packaged, and the placement dialog says so for that hit.', '',
    ]
    const out = `docs/evidence/idea-image-api-${date}.md`
    writeFileSync(out, lines.join('\n'))
    console.log(lines.join('\n'))
    console.log(`\nwritten to ${out}`)
  } finally {
    await browser.close()
    await foreign.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1 })
}
```

- [ ] **Step 2: Run it, read the table, commit**

Run: `npm run verify:idea-image-api`
Read `docs/evidence/idea-image-api-<date>.md`. Task 2 marks each adapter `offered` from the search column; the bytes column tells you which hosts to expect to fail in the placement dialog (that path is handled, not assumed).

```bash
git add scripts/idea-image-api-probe.mjs package.json docs/evidence/idea-image-api-*.md
git commit -m "test: probe which image APIs and hosts a browser origin can reach

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 2: The search port and the two adapters

**Files:**
- Create: `src/engine/idea/images/search.ts`, `commons.ts`, `openverse.ts`, `fetch-image.ts`
- Test: `src/engine/idea/images/search.test.ts`, `commons.test.ts`, `openverse.test.ts`, `fetch-image.test.ts`

**Interfaces:**
```ts
// search.ts
export type License = 'cc0' | 'by' | 'by-sa' | 'pd'
export const ALLOWED_LICENSES: readonly License[]
export const LICENSE_LABEL: Readonly<Record<License, string>>          // 'CC0 1.0' | 'CC BY' | 'CC BY-SA' | 'Public domain'
export interface ImageHit {
  provider: 'commons' | 'openverse'; id: string; title: string; thumbUrl: string; fullUrl: string
  width: number; height: number; mediaType?: string
  license: { kind: License; name: string; url?: string }
  creator?: string; sourcePageUrl: string
}
export interface SearchOpts { licenses: readonly License[]; page?: number; signal?: AbortSignal }
export interface ImageSearch { id: 'commons' | 'openverse'; label: string; offered: boolean; evidence: string; search(query: string, opts: SearchOpts): Promise<ImageHit[]> }
export function tasl(hit: ImageHit): { text: string; shareAlike: boolean }   // 'Title by Creator, Wikimedia Commons, CC BY 4.0'
// commons.ts
export function createCommonsSearch(deps?: { fetch?: typeof globalThis.fetch }): ImageSearch
export function parseCommonsLicense(short: string | undefined, url: string | undefined): ImageHit['license'] | undefined
// openverse.ts
export function createOpenverseSearch(deps?: { fetch?: typeof globalThis.fetch }): ImageSearch
// fetch-image.ts
export async function fetchImageBytes(hit: ImageHit, fetch: typeof globalThis.fetch, signal?: AbortSignal): Promise<Uint8Array>
```

- [ ] **Step 1: Write the failing tests**

`src/engine/idea/images/search.test.ts`:
```ts
import { tasl, type ImageHit } from './search'

const hit = (over: Partial<ImageHit>): ImageHit => ({
  provider: 'commons', id: 'File:X.jpg', title: 'Students at a bench', thumbUrl: 't', fullUrl: 'f', width: 10, height: 10,
  license: { kind: 'by', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, creator: 'A. Photographer', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg', ...over,
})

test('TASL names title, creator, source, and licence', () => {
  expect(tasl(hit({})).text).toBe('“Students at a bench” by A. Photographer, Wikimedia Commons, CC BY 4.0')
  expect(tasl(hit({ creator: undefined })).text).toBe('“Students at a bench”, Wikimedia Commons, CC BY 4.0')
  expect(tasl(hit({ provider: 'openverse', license: { kind: 'cc0', name: 'CC0 1.0' } })).text).toBe('“Students at a bench” by A. Photographer, via Openverse, CC0 1.0')
})

test('share-alike is flagged', () => {
  expect(tasl(hit({ license: { kind: 'by-sa', name: 'CC BY-SA 4.0' } })).shareAlike).toBe(true)
  expect(tasl(hit({})).shareAlike).toBe(false)
})
```

`src/engine/idea/images/commons.test.ts`:
```ts
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
  const url = (fetch.mock.calls[0] as [string])[0]
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
  await expect(createCommonsSearch({ fetch }).search('x', { licenses: ['by'] })).rejects.toThrow(/Wikimedia Commons could not be reached \(HTTP 503\)/)
})
```

`src/engine/idea/images/openverse.test.ts`:
```ts
import { createOpenverseSearch } from './openverse'

const result = (over: Record<string, unknown>) => ({
  id: 'abc', title: 'A bench', url: 'https://live.staticflickr.com/x.jpg', thumbnail: 'https://api.openverse.org/v1/images/abc/thumb/', width: 800, height: 600,
  license: 'by', license_version: '2.0', license_url: 'https://creativecommons.org/licenses/by/2.0/', creator: 'Sam', foreign_landing_url: 'https://flickr.com/p/1', ...over,
})
const envelope = (results: unknown[]) => new Response(JSON.stringify({ result_count: results.length, results }), { status: 200 })

test('maps results, keeps only allowed licences, and requests the licence filter', async () => {
  const fetch = vi.fn(async () => envelope([result({}), result({ id: 'nc', license: 'by-nc' }), result({ id: 'pdm', license: 'pdm', license_url: 'https://creativecommons.org/publicdomain/mark/1.0/' }), result({ id: 'z', license: 'cc0', license_version: '1.0' })]))
  const hits = await createOpenverseSearch({ fetch }).search('bench', { licenses: ['cc0', 'by', 'by-sa', 'pd'] })
  expect(hits.map((h) => [h.id, h.license.kind, h.license.name])).toEqual([['abc', 'by', 'CC BY 2.0'], ['pdm', 'pd', 'Public Domain Mark 1.0'], ['z', 'cc0', 'CC0 1.0']])
  expect(hits[0]).toMatchObject({ provider: 'openverse', title: 'A bench', creator: 'Sam', sourcePageUrl: 'https://flickr.com/p/1', fullUrl: 'https://live.staticflickr.com/x.jpg' })
  const url = (fetch.mock.calls[0] as [string])[0]
  expect(url).toContain('api.openverse.org/v1/images/')
  expect(url).toContain('license=cc0%2Cby%2Cby-sa%2Cpdm')
})

test('a result without license_url or with an unknown licence is dropped', async () => {
  const fetch = vi.fn(async () => envelope([result({ license_url: undefined }), result({ id: 'q', license: 'sampling+' })]))
  expect(await createOpenverseSearch({ fetch }).search('x', { licenses: ['by'] })).toEqual([])
})

test('429 rejects with a rate-limit message', async () => {
  const fetch = vi.fn(async () => new Response('{}', { status: 429 }))
  await expect(createOpenverseSearch({ fetch }).search('x', { licenses: ['by'] })).rejects.toThrow(/rate-limiting|Wait a moment/)
})
```

`src/engine/idea/images/fetch-image.test.ts`:
```ts
import { fetchImageBytes } from './fetch-image'
import type { ImageHit } from './search'

const hit: ImageHit = { provider: 'commons', id: 'x', title: 't', thumbUrl: 'th', fullUrl: 'https://upload.wikimedia.org/x.png', width: 1, height: 1, license: { kind: 'cc0', name: 'CC0' }, sourcePageUrl: 's' }

test('returns the bytes of the full image', async () => {
  const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
  expect([...(await fetchImageBytes(hit, fetch))]).toEqual([1, 2, 3])
})

test('an opaque or failed fetch rejects with a message that names the host and the way out', async () => {
  const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
  await expect(fetchImageBytes(hit, fetch)).rejects.toThrow(/upload\.wikimedia\.org[^.]*does not let this browser fetch it[\s\S]*Document import/)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/engine/idea/images/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `search.ts`**

```ts
/**
 * The port both image providers implement, and the one licence set the app
 * will show. Anything outside `ALLOWED_LICENSES` never reaches a result grid:
 * a CC BY textbook page cannot carry an NC or ND image, and "unknown" is not a
 * licence.
 */
export type License = 'cc0' | 'by' | 'by-sa' | 'pd'

export const ALLOWED_LICENSES: readonly License[] = ['cc0', 'by', 'by-sa', 'pd']

export const LICENSE_LABEL: Readonly<Record<License, string>> = {
  cc0: 'CC0', by: 'CC BY', 'by-sa': 'CC BY-SA', pd: 'Public domain',
}

export interface ImageHit {
  provider: 'commons' | 'openverse'
  id: string
  title: string
  thumbUrl: string
  fullUrl: string
  width: number
  height: number
  mediaType?: string
  license: { kind: License; name: string; url?: string }
  creator?: string
  sourcePageUrl: string
}

export interface SearchOpts {
  licenses: readonly License[]
  page?: number
  signal?: AbortSignal
}

export interface ImageSearch {
  id: 'commons' | 'openverse'
  label: string
  /** From docs/evidence/idea-image-api-<date>.md. */
  offered: boolean
  evidence: string
  search(query: string, opts: SearchOpts): Promise<ImageHit[]>
}

const SOURCE_LABEL: Record<ImageHit['provider'], string> = { commons: 'Wikimedia Commons', openverse: 'via Openverse' }

/** Title · Author · Source · License, as one sentence. */
export function tasl(hit: ImageHit): { text: string; shareAlike: boolean } {
  const by = hit.creator ? ` by ${hit.creator}` : ''
  return {
    text: `“${hit.title}”${by}, ${SOURCE_LABEL[hit.provider]}, ${hit.license.name}`,
    shareAlike: hit.license.kind === 'by-sa',
  }
}
```

- [ ] **Step 4: Write `commons.ts`**

```ts
/**
 * Wikimedia Commons through the MediaWiki Action API: keyless, `origin=*`
 * for CORS, one request per search. The licence is read PER FILE from
 * `extmetadata` — Commons has no single canonical licence field, and the
 * conventions are community-maintained, which is exactly why anything that
 * does not parse is dropped rather than shown.
 */
import { ALLOWED_LICENSES, type ImageHit, type ImageSearch, type License } from './search'

const ENDPOINT = 'https://commons.wikimedia.org/w/api.php'

/** Best-effort markers of files Commons itself says not to reuse. */
const DO_NOT_USE = /copyright violation|deletion request|files? (with no|missing) (machine-readable )?licen[cs]e|non-free|fair use|possibly unfree/i

export function parseCommonsLicense(short: string | undefined, url: string | undefined): ImageHit['license'] | undefined {
  if (!short) return undefined
  const s = short.trim()
  const kind: License | undefined =
    /^cc0\b/i.test(s) ? 'cc0'
    : /^public domain$/i.test(s) || /^pd\b/i.test(s) ? 'pd'
    : /^cc by-sa\b/i.test(s) ? 'by-sa'
    : /^cc by\b/i.test(s) && !/nc|nd/i.test(s) ? 'by'
    : undefined
  if (!kind) return undefined
  if (kind !== 'pd' && !url) return undefined
  return url ? { kind, name: s, url } : { kind, name: s }
}

const strip = (html: string | undefined) => (html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

interface Page {
  title: string
  imageinfo?: { url: string; thumburl?: string; width: number; height: number; mime?: string; descriptionurl?: string; extmetadata?: Record<string, { value: string }> }[]
  categories?: { title: string }[]
}

export function createCommonsSearch(deps: { fetch?: typeof globalThis.fetch } = {}): ImageSearch {
  const doFetch = deps.fetch ?? globalThis.fetch
  return {
    id: 'commons',
    label: 'Wikimedia Commons',
    offered: true,
    evidence: 'docs/evidence/idea-image-api-YYYY-MM-DD.md', // set from Task 1
    async search(query, opts) {
      const wanted = new Set(opts.licenses.filter((l) => ALLOWED_LICENSES.includes(l)))
      const params = new URLSearchParams({
        action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6', gsrsearch: query,
        gsrlimit: '20', gsroffset: String(((opts.page ?? 1) - 1) * 20), prop: 'imageinfo|categories',
        iiprop: 'url|extmetadata|size|mime', iiurlwidth: '320', cllimit: '50',
      })
      let response: Response
      try {
        response = await doFetch(`${ENDPOINT}?${params}`, { signal: opts.signal ?? null })
      } catch {
        throw new Error('Wikimedia Commons could not be reached from this browser.')
      }
      if (response.status === 429) throw new Error('Wikimedia Commons is rate-limiting this browser. Wait a moment and search again.')
      if (!response.ok) throw new Error(`Wikimedia Commons could not be reached (HTTP ${response.status}).`)
      const json = (await response.json().catch(() => ({}))) as { query?: { pages?: Record<string, Page> } }
      const pages = Object.values(json.query?.pages ?? {})
      const hits: ImageHit[] = []
      for (const p of pages) {
        const info = p.imageinfo?.[0]
        if (!info) continue
        const meta = info.extmetadata ?? {}
        const license = parseCommonsLicense(meta.LicenseShortName?.value, meta.LicenseUrl?.value)
        if (!license || !wanted.has(license.kind)) continue
        if ((p.categories ?? []).some((c) => DO_NOT_USE.test(c.title))) continue
        if (!info.url || !info.width || !info.height) continue
        const creator = strip(meta.Artist?.value)
        hits.push({
          provider: 'commons',
          id: p.title,
          title: strip(meta.ObjectName?.value) || p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
          thumbUrl: info.thumburl ?? info.url,
          fullUrl: info.url,
          width: info.width,
          height: info.height,
          ...(info.mime ? { mediaType: info.mime } : {}),
          license,
          ...(creator ? { creator } : {}),
          sourcePageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
        })
      }
      return hits
    },
  }
}
```

- [ ] **Step 5: Write `openverse.ts`**

```ts
/**
 * Openverse, anonymous tier. Licence and creator arrive as fields, so this
 * adapter is the simpler of the two; it is second in the UI only because the
 * anonymous rate limit is measured, not promised. There is no app token and
 * no relay: if the anonymous tier proves unusable, this adapter is switched
 * off, not proxied.
 */
import { ALLOWED_LICENSES, type ImageHit, type ImageSearch, type License } from './search'

const ENDPOINT = 'https://api.openverse.org/v1/images/'

const KIND: Record<string, License> = { cc0: 'cc0', by: 'by', 'by-sa': 'by-sa', pdm: 'pd' }
const NAME: Record<License, (v: string) => string> = {
  cc0: (v) => `CC0 ${v || '1.0'}`, by: (v) => `CC BY ${v}`.trim(), 'by-sa': (v) => `CC BY-SA ${v}`.trim(), pd: (v) => `Public Domain Mark ${v || '1.0'}`,
}

interface Result {
  id: string; title?: string; url?: string; thumbnail?: string; width?: number; height?: number
  license?: string; license_version?: string; license_url?: string; creator?: string; foreign_landing_url?: string
}

export function createOpenverseSearch(deps: { fetch?: typeof globalThis.fetch } = {}): ImageSearch {
  const doFetch = deps.fetch ?? globalThis.fetch
  return {
    id: 'openverse',
    label: 'Openverse',
    offered: true,
    evidence: 'docs/evidence/idea-image-api-YYYY-MM-DD.md', // set from Task 1
    async search(query, opts) {
      const wanted = opts.licenses.filter((l) => ALLOWED_LICENSES.includes(l))
      const apiLicenses = wanted.map((l) => (l === 'pd' ? 'pdm' : l)).join(',')
      const params = new URLSearchParams({ q: query, license: apiLicenses, page_size: '20', page: String(opts.page ?? 1) })
      let response: Response
      try {
        response = await doFetch(`${ENDPOINT}?${params}`, { signal: opts.signal ?? null })
      } catch {
        throw new Error('Openverse could not be reached from this browser.')
      }
      if (response.status === 429) throw new Error('Openverse is rate-limiting this browser. Wait a moment and search again.')
      if (!response.ok) throw new Error(`Openverse could not be reached (HTTP ${response.status}).`)
      const json = (await response.json().catch(() => ({}))) as { results?: Result[] }
      const hits: ImageHit[] = []
      for (const r of json.results ?? []) {
        const kind = r.license ? KIND[r.license] : undefined
        if (!kind || !wanted.includes(kind) || !r.license_url || !r.url || !r.foreign_landing_url) continue
        hits.push({
          provider: 'openverse',
          id: r.id,
          title: r.title?.trim() || 'Untitled',
          thumbUrl: r.thumbnail ?? r.url,
          fullUrl: r.url,
          width: r.width ?? 0,
          height: r.height ?? 0,
          license: { kind, name: NAME[kind](r.license_version ?? ''), url: r.license_url },
          ...(r.creator ? { creator: r.creator } : {}),
          sourcePageUrl: r.foreign_landing_url,
        })
      }
      return hits
    },
  }
}
```

- [ ] **Step 6: Write `fetch-image.ts`**

```ts
import type { ImageHit } from './search'

/**
 * The bytes of the chosen image, fetched by the browser. A host that refuses
 * a cross-origin read makes the fetch opaque; that is a property of the host,
 * so the message names it and points at the way that always works.
 */
export async function fetchImageBytes(hit: ImageHit, fetch: typeof globalThis.fetch, signal?: AbortSignal): Promise<Uint8Array> {
  const host = new URL(hit.fullUrl).host
  let response: Response
  try {
    response = await fetch(hit.fullUrl, { signal: signal ?? null })
  } catch {
    throw new Error(`${host} does not let this browser fetch it directly. Open the source page, save the image, and add it through Document import instead.`)
  }
  if (!response.ok) throw new Error(`${host} answered HTTP ${response.status} for this image.`)
  return new Uint8Array(await response.arrayBuffer())
}
```

- [ ] **Step 7: Run the tests, set `evidence` and `offered` from Task 1, commit**

Run: `npx vitest run --project unit src/engine/idea/images/ && npm run typecheck`

```bash
git add src/engine/idea/images
git commit -m "feat: Commons and Openverse search behind one port, allowed licences only

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 3: The image edit kind and the insertion step

**Files:**
- Modify: `src/engine/idea/edits.ts`, `src/engine/idea/store.ts`, `src/engine/compile/steps/idea-edits.ts`, `src/engine/compile/steps/index.ts`
- Create: `src/engine/compile/steps/idea-images.ts`
- Test: `src/engine/compile/steps/idea-images.test.ts`, `src/engine/idea/edits.test.ts` (append), `src/engine/idea/store.test.ts` (append)

**Interfaces:**
```ts
// edits.ts additions
export interface ImagePlacement { kind: 'replace' | 'insert-after'; elementId: string }
export interface ImageEdit {
  kind: 'image'; placement: ImagePlacement; assetName: string; width: number; height: number
  alt: string; caption: string; attribution: { text: string; sourcePageUrl: string; licenseName: string; licenseUrl?: string; shareAlike: boolean }
}
export type IdeaEdit = { kind: 'replace'; … } | { kind: 'keep'; … } | ImageEdit
export function imageEditKey(sectionId: string, assetName: string): string     // ideaEditKey(sectionId, 'image', 0, assetName)
// IdeaEditsEvent gains { type: 'image'; key: string; edit: ImageEdit }
// idea-images.ts
export const insertIdeaImages: Step
```

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/idea/edits.test.ts`:
```ts
test('an image edit is stored under its own key and undone like any other', () => {
  const edit = { kind: 'image' as const, placement: { kind: 'insert-after' as const, elementId: 'b2c-blk-2' }, assetName: 'students-abc12345.jpg', width: 800, height: 600, alt: 'Two students at a lab bench', caption: 'Students in a chemistry lab.', attribution: { text: '“Lab” by A, Wikimedia Commons, CC BY 4.0', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Lab.jpg', licenseName: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', shareAlike: false } }
  const key = imageEditKey('s1', edit.assetName)
  let e = reduceEdits(newEdits(), { type: 'image', key, edit })
  expect(e.edits.get(key)).toEqual(edit)
  expect([...sectionsWithEdits(e)]).toEqual(['s1'])
  e = reduceEdits(e, { type: 'undo', key })
  expect(e.edits.size).toBe(0)
})
```
(add `imageEditKey` to that file's import.)

Append to `src/engine/idea/store.test.ts` (slice 2's `toPersisted(header, reviews, edits)` calls gain a fourth argument, `assets`; the compiler names each):
```ts
import type { ImportedAsset } from '../../import/types'

const asset: ImportedAsset = {
  id: 'idea-abc', mediaType: 'image/png', extension: 'png', bytes: new Uint8Array([137, 80, 78, 71]), sha256: 'abc', originPart: 'idea/commons/File:Dot.png', name: 'dot-abc12345.png',
}
const imageEdit = {
  kind: 'image' as const, placement: { kind: 'insert-after' as const, elementId: 'b2c-blk-0' }, assetName: asset.name, width: 1, height: 1,
  alt: 'A dot.', caption: '', attribution: { text: '“Dot” by A, Wikimedia Commons, CC BY 4.0', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Dot.png', licenseName: 'CC BY 4.0', shareAlike: false },
}

test('an image edit and its asset round-trip together', () => {
  const { review, header } = sample()
  const e = reduceEdits(newEdits(), { type: 'image', key: imageEditKey('s1', asset.name), edit: imageEdit })
  const doc = toPersisted(header, new Map([['k', review]]), new Map([['k', e]]), new Map([['k', [asset]]]))
  const back = restore(doc)!
  expect(back.edits.get('k')?.edits.get(imageEditKey('s1', asset.name))).toEqual(imageEdit)
  expect(back.assets.get('k')).toEqual([asset])
})

// A packaged reference to bytes that are not there is a blocking finding at
// export (spec §6.5). Better to lose the edit on restore and say nothing was
// added than to restore a figure that cannot ship.
test('an image edit whose asset is missing or malformed is dropped', () => {
  const { review, header } = sample()
  const e = reduceEdits(newEdits(), { type: 'image', key: imageEditKey('s1', asset.name), edit: imageEdit })
  const noAsset = restore(toPersisted(header, new Map([['k', review]]), new Map([['k', e]]), new Map()))!
  expect(noAsset.edits.get('k')?.edits.size).toBe(0)
  const badBytes = restore({ ...toPersisted(header, new Map(), new Map([['k', e]]), new Map()), assets: new Map([['k', [{ ...asset, bytes: 'not bytes' }]]]) })!
  expect(badBytes.assets.get('k') ?? []).toEqual([])
  expect(badBytes.edits.get('k')?.edits.size).toBe(0)
})

test('a malformed image edit is dropped, a well-formed one kept', () => {
  const back = restore({
    version: 1, header: {}, reviews: new Map(),
    assets: new Map([['k', [asset]]]),
    edits: new Map([['k', { edits: new Map([
      [imageEditKey('s1', asset.name), imageEdit],
      [imageEditKey('s1', 'other.png'), { ...imageEdit, assetName: 'other.png' }],          // no such asset
      [imageEditKey('s1', 'x.png'), { ...imageEdit, placement: { kind: 'sideways', elementId: 'a' } }],
      [imageEditKey('s1', 'y.png'), { ...imageEdit, attribution: 'a string' }],
    ]) }]]),
  })!
  expect([...back.edits.get('k')!.edits.keys()]).toEqual([imageEditKey('s1', asset.name)])
})
```

`src/engine/compile/steps/idea-images.test.ts`:
```ts
import { insertIdeaImages } from './idea-images'
import { applyIdeaEdits, IDEA_CHANGE_NOTE } from './idea-edits'
import { appendAttribution } from './attribution'
import { ensureBlockIds } from './block-ids'
import { resolveAlt } from './alt'
import { createSink } from '../sink'
import { fixtureContext } from '../fixture-context'
import { imageEditKey, type IdeaEdit, type ImageEdit } from '../../idea/edits'

const image: ImageEdit = {
  kind: 'image', placement: { kind: 'insert-after', elementId: 'b2c-blk-0' }, assetName: 'lab-abc12345.jpg', width: 800, height: 600,
  alt: 'Two students at a lab bench', caption: 'Students in a chemistry lab.',
  attribution: { text: '“Lab” by A, Wikimedia Commons, CC BY-SA 4.0', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Lab.jpg', licenseName: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', shareAlike: true },
}

function compile(html: string, edits: ReadonlyMap<string, IdeaEdit>) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const { ctx: base } = fixtureContext('page-section')
  const ctx = { ...base, sectionId: 's1', ideaEdits: edits }
  const sink = createSink('s1')
  ensureBlockIds(doc, ctx, sink)
  insertIdeaImages(doc, ctx, sink)
  resolveAlt(doc, ctx, sink)
  appendAttribution(doc, ctx, sink)
  applyIdeaEdits(doc, ctx, sink)
  return { html: doc.body.innerHTML, ...sink.result() }
}

test('insert-after places a figure with a packaged src, alt, size, and a TASL caption tied by aria-describedby', () => {
  const { html, queue } = compile('<p>First.</p><p>Second.</p>', new Map([[imageEditKey('s1', image.assetName), image]]))
  expect(html).toMatch(/<p id="b2c-blk-0">First\.<\/p><div class="b2c-figure" id="b2c-idea-img-lab-abc12345">/)
  expect(html).toContain('src="$IMS-CC-FILEBASE$/oer2canvas/lab-abc12345.jpg"')
  expect(html).toContain('alt="Two students at a lab bench"')
  expect(html).toContain('width="800" height="600"')
  expect(html).toMatch(/aria-describedby="b2c-cap-b2c-idea-img-lab-abc12345"/)
  expect(html).toContain('<p class="b2c-caption" id="b2c-cap-b2c-idea-img-lab-abc12345">Students in a chemistry lab. “Lab” by A, Wikimedia Commons, CC BY-SA 4.0 (<a href="https://commons.wikimedia.org/wiki/File:Lab.jpg">source</a>)</p>')
  // With alt present and clean, resolveAlt trusts it: nothing is queued.
  expect(queue).toEqual([])
})

test('replace swaps an existing image in place and keeps the surrounding block', () => {
  const html = '<p>Intro.</p><div class="b2c-figure" id="old"><img id="old-img" src="x.png" alt="Old"></div>'
  const edit: ImageEdit = { ...image, placement: { kind: 'replace', elementId: 'old' } }
  const out = compile(html, new Map([[imageEditKey('s1', image.assetName), edit]])).html
  expect(out).not.toContain('x.png')
  expect(out).toContain('lab-abc12345.jpg')
  expect(out.indexOf('Intro.')).toBeLessThan(out.indexOf('lab-abc12345.jpg'))
})

test('a placement target that no longer exists is dropped with a note', () => {
  const edit: ImageEdit = { ...image, placement: { kind: 'insert-after', elementId: 'gone' } }
  const { html, notes } = compile('<p>x</p>', new Map([[imageEditKey('s1', image.assetName), edit]]))
  expect(html).not.toContain('lab-abc12345')
  expect(notes).toContainEqual({ step: 'idea-images', message: '1 added image could not be placed because its target is gone', count: 1 })
})

test('the attribution block gets the change note, an additional-image credit, and the share-alike sentence', () => {
  const { html } = compile('<p>x</p>', new Map([[imageEditKey('s1', image.assetName), image]]))
  expect(html).toContain(IDEA_CHANGE_NOTE)
  expect(html).toMatch(/<p class="b2c-idea-image-credit">Additional image: “Lab” by A, Wikimedia Commons, <a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/">CC BY-SA 4\.0<\/a> \(<a href="https:\/\/commons\.wikimedia\.org\/wiki\/File:Lab\.jpg">source<\/a>\)\. This image is licensed share-alike; adaptations of it must carry the same licence\.<\/p>/)
})

test('compiling twice is idempotent: no second figure, no second credit', () => {
  const edits = new Map([[imageEditKey('s1', image.assetName), image]])
  const once = compile('<p>x</p>', edits).html
  const twice = compile(once, edits).html
  expect(twice.split('lab-abc12345.jpg')).toHaveLength(2)
  expect(twice.split('b2c-idea-image-credit')).toHaveLength(2)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/engine/idea/edits.test.ts src/engine/idea/store.test.ts src/engine/compile/steps/idea-images.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend `edits.ts`**

Add the types above; `imageEditKey = (sectionId, assetName) => ideaEditKey(sectionId, 'image', 0, assetName)`; the `'image'` event case in `reduceEdits`: `edits.set(event.key, event.edit); dismissed.delete(event.key)`.

Then extend `src/engine/idea/store.ts` (slices 1–2):

- `PersistedIdea` gains `assets: ReadonlyMap<string, readonly ImportedAsset[]>` (by chapter key); `toPersisted(header, reviews, edits, assets)` stores it as given; `restore` returns `assets` too.
- `restoreAssets(value): Map<string, ImportedAsset[]>` keeps an entry only when `id`, `mediaType`, `extension`, `sha256`, `originPart`, and `name` are strings and `bytes instanceof Uint8Array` (structured clone preserves it). Nothing is replayed here — an asset is bytes, not a decision — but nothing is trusted either.
- In `restoreEdits`, add the `image` branch after `keep`, guarded by the chapter's restored assets:
  ```ts
  } else if (edit.kind === 'image' && isImageEdit(edit) && assetNames.has(edit.assetName)) {
    e = reduceEdits(e, { type: 'image', key: editKey, edit })
  }
  ```
  where `assetNames` is the set of `name`s restored for that chapter key (so `restoreEdits` now takes the restored assets map, and `restore` calls `restoreAssets` first), and `isImageEdit(v)` checks: `placement` is a record whose `kind` is `'replace' | 'insert-after'` and whose `elementId` is a string; `assetName`, `alt`, `caption` strings; `width`, `height` finite numbers; `attribution` a record with string `text`, `sourcePageUrl`, `licenseName`, boolean `shareAlike`, and `licenseUrl` absent or a string. It returns a freshly built `ImageEdit` from those fields, never the stored object.
- The header comment gains: *"Image edits (slice 5) are references to packaged bytes, so the bytes are stored beside them and an image edit whose bytes did not survive is dropped on restore — a figure that cannot ship must not be restored as if it could."*

- [ ] **Step 4: Write `idea-images.ts`**

```ts
/**
 * Place the images the IDEA phase added. Runs AFTER `ensureBlockIds` — so
 * the ids existing edits were keyed on do not shift — and BEFORE `resolveAlt`,
 * so the new image is judged by the same alt rules as every other image and
 * would be queued if its alt were missing (the dialog does not allow that, but
 * the step does not rely on the dialog).
 *
 * Markup mirrors what `restructureFigures` emits, because that is the shape
 * the allowlist, the gate, and the exporter already accept.
 */
import type { Step } from './index'
import { packagedReference } from '../../../import/assets'
import { parseIdeaEditKey } from '../../idea/edits'

export const insertIdeaImages: Step = (doc, ctx, sink) => {
  const edits = ctx.ideaEdits
  if (!edits) return
  let placed = 0
  let lost = 0
  for (const [key, edit] of edits) {
    if (edit.kind !== 'image') continue
    if (parseIdeaEditKey(key).sectionId !== ctx.sectionId) continue
    const figureId = `b2c-idea-img-${edit.assetName.replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9_-]/g, '-')}`
    if (doc.getElementById(figureId)) continue // idempotent
    const target = doc.getElementById(edit.placement.elementId)
    if (!target) { lost += 1; continue }

    const figure = doc.createElement('div')
    figure.className = 'b2c-figure'
    figure.id = figureId
    const img = doc.createElement('img')
    img.setAttribute('src', packagedReference(edit.assetName))
    img.setAttribute('alt', edit.alt)
    img.setAttribute('width', String(edit.width))
    img.setAttribute('height', String(edit.height))
    const captionId = `b2c-cap-${figureId}`
    img.setAttribute('aria-describedby', captionId)
    figure.appendChild(img)
    const caption = doc.createElement('p')
    caption.className = 'b2c-caption'
    caption.id = captionId
    caption.append(doc.createTextNode(`${edit.caption ? `${edit.caption} ` : ''}${edit.attribution.text} (`))
    const link = doc.createElement('a')
    link.setAttribute('href', edit.attribution.sourcePageUrl)
    link.textContent = 'source'
    caption.append(link, doc.createTextNode(')'))
    figure.appendChild(caption)

    if (edit.placement.kind === 'replace') target.replaceWith(figure)
    else target.after(figure)
    placed += 1
  }
  if (placed > 0) sink.note('idea-images', `${placed} image(s) added by the instructor`, placed)
  if (lost > 0) sink.note('idea-images', `${lost} added image could not be placed because its target is gone`, lost)
}
```

- [ ] **Step 5: Extend `idea-edits.ts`**

In `applyIdeaEdits`, skip `edit.kind === 'image'` in the text loop, and after it add a second loop that, for each image edit of this section whose figure exists in the document (`doc.getElementById(figureId)` with the same derivation), appends to `.b2c-attribution` — once per asset, guarded by an existing `.b2c-idea-image-credit[data-asset="<name>"]`:
```ts
    const p = doc.createElement('p')
    p.className = 'b2c-idea-image-credit'
    p.setAttribute('data-asset', edit.assetName)
    p.append(doc.createTextNode(`Additional image: ${edit.attribution.text.replace(/, [^,]+$/, '')}, `))
    if (edit.attribution.licenseUrl) {
      const a = doc.createElement('a'); a.setAttribute('href', edit.attribution.licenseUrl); a.textContent = edit.attribution.licenseName; p.append(a)
    } else p.append(doc.createTextNode(edit.attribution.licenseName))
    const src = doc.createElement('a'); src.setAttribute('href', edit.attribution.sourcePageUrl); src.textContent = 'source'
    p.append(doc.createTextNode(' ('), src, doc.createTextNode(').'))
    if (edit.attribution.shareAlike) p.append(doc.createTextNode(' This image is licensed share-alike; adaptations of it must carry the same licence.'))
    block.appendChild(p)
    applied += 1
```
The change-note logic already fires when `applied > 0`. (The regex strips the trailing ", <licence>" from the TASL text so the licence is emitted once, as a link.)

`steps/index.ts`: insert `insertIdeaImages` immediately after `ensureBlockIds` with the comment *"IDEA IMAGES AFTER BLOCK IDS, BEFORE ALT — ids must not shift; the new image is judged like any other."*

- [ ] **Step 6: Run, regenerate goldens (no change expected — no image edits in the fixtures), commit**

Run: `npx vitest run --project unit src/engine/ && npm run typecheck`
Expected: PASS; the golden suite is unchanged because the fixtures carry no image edits.

```bash
git add src/engine/idea/edits.ts src/engine/idea/edits.test.ts src/engine/compile/steps
git commit -m "feat: place an instructor-added image with packaged src and TASL credit

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 4: Search UI and the placement dialog

**Files:**
- Create: `src/components/idea/useImageSearch.ts`, `src/components/idea/ImageSearch.tsx`, `src/components/idea/PlaceImageDialog.tsx`
- Modify: `src/components/idea/copy.ts`
- Test: `src/components/idea/ImageSearch.test.tsx`, `src/components/idea/PlaceImageDialog.test.tsx`

**Interfaces:**
```ts
export function useImageSearch(deps?: { providers: readonly ImageSearch[] }): {
  providers: readonly ImageSearch[]; state: { status: 'idle' } | { status: 'searching' } | { status: 'done'; hits: ImageHit[]; provider: 'commons' | 'openverse' } | { status: 'failed'; message: string }
  search: (provider: 'commons' | 'openverse', query: string, licenses: readonly License[]) => void; cancel: () => void
}
export function ImageSearch(props: { initialQuery?: string; onChoose: (hit: ImageHit) => void; sources: readonly { label: string; url: string }[] }): JSX.Element
export interface PlacementOption { placement: ImagePlacement; label: string }
export function PlaceImageDialog(props: {
  hit: ImageHit; options: readonly PlacementOption[]
  onUse: (choice: { placement: ImagePlacement; alt: string; caption: string }) => void; onCancel: () => void
}): JSX.Element
```

- [ ] **Step 1: Copy**

Add to `IDEA_COPY`:
```ts
  imageSearch: {
    find: 'Find an openly licensed photo',
    findAlternative: 'Find an alternative',
    heading: 'Openly licensed images',
    guidance: 'Look for people whose identity is not the subject of the image.',
    query: 'Search for',
    provider: 'Source',
    licenses: 'Licences',
    shareAlikeNote: 'share-alike: the page must carry the same licence for this image',
    search: 'Search',
    searching: 'Searching…',
    cancel: 'Cancel',
    none: 'No images matched. Try a broader search, or one of these collections:',
    more: 'More sources (no search here; add an image through Document import)',
    use: 'Use this image',
    by: (creator: string) => `by ${creator}`,
    notOffered: (label: string) => `${label} could not be reached from a browser when last measured.`,
  },
  placeImage: {
    title: 'Place this image',
    alt: 'Describe this image for a student who cannot see it',
    altHint: "One or two sentences: what it shows and what matters about it. Don't start with 'Image of'.",
    caption: 'Caption (optional)',
    where: 'Where',
    replace: (what: string) => `Replace ${what}`,
    after: (what: string) => `After “${what}”`,
    obligation: (tasl: string) => `This page will credit: ${tasl}`,
    shareAlike: 'This image is CC BY-SA. The page will say that adaptations of the image must carry the same licence.',
    use: 'Use this image',
    fetching: 'Fetching the image…',
    cancel: 'Cancel',
  },
```

- [ ] **Step 2: Write the failing tests**

`src/components/idea/ImageSearch.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImageSearch } from './ImageSearch'
import type { ImageHit, ImageSearch as Port } from '../../engine/idea/images/search'

const hit: ImageHit = { provider: 'commons', id: 'File:A.jpg', title: 'Students', thumbUrl: 'https://t/a', fullUrl: 'https://f/a', width: 10, height: 10, license: { kind: 'by-sa', name: 'CC BY-SA 4.0', url: 'u' }, creator: 'Jane', sourcePageUrl: 'https://s/a' }
const port = (id: 'commons' | 'openverse', hits: ImageHit[]): Port => ({ id, label: id === 'commons' ? 'Wikimedia Commons' : 'Openverse', offered: true, evidence: 'e', search: vi.fn(async () => hits) })

test('searches the chosen source with the chosen licences and shows results with licence badges', async () => {
  const commons = port('commons', [hit])
  const onChoose = vi.fn()
  render(<ImageSearch initialQuery="students" onChoose={onChoose} sources={[]} providers={[commons, port('openverse', [])]} />)
  expect(screen.getByRole('textbox', { name: 'Search for' })).toHaveValue('students')
  fireEvent.click(screen.getByRole('checkbox', { name: /CC BY-SA/ })) // turn off BY-SA
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() => expect(commons.search).toHaveBeenCalledWith('students', expect.objectContaining({ licenses: ['cc0', 'by', 'pd'] })))
  expect(await screen.findByText('Students')).toBeInTheDocument()
  expect(screen.getByText('CC BY-SA 4.0')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Use this image/ }))
  expect(onChoose).toHaveBeenCalledWith(hit)
})

test('zero results shows the guidance and the More sources list', async () => {
  render(<ImageSearch onChoose={vi.fn()} sources={[{ label: 'nappy', url: 'https://nappy.co/' }]} providers={[port('commons', [])]} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Search for' }), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByText(/No images matched/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /nappy/ })).toHaveAttribute('href', 'https://nappy.co/')
})

test('the Framework guidance sits above the results', () => {
  render(<ImageSearch onChoose={vi.fn()} sources={[]} providers={[port('commons', [])]} />)
  expect(screen.getByText('Look for people whose identity is not the subject of the image.')).toBeInTheDocument()
})
```
(`providers` is an extra prop on `ImageSearch` for injection; production omits it and the hook's default providers are used.)

`src/components/idea/PlaceImageDialog.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { PlaceImageDialog } from './PlaceImageDialog'
import type { ImageHit } from '../../engine/idea/images/search'

const hit: ImageHit = { provider: 'commons', id: 'File:A.jpg', title: 'Students at a bench', thumbUrl: 't', fullUrl: 'f', width: 10, height: 10, license: { kind: 'by-sa', name: 'CC BY-SA 4.0', url: 'u' }, creator: 'Jane', sourcePageUrl: 's' }
const options = [
  { placement: { kind: 'insert-after' as const, elementId: 'b2c-blk-0' }, label: 'After “Intro paragraph…”' },
  { placement: { kind: 'replace' as const, elementId: 'b2c-fig-0' }, label: 'Replace Figure 1' },
]

test('requires alt text, refuses a filename, and states the credit and the share-alike obligation before Use', () => {
  const onUse = vi.fn()
  render(<PlaceImageDialog hit={hit} options={options} onUse={onUse} onCancel={vi.fn()} />)
  expect(screen.getByRole('dialog', { name: 'Place this image' })).toBeInTheDocument()
  expect(screen.getByText(/This page will credit: “Students at a bench” by Jane, Wikimedia Commons, CC BY-SA 4.0/)).toBeInTheDocument()
  expect(screen.getByText(/adaptations of the image must carry the same licence/)).toBeInTheDocument()
  const alt = screen.getByRole('textbox', { name: /Describe this image/ })
  fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
  expect(onUse).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Not saved: the description is empty.')
  fireEvent.change(alt, { target: { value: 'students.jpg' } })
  fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/file name/)
  fireEvent.change(alt, { target: { value: 'Two students share a microscope at a lab bench.' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Where' }), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
  expect(onUse).toHaveBeenCalledWith({ placement: { kind: 'replace', elementId: 'b2c-fig-0' }, alt: 'Two students share a microscope at a lab bench.', caption: '' })
})

test('the caption is optional and passed through', () => {
  const onUse = vi.fn()
  render(<PlaceImageDialog hit={hit} options={options} onUse={onUse} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox', { name: /Describe this image/ }), { target: { value: 'A bench with two students.' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Caption (optional)' }), { target: { value: 'Lab partners.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
  expect(onUse.mock.calls[0]![0].caption).toBe('Lab partners.')
})
```

- [ ] **Step 3: Write the hook**

`src/components/idea/useImageSearch.ts`:
```ts
import { useCallback, useRef, useState } from 'react'
import { createCommonsSearch } from '../../engine/idea/images/commons'
import { createOpenverseSearch } from '../../engine/idea/images/openverse'
import type { ImageHit, ImageSearch, License } from '../../engine/idea/images/search'

export type SearchState =
  | { status: 'idle' } | { status: 'searching' }
  | { status: 'done'; hits: ImageHit[]; provider: 'commons' | 'openverse' }
  | { status: 'failed'; message: string }

const DEFAULT: readonly ImageSearch[] = [createCommonsSearch(), createOpenverseSearch()]

export function useImageSearch(deps: { providers?: readonly ImageSearch[] } = {}) {
  const providers = deps.providers ?? DEFAULT
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const inflight = useRef<AbortController | undefined>(undefined)
  const search = useCallback((providerId: 'commons' | 'openverse', query: string, licenses: readonly License[]) => {
    const provider = providers.find((p) => p.id === providerId)
    if (!provider || !query.trim()) return
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    setState({ status: 'searching' })
    provider.search(query.trim(), { licenses, signal: controller.signal })
      .then((hits) => { if (!controller.signal.aborted) setState({ status: 'done', hits, provider: providerId }) })
      .catch((e: unknown) => { if (!controller.signal.aborted) setState({ status: 'failed', message: e instanceof Error ? e.message : String(e) }) })
  }, [providers])
  const cancel = useCallback(() => { inflight.current?.abort(); setState({ status: 'idle' }) }, [])
  return { providers, state, search, cancel }
}
```

- [ ] **Step 4: Write `ImageSearch.tsx`**

```tsx
import { useId, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { ALLOWED_LICENSES, LICENSE_LABEL, type ImageHit, type ImageSearch as Port, type License } from '../../engine/idea/images/search'
import { useImageSearch } from './useImageSearch'
import { IDEA_COPY } from './copy'

const TARGET = 'min-h-9 min-w-9'
const FIELD = 'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'

export function ImageSearch({ initialQuery = '', onChoose, sources, providers }: {
  initialQuery?: string
  onChoose: (hit: ImageHit) => void
  sources: readonly { label: string; url: string }[]
  /** Test seam. */
  providers?: readonly Port[]
}) {
  const id = useId()
  const c = IDEA_COPY.imageSearch
  const { providers: ports, state, search, cancel } = useImageSearch(providers ? { providers } : {})
  const offered = ports.filter((p) => p.offered)
  const [provider, setProvider] = useState<'commons' | 'openverse'>(offered[0]?.id ?? 'commons')
  const [query, setQuery] = useState(initialQuery)
  const [licenses, setLicenses] = useState<Set<License>>(new Set(ALLOWED_LICENSES))
  const toggle = (l: License) => setLicenses((s) => { const n = new Set(s); if (n.has(l)) n.delete(l); else n.add(l); return n })

  return (
    <div className="flex flex-col gap-3 rounded-md border border-neutral-300 p-3 dark:border-neutral-700" role="region" aria-label={c.heading}>
      <p className="m-0 text-sm font-semibold">{c.heading}</p>
      <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{c.guidance}</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); search(provider, query, [...ALLOWED_LICENSES].filter((l) => licenses.has(l))) }}>
        <label className="flex flex-col gap-1 text-sm"><span>{c.query}</span><input className={`${FIELD} ${TARGET} w-64`} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm"><span>{c.provider}</span>
          <select className={`${FIELD} ${TARGET}`} value={provider} onChange={(e) => setProvider(e.target.value as 'commons' | 'openverse')}>
            {ports.map((p) => <option key={p.id} value={p.id} disabled={!p.offered}>{p.label}</option>)}
          </select>
        </label>
        <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0"><legend className="text-sm">{c.licenses}</legend>
          {ALLOWED_LICENSES.map((l) => (
            <label key={l} className={`${TARGET} flex items-center gap-1 text-sm`}>
              <input type="checkbox" checked={licenses.has(l)} onChange={() => toggle(l)} />{LICENSE_LABEL[l]}{l === 'by-sa' && <span className="sr-only"> ({c.shareAlikeNote})</span>}
            </label>
          ))}
        </fieldset>
        {state.status === 'searching'
          ? <button type="button" className={`${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`} onClick={cancel}>{c.cancel}</button>
          : <button type="submit" className={`${TARGET} rounded-md border border-brand-700 bg-brand-700 px-3 text-sm text-white`}>{c.search}</button>}
      </form>
      {ports.filter((p) => !p.offered).map((p) => <p key={p.id} className="m-0 text-xs">{c.notOffered(p.label)}</p>)}
      {state.status === 'searching' && <p role="status" className="m-0 text-sm">{c.searching}</p>}
      {state.status === 'failed' && <p role="alert" className="m-0 text-sm">{state.message}</p>}
      {state.status === 'done' && state.hits.length === 0 && (
        <div><p className="m-0 text-sm">{c.none}</p><MoreSources sources={sources} /></div>
      )}
      {state.status === 'done' && state.hits.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 md:grid-cols-4">
          {state.hits.map((h) => (
            <li key={`${h.provider}:${h.id}`} className="flex flex-col gap-1 rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700">
              <img src={h.thumbUrl} alt="" width={160} height={Math.round((160 * h.height) / Math.max(1, h.width))} className="h-auto w-full object-cover" loading="lazy" />
              <span className="font-semibold">{h.title}</span>
              {h.creator && <span>{c.by(h.creator)}</span>}
              <span className="rounded border border-current px-1">{h.license.name}</span>
              <a href={h.sourcePageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">source<ExternalLink className="size-3" aria-hidden="true" /><span className="sr-only">({IDEA_COPY.opensNewTab})</span></a>
              <button type="button" className={`${TARGET} rounded-md border border-brand-700 bg-brand-700 px-2 text-white`} onClick={() => onChoose(h)}>{c.use}<span className="sr-only">: {h.title}</span></button>
            </li>
          ))}
        </ul>
      )}
      {state.status !== 'done' && <MoreSources sources={sources} />}
      <span id={id} hidden />
    </div>
  )
}

function MoreSources({ sources }: { sources: readonly { label: string; url: string }[] }) {
  if (sources.length === 0) return null
  return (
    <details><summary className="cursor-pointer text-sm">{IDEA_COPY.imageSearch.more}</summary>
      <ul className="m-0 list-none p-0 text-sm">{sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">{s.label}</a></li>)}</ul>
    </details>
  )
}
```
The thumbnail `alt=""` is deliberate: the title and creator are the accessible text beside it, and a duplicated title would be read twice.

- [ ] **Step 5: Write `PlaceImageDialog.tsx`**

```tsx
import { useEffect, useId, useRef, useState } from 'react'
import type { ImageHit } from '../../engine/idea/images/search'
import { tasl } from '../../engine/idea/images/search'
import type { ImagePlacement } from '../../engine/idea/edits'
import { validateAnswer } from '../../engine/compile/answers'
import { IDEA_COPY } from './copy'

const TARGET = 'min-h-9 min-w-9'
const FIELD = 'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'

export interface PlacementOption { placement: ImagePlacement; label: string }

export function PlaceImageDialog({ hit, options, onUse, onCancel }: {
  hit: ImageHit
  options: readonly PlacementOption[]
  onUse: (choice: { placement: ImagePlacement; alt: string; caption: string }) => void
  onCancel: () => void
}) {
  const id = useId()
  const c = IDEA_COPY.placeImage
  const [alt, setAlt] = useState('')
  const [caption, setCaption] = useState('')
  const [index, setIndex] = useState(0)
  const [refusal, setRefusal] = useState('')
  const first = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const credit = tasl(hit)

  const submit = () => {
    // THE SAME RULES THE QUEUE'S SAVE USES. `validateAnswer` is layer 1 of the
    // alt gate; an image placed here is judged exactly as one answered there.
    const verdict = validateAnswer({ type: 'alt', text: alt })
    if (verdict.refused) { setRefusal(verdict.message); return }
    onUse({ placement: options[index]!.placement, alt: alt.trim(), caption: caption.trim() })
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
      <h5 id={`${id}-t`} className="m-0 text-base font-semibold">{c.title}</h5>
      <div className="flex gap-3">
        <img src={hit.thumbUrl} alt="" width={120} height={Math.round((120 * hit.height) / Math.max(1, hit.width))} className="h-auto w-30" />
        <div className="text-sm"><p className="m-0 font-semibold">{hit.title}</p>{hit.creator && <p className="m-0">{IDEA_COPY.imageSearch.by(hit.creator)}</p>}<p className="m-0">{hit.license.name}</p></div>
      </div>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-alt`}>{c.alt}</label>
      <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{c.altHint}</p>
      <textarea id={`${id}-alt`} ref={first} rows={2} className={FIELD} value={alt} onChange={(e) => { setAlt(e.target.value); setRefusal('') }} />
      <label className="flex flex-col gap-1 text-sm"><span>{c.caption}</span><input className={`${FIELD} ${TARGET}`} value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-sm"><span>{c.where}</span>
        <select className={`${FIELD} ${TARGET}`} value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {options.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
        </select>
      </label>
      <p className="m-0 text-sm">{c.obligation(credit.text)}</p>
      {credit.shareAlike && <p className="m-0 text-sm">{c.shareAlike}</p>}
      {refusal && <p role="alert" className="m-0 text-sm">{refusal}</p>}
      <div className="flex gap-2">
        <button type="button" className={`${TARGET} rounded-md border border-brand-700 bg-brand-700 px-3 text-sm text-white`} onClick={submit}>{c.use}</button>
        <button type="button" className={`${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`} onClick={onCancel}>{c.cancel}</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run, typecheck, commit**

Run: `npx vitest run --project unit src/components/idea/ImageSearch.test.tsx src/components/idea/PlaceImageDialog.test.tsx && npm run typecheck`

```bash
git add src/components/idea/useImageSearch.ts src/components/idea/ImageSearch.tsx src/components/idea/PlaceImageDialog.tsx src/components/idea/*.test.tsx src/components/idea/copy.ts
git commit -m "feat: search openly licensed images and place one with alt text checked like the queue's

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 5: Wire into 7.1, package the asset, and hand off to compile

**Files:**
- Modify: `src/components/idea/CategoryPanel.tsx`, `src/components/idea/IdeaScreen.tsx`, `src/components/idea/useIdeaReviews.ts`, `src/App.tsx`
- Create: `src/components/idea/useAddImage.ts`
- Test: `src/components/idea/useAddImage.test.ts`, `src/components/idea/useIdeaReviews.test.ts` (append), `src/components/idea/IdeaScreen.test.tsx` (append)

**Interfaces:**
```ts
export interface AddImageRequest { chapterKey: string; sectionId: string; hit: ImageHit; placement: ImagePlacement; alt: string; caption: string }
export function useAddImage(args: {
  onAsset: (chapterKey: string, asset: ImportedAsset) => void            // App appends to chapter.assets
  onEdit: (chapterKey: string, key: string, edit: ImageEdit) => void      // App dispatches the image edit
  deps?: { fetch?: typeof globalThis.fetch }
}): { add: (r: AddImageRequest) => Promise<void>; busy: boolean; error: string }
```

- [ ] **Step 1: Write the failing hook test**

`src/components/idea/useAddImage.test.ts`:
```ts
import { act, renderHook } from '@testing-library/react'
import { useAddImage } from './useAddImage'
import type { ImageHit } from '../../engine/idea/images/search'

// A 1x1 PNG. `prepareAssets` sniffs the signature and reads the size from IHDR.
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3, 253, 99, 38, 229, 120, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
const hit: ImageHit = { provider: 'commons', id: 'File:Dot.png', title: 'Dot', thumbUrl: 't', fullUrl: 'https://upload.wikimedia.org/dot.png', width: 1, height: 1, mediaType: 'image/png', license: { kind: 'by', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, creator: 'A', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Dot.png' }

test('fetches, prepares, reports the asset, then the edit keyed by the asset name', async () => {
  const fetch = vi.fn(async () => new Response(PNG, { status: 200 }))
  const onAsset = vi.fn()
  const onEdit = vi.fn()
  const { result } = renderHook(() => useAddImage({ onAsset, onEdit, deps: { fetch } }))
  await act(() => result.current.add({ chapterKey: 'ch', sectionId: 's1', hit, placement: { kind: 'insert-after', elementId: 'b2c-blk-0' }, alt: 'A single dot.', caption: '' }))
  expect(onAsset).toHaveBeenCalledTimes(1)
  const [ck, asset] = onAsset.mock.calls[0]!
  expect(ck).toBe('ch')
  expect(asset).toMatchObject({ mediaType: 'image/png', extension: 'png' })
  expect(asset.name).toMatch(/\.png$/)
  expect(asset.bytes.byteLength).toBe(PNG.byteLength)
  expect(onEdit).toHaveBeenCalledTimes(1)
  const [, key, edit] = onEdit.mock.calls[0]!
  expect(key).toBe(`s1::image::0::${asset.name}`)
  expect(edit).toMatchObject({ kind: 'image', assetName: asset.name, width: 1, height: 1, alt: 'A single dot.', attribution: { licenseName: 'CC BY 4.0', shareAlike: false, sourcePageUrl: hit.sourcePageUrl } })
  expect(onAsset.mock.invocationCallOrder[0]!).toBeLessThan(onEdit.mock.invocationCallOrder[0]!)
})

test('an unfetchable image reports the host message and adds nothing', async () => {
  const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
  const onAsset = vi.fn()
  const { result } = renderHook(() => useAddImage({ onAsset, onEdit: vi.fn(), deps: { fetch } }))
  await act(() => result.current.add({ chapterKey: 'ch', sectionId: 's1', hit, placement: { kind: 'insert-after', elementId: 'x' }, alt: 'A dot.', caption: '' }))
  expect(result.current.error).toMatch(/upload\.wikimedia\.org/)
  expect(onAsset).not.toHaveBeenCalled()
})

test('a byte stream that is not a raster is refused', async () => {
  const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }))
  const onAsset = vi.fn()
  const { result } = renderHook(() => useAddImage({ onAsset, onEdit: vi.fn(), deps: { fetch } }))
  await act(() => result.current.add({ chapterKey: 'ch', sectionId: 's1', hit, placement: { kind: 'insert-after', elementId: 'x' }, alt: 'A dot.', caption: '' }))
  expect(result.current.error).toMatch(/not an image this app can package/)
  expect(onAsset).not.toHaveBeenCalled()
})
```

Append to `src/components/idea/useIdeaReviews.test.ts` (reuse the `asset` fixture shape from `store.test.ts`):
```ts
test('an added asset is kept per chapter, saved with the document, restored, and forgotten with it', async () => {
  const { map, store } = memoryStore()
  const { result } = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(result.current.loaded).toBe(true))
  expect(result.current.assetsFor('ch1')).toEqual([])
  act(() => result.current.addAsset('ch1', asset))
  expect(result.current.assetsFor('ch1')).toEqual([asset])
  await waitFor(() => expect(map.has(IDEA_STORAGE_KEY)).toBe(true), { timeout: SAVE_DELAY_MS * 5 })
  expect(restore(map.get(IDEA_STORAGE_KEY))!.assets.get('ch1')).toEqual([asset])
  const again = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(again.result.current.assetsFor('ch1')).toEqual([asset]))
  act(() => again.result.current.forgetAll())
  expect(again.result.current.assetsFor('ch1')).toEqual([])
})

test('adding an asset with a name already present replaces it rather than duplicating', () => {
  const { result } = renderHook(() => useIdeaReviews())
  act(() => result.current.addAsset('ch1', asset))
  act(() => result.current.addAsset('ch1', { ...asset, sha256: 'def' }))
  expect(result.current.assetsFor('ch1')).toHaveLength(1)
  expect(result.current.assetsFor('ch1')[0]!.sha256).toBe('def')
})
```

In `useIdeaReviews.ts`: `State` gains `assets: ReadonlyMap<string, readonly ImportedAsset[]>` (empty in `empty()`, merged from `found.assets` on load the way `edits` are, written through `toPersisted(header, reviews, edits, assets)`); add
```ts
  const assetsFor = useCallback((key: string) => state.assets.get(key) ?? [], [state.assets])

  const addAsset = useCallback((key: string, asset: ImportedAsset) => {
    dirty.current = true
    setState((s) => {
      const assets = new Map(s.assets)
      assets.set(key, [...(s.assets.get(key) ?? []).filter((a) => a.name !== asset.name), asset])
      return { ...s, assets }
    })
  }, [])
```
and return both. `forgetAll` needs nothing: `empty()` clears them.

- [ ] **Step 2: Write the hook**

`src/components/idea/useAddImage.ts`:
```ts
/**
 * Choose → fetch → prepare → asset → edit. The asset is reported BEFORE the
 * edit, so that by the time the recompile emits the packaged reference, the
 * chapter's asset list can resolve it for the preview and the exporter.
 */
import { useCallback, useState } from 'react'
import { prepareAssets } from '../../import/assets'
import type { ImportedAsset } from '../../import/types'
import { fetchImageBytes } from '../../engine/idea/images/fetch-image'
import { tasl, type ImageHit } from '../../engine/idea/images/search'
import { imageEditKey, type ImageEdit, type ImagePlacement } from '../../engine/idea/edits'

export interface AddImageRequest {
  chapterKey: string
  sectionId: string
  hit: ImageHit
  placement: ImagePlacement
  alt: string
  caption: string
}

export function useAddImage({ onAsset, onEdit, deps = {} }: {
  onAsset: (chapterKey: string, asset: ImportedAsset) => void
  onEdit: (chapterKey: string, key: string, edit: ImageEdit) => void
  deps?: { fetch?: typeof globalThis.fetch }
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const add = useCallback(async (r: AddImageRequest) => {
    setBusy(true)
    setError('')
    try {
      const bytes = await fetchImageBytes(r.hit, deps.fetch ?? globalThis.fetch)
      const originPart = `idea/${r.hit.provider}/${r.hit.id}`
      const prepared = (await prepareAssets([{ id: 1, mediaType: r.hit.mediaType ?? 'application/octet-stream', originPart, data: bytes }])).get(1)
      if (!prepared || 'rejected' in prepared) {
        const why = prepared && 'rejected' in prepared ? prepared.rejected : 'unavailable'
        throw new Error(why === 'unsupported-type' ? 'That file is not an image this app can package (PNG, JPEG, GIF, WebP).' : why === 'too-large' ? 'That image is larger than the cartridge budget allows.' : 'That image could not be prepared.')
      }
      const asset: ImportedAsset = {
        id: `idea-${prepared.sha256.slice(0, 12)}`, mediaType: prepared.mediaType, extension: prepared.extension,
        bytes: prepared.bytes, sha256: prepared.sha256, originPart, name: prepared.name,
      }
      onAsset(r.chapterKey, asset)
      const credit = tasl(r.hit)
      const edit: ImageEdit = {
        kind: 'image', placement: r.placement, assetName: prepared.name, width: prepared.width, height: prepared.height,
        alt: r.alt, caption: r.caption,
        attribution: { text: credit.text, sourcePageUrl: r.hit.sourcePageUrl, licenseName: r.hit.license.name, ...(r.hit.license.url ? { licenseUrl: r.hit.license.url } : {}), shareAlike: credit.shareAlike },
      }
      onEdit(r.chapterKey, imageEditKey(r.sectionId, prepared.name), edit)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [onAsset, onEdit, deps.fetch])
  return { add, busy, error }
}
```

- [ ] **Step 3: Panel, screen, app**

`CategoryPanel` (7.1 only): props `onFindImage?: (initialQuery: string) => void`. The inventory zone gets a *Find an openly licensed photo* button after the summary row, and each image row a *Find an alternative* button (query = the row's `description` column). Both call `onFindImage`.

`IdeaScreen`: state `imageSearch: { query: string } | undefined` and `placing: ImageHit | undefined`. When `imageSearch` is set, render `<ImageSearch initialQuery … onChoose={setPlacing} sources={categoryById('7.1').resources} />` under the 7.1 panel; when `placing` is set, render `<PlaceImageDialog hit options onUse onCancel />` where `options` come from the current section: for each `imageInventory` row → `{ placement: { kind: 'replace', elementId: row.elementId }, label: IDEA_COPY.placeImage.replace(row.caption ?? row.alt ?? row.src) }`, then for each `blockElements` id in the section → `{ placement: { kind: 'insert-after', elementId }, label: IDEA_COPY.placeImage.after(text.slice(0, 50)) }`. `onUse` calls the `onAddImage` prop (`(req: AddImageRequest) => Promise<void>`) with the current chapter key and the render section's id, then clears `placing`. `busy`/`error` from the hook are rendered in the dialog area.

`App`:
```ts
  const addImage = useAddImage({
    onAsset: (chapterKey, asset) => {
      // Both: the live chapter for this session's preview and export, and the
      // document so the bytes are there after a reload.
      ideaReviews.addAsset(chapterKey, asset)
      setPrepared((all) => all.map((c) => reviewKeyOf(c.chapter) === chapterKey
        ? { ...c, chapter: { ...c.chapter, assets: [...(c.chapter.assets ?? []).filter((a) => a.name !== asset.name), asset] } }
        : c))
    },
    onEdit: (chapterKey, key, edit) => ideaReviews.dispatchEdit(chapterKey, { type: 'image', key, edit }),
  })
```
and pass `onAddImage={addImage.add} addImageBusy={addImage.busy} addImageError={addImage.error}` to `IdeaScreen`. `useIdeaRecompile` recompiles the section because its edited-section set changed; the rebuilt section's gate audits the new figure; `collectPackagedAssets` finds the asset by `name` at export.

The initial compile has to see persisted assets too, or a re-prepared chapter would compile its persisted image edit (slice 2 passes it in) against a chapter with no such asset. In `compileForReview`, before `compileAndAuditChapter`, merge them into the chapter:
```ts
    const persisted = ideaReviews.assetsFor(reviewKeyOf(ch))
    const withAssets: Chapter = persisted.length === 0 ? ch : {
      ...ch,
      assets: [...(ch.assets ?? []).filter((a) => !persisted.some((p) => p.name === a.name)), ...persisted],
    }
```
and compile `withAssets` in place of `ch` (also `setChapter(withAssets)`). A chapter that never had an IDEA image is untouched — `assets` stays absent for catalog sources.

Append to `IdeaScreen.test.tsx` (slice 2's `base` object, extended by slice 4 with `llm: llmStub`, is in scope):
```tsx
test('7.1 offers Find an openly licensed photo, which opens the search region', () => {
  const c = withHtml('4: Nutrition', '<p id="b2c-blk-0">x</p>')
  render(<IdeaScreen {...base} chapters={[c]} onAddImage={vi.fn()} addImageBusy={false} addImageError="" />)
  fireEvent.click(screen.getByRole('button', { name: /^7\.1 / }))
  fireEvent.click(screen.getByRole('button', { name: 'Find an openly licensed photo' }))
  expect(screen.getByRole('region', { name: 'Openly licensed images' })).toBeInTheDocument()
})
```
Add `onAddImage: vi.fn(), addImageBusy: false, addImageError: ''` to `base`, and `onAddImage: () => {}, addImageBusy: false, addImageError: ''` to the browser test's `props`, so every earlier render keeps compiling.

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npx vitest run --project unit && npx vitest run --project browser src/components/idea/`
Expected: green. The a11y browser test renders the search region and the dialog closed; add one assertion that opens the dialog (`fireEvent.click` the first "Use this image" after a stubbed search) and re-runs axe, using a `providers` stub as in `ImageSearch.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/idea src/engine/idea/store.ts src/engine/idea/store.test.ts src/App.tsx
git commit -m "feat: add a chosen image to the chapter's assets and place it through compile

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 6: Docs and acceptance

**Files:**
- Modify: `PRIVACY.md`, `README.md`, `docs/IDEA.md`, `docs/RELEASE-ACCEPTANCE.md`, `THIRD-PARTY-NOTICES.md`, `src/docs-claims.test.ts`

- [ ] **Step 1: Obligation test**

Add: `['idea image search disclosure', /(commons\.wikimedia\.org|Wikimedia Commons)[^.\n]*(Openverse)/i],`

- [ ] **Step 2: PRIVACY.md**

Append:
```markdown
The IDEA review's image search sends **only the words you type** from your browser to Wikimedia
Commons (`commons.wikimedia.org`) and to Openverse (`api.openverse.org`), without any account or
key, and only when you press Search. When you choose an image, your browser fetches that image's
bytes from the host the result points at (for Commons, `upload.wikimedia.org`; for Openverse,
the original site) so it can be packaged into your cartridge; a host that refuses that fetch is
reported, and the image is not added. Nothing about your chapter is sent to either service.
```

- [ ] **Step 3: README, IDEA.md, notices, acceptance**

README — after the slice-4 paragraph:
```markdown
Where a section would benefit from a photo, the illustrations category can search Wikimedia
Commons and Openverse for CC0, CC BY, CC BY-SA, and public-domain images only (anything else is
never shown), fetch the chosen image in the browser, and place it in the page with the same alt
rules the review queue enforces. The caption and the page's Source-and-license block carry
Title · Author · Source · License, and a CC BY-SA image adds the share-alike sentence. Only the
search words leave the browser; no key or account is involved.
```
`docs/IDEA.md` — heading "Slices 1–5"; move the image-search bullet into the shipped list and add: *"Providers offered are those a browser origin was measured to reach (`docs/evidence/idea-image-api-<date>.md`); Unsplash and Pexels are not integrated (non-CC licences; Unsplash's hotlink rule conflicts with packaging)."* Under **Storage**, add: *"An image added through IDEA is stored with its bytes in the same document as the reviews and edits, so it survives a reload; an image edit whose bytes are missing is dropped on restore rather than exported as a broken reference. Forget all IDEA reviews removes the bytes too."* PRIVACY.md's IDEA storage paragraph gains the same sentence about image bytes.
`THIRD-PARTY-NOTICES.md` — one paragraph: *"Images added through the IDEA review are fetched from Wikimedia Commons or from sources indexed by Openverse under the licence each result declares (CC0, CC BY, CC BY-SA, or public domain). Each such image carries its own attribution in the page; this project reproduces the licence metadata those services publish and does not relicense the images."*
`docs/RELEASE-ACCEPTANCE.md`:
```markdown
## 8. IDEA review — slice 5

1. Prepare an OpenStax chapter. IDEA → 7.1 → Find an openly licensed photo. Search "students
   laboratory" on Wikimedia Commons with all four licences on. Results show titles, creators,
   and licence badges; none says NC or ND.
2. Use one. The dialog names the credit; leave alt empty and press Use: "Not saved: the
   description is empty." Type a real description; choose "After …" a paragraph; Use.
3. The chapter render beside the panels shows the image within a few seconds with the caption
   ending in "(source)". The Source-and-license block ends with "Additional image: …" and, for a
   BY-SA image, the share-alike sentence.
4. **Reload the tab** and prepare the same chapter: the image is in the render and in Applied
   without pressing anything. DevTools → Application → IndexedDB → oer2canvas → kv →
   `idea.reviews` carries the bytes.
5. Export the cartridge; unzip: `web_resources/oer2canvas/<name>` exists and the page's `<img>`
   references it with the alt text typed.
6. Switch to Openverse, search, choose a Flickr-hosted result: if the host refuses the fetch,
   the dialog says which host and points to Document import; nothing is added.
7. Network tab: requests only to commons.wikimedia.org, upload.wikimedia.org, api.openverse.org,
   and the chosen image host. None to `/relay`.
8. *Forget all IDEA reviews* → confirm; the image leaves the render after the recompile, and the
   next export carries neither the figure nor the credit.
```

- [ ] **Step 4: Full suite and commit**

Run: `npm run typecheck && npm test`

```bash
git add PRIVACY.md README.md docs/IDEA.md docs/RELEASE-ACCEPTANCE.md THIRD-PARTY-NOTICES.md src/docs-claims.test.ts
git commit -m "docs: disclose the IDEA image search and packaging path

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (§8.5):** API spike → Task 1; Commons first, per-file licence parsing, do-not-use categories dropped, unparseable dropped; Openverse anonymous with licence filter; Unsplash/Pexels excluded; More-sources links (§6.1) → Tasks 2, 4; two entry points, licence tri-state (four-state here, adding PD explicitly), results grid, placement picker, Framework guidance line, no demographic ranking (§6.2) → Tasks 4–5; image edit kind, packaged `<figure>` markup, asset fetched into the cartridge (§6.3) → Tasks 3, 5; TASL in caption and Source-and-license block, share-alike sentence, obligation stated before Use (§6.4) → Tasks 3–4; failure modes (§6.5) → Tasks 2, 4, 5; §6.3's "enters the accessibility queue" replaced by alt-at-placement checked with `validateAnswer` — recorded in the header and to be mirrored into the spec.

**Alignment with the revised slices 1–2 (2026-09-11):** image edits dispatch through `useIdeaReviews.dispatchEdit` and persist in the IDEA document; their bytes persist beside them under `assets` and are merged into the chapter before its initial compile (Task 5), with restore dropping an image edit whose bytes are gone (Task 3); the placed figure appears in `IdeaChapterRender`; every `IdeaScreen` render extends the shared `base` / `props` objects.

**Placeholder scan:** `evidence: 'docs/evidence/idea-image-api-YYYY-MM-DD.md'` is an explicit substitute-from-Task-1 instruction, like slice 4's. No TBDs.

**Type consistency:** `ImageHit`, `License`, `tasl` in Tasks 2–5; `ImageEdit`/`ImagePlacement`/`imageEditKey` in Tasks 3–5; `AddImageRequest` in Task 5 hook and screen; `validateAnswer` reused from `engine/compile/answers`; `prepareAssets` called with the `{ id, mediaType, originPart, data }` shape it declares; `ImportedAsset` fields as declared in `src/import/types.ts`.
