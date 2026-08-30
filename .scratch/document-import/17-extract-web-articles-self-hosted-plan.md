# Extract a web article on a self-hosted deployment — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted operator points the web-article importer at an extraction service they
run themselves; their users import a URL with no third-party account and no API key. The public
deployment is unchanged and still requires a user-supplied Firecrawl key.

**Architecture:** A second `WebArticleFetcher` beside the first, chosen by a build-time
`define` and nothing else. The extractor is reached **browser-direct over HTTPS at an
operator-pinned origin**; the relay is not involved and no file under `worker/` changes
behaviour. Everything below the seam in `src/import/web.ts` is untouched and shared.

**Tech Stack:** TypeScript, React 19, Vite, Vitest (jsdom `unit`, a new jsdom
`unit-self-hosted`, Chromium `browser`). No new runtime dependency. The extraction service is
crawl4ai's Docker REST server, which the operator runs; nothing about it is vendored here.

**Spec:** [`17-extract-web-articles-self-hosted-design.md`](17-extract-web-articles-self-hosted-design.md)
— read its `## Measured facts` section first. Fifteen facts were measured or read from named
vendor tags on 2026-08-30. **Do not re-derive them, and do not contradict them from memory.**

**Issue:** [`issues/17-extract-web-articles-self-hosted.md`](issues/17-extract-web-articles-self-hosted.md)

## Global constraints

- **No file under `worker/` may change behaviour.** Task 1 is a pure extraction refactor whose
  proof is that `worker/relay.test.ts` passes untouched. If any task appears to need an
  allowlist entry, a `RelayEnv` field, or a route, **stop and escalate** — the design's
  "Why not behind the relay" section is the answer, and if it is wrong the design is wrong.
- **Nothing in `src/import/web.ts` changes.** Not the interface, not a comment, not a message.
  A change there is a change to what a page *is* for both deployments at once.
- **`src/import/capability.ts`, `src/import/released-sources.ts`, `src/import/document.ts` and
  `src/import/testing/corpus.ts` are owned by concurrent issues 15 and 16. Do not edit them.**
  If a task appears to need one, stop and report it.
- **No credential of any kind is sent by the browser on the self-hosted path.** No key field,
  no key store, no `authorization` header, no token in a define. If the operator's crawl4ai
  requires one, their reverse proxy injects it (design fact 5).
- **Every interpolated value is a number, the pinned origin, or a regex-validated version
  string.** Never a response body, never a header, never a URL from the vendor. This is
  `firecrawl.ts`'s closing rule and it applies verbatim.
- **`tsconfig.json` deliberately omits node types**, so a `process` or `node:` reference in
  `src/` is a compile error. `vite.config.ts` and `scripts/` are covered by
  `tsconfig.node.json` — check it includes any new file you add there.
- **A test that asserts "does not crash" documents nothing.** Every refusal names its message.
- **Run `npm run typecheck && npx vitest run` before every commit; the whole suite must pass.**
  Two pre-existing intermittent flakes live in
  `src/components/DocumentImporter.browser.test.tsx` and
  `src/components/TextContentImporter.test.tsx` — rerun and say so; do NOT "fix" them.
- **Every commit in this repository's history is green.**
- **This environment cannot run a crawl4ai container.** Nothing in this plan may claim a live
  extraction was performed. Where a behaviour can only be inferred from the vendor's source,
  the comment says INFERRED and the Answer repeats it.

## File structure

| File | Responsibility |
| --- | --- |
| `worker/allowlist-hosts.ts` | Gains `normalizePinnedHttpsOrigin`; `normalizeSelfHostedCanvasOrigin` delegates to it. No behaviour change. |
| `src/vite-env.d.ts` | Declares `__OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__`. |
| `vite.config.ts` | Validates `OER2CANVAS_WEB_EXTRACTION` + `OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN`; adds the define. |
| `vite.config.test.ts` (new) | Fail-closed in both directions. |
| `vitest.config.ts` | The define for the three existing projects; the new `unit-self-hosted` project. |
| `src/import/self-hosted-extractor.ts` (new) | The second `WebArticleFetcher`. |
| `src/import/self-hosted-extractor.test.ts` (new) | The whole failure taxonomy and the request shape. |
| `src/import/web-parity.test.ts` (new) | Both fetchers, one scenario table, identical outcomes below the seam. |
| `src/components/WebArticleImporter.tsx` | Mode-dependent fetcher, key UI, key store and disclosure. |
| `src/components/WebArticleImporter.self-hosted.test.tsx` (new) | Key UI absent; extractor called. |
| `src/components/SourceBrowser.tsx` | One conditional sentence. |
| `src/import/web-endpoints.test.ts` | Re-scoped to three modules with per-module forbidden lists. |
| `scripts/smoke-dist.mjs` | Both bundles, both directions. |
| `README.md`, `PRIVACY.md`, `SECURITY.md` | What a self-hosted deployment sends where. |

---

### Task 1: One pinned-origin validator, two callers

**Files:**
- Modify: `worker/allowlist-hosts.ts`
- Modify: `worker/allowlist-hosts.test.ts` (if present; otherwise `worker/relay.test.ts` is the proof)

The extractor origin must satisfy exactly the rules the Canvas origin already satisfies. A
second copy would drift. This task moves the body, renames nothing that callers use, and
changes no behaviour.

