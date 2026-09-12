# IDEA Review — Slice 4 Implementation Plan (model-assisted drafting)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring-your-own-key model drafting for the judgment categories (7.1, 7.2, 7.4, 7.5, 7.7, 7.8) and a chapter-level Rubric 1 draft, using OERI's own prompt templates, three providers (Gemini AI Studio, OpenRouter, Ollama Cloud) behind one OpenAI-compatible adapter, browser-direct only, with the key stored in the user's browser on the user's device and never on the server.

**Architecture:** A CORS spike script decides which providers are `offered` before any UI exists. One `complete()` function posts an OpenAI-style chat completion to a preset base URL with a Bearer key; four mapped error states. Prompts inline the Framework text as the lens and request JSON in OERI's column shapes; a parser turns items into `draft` findings, promoting an item to an `edit` only when its quoted original matches the section verbatim. Settings live in IndexedDB through the app's existing `createIdbStore`. The rubric draft renders beside the human's rating and cannot be copied into it.

**Tech Stack:** TypeScript, React 19, `fetch`, IndexedDB (`src/canvas/idb.ts`), Playwright (spike only), Vitest.

**Spec:** `docs/IDEA_REVIEW_SPEC.md` §2.6, §4, §5.2 header, §7.1, §7.2, §8 slice 4. Aligned 2026-09-11 with the revised slices 1–2: ratings are per Rubric 1 **row** (7.1 has three), so the rubric draft is per row too and renders beside each row's radio group; `IdeaScreen` keeps slice 1's `header` / `onHeaderEvent` / `onForget` and slice 2's `edits` / `onEditEvent` / `pending` beside the `llm` prop this slice adds; the model key lives under its own IndexedDB key (`idea.llm.settings`) and is forgotten by *Forget key*, not by slice 1's *Forget all IDEA reviews* — the two are different secrets with different owners and the copy says so.

## Global Constraints

- **The key is stored only in the user's browser, on the user's device** (IndexedDB, this origin). **Never on the relay, never in a URL, never in a log, never in an error message.** The relay is not in the path for any provider; a provider that fails the CORS spike is `offered: false`.
- **Nothing is sent without a click.** No call on phase entry, recompile, or in the background. One in-flight request per category; 60 s timeout; aborted on phase exit.
- **Every model output is `origin: 'draft'`.** An item becomes an `edit` only when its `original` is found verbatim in the section.
- **The rubric draft rating cannot be copied into the human rating field.** Only the note has a one-click "use this note". The draft is per Rubric 1 row, matching slice 1's `ratings` map; a model answer that names an area but not its rows is applied only when the area has one row.
- **Model drafts and runs are never persisted.** They are `RunState` in React; a reload starts clean. Only the settings (provider, key, model) are stored, under `idea.llm.settings`.
- **No network in tests**: `fetch` is injected; the spike is a script, not a test.
- **Provider names in copy**: "Gemini", "OpenRouter", "Ollama Cloud".
- Commit trailer: `Co-Authored-By: Claude <model name> <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `scripts/idea-llm-cors-probe.mjs` | Evidence: does a browser origin reach each provider directly? Writes `docs/evidence/idea-llm-cors-<date>.md`. |
| `src/engine/idea/llm/providers.ts` | The three presets (`LlmProvider`), `offered` flags, data-use sentences and terms URLs. |
| `src/engine/idea/llm/client.ts` | `complete()` with injected fetch, timeout, abort, four error states. |
| `src/engine/idea/llm/settings.ts` | `LlmSettings`, `createLlmSettingsStore(disk)` over `KeyValueStore`. |
| `src/engine/idea/llm/prompts.ts` | OERI's per-category prompt shapes with the Framework text inlined; the Rubric 1 prompt. |
| `src/engine/idea/llm/parse.ts` | Model text → `IdeaFinding[]` (`draft`), with verbatim-match promotion; rubric draft parser. |
| `src/components/idea/useLlmSettings.ts`, `LlmSettingsPanel.tsx` | Provider/key/model UI, Forget key, shared-computer warning. |
| `src/components/idea/useModelRuns.ts`, `AskModel.tsx` | Per-category run state, consent line, the button, result rendering. |
| `src/components/idea/CategoryPanel.tsx`, `IdeaScreen.tsx`, `copy.ts` | Ask-the-model zone; rubric draft column. |
| `src/engine/idea/llm/key-containment.test.ts` | Adversarial: the key reaches only the provider's `Authorization` header. |
| `PRIVACY.md`, `README.md`, `docs/IDEA.md`, `docs/RELEASE-ACCEPTANCE.md`, `src/docs-claims.test.ts` | Disclosures. |

---

### Task 1: The CORS spike

**Files:**
- Create: `scripts/idea-llm-cors-probe.mjs`
- Create: `docs/evidence/idea-llm-cors-<YYYY-MM-DD>.md` (by running it)
- Modify: `package.json` (`"verify:idea-llm-cors": "node scripts/idea-llm-cors-probe.mjs"`)

**Why first:** the plan's `offered` flags and base URLs are claims until a real browser origin has made a preflight to each endpoint. The probe sends **no key** and expects a readable 401/400 — the same shape as `verify-firecrawl-cors.mjs`.

- [ ] **Step 1: Write the probe**

```js
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

async function serveForeignOrigin() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><meta charset="utf-8"><title>idea llm cors probe</title>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

async function probe(page, cdp, provider) {
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
```

- [ ] **Step 2: Run it and read the table**

Run: `npm run verify:idea-llm-cors`
Expected: a table in `docs/evidence/idea-llm-cors-<date>.md`. **Read it.** The `Offered` column is what Task 2 encodes. A provider whose terms URL does not resolve keeps its row but Task 2 must replace the URL with the provider's current terms page (search their docs; do not invent one).

- [ ] **Step 3: Commit the script and the evidence**

```bash
git add scripts/idea-llm-cors-probe.mjs package.json docs/evidence/idea-llm-cors-*.md
git commit -m "test: probe which model providers a browser origin can reach directly

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 2: Providers, client, and settings store

**Files:**
- Create: `src/engine/idea/llm/providers.ts`, `src/engine/idea/llm/client.ts`, `src/engine/idea/llm/settings.ts`
- Test: `src/engine/idea/llm/client.test.ts`, `src/engine/idea/llm/settings.test.ts`, `src/engine/idea/llm/key-containment.test.ts`

**Interfaces:**
```ts
// providers.ts
export type ProviderId = 'gemini' | 'openrouter' | 'ollama'
export interface LlmProvider {
  id: ProviderId; label: string; baseUrl: string; defaultModel: string
  extraHeaders?: Record<string, string>; dataUse: string; termsUrl: string; offered: boolean; evidence: string
}
export const PROVIDERS: readonly LlmProvider[]
export function providerById(id: ProviderId): LlmProvider
// client.ts
export type LlmFailure = 'bad-key' | 'model-not-found' | 'rate-limited' | 'unreachable' | 'timeout' | 'aborted'
export class LlmError extends Error { constructor(public readonly failure: LlmFailure, message: string, public readonly retryAfterSeconds?: number) }
export interface CompleteDeps { fetch?: typeof globalThis.fetch; now?: () => number }
export const LLM_TIMEOUT_MS = 60_000
export async function complete(provider: LlmProvider, settings: { key: string; model: string }, messages: { role: 'system' | 'user'; content: string }[], signal: AbortSignal, deps?: CompleteDeps): Promise<{ text: string }>
// settings.ts
export interface LlmSettings { provider: ProviderId; key: string; model: string }
export interface LlmSettingsStore { load(): Promise<LlmSettings | undefined>; save(s: LlmSettings): Promise<void>; forget(): Promise<void> }
export const LLM_SETTINGS_KEY = 'idea.llm.settings'
export function createLlmSettingsStore(disk: KeyValueStore): LlmSettingsStore
```

- [ ] **Step 1: Write the failing tests**

`src/engine/idea/llm/client.test.ts`:
```ts
import { LlmError, complete } from './client'
import { providerById } from './providers'

const openrouter = providerById('openrouter')
const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
const settings = { key: 'sk-test', model: 'm' }
const msgs = [{ role: 'user' as const, content: 'hi' }]

test('posts an OpenAI-style completion with a Bearer key and returns the text', async () => {
  const fetch = vi.fn(async () => ok('hello'))
  const r = await complete(openrouter, settings, msgs, new AbortController().signal, { fetch })
  expect(r.text).toBe('hello')
  const [url, init] = fetch.mock.calls[0]! as [string, RequestInit]
  expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
  expect(url).not.toContain('sk-test')
  const body = JSON.parse(init.body as string)
  expect(body).toMatchObject({ model: 'm', messages: msgs, stream: false })
})

test('maps 401/403 to bad-key, 404 to model-not-found, 429 to rate-limited with retry-after', async () => {
  const at = (status: number, headers: Record<string, string> = {}) => vi.fn(async () => new Response('{}', { status, headers }))
  await expect(complete(openrouter, settings, msgs, new AbortController().signal, { fetch: at(401) })).rejects.toMatchObject({ failure: 'bad-key' })
  await expect(complete(openrouter, settings, msgs, new AbortController().signal, { fetch: at(403) })).rejects.toMatchObject({ failure: 'bad-key' })
  await expect(complete(openrouter, settings, msgs, new AbortController().signal, { fetch: at(404) })).rejects.toMatchObject({ failure: 'model-not-found' })
  await expect(complete(openrouter, settings, msgs, new AbortController().signal, { fetch: at(429, { 'retry-after': '12' }) })).rejects.toMatchObject({ failure: 'rate-limited', retryAfterSeconds: 12 })
})

test('a network failure is unreachable; an aborted signal is aborted', async () => {
  const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
  await expect(complete(openrouter, settings, msgs, new AbortController().signal, { fetch })).rejects.toMatchObject({ failure: 'unreachable' })
  const c = new AbortController()
  c.abort()
  await expect(complete(openrouter, settings, msgs, c.signal, { fetch: vi.fn(async () => ok('x')) })).rejects.toMatchObject({ failure: 'aborted' })
})

test('no error message ever contains the key', async () => {
  const fetch = vi.fn(async () => new Response('sk-test leaked?', { status: 500 }))
  try {
    await complete(openrouter, settings, msgs, new AbortController().signal, { fetch })
  } catch (e) {
    expect((e as LlmError).message).not.toContain('sk-test')
  }
})

test('an empty key is refused before any request', async () => {
  const fetch = vi.fn()
  await expect(complete(openrouter, { key: '  ', model: 'm' }, msgs, new AbortController().signal, { fetch })).rejects.toMatchObject({ failure: 'bad-key' })
  expect(fetch).not.toHaveBeenCalled()
})
```

`src/engine/idea/llm/settings.test.ts`:
```ts
import { LLM_SETTINGS_KEY, createLlmSettingsStore } from './settings'
import type { KeyValueStore } from '../../../canvas/credentials'

function memoryDisk(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return { data, get: async (k) => data.get(k), set: async (k, v) => { data.set(k, v) }, remove: async (k) => { data.delete(k) } }
}

test('save writes the settings under one key; load reads them back; forget removes them', async () => {
  const disk = memoryDisk()
  const store = createLlmSettingsStore(disk)
  expect(await store.load()).toBeUndefined()
  await store.save({ provider: 'gemini', key: 'k', model: 'gemini-2.5-flash' })
  expect(disk.data.get(LLM_SETTINGS_KEY)).toEqual({ provider: 'gemini', key: 'k', model: 'gemini-2.5-flash' })
  expect(await store.load()).toEqual({ provider: 'gemini', key: 'k', model: 'gemini-2.5-flash' })
  await store.forget()
  expect(disk.data.has(LLM_SETTINGS_KEY)).toBe(false)
})

test('a damaged record loads as undefined rather than throwing', async () => {
  const disk = memoryDisk()
  disk.data.set(LLM_SETTINGS_KEY, { provider: 'nope' })
  expect(await createLlmSettingsStore(disk).load()).toBeUndefined()
})
```

`src/engine/idea/llm/key-containment.test.ts`:
```ts
/**
 * Adversarial, in the spirit of `web-key-containment.test.ts`: the key must
 * reach exactly one place — the provider's Authorization header — and nothing
 * on this path may touch the relay, a URL, or browser storage other than the
 * settings store the user asked for.
 */
import { complete } from './client'
import { PROVIDERS } from './providers'

const SENTINEL = 'sk-SENTINEL-do-not-leak-0123456789'

test('for every provider the sentinel appears only in the Authorization header', async () => {
  for (const provider of PROVIDERS) {
    const seen: { url: string; init: RequestInit }[] = []
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    })
    await complete(provider, { key: SENTINEL, model: 'm' }, [{ role: 'user', content: 'x' }], new AbortController().signal, { fetch: fetch as unknown as typeof globalThis.fetch })
    expect(seen).toHaveLength(1)
    const { url, init } = seen[0]!
    expect(url.startsWith(provider.baseUrl)).toBe(true)
    expect(url).not.toContain('/relay')
    expect(url).not.toContain(SENTINEL)
    expect(String(init.body)).not.toContain(SENTINEL)
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${SENTINEL}`)
    for (const [k, v] of Object.entries(headers)) if (k !== 'authorization') expect(v).not.toContain(SENTINEL)
  }
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/engine/idea/llm/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `providers.ts`**

