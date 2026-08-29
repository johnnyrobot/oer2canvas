# Import a publisher URL — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user paste `https://openstax.org/books/biology-2e/pages/1-1-the-science-of-biology`
(or a LibreTexts or Pressbooks page address) and import exactly that page, with authors and licence
recovered from the bundled catalogs, through the same fetch → compile → audit → gate → cartridge path
the catalog browse already uses. Close the two failure modes that make that path unsafe on a pasted
url: an `<img>` pointing at a private network address, and a 429 that is never waited on.

**Architecture:** Almost nothing new. `src/sources/publisher-url.ts` is an **address resolver**, not a
content adapter: it turns a url into `{ source, BookRef, one-section outline }` and hands that to the
`fetchChapter` that already exists for each publisher. Because the outline has one section and no
`kind: 'libre-tree'`, `createLibreTextsClient().fetchChapter` skips `visit` and issues exactly one
upstream request — the no-crawl path is reachable today and merely has no caller. The result is a
`Chapter`, compiled under its own publisher profile, so the audited-bytes-are-published-bytes
invariant is not re-established but never disturbed. The image fence is added one layer lower than
the design proposed: in `repairAllowlist`, where commit `f52b2e5` already built the blocker channel
(`AllowlistResult.strippedUrls` → `enforceGate` → `allowlist-stripped-url:<tag>.<attr>`). That
removes the need for the `Sink.blocker` channel the design asked for. See Task 2.

**Tech Stack:** TypeScript, React 19, Vite, Vitest (jsdom `unit` + Chromium `browser` projects).

**Spec:** [`17-import-publisher-url-design.md`](17-import-publisher-url-design.md)
**Issue:** [`issues/17-import-publisher-url.md`](issues/17-import-publisher-url.md)
**Defect folded in:** #4 in
[`pre-existing-defects-found-2026-08-28.md`](pre-existing-defects-found-2026-08-28.md)

## Global Constraints

- **The relay contract is untouchable.** `worker/relay.ts` forwards bytes and NEVER parses, inspects
  or rewrites a response body; it writes nothing, logs no header, strips `Set-Cookie`, and refuses a
  foreign `Origin`. `worker/relay.test.ts:69` pins that it "never reads the upstream body — by any of
  the five ways of reading one". Nothing in this plan may change that. **No file under `worker/` is
  modified by any task in this plan.**
- **Do not widen `worker/allowlist-hosts.ts`.** The design verified every host the catalogs name is
  already forwardable — `openstax.org`, `assets.openstax.org`, `/(^|\.)libretexts\.org$/`, and all
  fifteen Pressbooks networks via `/(^|\.)pressbooks\.pub$/` plus four exact hosts. A url the relay
  will not forward is a url this feature does not import. **If a task appears to need a new host,
  stop and escalate; do not add one.**
- **Fetched publisher HTML is UNTRUSTED and passes through the EXISTING sanitization** — publisher
  extraction → `compileSection` (`DOMParser` into a detached document, no script, no subresource) →
  `enforceGate` → `validateAllowlist` → audit. No new normalization path may be introduced, and
  publisher content must NOT be routed through `sanitizeImportedHtml` (`src/import/markup.ts`), which
  removes every image outright, nor through the issue-10 page-plan editor, which would compile
  OpenStax under the `DOCUMENT` profile and orphan every caption, xref and image hash
  (`src/engine/compile/context.ts:145-157`).
- **The bytes the accessibility gate audited are the bytes published.** `enforceGate` audits
  `allow.html` and returns it; `auditedHtml` returns `section.gate?.html ?? section.html` and
  `buildCartridge` writes those bytes verbatim. Any change that rewrites html after the gate is wrong
  by construction.
- **Every refused image keeps BOTH a finding and a visible `[Embedded image: alt]` placeholder.** That
  exact wording is shared by `src/import/parsers/anydoc-html.ts:263` and `src/import/markup.ts`, which
  commit `0ddeeea` unified. Task 2 makes the gate speak the same words. Nothing may publish with a
  silent hole.
- **Images stay external references.** No publisher image bytes are fetched, sniffed or packaged.
  `prepareAssets`, `PARSER_PROBE_LIMITS` and `maximumAssetPixels` govern bytes this app packages; URL
  import packages none, so they are deliberately not consulted. This is what keeps the same page
  producing the same cartridge by either route, and it is why the relay's 60-request budget is not
  spent on media.
- **One url is one page.** No task may introduce a crawl, and Task 5's call-count assertion is the
  test that proves it.
- **Every number is read from an existing constant or justified in a comment; never a bare literal.**
  New constants introduced by this plan: `SOURCE_REQUEST_TIMEOUT_MS` and `MAX_RETRY_AFTER_MS`
  (Task 3), both justified against the relay's own limiter.
- **Do not consume the reserved `'web'` / `'firecrawl'` members** of `ImportedFormat`,
  `ImportProvenance.kind` and `ImportReport.parser` (`src/import/types.ts:5,22,66`). They belong to
  issue 12, which is deferred, not cancelled.
- House style: substantial comments explaining WHY. **Every factual claim in a comment must be true
  of the source it names** — if you cite a file and line, open it first.
- Run `npm run typecheck && npx vitest run` before every commit; the ENTIRE suite must pass
  (currently 110 files / 1071 tests). Two known pre-existing intermittent flakes,
  `src/components/DocumentImporter.browser.test.tsx` and `src/components/TextContentImporter.test.tsx`
  — rerun and say so; do not "fix" them.

---

### Task 1: Restructure the issue tracker before any code

**Done on the planning branch; verify rather than redo.** Recorded here because the rest of the plan
references the files it creates, and because an implementer arriving at a repo where it was reverted
must know what to restore.

**Files:**
- Create: `.scratch/document-import/issues/17-import-publisher-url.md`
- Rename: `.scratch/document-import/12-import-url-design.md` →
  `.scratch/document-import/17-import-publisher-url-design.md`
- Modify: `.scratch/document-import/map.md`,
  `.scratch/document-import/issues/12-import-url-with-firecrawl.md`,
  `.scratch/document-import/issues/13-release-core-document-importer.md`

**Interfaces:** none — documentation only. There is no failing test to write first because there is
no behaviour here; this is the one task in this plan that is not TDD, and it is stated rather than
disguised.

- [ ] **Step 1: Confirm the split is in place**

`git log --oneline -1` should show the plan commit. Check that issue 12 reads `**Status:** deferred`
with its `Deferred 2026-08-29.` paragraph intact, that its six original criteria are UNCHANGED, that
`map.md` lists 17 with `Blocked by: —` and 13 with `09, 10, 11, 17`, and that issue 13's prose
`Blocked by:` line names 17 rather than 12.

- [ ] **Step 2: Confirm the rename left no dangling reference**

