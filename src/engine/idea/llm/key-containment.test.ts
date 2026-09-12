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
