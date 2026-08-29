# Import one web article as one Canvas page — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an instructor paste one public HTTPS article URL, send it and their own Firecrawl API
key from their browser directly to `api.firecrawl.dev`, and get exactly one Canvas page out of the
existing sanitize → page-plan → audit → cartridge chain — with the key held in memory only, every
refused image both flagged and visibly marked, and a 404, a PDF, or a private-network target refused
rather than published.

**Architecture:** Almost none of this is new machinery. `src/import/web.ts` validates the target with
`parsePublicSourceUrl`, calls a `WebArticleFetcher`, checks the *origin's* status and content type,
and hands the extracted Markdown to `importText` as a new `web` variant — which reaches
`sanitizeImportedMarkdown`, the 2 MiB cap, `sha256Hex`, `documentIds`, `importProvenance` and the
one-section `ImportedWork` unchanged. The genuinely new work is: the seam and the checks that sit
below it, the Firecrawl envelope adapter, a memory-only key holder modelled on
`src/canvas/credentials.ts`, one new panel and one new tab, and three documents that currently say
this cannot happen.

**Tech Stack:** TypeScript, React 19, Vite, Vitest (jsdom `unit` + Chromium `browser` projects),
Playwright (already a dev dependency) for one out-of-band live probe.

**Spec:** [`12-import-url-design.md`](12-import-url-design.md) — read its `## Amendment — 2026-08-29`
section first. Every measured fact this plan relies on was executed against the live API on
2026-08-29 and is recorded there.

**Issue:** [`issues/12-import-url-with-firecrawl.md`](issues/12-import-url-with-firecrawl.md)

## The seam has a second consumer — read this before Task 5

`WebArticleFetcher` is an interface with `firecrawlFetcher` behind it, not a Firecrawl module with an
interface bolted on, because a second implementation is already anticipated: the public Cloudflare
deployment keeps Firecrawl browser-direct with the user's own key, while a **self-hosted deployment**
would point at a local extraction service the operator runs on their own machine (crawl4ai or
similar), needing no Firecrawl key at all. That is the same shape as the Canvas push capability this
repo already ships — `src/vite-env.d.ts:3-4` declares `__OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__` as
*"Empty in the public build; an exact HTTPS origin in an opted-in self-host build"*,
`worker/relay.ts:236` reads `env.SELF_HOSTED_CANVAS_ORIGIN`, and `src/App.tsx:84-86,617,701-728`
gates the whole feature on it. A default-off capability an operator enables by pinning an exact
origin is the house pattern, and the second fetcher must slot into it without redesign. **This plan
builds no second implementation, adds no configuration flag for one, and assumes nothing about
crawl4ai's API.** The seam plus this paragraph is the whole provision — it exists so the next person
does not have to rediscover why the seam is there.

## Global Constraints

- **Fetched content is UNTRUSTED and passes through the EXISTING sanitizer, never a new one.** The
  web path enters `sanitizeImportedMarkdown` via `importText`, exactly as a pasted Markdown import
  does. No second sanitizer, no pre-cleaning, no "it came from Firecrawl so it is already clean" —
  measured: a scrape of `http://127.0.0.1:8080/` came back as Markdown containing a raw
  `<html><head>…` block.
- **The bytes the accessibility gate audited are the bytes published.** Nothing rewrites `html` after
  `compileAndAuditChapter`. Task 13 asserts it.
- **Every refused image keeps BOTH a finding and a visible `[Embedded image: alt]` placeholder.**
  This is inherited from `src/import/markup.ts`, not reimplemented: its image branch raises the
  blocking `import-image-unavailable` and substitutes `<span>[Embedded image: alt]</span>`. Do not
  add a second image path here.
- **One URL, one page — structurally, not by intention.** One endpoint (`/v2/scrape`) is named in the
  module and no other; `formats` is exactly `['markdown']` so the link set is never received;
  `importText` emits a one-element `sections` array. Task 12 asserts the absence of every other
  endpoint in both the source and the built bundle.
- **Do not widen the relay allowlist, and do not route Firecrawl traffic through the relay.** Nothing
  in `worker/` changes in this plan. `worker/relay.ts`'s header states the contract it would break:
  *"Allowlists destination hosts so this cannot become an open proxy."* **The user's key must never
  touch this app's infrastructure.** A CORS failure must never be answered by offering the relay;
  Task 6 asserts the failure string contains no such offer.
- **Everything below the seam is shared by both future fetchers.** The origin-status check, the PDF
  refusal, the redirect and cache disclosures, the rights warning, sanitization, provenance and
  findings live in `importWebArticle` and `importText`. Firecrawl-specific handling stays inside
  `firecrawlFetcher`, and each Firecrawl-specific detail carries a comment naming the general concept
  a second implementation must supply. The reason is concrete: the same URL must yield the same
  Canvas page in both deployments, or the two builds silently disagree about what a page is.
- **The key travels in the `Authorization` header and nowhere else** — never a query parameter, never
  an interpolated error, never a rendered string. Every user-facing message on this path is
  app-authored from an HTTP status code and a fixed string. `messageOf` in `src/errors.ts` returns
  `error.message` verbatim, so an `Error` built from a response object would be rendered as-is.
- **The vendor's own error text is data, not copy.** Measured: the `403` body is *"We apologize for
  the inconvenience but we do not support this site … please fill out our intake form here:
  https://fk4bvu0n5qp.typeform.com/to/Ej6oydlg"* — a vendor-controlled URL pointing at an enterprise
  sales form. It is never shown, never linkified, never `innerHTML`.
- **Every number is read from an existing constant or justified in a comment. Never a bare literal.**
  `MAX_TEXT_IMPORT_BYTES` (2 MiB) bounds the extracted Markdown; `FIRECRAWL_REQUEST_TIMEOUT_MS`
  (60 000) is the vendor's own documented default for the `timeout` body parameter and is sent
  explicitly as well as used as the client deadline, so the two cannot drift.
  `PARSER_PROBE_LIMITS.parserTimeoutMs` (30 000) is deliberately **not** reused: it budgets local
  WASM CPU, not a network round trip that includes a headless browser rendering someone's site.
- **Fail closed: refuse rather than guess.** `success !== true`, a missing `markdown`, a
  non-numeric `metadata.statusCode`, a non-2xx origin status, a PDF content type, or a final URL that
  fails `parsePublicSourceUrl` are all refusals. No defensive parsing that produces a half-import.
- **House style:** substantial comments explaining WHY, and every factual claim in a comment must be
  true of the source it names. Where a comment cites a measurement, cite the date (2026-08-29) so a
  later reader knows what to re-run.
- **Run `npm run typecheck && npx vitest run` before every commit; the whole suite must pass.** It is
  currently 110 files / 1071 tests. Two pre-existing intermittent flakes live in
  `src/components/DocumentImporter.browser.test.tsx` and `src/components/TextContentImporter.test.tsx`
  — rerun and say so; do NOT "fix" them.
- **Every commit in this repository's history is green.** Where a task would leave a red test, its
  header says which task it commits with. Tasks 10 and 11 are folded for a different reason, stated
  there.

---

### Task 1: Record the fetch-route decision and the rejected alternative in the design

**Already applied** in the commit that introduced this plan. Read the amended sections before
starting Task 2 — later tasks cite them — then tick these boxes and move on. They are listed as a
task because the plan and the design must not disagree, and this is what made them agree.

**Files:**
- Modified: `.scratch/document-import/12-import-url-design.md`

- [x] **Step 1: Question 9 — (a), browser-direct Firecrawl with the user's own key**

A new `## Amendment — 2026-08-29` section records the choice **and the reasoning, which is not the
reasoning the design assumed.** The deciding factor is not who pays for the key; it is **who bears
the abuse liability for fetching arbitrary URLs**. With bring-your-own-key that sits on the
instructor's own Firecrawl account. Widening the relay (option b) would make this app's Cloudflare
account an anonymous public-web proxy, and the relay's SSRF fences do not address that: they stop a
request reaching an *internal* network, not a stranger using the deployment to fetch arbitrary public
things under the operator's name. Option (c3) is the same decision in different packaging and closes
with (b).

- [x] **Step 2: Question 2 — Firecrawl Keyless is rejected**

Recorded with the three reasons, none of which is "it does not work" — it was verified to work
(`200`, `creditsUsed: 1`, no `Authorization` header at all, 2026-08-29). It is rejected because
unauthenticated use of a commercial API in a shipped product is an unresolved terms question, because
the quota is shared and outside this project's control, and because it can be withdrawn without
notice. **No keyless fallback and no "try keyless, then prompt for a key" path is designed.** A
missing key is a refusal with an instruction.

- [x] **Step 3: The seam has a second consumer**

The amendment records the self-hosted extractor as the anticipated second `WebArticleFetcher`, points
at the `__OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__` precedent, and states the constraint that follows:
everything downstream of the fetch is shared, Firecrawl-specific handling stays inside the fetcher.

- [x] **Step 4: Open questions 2 and 9 marked answered in place**

Both entries in the design's `## Open questions` list now open with **ANSWERED**, so a reader who
lands on that list is not left believing the fork is still open.

---

### Task 2: Prove browser-direct Firecrawl in a real browser, before anything depends on it

The whole posture rests on four curl probes, and **curl is not a browser**. CORS is a header contract
and those are the headers the contract requires, so the evidence is strong — but no browser has been
observed doing it. This task settles it. It costs nothing: a preflight is not a scrape, so it needs
no API key and spends no credit.

**Files:**
- Create: `scripts/verify-firecrawl-cors.mjs`
- Create: `scripts/verify-firecrawl-cors.test.mjs`
- Modify: `package.json` (a `verify:firecrawl-cors` script)

**Interfaces:**
- Exports `assertPreflightHeaders(status, headers)` — a pure function, so the offline suite can test
  the assertion logic without touching the network.
- The default export / `main()` drives Playwright and is never run by `vitest`.

- [x] **Step 1: Write the failing test**

Create `scripts/verify-firecrawl-cors.test.mjs` (the `unit` project already includes
`scripts/**/*.test.mjs`):

```js
import { assertPreflightHeaders } from './verify-firecrawl-cors.mjs'

/*
 * The three headers that decide whether this feature is buildable at all, and
 * the one that is easy to miss. `access-control-allow-origin: *` on the SUCCESS
 * response is not enough: a vendor that answered 401 without it would give the
 * browser an opaque network error, and this feature could never tell a user
 * their key was wrong. Measured 2026-08-29: the wildcard is present on 200, 401
 * and 403.
 */
test('a preflight is accepted only when it admits both headers this feature sends', () => {
  const ok = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
  }
  expect(() => assertPreflightHeaders(204, ok)).not.toThrow()
  expect(() => assertPreflightHeaders(204, { ...ok, 'access-control-allow-headers': 'content-type' }))
    .toThrow(/authorization/)
  expect(() => assertPreflightHeaders(204, { ...ok, 'access-control-allow-methods': 'GET,HEAD' }))
    .toThrow(/POST/)
  expect(() => assertPreflightHeaders(403, ok)).toThrow(/403/)
})
```