- [ ] **Step 1: Extract the function**

```ts
/**
 * The rules an operator-pinned origin must satisfy, in one place.
 *
 * Two capabilities pin an origin at build time — Canvas push and the
 * self-hosted web extractor (issue 17) — and they must agree about what a
 * pinnable origin IS. A second copy of this would drift, and the drift would
 * be silent: both copies would keep accepting the origins anyone tested.
 *
 * `localhost`, `*.local`, `*.internal` and IP literals are refused here on
 * purpose. Measured 2026-08-30 (design fact 1): an HTTPS page cannot reach a
 * loopback origin at all — Chromium 151 denies the `loopback` address space by
 * permission — so refusing them at BUILD time turns a runtime failure nobody
 * can diagnose into a build failure that names the variable.
 */
export function normalizePinnedHttpsOrigin(raw: string | undefined): string | undefined {
  // …the current body of normalizeSelfHostedCanvasOrigin, unchanged…
}

export function normalizeSelfHostedCanvasOrigin(raw: string | undefined): string | undefined {
  return normalizePinnedHttpsOrigin(raw)
}
```

- [ ] **Step 2: Prove no behaviour changed**

Run: `npx vitest run --project unit worker/`
Expected: PASS, with **no test file edited**. That is the whole proof; a refactor that needed
its tests rewritten was not a refactor.

- [ ] **Step 3: Commit**

```bash
npm run typecheck && npx vitest run
git add worker/allowlist-hosts.ts
git commit -m "refactor: name the pinned-origin rule once, so two capabilities share it"
```

---

### Task 2: The build switch, fail-closed in both directions

**Files:**
- Modify: `vite.config.ts`, `src/vite-env.d.ts`, `vitest.config.ts`
- Create: `vite.config.test.ts`

- [ ] **Step 1: Write the failing test**

`vite.config.ts` currently computes the Canvas origin in a module-scope function that is not
exported, so it is untestable. Export the extractor's equivalent and test it directly.

```ts
// vite.config.test.ts
import { selfHostedExtractorOrigin } from './vite.config'

test('the default build has the capability compiled out', () => {
  expect(selfHostedExtractorOrigin({})).toBe('')
  expect(selfHostedExtractorOrigin({ OER2CANVAS_WEB_EXTRACTION: 'firecrawl' })).toBe('')
})

test('an opted-in build bakes in the exact origin', () => {
  expect(selfHostedExtractorOrigin({
    OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor',
    OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'https://extract.example.edu/',
  })).toBe('https://extract.example.edu')
})

test.each([
  ['an unknown mode', { OER2CANVAS_WEB_EXTRACTION: 'crawl4ai' }, /OER2CANVAS_WEB_EXTRACTION/],
  ['the mode without an origin', { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor' }, /requires OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN/],
  // Both directions. A variable that is set and silently ignored is how an
  // operator comes to believe a capability is on when it is off.
  ['an origin without the mode', { OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'https://extract.example.edu' }, /only in self-hosted-extractor mode/],
  ['plain http', { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor', OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'http://extract.example.edu' }, /public HTTPS FQDN/],
  ['loopback', { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor', OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'https://localhost:11235' }, /public HTTPS FQDN/],
  ['an ip literal', { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor', OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'https://10.0.0.5' }, /public HTTPS FQDN/],
  ['a path', { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor', OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'https://extract.example.edu/api' }, /public HTTPS FQDN/],
])('refuses %s', (_label, env, message) => {
  expect(() => selfHostedExtractorOrigin(env)).toThrow(message)
})
```

- [ ] **Step 2: Run it, see it fail**

Run: `npx vitest run --project unit vite.config.test.ts`
Expected: FAIL — `selfHostedExtractorOrigin` is not exported.

- [ ] **Step 3: Implement**

Take the environment as an argument rather than reading `process.env` inside, so the test needs
no global stubbing. `vite.config.ts` calls it once with `process.env`.

```ts
export function selfHostedExtractorOrigin(env: Record<string, string | undefined>): string {
  const mode = env.OER2CANVAS_WEB_EXTRACTION?.trim() || 'firecrawl'
  const raw = env.OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN?.trim()

  if (mode === 'firecrawl') {
    if (raw) {
      throw new Error(
        'OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN is set but is honoured only in '
        + 'self-hosted-extractor mode. Set OER2CANVAS_WEB_EXTRACTION=self-hosted-extractor, '
        + 'or unset the origin.',
      )
    }
    return ''
  }
  if (mode !== 'self-hosted-extractor') {
    throw new Error('OER2CANVAS_WEB_EXTRACTION must be firecrawl or self-hosted-extractor')
  }
  if (!raw) {
    throw new Error('self-hosted-extractor mode requires OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN')
  }
  const normalized = normalizePinnedHttpsOrigin(raw)
  if (!normalized) {
    throw new Error(
      'OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN must be a public HTTPS FQDN without a path. '
      + 'A loopback or private address cannot be reached from an HTTPS page at all — see '
      + 'README.md, "Optional self-hosted web extraction".',
    )
  }
  return normalized
}
```

Add the define next to the Canvas one, and the declaration:

```ts
// src/vite-env.d.ts
/** Empty in the public build; an exact HTTPS origin in an opted-in self-host build. */
declare const __OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__: string
```

- [ ] **Step 4: The fourth Vitest project**

`vitest.config.ts`'s root `define` gains `__OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__: '""'`,
keeping the existing *"Test the same fail-closed configuration as the public build"* comment
honest for both switches. Then add the project, with a comment that carries the reason
(design fact 15):

```ts
{
  test: {
    // A Vite `define` is decided before a test runs and cannot be flipped from
    // inside one — the same constraint that made `browser-forced-colors` a
    // project rather than a test option. So the opted-in build gets a project.
    // It is jsdom and its `include` is one glob, so it costs no browser launch.
    name: 'unit-self-hosted',
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.self-hosted.test.{ts,tsx}'],
  },
  define: { __OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__: JSON.stringify('https://extract.example.edu') },
}
```

The `unit` project's `include` (`src/**/*.test.{ts,tsx}`) matches that glob too, so add
`'src/**/*.self-hosted.test.{ts,tsx}'` to its `exclude` — the same reason `*.browser.test.*`
is excluded there, and the same failure if it is forgotten: the file would run a second time
under a define that makes every assertion in it meaningless.

> Confirm where `define` belongs in a Vitest 4 project entry (project-level vs. nested under
> `test`). If a project-level `define` is not honoured, the fallback is a second config file
> referenced from `package.json`, as `vitest.artifact-reader.config.ts` already is — that
> file's comment explains when that shape is necessary. **Measure, do not assume.**

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add vite.config.ts vite.config.test.ts src/vite-env.d.ts vitest.config.ts
git commit -m "feat: pin a self-hosted extractor origin at build time, failing closed both ways"
```

---

### Task 3: The second fetcher

**Files:**
- Create: `src/import/self-hosted-extractor.ts`, `src/import/self-hosted-extractor.test.ts`

**Interfaces:**
- Produces: `createSelfHostedExtractorFetcher(deps: { origin: string; fetch?: typeof globalThis.fetch }): WebArticleFetcher`,
  `EXTRACTOR_CRAWL_PATH`, `EXTRACTOR_HEALTH_PATH`, `EXTRACTOR_SUPPORTED_VERSIONS`,
  `EXTRACTOR_REQUEST_TIMEOUT_MS`.
- Consumes: `FetchedArticle`, `WebArticleFetcher` from `./web`. Nothing else.

The origin is a **dependency, not a define**, exactly as the Firecrawl key is a getter rather
than a string. That is what keeps this whole module testable in the ordinary `unit` project.

- [ ] **Step 1: Write the failing tests**

The taxonomy is the specification. One test per row of the design's table, plus the request
shape and the redirect trap. Sketch — write all of them:

```ts
// src/import/self-hosted-extractor.test.ts
import {
  EXTRACTOR_CRAWL_PATH,
  EXTRACTOR_HEALTH_PATH,
  EXTRACTOR_REQUEST_TIMEOUT_MS,
  createSelfHostedExtractorFetcher,
} from './self-hosted-extractor'

const ORIGIN = 'https://extract.example.edu'

/** Read from crawl4ai `deploy/docker/api.py` at tag v0.9.2 on 2026-08-30 (design fact 13). */
const okEnvelope = (over: Record<string, unknown> = {}) => ({
  success: true,
  results: [{
    url: 'https://example.com/a',
    success: true,
    markdown: {
      raw_markdown: '# Title\n\nBody.',
      markdown_with_citations: '',
      references_markdown: '',
      fit_markdown: '',
    },
    status_code: 200,
    redirected_status_code: 200,
    redirected_url: 'https://example.com/a',
    response_headers: { 'content-type': 'text/html; charset=utf-8' },
    ...over,
  }],
  server_processing_time_s: 1.2,
})

