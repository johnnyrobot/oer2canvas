# 17 — Extract a web article on a self-hosted deployment, without a Firecrawl key

**What to build:** Let a self-hosted operator point the web-article importer at an extraction service they run themselves, so their users import a URL with no third-party account and no API key, while the public deployment continues to require a user-supplied Firecrawl key.

**Blocked by:** 12 — Import one URL using a memory-only Firecrawl key.

**Status:** resolved

Issue 12 builds a `WebArticleFetcher` seam in `src/import/web.ts` with `firecrawlFetcher` as its first
implementation, and keeps every shared concern — sanitization, the 404-inside-200 check, PDF refusal,
image refusal, findings, provenance, the rights ceremony — BELOW the seam. This issue supplies the
second implementation. It exists because the two deployments answer "who bears the abuse liability
for fetching arbitrary URLs" differently: on the public build it is the instructor's own Firecrawl
account, and on a self-hosted build it is the operator's own machine, which is theirs to answer for.

**The house pattern to follow.** A capability that is off in the public build and switched on by an
operator pinning an exact origin already exists here for Canvas push: `src/vite-env.d.ts` declares
`__OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__` as "Empty in the public build; an exact HTTPS origin in an
opted-in self-host build", `worker/relay.ts` reads the matching `SELF_HOSTED_CANVAS_ORIGIN`, and
`src/App.tsx` gates the whole push capability on it. Read that before designing anything new.

**The hard part, which is not a config line.** A local extractor conventionally listens on
`http://localhost:<port>`. A page served over HTTPS cannot call plain HTTP, and the relay allowlists
destination hosts precisely so it cannot become an arbitrary proxy. Whether the extractor sits behind
the relay, beside it, or is required to serve HTTPS is the substance of this issue, not an afterthought.

**On tool choice.** `crawl4ai` drives headless Chromium and ships a Docker REST server, so "the
operator runs a service at an origin" is its native deployment mode. `scrapling` targets resilient
scrapers and anti-bot evasion, which is a different problem. Whatever is chosen must render
JavaScript — see the third criterion for why.

- [x] A self-hosted build reaches an operator-configured extractor origin; the public build has the capability compiled out entirely, matching the `SELF_HOSTED_CANVAS_ORIGIN` precedent.
- [x] No Firecrawl key is required, requested, or storable when a local extractor is configured, and the key UI is absent rather than merely hidden.
- [ ] The same URL yields the same Canvas page in both deployments. Everything below the fetcher seam stays shared, so the two builds cannot disagree about what a page is.
- [ ] The extractor renders JavaScript, so a JS-shell article does not succeed on the public build and fail on a self-hosted one — an inconsistency a user would have no way to diagnose.
- [x] The origin and transport problem is settled explicitly and documented: how an HTTPS page reaches the extractor, and what that means for the relay's allowlist, which must not become an arbitrary proxy.
- [x] Extractor failures are as actionable as Firecrawl's: unreachable, wrong or unsupported version, malformed response, timeout, and cancellation each produce a finding a user can act on.
- [x] `PRIVACY.md`, `README.md` and `SECURITY.md` state what a self-hosted deployment sends where, as precisely as issue 12 makes them state it for the public one.

**Known coupling to issue 12.** Its Task 12 asserts that exactly one extraction endpoint appears in
the source and in the built bundle. That assertion is correct for the public build and must be
re-scoped, not deleted, when a second fetcher ships — the property worth keeping is that the PUBLIC
bundle contains exactly one endpoint, not that the codebase does.

**Not a blocker on 13 — Release core document importer.** This is a deployment-mode enhancement. The
public release ships with issue 12's Firecrawl path alone.

## Answer

**Five criteria are ticked. 3 and 4 are left unticked on purpose**, for two different reasons,
both stated below. The tree is green: `npm run typecheck` clean, `npx vitest run` **136 files,
1318 tests passed**, `npm run build && npm run test:dist` passed in **both** deployment modes,
and `npm run verify:release` reports the same seven rows issue 13 left it at — criteria 2 and 7
still `MANUAL … NEVER RUN`, unchanged by this issue.

### The transport decision, which was the substance of this issue

**The extraction service must serve HTTPS at an operator-pinned origin, the browser calls it
directly, and no file under `worker/` changes behaviour.** Two probes settled it, run
2026-08-30 against this repository's own Playwright Chromium (`browser.version()` →
`151.0.7922.34`):

1. From a page whose origin is `https://oer2canvas.example` (`isSecureContext === true`),
   `GET http://127.0.0.1:PORT/probe`, `GET http://localhost:PORT/probe`, and a
   JSON-preflighted `POST http://127.0.0.1:PORT/crawl` all rejected with
   `TypeError: Failed to fetch`, each carrying the console error *"blocked by CORS policy:
   Permission was denied for this request to access the `loopback` address space."* That is
   Local Network Access, **not** mixed content, and the permission is denied by default. The
   control rules out every other explanation: the same three requests against the same listener
   from a page served over plain HTTP at `http://127.0.0.1:PAGEPORT/` **all returned 200**,
   with no console error.
