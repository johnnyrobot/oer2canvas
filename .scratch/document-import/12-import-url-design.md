# Import one web article as one Canvas page — design

Design for document-import issue 12. Research and design only: no production code was written and no
source file was changed.

The requirement in the human's words is *"a user going to some article on the internet ... and they
want it ingested to turn that article on the web into a Canvas page."* **Any** article, anywhere on
the public web — not a curated set of hosts. That is what killed the publisher-URL slice
(`publisher-url-import-not-pursued.md`) and it is the standard this design is held to.

Everything marked **verified** was executed against a live endpoint on 2026-08-29, or read from code
in this repo or from vendor documentation cited inline. Everything marked **inferred** is reasoning a
test must pin before it is trusted. Nothing here is asserted from memory.

## The question that decides the design, settled first

Issue 12 specifies the URL and the user's API key go **browser-direct to Firecrawl**, and lists CORS
among the errors to handle — which reads like someone knew it was a risk and had not checked. Many
API vendors deliberately refuse browser-direct calls precisely to stop keys landing in web pages. If
Firecrawl were one of them, the whole posture in issue 12 would be unbuildable as written.

Firecrawl's documentation says nothing either way. `docs.firecrawl.dev/introduction` contains no
mention of CORS, of client-side JavaScript, or of a server-side-only restriction (verified by
fetching it). A web search surfaces third-party pages asserting "Firecrawl is server-side only", but
none of them cite a Firecrawl policy document, and the claim is refuted below. **Do not trust that
claim; it is wrong.**

So the question was answered by measurement instead. All four of these are **verified** —
`api.firecrawl.dev`, 2026-08-29, `Origin: https://oer2canvas.example` sent on every one:

| Probe | Result | The header that matters |
| --- | --- | --- |
| `OPTIONS /v2/scrape` with `Access-Control-Request-Headers: authorization,content-type` | `204` | `access-control-allow-origin: *`, `access-control-allow-headers: authorization,content-type`, `access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE` |
| `POST /v2/scrape` with a bad bearer token | `401 {"success":false,"error":"Unauthorized: Invalid token"}` | `access-control-allow-origin: *` |
| `POST /v2/scrape`, successful scrape | `200`, markdown body | `access-control-allow-origin: *` |
| `POST /v2/scrape` for an unsupported site (`x.com`) | `403 {"success":false,"error":"We apologize …"}` | `access-control-allow-origin: *` |

**Browser-direct Firecrawl is possible.** The preflight admits exactly the two headers this feature
needs, and — the part that is easy to miss and that decides whether failures are actionable — the
wildcard is present on the *error* responses too. A vendor that answered `401` without CORS headers
would give the browser an opaque network error, and this feature could never tell a user their key
was wrong. It can.

Two limits on that evidence, stated so nobody over-reads it:

1. curl is not a browser. CORS is a header contract and these are precisely the headers the contract
   requires, so this is strong — but the browser has not been observed doing it. The experiment that
   settles it costs nothing and needs no key: a `scripts/` probe that issues only the `OPTIONS`
   preflight from a Playwright page on a foreign origin and asserts the three headers above. It
   consumes no Firecrawl credit because a preflight is not a scrape. That probe belongs in the plan.
2. This is today's behaviour, not a promise. Firecrawl documents no CORS policy, so it can change
   without notice. The design's answer is that a CORS refusal must surface as a *named, specific*
   failure — "the browser blocked this request; Firecrawl may have changed its policy" — and
   explicitly **not** as an invitation to route the key through this app's relay. See *Failure modes*.

The wildcard also means `credentials: 'omit'` is mandatory: a response carrying
`access-control-allow-origin: *` is rejected by the browser for a credentialed request. This app must
never attach cookies to a Firecrawl call, which is correct anyway.

Nothing blocks the request at this end: `public/_headers` sets no application-wide
`Content-Security-Policy`, so there is no `connect-src` to widen. If one is ever added,
`https://api.firecrawl.dev` must be listed in it.

## The option set changed while this was being written

The human chose "each user brings their own Firecrawl key" when Firecrawl was the only option on the
table. It was not the only option, and the choice was made without this fact:

**Extraction and fetching are separable, and only fetching needs anything outside the browser.**