/** Routes by path so `/health` and `/crawl` can answer differently. */
function serviceFetch(routes: {
  health?: () => Response | Promise<Response>
  crawl?: (init: RequestInit) => Response | Promise<Response>
}, log?: { url: string; init: RequestInit }[]): typeof globalThis.fetch {
  return async (url, init) => {
    log?.push({ url: String(url), init: init ?? {} })
    if (String(url).endsWith(EXTRACTOR_HEALTH_PATH)) {
      return routes.health?.() ?? new Response(JSON.stringify({ status: 'ok', version: '0.9.2' }))
    }
    return routes.crawl?.(init ?? {}) ?? new Response(JSON.stringify(okEnvelope()))
  }
}
```

The cases, each asserting a message and not merely a rejection:

1. **The request shape.** `POST {origin}/crawl`, `content-type: application/json`,
   `credentials: 'omit'`, body `urls` is an array of **exactly one** element equal to the
   requested href. Assert `body.urls.length === 1`. Assert the body names no other endpoint
   and carries **no `authorization` header at all** (positive: `headers.has('authorization')`
   is `false`) — criterion 2 measured at the wire rather than in the UI.
2. **JS rendering is not opted out of.** Assert the body contains no `wait_until: 'commit'`,
   no `raw:` or `file:` scheme in `urls`, and no configuration that would return unrendered
   HTML. The point is that the request cannot be edited into a non-rendering one without a
   test failing.
3. **The redirect trap (design fact 8).** `status_code: 301`, `redirected_status_code: 200`,
   `redirected_url: 'https://example.com/b'` → the returned `FetchedArticle` has
   `statusCode === 200` and `finalUrl.href === 'https://example.com/b'`. **Then the same
   article through `importWebArticle` produces the `import-web-redirected` finding and not a
   refusal** — the assertion that proves the trap is actually avoided end to end.
4. **`contentType` is omitted on a redirect (design fact 9)**, and present when
   `redirected_url` equals the requested URL.
5. **Unreachable.** `/health` rejects with `TypeError` → message names the origin and both
   "not running" and "CORS".
6. **Unsupported version.** `/health` answers `{status:'ok', version:'0.8.9'}` → message names
   `0.8.9` and the supported range. Same for `'garbage'` and for a missing `version`.
   A `0.9.7` accepts. A `0.10.0` refuses.
7. **Not an extractor.** `/health` answers 200 with `<!doctype html>` (a `.json()` throw) or
   with `{}` → the "answered but is not a crawl4ai extraction service" message.
8. **Every `/crawl` status family**: 401, 403, 404, 413, 429, 500, 503, 504 → eight distinct
   messages, each interpolating only the number.
9. **Malformed envelopes**, one test per required field: `success: false`; `results: []`;
   `results[0].success === false`; `markdown` a string instead of an object;
   `markdown.raw_markdown` missing; both statuses missing; `redirected_url` unparseable.
   All produce the single fixed malformed message.
10. **Timeout.** A `/crawl` that never settles, with fake timers, → the message names
    `EXTRACTOR_REQUEST_TIMEOUT_MS / 1000` seconds.
11. **Cancellation.** An already-aborted signal makes **zero** requests (`log.length === 0`);
    a signal aborted mid-flight rejects with the abort reason, not the timeout message.
12. **Nothing is stored, anywhere.** Reuse `web-key-containment.test.ts`'s `watchStorage()`
    shape: drive every row above and assert no `localStorage`, `indexedDB`, `caches` or
    `document.cookie` write happens. There is no credential to leak, and this is what makes
    that a proven property rather than an assumed one.

- [ ] **Step 2: Run, see them fail**

Run: `npx vitest run --project unit src/import/self-hosted-extractor.test.ts`
Expected: FAIL — `Failed to resolve import "./self-hosted-extractor"`.

- [ ] **Step 3: Implement**

Structure, mirroring `firecrawl.ts` deliberately so the two read as siblings:

```ts
import type { FetchedArticle, WebArticleFetcher } from './web'

/**
 * The two endpoints this app calls on an operator's extraction service, and no
 * others. Named here exactly once each, because `web-endpoints.test.ts` greps
 * this source and `scripts/smoke-dist.mjs` greps the built bundle, and neither
 * cares whether a match is code or a comment — so the vendor's `/crawl/stream`,
 * `/md`, `/html`, `/execute_js`, `/screenshot`, `/pdf`, `/llm` and `/ask`
 * routes are deliberately not spelled out anywhere in this file.
 *
 * `/crawl` and not the markdown-only route: read from crawl4ai
 * `deploy/docker/server.py` at tag v0.9.2 on 2026-08-30, that route returns no
 * status code and no final URL, and `web.ts` says of `statusCode` that "a
 * fetcher that cannot report this cannot be used".
 */
export const EXTRACTOR_CRAWL_PATH = '/crawl'
export const EXTRACTOR_HEALTH_PATH = '/health'

/**
 * The versions whose wire format this module was written against.
 *
 * The floor is 0.9.0 and it is not conservatism. `redirected_status_code` was
 * added in the 0.9 line (absent at v0.8.0, present at v0.9.0 — read 2026-08-30),
 * and without it a redirected article reports its FIRST hop's status, which
 * `importWebArticle` refuses as non-2xx. An 0.8 service would therefore refuse
 * every redirected page and blame the publisher. The ceiling is the next minor,
 * because that is the granularity at which this vendor has moved fields.
 */
export const EXTRACTOR_SUPPORTED_VERSIONS = { minimum: '0.9.0', below: '0.10.0' } as const

/**
 * The client deadline. Longer than Firecrawl's 60s default because the operator's
 * own hardware is doing the rendering and may be a laptop, and because there is
 * no per-request credit being burned while it waits. REASONED, not measured:
 * no crawl4ai container was reachable from the environment this was written in.
 */
