# Extract a web article on a self-hosted deployment, without a Firecrawl key — design

**Issue:** [`issues/17-extract-web-articles-self-hosted.md`](issues/17-extract-web-articles-self-hosted.md)

**Blocked by:** 12 — Import one URL using a memory-only Firecrawl key. Resolved.

## What this issue is for

Issue 12 built the `WebArticleFetcher` seam in `src/import/web.ts` and put exactly one
implementation behind it, `firecrawlFetcher`. Everything a page *is* — the public-HTTPS
fence, the 404-inside-200 check, the PDF refusal, the redirect and cache disclosures, the
rights ceremony, sanitization, image refusal, findings, provenance — lives BELOW that seam
and is shared. This issue supplies the second implementation and nothing else.

It exists because the two deployments answer *"who bears the abuse liability for fetching
arbitrary URLs"* differently. On the public build the answer is the instructor's own
Firecrawl account. On a self-hosted build the answer is the operator's own machine, which
is theirs to answer for — and an operator who has already accepted that liability should
not also have to make every one of their users open a Firecrawl account.

## The question that decides the design, settled first — and measured

The issue names the hard part: *"A local extractor conventionally listens on
`http://localhost:<port>`. A page served over HTTPS cannot call plain HTTP, and the relay
allowlists destination hosts precisely so it cannot become an arbitrary proxy. Whether the
extractor sits behind the relay, beside it, or is required to serve HTTPS is the substance
of this issue."*

**It is required to serve HTTPS, on an origin the operator pins at build time, and the
relay is not involved at all.** Three separate findings force that, and the first two were
measured rather than argued — see facts 1 and 2 below.

### Why not `http://localhost`

The folklore answer is that loopback is exempt: `http://127.0.0.1` and `http://localhost`
are *potentially trustworthy* under Secure Contexts §3.1, so a fetch to one of them is not
mixed content. That much is still true — measured fact 2 shows the browser does not raise a
mixed-content error for a loopback target the way it does for any other plain-HTTP target.

It is also irrelevant, because a *second*, newer gate closes the same door. Measured fact
1: Chromium 151 answers a loopback fetch from an HTTPS page with

> `blocked by CORS policy: Permission was denied for this request to access the`
> `` `loopback` `` `address space.`

That is Local Network Access, and the permission is denied by default. A deployment that
relied on it would work only for a user who grants a permission prompt for a service they
have never heard of, and would break outright wherever the prompt is unavailable. It is not
a transport.

And even if it worked, `http://localhost` describes a service on **the user's own machine**,
not the operator's. The issue's requirement is that *"their users import a URL with no
third-party account and no API key"* — users, plural, on a campus. Loopback serves exactly
one of them: whoever is sitting at the extractor. It is the shape of a developer's
convenience, not the shape of the deployment this issue is for.

### Why not behind the relay

Three reasons, in descending order of how much they matter.

1. **The relay physically cannot reach it.** `worker/relay.ts` runs on Cloudflare's edge. A
   crawl4ai container on the operator's LAN, at `http://10.0.0.5:11235` or on loopback, is
   not routable from there. Routing the extractor through the relay does not solve the
   localhost problem; it makes it unsolvable. The only extractor a relay could reach is one
   already published at a public origin — which the browser can call directly.
2. **It would gut relay rule 3 while appearing to honour it.** `worker/relay.ts` says of
   itself: *"Allowlists destination hosts so this cannot become an open proxy."* Allowlisting
   one extractor origin would satisfy the letter of that and destroy the substance, because
   that one allowlisted destination fetches **any URL named in the POST body**. The relay
   would become an arbitrary web proxy with one hop of indirection.
3. **It would put this project's infrastructure back in the path.** Issue 12 removed it
   deliberately, and `README.md`, `PRIVACY.md` and `SECURITY.md` all say so in terms
   (*"The relay is not involved in web-page import and its allowlist is unchanged"*).
   `src/import/web-endpoints.test.ts` pins it with an assertion that neither web-import
   module names `/relay`. That property is worth keeping for the second fetcher too, and
   this design keeps it: **no file under `worker/` changes behaviour, and no new
   `RelayEnv` field, allowlist pattern, or route is added.**

### What the operator runs instead

The extractor sits **beside** the relay, at an operator-pinned HTTPS origin, and the browser
calls it directly — structurally identical to the Firecrawl call, minus the credential.