- [x] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit scripts/verify-firecrawl-cors.test.mjs`
Expected: FAIL — `scripts/verify-firecrawl-cors.mjs` does not exist, so the import throws
`ERR_MODULE_NOT_FOUND`.

- [x] **Step 3: Write the probe**

`scripts/verify-firecrawl-cors.mjs`. The assertion half is pure and exported; the Playwright half
runs only from `main()`.

```js
/**
 * Does a REAL browser accept a cross-origin request to Firecrawl?
 *
 * The design settled the fetch route on four curl probes (2026-08-29). curl is
 * not a browser: it never issues a preflight and never enforces one. This
 * probe closes that gap and is deliberately PREFLIGHT-ONLY —
 *
 *  - it sends no API key, because a preflight carries no `Authorization`
 *    header, only the promise that one is coming;
 *  - it spends no Firecrawl credit, because a preflight is not a scrape;
 *  - it asserts a header contract, not a scrape result.
 *
 * It is not part of `npm test`. It talks to a third party, so it must never
 * make the offline suite depend on a vendor being up. If it ever FAILS, the
 * browser-direct posture has been withdrawn by the vendor and the human has to
 * choose from the option table in the design again — do not work around it.
 */
const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v2/scrape'

export function assertPreflightHeaders(status, headers) {
  // 204 is what was measured. Anything else means the vendor answered the
  // preflight differently and the contract must be re-read, not coerced.
  if (status !== 204 && status !== 200) {
    throw new Error(`Preflight answered ${status}; expected 204.`)
  }
  const origin = headers['access-control-allow-origin']
  if (origin !== '*') {
    throw new Error(`access-control-allow-origin was ${origin ?? 'absent'}; expected *.`)
  }
  const allowed = (headers['access-control-allow-headers'] ?? '').toLowerCase()
  for (const header of ['authorization', 'content-type']) {
    if (!allowed.split(',').map((v) => v.trim()).includes(header)) {
      throw new Error(`access-control-allow-headers omits ${header}: "${allowed}".`)
    }
  }
  const methods = (headers['access-control-allow-methods'] ?? '').toUpperCase()
  if (!methods.split(',').map((v) => v.trim()).includes('POST')) {
    throw new Error(`access-control-allow-methods omits POST: "${methods}".`)
  }
}
```

`main()` launches Chromium headless, navigates to a `data:`/`about:blank` page on a foreign origin
(serve one line of HTML from a throwaway `http://127.0.0.1` server so the page has a real, non-null
origin — a `null` origin would not exercise the same code path), and issues the preflight from inside
the page. Read the response headers with `page.route`/`page.on('response')` or by having the page
`fetch` with `method: 'OPTIONS'` and reading `response.headers()` from the Playwright
`Response` object, then call `assertPreflightHeaders`. Print the three header values whether it
passes or fails; the values are the evidence, not the exit code.

Add to `package.json`:

```json
"verify:firecrawl-cors": "node scripts/verify-firecrawl-cors.mjs"
```

- [x] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit scripts/verify-firecrawl-cors.test.mjs`
Expected: PASS.

- [x] **Step 5: Run the live probe once, out of band, and record what it said**

Run: `npm run verify:firecrawl-cors`
Expected: it prints the three header values and exits 0.
**If it exits non-zero, STOP and escalate.** Do not proceed to Task 3, do not add a relay route, and
do not weaken the assertion. Everything after this task assumes a browser can reach
`api.firecrawl.dev`; if it cannot, the plan's premise is gone and the human must re-choose from the
design's option table. Paste the printed headers into the task report either way.

- [x] **Step 6: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add scripts/verify-firecrawl-cors.mjs scripts/verify-firecrawl-cors.test.mjs package.json
git commit -m "test: prove a real browser is allowed to preflight firecrawl"
```

**Measured 2026-08-29 — live run, headless Chromium, origin `http://127.0.0.1:<ephemeral>`:**

```
preflight status:                   204
access-control-allow-origin:        *
access-control-allow-headers:       authorization,content-type
access-control-allow-methods:       GET,HEAD,PUT,PATCH,POST,DELETE
keyless POST readable by page script: HTTP 401
```

Identical to the four curl probes. The browser-direct posture holds; Task 3 onward may proceed.

**Two deviations from this task as written, both forced by how Chromium orders the work:**

1. The preflight is observed over **CDP** (`Network.requestWillBeSent` /
   `responseReceivedExtraInfo`), not `page.on('response')`. Playwright does not report preflights
   through page events — they are issued beneath that layer. The first draft watched the right
   endpoint and observed zero preflights.
2. The probe is **not preflight-only**. Routing intercepts a request *before* the network stack
   issues its preflight, so `route.abort()` means no preflight is ever sent and nothing is measured.
   The keyless POST is allowed to land instead: it carries a placeholder rather than a key, stops at
   Firecrawl's 401 before anything is scraped, and spends no credit. It also proves the half that
   matters most — the 401 is **readable** by page script rather than an opaque CORS failure, which is
   the only reason this feature can ever tell a user their key is wrong.

---

### Task 3: Hold the key in memory only, with no persistence path in the type

`src/canvas/credentials.ts` already solved this problem for the Canvas token and documented why:

> Holding it here rather than in `sessionStorage` is deliberate: `sessionStorage` survives a reload
> and is readable by any script on the origin, which is most of what we were avoiding. A
> module-scoped variable dies with the document, which is what "session only" should mean.

The one difference is the argument list, and it is the point of the task. `createCredentialStore`
takes a `KeyValueStore` because the Canvas *base URL* is worth remembering. Nothing about a Firecrawl
key is. Taking **no store argument at all** means there is no persistence path to forget to avoid —
the type does not admit one — and no migration is ever needed, because no release ever wrote one.

**Files:**
- Create: `src/import/firecrawl-key.ts`
- Create: `src/import/firecrawl-key.test.ts`

**Interfaces:**
- Produces: `createFirecrawlKeyStore(): FirecrawlKeyStore` with `hold(key: string): void`,
  `peek(): string | undefined`, `forget(): void`.
- Consumes: nothing. No import of `KeyValueStore`, `idb`, `localStorage` or `sessionStorage`.

- [ ] **Step 1: Write the failing test**

```ts
import { createFirecrawlKeyStore } from './firecrawl-key'

test('a held key can be read back and erased', () => {
  const store = createFirecrawlKeyStore()
  expect(store.peek()).toBeUndefined()
  store.hold('fc-abc123')
  expect(store.peek()).toBe('fc-abc123')
  store.forget()
  expect(store.peek()).toBeUndefined()
})

test('a blank or whitespace-only key is not a key', () => {
  // The UI's Forget button and an empty field must mean the same thing, or a
  // user who cleared the box would send `Bearer ` and get an unexplained 401.
  const store = createFirecrawlKeyStore()
  store.hold('   ')
  expect(store.peek()).toBeUndefined()
  store.hold(' fc-abc123 ')
  expect(store.peek()).toBe('fc-abc123')
})

test('two stores do not share a key', () => {
  // Module-scoped inside the FACTORY, not at module top level: a top-level
  // `let` would be one key for every caller in the tab, which is a wider
  // blast radius than this needs and makes the containment tests lie.
  const a = createFirecrawlKeyStore()
  const b = createFirecrawlKeyStore()
  a.hold('fc-a')
  expect(b.peek()).toBeUndefined()
})

test('the store takes no argument, so no caller can hand it a disk', () => {
  /*
   * Not a style assertion. `createCredentialStore(disk)` exists three
   * directories away and takes a `KeyValueStore`; the ONE structural guarantee
   * that this key can never be persisted is that its constructor has nowhere to
   * put a store. If someone later adds an options bag, this fails and they have
   * to argue for it.
   */
  expect(createFirecrawlKeyStore).toHaveLength(0)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/firecrawl-key.test.ts`
Expected: FAIL — `src/import/firecrawl-key.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
/**
 * Where the Firecrawl API key lives, and for how long.
 *
 * This mirrors `src/canvas/credentials.ts`, which solved the same problem for
 * the Canvas access token and documented the reasoning: `sessionStorage`
 * survives a reload and is readable by any script on the origin, while a
 * variable scoped to a closure dies with the document — which is what "session
 * only" should mean.
 *
 * The difference from `createCredentialStore` is the argument list, and it is
 * deliberate. That factory takes a `KeyValueStore` because the Canvas base URL
 * is worth remembering across reloads. Nothing about a Firecrawl key is. Taking
 * NO store means there is no persistence path to forget to avoid: the type does
 * not admit one. It also means this feature needs no migration of the kind
 * `migratePersistedTokens` exists to be, because no release of it ever wrote a
 * key anywhere — and it must never acquire one.
 */
export interface FirecrawlKeyStore {
  /** Replace the held key. Blank or whitespace-only clears it. */
  hold(key: string): void
  peek(): string | undefined
  forget(): void
}

export function createFirecrawlKeyStore(): FirecrawlKeyStore {
  let held: string | undefined

  return {
    hold(key) {
      const trimmed = key.trim()
      // A user who clears the field has forgotten the key as surely as one who
      // pressed the button, and `Bearer ` with nothing after it would come back
      // as an unexplained 401.
      held = trimmed === '' ? undefined : trimmed
    },
    peek() {
      return held
    },
    forget() {
      held = undefined
    },
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/firecrawl-key.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/firecrawl-key.ts src/import/firecrawl-key.test.ts
git commit -m "feat: hold a firecrawl key in memory with no persistence path"
```

---

### Task 4: Teach `importText` what a `web` import is

`src/import/types.ts` **already declares** everything this needs and has since issue 12 was written:
`ImportReport.parser` lists `'firecrawl'`, `ImportedFormat` lists `'web'`, and
`ImportProvenance.kind` lists `'web'`. All three are dead today. This task makes them live by adding
one variant, not by post-mutating a returned `ImportResult` — rewriting `provenance.kind` and
`report.parser` after the fact would put two places in charge of what a `web` import is, and the
second would drift.

**Files:**
- Modify: `src/import/text.ts`
- Modify: `src/import/text.test.ts`

**Interfaces:**
- `TextImportInput` gains
  `{ kind: 'web'; text: string; parser: ImportReport['parser']; sourceUrl: URL }`.
- `importText` is otherwise unchanged: same signature, same return type, same one-section shape.

- [ ] **Step 1: Write the failing test**