```ts
/**
 * The three presets. All speak the OpenAI chat-completions dialect with a
 * Bearer key, which is why one client serves them.
 *
 * `offered` is EVIDENCE, not intent: it is set from the table in
 * docs/evidence/idea-llm-cors-<date>.md, and a provider a browser origin
 * cannot reach directly is not offered. There is no relay fallback, because
 * the key must never transit the server.
 *
 * `dataUse` is the sentence shown beside the key field. It does not
 * paraphrase the provider's terms — the link does that — it says what THIS
 * app sends and that the provider's terms govern what happens next.
 */
export type ProviderId = 'gemini' | 'openrouter' | 'ollama'

export interface LlmProvider {
  id: ProviderId
  label: string
  baseUrl: string
  defaultModel: string
  extraHeaders?: Record<string, string>
  dataUse: string
  termsUrl: string
  /** From the CORS probe. False = listed as "not available from the browser". */
  offered: boolean
  /** The evidence file the `offered` flag was read from. */
  evidence: string
}

const EVIDENCE = 'docs/evidence/idea-llm-cors-YYYY-MM-DD.md' // replace with the file Task 1 wrote

export const PROVIDERS: readonly LlmProvider[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    dataUse: 'This section’s text and image descriptions go from your browser to Google’s Gemini API on your key. Google’s Gemini API terms govern how they use it.',
    termsUrl: 'https://ai.google.dev/gemini-api/terms',
    offered: true,
    evidence: EVIDENCE,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.5-flash',
    extraHeaders: { 'HTTP-Referer': 'https://oer2canvas.app', 'X-Title': 'oer2canvas' },
    dataUse: 'This section’s text and image descriptions go from your browser to OpenRouter on your key, and from OpenRouter to the model provider you chose. OpenRouter’s privacy policy and that provider’s terms govern how they use it.',
    termsUrl: 'https://openrouter.ai/privacy',
    offered: true,
    evidence: EVIDENCE,
  },
  {
    id: 'ollama',
    label: 'Ollama Cloud',
    baseUrl: 'https://ollama.com/v1',
    defaultModel: 'gpt-oss:120b',
    dataUse: 'This section’s text and image descriptions go from your browser to Ollama Cloud on your key. Ollama’s terms govern how they use it.',
    termsUrl: 'https://ollama.com/terms',
    offered: true,
    evidence: EVIDENCE,
  },
]

export function providerById(id: ProviderId): LlmProvider {
  const p = PROVIDERS.find((x) => x.id === id)
  if (!p) throw new Error(`unknown provider ${id}`)
  return p
}
```
**Set `offered`, `baseUrl`, `termsUrl`, and `EVIDENCE` from Task 1's table before committing.** The `HTTP-Referer` value must be the deployed origin (read it from `wrangler.jsonc`/README); if the app has no fixed public origin, omit `extraHeaders` for OpenRouter.

- [ ] **Step 4: Write `client.ts`**

```ts
/**
 * One request, one response, four things that can go wrong — and NEVER the
 * key in a message. Modeled on `import/firecrawl.ts`: injected fetch, a hand
 * -rolled two-source abort (jsdom's AbortSignal is not Node's), vendor error
 * text treated as data and never rendered.
 */
import type { LlmProvider } from './providers'

export type LlmFailure = 'bad-key' | 'model-not-found' | 'rate-limited' | 'unreachable' | 'timeout' | 'aborted'

export class LlmError extends Error {
  constructor(public readonly failure: LlmFailure, message: string, public readonly retryAfterSeconds?: number) {
    super(message)
    this.name = 'LlmError'
  }
}

export interface CompleteDeps {
  fetch?: typeof globalThis.fetch
}

export const LLM_TIMEOUT_MS = 60_000

export async function complete(
  provider: LlmProvider,
  settings: { key: string; model: string },
  messages: { role: 'system' | 'user'; content: string }[],
  signal: AbortSignal,
  deps: CompleteDeps = {},
): Promise<{ text: string }> {
  const doFetch = deps.fetch ?? globalThis.fetch
  const key = settings.key.trim()
  if (!key) throw new LlmError('bad-key', `Enter your ${provider.label} API key first.`)
  if (signal.aborted) throw new LlmError('aborted', 'Cancelled.')

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  let timedOut = false
  const timeoutMark = setTimeout(() => { timedOut = true }, LLM_TIMEOUT_MS - 1)

  try {
    let response: Response
    try {
      response = await doFetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          // The key travels here and nowhere else.
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          ...(provider.extraHeaders ?? {}),
        },
        body: JSON.stringify({ model: settings.model, messages, stream: false, temperature: 0.2 }),
        signal: controller.signal,
      })
    } catch (e) {
      if (signal.aborted) throw new LlmError('aborted', 'Cancelled.')
      if (timedOut) throw new LlmError('timeout', `${provider.label} did not answer in ${LLM_TIMEOUT_MS / 1000} seconds. Try again.`)
      throw new LlmError('unreachable', `${provider.label} could not be reached from this browser. Check your connection and try again.`)
    }
    if (response.status === 401 || response.status === 403) {
      throw new LlmError('bad-key', `${provider.label} rejected this API key. Check that it is current and pasted in full.`)
    }
    if (response.status === 404) {
      throw new LlmError('model-not-found', `${provider.label} does not know the model "${settings.model}". Check the model name.`)
    }
    if (response.status === 429) {
      const after = Number(response.headers.get('retry-after'))
      const secs = Number.isFinite(after) && after > 0 ? after : undefined
      throw new LlmError('rate-limited', `${provider.label} is rate-limiting this key.${secs ? ` Try again in ${secs} s.` : ' Wait a moment and try again.'}`, secs)
    }
    if (!response.ok) {
      // Status only. The body is vendor text and is never rendered.
      throw new LlmError('unreachable', `${provider.label} refused the request (HTTP ${response.status}).`)
    }
    const json = (await response.json().catch(() => undefined)) as { choices?: { message?: { content?: string } }[] } | undefined
    const text = json?.choices?.[0]?.message?.content
    if (typeof text !== 'string') throw new LlmError('unreachable', `${provider.label} returned an unexpected response. Try again.`)
    return { text }
  } finally {
    clearTimeout(timer)
    clearTimeout(timeoutMark)
    signal.removeEventListener('abort', onAbort)
  }
}
```

- [ ] **Step 5: Write `settings.ts`**