This is not an imposition invented here. crawl4ai's own shipped `config.yml` prescribes it,
in a comment on the bind address (fact 3):

> `# Loopback by default. Exposing on 0.0.0.0 requires a credential`
> `# (CRAWL4AI_API_TOKEN); the startup auth guard refuses an open non-loopback`
> `# bind without one. Put a TLS-terminating reverse proxy in front for exposure.`

So the reverse proxy the browser needs for TLS is the same reverse proxy the vendor already
requires for exposure. It does three jobs, all of them the operator's, none of them this
app's:

| The proxy does | Because |
| --- | --- |
| Terminates TLS at `https://extract.example.edu` | Facts 1 and 2: nothing else is reachable from an HTTPS page |
| Answers CORS for the app's origin | Fact 4: crawl4ai 0.9 is deny-by-default (`cors_allow_origins: []`) |
| Injects `CRAWL4AI_API_TOKEN`, if set | Fact 5: crawl4ai refuses to start on a non-loopback bind without a credential |

The third row is what keeps criterion 2 true. The extractor's token, if there is one, is a
**deployment** secret held by the operator's proxy. It is never a build define, never a
field in this app, never held in a store, and never sent by the browser. The browser sends
no credential of any kind on this path.

## Measured facts

Everything in this section was executed or read on **2026-08-30** on this machine, against
this repository's own toolchain or against the vendor's source at a named tag. Nothing here
is from memory. The plan must not re-derive any of it.

1. **An HTTPS page cannot reach `http://127.0.0.1` or `http://localhost`, and the reason is
   not mixed content.** Measured with this repository's own Playwright Chromium
   (`browser.version()` → **151.0.7922.34**), driving a page whose origin is
   `https://oer2canvas.example` (`window.isSecureContext === true`) at a plain `node:http`
   listener on 127.0.0.1. All of `GET http://127.0.0.1:<port>/probe`,
   `GET http://localhost:<port>/probe`, and a JSON-preflighted
   `POST http://127.0.0.1:<port>/crawl` rejected with `TypeError: Failed to fetch`, each
   accompanied by the console error

   ```
   Access to fetch at 'http://127.0.0.1:63631/probe' from origin
   'https://oer2canvas.example' has been blocked by CORS policy: Permission was
   denied for this request to access the `loopback` address space.
   ```

   The control rules out every other explanation: **the same three requests against the same
   listener, from a page served over plain HTTP at `http://127.0.0.1:<pagePort>/`, all
   returned 200** — including the preflighted POST — with no console error at all. The
   listener, the CORS headers, and the request shapes were identical; only the page's scheme
   differed.

2. **A non-loopback plain-HTTP target from the same HTTPS page is blocked as mixed content,
   before the request exists.** Same page origin, target `http://extract.example.edu/health`,
   with a Playwright route handler registered on that URL to count arrivals:

   ```
   Mixed Content: The page at 'https://oer2canvas.example/' was loaded over HTTPS,
   but requested an insecure resource 'http://extract.example.edu/health'. This
   request has been blocked; the content must be served over HTTPS.
   ```

   The route handler fired **zero** times — the renderer refused it, so it never became a
   network request. Facts 1 and 2 together are the whole transport answer: loopback fails to
   a permission gate, everything else fails to mixed content, and HTTPS is what is left.

3. **crawl4ai binds loopback by default and its own config prescribes a TLS-terminating
   reverse proxy for exposure.** `deploy/docker/config.yml` at tag `v0.9.2`:
   `app.host: "127.0.0.1"`, `app.port: 11235`, with the comment quoted in full above. At tag
   `v0.8.0` the same file reads `host: "0.0.0.0"` — the loopback default and the guard are
   new in the 0.9 line.

4. **crawl4ai 0.9 is CORS-deny-by-default.** `deploy/docker/config.yml` v0.9.2:
   `security.cors_allow_origins: []`, with the comment *"deny-by-default; list explicit
   origins to allow CORS"*. `deploy/docker/server.py` `_setup_security` filters `"*"` out of
   that list before installing `CORSMiddleware` at all, and installs nothing when the list is
   empty. **A browser-direct call to an unconfigured crawl4ai therefore fails at the
   preflight**, and telling the operator to add their app origin is not optional advice.
   v0.8.0's `config.yml` has no `cors_allow_origins` key.