Add to `src/import/text.test.ts`:

```ts
const webMetadata = {
  title: 'Photosynthesis',
  sourceUrl: 'https://en.wikipedia.org/wiki/Photosynthesis',
  rightsAuthority: 'open-license' as const,
  rightsAcknowledged: true,
}

test('a web import is recorded as web, names its extractor, and stays one section', async () => {
  const result = await importText(
    {
      kind: 'web',
      text: '# Photosynthesis\n\nPlants convert light.',
      parser: 'firecrawl',
      sourceUrl: new URL('https://en.wikipedia.org/wiki/Photosynthesis'),
    },
    { metadata: webMetadata },
  )
  expect(result.work.format).toBe('web')
  expect(result.work.provenance.kind).toBe('web')
  expect(result.work.provenance.sourceUrl).toBe('https://en.wikipedia.org/wiki/Photosynthesis')
  expect(result.report.parser).toBe('firecrawl')
  expect(result.report.format).toBe('web')
  expect(result.work.sections).toHaveLength(1)
  // Markdown, through the same sanitizer a pasted Markdown import uses.
  expect(result.work.sections[0]!.html).toContain('<h1')
})

test('a web import resolves relative links against the URL that was extracted', async () => {
  const result = await importText(
    {
      kind: 'web',
      text: '[next](/wiki/Chlorophyll)',
      parser: 'firecrawl',
      sourceUrl: new URL('https://en.wikipedia.org/wiki/Photosynthesis'),
    },
    { metadata: webMetadata },
  )
  expect(result.work.sections[0]!.html).toContain('href="https://en.wikipedia.org/wiki/Chlorophyll"')
})

test('a web import inherits the image refusal and its visible placeholder', async () => {
  /*
   * Not new behaviour and deliberately not new code: this is `markup.ts`'s
   * image branch, reached because the web path enters `sanitizeImportedMarkdown`
   * like every other Markdown import. Asserted HERE so that a future change to
   * that branch cannot silently change what a fetched article publishes.
   * See this plan's `## Open questions` — the divergence with `anydoc-html.ts`
   * is known and pinned rather than resolved by rewriting either one.
   */
  const result = await importText(
    {
      kind: 'web',
      text: '![A leaf cross-section](https://upload.wikimedia.org/leaf.png)',
      parser: 'firecrawl',
      sourceUrl: new URL('https://en.wikipedia.org/wiki/Photosynthesis'),
    },
    { metadata: webMetadata },
  )
  expect(result.work.sections[0]!.html).toContain('[Embedded image: A leaf cross-section]')
  expect(result.report.findings).toContainEqual(
    expect.objectContaining({ code: 'import-image-unavailable', severity: 'blocker' }),
  )
})

test('a web import inherits the private-network fence on links', async () => {
  // `markup.ts` runs `isPublicNetworkUrl` over every href/src/cite. The fence is
  // INHERITED, not missing — and this is where that claim is checkable.
  const result = await importText(
    {
      kind: 'web',
      text: '[metadata](http://169.254.169.254/latest/meta-data/)',
      parser: 'firecrawl',
      sourceUrl: new URL('https://en.wikipedia.org/wiki/Photosynthesis'),
    },
    { metadata: webMetadata },
  )
  expect(result.work.sections[0]!.html).not.toContain('169.254.169.254')
  expect(result.report.findings.map((f) => f.code)).toContain('import-dangerous-url-removed')
})

test('a web import refuses to disagree with itself about the source URL', async () => {
  await expect(importText(
    {
      kind: 'web',
      text: 'text',
      parser: 'firecrawl',
      sourceUrl: new URL('https://example.com/a'),
    },
    { metadata: { ...webMetadata, sourceUrl: 'https://example.com/b' } },
  )).rejects.toThrow(/source URL/i)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/text.test.ts`
Expected: FAIL — TypeScript rejects `kind: 'web'`; at runtime `formatOf` throws its
"Choose a text, Markdown, or HTML file" message because the variant is unknown.

- [ ] **Step 3: Implement**

In `src/import/text.ts`:

```ts
export type TextImportInput =
  | { kind: 'paste'; text: string; format?: TextLikeFormat }
  | { kind: 'file'; file: File }
  /*
   * A web article, already extracted to Markdown by a `WebArticleFetcher`.
   *
   * `parser` is supplied by the fetcher rather than hardcoded here, because
   * `importText` must not name a vendor: the public build's fetcher is
   * Firecrawl, and a self-hosted build's would be something else (see the
   * plan's seam note). `sourceUrl` is the POST-REDIRECT url that was actually
   * extracted — the same one provenance is built from, passed explicitly so
   * relative-link resolution and provenance cannot drift apart.
   */
  | { kind: 'web'; text: string; parser: ImportReport['parser']; sourceUrl: URL }
```

`formatOf` gains `if (input.kind === 'web') return 'markdown'` — a fetched article is Markdown, and
it reaches `sanitizeImportedMarkdown` for that reason. Keep `work.format`/`report.format` separate
from it:

```ts
const format = formatOf(input)
// What it IS, versus how it is normalized. A web import is normalized as
// Markdown and recorded as `web`; conflating the two would lose the fact that
// the bytes came off the network in `report.format`, which is the field the
// plan editor and the cartridge attribute the import from.
const recordedFormat: ImportedFormat = input.kind === 'web' ? 'web' : format
```

The size-limit label becomes a small function so the message names the thing the user did:

```ts
function limitLabel(input: TextImportInput, format: TextLikeFormat): string {
  if (input.kind === 'web') return 'Imported web article'
  return format === 'text' ? 'Plain-text' : format === 'markdown' ? 'Markdown' : 'HTML'
}
```

Text selection, base URL and the drift guard:

```ts
const text = input.kind === 'file' ? await readUtf8(input.file) : input.text
```

```ts
const baseUrl = parsePublicSourceUrl(options.metadata.sourceUrl)
if (input.kind === 'web' && baseUrl?.href !== input.sourceUrl.href) {
  /*
   * A programmer error, not a user error, and worth failing on. The whole
   * point of passing the URL twice is that provenance (built from
   * `metadata.sourceUrl`) and relative-link resolution (built from
   * `publicBaseUrl`) describe the SAME page. `importWebArticle` sets both from
   * one `URL` object; this is what makes "cannot drift" a checked claim rather
   * than a comment.
   */
  throw new Error('A web import must record the source URL it was extracted from.')
}
```

Provenance and report:

```ts
const provenance = importProvenance(options.metadata,
  input.kind === 'paste' ? { kind: 'paste' }
    : input.kind === 'web' ? { kind: 'web' }
      : { kind: 'local-file', originalName: input.file.name })
```

```ts
report: {
  parser: input.kind === 'web' ? input.parser : 'native',
  format: recordedFormat,
  ...(input.kind === 'file' ? { originalName: input.file.name } : {}),
  ...(input.kind === 'web' ? { sourceUrl: input.sourceUrl.href } : {}),
  originalBytes: bytes.byteLength,
  ...
}
```

and `work.format: recordedFormat`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/text.test.ts && npm run typecheck`
Expected: PASS, with every existing `paste`/`file` test untouched. If an existing test changed
behaviour, the `recordedFormat` split is wrong — fix it rather than editing the old test.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/text.ts src/import/text.test.ts
git commit -m "feat: let importText accept an extracted web article as one section"
```

---

### Task 5: The `WebArticleFetcher` seam, and the checks both implementations share

This is the shared half, and it is written and tested **before** any Firecrawl code exists, driven by
a hand-written stub fetcher. That is not a testing convenience: a test file that imports no vendor
module and still exercises every refusal is the demonstration that a second implementation plugs in
here and gets all of them for free.

**Files:**
- Create: `src/import/web.ts`
- Create: `src/import/web.test.ts`

**Interfaces:**
- Produces: `FetchedArticle`, `WebArticleFetcher`, `importWebArticle(rawUrl, options)`.
- Consumes: `parsePublicSourceUrl` (`src/import/common.ts`), `importText` (`src/import/text.ts`).
- Imports **nothing** from `firecrawl-key.ts` or any Firecrawl module. If it does, the seam has
  leaked.

- [ ] **Step 1: Write the failing test**

`src/import/web.test.ts`. Every case below is one row of the design's failure table.

```ts
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
    parser: 'firecrawl',
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
  const counting: WebArticleFetcher = async (url) => { called += 1; return stub()(url, new AbortController().signal) }
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/web.test.ts`
Expected: FAIL — `src/import/web.ts` does not exist.

- [ ] **Step 3: Implement**

`src/import/web.ts`. The seam first, because it is the point of the file:

```ts
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
```

`importWebArticle` in order — every step is a refusal or a disclosure, and the order matters:

1. `const target = parsePublicSourceUrl(rawUrl)`; if it is `undefined`, throw
   `'Enter the address of the web page to import.'` The comment records the measured reason the
   fence is here and not left to the vendor.
2. Wire the caller's `signal` through to the fetcher and `throwIfAborted()` before and after.
3. `const article = await fetcher(target, signal)`.
4. `const finalUrl = parsePublicSourceUrl(article.finalUrl.href)` — re-validated, because a redirect
   can land somewhere the first check would have refused, and `!finalUrl` is a refusal.
5. Origin status: refuse unless `article.statusCode >= 200 && article.statusCode <= 299`, with the
   measured 404-inside-200 comment. The message interpolates the **number** only:
   `` `That address answered HTTP ${statusCode}, so there is no article to import.` ``
6. PDF: refuse when `article.contentType?.toLowerCase().startsWith('application/pdf')` **or** the
   final URL's path ends `.pdf`. Two checks, and the comment says why each exists — the path check
   refuses before a credit is spent, the content-type check is the authoritative one because a PDF
   need not be served from a `.pdf` path. Message names the alternative:
   `'That address is a PDF. Import it from the Document tab, where each page's extraction is checked and a page that is an image of text is refused.'`
   (Issue 11 owns PDFs, locally, where `pagesNeedingOcr`, `pdfType` and the layout signals exist; a
   remote extraction returns none of them, so accepting a PDF here would publish a scan-derived page
   with no scanned-page finding.)
7. Delegate: `importText({ kind: 'web', text: article.markdown, parser: article.parser, sourceUrl: finalUrl }, { metadata: { ...options.metadata, sourceUrl: finalUrl.href }, signal })`.
   The `sourceUrl` override is what makes Task 4's drift guard pass, and the comment says so.
8. Append the web-layer findings to `result.report.findings` — redirect, cache, and Task 7's rights
   warning. **Additive only.** The comment must distinguish this from the thing the design refused:
   adding a finding does not put a second place in charge of what a `web` import IS, whereas
   rewriting `provenance.kind` or `report.parser` after the fact would.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/web.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/web.ts src/import/web.test.ts
git commit -m "feat: add the web-article seam and the refusals both fetchers share"
```

---

### Task 6: `firecrawlFetcher` — the one implementation, and its error taxonomy

Everything Firecrawl-shaped lives here and nowhere else. Every request is injected in tests; nothing
in the suite reaches the network.

**Files:**
- Create: `src/import/firecrawl.ts`
- Create: `src/import/firecrawl.test.ts`

**Interfaces:**
- Produces: `createFirecrawlFetcher(deps): WebArticleFetcher`, `FIRECRAWL_ENDPOINT`,
  `FIRECRAWL_REQUEST_TIMEOUT_MS`.
- `deps` is `{ key: () => string | undefined; fetch?: typeof globalThis.fetch }`. A **getter**, not a
  string: the panel holds the key and can forget it between the render and the submit, and a captured
  string would outlive the Forget button.

- [ ] **Step 1: Write the failing test**

```ts
const SENTINEL = 'fc-SENTINEL-do-not-leak-0123456789'

function respond(body: unknown, status = 200): typeof globalThis.fetch {
  return async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })
}