export const EXTRACTOR_REQUEST_TIMEOUT_MS = 90_000
```

Then `createSelfHostedExtractorFetcher({ origin, fetch })`:

1. Refuse a non-HTTPS or non-bare `origin` at call time with a build-configuration message.
   Belt and braces: the Canvas precedent has the Worker as a second enforcer and this path has
   none, so the module enforces its own precondition. Keep it small — a `new URL` plus
   `protocol === 'https:'` and `pathname === '/'`; the full rule already ran at build time.
2. `GET ${origin}${EXTRACTOR_HEALTH_PATH}` with `credentials: 'omit'`, the same
   timeout/cancel race, and the three health failures above.
3. Validate the version with `/^(\d+)\.(\d+)\.(\d+)/` and compare numerically. Interpolate the
   **matched** substring, never the raw body.
4. `POST ${origin}${EXTRACTOR_CRAWL_PATH}` with `{ urls: [url.href] }`, `credentials: 'omit'`,
   `content-type: application/json`, and **no other header**.
5. `statusMessage(status)` for the eight families, one number interpolated.
6. Fail closed on the envelope, then build `FetchedArticle` with `parser: 'self-hosted-extractor'`.

**`parser` is a `ImportReport['parser']` value.** Check that union in `src/import/types.ts` and
add the new member there if it is a closed union. That is the one file below the seam this
issue touches, and only to widen a union — if it turns out to be `string`, touch nothing.

- [ ] **Step 4: Commit**

```bash
npm run typecheck && npx vitest run
git add src/import/self-hosted-extractor.ts src/import/self-hosted-extractor.test.ts src/import/types.ts
git commit -m "feat: fetch an article from an operator's own extraction service"
```

---

### Task 4: Prove the two builds agree about what a page is

**Files:**
- Create: `src/import/web-parity.test.ts`

Criterion 3, pinned the way the design says it must be: **the same scenario table through both
fetchers, asserting the same outcome below the seam.** Not a markdown comparison.

- [ ] **Step 1: Write the test**

One table of situations, and for each a Firecrawl envelope and a crawl4ai envelope that mean
the same thing. Drive `importWebArticle` with each fetcher and assert the two agree:

| Situation | Expected, identically, from both |
| --- | --- |
| A plain 200 article | Same `report.provenance.kind`, same finding codes, one section |
| A 404 inside a successful extraction | The same thrown message, verbatim |
| A `.pdf` final URL | The same PDF refusal message, verbatim |
| A `application/pdf` content type on a non-redirected fetch | The same PDF refusal message |
| A redirect to a different public URL | The same `import-web-redirected` code, the same final URL in provenance |
| A redirect into a private network | The same refusal from `parsePublicSourceUrl` |
| Empty markdown | The same "No readable content" message |
| `open-license` with no license name | The same `import-web-license-unnamed` finding |
| A non-HTTPS input address | The same refusal |

```ts
for (const [name, scenario] of Object.entries(SCENARIOS)) {
  test(`both fetchers agree about ${name}`, async () => {
    const viaFirecrawl = await outcomeOf(createFirecrawlFetcher({ key: () => 'k', fetch: scenario.firecrawl }))
    const viaExtractor = await outcomeOf(createSelfHostedExtractorFetcher({ origin: ORIGIN, fetch: scenario.extractor }))
    expect(viaExtractor).toEqual(viaFirecrawl)
  })
}
```

where `outcomeOf` reduces a run to `{ thrown?: string; findings?: string[]; provenance?: … }` —
everything the seam owns, and nothing the extractor owns. Say so in a comment: the markdown is
deliberately excluded from the comparison because comparing it would be a test of two vendors'
HTML-to-Markdown converters, not of this app.

- [ ] **Step 2: Run, fix any real disagreement**

A failing row here is a genuine finding, not a test to loosen. Record it in the design's
"honestly" section and in the capability documentation before changing either fetcher.

- [ ] **Step 3: Commit**

```bash
npm run typecheck && npx vitest run
git add src/import/web-parity.test.ts
git commit -m "test: prove the two fetchers disagree about nothing below the seam"
```

---

### Task 5: The panel, with the key UI absent rather than hidden

**Files:**
- Modify: `src/components/WebArticleImporter.tsx`
- Create: `src/components/WebArticleImporter.self-hosted.test.tsx`
- Modify: `src/components/WebArticleImporter.test.tsx` (only if a shared helper moves)

- [ ] **Step 1: Write the failing test, in the new project**

```tsx
// src/components/WebArticleImporter.self-hosted.test.tsx
// Runs ONLY in the `unit-self-hosted` Vitest project, whose define pins
// __OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__ to https://extract.example.edu.

test('the build switch really is on in this project', () => {
  // First assertion in the file, for the same reason the forced-colors suite
  // opens by asserting the mode is on: a suite that quietly measured the wrong
  // configuration would pass and prove nothing.
  expect(__OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__).toBe('https://extract.example.edu')
})

test('there is no API key field, no show/hide, and no forget button', () => {
  render(<WebArticleImporter onImported={() => {}} />)
  expect(screen.queryByLabelText(/API key/i)).toBeNull()
  expect(screen.queryByRole('button', { name: /Forget key/i })).toBeNull()
  expect(screen.queryByRole('button', { name: /(Show|Hide) key/i })).toBeNull()
  // Absent, not merely unlabelled: no password input of any kind on the screen.
  expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)
})

test('the disclosure names the operator origin and says no credential is sent', () => { … })

test('importing calls the pinned extractor and no vendor', async () => {
  const seen: string[] = []
  render(<WebArticleImporter onImported={() => {}} fetch={recordInto(seen)} />)
  … fill and submit …
  expect(seen.every((url) => url.startsWith('https://extract.example.edu/'))).toBe(true)
  expect(seen.join('|')).not.toContain('firecrawl')
})
```

- [ ] **Step 2: Run, see it fail**

Run: `npx vitest run --project unit-self-hosted`
Expected: FAIL — the key field is still rendered.

- [ ] **Step 3: Implement**

```tsx
/**
 * Empty in the public build. An exact HTTPS origin in an opted-in self-host
 * build, where the operator runs the extraction service themselves and their
 * users need no account and no key — the same default-off, operator-pinned
 * shape `App.tsx` already uses for Canvas push.
 *
 * Read at MODULE scope, and compared against '' rather than passed as a prop,
 * so a public build folds the constant and drops the branch. A prop would make
 * the branch live and put the extractor's endpoint in the public bundle, which
 * is precisely what `scripts/smoke-dist.mjs` refuses.
 */
