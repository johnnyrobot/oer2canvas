/**
 * Does a REAL browser origin reach each LLM provider directly?
 *
 * Same method as `verify-firecrawl-cors.mjs`: a throwaway http origin, a
 * keyless POST with the headers the app will send, the preflight observed
 * through CDP, and the response required to be READABLE (a 401/400 the page
 * can see), not opaque. No key is sent and nothing is billed.
 *
 * The output is evidence, not a test: it is written to docs/evidence and read
 * by a human before `providers.ts` marks a provider `offered`. If a provider
 * fails here, it is NOT offered — there is no relay fallback, because a key
 * must never transit the server.
 */
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const PROVIDERS = [
  { id: 'gemini', label: 'Gemini AI Studio', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', terms: 'https://ai.google.dev/gemini-api/terms' },
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', terms: 'https://openrouter.ai/privacy' },
  { id: 'ollama', label: 'Ollama Cloud', url: 'https://ollama.com/v1/chat/completions', terms: 'https://ollama.com/terms' },
]
const NOT_A_KEY = 'Bearer idea-preflight-probe-no-key'
const BODY = JSON.stringify({ model: 'probe', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })

/**
 * A throwaway origin for the page to sit on. `about:blank` has a null origin,
 * which is a different code path from the real origin this app is served from.
 */
async function serveForeignOrigin() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><meta charset="utf-8"><title>idea llm cors probe</title>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

async function probe(page, cdp, provider) {
  // Preflights are issued beneath Playwright's request events; only CDP's
  // Network domain sees them (measured 2026-08-29 in the Firecrawl probe).
  const preflights = []
  const ids = new Set()
  const onSent = (e) => { if (e.request.method === 'OPTIONS' && e.request.url.startsWith(provider.url)) ids.add(e.requestId) }
  const record = (id, status, raw) => {
    if (!ids.has(id)) return
    const headers = {}
    for (const [k, v] of Object.entries(raw ?? {})) headers[k.toLowerCase()] = v
    preflights.push({ status, headers })
  }
  const onExtra = (e) => record(e.requestId, e.statusCode, e.headers)
  const onResp = (e) => record(e.requestId, e.response.status, e.response.headers)
  cdp.on('Network.requestWillBeSent', onSent)
  cdp.on('Network.responseReceivedExtraInfo', onExtra)
  cdp.on('Network.responseReceived', onResp)
  const actual = await page.evaluate(async ({ url, key, body }) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: { authorization: key, 'content-type': 'application/json' }, body })
      return { reached: true, status: r.status }
    } catch (e) {
      return { reached: false, error: String(e) }
    }
  }, { url: provider.url, key: NOT_A_KEY, body: BODY })
  cdp.off('Network.requestWillBeSent', onSent)
  cdp.off('Network.responseReceivedExtraInfo', onExtra)
  cdp.off('Network.responseReceived', onResp)
  const termsOk = await fetch(provider.terms, { method: 'HEAD', redirect: 'follow' }).then((r) => r.ok).catch(() => false)
  const p = preflights[0]
  const allowOrigin = p?.headers['access-control-allow-origin']
  const allowHeaders = (p?.headers['access-control-allow-headers'] ?? '').toLowerCase()
  const ok = actual.reached && allowOrigin !== undefined && allowHeaders.includes('authorization')
  return { ...provider, preflightStatus: p?.status, allowOrigin, allowHeaders, actual, termsOk, offered: ok }
}

async function main() {
  const { chromium } = await import('playwright')
  const foreign = await serveForeignOrigin()
  const browser = await chromium.launch({ headless: true })
  const date = new Date().toISOString().slice(0, 10)
  try {
    const page = await browser.newPage()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    await page.goto(`${foreign.origin}/`)
    const results = []
    for (const provider of PROVIDERS) results.push(await probe(page, cdp, provider))
    const lines = [
      `# IDEA model providers — browser-direct CORS probe — ${date}`, '',
      `Origin under test: ${foreign.origin}. No key sent; the request is expected to fail authentication readably.`, '',
      '| Provider | Endpoint | Preflight | allow-origin | allow-headers has authorization | Keyless POST | Terms URL resolves | Offered |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...results.map((r) => `| ${r.label} | ${r.url} | ${r.preflightStatus ?? '(none)'} | ${r.allowOrigin ?? '(absent)'} | ${r.allowHeaders.includes('authorization')} | ${r.actual.reached ? `HTTP ${r.actual.status}` : `opaque: ${r.actual.error}`} | ${r.termsOk} | ${r.offered ? 'yes' : 'NO'} |`),
      '', 'Reproduce with `npm run verify:idea-llm-cors`. Update `src/engine/idea/llm/providers.ts` `offered` flags to match this table, and cite this file in the commit.', '',
    ]
    const out = `docs/evidence/idea-llm-cors-${date}.md`
    writeFileSync(out, lines.join('\n'))
    console.log(lines.join('\n'))
    console.log(`\nwritten to ${out}`)
    if (results.every((r) => !r.offered)) process.exitCode = 1
  } finally {
    await browser.close()
    await foreign.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1 })
}