2. From the same HTTPS page, `http://extract.example.edu/health` was refused as
   *"Mixed Content … This request has been blocked"*, and a Playwright route handler registered
   on that exact URL fired **zero** times — the renderer refused it before it became a request.

So the folklore answer (loopback is exempt from mixed content) is true and useless: a second,
newer gate closes the same door. `http://localhost:11235` is not a transport an HTTPS page can
use, and it would serve only the one machine sitting at it in any case.

**Not behind the relay**, for three reasons in descending order of weight: a Cloudflare Worker
at the edge cannot reach a machine on the operator's LAN at all, so the relay does not solve
the loopback problem but makes it unsolvable; allowlisting one destination that then fetches
whatever URL is named in its POST body would gut relay rule 3 while appearing to honour it; and
it would put this project's infrastructure back in a path issue 12 deliberately removed it
from. `worker/allowlist-hosts.ts` gained one extracted function and no behaviour change —
`worker/relay.test.ts` and `worker/allowlist-hosts.test.ts` pass **unedited**, which is the
proof.

### What was read rather than run

**No crawl4ai container was ever contacted.** This environment has no Docker daemon. Every
claim about the service's wire format is read from the vendor's source at a named tag —
`v0.9.2` for the shapes, `v0.9.0` and `v0.8.0` for the version floor — on 2026-08-30, and the
test fixtures are constructed from that source rather than captured from a service. If a field
name is wrong, the taxonomy still fails closed to the malformed-response message, but it would
fail on every import and no test here would catch it. That is the largest residual.

The single most load-bearing thing that reading found: **`status_code` is the FIRST hop of a
redirect chain and `redirected_status_code` is the page the browser landed on.** Reading the
obvious field would have handed `importWebArticle` a `301` for every redirected article and
refused it as non-2xx — working code that looked broken and blamed the publisher. It is also
the concrete reason the version floor is `0.9.0`: `redirected_status_code` does not exist at
`v0.8.0`, so an 0.8 service is refused by the handshake rather than misused.

### Criterion 3 — proved in its operative half, false in two named ways

The parity suite (`src/import/web-parity.test.ts`) drives **eleven situations** through
`importWebArticle` with both fetchers, each written in that vendor's own envelope shape, and
asserts identical thrown messages, identical finding codes and severities, identical
provenance, identical `report.sourceUrl` and identical section counts. A twelfth test asserts
the table exercises both refusals and successes, so the agreement is not agreement about
nothing. Deliberately excluded from the comparison: the markdown, because comparing it would be
a test of two vendors' HTML-to-Markdown converters rather than of this app.

That closes the criterion's second sentence — *"everything below the fetcher seam stays
shared"* — completely. It does not close the first sentence, and the box is not ticked, because
**two divergences are known and measured, not suspected**:

1. **Page chrome.** Firecrawl is called with `onlyMainContent: true`. The self-hosted path has
   no equivalent: the service's content-filtered markdown is empty unless the operator
   configured a content filter, so preferring it would make the imported page depend on
   configuration this app cannot see, and two operators on the same version would import the
   same URL into different pages with no way to tell why. `raw_markdown` is used instead —
   always populated, deterministic — and it carries navigation and footers the public build
   strips. Stated in `README.md`, editable in the page plan.
2. **A redirect to a PDF served from a path that does not end in `.pdf`.** The service reports
   the FIRST hop's `response_headers` alongside the first hop's status, so on a redirect its
   content type describes the redirect and not the article. Passing it up would be worse than
   omitting it — `importWebArticle` treats a present content type as authoritative, so a PDF
   that redirected to an HTML article would be refused as a PDF; there is a parity row proving
   exactly that. So it is omitted on a redirect, which leaves only the path half of the PDF
   refusal on that one address shape. `web-parity.test.ts` carries this as an explicitly named
   non-parity test rather than hiding it.

   The mitigation is **INFERRED and not measured**: the service navigates headless Chromium,
   which is not expected to yield extractable Markdown from a PDF, so the shared *"No readable
   content was extracted"* refusal should fire instead — a refusal either way, with different
   words. Verifying that needs a running container.

Ticking criterion 3 would require either reproducing main-content extraction or running that
inference against a real service.

### Criterion 4 — never run

**JavaScript rendering is a property of a container this environment cannot start, so there is
no honest way to close this.** Following issue 13's standard, it is reported rather than ticked.

What *is* asserted, and is the only half checkable without the container: the request this app
sends is a rendering navigation and cannot be edited into a non-rendering one.
`self-hosted-extractor.test.ts` pins that `browser_config` and `crawler_config` are sent
**empty** — every way to get back less than a rendered page is an opt-in inside those two
objects — and that the request body contains no `raw:` or `file:` scheme. That is a proof about
the request, not about the render.