```bash
grep -rn "12-import-url-design" . --exclude-dir=node_modules --exclude-dir=.git
```
Expected: no matches. The design file had no inbound references when it was renamed, which is why
renaming was chosen over leaving it: a `12-` prefix on issue 17's design would have been the only
thing in the tree still asserting the two issues were the same work.

---

### Task 2: Fence a private-address image at the gate, with a placeholder

`isPublicNetworkUrl` is applied by `src/import/markup.ts:128` and
`src/import/parsers/anydoc-html.ts:202` and by **nothing on the publisher path**. `validateAllowlist`
checks `img: { src: HTTP_SCHEMES }`, and `http://169.254.169.254/latest/meta-data/` is an ordinary
`http:` url — scheme-ALLOWED. So publisher html can make the user's own browser fetch a private
address, during preview (`ChapterView.tsx:73`, `dangerouslySetInnerHTML`) and during the audit
iframe. That is true today, before this feature; a pasted url widens who can reach it, because the
catalogs are curated lists of book roots and a url is not.

**Why the gate and not a compile step with a new `Sink.blocker` channel.** The design proposed the
latter and called it "the only new plumbing this design asks for". Since it was written, `f52b2e5`
built the channel one layer down: `AllowlistResult.strippedUrls` carries `tag.attr` entries and
`src/engine/gate.ts` turns each into a blocker with id `allowlist-stripped-url:<tag>.<attr>`. Four
reasons to use it:

1. **Gate blockers are the ones the whole app already honours.** `isPublishable`
   (`src/contracts/index.ts:115-120`) and `src/shell/plan.ts:194-199` read
   `gate.conformance.blockers`. A second blocker channel means every consumer must remember to read
   both — and `0b77d74` on this very branch is the evidence of what happens when one consumer misses
   a gate.
2. **The gate is where every path converges**, so one fence covers publisher, markup and anydoc
   content at once. The gap is a publisher-path defect today, not only under url import.
3. **It closes the design's open question 8** — `filterAttrs` dropping an `img.src` and publishing
   `<img alt="…">` with no source — in the same change and the same words, because a stripped `src`
   becomes a placeholder instead of a sourceless element.
4. **No layering violation.** `src/engine/allowlist.ts` already imports `FILEBASE` and
   `isPackagedReference` from `../import/assets`; importing `isPublicNetworkUrl` from
   `../import/common` follows an existing edge rather than creating one.

Scope: fence the attributes a browser **fetches without user action** — `img.src`, `iframe.src`,
`embed.src`/`pluginspage`, `audio.src`, `video.src`/`poster`, `source.src`/`srcset`, `track.src`,
`object.data`/`codebase`/`classid`. Do NOT fence `a.href`, `area.href`, `blockquote.cite` or `q.cite`:
those are navigations, and blocking a link to an intranet address in a legitimately authored course
page is a false positive with no fetch behind it. Only `img` gains the placeholder, because that is
the element the house wording exists for.

**Files:**
- Modify: `src/engine/allowlist.ts` (`filterAttrs` ~line 470; `finalizeElement` ~line 561)
- Test: `src/engine/allowlist.test.ts`, `src/engine/gate.test.ts`

**Interfaces:**
- Consumes: `isPublicNetworkUrl(url: URL): boolean` from `src/import/common.ts`.
- Produces: no exported API change. `AllowlistResult.strippedUrls` gains entries for private-address
  subresource urls; `AllowlistResult.html` replaces a src-stripped `<img>` with
  `<span>[Embedded image: alt]</span>`.

- [ ] **Step 1: Write the failing tests**

In `src/engine/allowlist.test.ts`, beside the existing URL-protocol-gating block:

```ts
// ── Private-network fence on fetched subresources ────────────────────────────

test('an img pointing at a private network address is refused, with a placeholder', async () => {
  // Scheme-ALLOWED: this is ordinary http, so the B.4 scheme check passes it.
  // The address is what makes it unsafe, and nothing on the publisher path
  // checked the address until now.
  const r = await validateAllowlist('<img src="http://169.254.169.254/latest/meta-data/" alt="A diagram">');
  expect(r.html).toBe('<span>[Embedded image: A diagram]</span>');
  expect(r.strippedUrls).toContain('img.src');
});

test('the placeholder carries the alt text and escapes it', async () => {
  const r = await validateAllowlist('<img src="http://localhost:8080/x.png" alt="a &lt;b&gt; c">');
  expect(r.html).toBe('<span>[Embedded image: a &lt;b&gt; c]</span>');
});

test('an alt-less refused image still leaves a visible marker', async () => {
  const r = await validateAllowlist('<img src="http://10.0.0.1/x.png">');
  expect(r.html).toBe('<span>[Embedded image]</span>');
});

test('every private-address form is caught, not just rfc1918', async () => {
  for (const src of [
    'http://127.0.0.1/x.png',
    'http://[::1]/x.png',
    'http://intranet/x.png',          // single-label host
    'http://wiki.local/x.png',
    'http://files.internal/x.png',
    'http://user:pw@openstax.org/x.png', // credentials in the url
  ]) {
    const r = await validateAllowlist(`<img src="${src}" alt="x">`);
    expect(r.html, src).toBe('<span>[Embedded image: x]</span>');
    expect(r.strippedUrls, src).toContain('img.src');
  }
});

test('an ordinary publisher image is untouched — the fence is a fence, not a ban', async () => {
  const html = '<img src="https://assets.openstax.org/oscms/media/x.jpg" alt="A cell" width="600" height="400">';
  const r = await validateAllowlist(html);
  expect(r.html).toBe(html);
  expect(r.strippedUrls).toEqual([]);
});

test('a relative image src is left alone — it has no address to judge', async () => {
  // A schemeless value resolves against whatever page renders it. `absolutize`
  // has already made publisher urls absolute against `contentBaseUrl` by the
  // time the gate sees them, so a relative src here is not a publisher image
  // and the existing permissive relative bucket still owns it.
  const html = '<img src="../resources/a3f91c2e" alt="x">';
  expect((await validateAllowlist(html)).html).toBe(html);
});

test('a non-img subresource loses its url but is not replaced', async () => {
  // Only `img` has an agreed placeholder wording. The blocker is what stops
  // publication for the rest; inventing a span for an <iframe> would be
  // inventing content the house has no sentence for.
  const r = await validateAllowlist('<iframe src="http://192.168.0.1/admin" width="4"></iframe>');
  expect(r.html).toBe('<iframe width="4"></iframe>');
  expect(r.strippedUrls).toContain('iframe.src');
});

test('a link to a private address is NOT refused — it is a navigation, not a fetch', async () => {
  const html = '<a href="http://intranet.example.edu/policy">y</a>';
  expect((await validateAllowlist(html)).html).toBe(html);
});
```

