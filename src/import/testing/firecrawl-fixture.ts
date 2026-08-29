import { createFirecrawlFetcher } from '../firecrawl'
import type { WebArticleFetcher } from '../web'

/**
 * Firecrawl `/v2/scrape` envelopes, in the shape the design recorded.
 *
 * PROVENANCE, stated exactly. These are RECONSTRUCTED from the measurements
 * written into `12-import-url-design.md` on 2026-08-29 — the field set
 * (`sourceURL`, `url`, `statusCode`, `contentType`, `cacheState`, `cachedAt`,
 * `creditsUsed`, plus OpenGraph keys), the 404-inside-200 case with
 * `metadata.error: "Not Found"`, and the 403 body ending in the vendor's
 * typeform link. They were NOT captured from a live call in this session: doing
 * so needs the user's own API key and spends their credit, so the recorded
 * measurements are the source of truth instead.
 *
 * The article bodies are written short on purpose — the measured Wikipedia
 * markdown was 268,645 characters — but every metadata field below is the shape
 * the design recorded rather than something invented to make a test pass. If a
 * future session captures live envelopes, replace these and keep the header
 * honest about which is which.
 */
export const FIXTURE_URL = 'https://en.wikipedia.org/wiki/Photosynthesis'

const articleMetadata = {
  sourceURL: FIXTURE_URL,
  url: FIXTURE_URL,
  statusCode: 200,
  contentType: 'text/html; charset=utf-8',
  title: 'Photosynthesis',
  language: 'en',
  cacheState: 'miss',
  creditsUsed: 1,
  'og:title': 'Photosynthesis',
}

/** Two images and one relative link, which is what the image tests need. */
const ARTICLE_MARKDOWN = `# Photosynthesis

Plants convert light energy into chemical energy.

![A leaf cross-section](https://upload.wikimedia.org/leaf.png)

The pigment involved is [chlorophyll](/wiki/Chlorophyll), which absorbs light.

![The Calvin cycle](https://upload.wikimedia.org/calvin.png)

The products are sugars and oxygen.
`

const ARTICLE_NO_IMAGES_MARKDOWN = `# Photosynthesis

Plants convert light energy into chemical energy.

The pigment involved is [chlorophyll](/wiki/Chlorophyll), which absorbs light.

## Products

The products are sugars and oxygen.
`

export const FIRECRAWL_FIXTURES = {
  article: {
    status: 200,
    body: { success: true, data: { markdown: ARTICLE_MARKDOWN, metadata: articleMetadata } },
  },
  'article-no-images': {
    status: 200,
    body: { success: true, data: { markdown: ARTICLE_NO_IMAGES_MARKDOWN, metadata: articleMetadata } },
  },
  /*
   * The single most important envelope in the design's failure table:
   * `example.com/definitely-not-here-404` answered HTTP 200 with `success: true`
   * and a full markdown body, and only `metadata.statusCode` revealed the 404.
   */
  'not-found': {
    status: 200,
    body: {
      success: true,
      data: {
        markdown: '# Not Found\n\nThe page you requested does not exist on this server.\n',
        metadata: {
          ...articleMetadata,
          statusCode: 404,
          error: 'Not Found',
        },
      },
    },
  },
  /** The vendor text that must never be rendered, so the assertion has real text to not show. */
  forbidden: {
    status: 403,
    body: {
      success: false,
      error: 'We apologize for the inconvenience but we do not support this site. '
        + 'If you would like to request support, please fill out our intake form here: '
        + 'https://fk4bvu0n5qp.typeform.com/to/Ej6oydlg',
    },
  },
} as const

export type FirecrawlFixtureName = keyof typeof FIRECRAWL_FIXTURES

/**
 * A fetcher that serves a fixture through the REAL `firecrawlFetcher`, so the
 * envelope-to-`FetchedArticle` mapping is exercised rather than bypassed.
 */
export function fixtureFetcher(name: FirecrawlFixtureName, key = 'fc-test-key'): WebArticleFetcher {
  const fixture = FIRECRAWL_FIXTURES[name]
  return createFirecrawlFetcher({
    key: () => key,
    fetch: async () => new Response(JSON.stringify(fixture.body), {
      status: fixture.status,
      headers: { 'content-type': 'application/json' },
    }),
  })
}