5. **Auth is fail-closed and covers every route except two.** `server.py` v0.9.2 installs
   `AuthGateMiddleware` with `public_paths={HEALTH_PATH, "/token"}`, and its `_resolve_auth`
   docstring records the startup rule: *"none + non-loopback bind -> refuse to start (would
   be open to the network)"*. So `GET /health` is reachable without a credential on every
   correctly configured deployment, and `POST /crawl` may or may not need one depending on
   what the operator configured — which is why the proxy, not the browser, supplies it.

6. **`GET /health` returns a version, and it is the only public shape worth handshaking on.**
   `server.py` v0.9.2: `return {"status": "ok", "timestamp": time.time(), "version": __version__}`,
   mounted at `config["observability"]["health_check"]["endpoint"]`, whose default in
   `config.yml` is `/health`.

7. **`POST /crawl` is the only endpoint that can satisfy the seam.** The full route table of
   `server.py` v0.9.2 is `/`, `/token`, `/config/dump`, `/md`, `/html`,
   `/artifacts/{artifact_id}`, `/screenshot`, `/pdf`, `/execute_js`, `/llm/{url:path}`,
   `/schema`, `/hooks/info`, `/health`, `/metrics`, `/crawl`, `/crawl/stream`, `/ask`.
   `/md` returns only `{url, filter, query, cache, success, markdown}` — **no status code and
   no final URL** — and `web.ts` says of `statusCode` that *"a fetcher that cannot report this
   cannot be used"*. `/crawl` is the one endpoint that carries all four things the seam needs.
   Its request body is `CrawlRequest` (`deploy/docker/schemas.py`):
   `urls: List[str] = Field(min_length=1, max_length=100)`, plus optional `browser_config`,
   `crawler_config`, `crawler_configs`, `hooks`.

8. **`status_code` is the FIRST hop's status; `redirected_status_code` is the final page's.**
   `crawl4ai/async_crawler_strategy.py` v0.9.2 walks `request.redirected_from` backwards and
   assigns `status_code = first_resp.status` under a comment that says so
   (*"trace the `request.redirected_from` links until the first response that differs from the
   final one and surface its status-code"*), while `redirected_status_code = response.status`
   is taken from the response Playwright actually returned, and `redirected_url = page.url`
   after JS navigation. **This is a trap.** Reading `status_code` naively would hand
   `importWebArticle` a `301` for every redirected article and refuse it as non-2xx. The
   fetcher must prefer `redirected_status_code`.

9. **`response_headers` is also the FIRST hop's** — the same `first_resp` — so on a redirected
   fetch its `content-type` describes the redirect, not the article. See *The PDF refusal,
   honestly* below for what this design does about it.

10. **`redirected_status_code` does not exist before 0.9.0.** Present in `crawl4ai/models.py`
    at tags `v0.9.0` and `v0.9.2`; **absent** at `v0.8.0`. Combined with facts 3 and 4, the
    0.9 line is the first one this app can speak to correctly *and* the first one whose
    defaults are safe to expose. That is the concrete reason the version handshake exists and
    the concrete thing it refuses.

11. **`markdown` is an object in the JSON, not a string.** `CrawlResult.model_dump` is
    overridden in `crawl4ai/models.py` to emit `result["markdown"] = self._markdown.model_dump()`,
    and `MarkdownGenerationResult` is
    `{raw_markdown: str, markdown_with_citations: str, references_markdown: str, fit_markdown: Optional[str], fit_html: Optional[str]}`.
    `raw_markdown` is generated from `cleaned_html` (`DefaultMarkdownGenerator`'s
    `content_source` default), so it is already free of scripts and styles.

12. **`fit_markdown` is `""` unless the operator configures a content filter.**
    `crawl4ai/markdown_generation_strategy.py` v0.9.2: `fit_markdown` is computed only
    `if content_filter or self.content_filter`, and `DefaultMarkdownGenerator.__init__`
    defaults `content_filter=None`. So the closest analogue of Firecrawl's `onlyMainContent`
    is empty on a default deployment. See *Which markdown* below.

13. **The `/crawl` envelope is `{success, results, server_processing_time_s,
    server_memory_delta_mb, server_peak_memory_mb}`** (`deploy/docker/api.py`
    `handle_crawl_request`), where `results` is a list of `CrawlResult.model_dump()`. The
    route raises **HTTP 500** when every result has `success: false`
    (`server.py`: `raise HTTPException(500, f"Crawl request failed: …")`), so a page the
    extractor could not fetch arrives as a 500 and not as a 200 carrying an error.

14. **The public build's bundle assertion already exists and is one-sided.**
    `scripts/smoke-dist.mjs` lines 144–157 walk every `dist/assets/*.js`, refuse
    `/v2/crawl`, `/v2/map`, `/v2/search`, `/v2/batch`, `/v2/agent`, and *require*
    `/v2/scrape` to be present — with a comment explaining why the positive half exists:
    *"a check that passes because the whole feature was tree-shaken out is not a check."*
    `src/import/web-endpoints.test.ts` asserts the same list against the two modules' source
    text via `?raw`. Both are correct for the public build and both must be re-scoped, not
    deleted.

15. **This repository already has a documented precedent for "a build-time switch cannot be
    flipped from inside a test, so it gets its own Vitest project."** `vitest.config.ts`'s
    `browser-forced-colors` project exists for exactly that reason, and says so:
    *"forced colors CANNOT BE SWITCHED ON FROM INSIDE THE PAGE. It is a browser context
    option, so the only way to measure … is a second context — which means a second project."*
    A Vite `define` is the same kind of thing. The root config currently defines
    `__OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__` as `''` for every project, with the comment
    *"Test the same fail-closed configuration as the public build."*

## The seam, unchanged

Nothing in `src/import/web.ts` changes. The new module implements `WebArticleFetcher`
exactly as `firecrawl.ts` does, and supplies the three CONCEPTS `firecrawl.ts`'s closing
comment names as its own shape rather than the seam's:

| The concept | Firecrawl's spelling | crawl4ai's spelling |
| --- | --- | --- |
| "do not transcode a PDF for me" | `parsers: []` | Nothing to disable; `/crawl` navigates a real browser and never text-extracts a PDF |
| "the status the ORIGIN gave" | `metadata.statusCode` | `redirected_status_code ?? status_code` (fact 8) |
| a failure taxonomy | 401/403/429 auth and quota | reachability, version, HTTP status, malformed envelope, timeout, cancellation |

And the rule that closing comment states — *"throw an `Error` whose message is built from a
status and a fixed string, never from the request, the headers, or an interpolated response
body"* — is obeyed. The only values this module ever interpolates are a **number** (an HTTP
status), the **pinned origin** (which is operator build configuration, already a literal in
the bundle, and never user or vendor data), and a **version string it validated against a
regular expression first**.

