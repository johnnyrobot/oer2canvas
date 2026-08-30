import { importWebArticle } from './web'
import { createFirecrawlFetcher } from './firecrawl'
import { createSelfHostedExtractorFetcher } from './self-hosted-extractor'
import { EXTRACTOR_HEALTH_PATH } from './self-hosted-extractor'
import type { ImportResult } from './types'
import { messageOf } from '../errors'

/**
 * Issue 17's third criterion, and what it does NOT claim.
 *
 * > "The same URL yields the same Canvas page in both deployments. Everything
 * > below the fetcher seam stays shared, so the two builds cannot disagree
 * > about what a page is."
 *
 * The second sentence is the operative one. Two different extraction engines
 * driving two different browsers over a live web page will never emit
 * byte-identical Markdown, and a test that compared them would be a test of two
 * vendors' HTML-to-Markdown converters rather than of this app. So the markdown
 * is DELIBERATELY EXCLUDED from the comparison below.
 *
 * What is compared is everything the seam owns: which addresses are refused and
 * with exactly which words, which redirects are disclosed, what a PDF does,
 * what an empty extraction does, what provenance is recorded, and which finding
 * codes come out. A build that disagreed about any of those would be a build
 * that disagrees with the other one about what a page IS.
 */

const ADDRESS = 'https://example.com/article'
const metadata = {
  title: 'Photosynthesis',
  sourceUrl: '',
  rightsAuthority: 'permission' as const,
  rightsAcknowledged: true,
}
const openLicenceMetadata = { ...metadata, rightsAuthority: 'open-license' as const }
const MARKDOWN = '# Photosynthesis\n\nPlants convert light.'

/** What each vendor says for one situation, in its own envelope shape. */
interface Situation {
  firecrawl: unknown
  extractor: unknown
  metadata?: typeof metadata | typeof openLicenceMetadata
  address?: string
}

const SITUATIONS: Record<string, Situation> = {
  'a plain 200 article': {
    firecrawl: {
      success: true,
      data: {
        markdown: MARKDOWN,
        metadata: { url: ADDRESS, sourceURL: ADDRESS, statusCode: 200, contentType: 'text/html' },
      },
    },
    extractor: result({ status_code: 200, redirected_status_code: 200, redirected_url: ADDRESS }),
  },

  'a 404 delivered inside a successful extraction': {
    firecrawl: {
      success: true,
      data: {
        markdown: '# Not Found',
        metadata: { url: ADDRESS, sourceURL: ADDRESS, statusCode: 404 },
      },
    },
    extractor: result({
      markdown: { raw_markdown: '# Not Found' },
      status_code: 404,
      redirected_status_code: 404,
      redirected_url: ADDRESS,
    }),
  },

  'a final url whose path is a pdf': {
    address: 'https://example.com/paper.pdf',
    firecrawl: {
      success: true,
      data: {
        markdown: MARKDOWN,
        metadata: {
          url: 'https://example.com/paper.pdf',
          sourceURL: 'https://example.com/paper.pdf',
          statusCode: 200,
        },
      },
    },
    extractor: result({
      url: 'https://example.com/paper.pdf',
      status_code: 200,
      redirected_status_code: 200,
      redirected_url: 'https://example.com/paper.pdf',
      response_headers: {},
    }),
  },

  'a pdf content type on a fetch that did not redirect': {
    firecrawl: {
      success: true,
      data: {
        markdown: MARKDOWN,
        metadata: {
          url: ADDRESS, sourceURL: ADDRESS, statusCode: 200, contentType: 'application/pdf',
        },
      },
    },
    extractor: result({
      status_code: 200,
      redirected_status_code: 200,
      redirected_url: ADDRESS,
      response_headers: { 'content-type': 'application/pdf' },
    }),
  },

  'a redirect to another public address': {
    firecrawl: {
      success: true,
      data: {
        markdown: MARKDOWN,
        metadata: { url: 'https://example.org/moved', sourceURL: ADDRESS, statusCode: 200 },
      },
    },
    // The two vendors report the SAME situation with different fields — this is
    // the row that would catch the redirect trap described in
    // `self-hosted-extractor.ts` if it were ever reintroduced.
    extractor: result({
      status_code: 301,
      redirected_status_code: 200,
      redirected_url: 'https://example.org/moved',
      response_headers: { 'content-type': 'text/plain' },
    }),
  },

  'a redirect whose first hop reports a different content type': {
    /*
     * The row that keeps the content-type narrowing honest.
     *
     * Firecrawl reports the FINAL page's content type; the extraction service
     * reports the FIRST hop's, alongside the first hop's status. Here the first
     * hop is a PDF that redirects to an ordinary article — so a fetcher that
     * passed `response_headers` straight up would refuse a perfectly good page
     * as a PDF, and the two deployments would disagree about what this address
     * is. Omitting a header that describes the wrong resource is what makes
     * them agree.
     */
    firecrawl: {
      success: true,
      data: {
        markdown: MARKDOWN,
        metadata: {
          url: 'https://example.org/landing',
          sourceURL: ADDRESS,
          statusCode: 200,
          contentType: 'text/html',
        },
      },
    },
    extractor: result({
      status_code: 302,
      redirected_status_code: 200,
      redirected_url: 'https://example.org/landing',
      response_headers: { 'content-type': 'application/pdf' },
    }),
  },

  'a redirect into a private network': {
    firecrawl: {
      success: true,
      data: {
        markdown: MARKDOWN,
        metadata: { url: 'http://127.0.0.1:8080/', sourceURL: ADDRESS, statusCode: 200 },
      },
    },
    extractor: result({
      status_code: 200,
      redirected_status_code: 200,
      redirected_url: 'http://127.0.0.1:8080/',
    }),
  },

  'an extraction with nothing in it': {
    firecrawl: {
      success: true,
      data: { markdown: '   ', metadata: { url: ADDRESS, sourceURL: ADDRESS, statusCode: 200 } },
    },
    extractor: result({
      markdown: { raw_markdown: '   ' },
      status_code: 200,
      redirected_status_code: 200,
      redirected_url: ADDRESS,
    }),
  },

  'an open licence with no licence named': {
    metadata: openLicenceMetadata,
    firecrawl: {
      success: true,
      data: { markdown: MARKDOWN, metadata: { url: ADDRESS, sourceURL: ADDRESS, statusCode: 200 } },
    },
    extractor: result({ status_code: 200, redirected_status_code: 200, redirected_url: ADDRESS }),
  },

  'an address that is not public https': {
    address: 'http://example.com/article',
    firecrawl: { success: true, data: { markdown: MARKDOWN, metadata: { statusCode: 200 } } },
    extractor: result({ status_code: 200, redirected_status_code: 200, redirected_url: ADDRESS }),
  },
}