Then revise the two existing expectations at `src/engine/allowlist.test.ts:113-114`. They currently
pin `<img alt="">` for a `data:` and a `file:` src. That was deliberate when written — `f52b2e5`
records it — but it pinned only half the rule: the finding existed, the visible marker did not. Change
them and say why in a comment:

```ts
test('disallowed URL schemes are stripped from href/src', async () => {
  expect((await validateAllowlist('<a href="javascript:alert(1)">y</a>')).html).toBe('<a>y</a>');
  expect((await validateAllowlist('<a href="vbscript:x">y</a>')).html).toBe('<a>y</a>');
  // An image that lost its src is a HOLE, and the house rule is that a hole is
  // both reported and visible. `f52b2e5` added the report (`strippedUrls` ->
  // an `allowlist-stripped-url:img.src` blocker); this is the visible half, in
  // `anydoc-html.ts`'s and `markup.ts`'s exact wording so all three paths
  // describe the same loss in the same words.
  expect((await validateAllowlist('<img src="data:image/png;base64,AAAA" alt="">')).html)
    .toBe('<span>[Embedded image]</span>');
  expect((await validateAllowlist('<img src="file:///etc/passwd" alt="">')).html)
    .toBe('<span>[Embedded image]</span>');
});
```

In `src/engine/gate.test.ts`, pin that the refusal actually blocks:

```ts
test('a private-address image blocks publication and names the attribute', async () => {
  const result = await enforceGate('<img src="http://169.254.169.254/x.png" alt="A diagram">', {
    validateAllowlist,
    audit: async () => ({ issues: [] }),
  });
  expect(result.badgeWithheld).toBe(true);
  expect(result.conformance.blockers.map((b) => b.id)).toContain('allowlist-stripped-url:img.src');
  // The AUDITED bytes are the bytes that would publish, and they carry the
  // placeholder rather than the private url.
  expect(result.html).not.toContain('169.254.169.254');
  expect(result.html).toContain('[Embedded image: A diagram]');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/engine/allowlist.test.ts src/engine/gate.test.ts`
Expected: FAIL — the private-address `<img>` survives verbatim with an empty `strippedUrls`, and the
`data:`/`file:` cases still serialize as `<img alt="">`.

- [ ] **Step 3: Add the fence to `filterAttrs`**

At the top of `src/engine/allowlist.ts`, beside the existing `../import/assets` import:

```ts
import { isPublicNetworkUrl } from '../import/common';
```

Above `URL_ATTRS`, add the subresource table:

```ts
/**
 * The url attributes a browser FETCHES on its own, with no user action.
 *
 * These get an address check on top of B.4's scheme check, because
 * `HTTP_SCHEMES` admits `http://169.254.169.254/` — a scheme-allowed url to a
 * link-local metadata service — and the publisher compile path applies
 * `isPublicNetworkUrl` nowhere. Both other untrusted-html importers apply it
 * (`src/import/markup.ts`, `src/import/parsers/anydoc-html.ts`); this closes
 * the third path, and closes it for everything that reaches the gate.
 *
 * `a.href`, `area.href` and the `cite` attributes are DELIBERATELY absent: a
 * link is a navigation the reader chooses, and refusing a link to an
 * institutional intranet address would be a false positive with no fetch
 * behind it.
 */
const FETCHED_SUBRESOURCE: Readonly<Record<string, ReadonlySet<string>>> = {
  img: new Set(['src']),
  iframe: new Set(['src']),
  embed: new Set(['src', 'pluginspage']),
  audio: new Set(['src']),
  video: new Set(['src', 'poster']),
  source: new Set(['src', 'srcset']),
  track: new Set(['src']),
  object: new Set(['data', 'codebase', 'classid']),
};

/**
 * True when a value names an address this app refuses to make the browser
 * fetch. Only ABSOLUTE urls are judged: a schemeless value is relative, and the
 * gate has no base url to resolve it against. That is not a hole on the
 * publisher path — `absolutize` (`src/engine/compile/steps/absolutize.ts`) has
 * already resolved every subresource against `contentBaseUrl` before the gate
 * runs, and a publisher's own host is by definition one the relay forwarded.
 */
function isRefusedAddress(value: string): boolean {
  try {
    return !isPublicNetworkUrl(new URL(value.trim()));
  } catch {
    return false; // not absolute -> relative -> the existing permissive bucket
  }
}
```

Change `filterAttrs`'s signature to report what THIS element lost, then apply the fence in the
url-attribute branch, after the packaged-reference interception and the scheme check:

```ts
function filterAttrs(tag: string, attrs: Attr[], stripped: Set<string>, lost?: Set<string>): Attr[] {
```

```ts
      } else if (!isSchemeAllowed(value, schemeSet)) {
        stripped.add(`${tag}.${name}`);
        lost?.add(name);
        continue;
      } else if (FETCHED_SUBRESOURCE[tag]?.has(name) === true && isRefusedAddress(value)) {
        /*
         * Scheme-allowed but address-refused. This branch is the only reason
         * the gate needs `isPublicNetworkUrl` at all: every url it catches is
         * ordinary `http:` or `https:` and sails through `isSchemeAllowed`.
         */
        stripped.add(`${tag}.${name}`);
        lost?.add(name);
        continue;
      }
```

Add `lost?.add(name)` to the packaged-reference `continue` above it too, so a malformed
`$IMS-CC-FILEBASE$` reference gets the same treatment as any other lost src.

- [ ] **Step 4: Replace a src-less image with the shared placeholder**

In `finalizeElement`, replace the `if (ALLOWED_TAGS.has(tag))` branch:

```ts
  if (ALLOWED_TAGS.has(tag)) {
    const lost = new Set<string>();
    const kept = filterAttrs(tag, node.attrs, stripped, lost);
    /*
     * An <img> that lost its src is a HOLE in the page: the element survives,
     * the picture does not, and `removedSemantic` cannot carry it because
     * nothing semantic was removed. `f52b2e5` made that hole REPORTED via
     * `strippedUrls`; this makes it VISIBLE, in the wording
     * `src/import/parsers/anydoc-html.ts` and `src/import/markup.ts` already
     * share (unified in `0ddeeea`), so all three paths describe the same loss
     * in the same words. Built as nodes, not a string, so the alt text is
     * escaped by the serializer rather than by hand.
     */
    if (tag === 'img' && lost.has('src')) {
      const alt = kept.find((a) => a.name === 'alt')?.value?.trim();
      out.push({
        type: 'element',
        tag: 'span',
        attrs: [],
        children: [{ type: 'text', text: `[Embedded image${alt ? `: ${alt}` : ''}]` }],
      });
      return;
    }
    out.push({ type: 'element', tag, attrs: kept, children: kids });
    return;
  }