## Which markdown

`raw_markdown`, always. Not `fit_markdown`, and not "`fit_markdown` when it is non-empty".

Fact 12 is the reason. `fit_markdown` is empty on a default deployment, so a preference rule
would make the imported page depend on a piece of operator configuration this app cannot see
and cannot report — two operators running the same version would import the same URL into
different pages, and neither could tell why. `raw_markdown` is always populated and comes
from `cleaned_html`, so it is the one deterministic choice.

The honest cost, stated rather than hidden: Firecrawl was called with `onlyMainContent: true`,
and `raw_markdown` has no equivalent. A self-hosted import therefore carries more page chrome
— navigation, footers — than the same URL imported on the public build. That is a
**difference in what the extractor extracts**, which is what criterion 3's second sentence
carves out; see below. It is visible in the preview, it is editable in the issue-10 page
plan, and it is stated in the capability documentation rather than discovered.

## What criterion 3 does and does not claim

> *"The same URL yields the same Canvas page in both deployments. Everything below the
> fetcher seam stays shared, so the two builds cannot disagree about what a page is."*

The second sentence is the operative one, and it is what this design is held to. Two
different extraction engines running two different browsers over a live web page will never
emit byte-identical Markdown, and a design that promised that would be lying. What is
shared, and what is testable, is **the definition of a page**: which addresses are refused,
which redirects are disclosed, which statuses are errors, what a PDF does, what an image
does, what provenance is recorded, what the rights ceremony demands, and what the findings
say. All of that lives below the seam already.

So the criterion is pinned by a **parity test that drives both fetchers through
`importWebArticle` over the same table of scenarios and asserts the same outcome** — the same
thrown message, or the same finding codes and the same provenance — for every row. Not by a
markdown comparison, which would be a test of two vendors' HTML-to-Markdown converters.

## The PDF refusal, honestly