const SELF_HOSTED_EXTRACTOR_ORIGIN =
  typeof __OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__ === 'string'
    ? __OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__
    : ''
```

Then, inside the component:

- `const keyStore = useRef(SELF_HOSTED_EXTRACTOR_ORIGIN ? undefined : createFirecrawlKeyStore())`
  — nothing that can hold a key is constructed. Criterion 2 says *storable*, not just *sent*.
- The disclosure paragraph, the key block, and the busy label each branch on the constant.
- The fetcher choice branches on it.
- Everything else — the URL field, the publisher nudge, `ImportMetadataFields`, the error
  region, the submit and cancel buttons — is untouched and shared.

Keep the two disclosure paragraphs as two sibling `<p>` elements chosen by the constant, not
one paragraph with interpolated fragments. They are different claims about where bytes go, and
a template that produced both would be one sentence nobody can read as either.

- [ ] **Step 4: Both projects green**

Run: `npx vitest run --project unit-self-hosted && npx vitest run --project unit src/components/WebArticleImporter.test.tsx`
Expected: both PASS. The existing public-mode suite must not need an edit — if it does, the
public branch changed, and it should not have.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add src/components/WebArticleImporter.tsx src/components/WebArticleImporter.self-hosted.test.tsx
git commit -m "feat: drop the key panel entirely when an operator pins their own extractor"
```

---

### Task 6: One sentence that would otherwise be false

**Files:**
- Modify: `src/components/SourceBrowser.tsx`
- Modify: `src/components/SourceBrowser.test.tsx` if it asserts the sentence

*"One web page at a time can also be imported, which is the only source here that is fetched by
a third party rather than by this browser alone."* On a self-hosted build the fetcher is the
operator's own service, so the clause after the comma is untrue. Make it conditional on the
same constant.

- [ ] **Step 1: Change it, and check no test pinned the old wording**

```bash
grep -rn "fetched by a third party" src/
```

- [ ] **Step 2: Commit**

```bash
npm run typecheck && npx vitest run
git add src/components/SourceBrowser.tsx
git commit -m "fix: stop telling a self-host operator their own service is a third party"
```

---

### Task 7: Re-scope the endpoint assertion, do not delete it

**Files:**
- Modify: `src/import/web-endpoints.test.ts`

The property worth keeping is **"one URL, one page, per fetcher"**, not "the codebase names one
endpoint". Restate it as a per-module forbidden list plus a per-module required endpoint.

- [ ] **Step 1: Rewrite**

```ts
import webSource from './web.ts?raw'
import firecrawlSource from './firecrawl.ts?raw'
import extractorSource from './self-hosted-extractor.ts?raw'

/**
 * Re-scoped by issue 17, not weakened.
 *
 * Issue 12's version asserted that the CODEBASE named exactly one extraction
 * endpoint, which was correct while there was exactly one fetcher. With a
 * second, that statement is false by construction — so the property it was
 * standing in for is restated per module: each fetcher names its own one
 * endpoint and none of its vendor's crawl, search, batch or scripting routes.
 * The claim about the PUBLIC BUNDLE containing one endpoint is the stronger
 * half and lives where a bundle exists — `scripts/smoke-dist.mjs`.
 */
const MODULES = [
  {
    name: 'firecrawl.ts', source: firecrawlSource, required: '/v2/scrape',
    forbidden: ['/v2/crawl', '/v2/map', '/v2/search', '/v2/batch', '/v2/agent'],
  },
  {
    name: 'self-hosted-extractor.ts', source: extractorSource, required: '/crawl',
    // crawl4ai's full route table, read from deploy/docker/server.py at tag
    // v0.9.2 on 2026-08-30, minus the two this app calls. `/crawl/stream` is
    // listed even though `/crawl` is a prefix of it: the check is `includes`,
    // so a stream call would be caught by the longer string.
    forbidden: ['/crawl/stream', '/md', '/html', '/execute_js', '/screenshot',
                '/pdf', '/llm/', '/ask', '/config/dump', '/token'],
  },
]
```

`web.ts` keeps its own case: it is below the seam and must name **no** vendor endpoint at all.

The relay ban extends to all three modules unchanged, with its existing comment. That comment
is now doubly load-bearing — Task 7's design section explains why the extractor is beside the
relay and not behind it, and this assertion is what stops that being undone quietly. Add a
sentence to it pointing at the design.

Careful with `/pdf` and `/html`: `firecrawl.ts` and `web.ts` mention PDFs in prose, so those
strings belong on the extractor module's list only. And check the extractor module's own prose
does not contain them — if the "refuses a PDF" comment must say `/pdf`, rewrite the comment;
this is the same self-inflicted failure the existing test's comment records catching in
`firecrawl.ts` on 2026-08-29.

- [ ] **Step 2: Commit**