```ts
/**
 * Where the model key lives: in the user's browser, on the user's device,
 * through the same IndexedDB wrapper the Canvas address uses — and nowhere
 * else. This is the one deliberate step past the Firecrawl key's tab-memory
 * contract: this is a PWA, an instructor reviews chapters over weeks, and a
 * key retyped every session is a key pasted into a text file on the desktop.
 * The panel says which device holds it and offers Forget key.
 */
import type { KeyValueStore } from '../../../canvas/credentials'
import type { ProviderId } from './providers'

export interface LlmSettings {
  provider: ProviderId
  key: string
  model: string
}

export interface LlmSettingsStore {
  load(): Promise<LlmSettings | undefined>
  save(settings: LlmSettings): Promise<void>
  forget(): Promise<void>
}

export const LLM_SETTINGS_KEY = 'idea.llm.settings'

const PROVIDER_IDS: readonly string[] = ['gemini', 'openrouter', 'ollama']

function isSettings(v: unknown): v is LlmSettings {
  return typeof v === 'object' && v !== null
    && PROVIDER_IDS.includes((v as LlmSettings).provider)
    && typeof (v as LlmSettings).key === 'string'
    && typeof (v as LlmSettings).model === 'string'
}

export function createLlmSettingsStore(disk: KeyValueStore): LlmSettingsStore {
  return {
    async load() {
      const v = await disk.get(LLM_SETTINGS_KEY).catch(() => undefined)
      return isSettings(v) ? { provider: v.provider, key: v.key, model: v.model } : undefined
    },
    async save(settings) {
      await disk.set(LLM_SETTINGS_KEY, { provider: settings.provider, key: settings.key.trim(), model: settings.model.trim() })
    },
    async forget() {
      await disk.remove(LLM_SETTINGS_KEY)
    },
  }
}
```

- [ ] **Step 6: Run the tests, typecheck, commit**

Run: `npx vitest run --project unit src/engine/idea/llm/ && npm run typecheck`
Expected: PASS.

```bash
git add src/engine/idea/llm
git commit -m "feat: one model client for three providers, key contained to one header

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 3: Prompts and the parser

**Files:**
- Create: `src/engine/idea/llm/prompts.ts`, `src/engine/idea/llm/parse.ts`
- Test: `src/engine/idea/llm/prompts.test.ts`, `src/engine/idea/llm/parse.test.ts`

**Interfaces:**
```ts
// prompts.ts
export type DraftableCategory = '7.1' | '7.2' | '7.4' | '7.5' | '7.7' | '7.8'
export const DRAFTABLE: readonly DraftableCategory[]
export interface SectionInput { sectionId: string; sectionTitle: string; chapterTitle: string; discipline?: string; text: string; images: ImageRow[]; metadata: MetadataRow[] }
export function categoryPrompt(category: DraftableCategory, input: SectionInput): { role: 'system' | 'user'; content: string }[]
export function rubricPrompt(chapterTitle: string, sections: SectionInput[]): { role: 'system' | 'user'; content: string }[]
export function sectionText(html: string): string       // block text joined with blank lines, ids stripped
// parse.ts
export interface DraftItem { evidence: string; inference: string; suggestion: string; original?: string; replacement?: string; imageRef?: string }
export function parseCategoryResponse(text: string): { items: DraftItem[]; summary?: string; raw?: string }
export function draftsToFindings(category: CategoryId, sectionId: string, html: string, parsed: ReturnType<typeof parseCategoryResponse>): IdeaFinding[]
export interface RubricDraft { areas: { id: CategoryId; rows: { id: string; rating: Rating | null }[]; notes: string }[]; raw?: string }
export function parseRubricResponse(text: string): RubricDraft
```
`rows` follows slice 1's per-row ratings: one entry per Rubric 1 row of the area (`7.1.a`, `7.1.b`, `7.1.c`; `7.2.a`; …), in Framework order, `null` where the model gave nothing usable.

- [ ] **Step 1: Write the failing tests**

`src/engine/idea/llm/prompts.test.ts`:
```ts
import { categoryPrompt, rubricPrompt, sectionText, type SectionInput } from './prompts'
import { categoryById } from '../framework'

const input: SectionInput = {
  sectionId: 's1', sectionTitle: '4.2 Nutrients', chapterTitle: '4: Nutrition', discipline: 'Biology',
  text: 'Indian spices are used as an example of phytochemicals.',
  images: [{ sectionId: 's1', elementId: 'i1', src: 'a.png', alt: 'A nurse', caption: 'Figure 1', mentionsPeople: true, presentational: false }],
  metadata: [{ sectionId: 's1', kind: 'heading', text: 'Key terms' }],
}

test('every category prompt inlines that category’s restorative requirement and elements, and the separation rule', () => {
  for (const c of ['7.1', '7.2', '7.4', '7.5', '7.7', '7.8'] as const) {
    const m = categoryPrompt(c, input)
    const all = m.map((x) => x.content).join('\n')
    expect(all).toContain(categoryById(c).restorative.slice(0, 60))
    expect(all).toContain(categoryById(c).elements[0]!.text.slice(0, 40))
    expect(all).toMatch(/separate what you see explicitly in the text from what you infer/i)
    expect(all).toContain('4: Nutrition')
    expect(all).toContain('Biology')
    expect(all).toMatch(/respond with json/i)
  }
})

test('7.1 sends the image inventory, not the section text; 7.7 sends the metadata inventory', () => {
  const p71 = categoryPrompt('7.1', input).map((x) => x.content).join('\n')
  expect(p71).toContain('A nurse')
  expect(p71).not.toContain('Indian spices')
  const p77 = categoryPrompt('7.7', input).map((x) => x.content).join('\n')
  expect(p77).toContain('Key terms')
})

test('7.5 asks for the five columns OERI names', () => {
  const p = categoryPrompt('7.5', input).map((x) => x.content).join('\n')
  for (const col of ['scenario', 'population', 'cultural knowledge assumed', 'stereotype risk', 'suggested revision']) expect(p.toLowerCase()).toContain(col)
})

test('the rubric prompt asks for area / rows / notes over every category, naming 7.1’s three rows', () => {
  const p = rubricPrompt('4: Nutrition', [input]).map((x) => x.content).join('\n')
  expect(p).toMatch(/"area"/)
  expect(p).toMatch(/"rows"/)
  expect(p).toMatch(/"notes"/)
  expect(p).toContain('7.8')
  expect(p).toMatch(/Not Applicable|Exclusive|Emerging Inclusive|Inclusive/)
  // Rubric 1's rows are quoted so the model rates what the assessor rates.
  expect(p).toContain('7.1.a')
  expect(p).toContain('7.1.c')
  expect(p).toContain(categoryById('7.1').rows[1]!.emerging)
})

test('sectionText flattens blocks and drops markup', () => {
  expect(sectionText('<p id="b2c-blk-0">One <em>two</em>.</p><ul><li id="x">Three</li></ul>')).toBe('One two.\n\nThree')
})
```

`src/engine/idea/llm/parse.test.ts`:
```ts
import { draftsToFindings, parseCategoryResponse, parseRubricResponse } from './parse'

test('a JSON response parses to items; a fenced one too', () => {
  const json = JSON.stringify({ summary: 'ok', items: [{ evidence: 'e', inference: 'i', suggestion: 's' }] })
  expect(parseCategoryResponse(json).items).toHaveLength(1)
  expect(parseCategoryResponse('```json\n' + json + '\n```').items).toHaveLength(1)
  expect(parseCategoryResponse(json).summary).toBe('ok')
})

test('unparseable text becomes raw, never dropped', () => {
  const r = parseCategoryResponse('Here are my thoughts...')
  expect(r.items).toEqual([])
  expect(r.raw).toBe('Here are my thoughts...')
})

test('an item is promoted to an edit only when its original is verbatim in the section', () => {
  const html = '<p id="b2c-blk-0">The chairman spoke to the men.</p>'
  const parsed = { items: [
    { evidence: 'e', inference: 'i', suggestion: 's', original: 'chairman', replacement: 'chair' },
    { evidence: 'e', inference: 'i', suggestion: 's', original: 'the chairperson', replacement: 'the chair' },
    { evidence: 'e', inference: 'i', suggestion: 'no edit' },
  ] }
  const f = draftsToFindings('7.3', 's1', html, parsed)
  expect(f.map((x) => x.kind)).toEqual(['edit', 'observation', 'observation'])
  const e = f[0]!
  expect(e.kind === 'edit' && e.elementId).toBe('b2c-blk-0')
  expect(e.kind === 'edit' && e.key).toBe('s1::b2c-blk-0::0::chairman')
  expect(f.every((x) => x.origin === 'draft' && x.rule?.source === 'llm')).toBe(true)
})

test('a raw response becomes one observation carrying the text', () => {
  const f = draftsToFindings('7.8', 's1', '<p id="a">x</p>', parseCategoryResponse('plain prose'))
  expect(f).toHaveLength(1)
  expect(f[0]!.kind === 'observation' && f[0]!.columns.response).toBe('plain prose')
})

test('the rubric parser maps OERI labels to per-row ratings and tolerates unknown labels as null', () => {
  const r = parseRubricResponse(JSON.stringify({ areas: [
    { area: '7.1 Illustrations', rows: [{ row: '7.1.a', rating: 'Emerging Inclusive' }, { row: 'b', rating: 'Exclusive' }, { row: '7.1.z', rating: 'Inclusive' }], notes: 'a' },
    { area: '7.6', rating: 'N/A', notes: 'b' },
    { area: '7.8', rating: 'unsure', notes: 'c' },
  ] }))
  expect(r.areas).toEqual([
    // Row ids are accepted bare or qualified; a row the Framework lacks is ignored; a missing row is null.
    { id: '7.1', rows: [{ id: '7.1.a', rating: 'emerging' }, { id: '7.1.b', rating: 'exclusive' }, { id: '7.1.c', rating: null }], notes: 'a' },
    { id: '7.6', rows: [{ id: '7.6.a', rating: 'na' }], notes: 'b' },
    { id: '7.8', rows: [{ id: '7.8.a', rating: null }], notes: 'c' },
  ])
})