test('the request names one endpoint, asks for markdown only, and refuses pdf transcoding', async () => {
  let seen: { url: string; init: RequestInit } | undefined
  const fetcher = createFirecrawlFetcher({
    key: () => SENTINEL,
    fetch: async (url, init) => {
      seen = { url: String(url), init: init! }
      return new Response(JSON.stringify(okEnvelope), { status: 200 })
    },
  })
  await fetcher(new URL('https://example.com/a'), new AbortController().signal)

  expect(seen!.url).toBe('https://api.firecrawl.dev/v2/scrape')
  const body = JSON.parse(String(seen!.init.body))
  expect(body.formats).toEqual(['markdown'])
  // Measured 2026-08-29: the DEFAULT is `[{"type":"pdf"}]`, and with it a PDF
  // URL is silently text-extracted server-side. `[]` makes a PDF arrive as a
  // PDF so `importWebArticle` can refuse it.
  expect(body.parsers).toEqual([])
  expect(body.timeout).toBe(FIRECRAWL_REQUEST_TIMEOUT_MS)
  // The link set is never requested, so link-following code cannot be written
  // by accident: it would have nothing to follow.
  expect(JSON.stringify(body)).not.toContain('links')
  // The wildcard `access-control-allow-origin: *` measured on every status
  // makes this mandatory — a browser rejects a wildcard response for a
  // credentialed request — and no cookie of this app's belongs on a vendor call.
  expect(seen!.init.credentials).toBe('omit')
})

test('the key travels in the Authorization header and in nothing else', async () => {
  let seen: { url: string; init: RequestInit } | undefined
  const fetcher = createFirecrawlFetcher({
    key: () => SENTINEL,
    fetch: async (url, init) => { seen = { url: String(url), init: init! }; return new Response(JSON.stringify(okEnvelope)) },
  })
  await fetcher(new URL('https://example.com/a'), new AbortController().signal)
  // Positive first, so this can never pass by never sending the key at all.
  expect(new Headers(seen!.init.headers).get('authorization')).toBe(`Bearer ${SENTINEL}`)
  expect(seen!.url).not.toContain(SENTINEL)
  expect(String(seen!.init.body)).not.toContain(SENTINEL)
})

test('a missing key is a refusal with an instruction, never a keyless attempt', async () => {
  /*
   * Firecrawl Keyless was VERIFIED to work (200, `creditsUsed: 1`, no
   * Authorization header, 2026-08-29) and is rejected — unresolved terms,
   * a shared quota outside this project's control, withdrawable without
   * notice. `called` is the assertion that matters: no request is made.
   */
  let called = 0
  const fetcher = createFirecrawlFetcher({
    key: () => undefined,
    fetch: async () => { called += 1; return new Response('{}') },
  })
  await expect(fetcher(new URL('https://example.com/a'), new AbortController().signal))
    .rejects.toThrow(/Firecrawl API key/)
  expect(called).toBe(0)
})

test.each([
  [401, /rejected this API key/],
  [403, /could not read this site/],
  [429, /rate-limiting/],
  [402, /HTTP 402/],
  [500, /HTTP 500/],
])('HTTP %i produces an app-authored message and never the vendor text', async (status, expected) => {
  const vendorText = 'We apologize … https://fk4bvu0n5qp.typeform.com/to/Ej6oydlg'
  const fetcher = createFirecrawlFetcher({
    key: () => SENTINEL,
    fetch: respond({ success: false, error: vendorText }, status),
  })
  const caught = await fetcher(new URL('https://example.com/a'), new AbortController().signal)
    .catch((error: unknown) => error)
  expect(messageOf(caught)).toMatch(expected)
  expect(messageOf(caught)).not.toContain('typeform')
  expect(messageOf(caught)).not.toContain(SENTINEL)
})

test('a network TypeError names both possibilities and never offers the relay', async () => {
  const fetcher = createFirecrawlFetcher({
    key: () => SENTINEL,
    fetch: async () => { throw new TypeError('Failed to fetch') },
  })
  const caught = await fetcher(new URL('https://example.com/a'), new AbortController().signal)
    .catch((error: unknown) => error)
  // CORS refusal is INDISTINGUISHABLE from offline: the browser deliberately
  // hides the reason. So the message names both rather than guessing.
  expect(messageOf(caught)).toMatch(/offline/i)
  expect(messageOf(caught)).toMatch(/browser requests|policy/i)
  // The one thing it must never suggest. Routing this key through the app's
  // relay would put a user's vendor credential on this project's infrastructure
  // and turn the relay into the open proxy its header comment forbids.
  expect(messageOf(caught)).not.toMatch(/relay|proxy|server/i)
})

test('an unexpected envelope fails closed rather than being parsed defensively', async () => {
  for (const body of [
    { success: false },
    { success: true, data: {} },                                   // no markdown
    { success: true, data: { markdown: 'x', metadata: {} } },      // no statusCode
    { success: true, data: { markdown: 'x', metadata: { statusCode: 'ok' } } },
  ]) {
    await expect(createFirecrawlFetcher({ key: () => SENTINEL, fetch: respond(body) })(
      new URL('https://example.com/a'), new AbortController().signal,
    )).rejects.toThrow(/unexpected response/i)
  }
})

test('the envelope becomes a FetchedArticle: origin status, final url, cache state', async () => {
  const fetcher = createFirecrawlFetcher({
    key: () => SENTINEL,
    fetch: respond({
      success: true,
      data: {
        markdown: '# Title',
        metadata: {
          sourceURL: 'https://example.com/old',
          url: 'https://example.com/new',
          statusCode: 404,
          contentType: 'text/html; charset=utf-8',
          cacheState: 'hit',
          cachedAt: '2026-08-27T10:00:00Z',
        },
      },
    }),
  })
  const article = await fetcher(new URL('https://example.com/old'), new AbortController().signal)
  // 404 is carried UP, not refused here. The refusal is `importWebArticle`'s,
  // because it must be identical for every fetcher.
  expect(article.statusCode).toBe(404)
  expect(article.finalUrl.href).toBe('https://example.com/new')
  expect(article.cachedAt).toBe('2026-08-27T10:00:00Z')
  expect(article.parser).toBe('firecrawl')
})

test('the client deadline aborts with a message about the deadline, not about cancelling', async () => {
  vi.useFakeTimers()
  const fetcher = createFirecrawlFetcher({ key: () => SENTINEL, fetch: () => new Promise(() => {}) })
  const running = fetcher(new URL('https://example.com/a'), new AbortController().signal)
  await vi.advanceTimersByTimeAsync(FIRECRAWL_REQUEST_TIMEOUT_MS)
  await expect(running).rejects.toThrow(/did not answer/)
  vi.useRealTimers()
})