`importWebArticle` refuses a PDF two ways: by `contentType`, and by a `.pdf` path on the
final URL. On the self-hosted path:

- The **path** half is unaffected.
- The **content-type** half is affected by fact 9. On a redirected fetch, `response_headers`
  belongs to the first hop, so its `content-type` is the redirect's (typically `text/html`),
  not the article's. Reporting it anyway would be reporting a header about the wrong
  resource, which is worse than reporting nothing: `importWebArticle` treats an absent
  `contentType` as "unknown, fall through to the path check", and treats a present one as
  authoritative. **So the fetcher reports `contentType` only when `redirected_url` equals the
  requested URL, and omits it otherwise.** That is a deliberate narrowing, recorded here so
  it is not read as an oversight.
- The remaining gap — a URL that redirects to a PDF at a path not ending in `.pdf` — is
  **INFERRED**, not measured, to fail closed anyway: `/crawl` navigates headless Chromium,
  which does not render a PDF into extractable text, so `markdown.raw_markdown` would be
  empty and `importWebArticle`'s *"No readable content was extracted from that address"*
  refusal fires. It is inferred because verifying it requires running the container, which
  this environment cannot do. It is written down as an inference, and the capability
  documentation states the narrowed content-type check as a limitation rather than claiming
  parity.

## Rendering JavaScript — criterion 4

`/crawl` drives headless Chromium through Playwright (`crawl4ai/async_crawler_strategy.py`
uses `page.goto(...)` and reads `page.url` *after* JS navigation, fact 8). JavaScript
rendering is not an option to enable; it is the only thing this endpoint does. That is the
whole reason the issue names crawl4ai and not `scrapling`, and it is why the criterion is
satisfied structurally rather than by a flag this app has to remember to send.

The criterion asks that a JS-shell article not *"succeed on the public build and fail on a
self-hosted one — an inconsistency a user would have no way to diagnose."* The failure it
worries about is an extractor that returns a page's initial HTML shell. Under fact 12's
`cleaned_html` path that shell would produce a near-empty `raw_markdown`, and the shared
*"No readable content"* refusal would fire — a refusal, not a wrong page, which is the
outcome this repository consistently prefers. The plan pins the request shape (a real
browser navigation, no raw-HTML mode, no `wait_until: 'commit'`) with a test on the request
body rather than by asserting on a live site.

## The failure taxonomy — criterion 6

Six named failures, each with an app-authored message that says what to do. Firecrawl's
401/403/429 vocabulary does not transfer: there is no key and no credit balance. What
transfers is the *rule* — a status and a fixed string, never a response body.

| Situation | How it is detected | What the user is told |
| --- | --- | --- |
| **Unreachable** | `fetch` rejects on `GET /health` (offline, DNS, TLS, service down, or a CORS preflight the operator has not configured) | Names the pinned origin; names both "the service may not be running" and "its CORS configuration may not allow this app's origin", because the browser deliberately hides which |
| **Wrong or unsupported version** | `GET /health` answers, but `version` is missing, unparseable, or outside `>=0.9.0 <0.10.0` | Names the version found and the range required, and says an operator must upgrade. Fact 10 is why: 0.8 cannot report a redirected page's status, so it would silently refuse redirected articles |
| **Not an extractor at all** | `GET /health` answers 2xx but the body is not `{status, version}` | Says the origin answered but is not a crawl4ai extraction service, and to check the pinned origin |
| **Refused** | `POST /crawl` answers non-2xx | One message per status family: 401/403 → the service requires a credential the operator's proxy is not supplying; 404 → the origin is not a crawl4ai server; 413 → the request was rejected as too large; 429 → rate-limited, wait; 500 (fact 13) → the extractor could not fetch that page; 503/504 → the extractor is overloaded or timed out |
| **Malformed response** | The envelope fails any required-field check | One fixed message. Fails closed on every field: `success`, a non-empty `results`, `results[0].success`, a string `markdown.raw_markdown`, a numeric status, a parseable URL |
| **Timeout** | The module's own deadline fires | Names the number of seconds and suggests a page with less on it |
| **Cancellation** | The caller's `AbortSignal` | Passed through as itself, so `WebArticleImporter`'s existing `isAbortError` branch says "Import cancelled", exactly as on the Firecrawl path |