```

The heading-shift branch above it keeps calling `filterAttrs(shiftedTag, node.attrs, stripped)` with
no `lost` set — a heading has no url attribute, so there is nothing for it to report.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run --project unit src/engine/ && npm run typecheck`
Expected: PASS. Other suites may assert on gated html containing `<img`. Where one does, check
whether its fixture image is a public https url (it should be untouched) or a data/file uri (it now
becomes a placeholder) and update the expectation to pin the NEW behaviour rather than deleting the
assertion. If a compile golden changes, read the diff before accepting it: only src-less images may
differ.

- [ ] **Step 6: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/engine/allowlist.ts src/engine/allowlist.test.ts src/engine/gate.test.ts
git commit -m "fix: refuse an image at a private network address, visibly"
```

---

### Task 3: Wait on a 429, bound a request, and refuse a non-page response

Defect #4, still open: `response()` in `src/sources/webbooks.ts:45` retries only on `status >= 500`,
so a **429** — the one status that says "wait and it will work", carrying the relay's own
`retry-after: 60` (`worker/relay.ts:315`) — throws immediately as `(HTTP 429)`. The relay's limiter is
`{ limit: 60, period: 60 }` (`wrangler.jsonc:35`), which a two-chapter import can reach in normal use.
Two neighbours belong in the same change: there is **no timeout anywhere in `src/sources/`**, and
`response()` never checks `content-type`, so a pasted `.pdf` url is fetched and `extractContent`
returns something meaningless.

**Files:**
- Modify: `src/sources/webbooks.ts` (`response` at 34-56; `responseText`; `responseJson`)
- Test: `src/sources/webbooks.test.ts`

**Interfaces:**
- Produces: exported `SOURCE_REQUEST_TIMEOUT_MS` and `MAX_RETRY_AFTER_MS`; `responseText` gains an
  optional `{ expect: 'html' | 'json' }`. No change to any extraction function.

- [ ] **Step 1: Write the failing tests**

```ts
import { MAX_RETRY_AFTER_MS, SOURCE_REQUEST_TIMEOUT_MS } from './webbooks'

test('a 429 with retry-after is waited on, not thrown', async () => {
  vi.useFakeTimers()
  try {
    const calls: string[] = []
    const fetcher = vi.fn(async (url: string) => {
      calls.push(url)
      return calls.length === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '1' } })
        : new Response('<html><body><p>ok</p></body></html>', {
            status: 200, headers: { 'content-type': 'text/html' },
          })
    }) as unknown as typeof globalThis.fetch

    const pending = createLibreTextsClient({ fetch: fetcher }).fetchChapter(book, oneSectionOutline)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(pending).resolves.toBeDefined()
    expect(calls).toHaveLength(2)
  } finally {
    vi.useRealTimers()
  }
})

test('a retry-after longer than the limiter window is capped, not obeyed', async () => {
  // A hostile or misconfigured upstream must not be able to park the import for
  // an hour. The cap is the relay limiter's own period.
  expect(MAX_RETRY_AFTER_MS).toBe(60_000)
})

test('a 429 with no retry-after still backs off rather than failing at once', async () => { /* … */ })

test('a request that never answers is abandoned at the timeout', async () => {
  vi.useFakeTimers()
  try {
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    })) as unknown as typeof globalThis.fetch
    const pending = createLibreTextsClient({ fetch: fetcher }).fetchChapter(book, oneSectionOutline)
    await vi.advanceTimersByTimeAsync(SOURCE_REQUEST_TIMEOUT_MS + 1)
    await expect(pending).rejects.toThrow()
  } finally {
    vi.useRealTimers()
  }
})

test("a caller's abort still wins over the timeout", async () => {
  // `AbortSignal.any` must not swallow the caller's signal: cancel is the
  // user's, and the timeout is ours.
  /* … assert the rejection is the caller's reason … */
})

test('a pdf served where html was expected is refused before parsing', async () => {
  const fetcher = vi.fn(async () => new Response('%PDF-1.7', {
    status: 200, headers: { 'content-type': 'application/pdf' },
  })) as unknown as typeof globalThis.fetch
  await expect(createLibreTextsClient({ fetch: fetcher }).fetchChapter(book, oneSectionOutline))
    .rejects.toThrow(/content type/i)
})