test('a user cancellation is an AbortError, distinguishable from the deadline', async () => {
  const controller = new AbortController()
  const fetcher = createFirecrawlFetcher({ key: () => SENTINEL, fetch: (_u, init) =>
    new Promise((_r, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))) })
  const running = fetcher(new URL('https://example.com/a'), controller.signal)
  controller.abort()
  await expect(running).rejects.toMatchObject({ name: 'AbortError' })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/firecrawl.test.ts`
Expected: FAIL — `src/import/firecrawl.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
export const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v2/scrape'

/**
 * The vendor's own documented default for the `timeout` body parameter
 * (Firecrawl `/v2/scrape` API reference, read 2026-08-29). It is SENT
 * explicitly as well as used as the client deadline, so a future revision of
 * the vendor's default cannot make the two disagree.
 *
 * `PARSER_PROBE_LIMITS.parserTimeoutMs` (30 000) is deliberately not reused: it
 * budgets local WASM CPU, and a network round trip that includes a headless
 * browser rendering someone's site is a different thing.
 */
export const FIRECRAWL_REQUEST_TIMEOUT_MS = 60_000
```

Then the fetcher. Notes for the implementer, each of which must end up as a comment:

- **Two abort sources, one signal.** Build a local `AbortController`, forward the caller's signal to
  it, and arm a `setTimeout(…, FIRECRAWL_REQUEST_TIMEOUT_MS)`. Track which fired, because the two
  produce different messages — "Import cancelled…" versus "Firecrawl did not answer in 60 seconds."
  Write this by hand rather than with `AbortSignal.any`/`AbortSignal.timeout`: the `unit` project is
  jsdom, whose `AbortSignal` is not Node's, and an environment assumption here would be a test that
  passes for the wrong reason. Clear the timer in a `finally`.
- **The endpoint is a module constant used once.** `/v2/crawl`, `/v2/map`, `/v2/search`, `/v2/batch`
  and `/v2/agent` never appear anywhere in this file. Task 12 asserts that mechanically.
- **`credentials: 'omit'`**, with the wildcard-CORS reason.
- **The key comes from `deps.key()` at call time**, so Forget takes effect between renders.
- **Status handling** maps 401/403/429 to named messages and everything else non-2xx to
  `` `Firecrawl refused the request (HTTP ${response.status}). Check your plan's credit balance.` ``
  — the generic branch, with a comment recording that Firecrawl's rate-limit documentation lists no
  `402` (verified absent) so quota exhaustion is **inferred** to land here.
- **`response.json()` may itself throw** on a non-JSON body; that is an unexpected response.
- **Nothing from the response body is ever interpolated into a message.** The only interpolated value
  in the whole file is `response.status`, a number.

Close the file with the note the second implementation needs:

```ts
/*
 * Three things above are Firecrawl's SHAPE, not the seam's. A second
 * `WebArticleFetcher` — the self-hosted extractor described in the plan — must
 * supply the same CONCEPTS by whatever means its own service offers:
 *
 *  - `parsers: []` means "do not transcode a PDF for me". The general concept
 *    is that a fetcher must report a PDF as a PDF, not as text, so the shared
 *    refusal can fire. A fetcher that silently text-extracts PDFs would publish
 *    a scan-derived page with none of the scanned-page signals issue 11 exists
 *    to compute.
 *  - `metadata.statusCode` means "the status the ORIGIN gave", which is not the
 *    status the extractor gave. `importWebArticle` refuses a non-2xx origin and
 *    can only do that if the fetcher reports it.
 *  - the 401/403/429 taxonomy is Firecrawl's auth and quota vocabulary. A
 *    self-hosted extractor has neither a key nor a credit balance, and will
 *    have failures of its own; the contract at the seam is not the status codes
 *    but the RULE — throw an `Error` whose message is built from a status and a
 *    fixed string, never from the request, the headers, or an interpolated
 *    response body.
 */
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/firecrawl.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/firecrawl.ts src/import/firecrawl.test.ts
git commit -m "feat: fetch one article from firecrawl with the user's own key"
```

---

### Task 7: Make the rights ceremony honest for an article nobody licensed to us

This is `oer2canvas`. An OER page is openly licensed; an arbitrary web article usually is not, and
`RIGHTS_AUTHORITIES` offers `own | permission | open-license | public-domain` — none of which is "I
found it on the internet". **This task invents no legal policy and changes no gate.** It makes the
ceremony say true things and records what the instructor actually asserted.

A measured gap, not an invented one: `validateImportMetadata` requires `licenseName` only when
`licenseUrl` is supplied. Neither is ever required, so `open-license` can be selected today, on any
import path, naming no licence at all. **Tightening that globally is a product decision and is
escalated, not taken here** (see `## Open questions`). What is taken here is disclosure: telling the
user what they did and did not say is not policy.

**Files:**
- Modify: `src/components/ImportMetadataFields.tsx`
- Modify: `src/import/web.ts`
- Modify: `src/import/web.test.ts`
- Modify: `src/components/ImportPlanEditor.test.tsx` or the metadata-fields test that covers the
  rights fieldset (find it; do not create a parallel one)

**Interfaces:**
- `ImportMetadataFields` gains two **optional** props, so no existing caller changes:
  `rightsPreface?: ReactNode` and `sourceUrl?: { readOnly: true; note: string }`.

- [ ] **Step 1: Write the failing test**

In `src/import/web.test.ts`:

```ts
test('claiming an open license without naming one is disclosed, not blocked', async () => {
  /*
   * `validateImportMetadata` requires a license NAME only when a license URL is
   * given, so `open-license` naming nothing is legal on every import path
   * today. On a publisher import that is nearly harmless; on an arbitrary web
   * article it is the difference between a defensible claim and a bare
   * assertion. This warns and does not block, because tightening the rule
   * changes every import path and is a product decision — see the plan's Open
   * questions. Warning, not blocker: it must not stop an instructor who knows
   * what they are doing and will type the license on the next screen.
   */
  const result = await importWebArticle('https://example.com/a', {
    metadata: { ...metadata, rightsAuthority: 'open-license' },
    fetcher: stub(),
  })
  expect(result.report.findings).toContainEqual(expect.objectContaining({
    code: 'import-web-license-unnamed', severity: 'warning',
  }))
})

test('naming a license clears the disclosure', async () => {
  const result = await importWebArticle('https://example.com/a', {
    metadata: { ...metadata, rightsAuthority: 'open-license', licenseName: 'CC BY 4.0' },
    fetcher: stub(),
  })
  expect(result.report.findings.map((f) => f.code)).not.toContain('import-web-license-unnamed')
})

test('nothing about a license is ever inferred from the fetched page', async () => {
  // The extractor reports OpenGraph keys and no license. Guessing one from a
  // meta tag would be exactly the fabrication this repo refuses; the README
  // already promises "The app never invents a URL or an open license."
  const result = await importWebArticle('https://example.com/a', { metadata, fetcher: stub() })
  expect(result.work.provenance.license).toBeUndefined()
})
```

And, in the metadata-fields component test:

```tsx
test('the rights fieldset can carry a preface, and the source url can be recorded rather than asked', () => {
  render(<ImportMetadataFields
    value={draft}
    onChange={() => {}}
    idPrefix="web-article"
    rightsPreface={<>Extraction is not a license.</>}
    sourceUrl={{ readOnly: true, note: 'Recorded from the address you imported.' }}
  />)
  expect(screen.getByText(/Extraction is not a license/)).toBeInTheDocument()
  expect(screen.getByLabelText(/Public source URL/)).toHaveAttribute('readonly')
})

test('the existing callers are unchanged when the new props are absent', () => {
  render(<ImportMetadataFields value={draft} onChange={() => {}} idPrefix="text-content" />)
  expect(screen.getByLabelText(/Public source URL/)).not.toHaveAttribute('readonly')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/web.test.ts src/components/ImportMetadataFields*`
Expected: FAIL — no `import-web-license-unnamed` finding, and TypeScript rejects the two new props.

- [ ] **Step 3: Implement**

In `ImportMetadataFields.tsx`, both props optional and rendered only when present. The source-URL
input becomes `readOnly` with the note as `aria-describedby` text when `sourceUrl` is supplied —
**read-only rather than hidden**, because the URL is part of the attribution the page will carry and
the user should see exactly what is being recorded.

In `web.ts`, after the delegation, append the finding:

```ts
if (options.metadata.rightsAuthority === 'open-license' && !options.metadata.licenseName?.trim()) {
  findings.push({
    code: 'import-web-license-unnamed',
    severity: 'warning',
    message: 'You said this page’s license permits the use but did not name a license. '
      + 'Add the license name and URL on the page plan, or choose a different basis.',
  })
}
```

The preface text the web panel passes (Task 9), which is a statement of fact and not a policy:

> Extraction is not a license. A page being publicly readable does not make it openly licensed, and
> this app cannot tell you what license a page carries. Choose the basis you actually have.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/web.test.ts src/components/ && npm run typecheck`
Expected: PASS, with every existing `ImportMetadataFields` caller untouched.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/components/ImportMetadataFields.tsx src/import/web.ts src/import/web.test.ts src/components/
git commit -m "feat: say plainly that extraction is not a license, and disclose an unnamed one"
```

---

### Task 8: `WebArticleImporter` — the panel that says what it will do before it does it

Criterion 1 of the issue: the interface explains that the URL and API key go directly from the
browser to Firecrawl **before** the user proceeds. Above the button, in prose, not behind a
disclosure triangle.

**Files:**
- Create: `src/components/WebArticleImporter.tsx`
- Create: `src/components/WebArticleImporter.test.tsx`

**Interfaces:**
- Props: `{ onImported: (result: ImportResult) => void; onOpenLibreTexts?: () => void }`.
- Mirrors `TextContentImporter`: it parses and hands the result to its owner. The page plan,
  findings and preview belong to `ImportPlanEditor`, so editing them never comes back through this
  form and never re-fetches — which on this path also means never spends a second credit.

- [ ] **Step 1: Write the failing test**

```tsx
test('the panel states the destination, what is sent, and the cost, before the button', () => {
  render(<WebArticleImporter onImported={() => {}} />)
  const disclosure = screen.getByText(/api\.firecrawl\.dev/)
  expect(disclosure).toBeInTheDocument()
  expect(disclosure.textContent).toMatch(/directly from (this|your) browser/i)
  // The relay is named so a reader knows what is NOT involved.
  expect(disclosure.textContent).toMatch(/relay is not involved/i)
  expect(disclosure.textContent).toMatch(/one Firecrawl credit/i)
  expect(disclosure.textContent).toMatch(/memory|never written to browser storage/i)
  // Not behind a triangle. A disclosure the user must open is not a disclosure.
  expect(disclosure.closest('details')).toBeNull()
})

test('Forget key clears the field and the held key, not just the field', async () => {
  // The memory half is asserted in Task 9's containment suite, which can see
  // the store. Here: the control exists, is reachable, and empties the input.
  render(<WebArticleImporter onImported={() => {}} />)
  const key = screen.getByLabelText(/Firecrawl API key/i)
  fireEvent.change(key, { target: { value: 'fc-abc' } })
  fireEvent.click(screen.getByRole('button', { name: /Forget key/i }))
  expect(key).toHaveValue('')
})

test('a libretexts url gets a nudge with a button, and is never redirected', async () => {
  /*
   * Two URL boxes in one app, deliberately. `SourceBrowser.tsx:95-111`'s box is
   * a BOOK OPENER: it validates the host, derives a title, and calls
   * `onPick({ source: 'libretexts' })` — a `BookRef` to the chapter picker, no
   * fetch, no key, no credit, a known-open license. This box is an ARTICLE
   * IMPORTER: one fetch, one `ImportResult`, one page. Merging them would make
   * one control whose behaviour forks invisibly on hostname.
   *
   * So: a nudge, never a redirect. Silently doing something other than what the
   * button says is exactly the surprise this repo's fail-closed rule exists to
   * prevent.
   */
  const onOpenLibreTexts = vi.fn()
  render(<WebArticleImporter onImported={() => {}} onOpenLibreTexts={onOpenLibreTexts} />)
  fireEvent.change(screen.getByLabelText(/address|URL/i), {
    target: { value: 'https://chem.libretexts.org/Bookshelves/Organic' },
  })
  expect(screen.getByText(/structured chapters and needs no API key/i)).toBeInTheDocument()
  expect(onOpenLibreTexts).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /LibreTexts tab/i }))
  expect(onOpenLibreTexts).toHaveBeenCalledTimes(1)
})

test('the nudge does not block the import', async () => {
  // Non-blocking: an instructor who wants one LibreTexts page as one Canvas
  // page is not wrong, and this feature is for them too.
  ...assert the submit button is enabled with a libretexts URL typed
})

test('a failed import shows an app-authored message and the panel stays usable', async () => { ... })
test('cancel aborts the in-flight import and reports it as cancelled', async () => { ... })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/components/WebArticleImporter.test.tsx`
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Implement**

Follow `TextContentImporter.tsx` for the form shell (`useImportErrorFocus`, the `role="status"` busy
line, the `role="alert"` error, the `AbortController` in a `useRef`, Cancel beside the status line)
and `src/shell/CanvasConnect.tsx:95-120` for the credential field — masked by default with a
show/hide toggle, for the reason its comment already gives: *"a mistyped 70-character string is
otherwise impossible to find, and 'check the token' is advice nobody can act on against a row of
dots."*

Specifics:

- One `createFirecrawlKeyStore()` per mounted panel, in a `useRef`. The key input is a controlled
  field whose `onChange` also calls `store.hold(value)`; **the store is what the fetcher reads**, and
  the field is only how it is typed. Forget calls `store.forget()` **and** clears the field.
- `autoComplete="off"` on the key field, and a `name` that is not password-shaped, so a browser
  password manager is not invited to persist it. Comment the reason: a manager saving the key would
  be persistence this app does not control and cannot forget.
- The disclosure paragraph, verbatim-ish:

  > Importing a web page sends the address below and your Firecrawl API key from this browser
  > directly to `api.firecrawl.dev`. This app's relay is not involved and never sees your key.
  > Firecrawl fetches the page and returns the extracted text; each import costs one Firecrawl
  > credit. Your key is held in this tab's memory only, is never written to browser storage, and is
  > erased when you close the tab or choose Forget key.

- Submit calls
  `importWebArticle(url, { metadata: completeImportMetadata(draft), fetcher: createFirecrawlFetcher({ key: () => store.peek() }), signal })`.
- `ImportMetadataFields` gets `rightsPreface` and `sourceUrl={{ readOnly: true, note: … }}` from Task
  7, with the draft's `sourceUrl` kept in sync with the URL box.
- The publisher nudge is computed from the typed URL's hostname: `libretexts.org` and subdomains,
  `openstax.org`, and the Pressbooks patterns. **Read them from an existing list rather than
  retyping one** — `worker/allowlist-hosts.ts` has `PRESSBOOKS_PATTERNS` and `PUBLISHER_PATTERNS`; if
  they are not importable from `src/` without dragging Worker code in, put the hostname test in
  `src/sources/` beside the catalogs and note in a comment which list it mirrors. Do not duplicate a
  list silently.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/components/WebArticleImporter.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/components/WebArticleImporter.tsx src/components/WebArticleImporter.test.tsx
git commit -m "feat: add the web page importer panel and its pre-request disclosure"
```

---

### Task 9: Prove the key does not escape — storage, errors, findings, and what is rendered

Issue 12's second criterion says the key is memory-only, excluded from persistence and logs, and
removable immediately. Tasks 3, 6 and 8 assert pieces of that in passing. This task **proves** it
adversarially, in one file, against every persistence path this repository actually has.

**The persistence paths, enumerated before anything is asserted** (`grep -rn
"localStorage|sessionStorage|indexedDB|document.cookie" src worker`, tests excluded — three hits,
plus one the grep cannot see):

1. **IndexedDB** — `src/canvas/idb.ts`, whose own header comment calls it *"the one place this app
   writes to disk."* Holds the Canvas base URL and the push journal.
2. **`localStorage`** — one key, the theme, `src/shell/useTheme.ts`.
3. **Cookies** — none. `document.cookie` appears nowhere outside tests.
4. **The service worker Cache API** — invisible to that grep because workbox writes it.
   `vite.config.ts:135-174` declares three `runtimeCaching` rules; two require `sameOrigin` and the
   third requires `request.mode === 'navigate'`, and workbox does not cache a `POST` at all. A
   cross-origin `POST` to `api.firecrawl.dev` therefore matches none of them. **Assert it anyway** —
   "provably not reached" and "asserted not reached" are different claims, and this is the one path a
   future runtime-caching rule could quietly start matching.
5. **Logs** — already closed: `grep -rn "console\." src worker` excluding tests returns nothing, and
   `wrangler.jsonc` sets `observability.enabled: false` with the comment *"Constraint 2: the relay
   writes nothing, including logs."* Nothing on this path reaches a Worker at all.

**Files:**
- Create: `src/import/web-key-containment.test.ts`
- Create or extend: `src/components/WebArticleImporter.test.tsx` (the rendered half)

- [ ] **Step 1: Write the failing test**

```ts
const SENTINEL = 'fc-SENTINEL-do-not-leak-0123456789'

/** Every write path this app has, watched at once. */
function watchStorage() {
  const writes: string[] = []
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { writes.push(`localStorage ${k}=${v}`) })
  vi.spyOn(indexedDB, 'open').mockImplementation(() => { writes.push('indexedDB.open'); throw new Error('not permitted in this test') })
  vi.spyOn(document, 'cookie', 'set').mockImplementation((v) => { writes.push(`cookie ${v}`) })
  // `caches` is absent in jsdom; define a spy so a future runtime-caching rule
  // that started matching this request would be caught rather than silently
  // ignored by a test that only ever asserted on undefined.
  const put = vi.fn()
  vi.stubGlobal('caches', { open: async () => ({ put, match: async () => undefined }) })
  return { writes, put }
}

