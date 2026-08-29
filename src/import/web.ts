import type { ImportFinding, ImportMetadata, ImportReport, ImportResult } from './types'
import { parsePublicSourceUrl } from './common'
import { importText } from './text'

/**
 * One public URL in, one `ImportResult` out.
 *
 * The network call is behind an interface on purpose. The public Cloudflare
 * deployment fetches with `firecrawlFetcher` (browser-direct, the user's own
 * key); a self-hosted deployment is expected to point at an extraction service
 * the operator runs on their own machine and to need no key at all — the same
 * default-off, operator-pinned shape as `__OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__`
 * (`src/vite-env.d.ts:3-4`, `worker/relay.ts:236`, `src/App.tsx:84-86`).
 *
 * So the division of labour is fixed here rather than left to taste:
 *
 *   ABOVE the seam, a fetcher's only job is to turn a URL into a
 *   `FetchedArticle` and to fail with an app-authored message.
 *
 *   BELOW it — in `importWebArticle` and `importText` — live the origin-status
 *   check, the PDF refusal, the redirect and cache disclosures, the rights
 *   warning, sanitization, image refusal, findings and provenance. All of it is
 *   shared, because the same URL must produce the same Canvas page in both
 *   deployments. A build whose refusals differ is a build that disagrees with
 *   the other one about what a page IS.
 */
export interface FetchedArticle {
  /**
   * The extracted article as Markdown.
   *
   * Markdown and not HTML, and not a union of the two. Both would be untrusted
   * and both would be sanitized identically, so this is not a safety argument:
   * measured 2026-08-29 on `en.wikipedia.org/wiki/Photosynthesis`, the markdown
   * was 268,645 characters against the html's 925,711, and the html still
   * carried `<form>`, `<input>`, `<button>` and `<link>` with
   * `onlyMainContent: true` — publisher chrome that `sanitizeImportedHtml`
   * would unwrap into `import-unsupported-element-removed` noise telling the
   * user nothing. A fetcher that can only produce HTML must convert, or add a
   * second variant here and to `TextImportInput` at the same time.
   */
  markdown: string
  /** Post-redirect: the page that was actually extracted, not the one asked for. */
  finalUrl: URL
  /**
   * The ORIGIN's HTTP status, which is not the extractor's. A fetcher that
   * cannot report this cannot be used: see the 404-inside-200 check below.
   */
  statusCode: number
  /** The origin's content type, when known. Used only to refuse a PDF. */
  contentType?: string
  /** Set when the fetcher served a cached copy rather than a live fetch. */
  cachedAt?: string
  /**
   * What produced this, for `report.parser`. The fetcher names itself so that
   * nothing below the seam has a vendor in it.
   */
  parser: ImportReport['parser']
}

export type WebArticleFetcher = (url: URL, signal: AbortSignal) => Promise<FetchedArticle>

export interface WebArticleImportOptions {
  metadata: ImportMetadata
  fetcher: WebArticleFetcher
  signal?: AbortSignal
}