test('a json api answering with html is refused before JSON.parse', async () => {
  // The existing failure is `Source returned invalid JSON`, which blames the
  // parser for a response that was never json. Name the content type instead.
  /* … Pressbooks client, text/html body … */
})
```

Match the fixture and client-construction style the existing `webbooks.test.ts` uses; it already
injects a `fetch`, so do not invent a new harness.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/sources/webbooks.test.ts`
Expected: FAIL — the 429 throws on the first response, the hung request hangs forever (the timeout
test will hit vitest's own timeout, which is itself the failure), and the pdf is parsed as html.

- [ ] **Step 3: Add the two constants**

```ts
/**
 * How long one upstream request may take before it is abandoned.
 *
 * There is no timeout anywhere in `src/sources/` today, so a hung publisher
 * hangs the import until the browser gives up — indistinguishable, to the user,
 * from a slow network. 30s matches `parserTimeoutMs` in
 * `src/import/parser-limit-values.ts`, which is the budget this app already
 * decided a single slow step is worth; a publisher page that has not answered
 * in 30s is not going to.
 */
export const SOURCE_REQUEST_TIMEOUT_MS = 30_000

/**
 * The longest `retry-after` this client will honour.
 *
 * The relay's limiter is `{ limit: 60, period: 60 }` (`wrangler.jsonc`), and it
 * answers a refusal with `retry-after: 60` (`worker/relay.ts:315`) — so 60s is
 * exactly the window that produced the wait, and anything longer is a claim by
 * an upstream we do not control. Capping keeps a hostile or misconfigured
 * `retry-after: 86400` from parking an import for a day.
 */
export const MAX_RETRY_AFTER_MS = 60_000
```

- [ ] **Step 4: Honour the header, bound the request, check the type**

Rewrite `response()` keeping its existing 3-attempt shape:

```ts
/** Parse `retry-after` in either RFC 9110 form, capped. Returns undefined when absent or unusable. */
function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw.trim())
  const ms = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : Date.parse(raw) - Date.now()
  if (!Number.isFinite(ms) || ms < 0) return undefined
  return Math.min(ms, MAX_RETRY_AFTER_MS)
}

/** An abortable sleep: a 60s wait that ignored the user's cancel would be worse than not waiting. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    function onAbort() { clearTimeout(timer); reject(signal!.reason) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
```

In the loop, replace the `if (!result.ok)` branch and the fetch call:

```ts
      const bounded = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(SOURCE_REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(SOURCE_REQUEST_TIMEOUT_MS)
      const result = await fetcher(url, {
        headers: { accept: 'application/json, text/html;q=0.9' },
        signal: bounded,
      })
      if (!result.ok) {
        /*
         * A 429 is the ONE status that tells the client how long to wait, and
         * it was the one status never waited on: the old check retried on >=500
         * only, so the relay's own limiter (60 requests / 60s) produced an
         * immediate hard failure in ordinary two-chapter use. Waiting the
         * header's own interval is the difference between an import that
         * pauses and an import that dies.
         */
        if (result.status === 429 && attempt < 3) {
          await sleep(retryAfterMs(result) ?? attempt * 250, signal)
          continue
        }
        if (result.status < 500 || attempt === 3) {
          throw new Error(`Source request failed: ${url} (HTTP ${result.status})`)
        }
      } else {
        return result
      }
```

Then add the content-type guard where the body is consumed, so the check names whose response broke —
the shape `openstax.ts:118` already uses:

```ts
async function responseText(
  fetcher: typeof globalThis.fetch,
  url: string,
  signal?: AbortSignal,
  expect: 'html' | 'json' = 'html',
): Promise<string> {
  const res = await response(fetcher, url, signal)
  /*
   * The relay forwards `content-type` unchanged, so this is readable and is the
   * cheapest way to refuse a pasted `.pdf` or image url BEFORE `extractContent`
   * turns its bytes into meaningless html. A missing header is tolerated: some
   * publisher endpoints omit it, and refusing on absence would break imports
   * that work today.
   */
  const type = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  const acceptable = expect === 'json'
    ? ['application/json', 'text/json']
    : ['text/html', 'application/xhtml+xml']
  if (type !== undefined && type !== '' && !acceptable.includes(type)) {
    throw new Error(`Source returned an unusable content type for ${url}: ${type}`)
  }
  return res.text()
}
```

Pass `'json'` from `responseJson`. Leave `signal?.throwIfAborted()` where it is.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run --project unit src/sources/ && npm run typecheck`
Expected: PASS. Existing tests that build a `Response` with no `content-type` are unaffected by
design — re-read the guard above if one fails, and fix the guard, not the test.

- [ ] **Step 6: Run the whole suite, record the defect as closed, and commit**

Mark #4 fixed in `.scratch/document-import/pre-existing-defects-found-2026-08-28.md`, with the commit
sha, and update its status line at the top.

```bash
npm run typecheck && npx vitest run
git add src/sources/webbooks.ts src/sources/webbooks.test.ts .scratch/document-import/
git commit -m "fix: wait on a 429, bound a source request, refuse a non-page response"
```

---

### Task 4: Classify a publisher url without touching the network

The half of resolution that needs no fetch: which publisher, which book, is this a page or a
container, and is it on a host this app will even try. Kept separate from Task 5 so every refusal is
provable in a test that cannot make a request.

**Files:**
- Create: `src/sources/publisher-url.ts`
- Create: `src/sources/publisher-url.test.ts`

**Interfaces:**
- Consumes: `openStaxCatalog()` (`src/sources/openstax-catalog.ts` — bundled, keyed on the BARE book
  slug), `pressbooksNetworks` (`src/sources/catalogs.ts`), and `BookRef[]` for LibreTexts/Pressbooks
  whose `slug` is a full HTTPS book url (`isBookRef` enforces `/^https:\/\//`,
  `src/sources/catalogs.ts:20`).
- Produces:

```ts
export type PublisherUrlTarget =
  /** One leaf page. The import path. */
  | { kind: 'page'; source: PublisherSourceId; book: BookRef; pageSlug: string; pageUrl: string
      /** Absent when no catalogued book matched; the caller must collect rights. */
      ; catalogued: boolean }
  /** A book root, a Pressbooks `/part/`, or a LibreTexts page with children. */
  | { kind: 'book'; source: PublisherSourceId; book: BookRef }
  | { kind: 'refused'; reason: string }

export function classifyPublisherUrl(raw: string, catalogs: {
  openstax: BookRef[]; libretexts: BookRef[]; pressbooks: BookRef[]
}): PublisherUrlTarget
```

- [ ] **Step 1: Write the failing tests**

```ts
test('an openstax page url resolves to its catalogued book and page slug', () => {
  const target = classifyPublisherUrl(
    'https://openstax.org/books/biology-2e/pages/1-1-the-science-of-biology', catalogs)
  expect(target).toMatchObject({
    kind: 'page', source: 'openstax', pageSlug: '1-1-the-science-of-biology', catalogued: true,
  })
  // The licence and authors the shipping LibreTexts box throws away.
  expect((target as { book: BookRef }).book.authors.length).toBeGreaterThan(0)
  expect((target as { book: BookRef }).book.license).toBeTruthy()
})

test('an openstax book root is a book to browse, not a page to import', () => {
  expect(classifyPublisherUrl('https://openstax.org/books/biology-2e', catalogs))
    .toMatchObject({ kind: 'book', source: 'openstax' })
})

test('a pressbooks leaf resolves by longest-prefix match against the catalogued book url', () => {
  expect(classifyPublisherUrl('https://usq.pressbooks.pub/anatomy/chapter/the-cell/', catalogs))
    .toMatchObject({ kind: 'page', source: 'pressbooks' })
})

test('a pressbooks part is a container', () => {
  // `parsePressbooksToc` flattens parts away and never emits one, so a /part/
  // url names many pages. `webbooks.ts:413-435`.
  expect(classifyPublisherUrl('https://usq.pressbooks.pub/anatomy/part/unit-1/', catalogs))
    .toMatchObject({ kind: 'book' })
})

test('a libretexts url with no catalogued book still resolves, and says so', () => {
  const target = classifyPublisherUrl('https://chem.libretexts.org/Courses/Nowhere_U/Ch1', catalogs)
  expect(target).toMatchObject({ kind: 'page', source: 'libretexts', catalogued: false })
})

test('a url on an unlisted host is refused before any fetch, naming the publishers', () => {
  const target = classifyPublisherUrl('https://en.wikipedia.org/wiki/Cell', catalogs)
  expect(target).toMatchObject({ kind: 'refused' })
  expect((target as { reason: string }).reason).toMatch(/OpenStax|LibreTexts|Pressbooks/)
})

test('http, credentials, and private addresses are refused', () => {
  for (const url of [
    'http://openstax.org/books/biology-2e/pages/1-1',
    'https://user:pw@openstax.org/books/biology-2e/pages/1-1',
    'https://openstax.org.evil.test/books/biology-2e/pages/1-1',
  ]) {
    expect(classifyPublisherUrl(url, catalogs), url).toMatchObject({ kind: 'refused' })
  }
})

test('a pressbooks host outside the offered networks is refused', () => {
  // `/(^|\.)pressbooks\.pub$/` is wider than `pressbooks-networks.json`'s
  // fifteen entries: the relay would forward `anything.pressbooks.pub`, and
  // this app offers only the networks it has a catalog for.
  expect(classifyPublisherUrl('https://nobody.pressbooks.pub/book/chapter/x/', catalogs))
    .toMatchObject({ kind: 'refused' })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/sources/publisher-url.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the classifier**

Structure, with the reasoning that belongs in comments:

- Parse with `new URL`. Refuse anything that is not `https:`, refuses `isPublicNetworkUrl`, or whose
  host matches no publisher pattern. **Match hosts against the same shapes
  `worker/allowlist-hosts.ts` uses, but do not import from `worker/`** — the worker is a separate
  build target and the app must not depend on it. Duplicate the three publisher host tests here with
  a comment naming the worker file as the authority, and add a test that fails if the app admits a
  host the worker would refuse.
- **OpenStax**: path `/books/<slug>/pages/<page>` → page; `/books/<slug>` → book. Look `<slug>` up in
  `openStaxCatalog()` by bare slug. OpenStax is the one publisher where an uncatalogued slug should
  be **refused**, not accepted: `fetchToc` needs the book's uuid, which only the catalog has, so
  there is no degraded path to offer.
- **Pressbooks**: refuse a host not in `pressbooksNetworks`. Longest-prefix match the url against
  catalogued `slug`s (which are book roots). `/front-matter/<s>/`, `/chapter/<s>/`,
  `/back-matter/<s>/` → page; `/part/<s>/` or the bare root → book.
- **LibreTexts**: longest-prefix match against catalogued slugs. Every url is provisionally a `page`;
  whether it is really a container is only knowable after fetching it (children come from
  `li[data-page-id]`), so that decision belongs to Task 5, not here. Say so in a comment rather than
  pretending the classifier can tell.
- Every `refused` reason must name the route that works, never just "unsupported".

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run --project unit src/sources/publisher-url.test.ts && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add src/sources/publisher-url.ts src/sources/publisher-url.test.ts
git commit -m "feat: classify a publisher url without touching the network"
```

