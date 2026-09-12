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
  const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit]
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