test('no import, successful or failed, writes the key anywhere', async () => {
  const { writes, put } = watchStorage()
  const key = createFirecrawlKeyStore()
  key.hold(SENTINEL)
  const responses = [
    okEnvelope,                                     // success
    { status: 401, body: { success: false } },      // bad key
    { status: 429, body: { success: false } },      // rate limited
    'network-error',                                // CORS/offline
    { status: 200, body: notFoundInside200 },       // the 404-in-200 envelope
  ]
  for (const response of responses) {
    await importWebArticle('https://example.com/a', {
      metadata,
      fetcher: createFirecrawlFetcher({ key: () => key.peek(), fetch: fakeFetchFor(response) }),
    }).catch(() => {})
  }
  expect(writes.filter((w) => w.includes(SENTINEL))).toEqual([])
  expect(put).not.toHaveBeenCalled()
  // And the theme write still happens somewhere in this app, so the spy works.
  localStorage.setItem('theme', 'dark')
  expect(writes).toContain('localStorage theme=dark')
})

test('the key appears in no thrown message, no finding, and no request url', async () => {
  const key = createFirecrawlKeyStore()
  key.hold(SENTINEL)
  for (const response of everyFailureRow) {
    const outcome = await importWebArticle('https://example.com/a', {
      metadata, fetcher: createFirecrawlFetcher({ key: () => key.peek(), fetch: recordingFetch(response) }),
    }).then((result) => result, (error: unknown) => error)
    if (outcome instanceof Error) {
      expect(messageOf(outcome)).not.toContain(SENTINEL)
      // Also assert the error is not carrying it in a property a logger would
      // reach: an `Error` with `{ cause: response }` would pass a message check
      // and still leak through `JSON.stringify` or a devtools expansion.
      expect(JSON.stringify(outcome, Object.getOwnPropertyNames(outcome))).not.toContain(SENTINEL)
    } else {
      for (const finding of outcome.report.findings) expect(finding.message).not.toContain(SENTINEL)
      expect(JSON.stringify(outcome)).not.toContain(SENTINEL)
    }
    expect(recordedRequestUrls.join('|')).not.toContain(SENTINEL)
  }
})

test('forget clears the key from memory, so the next import never reaches the network', async () => {
  let called = 0
  const key = createFirecrawlKeyStore()
  key.hold(SENTINEL)
  key.forget()
  await expect(importWebArticle('https://example.com/a', {
    metadata,
    fetcher: createFirecrawlFetcher({ key: () => key.peek(), fetch: async () => { called += 1; return new Response('{}') } }),
  })).rejects.toThrow(/Firecrawl API key/)
  // The assertion that distinguishes "cleared" from "cleared the form field":
  // a stale captured key would have produced a request.
  expect(called).toBe(0)
})
```

And, in `WebArticleImporter.test.tsx`, the rendered half:

```tsx
test('nothing rendered ever contains the key, including after a failure', async () => {
  // Error reporting is the classic leak path: `messageOf` returns
  // `error.message` verbatim and the panel renders it into `role="alert"`.
  render(<WebArticleImporter onImported={() => {}} fetch={failingFetch} />)
  ...type SENTINEL into the key field, submit, await the alert...
  const rendered = document.body.textContent ?? ''
  // The masked input's VALUE is not text content, and that is the point: it is
  // in the DOM as a value, nowhere as visible or accessible text.
  expect(rendered).not.toContain(SENTINEL)
  expect(screen.getByRole('alert').textContent).not.toContain(SENTINEL)
})

test('Forget key clears the held key, not merely the input', async () => {
  ...type the key, click Forget, submit, assert the "Enter your Firecrawl API key" refusal
  and that no request was attempted...
})
```

Injecting `fetch` into the component: give `WebArticleImporter` an optional `fetch` prop that
defaults to `globalThis.fetch`, exactly as `RelayDeps` does — `worker/relay.ts`'s header says *"Deps
are injected so tests run with no network."* Add it in Task 8 if it is not there already.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/web-key-containment.test.ts src/components/WebArticleImporter.test.tsx`
Expected: FAIL on the missing helpers first. **After they exist, any remaining failure is a real
leak — find and fix the leak, never loosen the assertion.**

- [ ] **Step 3: Fix whatever the tests find**