// A single "rating" for a three-row area is not spread across the rows: the
// model did not rate them, and a draft that looks like it did is a draft that
// gets copied by eye.
test('a bare rating on a multi-row area leaves its rows null', () => {
  const r = parseRubricResponse(JSON.stringify({ areas: [{ area: '7.1', rating: 'Inclusive', notes: 'n' }] }))
  expect(r.areas[0]!.rows.map((x) => x.rating)).toEqual([null, null, null])
  expect(r.areas[0]!.notes).toBe('n')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/engine/idea/llm/prompts.test.ts src/engine/idea/llm/parse.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `prompts.ts`**

```ts
/**
 * OERI's Appendix A prompt shapes, adapted for a browser that cannot follow a
 * link: the category's own Framework text is inlined as the lens, and the
 * output is asked for as JSON in the columns OERI's tables use.
 *
 * The three sentences quoted from OERI's Gen-AI Crosswalk (April 2026) are
 * the ones that carry its stance, and they are kept verbatim: treat the output
 * as a draft, keep the discipline expert in control, and separate what is seen
 * from what is inferred.
 */
import { categoryById, FRAMEWORK_ATTRIBUTION, type CategoryId } from '../framework'
import type { ImageRow } from '../images'
import type { MetadataRow } from '../metadata'
import { blockElements } from '../text'

export type DraftableCategory = '7.1' | '7.2' | '7.4' | '7.5' | '7.7' | '7.8'
export const DRAFTABLE: readonly DraftableCategory[] = ['7.1', '7.2', '7.4', '7.5', '7.7', '7.8']

export interface SectionInput {
  sectionId: string
  sectionTitle: string
  chapterTitle: string
  discipline?: string
  text: string
  images: ImageRow[]
  metadata: MetadataRow[]
}

type Msg = { role: 'system' | 'user'; content: string }

const SYSTEM =
  'You are assisting a college instructor who is applying the ASCCC OERI Inclusion, Diversity, Equity, and Anti-Racism (IDEA) Framework to an open textbook section. ' +
  'Treat your output as a draft that needs the instructor’s disciplinary expertise; you are never the end result. ' +
  'Clearly separate what you see explicitly in the text from what you infer or recommend. ' +
  'Do not guess anyone’s race, ethnicity, gender, age, or disability from a name or an image description; describe only what the text states. ' +
  `Framework text is quoted from "${FRAMEWORK_ATTRIBUTION.title}" (CC BY 4.0).`

function lens(c: CategoryId): string {
  const cat = categoryById(c)
  return `FRAMEWORK CATEGORY ${cat.id} ${cat.title}\nRestorative requirements: ${cat.restorative}\nElements for consideration:\n${cat.elements.map((e) => `- ${e.text}`).join('\n')}` +
    (cat.resources.length ? `\nResources you may name (do not fetch): ${cat.resources.map((r) => `${r.label} <${r.url}>`).join('; ')}` : '')
}

const CONTEXT = (i: SectionInput) => `Chapter: ${i.chapterTitle}\nSection: ${i.sectionTitle}${i.discipline ? `\nDiscipline: ${i.discipline}` : ''}`

const ITEM_SHAPE =
  'Respond with JSON only, no prose before or after: {"summary": string, "items": [{"evidence": string, "inference": string, "suggestion": string, "original"?: string, "replacement"?: string}]}. ' +
  '"evidence" quotes the text exactly; "inference" is what you conclude; "suggestion" is the revision. ' +
  'Include "original" and "replacement" ONLY when the suggestion is a direct wording substitution and "original" is copied verbatim from the text.'

const TASK: Record<DraftableCategory, (i: SectionInput) => string> = {
  '7.1': (i) =>
    `Analyze the following image descriptions, alt text, and captions for how people are visually represented — diversity across race, ethnicity, age, gender, ability, and more; whether people appear where identity is not the subject; whether any depiction risks a stereotype. Do NOT infer identity from a description that does not state it.\n\nIMAGES:\n${i.images.map((r, n) => `${n + 1}. ref=${r.elementId} alt="${r.alt ?? '(none)'}" caption="${r.caption ?? ''}" reference="${r.reference ?? ''}"`).join('\n') || '(no images)'}\n\n` +
    'Respond with JSON only: {"summary": string, "items": [{"imageRef": string, "evidence": string, "inference": string, "suggestion": string}]}. "imageRef" is the ref value.',
  '7.2': (i) => `Identify the example names used for people in this text. Consider whether they represent various countries of origin, ethnicities, genders, and races and whether any is associated with a stereotype. Do not assert a person’s identity from a name; say what a name suggests only as an inference.\n\nTEXT:\n${i.text}\n\n${ITEM_SHAPE}`,
  '7.4': (i) => `Identify the authors, researchers, scholars, and studies referenced in this text. Assess the diversity of the contributors cited and whether historically underrepresented contributors are absent; suggest current, relevant contributors where appropriate, naming only real people and works you are confident exist.\n\nTEXT:\n${i.text}\n\n${ITEM_SHAPE}`,
  '7.5': (i) =>
    `Review the applications, examples, and problem scenarios in this text for whether they relate to diverse audiences, assume cultural knowledge, or risk a stereotype.\n\nTEXT:\n${i.text}\n\n` +
    'Respond with JSON only: {"summary": string, "items": [{"scenario": string, "population": string, "cultural knowledge assumed": string, "stereotype risk": string, "suggested revision": string, "original"?: string, "replacement"?: string}]}.',
  '7.7': (i) => `Review the keywords, glossary terms, headings, and summary content below for whether diverse topics, scholars, and perspectives are represented among what the section signals as important.\n\nMETADATA:\n${i.metadata.map((m) => `- [${m.kind}] ${m.text}${m.detail ? ` — ${m.detail}` : ''}`).join('\n') || '(none)'}\n\n${ITEM_SHAPE}`,
  '7.8': (i) => `Identify issues, events, and concepts in this text where perspectives of underrepresented groups are relevant, and whether they are present, balanced, and free of generalization.\n\nTEXT:\n${i.text}\n\n${ITEM_SHAPE}`,
}

export function categoryPrompt(category: DraftableCategory, input: SectionInput): Msg[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${CONTEXT(input)}\n\n${lens(category)}\n\nTASK:\n${TASK[category](input)}` },
  ]
}

export function rubricPrompt(chapterTitle: string, sections: SectionInput[]): Msg[] {
  const ids: CategoryId[] = ['7.1', '7.2', '7.3', '7.4', '7.5', '7.6', '7.7', '7.8']
  const body = sections.map((s) => `## ${s.sectionTitle}\n${s.text}\n\nImages: ${s.images.map((r) => `alt="${r.alt ?? '(none)'}" caption="${r.caption ?? ''}"`).join(' | ') || '(none)'}`).join('\n\n')
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `Chapter: ${chapterTitle}\n\nDraft a Rubric 1 review of this chapter using the IDEA Framework. For each row of each area, rate as one of: Not Applicable, Exclusive, Emerging Inclusive, Inclusive, and give notes per area that cite evidence from the text. The instructor will make the actual rating; yours is a draft.\n\n` +
        ids.map(lens).join('\n\n') +
        `\n\nRUBRIC 1 ROWS:\n${rubricRows()}\n\n` +
        `CHAPTER TEXT:\n${body}\n\n` +
        'Respond with JSON only: {"areas": [{"area": string, "rows": [{"row": string, "rating": string}], "notes": string}]} with one entry per area 7.1 through 7.8, "area" beginning with the number, and one "rows" entry per row id listed above.',
    },
  ]
}

/** Every Rubric 1 row, quoted, so the model rates exactly what the assessor rates. */
function rubricRows(): string {
  return IDEA_FRAMEWORK.flatMap((c) => c.rows.map((r) =>
    `${r.id} (${c.rubricTitle}): Exclusive = "${r.exclusive}"; Emerging Inclusive = "${r.emerging}"; Inclusive = "${r.inclusive}"; Not Applicable = "${RUBRIC_NA_TEXT}"`,
  )).join('\n')
}
// `IDEA_FRAMEWORK` and `RUBRIC_NA_TEXT` join this file's import from '../framework'.

/** Block text, one blank line between blocks, no markup and no ids. */
export function sectionText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.body.querySelector('.b2c-attribution')?.remove()
  return blockElements(doc.body)
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}
```

- [ ] **Step 4: Write `parse.ts`**

```ts
/**
 * Model text → findings. Two rules do the work: an unparseable response is
 * shown, not dropped; and an item becomes an EDIT only when the text it says
 * it is replacing is actually there, verbatim. The model can propose; it
 * cannot edit what it did not quote.
 */
import type { CategoryId } from '../framework'
import type { IdeaFinding } from '../findings'
import type { Rating } from '../review'
import { ideaEditKey } from '../edits'
import { blockElements, countOccurrences, findOccurrence, isQuotation, textBefore } from '../text'
import { textNodesOf } from '../text'

export interface DraftItem {
  evidence: string
  inference: string
  suggestion: string
  original?: string
  replacement?: string
  imageRef?: string
  [column: string]: string | undefined
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1]! : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no json')
  return JSON.parse(candidate.slice(start, end + 1))
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))

export function parseCategoryResponse(text: string): { items: DraftItem[]; summary?: string; raw?: string } {
  try {
    const j = extractJson(text) as { summary?: unknown; items?: unknown }
    const items = Array.isArray(j.items)
      ? j.items.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null).map((x) => {
          const item: DraftItem = { evidence: str(x.evidence), inference: str(x.inference), suggestion: str(x.suggestion ?? x['suggested revision']) }
          for (const [k, v] of Object.entries(x)) if (!(k in item) && typeof v === 'string') item[k] = v
          if (typeof x.original === 'string' && x.original.trim()) item.original = x.original
          if (typeof x.replacement === 'string') item.replacement = x.replacement
          if (typeof x.imageRef === 'string') item.imageRef = x.imageRef
          return item
        })
      : []
    return { items, ...(typeof j.summary === 'string' ? { summary: j.summary } : {}) }
  } catch {
    return { items: [], raw: text }
  }
}

