/**
 * One request, one response, four things that can go wrong — and NEVER the
 * key in a message. Modeled on `import/firecrawl.ts`: injected fetch, a hand
 * -rolled two-source abort (jsdom's AbortSignal is not Node's), vendor error
 * text treated as data and never rendered.
 */
import type { LlmProvider } from './providers'

export type LlmFailure = 'bad-key' | 'model-not-found' | 'rate-limited' | 'unreachable' | 'unreadable' | 'timeout' | 'aborted'

export class LlmError extends Error {
  constructor(public readonly failure: LlmFailure, message: string, public readonly retryAfterSeconds?: number) {
    super(message)
    this.name = 'LlmError'
  }
}

export interface CompleteDeps {
  fetch?: typeof globalThis.fetch
  /** Per call; the book review (one request over a whole book) passes a longer one. */
  timeoutMs?: number
}

export const LLM_TIMEOUT_MS = 60_000
export const BOOK_TIMEOUT_MS = 180_000

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

  const timeoutMs = deps.timeoutMs ?? LLM_TIMEOUT_MS
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)

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
    } catch {
      if (signal.aborted) throw new LlmError('aborted', 'Cancelled.')
      if (timedOut) throw new LlmError('timeout', `${provider.label} did not answer in ${timeoutMs / 1000} seconds. Try again.`)
      throw new LlmError('unreachable', `${provider.label} could not be reached from this browser. Check your connection and try again.`)
    }
    const badKey = () => new LlmError('bad-key', `${provider.label} rejected this API key. Check that it is current and pasted in full.`)
    if (response.status === 401 || response.status === 403) throw badKey()
    // Measured 2026-09-12: Gemini's OpenAI-compatible endpoint answers a wrong
    // key with 400 "Please pass a valid API key", not 401. The body is read to
    // classify and is still never rendered.
    if (response.status === 400) {
      const body = await response.text().catch(() => '')
      if (/api key|authorization/i.test(body)) throw badKey()
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
    signal.removeEventListener('abort', onAbort)
  }
}