There is no new production code planned here. If a test fails, the likely causes, in order: an
`Error` constructed with `{ cause }` carrying the request; a finding built from the response; the key
placed on the URL; a `console.*` added during Task 6 (there are none in `src/` today and there must
be none after).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/ src/components/WebArticleImporter.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/web-key-containment.test.ts src/components/WebArticleImporter.test.tsx src/import/ src/components/
git commit -m "test: prove the firecrawl key reaches no storage, message, finding, or render"
```

---

### Task 10: Amend PRIVACY, README and SECURITY — BLOCKING

> **Commit with Task 11.** `PRIVACY.md:20` currently states that source bytes, parser output and
> benchmark measurements *"are not uploaded to Cloudflare, **Firecrawl**, or another service."* It
> names Firecrawl specifically. Shipping this feature makes that sentence false — and until Task 11
> adds the tab, no user can reach the feature, so amending it earlier would publish a notice
> describing a capability that does not exist. The only commit that is true both ways is the one that
> makes the tab reachable. Write this task, then Task 11, then commit once using Task 11's message.
>
> This is not follow-up work. A shipped feature that contradicts a published privacy statement is the
> exact failure the sibling project `libretexts-reader` opens its `CLAUDE.md` by correcting.

**Files:**
- Modify: `PRIVACY.md`
- Modify: `README.md`
- Modify: `SECURITY.md`

- [ ] **Step 1: Read `PRIVACY.md` in full and find every sentence this feature falsifies**

Do not stop at line 20. Three passages need attention, and the third is the one that is easy to miss:

1. **Line 20 (the quoted sentence).** Scope it to what it was written about — the *local* AnyDoc and
   PDF Inspector parsers. Something like: *"AnyDoc and PDF Inspector execute locally as WebAssembly;
   the bytes of a file you select, those parsers' output, and benchmark measurements are not uploaded
   to Cloudflare, Firecrawl, or another service."* The word "Firecrawl" stays, because it is still
   true of the local WASM packages — and the new paragraph immediately below must make clear that the
   *web-page import* is a different thing that does talk to Firecrawl's API.
2. **The opening paragraph** ("requests source content from supported publishers"). Web-page import
   requests content from **any host the user names**, through a third party. Say so.
3. **The last-but-one paragraph** ("There is no telemetry, advertising, tracking pixel, or remote AI
   inference service"). Still true — Firecrawl is not an inference service — but a reader arriving at
   it after the new paragraph must not be able to read it as "nothing leaves the browser". Add the
   qualifier that names the two remote hosts this app can now talk to on purpose: the Hugging Face
   model host and `api.firecrawl.dev`.

- [ ] **Step 2: Write the new paragraph — plainly what leaves the browser, when, and to whom**

It must state, in the user's terms and without hedging:

- **What leaves:** the URL you enter, and your Firecrawl API key.
- **When:** only when you press the import button on the Web page tab. Never on a keystroke, never
  in the background, and never for any other kind of import.
- **To whom:** `api.firecrawl.dev`, directly from your browser. **This app's relay is not involved
  and never sees your key.** No copy of the URL or the key reaches this project's Cloudflare account.
- **What comes back and where it goes:** the extracted text of that one page, which is normalized,
  previewed, audited and packaged in your browser like any other import.
- **What is kept:** the key is held in the tab's memory only, is never written to browser storage,
  and is erased when you close the tab or press Forget key. The fetched article is not persisted
  either.
- **Whose terms apply at the other end:** Firecrawl's own privacy terms govern what Firecrawl does
  with the URL and with the page it fetches. This project cannot speak for them.
- **One page, not a crawl:** one import is one request for one page. No links are followed.
- **The host table point** the sibling repo's `PRIVACY.md` makes: **any URL you paste is a host this
  app now talks to** — via Firecrawl, on your account.

- [ ] **Step 3: `README.md`**

The Release scope section lists exactly what the public app supports and is very specific. Add web
page import to that list, and state in the same register as the surrounding text: it requires the
user's own Firecrawl account and API key; the URL and key go from the browser directly to Firecrawl
and not through the relay; one URL becomes one page; images in a fetched article are not packaged and
block preparation with a visible placeholder; a PDF URL is refused and pointed at the Document tab.
Do not weaken the existing sentence *"The app never invents a URL or an open license"* — Task 7 makes
it more true, not less.

Check the rest of `README.md` for the same class of claim as `PRIVACY.md:20`. The line *"It runs the
fetch, repair, audit, and compliance queue in the browser. The server component is a stateless
Cloudflare Worker used only where browser CORS prevents a direct request"* is still accurate (the
Firecrawl call is browser-direct precisely because CORS does *not* prevent it) — but say so
explicitly rather than leaving a reader to work it out.

- [ ] **Step 4: `SECURITY.md`**

Add to *Security boundaries*, beside the Canvas-token bullet it parallels:

- The Firecrawl API key is entered by the user, sent only to `api.firecrawl.dev` in an
  `Authorization` header, never placed in a URL, and held in memory for the current tab only. It is
  never written to browser storage and needs no migration, because no release ever wrote one.
  `Forget key` clears the held key and the live field.
- The relay is not involved in web-page import and its allowlist is unchanged. A CORS or network
  failure is reported as such and never offers a relay route.
- A target URL is validated as public HTTPS before the request leaves the browser — the extraction
  service is itself an SSRF vector and was measured accepting and proxying `http://127.0.0.1:8080/`
  on 2026-08-29 — and the post-redirect URL is re-validated.
- The origin's status is checked: a 404 delivered inside a successful extraction is refused.
- A PDF URL is refused rather than remotely text-extracted, because the remote path produces none of
  the scanned-page signals the local PDF path uses to decide whether a page may publish.
- Fetched Markdown is untrusted and passes through the same sanitizer, the same 2 MiB limit and the
  same accessibility gate as pasted Markdown.

- [ ] **Step 5: Check for the same claim anywhere else**

Run: `grep -rn "not uploaded\|never leaves\|stay(s)\? (in\|on) (the \)\?\(device\|browser\)\|browser-local\|no third[- ]party" --include='*.md' --include='*.tsx' --include='*.ts' . | grep -v node_modules`
Then check in-app copy specifically: `ACCESSIBILITY.md`, `docs/DOCUMENT_IMPORT_SPEC.md`,
`docs/OPERATIONS.md`, and any component string promising locality —
`src/components/TextContentImporter.tsx` says *"The file stays in this browser"*, which stays true
because it is about the file input and must not be reused verbatim on the web panel. Report
everything found, amend what is now false, and say explicitly in the task report which files you
checked and found clean.

- [ ] **Step 6: No commit yet**

Proceed to Task 11 and commit both together, for the reason in this task's header.

---

### Task 11: The "Web page" tab, the publisher nudge, and the App wiring

> **Commits Task 10 as well.** See Task 10's header.

**Files:**
- Modify: `src/components/SourceBrowser.tsx`
- Modify: `src/components/SourceBrowser.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx` or `src/App.document.test.tsx` (whichever covers staging an import)

- [ ] **Step 1: Write the failing test**

```tsx
test('the Web page tab appears only when the app supplies a handler', () => {
  // Same shape as `onImportText`/`onImportDocument`: the tab list is built from
  // which handlers were passed, so a build that does not wire it has no tab
  // rather than a tab that throws.
  const { rerender } = render(<SourceBrowser onPick={() => {}} />)
  expect(screen.queryByRole('tab', { name: 'Web page' })).toBeNull()
  rerender(<SourceBrowser onPick={() => {}} onImportWeb={() => {}} />)
  expect(screen.getByRole('tab', { name: 'Web page' })).toBeInTheDocument()
})

test('the Web page tab and the LibreTexts box remain different verbs', () => {
  /*
   * The LibreTexts box (SourceBrowser.tsx:95-111) validates a host, derives a
   * title and calls `onPick` with a `BookRef` — no fetch, no key, no credit,
   * many pages, a known-open license. The Web page tab fetches once and
   * produces one `ImportResult`. This test asserts they do not become each
   * other: opening a LibreTexts URL still calls `onPick` and never `onImportWeb`.
   */
  ...
})

test('the nudge switches tabs only when its button is pressed', () => { ... })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/components/SourceBrowser.test.tsx`
Expected: FAIL — `onImportWeb` is not a prop and no `web` tab exists.

- [ ] **Step 3: Implement**

`SourceBrowser.tsx`: add `'web'` to `SourceTab`, `'Web page'` to `TAB_LABELS`, `onImportWeb` to the
props and to the conditional tab list beside `document` and `text`, and render
`<WebArticleImporter onImported={onImportWeb} onOpenLibreTexts={() => setTab('libretexts')} />`.

Update the section's intro sentence, which currently reads *"Search an OER publisher, upload a
document, or import text, Markdown, or HTML in this browser"* — it enumerates the sources and is now
incomplete. The web page clause must not claim "in this browser" of the fetch.

`App.tsx`: `onImportWeb={stageImportedContent}`. Nothing else changes — the staging path, the plan
editor, `prepareImportedContent`, the gate and the cartridge are all format-agnostic and already
take an `ImportResult`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/components/SourceBrowser.test.tsx src/App.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit Tasks 10 and 11 together**

```bash
npm run typecheck && npx vitest run
git add src/components/SourceBrowser.tsx src/components/SourceBrowser.test.tsx src/App.tsx src/App.test.tsx PRIVACY.md README.md SECURITY.md
git commit -m "feat: import one web page, and say in privacy what now leaves the browser"
```

---

### Task 12: One URL, one page — assert the absence, in the source and in the built bundle

Criterion 3 says the feature "does not expose a crawler, recursive site import, application relay, or
hidden server fallback." That is a claim about what does **not** exist, so it is asserted the way
`scripts/smoke-dist.mjs` already asserts absence against the built bundle, rather than by testing
that crawling does not happen.

**Files:**
- Create: `src/import/web-endpoints.test.ts`
- Modify: `scripts/smoke-dist.mjs`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs'

const FORBIDDEN = ['/v2/crawl', '/v2/map', '/v2/search', '/v2/batch', '/v2/agent'] as const

test('the web import modules name one firecrawl endpoint and no other', () => {
  /*
   * Four independent reasons this feature cannot crawl, of which this is the
   * first: one endpoint is named. The others are structural and are asserted
   * elsewhere — `formats: ['markdown']` means the link set is never received
   * (Task 6), `importText` emits a one-element `sections` array (Task 4), and
   * this path reaches `ImportPlanEditor` rather than `ChapterPicker`, so there
   * is no second network request in it at all (Task 11).
   */
  for (const file of ['web.ts', 'firecrawl.ts']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
    for (const path of FORBIDDEN) expect(source).not.toContain(path)
  }
  expect(readFileSync(new URL('./firecrawl.ts', import.meta.url), 'utf8')).toContain('/v2/scrape')
})