```bash
npm run typecheck && npx vitest run
git add src/import/web-endpoints.test.ts
git commit -m "test: re-scope one-endpoint-per-fetcher now that there are two fetchers"
```

---

### Task 8: The compiled boundary, measured against two real bundles

**Files:**
- Modify: `scripts/smoke-dist.mjs`

**This task answers the design's open question and must MEASURE before it asserts.**

- [ ] **Step 1: Measure whether the string survives**

```bash
npm run build
grep -rl "/crawl" dist/assets/*.js || echo "PUBLIC BUNDLE: no /crawl"
grep -c "crawl" dist/assets/*.js | grep -v ':0' || echo "no incidental crawl matches"
```

Record the result in the plan. Two decisions follow from it:

1. If `/crawl` is **absent**, a static import plus the folded constant is sufficient. Keep it.
2. If `/crawl` is **present**, change `WebArticleImporter.tsx` to reach the module through
   `await import('../import/self-hosted-extractor')` inside the folded branch, rebuild, and
   measure again. Rollup drops a dynamic import in a statically dead branch, so this is the
   safe default the design named.

Also check for **incidental** `/crawl` matches in the current public bundle (a minified
identifier, a publisher URL). If there are any, the marker string becomes a longer distinctive
one from the same module and the substitution is recorded in a comment.

- [ ] **Step 2: Build the opted-in artifact and measure the mirror property**

```bash
OER2CANVAS_WEB_EXTRACTION=self-hosted-extractor \
OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN=https://extract.example.edu \
npm run build
grep -l "extract.example.edu" dist/assets/*.js   # the origin is baked in
grep -rl "/v2/scrape" dist/assets/*.js || echo "SELF-HOSTED BUNDLE: no firecrawl endpoint"
grep -rl "Firecrawl API key" dist/assets/*.js || echo "SELF-HOSTED BUNDLE: no key label"
```

If `/v2/scrape` survives the self-hosted build, apply the same escalation to the Firecrawl
import. Both directions get the same mechanism; a boundary that holds one way and not the other
is not a boundary.

- [ ] **Step 3: Turn the measurement into the assertion**

Generalize the existing block (`scripts/smoke-dist.mjs` lines ~135–157). Keep both halves —
present *and* absent — for each mode, keeping the existing comment's reasoning
(*"a check that passes because the whole feature was tree-shaken out is not a check"*):

```js
const selfHosted = process.env.OER2CANVAS_EXPECT_SELF_HOSTED_EXTRACTOR_ORIGIN?.trim()
const extraction = selfHosted
  ? { required: '/crawl', absent: '/v2/scrape', label: 'self-hosted extractor' }
  : { required: '/v2/scrape', absent: '/crawl', label: 'firecrawl' }
```

…plus the vendor forbidden lists from Task 7 applied to every chunk in both modes, and, in
self-hosted mode, an assertion driven through the built UI mirroring the Canvas one already
there: the **Web page** tab renders no `Firecrawl API key` field and no password input.

- [ ] **Step 4: Run both**

```bash
npm run build && npm run test:dist
OER2CANVAS_WEB_EXTRACTION=self-hosted-extractor \
OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN=https://extract.example.edu npm run build
OER2CANVAS_EXPECT_SELF_HOSTED_EXTRACTOR_ORIGIN=https://extract.example.edu npm run test:dist
```

Paste both outputs into the commit body. Then **rebuild the public artifact** so the tree is
left in its default state.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-dist.mjs src/components/WebArticleImporter.tsx
git commit -m "test: assert the extraction boundary against both built artifacts"
```

---

### Task 9: Say what each deployment sends where

**Files:**
- Modify: `README.md`, `PRIVACY.md`, `SECURITY.md`
- Check: `src/docs-claims.test.ts`

**Two sibling agents are editing these same three files for issues 15 and 16.** Keep every edit
to the **smallest contiguous region** possible and prefer adding a new self-contained paragraph
or section over rewording an existing one, so the merge is a hunk placement rather than a
reconciliation.

- [ ] **Step 1: `README.md`**

- The opening paragraph currently reads *"which is why web page import does not use it"* about
  the relay. Still true in both modes — leave it, and add one clause naming the self-hosted
  alternative so the sentence is not read as "Firecrawl or nothing".
- A new `## Optional self-hosted web extraction` section, sibling to
  `## Optional self-hosted Canvas push` and following its shape: what it is for, the two
  variables, the three things the operator's reverse proxy must do (TLS, CORS, token), the
  build and verification commands, and — stated plainly — **why `http://localhost` is not an
  option**, with the measured Chromium error quoted. That last part is criterion 5's
  documentation half, and it is the paragraph most likely to save someone a day.

- [ ] **Step 2: `PRIVACY.md`**

One paragraph after the existing Firecrawl one. What changes in self-hosted-extractor mode:
the address goes to the operator's pinned origin instead of `api.firecrawl.dev`; **no key is
sent, held, or asked for**; the relay is still not involved; the operator's own service fetches
the page, so the operator — not this project and not a vendor — sees the address. Keep the
existing sentence *"any URL you paste is a host this app now talks to"* true by restating it
for this mode.

- [ ] **Step 3: `SECURITY.md`**

Add to the *Security boundaries* list, next to the existing Firecrawl bullets:

