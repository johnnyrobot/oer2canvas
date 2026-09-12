/**
 * Openverse, anonymous tier. Licence and creator arrive as fields, so this
 * adapter is the simpler of the two; it is NOT OFFERED today because the
 * anonymous tier is measured, not promised, and the probe measured three
 * timeouts in a row from page script (see `evidence`). There is no app token
 * and no relay: if the anonymous tier is unusable, this adapter is switched
 * off, not proxied. Re-run `npm run verify:idea-image-api` and flip `offered`
 * when the table says otherwise.
 */
import { ALLOWED_LICENSES, type ImageHit, type ImageSearch, type License } from './search'

const ENDPOINT = 'https://api.openverse.org/v1/images/'

const KIND: Record<string, License> = { cc0: 'cc0', by: 'by', 'by-sa': 'by-sa', pdm: 'pd' }
const NAME: Record<License, (version: string) => string> = {
  cc0: (v) => `CC0 ${v || '1.0'}`,
  by: (v) => `CC BY ${v}`.trim(),
  'by-sa': (v) => `CC BY-SA ${v}`.trim(),
  pd: (v) => `Public Domain Mark ${v || '1.0'}`,
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
    offered: false,
    evidence: 'docs/evidence/idea-image-api-2026-09-12.md',
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