The evidence is the author's own sibling project, `libretexts-reader` (read-only clone at `/tmp/ltr`).
It imports arbitrary web articles and uses **no third-party extraction service** — zero references to
Firecrawl, Diffbot, Jina, or Mercury. It fetches with `reqwest` and extracts with the Rust port of
Mozilla Readability (`/tmp/ltr/src-tauri/src/content/article.rs`, 102 lines, the entire path).

That does not transfer directly — it is a desktop app, so Rust does the fetch and CORS never applies.
But Mozilla Readability has a maintained browser-capable JavaScript package,
[`@mozilla/readability`](https://github.com/mozilla/readability) (Apache-2.0, verified), whose
`parse()` returns `{ title, content, textContent, length, excerpt, byline, dir, siteName, lang,
publishedTime }` — where `content` is cleaned article **HTML**, which is exactly what
`sanitizeImportedHtml` already accepts. Its own README says *"If you're going to use Readability with
untrusted input … we **strongly** recommend you use a sanitizer library"* (verified) — this repo
already has that sanitizer and would not be adding DOMPurify.

So the real option set is:

| | How bytes arrive | Extraction | Third party | Per-user signup | The cost |
| --- | --- | --- | --- | --- | --- |
| **(a)** | Firecrawl `/v2/scrape`, browser-direct | Firecrawl | Yes | Yes: an API key | The user's URL and reading go to a vendor; a key to handle; credits to spend; `PRIVACY.md` becomes false (below) |
| **(b)** | This app's relay, allowlist removed | `@mozilla/readability` in the browser | No | No | The relay becomes a general fetcher — reversing relay rule 3 — and an abusable, operator-attributed proxy |
| **(c1)** | The user pastes the article HTML | existing | No | No | Already ships. Manual, and few instructors will use View Source |
| **(c2)** | A browser extension runs Readability on the page the user is *already looking at* | `@mozilla/readability` | No | No | A new distribution artifact and store review — but it is the only option that handles a paywall or login wall, because it uses the user's own session |
| **(c3)** | A new, narrowly-scoped `/fetch` Worker route separate from `/relay` | `@mozilla/readability` | No | No | Honestly the same decision as (b) with different packaging; do not let the separate route disguise that |

**(b) is not smuggled in here and must not be adopted quietly.** `worker/relay.ts`'s header comment
states the contract: *"Allowlists destination hosts so this cannot become an open proxy."* Removing
the allowlist reverses a documented security posture, turns the operator's Cloudflare account into an
anonymising fetcher attributable to them, and spends a request budget `wrangler.jsonc` is explicit
about protecting. It is a human's decision, not this design's. What can be said in its favour, fairly:
the relay's SSRF fences (`https` only, no userinfo, `isPrivateHostname`, IP-literal refusal,
per-hop revalidation across at most `MAX_REDIRECT_HOPS` = 5) are already the strongest part of it and
would carry over unchanged; the gap would be a response size cap, which it has none of because it
forwards bytes without buffering.

### What this design does about the fork

It refuses to make it a fork. **Every option above differs only in how bytes arrive.** The sanitizer,
the size cap, the one-section rule, provenance, the rights ceremony, the audit gate and the cartridge
are identical downstream. So `src/import/web.ts` is specified around a seam:

```ts
export interface FetchedArticle {
  markdown?: string      // preferred when the fetcher produces it
  html?: string          // otherwise; exactly one of the two is present
  finalUrl: URL          // post-redirect; what was actually extracted
  statusCode: number     // the ORIGIN's status, not the fetcher's
  contentType?: string
  retrievedFrom?: { cachedAt: string }   // when the fetcher served a cached copy
}
export type WebArticleFetcher =
  (url: URL, signal: AbortSignal) => Promise<FetchedArticle>
```

Issue 12 ships one implementation, `firecrawlFetcher`. A Readability-over-relay fetcher, if the human
chooses (b) or (c3) later, is a second implementation and nothing else in the pipeline moves. The
decision stops being expensive, which is the only responsible thing to do with a decision that is not
mine to make.

## Decisions