Timeout and cancellation are two distinct rejection sources racing one request — the same
hand-written two-promise race `firecrawl.ts` uses, and for the same recorded reason: the
`unit` project is jsdom, whose `AbortSignal` is not Node's, so `AbortSignal.any` /
`AbortSignal.timeout` would be an environment assumption rather than a test.

**The version handshake costs one extra round trip per import, and that is deliberate.**
`GET /health` runs before `POST /crawl`, so an unreachable service, a wrong origin, or an
unsupported version is reported *before* the operator's Chromium spends thirty seconds
rendering somebody's site. It is public (fact 5), so it works whether or not the proxy
injects a token.

## Where the build switch lives, and what it compiles out

The house pattern, copied deliberately: `vite.config.ts` validates an environment variable
at build time and bakes the result into a `define`; `src/vite-env.d.ts` declares it as
*"Empty in the public build; an exact HTTPS origin in an opted-in self-host build"*; the
consumer reads it at module scope and folds.

**Two variables, matching `DEPLOYMENT_MODE` + `SELF_HOSTED_CANVAS_ORIGIN`:**

```
OER2CANVAS_WEB_EXTRACTION           = firecrawl | self-hosted-extractor   (default: firecrawl)
OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN = https://extract.example.edu     (required by, and only by, the second mode)
```

The mode is explicit and the build fails closed **in both directions**: `self-hosted-extractor`
with no origin is an error, and `firecrawl` with an origin *set* is also an error. The second
half matters more than it looks — a stale exported variable that silently does nothing is how
an operator ends up believing a capability is on when it is off, and this is the same failure
`wrangler.jsonc`'s committed `DEPLOYMENT_MODE` override exists to prevent on the Worker side.

**A deliberately separate axis from Canvas push.** An operator may self-host the app and an
extractor and still export cartridges; adding a third value to
`OER2CANVAS_DEPLOYMENT_MODE` would invent a coupling that does not exist.

**One validator, two callers.** The origin must satisfy exactly the rules
`normalizeSelfHostedCanvasOrigin` already enforces — HTTPS, no credentials, bare origin, no
path/search/hash, public non-reserved FQDN, not an IP literal. Rather than write a second
copy that can drift, `worker/allowlist-hosts.ts` grows
`normalizePinnedHttpsOrigin(raw)` — the existing function's body, unchanged — and
`normalizeSelfHostedCanvasOrigin` becomes a call to it. This is a pure refactor of the
relay's file: no relay behaviour changes, and the existing `relay.test.ts` cases are the
proof.

Note what those rules exclude, and why it is right rather than unfortunate:
`isPrivateHostname` rejects `localhost`, `*.local`, `*.internal`, `.lan`, `.home.arpa` and
friends, and `IP_LITERAL` rejects `https://10.0.0.5`. Facts 1 and 2 already established that
none of those are reachable from an HTTPS page anyway. The validator refuses at build time
what the browser would refuse at run time, which is the earlier and more diagnosable of the
two.

**What the public build must not contain.** Criterion 1 asks for the capability to be
*"compiled out entirely."* Concretely: no `dist/assets/*.js` chunk in a public build may name
the extractor's `/crawl` path, and — symmetrically — no chunk in a self-hosted build may name
`/v2/scrape`. Both halves are asserted positively and negatively in `scripts/smoke-dist.mjs`,
extending the existing pattern of fact 14 rather than replacing it.

Whether a folded module-scope constant plus a static import is enough for Rollup to drop the
string, or whether the import must be dynamic so the branch takes the whole module with it,
is **not asserted here** — it is a property of the bundler, so the plan measures it against a
real `dist/` and picks the mechanism the measurement supports. Committing to an answer in the
design would be guessing about a tool.

**Testing what a `define` decides.** Per fact 15, a fourth Vitest project,
`unit-self-hosted`, jsdom, whose `define` pins the extractor origin and whose `include` is
`src/**/*.self-hosted.test.{ts,tsx}`. The other three projects keep the origin at `''` — the
same *"Test the same fail-closed configuration as the public build"* posture — and the `unit`
project excludes the new glob, exactly as it already excludes `*.browser.test.*`.

Everything that does **not** depend on the define stays in the ordinary `unit` project: the
new fetcher takes its origin as an injected dependency, like `firecrawl.ts` takes its key, so
its whole failure taxonomy is testable without any build switch at all. The `unit-self-hosted`
project's job is narrow — that the *component* wires the right fetcher, and that the key UI is
absent.