---

### Task 5: Resolve one page, and prove it fetches exactly once

Turn a `kind: 'page'` classification into the one-section outline the existing `fetchChapter` takes.
**This task's decisive test is a call count, not a page count** — a test that only asserted "one
section came back" would pass while the LibreTexts crawl still ran and threw 249 pages away.

**Files:**
- Modify: `src/sources/publisher-url.ts`, `src/sources/publisher-url.test.ts`
- Modify: `src/sources/openstax.ts` (page-slug → TOC-node lookup; optional `signal` on `json`)

**Interfaces:**

```ts
export async function resolvePublisherPage(
  target: Extract<PublisherUrlTarget, { kind: 'page' }>,
  deps: { openstax: OpenStaxClient; libretexts: WebBookClient; pressbooks: WebBookClient },
  signal?: AbortSignal,
): Promise<Chapter>
```

- [ ] **Step 1: Write the failing tests**

```ts
test('a libretexts page with children fetches exactly ONE upstream url', async () => {
  // The decisive test. `fetchChapter`'s `visit` recurses to
  // `maxPagesPerChapter = 250` (`webbooks.ts:311,363`) for any section carrying
  // `kind: 'libre-tree'`. A one-section outline with NO `kind` skips `visit`
  // entirely — the no-crawl path is reachable today and has no caller. Counting
  // calls is what pins that; counting sections would not.
  const fetcher = vi.fn(async () => new Response(PAGE_WITH_CHILDREN_HTML, {
    status: 200, headers: { 'content-type': 'text/html' },
  })) as unknown as typeof globalThis.fetch
  const chapter = await resolvePublisherPage(libreTarget, depsWith(fetcher))
  expect(chapter.sections).toHaveLength(1)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('an openstax page url maps to the toc node whose slug matches', async () => {
  // `TocNode.slug` carries the page slug and `canonicalSectionUrl`
  // (`openstax.ts:339`) builds exactly the pasted form, so the inverse map is
  // derivable from the toc the app already fetches for the licence url.
  const chapter = await resolvePublisherPage(openStaxTarget, deps)
  expect(chapter.sections).toHaveLength(1)
  expect(chapter.sections[0]!.canonicalUrl)
    .toBe('https://openstax.org/books/biology-2e/pages/1-1-the-science-of-biology')
})

test('an openstax page slug that is in no toc node is refused, naming the book', async () => { /* … */ })

test('a pressbooks page resolves through the toc entry whose link normalises to the url', async () => {
  // One request the adapter already makes (`wp-json/pressbooks/v2/toc`), then
  // one content request — the outline must carry the entry's `kind` and `id`
  // or `fetchChapter` throws "Pressbooks section is incomplete".
  expect(fetcher).toHaveBeenCalledTimes(2)
})

test('a libretexts page whose children make it a container is offered as a book instead', async () => {
  // Only knowable after the fetch. The user gets the book browse — which is
  // what the shipping LibreTexts url box does today — rather than a silent
  // 250-page crawl or a dead end.
})

test('the section carries the requested url as its canonicalUrl', async () => { /* attribution links the exact page */ })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/sources/publisher-url.test.ts`
Expected: FAIL — `resolvePublisherPage` does not exist.

- [ ] **Step 3: Implement the three branches**

Each is url parsing plus a lookup against data already fetched. **No branch may reimplement a fetch,
a parse, an extraction, or a normalisation** — if you find yourself writing an extractor, stop: the
scope trap for this feature is writing three content adapters when what is needed is three address
resolvers.

- **OpenStax** — `fetchToc(book.id)`, walk the tree for the node whose `slug` matches `pageSlug`,
  build `ChapterOutline { id, title, sections: [{ id, title, slug }] }`, call
  `fetchChapter(client, book, outline, toc, signal)`. Passing the `toc` is not optional: it is where
  the licence **url** comes from, and `resolveLicense` (`openstax.ts:363-378`) prefers it over the
  catalog's bare name precisely because D9 requires a link with descriptive text.
- **LibreTexts** — build `WebBookOutline { sections: [{ id, title, url }] }` with `kind` **unset**.
  Assert that in a comment and in the test; setting `kind: 'libre-tree'` is the one-character change
  that turns this feature into a crawler.
- **Pressbooks** — `fetchOutlines(book)` gives one outline per leaf already; find the one whose
  section `url` normalises to the requested url and pass that outline straight through. Reuse
  `webbooks.ts`'s existing normalisation rather than writing a second one.

- [ ] **Step 4: Thread the signal into the OpenStax client**

