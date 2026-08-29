import { importWebArticle, type FetchedArticle, type WebArticleFetcher } from './web'

const metadata = {
  title: 'Photosynthesis',
  sourceUrl: '',                    // replaced by the extracted URL; see below
  rightsAuthority: 'permission' as const,
  rightsAcknowledged: true,
}

/** A fetcher with no vendor in it. If these tests need Firecrawl, the seam leaked. */
function stub(overrides: Partial<FetchedArticle> = {}): WebArticleFetcher {
  return async (url) => ({
    markdown: '# Photosynthesis\n\nPlants convert light.',
    finalUrl: url,
    statusCode: 200,
    parser: 'firecrawl' as const,
    ...overrides,
  })
}

test('a good article becomes one section with provenance from the extracted url', async () => {
  const result = await importWebArticle('https://en.wikipedia.org/wiki/Photosynthesis', {
    metadata, fetcher: stub(),
  })
  expect(result.work.sections).toHaveLength(1)
  expect(result.work.provenance.sourceUrl).toBe('https://en.wikipedia.org/wiki/Photosynthesis')
  expect(result.report.parser).toBe('firecrawl')
})

test('a private, non-https, or credential-bearing target never reaches the fetcher', async () => {
  /*
   * The service is itself an SSRF vector. Measured 2026-08-29: Firecrawl
   * ACCEPTED and proxied `http://127.0.0.1:8080/`, returning
   * `metadata.statusCode: 502, "Upstream proxy refused connection"` — it tried.
   * So the fence runs before the request leaves the browser, and `called`
   * proves it ran BEFORE rather than merely rejecting the answer.
   */
  let called = 0
  const counting: WebArticleFetcher = async (url, signal) => {
    called += 1
    return stub()(url, signal)
  }
  for (const bad of [
    'http://127.0.0.1:8080/',
    'https://localhost/page',
    'https://169.254.169.254/latest/',
    'http://example.com/page',
    'https://user:pass@example.com/page',
    'https://intranet.local/page',
  ]) {
    await expect(importWebArticle(bad, { metadata, fetcher: counting }))
      .rejects.toThrow(/valid HTTPS public/i)
  }
  expect(called).toBe(0)
})

test('a 404 hiding inside a successful fetch is refused', async () => {
  /*
   * THE most important check in this module. Measured 2026-08-29:
   * `example.com/definitely-not-here-404` came back as HTTP 200 with
   * `success: true` and a full markdown body; only `metadata.statusCode: 404`
   * revealed it. Without this, a publisher's 404 page publishes as an article
   * and nothing ever says so.
   */
  await expect(importWebArticle('https://example.com/gone', {
    metadata, fetcher: stub({ statusCode: 404 }),
  })).rejects.toThrow(/404/)
  await expect(importWebArticle('https://example.com/gone', {
    metadata, fetcher: stub({ statusCode: 500 }),
  })).rejects.toThrow(/500/)
})

test('a pdf is refused with a pointer to the Document tab, not text-extracted', async () => {
  await expect(importWebArticle('https://example.com/paper.pdf', {
    metadata, fetcher: stub(),
  })).rejects.toThrow(/Document tab/)
  await expect(importWebArticle('https://example.com/paper', {
    metadata, fetcher: stub({ contentType: 'application/pdf' }),
  })).rejects.toThrow(/Document tab/)
})

test('a redirect is disclosed, and the url that was extracted is the one recorded', async () => {
  const result = await importWebArticle('https://example.com/old', {
    metadata, fetcher: stub({ finalUrl: new URL('https://example.com/new') }),
  })
  expect(result.work.provenance.sourceUrl).toBe('https://example.com/new')
  expect(result.report.findings).toContainEqual(
    expect.objectContaining({ code: 'import-web-redirected', severity: 'warning' }),
  )
})

test('a redirect into a private network is refused, not merely disclosed', async () => {
  await expect(importWebArticle('https://example.com/old', {
    metadata, fetcher: stub({ finalUrl: new URL('http://169.254.169.254/latest/') }),
  })).rejects.toThrow(/valid HTTPS public/i)
})

test('a cached copy is disclosed with the date it was cached', async () => {
  // `maxAge` defaults to 172_800_000 ms — 48 hours — so "import this article"
  // can return a copy two days old. Disclosed, not defeated; see Open questions.
  const result = await importWebArticle('https://example.com/a', {
    metadata, fetcher: stub({ cachedAt: '2026-08-27T10:00:00Z' }),
  })
  expect(result.report.findings).toContainEqual(
    expect.objectContaining({ code: 'import-web-cached', severity: 'warning' }),
  )
  expect(result.report.findings.find((f) => f.code === 'import-web-cached')!.message)
    .toContain('2026-08-27')
})

test('an empty extraction is refused rather than published as a blank page', async () => {
  await expect(importWebArticle('https://example.com/app', {
    metadata, fetcher: stub({ markdown: '   \n\n  ' }),
  })).rejects.toThrow(/content/i)
})

test('cancellation propagates and is an AbortError', async () => {
  const controller = new AbortController()
  const slow: WebArticleFetcher = (_url, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason))
  })
  const running = importWebArticle('https://example.com/a', {
    metadata, fetcher: slow, signal: controller.signal,
  })
  controller.abort()
  await expect(running).rejects.toMatchObject({ name: 'AbortError' })
})