## What the user sees

| | Public build | Self-hosted-extractor build |
| --- | --- | --- |
| Disclosure above the button | address + key go to `api.firecrawl.dev` | address goes to the pinned origin; **no credential is sent, and this app's relay is still not involved** |
| Firecrawl API key field | present | **absent** — not disabled, not hidden |
| Show/hide key, Forget key | present | absent |
| Key store | constructed | not constructed — nothing can hold a key |
| Busy line | "Asking Firecrawl for this page…" | "Asking the extraction service for this page…" |
| Everything else | identical | identical |

`SourceBrowser.tsx`'s standing sentence — *"which is the only source here that is fetched by a
third party rather than by this browser alone"* — is **false** on a self-hosted build, where
the fetcher is the operator's own service. It becomes conditional on the same constant. One
sentence, one file, and it is a truth claim rather than decoration, which is why it is not
left alone.

## Files

| File | What changes |
| --- | --- |
| `src/import/self-hosted-extractor.ts` (new) | The second `WebArticleFetcher`. Origin injected, `/health` handshake, `POST /crawl`, the whole taxonomy. |
| `src/import/self-hosted-extractor.test.ts` (new) | Every row of the taxonomy, plus the request shape and the fact-8 redirect trap. |
| `src/import/web-parity.test.ts` (new) | Criterion 3: both fetchers, one scenario table, identical outcomes below the seam. |
| `src/components/WebArticleImporter.tsx` | Chooses the fetcher on the folded constant; key UI, key store and disclosure become mode-dependent. |
| `src/components/WebArticleImporter.self-hosted.test.tsx` (new) | The key UI is absent, the store is never built, the extractor is called. |
| `src/components/SourceBrowser.tsx` | One conditional sentence. |
| `src/vite-env.d.ts` | Declares `__OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__`. |
| `vite.config.ts` | Validates the two new environment variables; adds the define. |
| `vite.config.test.ts` (new) | The fail-closed cases, both directions. |
| `vitest.config.ts` | The define for three projects; the fourth project. |
| `worker/allowlist-hosts.ts` | `normalizePinnedHttpsOrigin` extracted; `normalizeSelfHostedCanvasOrigin` delegates. No behaviour change. |
| `src/import/web-endpoints.test.ts` | Re-scoped: per-module forbidden endpoint lists, the relay ban extended to the third module. |
| `scripts/smoke-dist.mjs` | Both bundles, both directions. |
| `README.md`, `PRIVACY.md`, `SECURITY.md` | Criterion 7. |

**Not touched, and this is load-bearing:** `worker/relay.ts`, `worker/allowlist-hosts.ts`'s
behaviour, `src/import/web.ts`, `src/import/firecrawl.ts`, `src/import/firecrawl-key.ts`,
`src/import/text.ts`, and everything else below the seam.

## Non-goals

- **No relay change.** Stated as a constraint, not an omission. See *Why not behind the relay*.
- **No second extractor vendor.** One implementation of the seam per issue; a third would be
  a third issue and would inherit this transport answer unchanged.
- **No `http://` escape hatch, not even for development.** Facts 1 and 2 say it would not
  work from an HTTPS page, and a development-only flag that behaves differently from
  production is how a deployment ships broken. A developer runs `npm run dev` over plain HTTP,
  where the extractor origin is plain HTTP too and nothing is mixed — that case needs no flag,
  and the build-time validator's HTTPS requirement is what stops it reaching production.
- **No attempt to reproduce `onlyMainContent`.** See *Which markdown*.
- **No live crawl4ai verification.** This environment has no Docker daemon and no crawl4ai
  container. Every claim about the vendor's wire format in this document is read from the
  vendor's source at a named tag, and the Answer must say so rather than implying a service
  was ever contacted.

## Open question for the plan

**Does a folded module-scope constant plus a static import actually remove the endpoint string
from the bundle?** The plan's Task on `smoke-dist.mjs` must build both ways and grep `dist/`
before choosing between a static import and a dynamic one. There is a safe default — the
dynamic import, which takes the whole module with the branch — so this is a plan task and not
a blocker on this design. The same task must check `/crawl` for incidental matches in the
existing public bundle before adopting it as the marker string; if it is noisy, a longer
distinctive marker from the same module is used instead, and the reason is recorded.