`json<T>` calls `deps.fetch(url)` with no init, and `fetchChapter`'s comment
(`openstax.ts:378-386`) explains that the in-flight request is deliberately not abortable because
"one page of latency is not worth widening that interface". **That reasoning was argued for a chapter
of a dozen sequential fetches, where a between-request check is nearly as good. A one-page import has
exactly one request, so a between-request check is worth nothing at all** — cancel would do nothing
until the whole import finished. Widen `json<T>(url, signal?)` to pass `{ signal }`, and update the
comment at 378-386 to say what is now true, including why the reason it gave no longer holds. Do not
leave a comment behind that describes the old behaviour.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run --project unit src/sources/ && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npx vitest run
git add src/sources/
git commit -m "feat: resolve one publisher page from a url, without crawling"
```

---

### Task 6: Recover provenance, and gate an uncatalogued url on rights

`openLibreTexts` (`src/components/SourceBrowser.tsx:95-111`) synthesises
`{ source, id: url, slug: url, title, authors: [] }` — no `license`, no `licenseUrl`, no authors, no
catalog lookup. Every page opened through the shipping url box therefore publishes an attribution
block reading "The authors of this material could not be determined" and "The license for this
material could not be determined", **including for books whose authors and CC licence are sitting in
`public/catalogs/libretexts.json` right now**. D9 permits that degradation, so it is not a violation
— but it degrades on every single url import, and closing it is most of the provenance work.

**Files:**
- Modify: `src/sources/publisher-url.ts`
- Test: `src/sources/publisher-url.test.ts`, `src/engine/compile/steps/attribution.test.ts`

**Interfaces:** no new types. `Attribution` already carries `bookTitle`, `publisher`, `url`,
`authors` and `license`; `ImportMetadataFields` and `validateImportMetadata`
(`src/import/common.ts:30-45`) already collect and enforce a `rightsAuthority` +
`rightsAcknowledged` pair.

- [ ] **Step 1: Write the failing tests**

```ts
test('a catalogued libretexts url emits its real authors and a licence LINK', async () => {
  // Fails today: the shipping url box passes `authors: []` and no licence, so
  // the D9 block says both could not be determined. Write it to fail first.
  const chapter = await resolvePublisherPage(catalogedLibreTarget, deps)
  expect(chapter.attribution.authors.length).toBeGreaterThan(0)
  expect(chapter.attribution.license).toMatchObject({ name: expect.any(String) })
})

test('a catalogued openstax url takes the licence URL from the toc, not the bare catalog name', async () => {
  expect(chapter.attribution.license).toMatchObject({ url: expect.stringContaining('creativecommons.org') })
})

test('an uncatalogued url carries the rights the user supplied', async () => { /* … */ })

test('an uncatalogued url without a rights acknowledgement is refused before the fetch', async () => {
  await expect(resolvePublisherPage(uncataloguedTarget, deps)).rejects.toThrow(MISSING_RIGHTS_MESSAGE)
  expect(fetcher).not.toHaveBeenCalled() // refused BEFORE any request
})

