/*
 * The three modules are read as TEXT rather than imported as modules, because
 * this asserts what the source says and not what it does.
 *
 * `?raw` rather than `node:fs`: `tsconfig.json` deliberately omits node types so
 * that a `process` reference in `src/` is a compile error, and its comment says
 * a test needing node belongs in `tsconfig.node.json` — whose own comment says
 * that list is "meant to be hard to grow by accident". Vite's `?raw` reads the
 * same bytes off disk at transform time and grows nothing.
 */
import webSource from './web.ts?raw'
import firecrawlSource from './firecrawl.ts?raw'
import extractorSource from './self-hosted-extractor.ts?raw'

/**
 * RE-SCOPED BY ISSUE 17, NOT WEAKENED.
 *
 * Issue 12's version of this file asserted that the CODEBASE named exactly one
 * extraction endpoint. That was the right statement while there was exactly one
 * fetcher; with a second implementation of the same seam it is false by
 * construction, and deleting it would have thrown away the property it stood in
 * for.
 *
 * So the property is restated per module: EACH fetcher names its own single
 * endpoint and none of its service's crawl, search, batch or scripting routes.
 * The stronger claim — that a BUILT BUNDLE carries exactly one of them, because
 * the other deployment mode is compiled out — is about an artifact and lives
 * where an artifact exists, in `scripts/smoke-dist.mjs`.
 */
const MODULES = [
  {
    name: 'firecrawl.ts',
    source: firecrawlSource,
    /** Present, not merely absent: a check that passes because the endpoint was
     * deleted is not a check. */
    required: '/v2/scrape',
    /** Every Firecrawl endpoint that would make this something other than one page. */
    forbidden: ['/v2/crawl', '/v2/map', '/v2/search', '/v2/batch', '/v2/agent'],
  },
  {
    name: 'self-hosted-extractor.ts',
    source: extractorSource,
    required: '/crawl',
    /*
     * The extraction service's full route table minus the two this app calls,
     * read from its `deploy/docker/server.py` at tag v0.9.2 on 2026-08-30.
     *
     * `/crawl/stream` is listed even though `/crawl` is a prefix of it: the
     * check is a substring search, so the longer string is what catches a
     * streaming call. `/pdf` and `/html` are listed for this module only —
     * `web.ts` and `firecrawl.ts` legitimately discuss PDFs and HTML in prose,
     * and a shared list would have made those two files unwritable.
     */
    forbidden: [
      '/crawl/stream', '/md', '/html', '/execute_js', '/screenshot', '/pdf',
      '/llm/', '/ask', '/config/dump', '/token', '/artifacts/', '/hooks/info',
    ],
  },
  {
    name: 'web.ts',
    source: webSource,
    /*
     * No `required`, and that is the point of this row. `web.ts` is BELOW the
     * seam: it must name no extraction endpoint of any kind, from any vendor,
     * because the moment it names one it has stopped being the shared half.
     */
    required: undefined,
    forbidden: [
      '/v2/scrape', '/v2/crawl', '/v2/map', '/v2/search', '/v2/batch', '/v2/agent',
      '/crawl', '/health', '/md', '/execute_js', '/screenshot',
    ],
  },
] as const

test.each(MODULES)('$name names its own one endpoint and no other', ({ name, source, required, forbidden }) => {
  /*
   * Four independent reasons this feature cannot crawl, of which this is the
   * first: one endpoint is named. The others are structural and are asserted
   * elsewhere — Firecrawl's `formats: ['markdown']` means the link set is never
   * received (`firecrawl.test.ts`), the extractor is sent a one-element `urls`
   * array (`self-hosted-extractor.test.ts`), `importText` emits a one-element
   * `sections` array (`text.test.ts`), and this path reaches `ImportPlanEditor`
   * rather than `ChapterPicker`, so there is no second network request in it at
   * all (`SourceBrowser.test.tsx`).
   *
   * The check does not care whether a match is code or a comment, which is the
   * point: it caught its own author writing the forbidden paths into an
   * explanatory comment in `firecrawl.ts` on 2026-08-29, and caught the same
   * mistake again in `self-hosted-extractor.ts` on 2026-08-30, where a comment
   * about a redirect's content type spelled a media type with a slash in it.
   */
  for (const path of forbidden) {
    expect(source, `${name} names ${path}`).not.toContain(path)
  }
  if (required !== undefined) {
    expect(source, `${name} no longer names ${required}`).toContain(required)
  }
})

test.each(MODULES)('$name never mentions the relay', ({ name, source }) => {
  /*
   * Not a style rule, and now doubly load-bearing.
   *
   * For the Firecrawl path: routing a user's key through this app's relay would
   * put a vendor credential on this project's infrastructure and reverse the
   * documented posture in `worker/relay.ts`: "Allowlists destination hosts so
   * this cannot become an open proxy."
   *
   * For the self-hosted path: the relay runs on Cloudflare's edge and cannot
   * reach an operator's own machine at all, and allowlisting one destination
   * that then fetches whatever URL is named in a POST body would be an open
   * proxy with an extra hop. Issue 17's design settles this at length; this
   * assertion is what stops it being quietly undone.
   */
  expect(source, `${name} names the relay`).not.toMatch(/['"`]\/relay/)
})
