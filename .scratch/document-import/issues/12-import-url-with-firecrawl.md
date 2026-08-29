# 12 — Import one URL using a memory-only Firecrawl key

**What to build:** Let a user deliberately send one URL to Firecrawl with their own API key, receive the extracted content directly in the browser, inspect its provenance and limitations, and pass it through the standard page-planning, accessibility-review, and export workflow.

**Blocked by:** 05 — Import Markdown and HTML safely; 10 — Let users approve and edit the proposed page plan.

**Design:** [12-import-url-design.md](../12-import-url-design.md)

**Plan:** [12-import-url-plan.md](../12-import-url-plan.md)

**Status:** resolved

- [x] The interface explains that the URL and API key are sent directly from the browser to Firecrawl before the user proceeds.
      — `src/components/WebArticleImporter.tsx`. Above the button, in prose, not
      behind a disclosure triangle: the destination, what is sent, that the relay
      is not involved, the one-credit cost, and where the key lives. Pinned by
      `WebArticleImporter.test.tsx`, which also asserts `closest('details')` is
      null — a disclosure the user must open is not a disclosure.
- [x] The API key is held only in memory, is excluded from persistence and logs, and can be removed immediately with a Forget action.
      — `src/import/firecrawl-key.ts`, proved by
      `src/import/web-key-containment.test.ts` against every persistence path
      this repo has, enumerated first. The store takes no argument, so the type
      admits no persistence path at all; an arity test fails if anyone adds one.
- [x] The feature acquires one explicit URL and does not expose a crawler, recursive site import, application relay, or hidden server fallback.
      — `src/import/web-endpoints.test.ts` and `scripts/smoke-dist.mjs` assert
      the absence in the source AND in the built bundle, and assert `/v2/scrape`
      is present so the check cannot pass by the feature being tree-shaken out.
- [x] Firecrawl output is treated as untrusted and passes through the controlled Markdown/HTML normalization policy.
      — the `web` variant in `src/import/text.ts` reaches
      `sanitizeImportedMarkdown` exactly as a pasted Markdown import does.
      Pinned by `text.test.ts`, including the inherited image refusal and the
      inherited private-network fence on links.
- [x] Authentication, quota, CORS, timeout, cancellation, unsupported-content, and provider errors are safe and actionable.
      — `src/import/firecrawl.test.ts` (14 cases) and `src/import/web.test.ts`
      (15 cases). Every message is app-authored from a status code and a fixed
      string; the only interpolated value in `firecrawl.ts` is a number.
- [x] A successful import records source provenance and completes the normal preview, audit, plan, and cartridge-export workflow.
      — `src/import/web.browser.test.ts`, which drives the real compile+gate and
      `buildCartridge` and asserts audited-byte parity.

## Answer

**The fetch route is browser-direct Firecrawl with the user's own key, chosen on
abuse liability rather than on who pays.** Bring-your-own-key puts an
arbitrary-URL fetch on the instructor's own Firecrawl account. Widening the relay
would have made this project's Cloudflare account an anonymous public-web proxy —
something the relay's SSRF fences do not address, because they stop a request
reaching an internal network, not a stranger using the deployment to fetch
arbitrary public things under the operator's name.

**Firecrawl Keyless was verified to work and rejected anyway.** It returned 200
with `creditsUsed: 1` and no `Authorization` header at all. It is rejected for
unresolved terms around unauthenticated use in a shipped product, a shared quota
outside this project's control, and withdrawability without notice. There is no
keyless fallback and no "try keyless, then prompt" path: a missing key is a
refusal with an instruction, and a test asserts no request is made.

**A real browser was proved to be allowed in before anything depended on it.**
The design settled the route on four curl probes, and curl neither issues nor
enforces a preflight. `scripts/verify-firecrawl-cors.mjs` ran the contract from
headless Chromium on a real, non-null origin and the vendor answered exactly what
curl predicted: 204, allow-origin `*`, allow-headers `authorization,content-type`,
allow-methods including POST — and the keyless POST came back as a READABLE 401
rather than an opaque CORS failure, which is the only reason this feature can
ever tell a user their key is wrong.

**The seam exists for a second, self-hosted extractor, and everything downstream
of it is shared.** `WebArticleFetcher` is an interface with `firecrawlFetcher`
behind it, not a Firecrawl module with an interface bolted on. The origin-status
check, the PDF refusal, the redirect and cache disclosures, the rights warning,
sanitization, image refusal, findings and provenance all live below the seam,
because the same URL must produce the same Canvas page in both deployments. A
build whose refusals differ is a build that disagrees about what a page is. The
whole shared half was written and tested against a hand-written stub before any
Firecrawl code existed, which is the demonstration that it plugs in.

**A 404 arrives inside a `success: true` HTTP 200, and only `metadata.statusCode`
reveals it.** Without that check a publisher's "page not found" screen publishes
as an article and nothing ever says so. It is the single most important envelope
check in the feature.

**`parsers: []` is what stops a PDF being silently text-extracted.** The vendor
default is `[{"type":"pdf"}]`. A PDF URL is refused and pointed at the Document
tab, because issue 11's local path computes `pagesNeedingOcr`, `pdfType` and the
layout signals that decide whether a scan may publish, and the remote path
returns none of them.

**The target URL is fenced before the request leaves the browser**, because the
extraction service is itself an SSRF vector: it accepted `http://127.0.0.1:8080/`
and tried to proxy it. The post-redirect URL is re-validated for the same reason.

**Images are refused with both a finding and a visible placeholder, by
inheritance from `markup.ts` rather than by new code on this path.**

### Residuals

- **A cached copy up to 48 hours old is disclosed, not defeated.** `maxAge`
  defaults to 172,800,000 ms, so "import this article" can legitimately return a
  two-day-old copy. The user is told which page and which day.
- **An unnamed open-license claim warns rather than blocks.**
  `validateImportMetadata` requires a license name only when a license URL is
  given, so `open-license` naming nothing is legal on every import path today.
  Tightening that globally changes every import path and is a product decision —
  escalated, not taken here.
- **External images are refused rather than left as hotlinks**, and `markup.ts`
  is unchanged. Firecrawl returns no image bytes, fetching them from the browser
  is host-by-host CORS luck, and a feature that silently keeps some pictures and
  drops others is worse than one that consistently drops all of them.
- **The browser-direct posture is a vendor-controlled fact.** If Firecrawl
  withdrew its wildcard CORS headers the feature would stop working, and
  `npm run verify:firecrawl-cors` is the out-of-band probe that says so. It is
  deliberately not part of `npm test`: the offline suite must never depend on a
  vendor being up.
- **The test fixtures are reconstructed from the design's recorded 2026-08-29
  measurements, not captured live**, because capturing needs a user's key and
  spends their credit. `src/import/testing/firecrawl-fixture.ts` says so in its
  header.
- **Issue 17** carries the self-hosted extractor that will be this seam's second
  implementation. This issue builds none of it and adds no configuration flag.