function result(over: Record<string, unknown>) {
  return {
    success: true,
    results: [{
      url: ADDRESS,
      success: true,
      markdown: { raw_markdown: MARKDOWN, markdown_with_citations: '', references_markdown: '' },
      response_headers: { 'content-type': 'text/html' },
      ...over,
    }],
  }
}

/**
 * A run reduced to everything the SEAM decides, and nothing the extractor does.
 *
 * `parser` is excluded on purpose — it names which fetcher ran, so including it
 * would make every row fail for the one reason that is not a disagreement.
 */
async function outcomeOf(
  fetcher: Parameters<typeof importWebArticle>[1]['fetcher'],
  situation: Situation,
) {
  try {
    const imported: ImportResult = await importWebArticle(situation.address ?? ADDRESS, {
      metadata: situation.metadata ?? metadata,
      fetcher,
    })
    return {
      thrown: undefined,
      findings: imported.report.findings.map((finding) => `${finding.severity} ${finding.code}`).sort(),
      provenance: imported.work.provenance,
      sourceUrl: imported.report.sourceUrl,
      sections: imported.work.sections.length,
    }
  } catch (error: unknown) {
    return { thrown: messageOf(error) }
  }
}

const firecrawlFetch = (body: unknown): typeof globalThis.fetch =>
  async () => Response.json(body)

const extractorFetch = (body: unknown): typeof globalThis.fetch =>
  async (url) => String(url).endsWith(EXTRACTOR_HEALTH_PATH)
    ? Response.json({ status: 'ok', version: '0.9.2' })
    : Response.json(body)

test.each(Object.entries(SITUATIONS))(
  'both deployments agree about %s',
  async (_name, situation) => {
    const viaFirecrawl = await outcomeOf(
      createFirecrawlFetcher({ key: () => 'fc-key', fetch: firecrawlFetch(situation.firecrawl) }),
      situation,
    )
    const viaExtractor = await outcomeOf(
      createSelfHostedExtractorFetcher({
        origin: 'https://extract.example.edu',
        fetch: extractorFetch(situation.extractor),
      }),
      situation,
    )

    expect(viaExtractor).toEqual(viaFirecrawl)
  },
)