| Decision | Choice |
| --- | --- |
| Browser-direct Firecrawl | **Buildable — verified above.** No relay route for Firecrawl traffic, ever |
| Which endpoint | `POST /v2/scrape` only. `crawl`, `map`, `search`, `agent`, `batch` never referenced |
| What we ask for | `formats: ['markdown']`, `parsers: []` — never `links`, never `html` |
| Where it enters | `sanitizeImportedMarkdown` via `importText`, by delegation. **No new sanitizer** |
| Images | Refused, keeping the existing blocker **and** the `[Embedded image: alt]` placeholder |
| Key storage | Module-scoped variable, the `src/canvas/credentials.ts` pattern, with `forget()` |
| PDF URLs | Refused with a pointer to the Document tab, not silently server-extracted |
| Origin status | `metadata.statusCode` must be 2xx or the import is refused |
| Rights ceremony | Unchanged mechanism, changed wording. No new legal policy invented |
| The two URL boxes | Both stay. They are different verbs. Nudge, never redirect |
| Fetcher shape | A seam (above), so (b)/(c) remain cheap |

## Key handling

Trace of where this app persists anything, so the claim is checkable rather than asserted
(`grep -rn "localStorage|sessionStorage|indexedDB|document.cookie" src worker`, tests excluded —
verified, three hits):

- **IndexedDB** — `src/canvas/idb.ts`, whose own comment calls it *"the one place this app writes to
  disk."* Holds the Canvas base URL and the push journal.
- **`localStorage`** — one key, the theme, in `src/shell/useTheme.ts`.
- **Cookies** — none.

The Firecrawl key touches none of them, by construction, not by discipline: it never reaches a
function that takes a `KeyValueStore`. The holder mirrors `src/canvas/credentials.ts`, which already
solved this problem and documented why —

> Holding it here rather than in `sessionStorage` is deliberate: `sessionStorage` survives a reload
> and is readable by any script on the origin, which is most of what we were avoiding. A
> module-scoped variable dies with the document, which is what "session only" should mean.

so `createFirecrawlKeyStore()` returns `{ hold(key), peek(), forget() }` over a `let held: string |
undefined`, and **takes no store argument at all**. There is no persistence path to forget to avoid,
because the type does not admit one. "Forget key" clears `held` and the live input field. Canvas
needed a migration to erase keys written by earlier releases; this feature has no earlier release, so
it needs none — and must never acquire one.

Logging is already closed: `grep -rn "console\." src worker` excluding tests returns **nothing**
(verified), and `wrangler.jsonc` sets `observability.enabled: false` with the comment *"Constraint 2:
the relay writes nothing, including logs."*

Error reporting is the classic leak and gets three specific rules:

1. **The key travels in the `Authorization` header and never in a URL.** A query parameter would land
   in the browser's network panel URL column, in a `Referer` on any redirect, and in whatever the
   vendor logs. (`Referrer-Policy: no-referrer` in `public/_headers` mitigates the second; not
   creating the exposure is better than mitigating it.)
2. **Every user-facing message is app-authored from the HTTP status.** `messageOf` in `src/errors.ts`
   returns `error.message` verbatim, so any `Error` this module throws must be constructed from a
   status code and a fixed string — never from the request, the headers, or an interpolated response
   object. A test asserts the held key's characters appear in no thrown message and in no
   `ImportFinding`.
3. **The vendor's own error string is data, not copy.** Measured: the `403` body is *"We apologize
   for the inconvenience but we do not support this site … please fill out our intake form here:
   https://fk4bvu0n5qp.typeform.com/to/Ej6oydlg"* — a vendor-controlled URL pointing at an enterprise
   sales form, useless to an instructor. It is not shown. If it is ever shown for debugging it goes
   in a `<details>` as React text content, never linkified and never `innerHTML`.

## What Firecrawl returns, and where it enters the pipeline

Measured against `https://en.wikipedia.org/wiki/Photosynthesis` with `formats: ['markdown','html']`,
`onlyMainContent: true` (verified):

- `markdown` — 268 645 characters.
- `html` — 925 711 characters, containing `<form>`, `<input>`, `<button>`, `<link>` and a `<ref>`
  custom element even with `onlyMainContent: true`.
- `metadata` — `sourceURL`, `url`, `statusCode`, `contentType`, `title`, `language`, `favicon`,
  `cacheState`, `cachedAt`, `creditsUsed`, plus every OpenGraph key the page declared.

