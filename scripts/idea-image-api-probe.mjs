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
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><meta charset="utf-8"><title>idea image probe</title>')
  })
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
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
          return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : undefined }
        } catch (e) { return { ok: false, error: String(e) } }
      }
      // Openverse's anonymous tier is measured, not promised: three attempts,
      // so one bad minute cannot pass for "unreachable" or one good one for
      // "reliable". Every attempt is recorded.
      const attempts = async (url, n) => {
        const out = []
        for (let i = 0; i < n; i += 1) out.push(await get(url))
        return out
      }
      const bytes = async (url) => {
        try {
          const r = await fetch(url)
          const b = await r.arrayBuffer()
          return { ok: r.ok, status: r.status, bytes: b.byteLength }
        } catch (e) { return { ok: false, error: String(e) } }
      }
      const c = await get(commons)
      const os = await attempts(openverse, 3)
      const o = os.find((a) => a.ok) ?? os[os.length - 1]
      // Both the thumbnail the grid shows and the full file the app packages:
      // they live on different hosts.
      const commonsPages = c.json ? Object.values(c.json.query?.pages ?? {}).slice(0, 2) : []
      const commonsUrls = commonsPages.flatMap((p) => [p.imageinfo?.[0]?.thumburl, p.imageinfo?.[0]?.url]).filter(Boolean)
      const openverseUrls = o.json ? (o.json.results ?? []).map((r) => r.url).slice(0, 3) : []
      const fetched = []
      for (const u of [...commonsUrls, ...openverseUrls]) fetched.push({ url: u, host: new URL(u).host, ...(await bytes(u)) })
      return {
        commons: { ok: c.ok, status: c.status, error: c.error, hits: commonsUrls.length },
        openverse: { ok: o.ok, status: o.status, error: o.error, hits: openverseUrls.length, attempts: os.map((a) => (a.ok ? `HTTP ${a.status}` : `opaque/failed: ${a.error ?? a.status}`)) },
        fetched,
      }
    }, { commons: COMMONS, openverse: OPENVERSE })
    const lines = [
      `# IDEA image APIs — browser-direct probe — ${date}`, '',
      `Origin under test: ${foreign.origin}. Query: "${QUERY}". No key sent.`, '',
      '| Endpoint | Search from page script | Hits |', '| --- | --- | --- |',
      `| Wikimedia Commons | ${result.commons.ok ? `HTTP ${result.commons.status}` : `opaque/failed: ${result.commons.error ?? result.commons.status}`} | ${result.commons.hits} |`,
      `| Openverse (anonymous) | ${result.openverse.ok ? `HTTP ${result.openverse.status}` : `opaque/failed: ${result.openverse.error ?? result.openverse.status}`} | ${result.openverse.hits} |`,
      '', `Openverse, ${result.openverse.attempts.length} attempts in sequence: ${result.openverse.attempts.join('; ')}.`,
      '', '| Image host | Bytes fetch from page script |', '| --- | --- |',
      ...result.fetched.map((f) => `| ${f.host} | ${f.ok ? `HTTP ${f.status}, ${f.bytes} bytes` : `opaque/failed: ${f.error ?? f.status}`} |`),
      '',
      'Reproduce with `npm run verify:idea-image-api`. A provider whose search is opaque is not offered; ' +
      'an image host whose bytes are opaque cannot be packaged, and the placement dialog says so for that hit.',
      '',
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