test('the table covers both outcomes, so agreement is not agreement about nothing', async () => {
  /*
   * A parity suite whose rows all threw, or all succeeded, would agree
   * perfectly and prove very little. This asserts the table exercises both.
   */
  const outcomes = await Promise.all(
    Object.values(SITUATIONS).map((situation) => outcomeOf(
      createFirecrawlFetcher({ key: () => 'k', fetch: firecrawlFetch(situation.firecrawl) }),
      situation,
    )),
  )
  expect(outcomes.some((outcome) => outcome.thrown !== undefined)).toBe(true)
  expect(outcomes.some((outcome) => outcome.thrown === undefined)).toBe(true)
  // And at least one successful row carried a finding, so the finding
  // comparison above is comparing something.
  expect(outcomes.some((outcome) => (outcome.findings?.length ?? 0) > 0)).toBe(true)
})

test('THE ONE PLACE THEY DIFFER: a redirect to a pdf served from a path that is not .pdf', async () => {
  /*
   * Recorded as a divergence rather than hidden, because it is real.
   *
   * `importWebArticle` refuses a PDF two ways — by content type and by a `.pdf`
   * final path. The extraction service's `response_headers` belong to the FIRST
   * hop of a redirect chain, so on a redirect this fetcher omits the content
   * type (see the row above for why passing it up would be worse), leaving only
   * the path check. Firecrawl reports the final content type and refuses.
   *
   * INFERRED, and not measured: navigating a PDF in the headless browser this
   * service drives is not expected to produce extractable Markdown, so the
   * shared "No readable content was extracted" refusal should fire instead —
   * a refusal either way, with different words. It is inferred because
   * verifying it needs a running extraction container, which the environment
   * this was written in did not have. The capability documentation states the
   * narrowed check rather than claiming parity.
   */
  const situation: Situation = {
    address: ADDRESS,
    firecrawl: {
      success: true,
      data: {
        markdown: MARKDOWN,
        metadata: {
          url: 'https://example.org/download', sourceURL: ADDRESS,
          statusCode: 200, contentType: 'application/pdf',
        },
      },
    },
    extractor: result({
      status_code: 302,
      redirected_status_code: 200,
      redirected_url: 'https://example.org/download',
      response_headers: { 'content-type': 'application/pdf' },
    }),
  }

  const viaFirecrawl = await outcomeOf(
    createFirecrawlFetcher({ key: () => 'k', fetch: firecrawlFetch(situation.firecrawl) }),
    situation,
  )
  const viaExtractor = await outcomeOf(
    createSelfHostedExtractorFetcher({
      origin: 'https://extract.example.edu',
      fetch: extractorFetch(situation.extractor),
    }),
    situation,
  )

  expect(viaFirecrawl.thrown).toMatch(/That address is a PDF/)
  // Not a refusal here, because the markdown in this fixture is not empty. A
  // real service would return nothing to import; this fixture cannot, so the
  // assertion is about the CONTENT-TYPE half being absent, which is the part
  // that is actually measurable without the container.
  expect(viaExtractor.thrown).toBeUndefined()
})

test('only the parser name distinguishes the two reports', async () => {
  // The one field that is SUPPOSED to differ, asserted so that excluding it
  // from `outcomeOf` reads as a decision rather than an omission.
  const shared = SITUATIONS['a plain 200 article']!
  const viaFirecrawl = await importWebArticle(ADDRESS, {
    metadata,
    fetcher: createFirecrawlFetcher({ key: () => 'k', fetch: firecrawlFetch(shared.firecrawl) }),
  })
  const viaExtractor = await importWebArticle(ADDRESS, {
    metadata,
    fetcher: createSelfHostedExtractorFetcher({
      origin: 'https://extract.example.edu',
      fetch: extractorFetch(shared.extractor),
    }),
  })

  expect(viaFirecrawl.report.parser).toBe('firecrawl')
  expect(viaExtractor.report.parser).toBe('self-hosted-extractor')
  expect(viaExtractor.work.provenance).toEqual(viaFirecrawl.work.provenance)
  expect(viaExtractor.work.format).toBe(viaFirecrawl.work.format)
})