**Ask for `markdown` and not `html`.** Both are untrusted and both would be sanitized identically, so
this is not a safety argument — it is a smaller attack surface (a third the bytes), and the HTML
carries a large volume of publisher chrome that `sanitizeImportedHtml` would unwrap into
`import-unsupported-element-removed` noise which tells the user nothing. Markdown is not "clean",
either: a probe of `http://127.0.0.1:8080/` came back as markdown containing a raw `<html><head>…`
block (verified), which is precisely why it goes through the sanitizer and not around it.

**The entry point is `importText`, by delegation.** `src/import/web.ts` performs the network call and
validates the envelope, then hands the extracted markdown to `importText` as a new
`TextImportInput` variant:

```ts
| { kind: 'web'; text: string; format: 'markdown'; sourceUrl: URL }
```

Delegating rather than duplicating buys, with no new code: `sanitizeImportedMarkdown` (the existing
untrusted path), the `MAX_TEXT_IMPORT_BYTES` cap (2 MiB — Wikipedia's 268 KB has plenty of room),
the `!text.trim()` empty refusal, `sha256Hex` over the extracted bytes feeding `documentIds`, the
`ImportProvenance` construction, and the exactly-one-section `ImportedWork` shape. The only
conditionals `importText` gains are `report.parser = 'firecrawl'` and `work.format = 'web'` — both of
which `src/import/types.ts` **already declares** (`ImportReport.parser` lists `'firecrawl'`,
`ImportedFormat` lists `'web'`, `ImportProvenance.kind` lists `'web'`), dead today and put there for
this issue.

A new variant rather than post-mutating the returned `ImportResult`: rewriting `provenance.kind` and
`report.parser` after the fact would put two places in charge of what a `web` import is, and the
second would drift.

## Images in a fetched article

**Refused.** Not by new code — by the sanitizer this path already enters. `markup.ts`'s image branch
replaces every `<img>` with a `<span>[Embedded image: alt]</span>` and raises the blocking
`import-image-unavailable`. So a fetched article gets **both** halves of the house rule for free: a
finding says *why*, a visible placeholder says *where*, and nothing publishes with a silent hole.

That is also the right answer on the merits, which matters because the alternative was available:

- **Not left as external references.** `anydoc-html.ts:202` *does* emit `<img src>` for a public-host
  external image with an `external-image` warning. Doing the same here would mean a Canvas page whose
  pictures are hotlinked from an arbitrary publisher — a page that rots when they reorganise, and a
  request from every student's browser to a host neither the instructor nor this app vetted.
- **Not packaged.** There is nothing to package. Firecrawl returns no image bytes, and fetching them
  from the browser is not reliably possible: it is host-by-host luck. `upload.wikimedia.org` and
  `cdn.arstechnica.net` both answer `access-control-allow-origin: *` (verified), so those would work
  and a great many others would not — and a feature that silently keeps some pictures and drops
  others is worse than one that consistently drops all of them.

**The private-address fence is inherited, not missing.** `publisher-url-import-not-pursued.md` found
that `isPublicNetworkUrl` is applied by `markup.ts` and `anydoc-html.ts` but not by the publisher
path. Because this design enters through `markup.ts`, it gets the fence: `isDangerousUrl` runs
`isPublicNetworkUrl` on every `href`, `src` and `cite` and records
`import-dangerous-url-removed`. A `<a href="http://169.254.169.254/…">` in a fetched article is
stripped with a finding. That claim is only true while images stay refused — if open question 1 is
answered by letting public external images through, the fence must move to the gate as that document
proposed, reusing `strippedUrls`.

**Firecrawl does not fence for us.** A scrape of `http://127.0.0.1:8080/` was accepted and proxied,
returning `metadata.statusCode: 502, "Upstream proxy refused connection"` (verified) — it *tried*.
So `src/import/web.ts` validates the target with the existing `parsePublicSourceUrl` **before** the
request leaves the browser: HTTPS only, no userinfo, no IP literal, no private or reserved hostname.
This is the author's established stance, stated in his own words in the sibling repo
(`/tmp/ltr/src-tauri/src/content/pressbooks.rs:848-873`): *"every field of the URL becomes part of
every request the Import makes."* His article path is the one place he did not apply it, and it
accepts `http://169.254.169.254/` today. This design does not reproduce that.

## One URL, one page — structurally, not by intention

Four independent reasons, each mechanical:

1. **One endpoint.** The module names `https://api.firecrawl.dev/v2/scrape` and nothing else.
   `/v2/crawl`, `/v2/map`, `/v2/search`, `/v2/batch` and `/v2/agent` never appear. A test greps the
   built module for those path strings and fails on any hit — the same "assert the absence" shape
   `scripts/smoke-dist.mjs` already uses against the built bundle.
2. **The link set is never requested.** Firecrawl's `links` format returns every outbound URL on the
   page. This design asks for `['markdown']`. The code that would follow links cannot be written
   accidentally because it never receives the links.
3. **`importText` produces exactly one section.** Its `sections:` literal is a one-element array. A
   fetcher that somehow returned ten documents could not express them.
4. **`onPick` is not involved.** The publisher flow reaches a `ChapterPicker` over many URLs; this
   flow reaches `ImportPlanEditor` over one `ImportResult`. Splitting one article into several Canvas
   pages in the plan editor is user-driven division of one document, not crawling — the distinction
   is that no second network request exists in this path at all.

## Provenance and rights

**The URL that is recorded is the one that was extracted.** Firecrawl reports both `metadata.sourceURL`
(what was asked for) and `metadata.url` (after redirects). Provenance records `metadata.url`,
re-validated with `parsePublicSourceUrl`, and a warning finding is raised when the two differ, because
"you asked for X and got Y" is exactly the thing a user should be told before they publish it under
their name. That same URL is what `importText` passes to the sanitizer as `publicBaseUrl`, so
provenance and relative-link resolution cannot disagree — they read the same field.

**Staleness is disclosed.** `maxAge` defaults to `172800000` ms — 48 hours (Firecrawl API reference,
verified), and a live scrape returned `cacheState: "hit"` with a `cachedAt` timestamp (verified). So
"import this article" can return a copy up to two days old. The default is kept — forcing `maxAge: 0`
spends a credit on every retry for freshness nobody asked for — and a warning finding names `cachedAt`
when the copy was cached. Disclosed, not hidden; see open question 6.

**Rights: the honest part.** This is `oer2canvas`. An OER page is openly licensed; an arbitrary web
article usually is not, and `RIGHTS_AUTHORITIES` offers `own | permission | open-license |
public-domain`, none of which is "I found it on the internet". This design **invents no legal policy**
and changes no gate. It makes two changes that are wording and one observation:

- The rights fieldset on this path is prefaced with a sentence saying that extraction is not a
  licence and that public readability is not `open-license`. That is a statement of fact, not policy.
- `licenseName` / `licenseUrl` are not prefilled from anything Firecrawl returns. It reports no
  licence, and guessing one from an OpenGraph tag would be exactly the fabrication this repo refuses.
- **A real gap, measured, not invented:** `validateImportMetadata` requires a `licenseName` only when
  a `licenseUrl` is supplied. Neither is ever required. So `open-license` can be selected today, on
  any import path, naming no licence at all. On a publisher import that is nearly harmless; on an
  arbitrary web article it is the difference between a defensible claim and a bare assertion.
  Whether to tighten it is a product decision — open question 5.

## Privacy documentation must change, and it is not optional

`PRIVACY.md` currently says, of imported content:

> source bytes, parser output, and benchmark measurements are not uploaded to Cloudflare,
> **Firecrawl**, or another service.

Shipping option (a) makes that sentence **false**. It names Firecrawl specifically. The sibling repo's
`CLAUDE.md` opens by correcting exactly this class of mistake — an app that claimed nothing left the
machine while image downloads had no host allowlist — and its `PRIVACY.md` carries a host table
including "Any URL you paste". This repo must do the same before the feature ships, not after:

- **`PRIVACY.md`** — the quoted sentence is amended to scope it to the local parsers it was written
  about, and a new paragraph states that when a user imports a web article, **the URL they enter and
  their Firecrawl API key are sent from their browser directly to `api.firecrawl.dev`**, that the app
  relay is not involved, that the key is memory-only, and that Firecrawl's own privacy terms govern
  what happens at that end. Any URL the user pastes is a host this app now talks to.
- **`README.md`** — the feature requires the user's own Firecrawl account and key.
- **`SECURITY.md`** — the key is memory-only with a Forget action and appears in no log.
- **`THIRD-PARTY-NOTICES.md`** — only if option (b)/(c) adds `@mozilla/readability` (Apache-2.0).
  Option (a) adds no dependency; the two `@firecrawl/*` packages already in `package.json` are local
  WASM and unrelated to the network path.

The UI itself must say it before the request, which is criterion 1 of the issue: the panel states the
destination and what is sent, above the button, not behind a disclosure triangle.

## Failure modes

Every row produces an app-authored message and, where the import got far enough to have a report, an
`ImportFinding`. Detection column marked verified where it was executed on 2026-08-29.

| Condition | Detection | Response |
| --- | --- | --- |
| Bad or expired key | HTTP `401`, `{"success":false,"error":"Unauthorized: Invalid token"}` (**verified**) | "Firecrawl rejected this API key." Offer Forget-and-retype. Key is *not* auto-forgotten — a typo'd paste is the common case and silently discarding it is hostile |
| Quota exhausted | Non-2xx that is not 401/403/429. Firecrawl's rate-limit page documents no `402` (**verified absent**), so this is **inferred** and must be handled by the generic branch | "Firecrawl refused the request (HTTP n). Check your plan's credit balance." |
| Rate / concurrency limit | HTTP `429`. Free plan is 10 `/scrape` requests per minute and 2 concurrent browsers (Firecrawl rate-limits doc, **verified**) | "Firecrawl is rate-limiting this key. Wait a minute and try again." One import is one request, so this needs a burst of retries to hit |
| CORS refusal | `fetch` rejects with a `TypeError` and no `Response`. **Indistinguishable from offline** — the browser deliberately hides the reason | Message names both: "The browser could not reach Firecrawl. You may be offline, or Firecrawl may have changed its policy on browser requests." **It must not offer to route through the relay.** A regression test asserts the string contains no relay suggestion |
| Timeout | `AbortController` armed at `FIRECRAWL_REQUEST_TIMEOUT_MS` | "Firecrawl did not answer in 60 seconds." See open question 3 |
| Cancellation | `AbortSignal`; `isAbortError` in `src/errors.ts` | The existing wording: "Import cancelled. You can edit the source and try again." |
| **A PDF URL** | `parsers: []` is sent, **and** `metadata.contentType` is checked for `application/pdf`. With the default `parsers: [{"type":"pdf"}]` a PDF is silently text-extracted server-side (**verified**: `dummy.pdf` returned `success:true`, `numPages:1`) | Refuse, and point at the Document tab. Issue 11's local PDF path computes `pagesNeedingOcr`, `pdfType` and layout signals that decide whether a scan blocks; the remote path returns none of them, so accepting a PDF here would publish a scan-derived page with no scanned-page finding |
| Login wall / bot block | HTTP `403`, `success:false` (**verified** on `x.com`) | "Firecrawl could not read this site." Vendor text not shown |
| **A 404 or other origin error** | `metadata.statusCode`. **This is the single most important envelope check**: `example.com/definitely-not-here-404` returned HTTP **200** with `success: true` and a full markdown body, and only `metadata.statusCode: 404, metadata.error: "Not Found"` revealed it (**verified**) | Refuse unless `metadata.statusCode` is 200–299. Without this, a publisher's 404 page publishes as an article and nothing ever says so |
| JS-only app shell / near-empty | `importText` throws on `!text.trim()`; `sanitizeImportedHtml` raises the `import-no-supported-content` blocker when nothing semantic survives | Refused at the extremes. A *near*-empty threshold is deliberately not invented — see open question 4, which is the same shape as design 11's open question 2 |
| Not JSON / unexpected shape | `success !== true` or `data.markdown` absent | "Firecrawl returned an unexpected response." Fail closed rather than parse defensively |

`FIRECRAWL_REQUEST_TIMEOUT_MS = 60_000` is the vendor's documented default for the `timeout` body
parameter (Firecrawl `/v2/scrape` API reference, verified). It is sent explicitly *and* used as the
client deadline, so the two cannot drift apart in a future doc revision.
`PARSER_PROBE_LIMITS.parserTimeoutMs` (30 000) is deliberately **not** reused: it budgets local WASM
CPU, and a network round trip that includes a headless browser rendering someone's site is a
different thing. Observed latencies were 0.5 s – 2.1 s across four sites, but `maxAge` means several
were cache hits, so those are not cold-path evidence and no number is derived from them.

## How this relates to the shipping LibreTexts URL box

`src/components/SourceBrowser.tsx:95-111` already accepts a `libretexts.org` URL today. Two URL boxes
in one app is a UX problem, so: **they are different verbs and neither should absorb the other.**

- The LibreTexts box is a **book opener**. It validates the host, derives a title from the path, and
  calls `onPick({ source: 'libretexts', … })` — a `BookRef`. It performs no fetch, produces no
  `ImportResult`, and leads to the chapter picker over the relay. Its answer to "one URL" is *many*
  pages, structured, no key, no credits, a known-open licence.
- The new box is an **article importer**. It fetches once, produces one `ImportResult`, and leads to
  `ImportPlanEditor`. Its answer to "one URL" is exactly one page.

Merging them would mean one control whose behaviour forks invisibly on hostname — sometimes a book,
sometimes a page, sometimes spending a credit and sometimes not. Instead:

1. The article importer is a new `web` tab in `SourceBrowser`, labelled **"Web page"**, beside
   Document and Text. It is not nested under a publisher tab.
2. When the URL pasted into it matches `libretexts.org`, `openstax.org` or a Pressbooks pattern, a
   **non-blocking** notice appears before the request: *"This is a LibreTexts book. Opening it from
   the LibreTexts tab gets structured chapters and needs no API key."* with a button that switches
   tabs. It **never** redirects on its own — silently doing something other than what the button says
   is exactly the surprise this repo's fail-closed rule exists to prevent.
3. The LibreTexts box's summary text ("Open a LibreTexts URL instead") already reads as an opener and
   needs no change.

## Files

| File | Change |
| --- | --- |
| `src/import/web.ts` | **New.** `WebArticleFetcher` seam, `firecrawlFetcher`, envelope validation, `importWebArticle`, `FIRECRAWL_ENDPOINT`, `FIRECRAWL_REQUEST_TIMEOUT_MS` |
| `src/import/firecrawl-key.ts` | **New.** `createFirecrawlKeyStore()` — `hold`/`peek`/`forget` over a module-scoped variable, taking no store argument |
| `src/import/text.ts` | `TextImportInput` gains the `web` variant; `report.parser` and `work.format` become conditional |
| `src/components/WebArticleImporter.tsx` | **New.** Mirrors `TextContentImporter`: the URL field, the key field with Forget, the pre-request disclosure, `ImportMetadataFields` with the rights preface, `AbortController` cancel |
| `src/components/SourceBrowser.tsx` | The `web` tab and the publisher nudge |
| `src/App.tsx` | `onImportWeb={stageImportedContent}` — the existing staging path, unchanged |
| `PRIVACY.md`, `README.md`, `SECURITY.md` | As set out above. **Blocking, not follow-up** |
| `scripts/verify-firecrawl-cors.mjs` | **New.** Preflight-only probe; no key, no credit |
| `.scratch/document-import/issues/12-import-url-with-firecrawl.md` | `**Design:**` link |

Nothing in `worker/` changes. No allowlist entry is added. No Firecrawl traffic touches the relay.

## Testing

**Unit (jsdom `unit` project)**, with an injected `fetch` so nothing reaches the network:

- Envelope validation, one case per row of the failure table, driven by the **captured real
  responses** recorded above rather than by invented JSON — the 404-inside-a-200 case in particular.
- `metadata.statusCode: 404` produces a refusal and no `ImportResult`.
- `contentType: application/pdf` produces a refusal naming the Document tab.
- A `finalUrl` differing from the requested URL produces the redirect warning and is what lands in
  `provenance.sourceUrl`.
- **The key never escapes:** hold a sentinel key, force every failure, assert the sentinel appears in
  no thrown message, no `ImportFinding`, and no request URL — only in the `Authorization` header.
- **Nothing is persisted:** run a failing and a succeeding import with `indexedDB` and `localStorage`
  spied, assert neither was written.
- `forget()` clears the held key, and a subsequent import fails with "no key" rather than reusing it.
- **One URL, one page:** the request body's `formats` is exactly `['markdown']` and `parsers` is `[]`;
  the module source contains none of `/crawl`, `/map`, `/search`, `/batch`, `/agent`.

**Browser (`browser` Chromium project)**:

- A captured Firecrawl markdown fixture from a real article through `importWebArticle` → the plan
  editor → `enforceGate`, asserting each image yields both `import-image-unavailable` and a visible
  `[Embedded image: …]` placeholder, and that the audited bytes are the exported bytes.
- The `SourceBrowser` tab, the pre-request disclosure text, the Forget button, and cancellation.
- The publisher nudge appears for a `libretexts.org` URL and switches tabs only when clicked.

**Live, out of band** — `npm run verify:firecrawl-cors`, the preflight-only probe. It is the one
assertion that cannot be made in jsdom or in a same-origin browser test, it needs no key, and it costs
no credit. If it ever fails, the browser-direct posture has been withdrawn by the vendor and the human
must choose from the option table again.

## Non-goals

- Crawling, recursion, link following, sitemaps, `/map`, `/search`, `/agent`, batch scraping.
- Any relay involvement in Firecrawl traffic. Any widening of `worker/allowlist-hosts.ts`.
- An operator-supplied, shared, or server-stored key. Firecrawl Keyless (open question 2).
- Screenshots, `json` extraction, `summary`, or any LLM-backed Firecrawl format.
- PDFs by URL — issue 11 owns PDFs, locally, where the scanned-page signals exist.
- Packaging article images into the cartridge, or hotlinking them.
- Authenticated, paywalled, or login-walled articles. Only option (c2) could ever reach those.
- Persisting the fetched article, the URL, or the key across a reload.

## Open questions

1. **Should `markup.ts` keep refusing every image?** Today it refuses all of them; `anydoc-html.ts`
   permits public-host external images with an `external-image` warning. The two importers disagree.
   Refusing is right for arbitrary web articles — a 40-image Wikipedia page becomes 40 placeholders
   and one blocker, which is honest but heavy. Changing it would also change the **shipped**
   HTML/Markdown paste path, and would require moving the `isPublicNetworkUrl` fence to the gate as
   `publisher-url-import-not-pursued.md` proposed. Not this design's call.
2. **Should this use Firecrawl Keyless instead of a per-user key?** `POST /v2/scrape` with **no
   `Authorization` header at all** returned `200` with `creditsUsed: 1` (**verified**, 2026-08-29).
   That would delete the entire key-handling problem. It also raises questions this design cannot
   answer: whose quota is charged, whether unauthenticated use from a public web application is
   permitted by Firecrawl's terms, and whether a shared unauthenticated pool is a denial-of-service
   surface for every user of the app. Needs a human and a reading of Firecrawl's ToS. **Do not build
   on it until then.**
3. **How much slack should the client abort deadline have over the vendor's 60 000 ms `timeout`?**
   Equal means the client may cancel a request Firecrawl was about to answer; larger by an invented
   margin is a bare literal. The experiment: scrape twenty slow, uncached, JS-heavy pages with
   `maxAge: 0` and record the distribution.
4. **Is there a near-empty extraction floor, and what is it?** Empty is refused today. Three garbled
   words are not. A characters-per-page floor is a product decision needing real pages, and there is
   nothing in this repo to derive one from. Same shape, same answer as design 11's open question 2.
5. **Should `open-license` require a named licence on a web import?** `validateImportMetadata`
   requires `licenseName` only when `licenseUrl` is given, so `open-license` can be claimed naming
   nothing. Tightening it changes every import path. Product and legal, not engineering.
6. **Cache: disclose or defeat?** Keep `maxAge` at the documented 48-hour default and warn with
   `cachedAt` (this design's choice), or send `maxAge: 0` and spend a credit for a guaranteed-fresh
   copy on every import — including every retry after a validation failure.
7. **Should the UI show credit cost before the request?** A scrape costs 1 credit (**verified**:
   `creditsUsed: 1`). Whether Firecrawl exposes a balance endpoint this app could read cross-origin
   was not checked.
8. **Whose responsibility is the target site's terms?** The user fetches an arbitrary site through a
   third party. Whether this app should say anything about robots.txt, terms of service, or paywall
   circumvention is a human's call. It is not legal advice this design can give.
9. **And the one that outranks all of the above: (a), (b), or (c)?** The human chose "each user brings
   their own key" believing Firecrawl was the option. It is not. (a) is fully designed here and is
   buildable today. But (b)/(c) need no vendor, no key, no signup and no credits, at the price of
   either reversing the relay's documented posture or shipping a browser extension. The seam in
   `src/import/web.ts` makes the answer cheap to change later, which is why this design does not need
   the answer to proceed — but the human should give it before this becomes load-bearing.