**What would close it:** one live import of a known JS-shell article through a real crawl4ai
0.9 container, recorded, and compared against the same URL through Firecrawl.

### What closes each ticked criterion

1. `vite.deployment.ts` + `vite.deployment.test.ts` (fail-closed in both directions, eleven
   cases); the folded module-scope constant in `WebArticleImporter.tsx`, chosen over a prop
   precisely so the branch is statically dead; and `scripts/smoke-dist.mjs`, which was measured
   against two real artifacts before it asserted anything. **The public bundle contains no
   `/crawl`, no `/health`, no `raw_markdown` and none of the extractor's messages; the
   self-hosted bundle contains no `/v2/scrape`, no `api.firecrawl.dev` and no
   `Firecrawl API key`.** A folded constant with a static import was enough — the dynamic
   import the design held in reserve was not needed. Proved to bite by running the self-hosted
   expectation against a public artifact, which fails on `/v2/scrape`.
2. Three independent levels. At the wire: `self-hosted-extractor.test.ts` asserts the crawl
   request's header list is exactly `['content-type']`, that `authorization` is absent from
   both requests, and that `credentials: 'omit'`. In the DOM:
   `WebArticleImporter.self-hosted.test.tsx` asserts no key field, no reveal toggle, no Forget
   key, **no `input[type="password"]` of any kind**, and that the word "Firecrawl" appears
   nowhere on the screen. In memory: the key store is not constructed at all — the criterion
   says *storable*, not just *sent*. In the artifact: `smoke-dist.mjs` drives the built Web page
   tab and checks the same absences.
3. — see above.
4. — see above.
5. The design's *"The question that decides the design, settled first"* section, the two
   measurements above, and `README.md`'s new *Optional self-hosted web extraction* section,
   which leads with the transport and quotes the Chromium error verbatim because that is the
   part most likely to cost someone a day. The relay's allowlist is untouched, and
   `web-endpoints.test.ts` asserts all three web-import modules never name it.
6. `self-hosted-extractor.test.ts`, 46 tests. Unreachable (naming the origin and both
   explanations, because the browser hides which); health non-2xx; five version refusals and
   three acceptances; three "answered but is not an extraction service" cases; nine HTTP status
   families with distinct messages; nine malformed envelopes, one per required field; timeout
   under fake timers; an already-aborted signal making **zero** requests; a mid-flight abort
   rejecting with the abort reason rather than the timeout; three invalid pinned origins
   refused before any request; and a containment test proving no import on this path writes to
   `localStorage`, IndexedDB, the Cache API or cookies. Every message interpolates only a
   number, the pinned origin, or regex-matched version digits — asserted by driving nine
   statuses with a body containing `https://vendor.example/sales` and checking it never
   appears.
7. `README.md`, `PRIVACY.md`, `SECURITY.md`, plus three new obligations in
   `src/docs-claims.test.ts` so a future deletion of any of those claims fails a test rather
   than a review.

### Residuals

- **Nothing has spoken to a real crawl4ai.** See above. The version floor `>=0.9.0 <0.10.0` is
  a policy derived from source, not a compatibility matrix; nobody has run 0.9.0 itself, and a
  0.10 that changed nothing relevant would still be refused.
- **The self-hosted panel has no accessibility test with real layout.** The `unit-self-hosted`
  project is jsdom, where this repository's own config says axe assertions mean nothing, and a
  fifth Vitest project would cost a second Chromium launch. The panel is the audited public
  panel **minus** a field and with one paragraph substituted, so it is a strict subset of
  `App.a11y.browser.test.tsx`'s screen 1d — but that is an argument, not a measurement, and it
  is recorded as one.
- **`EXTRACTOR_REQUEST_TIMEOUT_MS` is 90 s and is REASONED, not measured.** No container was
  reachable to time. The comment on the constant says so.
- **A defect found in passing, and fixed.** A `define` declared at the ROOT of
  `vitest.config.ts` **does not reach its projects** — measured 2026-08-30 with a probe test
  that read both build constants as `undefined` inside the `unit` project while the root entry
  set them to `''`. The root entry had therefore never configured anything, and the app's
  `typeof` guards had been doing all the work, including for
  `__OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__`. The defines are now repeated per project. Nothing
  behaved differently — the guards' fallback and the intended value were both `''` — but the
  config's comment claimed something the mechanism was not doing.
- **`scripts/smoke-dist.mjs` and `src/components/SourceBrowser.tsx` were edited** although
  neither is in this issue's obvious file list. The first is the bundle half of the coupling
  this issue was told to re-scope; the second carried a sentence — *"the only source here that
  is fetched by a third party"* — that is simply false on a self-hosted build.