export function draftsToFindings(
  category: CategoryId,
  sectionId: string,
  html: string,
  parsed: { items: DraftItem[]; summary?: string; raw?: string },
): IdeaFinding[] {
  const out: IdeaFinding[] = []
  const rule = { id: `llm-${category}`, source: 'llm' as const }
  if (parsed.raw !== undefined) {
    out.push({ kind: 'observation', key: `${sectionId}::llm::${category}::raw`, category, sectionId, columns: { response: parsed.raw }, rule: { ...rule, note: 'The model did not answer in the requested shape; its reply is shown as written.' }, origin: 'draft' })
    return out
  }
  if (parsed.summary) {
    out.push({ kind: 'observation', key: `${sectionId}::llm::${category}::summary`, category, sectionId, columns: { summary: parsed.summary }, rule, origin: 'draft' })
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const blocks = blockElements(doc.body).filter((el) => el.getAttribute('id'))
  parsed.items.forEach((item, n) => {
    if (item.original && item.replacement !== undefined) {
      for (const el of blocks) {
        for (const node of textNodesOf(el)) {
          const at = node.data.indexOf(item.original)
          if (at === -1) continue
          const elementId = el.getAttribute('id')!
          const occurrence = countOccurrences(textBefore(el, node, at), item.original)
          if (!findOccurrence(el, item.original, occurrence)) continue
          out.push({
            kind: 'edit', key: ideaEditKey(sectionId, elementId, occurrence, item.original), category, sectionId, elementId,
            original: item.original, occurrence, replacement: item.replacement, inQuotation: isQuotation(el),
            rule: { ...rule, note: item.inference || item.suggestion }, origin: 'draft',
          })
          return
        }
      }
    }
    const columns: Record<string, string> = {}
    for (const [k, v] of Object.entries(item)) if (typeof v === 'string' && v && k !== 'original' && k !== 'replacement') columns[k] = v
    const elementId = item.imageRef && doc.getElementById(item.imageRef) ? item.imageRef : undefined
    out.push({ kind: 'observation', key: `${sectionId}::llm::${category}::${n}`, category, sectionId, ...(elementId ? { elementId } : {}), columns, rule, origin: 'draft' })
  })
  return out
}

export interface RubricDraft {
  /** One entry per area the model answered; `rows` always lists every Rubric 1 row of that area. */
  areas: { id: CategoryId; rows: { id: string; rating: Rating | null }[]; notes: string }[]
  raw?: string
}

const RATING: Record<string, Rating> = {
  'not applicable': 'na', 'n/a': 'na', na: 'na',
  exclusive: 'exclusive',
  'emerging inclusive': 'emerging', emerging: 'emerging',
  inclusive: 'inclusive',
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null
const toRating = (v: unknown): Rating | null => RATING[str(v).trim().toLowerCase()] ?? null

/**
 * Per ROW, because the human's rating is per row (slice 1). A "rows" array is
 * matched by id, bare ("b") or qualified ("7.1.b"); a bare "rating" on the
 * area is honoured only when the area has one row. A three-row area with one
 * rating gets three nulls: spreading it would show the model rating rows it
 * never looked at.
 */
export function parseRubricResponse(text: string): RubricDraft {
  try {
    const j = extractJson(text) as { areas?: unknown }
    const areas = (Array.isArray(j.areas) ? j.areas : [])
      .filter(isRecord)
      .map((x) => {
        const m = /^(7\.[1-8])/.exec(str(x.area).trim())
        if (!m) return undefined
        const id = m[1] as CategoryId
        const frameworkRows = categoryById(id).rows
        const given = new Map<string, Rating | null>()
        for (const r of Array.isArray(x.rows) ? x.rows.filter(isRecord) : []) {
          const rowId = str(r.row).trim()
          const full = rowId.startsWith(`${id}.`) ? rowId : `${id}.${rowId}`
          if (frameworkRows.some((fr) => fr.id === full)) given.set(full, toRating(r.rating))
        }
        if (given.size === 0 && frameworkRows.length === 1 && x.rating !== undefined) given.set(frameworkRows[0]!.id, toRating(x.rating))
        return { id, rows: frameworkRows.map((fr) => ({ id: fr.id, rating: given.get(fr.id) ?? null })), notes: str(x.notes) }
      })
      .filter((x): x is NonNullable<typeof x> => x !== undefined)
    return { areas }
  } catch {
    return { areas: [], raw: text }
  }
}
```
(add `categoryById` to this file's import from `../framework`.)
(`textBefore` is exported from `terms.ts` in slice 2; move it into `text.ts` as part of this task and re-export from `terms.ts` so both imports work — one definition.)

- [ ] **Step 5: Run the tests, typecheck, commit**

Run: `npx vitest run --project unit src/engine/idea/ && npm run typecheck`
Expected: PASS.

```bash
git add src/engine/idea
git commit -m "feat: OERI's IDEA prompts and a parser that lets a model propose but not edit unquoted text

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 4: Settings hook and panel

**Files:**
- Create: `src/components/idea/useLlmSettings.ts`, `src/components/idea/LlmSettingsPanel.tsx`
- Modify: `src/components/idea/copy.ts`
- Test: `src/components/idea/LlmSettingsPanel.test.tsx`

**Interfaces:**
```ts
export function useLlmSettings(store?: LlmSettingsStore): {
  settings: LlmSettings | undefined; loaded: boolean
  save: (s: LlmSettings) => Promise<void>; forget: () => Promise<void>
}
export function LlmSettingsPanel(props: { settings: LlmSettings | undefined; onSave: (s: LlmSettings) => void; onForget: () => void }): JSX.Element
```

- [ ] **Step 1: Copy**

Add to `IDEA_COPY`:
```ts
  llm: {
    legend: 'Model provider (optional)',
    intro: 'Bring your own API key to draft suggestions for the categories a rule cannot check. Drafts are never applied on their own.',
    provider: 'Provider',
    key: 'API key',
    model: 'Model',
    save: 'Save on this device',
    forget: 'Forget key',
    showKey: 'Show key',
    hideKey: 'Hide key',
    stored: 'Your key is stored in this browser on this device (not on any server) and stays until you choose Forget key. On a shared computer, forget it when you are done.',
    notOffered: (label: string) => `${label} cannot be called from a browser directly, so it is not offered here.`,
    evidence: 'measured',
    terms: (label: string) => `${label} terms`,
    none: 'No provider set. Add a key above to draft suggestions for this category, or use the checklist.',
    send: (label: string) => `Send this section to ${label}`,
    sending: (label: string) => `Waiting for ${label}…`,
    cancel: 'Cancel',
    sends: 'What leaves your browser when you press the button: this section’s text and its image descriptions (for 7.1, only the image descriptions). Nothing is sent until you press it.',
    draftLabel: 'Drafts',
    error: {
      'bad-key': 'The provider rejected this key. Check it in the settings above.',
      'model-not-found': 'The provider does not know this model name. Check it in the settings above.',
      'rate-limited': 'The provider is rate-limiting this key.',
      unreachable: 'The provider could not be reached from this browser.',
      timeout: 'The provider did not answer in time.',
      aborted: 'Cancelled.',
    } as const,
    rubricDraft: {
      button: (label: string) => `Draft a Rubric 1 review with ${label}`,
      column: 'Model draft',
      useNote: 'Use this note',
      cannotCopy: 'A draft rating is shown for comparison only; choose your own rating.',
    },
  },
```

- [ ] **Step 2: Write the failing test**

`src/components/idea/LlmSettingsPanel.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { LlmSettingsPanel } from './LlmSettingsPanel'
import { PROVIDERS } from '../../engine/idea/llm/providers'

test('lists offered providers, prefills the default model, saves, and never renders the key as text', () => {
  const onSave = vi.fn()
  render(<LlmSettingsPanel settings={undefined} onSave={onSave} onForget={vi.fn()} />)
  const select = screen.getByRole('combobox', { name: 'Provider' })
  for (const p of PROVIDERS.filter((x) => x.offered)) expect(screen.getByRole('option', { name: p.label })).toBeInTheDocument()
  fireEvent.change(select, { target: { value: 'openrouter' } })
  expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue(PROVIDERS.find((p) => p.id === 'openrouter')!.defaultModel)
  const key = screen.getByLabelText('API key') as HTMLInputElement
  expect(key.type).toBe('password')
  fireEvent.change(key, { target: { value: 'sk-abc' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save on this device' }))
  expect(onSave).toHaveBeenCalledWith({ provider: 'openrouter', key: 'sk-abc', model: PROVIDERS.find((p) => p.id === 'openrouter')!.defaultModel })
  expect(document.body.textContent).not.toContain('sk-abc')
})

test('says where the key is stored and offers Forget key when one is saved', () => {
  const onForget = vi.fn()
  render(<LlmSettingsPanel settings={{ provider: 'gemini', key: 'k', model: 'gemini-2.5-flash' }} onSave={vi.fn()} onForget={onForget} />)
  expect(screen.getByText(/stored in this browser on this device/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Forget key' }))
  expect(onForget).toHaveBeenCalled()
})

test('a provider that is not offered is listed as unavailable with the evidence link, and cannot be chosen', () => {
  const notOffered = PROVIDERS.find((p) => !p.offered)
  if (!notOffered) return // every provider passed the probe; nothing to assert
  render(<LlmSettingsPanel settings={undefined} onSave={vi.fn()} onForget={vi.fn()} />)
  expect(screen.getByRole('option', { name: new RegExp(notOffered.label) })).toBeDisabled()
  expect(screen.getByText(new RegExp(`${notOffered.label} cannot be called from a browser directly`))).toBeInTheDocument()
})
```

- [ ] **Step 3: Write the hook**

`src/components/idea/useLlmSettings.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { createIdbStore } from '../../canvas/idb'
import { createLlmSettingsStore, type LlmSettings, type LlmSettingsStore } from '../../engine/idea/llm/settings'

export function useLlmSettings(store?: LlmSettingsStore) {
  const ref = useRef(store ?? createLlmSettingsStore(createIdbStore()))
  const [settings, setSettings] = useState<LlmSettings | undefined>()
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let live = true
    ref.current.load().then((s) => { if (live) { setSettings(s); setLoaded(true) } }).catch(() => { if (live) setLoaded(true) })
    return () => { live = false }
  }, [])
  const save = useCallback(async (s: LlmSettings) => { await ref.current.save(s); setSettings(s) }, [])
  const forget = useCallback(async () => { await ref.current.forget(); setSettings(undefined) }, [])
  return { settings, loaded, save, forget }
}
```

- [ ] **Step 4: Write the panel**

`src/components/idea/LlmSettingsPanel.tsx`:
```tsx
import { useId, useState } from 'react'
import { Eye, EyeOff, ExternalLink } from 'lucide-react'
import { PROVIDERS, providerById, type ProviderId } from '../../engine/idea/llm/providers'
import type { LlmSettings } from '../../engine/idea/llm/settings'
import { IDEA_COPY } from './copy'

const TARGET = 'min-h-9 min-w-9'
const FIELD = 'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'

export function LlmSettingsPanel({
  settings, onSave, onForget,
}: {
  settings: LlmSettings | undefined
  onSave: (s: LlmSettings) => void
  onForget: () => void
}) {
  const id = useId()
  const c = IDEA_COPY.llm
  const firstOffered = PROVIDERS.find((p) => p.offered)?.id ?? 'gemini'
  const [provider, setProvider] = useState<ProviderId>(settings?.provider ?? firstOffered)
  const [key, setKey] = useState(settings?.key ?? '')
  const [model, setModel] = useState(settings?.model ?? providerById(provider).defaultModel)
  const [shown, setShown] = useState(false)
  const current = providerById(provider)

  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="text-sm font-semibold">{c.legend}</legend>
      <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{c.intro}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>{c.provider}</span>
          <select className={`${FIELD} ${TARGET}`} value={provider} onChange={(e) => { const p = e.target.value as ProviderId; setProvider(p); setModel(providerById(p).defaultModel) }}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.offered}>{p.offered ? p.label : `${p.label} (not available)`}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${id}-key`}>{c.key}</label>
          <div className="flex gap-1">
            <input id={`${id}-key`} type={shown ? 'text' : 'password'} autoComplete="off" spellCheck={false} className={`${FIELD} ${TARGET} w-64`} value={key} onChange={(e) => setKey(e.target.value)} />
            <button type="button" className={`${TARGET} rounded-md border border-neutral-300 px-2 dark:border-neutral-700`} aria-label={shown ? c.hideKey : c.showKey} onClick={() => setShown((s) => !s)}>
              {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span>{c.model}</span>
          <input type="text" className={`${FIELD} ${TARGET} w-56`} value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <button type="button" className={`${TARGET} rounded-md border border-brand-700 bg-brand-700 px-3 text-sm text-white`} onClick={() => onSave({ provider, key, model })}>{c.save}</button>
        {settings && <button type="button" className={`${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`} onClick={onForget}>{c.forget}</button>}
      </div>
      <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{c.stored}</p>
      <p className="m-0 text-xs">
        {current.dataUse}{' '}
        <a href={current.termsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
          {c.terms(current.label)}<ExternalLink className="size-3" aria-hidden="true" /><span className="sr-only">({IDEA_COPY.opensNewTab})</span>
        </a>
      </p>
      {PROVIDERS.filter((p) => !p.offered).map((p) => (
        <p key={p.id} className="m-0 text-xs text-neutral-600 dark:text-neutral-400">
          {c.notOffered(p.label)} <a href={`https://github.com/johnnylibretexts/oer2canvas/blob/main/${p.evidence}`} className="underline">{c.evidence}</a>
        </p>
      ))}
    </fieldset>
  )
}
```
(Replace the evidence link base with the repository's actual public URL from `package.json`/README; if none, render the path as text.)

- [ ] **Step 5: Run, typecheck, commit**

Run: `npx vitest run --project unit src/components/idea/LlmSettingsPanel.test.tsx && npm run typecheck`

```bash
git add src/components/idea/useLlmSettings.ts src/components/idea/LlmSettingsPanel.tsx src/components/idea/LlmSettingsPanel.test.tsx src/components/idea/copy.ts
git commit -m "feat: model provider settings, stored in the user's browser and nowhere else

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 5: Runs, the Ask-the-model zone, and the rubric draft column

**Files:**
- Create: `src/components/idea/useModelRuns.ts`, `src/components/idea/AskModel.tsx`
- Modify: `src/components/idea/CategoryPanel.tsx`, `src/components/idea/IdeaScreen.tsx`, `src/App.tsx`
- Test: `src/components/idea/useModelRuns.test.ts`, `src/components/idea/AskModel.test.tsx`, `src/components/idea/CategoryPanel.test.tsx` (append)

**Interfaces:**
```ts
export type RunState =
  | { status: 'idle' } | { status: 'running'; controller: AbortController }
  | { status: 'done'; findings: IdeaFinding[]; at: number } | { status: 'failed'; failure: LlmFailure; message: string }
export function useModelRuns(args: { settings: LlmSettings | undefined; deps?: { complete: typeof complete } }): {
  runs: ReadonlyMap<string, RunState>                       // key `${chapterKey}::${sectionId}::${category}` or `${chapterKey}::rubric`
  runCategory: (chapterKey: string, category: DraftableCategory, input: SectionInput, html: string) => void
  runRubric: (chapterKey: string, chapterTitle: string, sections: SectionInput[]) => void
  rubricDrafts: ReadonlyMap<string, RubricDraft>
  cancel: (key: string) => void
  cancelAll: () => void
}
export function AskModel(props: { provider: LlmProvider | undefined; state: RunState; onSend: () => void; onCancel: () => void; firstRun: boolean }): JSX.Element
```

- [ ] **Step 1: Write the failing tests**

`src/components/idea/useModelRuns.test.ts`:
```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { useModelRuns } from './useModelRuns'
import type { SectionInput } from '../../engine/idea/llm/prompts'
import { LlmError } from '../../engine/idea/llm/client'

const settings = { provider: 'openrouter' as const, key: 'k', model: 'm' }
const input: SectionInput = { sectionId: 's1', sectionTitle: 'S', chapterTitle: 'C', text: 'The chairman spoke.', images: [], metadata: [] }
const html = '<p id="b2c-blk-0">The chairman spoke.</p>'

test('a category run posts once, parses, and stores draft findings; nothing runs without a click', async () => {
  const complete = vi.fn(async () => ({ text: JSON.stringify({ summary: 's', items: [{ evidence: 'chairman', inference: 'gendered', suggestion: 'chair', original: 'chairman', replacement: 'chair' }] }) }))
  const { result } = renderHook(() => useModelRuns({ settings, deps: { complete } }))
  expect(complete).not.toHaveBeenCalled()
  act(() => result.current.runCategory('ch', '7.2', input, html))
  expect(result.current.runs.get('ch::s1::7.2')?.status).toBe('running')
  await waitFor(() => expect(result.current.runs.get('ch::s1::7.2')?.status).toBe('done'))
  const done = result.current.runs.get('ch::s1::7.2')
  expect(done?.status === 'done' && done.findings.map((f) => f.kind)).toEqual(['observation', 'edit'])
  expect(complete).toHaveBeenCalledTimes(1)
})

test('a failure is stored with its mapped state', async () => {
  const complete = vi.fn(async () => { throw new LlmError('bad-key', 'rejected') })
  const { result } = renderHook(() => useModelRuns({ settings, deps: { complete } }))
  act(() => result.current.runCategory('ch', '7.2', input, html))
  await waitFor(() => expect(result.current.runs.get('ch::s1::7.2')?.status).toBe('failed'))
  expect(result.current.runs.get('ch::s1::7.2')).toMatchObject({ failure: 'bad-key' })
})

test('a second click while running is ignored; cancel aborts', async () => {
  let resolve: (v: { text: string }) => void = () => {}
  const complete = vi.fn(() => new Promise<{ text: string }>((r) => { resolve = r }))
  const { result } = renderHook(() => useModelRuns({ settings, deps: { complete } }))
  act(() => result.current.runCategory('ch', '7.2', input, html))
  act(() => result.current.runCategory('ch', '7.2', input, html))
  expect(complete).toHaveBeenCalledTimes(1)
  act(() => result.current.cancel('ch::s1::7.2'))
  expect(result.current.runs.get('ch::s1::7.2')?.status).toBe('idle')
  resolve({ text: '{}' })
})

test('the rubric run stores a draft per chapter', async () => {
  const complete = vi.fn(async () => ({ text: JSON.stringify({ areas: [{ area: '7.1', rating: 'Inclusive', notes: 'n' }] }) }))
  const { result } = renderHook(() => useModelRuns({ settings, deps: { complete } }))
  act(() => result.current.runRubric('ch', 'C', [input]))
  await waitFor(() => expect(result.current.rubricDrafts.get('ch')?.areas).toEqual([
    { id: '7.1', rows: [{ id: '7.1.a', rating: null }, { id: '7.1.b', rating: null }, { id: '7.1.c', rating: null }], notes: 'n' },
  ]))
})
```

`src/components/idea/AskModel.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { AskModel } from './AskModel'
import { providerById } from '../../engine/idea/llm/providers'

test('without a provider it explains and offers no button', () => {
  render(<AskModel provider={undefined} state={{ status: 'idle' }} onSend={vi.fn()} onCancel={vi.fn()} firstRun />)
  expect(screen.getByText(/No provider set/)).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('with a provider the button names it, the disclosure is above it, and nothing is sent until clicked', () => {
  const onSend = vi.fn()
  const { container } = render(<AskModel provider={providerById('gemini')} state={{ status: 'idle' }} onSend={onSend} onCancel={vi.fn()} firstRun />)
  const button = screen.getByRole('button', { name: 'Send this section to Gemini' })
  const disclosure = screen.getByText(/What leaves your browser/)
  expect(disclosure.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(container.textContent).toContain('Google’s Gemini API terms govern')
  expect(onSend).not.toHaveBeenCalled()
  fireEvent.click(button)
  expect(onSend).toHaveBeenCalledTimes(1)
})

test('running shows a cancel; failed shows the mapped message', () => {
  const onCancel = vi.fn()
  const { rerender } = render(<AskModel provider={providerById('gemini')} state={{ status: 'running', controller: new AbortController() }} onSend={vi.fn()} onCancel={onCancel} firstRun={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalled()
  rerender(<AskModel provider={providerById('gemini')} state={{ status: 'failed', failure: 'bad-key', message: 'x' }} onSend={vi.fn()} onCancel={vi.fn()} firstRun={false} />)
  expect(screen.getByText(/rejected this key/)).toBeInTheDocument()
})
```

Append to `src/components/idea/CategoryPanel.test.tsx`:
```tsx
test('the rubric draft renders beside the row’s rating with no control that sets the rating', () => {
  render(
    <CategoryPanel category={categoryById('7.2')} review={newReview().categories['7.2']} open onToggle={vi.fn()} onEvent={vi.fn()}
      rubricDraft={{ rows: [{ id: '7.2.a', rating: 'emerging' }], notes: 'Names are mostly Anglo.' }} />,
  )
  expect(screen.getByText('Model draft')).toBeInTheDocument()
  expect(screen.getByText('Emerging Inclusive', { selector: '.b2c-idea-draft *' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Use this note' })).toBeInTheDocument()
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  expect(within(rubric).getByRole('radio', { name: /^Emerging Inclusive/ })).not.toBeChecked()
  expect(screen.queryByRole('button', { name: /use this rating/i })).not.toBeInTheDocument()
})

// 7.1 has three rows and the draft is per row; each row's draft sits beside
// THAT row, and a row the model left null says so rather than borrowing a
// neighbour's word.
test('a three-row area shows one draft per row', () => {
  render(
    <CategoryPanel category={categoryById('7.1')} review={newReview().categories['7.1']} open onToggle={vi.fn()} onEvent={vi.fn()}
      rubricDraft={{ rows: [{ id: '7.1.a', rating: 'exclusive' }, { id: '7.1.b', rating: null }, { id: '7.1.c', rating: 'inclusive' }], notes: 'n' }} />,
  )
  const drafts = screen.getAllByText(/^Model draft/, { selector: '.b2c-idea-draft *' })
  expect(drafts).toHaveLength(3)
  const groups = within(screen.getByRole('group', { name: /Rubric 1/ })).getAllByRole('radiogroup')
  expect(groups[0]!.parentElement).toHaveTextContent('Exclusive')
  expect(groups[1]!.parentElement).toHaveTextContent('no draft')
  expect(groups[2]!.parentElement).toHaveTextContent('Inclusive')
})

test('Use this note dispatches a note event with the draft text', () => {
  const onEvent = vi.fn()
  render(<CategoryPanel category={categoryById('7.2')} review={newReview().categories['7.2']} open onToggle={vi.fn()} onEvent={onEvent} rubricDraft={{ rows: [{ id: '7.2.a', rating: null }], notes: 'draft note' }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Use this note' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'note', categoryId: '7.2', notes: 'draft note' })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/components/idea/`
Expected: FAIL — modules/props missing.

- [ ] **Step 3: Write `useModelRuns.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { complete as defaultComplete, LlmError, type LlmFailure } from '../../engine/idea/llm/client'
import { providerById } from '../../engine/idea/llm/providers'
import type { LlmSettings } from '../../engine/idea/llm/settings'
import { categoryPrompt, rubricPrompt, type DraftableCategory, type SectionInput } from '../../engine/idea/llm/prompts'
import { draftsToFindings, parseCategoryResponse, parseRubricResponse, type RubricDraft } from '../../engine/idea/llm/parse'
import type { IdeaFinding } from '../../engine/idea/findings'

export type RunState =
  | { status: 'idle' }
  | { status: 'running'; controller: AbortController }
  | { status: 'done'; findings: IdeaFinding[]; at: number }
  | { status: 'failed'; failure: LlmFailure; message: string }

export const runKey = (chapterKey: string, sectionId: string, category: string) => `${chapterKey}::${sectionId}::${category}`

export function useModelRuns({ settings, deps = { complete: defaultComplete } }: { settings: LlmSettings | undefined; deps?: { complete: typeof defaultComplete } }) {
  const [runs, setRuns] = useState<ReadonlyMap<string, RunState>>(new Map())
  const [rubricDrafts, setRubricDrafts] = useState<ReadonlyMap<string, RubricDraft>>(new Map())
  const live = useRef<Map<string, AbortController>>(new Map())

  const set = (key: string, state: RunState) => setRuns((m) => { const n = new Map(m); n.set(key, state); return n })

  const start = useCallback((key: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (!settings) return
    if (live.current.has(key)) return
    const controller = new AbortController()
    live.current.set(key, controller)
    set(key, { status: 'running', controller })
    work(controller.signal)
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        const err = e instanceof LlmError ? e : new LlmError('unreachable', 'Unexpected failure.')
        set(key, { status: 'failed', failure: err.failure, message: err.message })
      })
      .finally(() => { live.current.delete(key) })
  }, [settings])

  const runCategory = useCallback((chapterKey: string, category: DraftableCategory, input: SectionInput, html: string) => {
    const key = runKey(chapterKey, input.sectionId, category)
    start(key, async (signal) => {
      const provider = providerById(settings!.provider)
      const { text } = await deps.complete(provider, settings!, categoryPrompt(category, input), signal)
      if (signal.aborted) return
      set(key, { status: 'done', findings: draftsToFindings(category, input.sectionId, html, parseCategoryResponse(text)), at: Date.now() })
    })
  }, [start, settings, deps])

  const runRubric = useCallback((chapterKey: string, chapterTitle: string, sections: SectionInput[]) => {
    const key = `${chapterKey}::rubric`
    start(key, async (signal) => {
      const provider = providerById(settings!.provider)
      const { text } = await deps.complete(provider, settings!, rubricPrompt(chapterTitle, sections), signal)
      if (signal.aborted) return
      setRubricDrafts((m) => { const n = new Map(m); n.set(chapterKey, parseRubricResponse(text)); return n })
      set(key, { status: 'done', findings: [], at: Date.now() })
    })
  }, [start, settings, deps])

  const cancel = useCallback((key: string) => {
    live.current.get(key)?.abort()
    live.current.delete(key)
    set(key, { status: 'idle' })
  }, [])

  const cancelAll = useCallback(() => { for (const k of [...live.current.keys()]) cancel(k) }, [cancel])

  // Phase exit / unmount aborts everything in flight.
  useEffect(() => () => { for (const c of live.current.values()) c.abort() }, [])

  return { runs, runCategory, runRubric, rubricDrafts, cancel, cancelAll }
}
```

- [ ] **Step 4: Write `AskModel.tsx`**

```tsx
import { ExternalLink } from 'lucide-react'
import type { LlmProvider } from '../../engine/idea/llm/providers'
import type { RunState } from './useModelRuns'
import { IDEA_COPY } from './copy'

const TARGET = 'min-h-9 min-w-9'

export function AskModel({ provider, state, onSend, onCancel, firstRun }: {
  provider: LlmProvider | undefined
  state: RunState
  onSend: () => void
  onCancel: () => void
  /** Expanded disclosure on the first run of the session; collapsed but present afterwards. */
  firstRun: boolean
}) {
  const c = IDEA_COPY.llm
  if (!provider) return <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{c.none}</p>
  const disclosure = (
    <p className="m-0 text-xs text-neutral-700 dark:text-neutral-300">
      {c.sends} {provider.dataUse}{' '}
      <a href={provider.termsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
        {c.terms(provider.label)}<ExternalLink className="size-3" aria-hidden="true" /><span className="sr-only">({IDEA_COPY.opensNewTab})</span>
      </a>
    </p>
  )
  return (
    <div className="flex flex-col gap-2">
      {firstRun ? disclosure : <details><summary className="cursor-pointer text-xs">{c.sends.split(':')[0]}</summary>{disclosure}</details>}
      {state.status === 'running' ? (
        <div className="flex items-center gap-2">
          <span role="status" className="text-sm">{c.sending(provider.label)}</span>
          <button type="button" className={`${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`} onClick={onCancel}>{c.cancel}</button>
        </div>
      ) : (
        <div>
          <button type="button" className={`${TARGET} rounded-md border border-brand-700 bg-brand-700 px-3 text-sm text-white`} onClick={onSend}>{c.send(provider.label)}</button>
        </div>
      )}
      {state.status === 'failed' && <p role="alert" className="m-0 text-sm">{c.error[state.failure]}{state.failure === 'rate-limited' ? ` ${state.message}` : ''}</p>}
    </div>
  )
}
```

- [ ] **Step 5: `CategoryPanel.tsx`**

New props: `askModel?: { provider: LlmProvider | undefined; state: RunState; onSend: () => void; onCancel: () => void; firstRun: boolean }`, `draftFindings?: readonly IdeaFinding[]`, `rubricDraft?: { rows: readonly { id: string; rating: Rating | null }[]; notes: string }`.

- For categories in `DRAFTABLE`, render an **Ask the model** fieldset (legend `IDEA_COPY.llm.draftLabel` → use heading text "Ask the model") after the rule/inventory zone: `<AskModel {...askModel} />`, then `draftFindings` as `FindingRow`s (they carry `origin: 'draft'` and render dashed).
- Slice 1's `RubricRowChoice` gains an optional `draft?: Rating | null` prop (`undefined` = no draft run yet; `null` = the model gave nothing for this row). When it is not `undefined`, it renders, between the row label and the radios:
  ```tsx
  <p className="b2c-idea-draft m-0 rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">
    <span className="font-semibold">{IDEA_COPY.llm.rubricDraft.column}: </span>
    <span>{draft ? RATING_COPY[draft] : IDEA_COPY.llm.rubricDraft.noDraft}</span>
  </p>
  ```
  `CategoryPanel` passes `draft={rubricDraft ? (rubricDraft.rows.find((r) => r.id === row.id)?.rating ?? null) : undefined}` to each row. Add `noDraft: 'no draft'` under `IDEA_COPY.llm.rubricDraft`.
- After the rows, when `rubricDraft` is present, the notes block:
  ```tsx
  <div className="b2c-idea-draft rounded-md border border-neutral-300 p-3 text-sm dark:border-neutral-700">
    <p className="m-0 font-semibold">{IDEA_COPY.llm.rubricDraft.column}</p>
    <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{IDEA_COPY.llm.rubricDraft.cannotCopy}</p>
    <p className="m-0">{rubricDraft.notes}</p>
    {rubricDraft.notes && <button type="button" className={`${TARGET} rounded-md border border-neutral-300 px-2 text-sm dark:border-neutral-700`} onClick={() => onEvent({ type: 'note', categoryId: category.id, notes: rubricDraft.notes })}>{IDEA_COPY.llm.rubricDraft.useNote}</button>}
  </div>
  ```
  There is deliberately no handler that dispatches `rate` from either block.

- [ ] **Step 6: `IdeaScreen.tsx` and `App.tsx`**

`IdeaScreen` gains props `llm: { settings: LlmSettings | undefined; onSave; onForget; runs; rubricDrafts; runCategory; runRubric; cancel }` — beside slice 1's `header` / `onHeaderEvent` / `onForget` / `onExport` and slice 2's `edits` / `onEditEvent` / `pending`, all of which stay. Extend slice 2's `base` object in `IdeaScreen.test.tsx` and the `props` object in `IdeaScreen.browser.test.tsx` with an `llm` stub (`settings: undefined`, `runs: new Map()`, `rubricDrafts: new Map()`, and no-op functions) so existing renders keep compiling; slice 5 reuses that stub as `llmStub`. In the header card, below slice 1's storage sentence and *Forget all IDEA reviews*, render `<LlmSettingsPanel …/>` (its own *Forget key* — the review forget does not touch the key, and the panel's copy says the key is separate) and, when a provider is set, a "Draft a Rubric 1 review with {label}" button that calls `runRubric(key, current.chapter.title, inputs)`. Build `inputs: SectionInput[]` with `useMemo` from `current.sections`: `{ sectionId, sectionTitle: s.title, chapterTitle: current.chapter.title, discipline: current.chapter.attribution.bookTitle, text: sectionText(html), images: imageInventory(s.id, html), metadata: metadataInventory(s.id, html) }` where `html = s.gate?.html ?? s.html`. For each draftable category, pass `askModel` (state from `runs.get(runKey(key, firstSection.id, category))`, `onSend` → `runCategory` for **each** section of the chapter — one request per section, sequentially through `start`'s per-key guard) and `draftFindings` = the union of done runs' findings for that category, filtered by `edits`/`dismissed` like rule findings. `firstRun` = no run in `runs` has status `done` or `failed`.

`App`: `const llmStore = useMemo(() => createLlmSettingsStore(disk), [])` over the same module-level `createIdbStore()` slice 1 hands to `useIdeaReviews`, then `const llm = useLlmSettings(llmStore)`; `const modelRuns = useModelRuns({ settings: llm.settings })`; pass `llm={{ settings: llm.settings, onSave: llm.save, onForget: llm.forget, ...modelRuns }}`; call `modelRuns.cancelAll()` when `phase` changes away from `'idea'` (a `useEffect` on `phase`). Draft findings that the instructor accepts go through `ideaReviews.dispatchEdit` like rule findings and persist with them; the drafts themselves do not.

- [ ] **Step 7: Run, typecheck, browser a11y, commit**

Run: `npm run typecheck && npx vitest run --project unit src/components/idea/ src/App.test.tsx && npx vitest run --project browser src/components/idea/`
Expected: PASS (the a11y test now renders the settings panel; a `password` input with a visible label passes).

```bash
git add src/components/idea src/App.tsx
git commit -m "feat: ask the model per category, drafts beside the rubric, rating never copied

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 6: Disclosures and acceptance

**Files:**
- Modify: `PRIVACY.md`, `README.md`, `docs/IDEA.md`, `docs/RELEASE-ACCEPTANCE.md`, `src/docs-claims.test.ts`, `src/import/web-key-containment.test.ts` (comment enumeration only)

- [ ] **Step 1: Obligation test**

Add to `src/docs-claims.test.ts` obligations:
```ts
    ['idea model key on device', /(model|provider) (API )?key[^.\n]*(this|your) (browser|device)[^.\n]*(never|not)[^.\n]*server/i],
    ['idea model send on click', /(nothing|no text)[^.\n]*sent[^.\n]*(until|unless)[^.\n]*(press|click)/i],
```

- [ ] **Step 2: PRIVACY.md**

Append after the Firecrawl paragraphs:
```markdown
The optional **IDEA review** can draft suggestions with a model provider you choose — Gemini
(Google AI Studio), OpenRouter, or Ollama Cloud — on your own API key. That key is stored in your
browser on this device, in the same local database that holds the Canvas address, and is never
sent to, stored on, or forwarded by this app's server; there is no server-side path for it at
all. When you press "Send this section to <provider>", the section's text and its image
descriptions go directly from your browser to that provider; for the illustrations category only
the image descriptions are sent. Nothing is sent until you press the button, never on a keystroke
or in the background. The provider's own terms govern what it does with the text; the link beside
the key field points to them. "Forget key" removes the key from this device. Drafts the model
returns are shown as drafts; none is applied to a page unless you accept it, and no rating is ever
taken from a model.
```

- [ ] **Step 3: README, IDEA.md, acceptance**

README — after the slice-3 sentence:
```markdown
For the categories no rule can check, the IDEA review can ask a model — Gemini, OpenRouter, or
Ollama Cloud — on your own API key, using the ASCCC OERI IDEA Framework Gen-AI Crosswalk's prompt
shapes. The key is stored in your browser on this device and never on this app's server; nothing
is sent until you press the button; every model output is labelled a draft, becomes an edit only
if it quotes the text verbatim, and never sets a rating.
```
`docs/IDEA.md` — heading "Slices 1–4"; move the "Later slices" model bullet into the shipped list and add: *"Providers offered are those a browser origin was measured to reach directly (`docs/evidence/idea-llm-cors-<date>.md`); a provider that fails that probe is not offered, and there is no relay fallback."*

`docs/RELEASE-ACCEPTANCE.md`:
```markdown
## 7. IDEA review — slice 4

1. IDEA header: choose OpenRouter, paste a key, Save on this device. Reload the tab: the provider
   and model are remembered; the key field shows dots.
2. Open 7.2. The disclosure sits above "Send this section to OpenRouter". Press it; the status
   line reads "Waiting for OpenRouter…"; drafts appear with a dashed border and a "draft" chip.
3. A draft whose original matches the text has Replace; accept one; it lands in Applied and in the
   chapter render beside the panels. Reload and re-prepare: the accepted edit is still applied;
   the unaccepted drafts are gone until you send again.
4. Press "Draft a Rubric 1 review with OpenRouter". Every rubric row shows a "Model draft:" line
   beside its radios — three under 7.1, one elsewhere, "no draft" where the model gave nothing —
   and each category a notes box; the radio buttons stay unchecked; "Use this note" fills Notes
   only.
5. Paste a wrong key, Save, send again: "The provider rejected this key." No key text anywhere
   on screen or in DevTools → Network → request URL.
6. Forget key; reload: nothing is remembered. DevTools → Application → IndexedDB → oer2canvas →
   kv: no `idea.llm.settings` key; the `idea.reviews` document is untouched. Then *Forget all
   IDEA reviews*: reviews go, and a saved key would stay.
7. Network tab throughout: no request to `/relay`.
```

- [ ] **Step 4: Full suite and commit**

Run: `npm run typecheck && npm test`

```bash
git add PRIVACY.md README.md docs/IDEA.md docs/RELEASE-ACCEPTANCE.md src/docs-claims.test.ts
git commit -m "docs: disclose the IDEA model path — key on device, send on click, drafts only

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (§8.4):** CORS spike first with `offered` from evidence, no relay fallback (§4.2) → Tasks 1–2; one adapter, three presets, Bearer, OpenAI dialect, 60 s, one in-flight per category, abort on phase exit, four error states (§4.1) → Tasks 2, 5; key in IndexedDB on device only, Forget key, shared-computer warning (§2.6) → Tasks 2, 4; prompts with inlined lens, OERI column shapes, evidence/inference separation, 7.1 gets inventory not pixels (§4.3) → Task 3; verbatim-match promotion to edit (§4.3) → Task 3; rubric draft column, rating not copyable, note copyable (§4.4) → Task 5; consent line above the button naming the provider, expanded first run (§4.5) → Task 5; settings panel, no-key sentence (§4.6) → Tasks 4–5; disclosures (§7.2) → Task 6. 7.3 and 7.6 are rule-only by spec and are not draftable here.

**Placeholder scan:** `EVIDENCE = 'docs/evidence/idea-llm-cors-YYYY-MM-DD.md'` is an explicit instruction to substitute the real filename in Task 2 Step 3, not a placeholder left to chance; the evidence-link base in Task 4 likewise names its source. No "TBD".

**Alignment with the revised slices 1–2 (2026-09-11):** `RubricDraft.areas[].rows` mirrors slice 1's per-row `ratings`; `RubricRowChoice.draft` renders each row's draft beside that row; `IdeaScreen` keeps every earlier prop and tests extend the shared `base` / `props` objects with an `llm` stub; accepted drafts persist through `dispatchEdit`, drafts and runs do not; the model key and the review document are separate IndexedDB keys with separate forget controls.

**Type consistency:** `complete(provider, settings, messages, signal, deps)` identical in Tasks 2, 5; `RunState`/`runKey` in Task 5 test and hook; `SectionInput` in Tasks 3, 5; `draftsToFindings(category, sectionId, html, parsed)` in Tasks 3, 5; `RubricDraft` rows shape identical in Task 3 parser, Task 5 hook test, and Task 5 panel props; `LlmSettings` in Tasks 2, 4, 5; `textBefore` moved to `text.ts` in Task 3 with a re-export kept in `terms.ts`.