- The extractor origin is pinned at build time and validated by the same rule as the Canvas
  origin: public HTTPS FQDN, no path, no credentials, no IP literal, no private or reserved
  host.
- No credential is sent by the browser on this path; if the operator's service requires one,
  their reverse proxy supplies it.
- **The relay's allowlist is unchanged and the extractor is not behind it** — with the
  one-line reason (an allowlisted host that fetches any URL named in a POST body is an open
  proxy with an extra hop).
- The version handshake, and what it refuses.

- [ ] **Step 4: Run the docs-truthfulness suite**

Run: `npx vitest run --project unit src/docs-claims.test.ts`
If it enumerates user-facing obligations, add the self-hosted extraction obligation to it in
the same shape as the existing Firecrawl one. Do not weaken an existing pattern to make it pass.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add README.md PRIVACY.md SECURITY.md src/docs-claims.test.ts
git commit -m "docs: state what a self-hosted deployment sends where, and why not localhost"
```

---

### Task 10: Resolve, honestly

**Files:**
- Modify: `.scratch/document-import/issues/17-extract-web-articles-self-hosted.md`
- Modify: `.scratch/document-import/map.md`

- [ ] **Step 1: Walk the seven criteria one at a time**

Tick only what has an artefact behind it. Name the artefact. Specifically:

- Criteria 1, 2, 5, 6, 7 have automated or documentary proof and should close.
- Criterion 3 closes on the parity test, **with the design's narrowing quoted**: what is proved
  identical is everything below the seam, not the markdown.
- **Criterion 4 has no automated half that can honestly close it.** JavaScript rendering is a
  property of a container this environment cannot run. What can be asserted is that the request
  this app sends is a rendering navigation and cannot be edited into a non-rendering one
  (Task 3 case 2) — that is a proof about the request, not about the render. Follow issue 13's
  standard: report it as `NEVER RUN` rather than ticking it, and say exactly what would close
  it (one live import of a known JS-shell article through a real crawl4ai 0.9 container,
  recorded).

- [ ] **Step 2: Append the `## Answer`**

Record: the transport decision and its two measurements; the version floor and why; what was
read from vendor source versus what was executed; the parity narrowing; the bundle results from
Task 8 with their real output; and every residual, including the redirected-PDF content-type
gap from the design's "The PDF refusal, honestly".

- [ ] **Step 3: `Status: resolved`, update `map.md`**

- [ ] **Step 4: Final commit**

```bash
npm run typecheck && npx vitest run && npm run build && npm run test:dist
git add -A
git commit -m "feat: extract web articles on a self-hosted deployment, with no key at all"
```

---

## Self-review

**Spec coverage.** Design facts 1–2 (the transport measurement) → the whole shape of the
solution, and Task 9's README paragraph. Fact 3 → Task 9's reverse-proxy instructions. Fact 4 →
the unreachable message naming CORS (Task 3 case 5) and Task 9. Fact 5 → the 401/403 message
(Task 3 case 8) and the "no credential in the browser" constraint. Facts 6, 10 → Task 3's
health handshake and version floor. Fact 7 → Task 3 case 1 and Task 7's forbidden list. Fact 8
→ Task 3 case 3, the redirect trap. Fact 9 → Task 3 case 4. Facts 11–12 → `raw_markdown` in
Task 3, and the limitation in Task 9. Fact 13 → Task 3 case 9 and the 500 message. Fact 14 →
Tasks 7 and 8. Fact 15 → Task 2's fourth project.

**Issue criteria.** 1 → Tasks 2, 5, 8. 2 → Tasks 3 (wire), 5 (UI and store), 8 (bundle). 3 →
Task 4, narrowed explicitly. 4 → Task 3 case 2, and left OPEN at Task 10. 5 → the design plus
Task 9. 6 → Task 3's taxonomy. 7 → Task 9.

**Known soft spots, flagged rather than hidden.**

- **Nothing here has spoken to a real crawl4ai.** Every wire-format claim is read from the
  vendor's source at tag `v0.9.2` (and `v0.9.0`/`v0.8.0` for the version floor). The envelope
  fixtures in Task 3 are constructed from that source, not captured from a service. If a field
  name is wrong, the whole taxonomy still behaves — it fails closed to the malformed-response
  message — but it fails on every import, and no test in this repository would catch it. Task
  10 must say so.
- **The version floor is a policy, not a compatibility matrix.** `>=0.9.0 <0.10.0` was chosen
  because 0.9.0 is the first tag carrying `redirected_status_code`; nobody has run 0.9.0
  itself. A 0.10 that changed nothing relevant would be refused, which is the conservative
  direction but is still a refusal an operator may find annoying.
- **Task 8 is the only task whose outcome is not predicted.** It is written to measure first
  because the answer belongs to Rollup, not to this design. If the escalation to a dynamic
  import is needed, Task 5's implementation changes shape slightly — that is expected, and
  Task 8 owns the commit for it.
- **`src/import/types.ts` may need one union member** for the new `parser` value. That is the
  single file below the seam this issue touches. If widening it turns out to require anything
  more than adding a member — a new `ImportReport` field, a change to how `report.parser` is
  rendered — **stop and escalate**, because at that point the seam is not carrying the second
  implementation as cleanly as issue 12 claimed.
