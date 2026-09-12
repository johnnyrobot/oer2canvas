/**
 * Wikimedia Commons through the MediaWiki Action API: keyless, `origin=*`
 * for CORS, one request per search. The licence is read PER FILE from
 * `extmetadata` — Commons has no single canonical licence field, and the
 * conventions are community-maintained, which is exactly why anything that
 * does not parse is dropped rather than shown.
 */
import { ALLOWED_LICENSES, type ImageHit, type ImageSearch, type License } from './search'

const ENDPOINT = 'https://commons.wikimedia.org/w/api.php'
const PAGE_SIZE = 20

/** Best-effort markers of files Commons itself says not to reuse. */
const DO_NOT_USE = /copyright violation|deletion request|files? (with no|missing) (machine-readable )?licen[cs]e|non-free|fair use|possibly unfree/i

export function parseCommonsLicense(short: string | undefined, url: string | undefined): ImageHit['license'] | undefined {
  if (!short) return undefined
  const s = short.trim()
  const kind: License | undefined =
    /^cc0\b/i.test(s) ? 'cc0'
    : /^public domain$/i.test(s) || /^pd\b/i.test(s) ? 'pd'
    : /^cc by-sa\b/i.test(s) ? 'by-sa'
    : /^cc by\b/i.test(s) && !/\b(nc|nd)\b/i.test(s) ? 'by'
    : undefined
  if (!kind) return undefined
  // A public-domain marker has no licence deed to link; every CC licence does.
  if (kind !== 'pd' && !url) return undefined
  return url ? { kind, name: s, url } : { kind, name: s }
}

const strip = (html: string | undefined) => (html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

interface Page {
  title: string
  imageinfo?: {
    url: string; thumburl?: string; width: number; height: number; mime?: string; descriptionurl?: string
    extmetadata?: Record<string, { value: string }>
  }[]
  categories?: { title: string }[]
}

export function createCommonsSearch(deps: { fetch?: typeof globalThis.fetch } = {}): ImageSearch {
  const doFetch = deps.fetch ?? globalThis.fetch
  return {
    id: 'commons',
    label: 'Wikimedia Commons',
    offered: true,
    evidence: 'docs/evidence/idea-image-api-2026-09-12.md',
    async search(query, opts) {
      const wanted = new Set(opts.licenses.filter((l) => ALLOWED_LICENSES.includes(l)))
      const params = new URLSearchParams({
        action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6', gsrsearch: query,
        gsrlimit: String(PAGE_SIZE), gsroffset: String(((opts.page ?? 1) - 1) * PAGE_SIZE), prop: 'imageinfo|categories',
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
      const hits: ImageHit[] = []
      for (const p of Object.values(json.query?.pages ?? {})) {
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