export async function importWebArticle(
  rawUrl: string,
  options: WebArticleImportOptions,
): Promise<ImportResult> {
  options.signal?.throwIfAborted()

  /*
   * The fence runs HERE, before the request leaves the browser, and not left to
   * the extraction service — because the service is itself an SSRF vector.
   * Measured 2026-08-29: Firecrawl accepted `http://127.0.0.1:8080/` and tried
   * to proxy it, answering `metadata.statusCode: 502, "Upstream proxy refused
   * connection"`. It was the loopback listener that refused, not Firecrawl.
   *
   * `parsePublicSourceUrl` throws for anything that is not public HTTPS and
   * returns `undefined` only for a blank string, which is the empty-field case
   * and deserves its own wording.
   */
  const target = parsePublicSourceUrl(rawUrl)
  if (!target) throw new Error('Enter the address of the web page to import.')

  const signal = options.signal ?? new AbortController().signal
  const article = await options.fetcher(target, signal)
  options.signal?.throwIfAborted()

  /*
   * Re-validated, because a redirect can land somewhere the first check would
   * have refused. A fetcher reports where it ENDED UP, and that is the page
   * whose bytes are about to be imported.
   */
  const finalUrl = parsePublicSourceUrl(article.finalUrl.href)
  if (!finalUrl) throw new Error('Enter a valid HTTPS public source URL.')

  /*
   * The ORIGIN's status, which is not the extractor's. Measured 2026-08-29:
   * `example.com/definitely-not-here-404` came back as HTTP 200 with
   * `success: true` and a full markdown body, and only `metadata.statusCode`
   * revealed the 404. Without this check a publisher's "page not found" screen
   * publishes as an article and nothing ever says so.
   *
   * The message interpolates the NUMBER only — never a response body, which is
   * vendor-controlled data rather than copy.
   */
  if (article.statusCode < 200 || article.statusCode > 299) {
    throw new Error(`That address answered HTTP ${article.statusCode}, so there is no article to import.`)
  }

  /*
   * Two checks, because they refuse at different moments and for different
   * reasons. The path check can refuse before a credit is spent; the
   * content-type check is the authoritative one, because a PDF need not be
   * served from a `.pdf` path.
   *
   * Refused rather than accepted because issue 11 owns PDFs, LOCALLY, where
   * `pagesNeedingOcr`, `pdfType` and the layout signals exist. A remote
   * extraction returns none of them, so accepting a PDF here would publish a
   * scan-derived page carrying no scanned-page finding at all.
   */
  const isPdf = article.contentType?.toLowerCase().startsWith('application/pdf') === true
    || finalUrl.pathname.toLowerCase().endsWith('.pdf')
  if (isPdf) {
    throw new Error(
      'That address is a PDF. Import it from the Document tab, where each page’s extraction '
      + 'is checked and a page that is an image of text is refused.',
    )
  }

  if (!article.markdown.trim()) {
    throw new Error('No readable content was extracted from that address.')
  }

  const result = await importText(
    {
      kind: 'web',
      text: article.markdown,
      parser: article.parser,
      sourceUrl: finalUrl,
    },
    {
      // The override is what makes `importText`'s drift guard pass: provenance
      // and relative-link resolution are both built from this one URL.
      metadata: { ...options.metadata, sourceUrl: finalUrl.href },
      ...(options.signal ? { signal: options.signal } : {}),
    },
  )

  /*
   * ADDITIVE ONLY. Appending a finding does not put a second place in charge of
   * what a `web` import IS — that is why `provenance.kind` and `report.parser`
   * are set by the variant in `importText` rather than rewritten here. These are
   * disclosures about the FETCH, which is the one thing `importText` cannot see.
   */
  const findings: ImportFinding[] = []

  if (finalUrl.href !== target.href) {
    findings.push({
      code: 'import-web-redirected',
      severity: 'warning',
      message: `That address redirected to ${finalUrl.href}, and that is the page that was imported. `
        + 'Check that it is the article you wanted.',
    })
  }

  /*
   * Disclosure, not policy. `validateImportMetadata` requires a license NAME
   * only when a license URL is supplied, so `open-license` naming nothing is
   * legal on every import path today. Tightening that globally would change
   * every import path and is a product decision, escalated rather than taken
   * here — see the plan's Open questions.
   *
   * A WARNING and not a blocker: it must not stop an instructor who knows what
   * they have and will type the license on the next screen. On a publisher
   * import an unnamed license is nearly harmless; on an arbitrary web article
   * it is the difference between a defensible claim and a bare assertion, which
   * is why the disclosure lives on this path.
   */
  if (options.metadata.rightsAuthority === 'open-license' && !options.metadata.licenseName?.trim()) {
    findings.push({
      code: 'import-web-license-unnamed',
      severity: 'warning',
      message: 'You said this page’s license permits the use but did not name a license. '
        + 'Add the license name and URL on the page plan, or choose a different basis.',
    })
  }

  if (article.cachedAt) {
    findings.push({
      code: 'import-web-cached',
      severity: 'warning',
      message: `This is a copy cached on ${article.cachedAt}, not a fresh fetch. `
        + 'If the page has changed since then, those changes are not in this import.',
    })
  }

  result.report.findings.push(...findings)
  return result
}