test('the web import path never mentions the relay', () => {
  // Not a style rule. Routing this key through the app's relay would put a
  // user's vendor credential on this project's infrastructure and reverse the
  // documented posture in `worker/relay.ts`: "Allowlists destination hosts so
  // this cannot become an open proxy."
  for (const file of ['web.ts', 'firecrawl.ts']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
    expect(source).not.toMatch(/['"`]\/relay/)
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/web-endpoints.test.ts`
Expected: it should PASS immediately if Tasks 5 and 6 were written correctly. **That is the point of
writing it late**, and it is the one test in this plan that is allowed to be green on first run —
prove it can fail by temporarily adding `/v2/crawl` to a comment in `web.ts`, watching it fail,
and reverting. Record that you did.

- [ ] **Step 3: Add the same check to the built bundle**

In `scripts/smoke-dist.mjs`, beside the existing absence checks, scan every `dist/assets/*.js` for
the five forbidden path strings and fail on any hit. Also require that `/v2/scrape` **is** present in
at least one chunk — a check that can pass because the code was tree-shaken out entirely is not a
check. Comment both halves.

- [ ] **Step 4: Run the built check**

Run: `npm run build && npm run test:dist`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/web-endpoints.test.ts scripts/smoke-dist.mjs
git commit -m "test: assert one scrape endpoint and no crawler in source and in the bundle"
```

---

### Task 13: End to end in a real browser — placeholders, blockers, audited-byte parity

Three properties a jsdom assertion about a finding does not demonstrate. Criterion 6 is the last one.

**Files:**
- Create: `src/import/web.browser.test.ts`
- Create: `src/import/testing/firecrawl-fixture.ts`

- [ ] **Step 1: Capture a real response as a fixture**

`src/import/testing/firecrawl-fixture.ts` holds **captured real envelopes**, not invented JSON — the
design's failure table was built from live responses on 2026-08-29 and the tests should use those
shapes. At minimum: one successful article containing at least two images and one relative link; the
`example.com/definitely-not-here-404` envelope, which is HTTP 200 with `success: true`, a full
markdown body, `metadata.statusCode: 404` and `metadata.error: "Not Found"`; and the `403` envelope
with the vendor's typeform text in it, so the "never shown" assertion has real text to not show.

Trim the article body to something readable — the Wikipedia markdown measured 268,645 characters —
but **do not hand-edit the metadata**, and record in a header comment which URL each was captured
from and on what date.

- [ ] **Step 2: Write the tests**

```ts
test('every refused image leaves both a blocker and a visible placeholder', async () => {
  const result = await importWebArticle(FIXTURE_URL, { metadata, fetcher: fixtureFetcher('article') })
  const html = result.work.sections[0]!.html
  for (const alt of ['A leaf cross-section', 'The Calvin cycle']) {
    expect(html).toContain(`[Embedded image: ${alt}]`)
  }
  expect(result.report.findings).toContainEqual(
    expect.objectContaining({ code: 'import-image-unavailable', severity: 'blocker' }),
  )
})

test('a fetched article with images cannot be prepared', async () => {
  // The finding is not the enforcement. `ImportPlanEditor` disables the confirm
  // control on `blockers.length > 0`, and that one `disabled` attribute is the
  // whole enforcement point — so this asserts the control.
  ...render ImportPlanEditor with the draft, assert the prepare button is disabled...
})

test('a fetched article exports the exact bytes the gate audited', async () => {
  const result = await importWebArticle(FIXTURE_URL, { metadata, fetcher: fixtureFetcher('article-no-images') })
  const confirmed = confirmImport(result, createImportDraft(result).plan, metadata)
  const compiled = await compileAndAuditChapter(toChapter(confirmed.work), { profile: DOCUMENT })
  const entries = buildCartridge([compiled])
  for (const section of compiled.sections) {
    expect(new TextDecoder().decode(entryFor(entries, section).data)).toContain(auditedHtml(section))
  }
})

test('the 404 that arrives inside a 200 never reaches the plan editor', async () => { ... })
```

Follow `src/import/packaged-cartridge.browser.test.ts` for the pipeline calls and the entry lookup
rather than inventing a second way to build a cartridge.

- [ ] **Step 3: Run them**

Run: `npx vitest run --project browser src/import/web.browser.test.ts`
Expected: PASS. A parity failure means something rewrote `html` after the gate — stop and find it; do
not relax the assertion.

- [ ] **Step 4: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/web.browser.test.ts src/import/testing/firecrawl-fixture.ts
git commit -m "test: prove a fetched article marks its images and ships its audited bytes"
```

---

### Task 14: Close issue 12

**Files:**
- Modify: `.scratch/document-import/issues/12-import-url-with-firecrawl.md`
- Modify: `.scratch/document-import/map.md`

- [ ] **Step 1: Tick the six criteria, each with the file and test that closes it**

1. Disclosure before proceeding — `WebArticleImporter.tsx`, `WebArticleImporter.test.tsx`.
2. Memory-only, excluded from persistence and logs, Forget — `firecrawl-key.ts`,
   `web-key-containment.test.ts`.
3. One explicit URL, no crawler/recursion/relay/server fallback — `web-endpoints.test.ts`,
   `smoke-dist.mjs`.
4. Untrusted output through the controlled normalization policy — `text.ts`'s `web` variant reaching
   `sanitizeImportedMarkdown`, `text.test.ts`.
5. Auth, quota, CORS, timeout, cancellation, unsupported-content and provider errors —
   `firecrawl.test.ts`, `web.test.ts`.
6. Provenance and the full preview/audit/plan/export workflow — `web.browser.test.ts`.

- [ ] **Step 2: Write the `## Answer`**

Record: that the fetch route is browser-direct Firecrawl with the user's own key and **why** (abuse
liability, not payment); that Keyless was verified to work and rejected anyway; that the seam exists
for a second, self-hosted extractor and everything downstream of it is shared; that a 404 arrives
inside a `success: true` HTTP 200 and only `metadata.statusCode` reveals it; that `parsers: []` is
what stops a PDF being silently text-extracted; that the target URL is fenced before the request
leaves the browser because the service itself proxied `http://127.0.0.1:8080/`; that images are
refused with both a finding and a placeholder by inheritance from `markup.ts`; and the residuals in
`## Open questions` below.

Set `Status: resolved`.

- [ ] **Step 3: Move the frontier in `map.md`**

- [ ] **Step 4: Commit**

```bash
npm run typecheck && npx vitest run
git add .scratch/document-import/
git commit -m "docs: resolve issue 12 and record the fetch-route reasoning"
```

---

## Open questions

Settled here, with the evidence, so an implementer does not re-open them:

- **(design Q1) Whether an external image is refused or left external.** **Settled: refused on this
  path, and `markup.ts` is not changed.** The design flagged that `anydoc-html.ts:202` emits
  `<img src>` for a public-host external image with an `external-image` warning while `markup.ts`
  refuses every image, and called the two importers disagreeing. Read closely, they are not
  disagreeing about external images — they are in different states of a shipped rollout. In
  `anydoc-html.ts` an image usually HAS bytes and the normal outcome is packaging; the external
  branch is the one case where there are no bytes to package and the reference is all there is. In
  `markup.ts` **no** markup image can be packaged yet at all — README and `SECURITY.md` both say so
  in as many words ("preparation remains blocked until controlled asset packaging ships") — so
  permitting external references there would not add a case, it would make hotlinking the *only*
  outcome for every markup image. That is a different decision, and a much larger one.
  On the merits it is also the right answer for a fetched article specifically: a Canvas page whose
  pictures are hotlinked from an arbitrary publisher rots when they reorganise and makes a request
  from every student's browser to a host neither the instructor nor this app vetted, at a scale the
  DOCX case never reaches (a 40-image Wikipedia page). And there is nothing to package: Firecrawl
  returns no image bytes, and fetching them from the browser is host-by-host luck —
  `upload.wikimedia.org` and `cdn.arstechnica.net` answer `access-control-allow-origin: *`, most
  hosts do not, and a feature that silently keeps some pictures and drops others is worse than one
  that consistently drops all of them.
  **What the plan does about it:** Task 4 pins the web path's image behaviour with its own test, so
  that a future change to `markup.ts`'s image branch cannot silently change what a fetched article
  publishes without a red test naming this decision. Note that the fence claim depends on this: the
  web path inherits `isPublicNetworkUrl` **because** it enters `markup.ts`, and if markup images were
  ever permitted the fence would have to move to the gate as
  `publisher-url-import-not-pursued.md` proposed. **Escalate when markup asset packaging ships**:
  at that point the web path must be re-decided explicitly rather than inheriting the change.
- **(design Q2) Firecrawl Keyless.** Rejected. See the design amendment and Task 1.
- **(design Q3) How much slack the client deadline should have over the vendor's 60 000 ms
  `timeout`.** **Settled: none — they are equal, and the same constant is both sent and armed.** The
  design offered "equal, or larger by an invented margin", and this plan's Global Constraints forbid
  the second: a margin with nothing behind it is a bare literal. Equal means the client may cancel a
  request the vendor was about to answer, and that is accepted, because the vendor was asked for a
  60-second budget and a request that exceeds it has already failed on the vendor's own terms. The
  residual is real: if users report timeouts that were charged a credit, run the design's experiment
  (twenty slow, uncached, JS-heavy pages with `maxAge: 0`, record the distribution) and size a margin
  from the measurement.
- **(design Q6) Cache: disclose or defeat.** **Settled: disclose.** `maxAge` keeps the vendor's
  documented 48-hour default and a warning finding names `cachedAt` (Task 5). Sending `maxAge: 0`
  would spend a credit on every import *and on every retry after a validation failure*, buying
  freshness nobody asked for; a user who needs a fresh copy after a disclosed cache hit is better
  served by being told the copy is two days old than by being charged for a guarantee silently.
- **(design Q7) Whether to show credit cost before the request.** **Settled: state the cost, do not
  query a balance.** The pre-request disclosure says each import costs one Firecrawl credit — verified
  (`creditsUsed: 1`) and true regardless of plan. A balance endpoint is not used: it was never
  checked whether one is reachable cross-origin, and a second authenticated call before every import
  would double the key's exposure to buy a number the vendor's own dashboard already shows.

**Escalate rather than guess:**

1. ~~**Is there a near-empty extraction floor, and what is it?**~~ **ANSWERED 2026-08-29** — see
   [`decision-extraction-floor.md`](decision-extraction-floor.md). The two escalations were assumed
   to share an answer; they share a question but not the available evidence, which is what decides
   it. A PDF page can be measured against its own document's other pages; one article has no such
   distribution. So: no absolute character count here either. Preferred route is to compare the
   extracted body against the page's own `metadata.description` — a body shorter than its own summary
   is incoherent — but **whether Firecrawl returns `description` is UNVERIFIED**; the probe recorded
   `statusCode`, `error`, `sourceURL`, `url` and `contentType` and never established it. Settle it
   with the Task 2 probe. If no description is returned, **disclose rather than judge**: report the
   extracted word count as a neutral note, the same move issue 09 made with packaged bytes. Warning
   only, never a blocker. Do NOT detect this by matching English phrases — that is the same defect
   this plan already records as a residual for `encrypted`/`malformed`.
2. **Should `open-license` require a named licence?** `validateImportMetadata` requires
   `licenseName` only when `licenseUrl` is given, so `open-license` naming nothing is legal on
   **every** import path today, not just this one. Task 7 discloses it on the web path with a
   warning; tightening the validator changes publisher imports, document imports and paste imports
   alike, and that is a product and legal decision. Do not tighten it as part of this issue.
3. **Whose responsibility is the target site's terms?** A user fetches an arbitrary site through a
   third party. Whether this app should say anything about `robots.txt`, terms of service, or
   paywalled content is a human's call and is not legal advice this plan can give. What Task 7 does
   say is a statement of fact — extraction is not a licence — and it stops there deliberately. If a
   stronger statement is wanted, it needs a human to write it.
4. **Is a warning the right severity for a disclosed cache hit or redirect?** Both are warnings here.
   Neither has evidence behind the choice beyond "it should not stop an import that the user can see
   and judge". If real use shows instructors publishing two-day-old copies of pages that changed, the
   answer may be different, and the finding is already in place to be upgraded.
5. **The live CORS probe is a snapshot, not a promise.** Firecrawl documents no CORS policy. Task 2
   proves today's behaviour and `npm run verify:firecrawl-cors` re-proves it on demand, but nothing
   makes it run on a schedule and it is deliberately not in `npm test`. Whether it belongs in a
   periodic check is an operations decision for `docs/OPERATIONS.md`.