test('a catalogued url needs no acknowledgement — parity with the catalog browse', async () => {
  // The same page reached by browsing the catalog asks for nothing. Requiring a
  // checkbox only on the url route would make the identical page harder to
  // import by url for no gain, and the catalog is the same assertion in both.
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/sources/publisher-url.test.ts`

- [ ] **Step 3: Recover from the catalog, or demand rights**

Catalogued: use the matched `BookRef` as-is — `authors`, `license`, `licenseUrl` come from it, and for
OpenStax the TOC's licence `{ name, url }` wins (Task 5 already passes the toc).

Uncatalogued: build the `BookRef` from the user's answers and require `rightsAcknowledged` **before**
the fetch, via the existing `validateImportMetadata` / `requireRightsAuthority`. Refusing after the
request would have spent a relay call on content the user may not proceed with.

Set `Section.canonicalUrl` to the requested url so the attribution block links the exact page — the
catalog path already does this and the audit already holds it to WCAG.

- [ ] **Step 4: Run and commit**

```bash
npm run typecheck && npx vitest run
git add src/sources/ src/engine/compile/steps/attribution.test.ts
git commit -m "feat: recover publisher provenance from the catalog, or ask for rights"
```

---

### Task 7: One url field for all three publishers

Replace the LibreTexts-only `<details>` ("Open a LibreTexts URL instead") with one field that accepts
any of the three, and wire the rights fields for an uncatalogued url. A `kind: 'book'` classification
takes the **existing** `pickBook` path rather than showing a dead end — that is what the LibreTexts
box does today, and refusing a container url outright would REGRESS a shipping capability. It also
introduces no crawl of its own: a LibreTexts book browse is one public-page request
(`webbooks.ts` `fetchOutlines`, "keeping a book browse to one public-page request instead of crawling
the book"), and the 250-page expansion only happens if the user then selects a chapter, which is the
existing, chosen path.

**Files:**
- Modify: `src/components/SourceBrowser.tsx` (`openLibreTexts` at 95-111 and its `<details>`)
- Modify: `src/App.tsx` (one entry point beside `pickBook` at ~390)
- Test: `src/components/SourceBrowser.test.tsx`, `src/App.test.tsx` (match the existing files)

**Interfaces:** `SourceBrowser` gains `onOpenUrl(url: string, rights?: ImportMetadata): void`;
`openLibreTexts` is deleted, not left beside it.

- [ ] **Step 1: Write the failing tests**

Cover: the field accepts an OpenStax and a Pressbooks url, not only LibreTexts; a refused host shows
the classifier's reason verbatim (do not restate it in the component — one sentence, one place); an
uncatalogued url reveals the rights fields and the submit is refused until acknowledged; a container
url lands on the chapter list rather than an error; acquisition failure reaches `setError` through
the same `catch` `pickBook` uses (`App.tsx:412`); the error names the **publisher host**, not "the
relay" — a 502 from the relay is a statement about the publisher — and an off-allowlist redirect
(relay 403 `host not allowed`, `MAX_REDIRECT_HOPS = 5`) reads as "this url redirects off the
supported publishers" rather than as an app bug.

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**

Keyboard, focus and error-recovery behaviour must match the existing field; this replaces a control
that is already reachable, and issue 13 will test it.

- [ ] **Step 4: Run and commit**

```bash
npm run typecheck && npx vitest run
git add src/components/SourceBrowser.tsx src/components/SourceBrowser.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: one url field for all three publishers"
```

---

### Task 8: Prove the two routes produce the same bytes, then close the issue

The test that keeps url import from quietly becoming a second pipeline. Prefer it over any per-page
assertion: it is the only one that fails if acquisition starts changing content.

**Files:**
- Create: `src/sources/publisher-url.browser.test.ts`
- Modify: `.scratch/document-import/issues/17-import-publisher-url.md`,
  `.scratch/document-import/map.md`

- [ ] **Step 1: Write the parity test**

```ts
test('the same page reached by catalog browse and by url produces identical bytes', async () => {
  // Not "similar" and not "both contain the figure": IDENTICAL. Acquisition is
  // entirely upstream of compile, so any difference means acquisition changed
  // the content — which is exactly the failure this feature could introduce
  // and nothing else would catch.
  const byBrowse = await compileAndAuditChapter(await chapterViaCatalog(), { profile: OPENSTAX })
  const byUrl = await compileAndAuditChapter(await chapterViaUrl(), { profile: OPENSTAX })
  expect(auditedHtml(byUrl.sections[0]!)).toBe(auditedHtml(byBrowse.sections[0]!))
})

test('a url import audits and packages the bytes it published', async () => {
  // The invariant, re-measured on the new acquisition path rather than assumed
  // to carry over.
  const entries = buildCartridge([compiledFromUrl])
  expect(pageBytesOf(entries)).toContain(auditedHtml(compiledFromUrl.sections[0]!))
})

test('a publisher fixture with a private-address img yields a placeholder and blocks', async () => {
  // Task 2's fence, measured on the real publisher path rather than on the
  // gate in isolation. Its sibling below is what proves it is a fence, not a ban.
  expect(auditedHtml(section)).toContain('[Embedded image:')
  expect(auditedHtml(section)).not.toContain('169.254.169.254')
  expect(isPublishable(compiled)).toBe(false)
})

test('an ordinary assets.openstax.org image is untouched and still absolutized', async () => { /* … */ })
```

Use committed fixtures under `src/sources/fixtures`; **no test in this plan may make a live network
request.**

- [ ] **Step 2: Run the browser project**

Run: `npx vitest run --project browser src/sources/publisher-url.browser.test.ts`
Expected: PASS. If the parity test fails, do **not** relax it — find what acquisition changed.

- [ ] **Step 3: One end-to-end run per publisher**

Paste url → compile → audit → cartridge, for OpenStax, LibreTexts and Pressbooks, asserting the
audited bytes are the cartridge bytes in each. Three cases, one parameterised test.

- [ ] **Step 4: Close the issue and update the map**

Tick issue 17's criteria, set `Status: resolved`, and add an `## Answer` recording: one url is one
page and why (the 250-page LibreTexts crawl); the result is a `Chapter` and why not an
`ImportResult`; images stay external references; where the private-address fence landed and why the
`Sink.blocker` channel was not needed; and every open question still open at that point. Leave the
frontier where it is unless 11 has resolved.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add src/sources/publisher-url.browser.test.ts .scratch/document-import/
git commit -m "test: prove url and catalog routes publish identical bytes"
```

---

## Open questions

Settled here, with the evidence:

- **Scope split** (design Q1) — new issue 17, issue 12 `deferred`, issue 13 repointed. Approved by the
  human; done in Task 1.
- **The compile blocker channel** (design Q2) — **not needed.** `f52b2e5` built the blocker channel
  one layer down, and the gate is where every path converges. Task 2's reasoning in full above. If a
  later compile step needs to refuse something the gate cannot see, `Sink.blocker` becomes worth
  building then, on that step's evidence rather than on this one's.
- **Rights acknowledgement for CATALOGUED urls** (design Q4) — **not required.** The same page reached
  by catalog browse asks for nothing, and the catalog is the same assertion by either route; a
  checkbox only on the url path would be friction with no gain.
- **Image counts per page** (design Q6) — **needs no answer.** The images-stay-external decision rests
  on three other reasons (identical cartridges by either route, the third-party-host problem that
  would push on the allowlist, and audit fidelity that is already correct). The relay-budget argument
  was the only one that needed the count, and the decision does not change without it.
- **Cancellation** (design Q7) — **thread the signal.** `webbooks.ts`'s `response()` already forwards
  `signal` into `fetcher`, so LibreTexts and Pressbooks already abort in flight; only
  `openstax.ts`'s `json<T>` does not. The comment at `openstax.ts:378-386` declined to widen the
  interface because "one page of latency is not worth" it — an argument about a dozen sequential
  fetches that does not survive a one-request import. Task 5 Step 4.
- **The silent dropped-`src` hole** (design Q8) — **fixed here, not filed separately.** Task 2's
  placeholder closes it in the same change, for every path, because it is the same mechanism.

Escalated — an implementer must not invent an answer to these:

- **Do `*.pressbooks.pub` networks permit open self-signup?** (design Q5) — **narrowed, not settled.**
  Pressbooks' own user guide, via search results on 2026-08-29, states that an author can register a
  free account on the pressbooks.pub network directly (a `wp-signup.php` url is given) and that
  institutional sub-networks instead route through a network manager. Both guide pages returned HTTP
  403 to direct fetches, so this is **indicative and second-hand, not verified.** If it holds, then
  the apex `pressbooks.pub` — which `/(^|\.)pressbooks\.pub$/` forwards — carries arbitrary
  user-authored content, and Task 2's image fence is load-bearing rather than defence in depth. It is
  built either way, so nothing in this plan is blocked; what the answer changes is how much weight the
  rights acknowledgement below is carrying. **Someone should load the signup url in a browser and
  record the result before this ships.**
- **Uncatalogued publisher urls** (design Q3) — planned as **accept behind the rights gate**, and the
  plan is written that way, but the human should confirm. Two facts argue for accepting: refusing
  would make the catalog snapshot's staleness a hard boundary, contradicting D9's own stance that
  attribution degrades rather than disappears; and the shipping LibreTexts url box already accepts any
  `libretexts.org` url with no catalogue lookup at all, so refusing would REGRESS a live capability
  (accepting behind an acknowledgement is strictly stronger than what ships today). The fact that
  argues against is the one above: if pressbooks.pub self-signup is open, "uncatalogued" can mean
  "written by anyone", and a checkbox is then the whole trust boundary for that content.
  **OpenStax is exempt either way** — its uncatalogued urls are refused in Task 4, because `fetchToc`
  needs a uuid only the bundled catalog has, so there is no degraded path to offer.

## Non-goals

Carried from the design, restated so no task quietly adopts one:

- Firecrawl, any url on a non-allowlisted host, and any user-supplied API key. That is issue 12,
  deliberately left standing and deferred.
- Crawling, recursive import, or one url expanding to many pages.
- Widening `worker/allowlist-hosts.ts`. Considered and rejected, not deferred.
- Fetching or packaging publisher image bytes.
- Routing publisher content through `sanitizeImportedHtml` or the issue-10 page-plan editor.
- Consuming the reserved `'web'` / `'firecrawl'` type members.
- A `Sink.blocker` channel. Superseded by Task 2, not deferred — if a future step needs it, it should
  be argued from that step's evidence.
