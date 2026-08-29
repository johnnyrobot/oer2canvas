# Import from a URL — design

Research and design only. No production code was written and no source file was changed.

The human has chosen a first slice — *import from URLs on hosts the relay already forwards* — that
issue 12 explicitly forbids. This document resolves that conflict first, because everything else
depends on which issue the work lands under.

Claims below are marked **VERIFIED** (read from the code, with the file and line) or **INFERRED**
(reasoned, not measured). Nothing is asserted that was not one or the other.

---

## The scope conflict

Issue 12's third criterion:

> The feature acquires one explicit URL and does not expose a crawler, recursive site import,
> **application relay**, or hidden server fallback.

The publisher-URL slice is built *on* the application relay. It is not a phase of issue 12; it is the
thing issue 12 named and ruled out. The two are alternative answers to one question — *how does this
app reach a host a browser cannot?* — and they answer it with different trust boundaries:

| | Issue 12 (Firecrawl) | Publisher-URL slice |
| --- | --- | --- |
| Hosts reachable | any | the `worker/allowlist-hosts.ts` set |
| Who is trusted | Firecrawl, plus the user's own key | the app's own allowlist |
| What is paid | a third-party dependency and a key the user must hold | a curated allowlist that must be argued every time it grows |
| Extraction | Firecrawl's, unmeasured here | three adapters already in `src/sources/`, already shipping |
| New external dependency | yes | none |

Neither subsumes the other. Firecrawl reaches a Wikipedia page or a departmental site; the relay never
will. The relay reaches a Pressbooks chapter with publisher-specific caption, figure and QuickLaTeX
recovery (`src/engine/compile/context.ts`); Firecrawl's Markdown would arrive stripped of the class
names those steps read, and compile under the generic `DOCUMENT` profile instead.

### Recommendation: a new sibling issue; leave 12 intact

Open `.scratch/document-import/issues/17-import-a-publisher-url.md` for the publisher slice and leave
issue 12 exactly as written.

Rewriting 12 would delete a security decision rather than supersede it. Its criteria record a
deliberate posture — memory-only key, no server fallback, browser-direct — and if that text is
replaced by relay criteria there is no longer any record that the posture was chosen, or why it was
set aside. The house rule that a refusal is disclosed rather than silently absorbed applies to issues
as much as to imports.

Concretely, in `map.md`:

- Add `17 — Import a publisher URL`, blocked by nothing that is not already resolved (05 and 10 are
  both resolved; the relay and the three adapters exist and ship today).
- Change `13 — Release core document importer`'s `Blocked by` from `09, 10, 11, 12` to `09, 10, 11, 17`.
  Otherwise the release waits on a Firecrawl decision nobody has taken.
- Set 12's status to something other than `ready-for-agent` — it is not ready, because the decision to
  take a third-party dependency has not been made. `deferred` is the honest word.

**One consequence to accept explicitly.** The tracker defines *Frontier* as "first open, unblocked,
unclaimed issue by number" (`docs/agents/issue-tracker.md`). Numbering the publisher slice `17` puts
it *after* 12 in that ordering, so an agent walking the map would reach 12 first. Changing 12's
status is what prevents that, and it is the reason the status change is not cosmetic. The alternative
— renumbering 12 to 17 and giving the publisher slice the number 12 — keeps frontier order honest but
rewrites a stable issue reference, which the map, issue 13, and both design docs already cite.

---

## Decisions

| Decision | Choice |
| --- | --- |
| Scope split | New issue 17 for the publisher slice; issue 12 left intact and deferred |
| What a URL denotes | Exactly **one page**. A container URL is refused with the catalog browse named as the route |
| Adapters | **Zero new adapters.** A URL resolver produces a one-section outline for the *existing* `fetchChapter` |
| Result shape | `Chapter`, not `ImportResult` — the publisher compile profile is the reason to use the relay at all |
| Images | Left as **external references**, byte-identical to the catalog path. No relay fetch, no `prepareAssets` |
| New refusal | The public-network fence on `img.src` that the other two untrusted-HTML importers already apply |
| Relay allowlist | **Unchanged.** If the slice needs a host it does not have, the slice is wrong |
| Provenance | Recovered from the bundled catalog; rights acknowledgement required only when it cannot be |

---

## What already exists — the most valuable finding

**Publisher-URL import is largely built, and for LibreTexts it is already shipping.**

`src/components/SourceBrowser.tsx:95-111` (`openLibreTexts`) accepts any HTTPS URL on a
`libretexts.org` host, synthesises a `BookRef` whose `slug` and `id` are the URL itself, and calls
`onPick`. That reaches `App.pickBook` (`src/App.tsx:390`), which calls
`createLibreTextsClient(...).fetchOutlines(book)` — configured with `relayUrl: '/relay'` at
`src/App.tsx:47`. The page is fetched through the relay, parsed by `parseLibreTextsPublicPage`, and
its children become selectable chapters that run the full compile / audit / gate / cartridge path.
The UI is behind a `<details>` labelled "Open a LibreTexts URL instead". **VERIFIED.**

So the question is not *can we build URL import*. It is *what is missing from the one that exists*.

### The inventory

| Capability | State |
| --- | --- |
| Relay forwarding to OpenStax, LibreTexts, all 15 Pressbooks networks | **exists** — `worker/allowlist-hosts.ts`; see host coverage below |
| Fetch + parse for all three publishers | **exists** — `src/sources/openstax.ts`, `src/sources/webbooks.ts` |
| Per-publisher compile profiles (captions, figures, xrefs, QuickLaTeX) | **exists** — `src/engine/compile/context.ts` |
| D9 attribution from publisher metadata | **exists** — `src/engine/compile/steps/attribution.ts` |
| Relative-URL resolution against the served URL | **exists** — `src/engine/compile/steps/absolutize.ts` |
| Gate, audit, cartridge, audited-bytes-are-published-bytes | **exists** |
| LibreTexts URL entry | **exists, degraded** — no catalog match, so no authors and no licence |
| OpenStax URL entry | missing |
| Pressbooks URL entry | missing |
| URL → catalogued `BookRef` recovery (authors, licence, licence URL) | missing |
| One-page semantics, and refusal of a container URL | missing |
| Content-type and non-page rejection | missing |
| Per-request timeout; abort of an in-flight fetch | missing |
| Public-network fence on publisher `img.src` | missing |

**Host coverage. VERIFIED.** `pressbooks-networks.json` lists 15 networks. `PRESSBOOKS_PATTERNS`
covers eleven of them through `/(^|\.)pressbooks\.pub$/` and the remaining four by exact host
(`pressbooks.online.ucf.edu`, `milnepublishing.geneseo.edu`, `open.maricopa.edu`,
`open.library.okstate.edu`). Plus `openstax.org`, `assets.openstax.org`, and `*.libretexts.org`. Every
host the catalogs name is already forwardable. **This design needs no allowlist change at all**, and
that is the test of whether the slice is correctly scoped: a URL the relay will not forward is a URL
this feature does not import.

**Types already reserved for issue 12. VERIFIED.** `ImportedFormat` includes `'web'`,
`ImportProvenance.kind` includes `'web'`, and `ImportReport.parser` includes `'firecrawl'`
(`src/import/types.ts:5,22,66`). None has a single use anywhere in `src/`. The publisher slice should
**not** consume them — they are issue 12's, and taking them would be exactly the silent merge this
document exists to prevent.

---

## What is a "page" from a publisher URL?

Each publisher has a different answer, and the difference is not cosmetic.

**OpenStax.** `https://openstax.org/books/<book-slug>/pages/<page-slug>` is always a leaf. Chapter
introductions are themselves pages (`1-introduction`). `canonicalSectionUrl`
(`src/sources/openstax.ts:334`) constructs exactly this form, and `TocNode.slug` carries the page
slug, so the inverse map (page slug → node id) is derivable from the TOC the app already fetches.
One URL, one page. **VERIFIED.**

**Pressbooks.** `/front-matter/<s>/`, `/chapter/<s>/`, `/back-matter/<s>/` are leaves; `parsePressbooksToc`
emits one outline holding one section for each (`src/sources/webbooks.ts:429-450`). `/part/<s>/` is a
container — parts are flattened away and never emitted. The book root is the whole book. One leaf
URL, one page; a part or root URL denotes many. **VERIFIED.**

**LibreTexts.** Any page may have children (`li[data-page-id]`), and `fetchChapter` *crawls* them:
`visit` recurses through every descendant up to `maxPagesPerChapter = 250`
(`src/sources/webbooks.ts:311,363`). One URL can mean 250 pages. **VERIFIED.**

### One URL means one page

That is the decision, and the LibreTexts number is why. A feature where pasting a URL might produce
one page or 250 depending on which publisher it names is not a feature a user can reason about, and
the 250-page branch is a recursive site import in everything but name — the thing issue 12 rules out
and that this slice has no better claim to.

The refusal must be specific and must name the route that works: *"This URL is a chapter containing
N sections rather than a single page. Open the book from the LibreTexts catalog to select chapters."*
A refusal that only says "unsupported" would send the user away from a capability the app already has.

**The crawl is already avoidable without touching `webbooks.ts`. VERIFIED.**
`createLibreTextsClient().fetchChapter` reads:

```ts
for (const item of outline.sections) {
  if (item.kind === 'libre-tree') await visit(item)
  else expanded.push(item)
}
```

A one-section outline whose section carries no `kind` skips `visit` entirely and fetches exactly that
page. The no-crawl path is reachable today; it just has no caller.

### Three publishers does not mean three adapters

It means one resolver with three branches, feeding three adapters that already exist:

```
resolvePublisherUrl(url) -> { source, book: BookRef, outline: one-section }
```

- **OpenStax** — match `<book-slug>` against the bundled catalog (`openStaxCatalog()`), fetch the TOC
  (already needed for the licence URL and xrefs), find the node whose `slug` matches `<page-slug>`,
  build a `ChapterOutline` of one section, call the existing `fetchChapter`.
- **LibreTexts** — longest-prefix match of the URL against catalogued book slugs (which *are* URLs),
  build a `WebBookOutline` of one section with `url` set and `kind` unset, call the existing
  `fetchChapter`.
- **Pressbooks** — longest-prefix match to find the book root, fetch `wp-json/pressbooks/v2/toc` (one
  request the adapter already makes), find the entry whose `link` normalises to the URL, build a
  one-section outline carrying that entry's `kind` and `id`, call the existing `fetchChapter`.

Each branch is URL parsing plus a lookup against data already in the bundle. None reimplements a
fetch, a parse, an extraction, or a normalisation. The scope trap would be writing three *content*
adapters; this writes three *address* resolvers, and `src/sources/types.ts` already argues that the
three sources converge at `Chapter` and nowhere earlier.

### How this meets the issue-10 proposed-page workflow

It does not, and it should not — and that is the sharpest decision in this document.

The issue-10 plan editor operates on `ImportResult` / `ImportDraft`: `confirmImport`
(`src/import/page-plan.ts`) cuts *normalized document HTML* into top-level blocks and lets a user
split, merge, rename and reorder. `App.prepareImportedContent` (`src/App.tsx:569`) then compiles the
result under `publisherProfiles.document`.

Routing a publisher URL through that path would compile OpenStax HTML under the `DOCUMENT` profile:
`captionContainer: 'figcaption'`, `captionIsSibling: false`, `xrefHref: /(?!)/`, `hashFromUrl: () => undefined`,
`chrome: ['script','style']`. **VERIFIED** at `src/engine/compile/context.ts:144-157`. OpenStax puts
its caption in a *following sibling* `.os-caption-container` and its image hash in the URL; under
`DOCUMENT` every caption is orphaned, every figure loses its association, no intra-book link resolves,
and every image's alt-text queue item loses its dedupe hash. The same page imported by browse and by
URL would produce materially different — and worse — output.

So a publisher URL produces a `Chapter` and compiles under its own publisher profile, exactly as the
catalog path does. What it loses is the plan editor's split/merge, and it loses nothing by losing it:
one URL is one page, so there is nothing to split and nothing to merge.

What it *must* borrow from issue 10 is the **rights metadata gate**, not the page editor. See
Provenance below.

---

## Untrusted content

**No new normalization path is introduced, and none may be.**

The bytes take exactly the route catalog-sourced bytes take today, which is the route the app has
been publishing through since issue 05's siblings:

```
relay (forwards bytes, never parses)          worker/relay.ts
  -> adapter extractContent / rendered JSON   src/sources/webbooks.ts, openstax.ts
  -> Chapter.sections[].html  (typed "Raw HTML as the publisher served it. Untrusted")
  -> compileSection: DOMParser into a DETACHED document, steps, serialize
  -> enforceGate: validateAllowlist -> audit -> GateResult.html
  -> auditedHtml(section) -> buildCartridge, verbatim
```

Three properties hold across it, all **VERIFIED**:

- The relay never reads the body. `withCors` passes `res.body` through untouched
  (`worker/relay.ts:122`), and `worker/relay.test.ts:69` pins it — *"never reads the upstream body — by
  any of the five ways of reading one"*. The relay's CPU constraint and the app's trust boundary point
  the same way here.
- Publisher HTML is never parsed live. `compileSection` uses `DOMParser.parseFromString`, which
  executes no script and loads no subresource, into a document never attached to the live one
  (`src/engine/compile/index.ts:17-20`).
- **Audited bytes are published bytes.** `auditedHtml` returns `section.gate?.html ?? section.html`
  and `buildCartridge` writes those bytes verbatim. URL import preserves the invariant trivially,
  because it changes nothing after the gate — it changes only how a `Chapter` is *acquired*, and
  acquisition is entirely upstream of compile. This is the strongest argument for the `Chapter`
  shape: the invariant is not re-established, it is simply never disturbed.

One clarification, because "the same controlled normalization" is ambiguous in this codebase.
There are **two** normalizations for untrusted HTML, and they disagree:

| | `sanitizeImportedHtml` (`src/import/markup.ts`) | publisher compile + `validateAllowlist` |
| --- | --- | --- |
| Used by | paste / file HTML and Markdown (issue 05) | OpenStax, LibreTexts, Pressbooks |
| Images | **removed entirely**, replaced by alt text, `import-image-unavailable` **blocker** | kept as remote `<img>` |
| `img.src` host fence | `isPublicNetworkUrl` | **none** |
| Output | inert semantic subset | Canvas Appendix B allowlist |

A publisher URL is publisher content and must use the publisher normalization — routing it through
`sanitizeImportedHtml` would strip every figure in the page and block the import. But the fence row
is a real, verified inconsistency, and it is the one thing this slice must fix. See Images.

---

## Images

**Decision: publisher images stay as external `<img src="https://…">` references, exactly as the
catalog path emits them today. Nothing is fetched through the relay and nothing reaches
`prepareAssets`.**

Four reasons, in order of weight.

**1. The same page must produce the same cartridge by either route.** If URL import packaged images
and catalog browse did not, one OpenStax page would have two different cartridge forms depending on
how the user found it. That is not a feature difference, it is two answers to one question.

**2. The relay budget forbids it. VERIFIED.** `wrangler.jsonc` binds `RELAY_LIMITER` at
`{ limit: 60, period: 60 }` — 60 requests per minute per client key. A figure-dense OpenStax section
carries on the order of ten to twenty images (**INFERRED** — not counted against a live page here), so
packaging images would spend most of a minute's budget on a single page and would make an ordinary
two-page import hit a 429. The relay was sized to fetch *documents*, not *media*.

**3. It would only half-work, and the half that failed would push on the allowlist.** Publisher-hosted
images are on allowlisted hosts (`assets.openstax.org` is named explicitly;
`*.libretexts.org/@api/deki/files/…` and Pressbooks' `<network>/app/uploads/…` are same-host —
**INFERRED** from the patterns, not measured against live pages). But third-party images are
common in Pressbooks — `quicklatex.com` is named in the `PRESSBOOKS` profile's `mathFromImage`
(`src/engine/compile/context.ts:129`), which is proof that off-host images appear in real books. Those
hosts are not allowlisted and must not be. Packaging would therefore produce cartridges where some
figures are files and others are hotlinks, and would create standing pressure to widen
`allowlist-hosts.ts` — whose header states that exact origin pinning "is the authority boundary" that
"keeps this from becoming an arbitrary proxy". Widening it for image convenience trades that boundary
for a cosmetic gain. **This design does not propose widening the allowlist and does not need it.**

**4. Audit fidelity is already correct for external images and would have to be re-earned.**
`absolutize` exists precisely so publisher images resolve in the audit frame — *"unresolved they 404
in the audit frame, so the audited layout is not the published layout"*
(`src/engine/compile/steps/absolutize.ts:3-8`). External images give the audit a real fetch and a real
box. Packaging would replace that with a `$IMS-CC-FILEBASE$` token plus sniffed `width`/`height`,
which issue 08 proved is sound but which is a *change* to a path that currently measures the real
thing.

Everything issue 09 hardened — `maximumAssetPixels = 40_000_000`, content-sniffed media types,
per-cause refusal counts, the 4 MiB / 8 MiB / 64-asset budgets in `PARSER_PROBE_LIMITS` — applies to
bytes this app *packages*. URL import packages no bytes, so those limits are not weakened and not
consulted. That is a deliberate non-application, not an oversight.

### The one thing that must change: the public-network fence

**VERIFIED gap.** `isPublicNetworkUrl` is used in exactly two places — `src/import/markup.ts:128` and
`src/import/parsers/anydoc-html.ts:202`. The publisher compile path uses it nowhere. A publisher
`<img>` is checked only by `validateAllowlist`, whose `img: { src: HTTP_SCHEMES }` accepts any
`http:` or `https:` URL, and `absolutize` will happily resolve `../x.png` against a private host if
the publisher's own page pointed there. So publisher HTML can emit
`<img src="http://169.254.169.254/latest/meta-data/">` and the browser will request it — during
preview (`ChapterView.tsx:73`, `dangerouslySetInnerHTML`) and during audit (the iframe fetches
images). This is a browser-side request from the user's own network, and it exists today.

URL import does not create the gap, but it widens who can reach it. The catalogs are *curated lists of
book roots*; a pasted URL reaches any page on an allowlisted host, and `*.pressbooks.pub` is a
multi-tenant network with far more books than the 3,057 the catalog snapshot names (**INFERRED** —
whether those networks permit open self-signup was not verified and is an open question below).
Curation was doing quiet work that URL entry removes.

So the slice adds one compile step that fences every `img.src` on `isPublicNetworkUrl` — the same
predicate, imported from `src/import/common.ts`, not a second copy. A failing image is **refused**, and
per the house rule that produces *both* halves:

- **A visible placeholder** — `<span>[Image unavailable: <alt>]</span>`, the same shape
  `anydoc-html.ts` emits, so a reader sees where something is missing.
- **A blocking finding** carrying `external-unsafe`'s existing wording, *"hosted at a network address
  that cannot be safely embedded"* (`src/import/parsers/anydoc-html.ts:85`). The label is lifted from
  its local `RefusalCause` map into a shared module so there is one sentence, not two.

**The cost, stated plainly: the compile pipeline has no blocking channel today. VERIFIED.** `Sink`
offers `note` (informational) and `queue` (a human question) only (`src/engine/compile/sink.ts:3-9`).
Blockers reach `CompiledSection` exclusively through `enforceGate` — axe issues plus
`allowlist.removedSemantic` — and `img` is on the allowlist, so removing its `src` is not semantic
removal and raises nothing. `filterAttrs` silently drops an off-scheme `img.src` and leaves
`<img alt="…">` behind with no source: a broken image that publishes with no finding at all. That is a
silent hole in the current publisher path, independent of this feature.

Closing it needs `Sink.blocker(step, message)` collected onto `CompiledSection`, folded into
`isPublishable` and rendered beside gate blockers. That is genuinely new plumbing, and it is the only
new plumbing this design asks for. It is worth it because without it *no compile step can ever
refuse anything* — the pipeline can fix, ask, or fail the whole section, and nothing in between.

If the human judges that out of scope, the fallback is honest and cheap: URL import introduces **no
new image behaviour whatsoever**, the section closes by evidence rather than by code, and the fence
becomes its own issue. What is not acceptable is adding the fence without the blocker, because a
placeholder with no finding is exactly the silent hole the rule forbids.

---

## Provenance and licensing

D9 is not negotiable here: `appendAttribution` runs before the audit, has no off switch, and its own
header states that emitting CC BY content without attribution "would produce license violations at
scale" (`src/engine/compile/steps/attribution.ts:1-14`).

**VERIFIED defect in the shipping LibreTexts URL box.** `openLibreTexts`
(`src/components/SourceBrowser.tsx:95-111`) synthesises `{ source, id: url, slug: url, title, authors: [] }`
— no `license`, no `licenseUrl`, no authors, and no catalog lookup. Every page opened that way
publishes an attribution block reading *"The authors of this material could not be determined from the
publisher's data"* and *"The license for this material could not be determined"*. D9 permits
degradation, so this is not a violation of the rule — but it degrades on every single URL import,
including for books whose authors and CC licence are sitting in `public/catalogs/libretexts.json`
right now. Closing this is most of the provenance work.

**Recovery.** LibreTexts and Pressbooks catalogue entries carry `slug` as a full HTTPS book URL
(enforced by `isBookRef`'s `/^https:\/\//` check, `src/sources/catalogs.ts:20`), so a longest-prefix
match over catalogued slugs maps a page URL to its book and recovers `authors`, `license`,
`licenseUrl`. OpenStax's bundled catalog keys on the bare book slug, and the TOC supplies the licence
*name and URL* together — which `resolveLicense` already prefers over the catalog's bare name, because
D9 requires the licence to be a *link with descriptive text*, and the TOC is the only source that has
the URL (`src/sources/openstax.ts:352-361`).

**When no catalogued book matches.** The URL is on an allowlisted publisher host but names a book the
catalog snapshot does not know — a new book, or a tenant outside the curated set. Two candidate
behaviours:

- Refuse. Fail-closed, but wrong: it makes the catalog snapshot's staleness a hard boundary, and it
  contradicts D9's own stance that attribution *degrades* rather than disappears.
- Accept, and require the user to supply what the catalog cannot. This is what the document path
  already does: `ImportMetadataFields` collects licence name, licence URL, author, and a
  `rightsAuthority` + `rightsAcknowledged` pair, and `validateImportMetadata` refuses to proceed
  without the acknowledgement (`src/import/common.ts:32-41`).

**Take the second.** The rights gate exists precisely for content whose licence this app cannot
vouch for, and an uncatalogued publisher URL is exactly that. The URL form asks for rights *before*
the fetch; the answers populate the `Chapter`'s `Attribution`. No type changes: `Attribution` already
carries `bookTitle`, `publisher`, `url`, `authors`, `license`, and the acknowledgement is a gate on the
user, not published content.

`Section.canonicalUrl` is set to the requested URL, so the attribution block links the exact page the
content came from — which the catalog path already does and the audit already holds to WCAG.

---

## Failure modes

Every row traces to code that exists. The recurring problem is not that failures are unhandled — they
are — but that several surface as messages that point at the wrong thing.

| Failure | What happens now | What the slice must do |
| --- | --- | --- |
| Relay/upstream unreachable | `worker/relay.ts:149` returns a CORS-bearing 502 `upstream unreachable`; `response()` retries 3× on ≥500 then throws; `App` catches → `setError`. **VERIFIED** | Message must name the *publisher host*, not "the relay". A 502 from the relay is a statement about the publisher |
| Rate limit | Relay returns 429 with `retry-after: 60` (`worker/relay.ts:315`). `response()` retries only on `status >= 500`, so 429 throws immediately as `(HTTP 429)`. **VERIFIED** | Honour `retry-after`. Today the one status that says *"wait and it will work"* is the one that is not waited on |
| Allowlisted host, error page | LibreTexts: `hasImportableContent` false → `'did not contain readable public pages'`. Pressbooks: `'invalid JSON'` or `'did not return content for …'`. OpenStax: `json<T>` throws naming URL, status and content-type. **VERIFIED** | Already actionable. Keep the OpenStax shape — it names whose response broke |
| Redirect | Relay follows GET redirects by hand, re-validating each hop against the allowlist, `MAX_REDIRECT_HOPS = 5` (`worker/relay.ts:29`). Over → 502 `too many redirects`; off-allowlist hop → 403 with the check's reason. **VERIFIED** | Translate a 403 `host not allowed` into *"this URL redirects off the supported publishers"*. Raw, it reads as an app bug |
| Timeout | **None.** No `AbortSignal.timeout` anywhere in `src/sources/`. `parserTimeoutMs: 30_000` bounds the wasm parser only. **VERIFIED** | Add a per-request timeout. A hung fetch currently hangs until the browser gives up |
| Cancellation | `signal?.throwIfAborted()` runs *between* requests only; `openstax.ts:378-386` documents that the in-flight request is deliberately not aborted. **VERIFIED** | For one-page import there is exactly one request, so cancel does nothing. Thread the signal into `deps.fetch`, or say plainly that cancel takes effect when the request returns |
| Not a readable page | `isContentLink` filters by path extension during *TOC parsing* only; a pasted `.pdf` or image URL is fetched and `extractContent` returns something meaningless. `response()` never checks `content-type`. **VERIFIED** | Reject by URL shape up front, and reject a response whose `content-type` is not HTML or the expected JSON. The relay forwards `content-type` unchanged, so this is readable |
| Container URL | Not detected | Refuse with the section count and name the catalog browse |
| No catalogued book | Not detected | Fall through to the rights form (above) |

The mechanism is the existing one: acquisition failures reach `App`'s `catch` → `setError`, the
pattern `pickBook` and `prepareSelection` already use (`src/App.tsx:412, 496`). No new error channel
is needed for acquisition. The *only* new channel is the compile blocker discussed under Images.

---

## Files

| File | Change |
| --- | --- |
| `src/sources/publisher-url.ts` *(new)* | `resolvePublisherUrl(url, catalogs)` → source, `BookRef`, one-section outline, or a typed refusal |
| `src/sources/publisher-url.test.ts` *(new)* | Resolution and every refusal, per publisher |
| `src/components/SourceBrowser.tsx` | Replace the LibreTexts-only `<details>` with one URL field covering all three; wire the rights fields for an uncatalogued URL |
| `src/App.tsx` | One entry point that resolves a URL and reuses `pickBook`'s existing fetch/compile path |
| `src/sources/webbooks.ts` | Honour `retry-after` on 429; per-request timeout; content-type check. No change to extraction |
| `src/sources/openstax.ts` | Same three, plus a page-slug → TOC-node lookup |
| `src/engine/compile/steps/external-media.ts` *(new)* | `isPublicNetworkUrl` fence on `img.src`; placeholder + blocker |
| `src/engine/compile/sink.ts`, `src/contracts/index.ts` | `Sink.blocker`; `CompiledSection.blockers`; folded into `isPublishable` |
| `src/import/refusal-labels.ts` *(new)* | `external-unsafe`'s sentence, shared with `anydoc-html.ts` rather than duplicated |
| `.scratch/document-import/issues/17-import-a-publisher-url.md` *(new)*, `map.md` | The scope split |

`worker/relay.ts` and `worker/allowlist-hosts.ts` are **unchanged**. That is a design constraint, not
an observation.

## Testing

**Resolution.** Per publisher: a leaf URL resolves to the right book and section; a container URL
(LibreTexts page with children, Pressbooks `/part/`, any book root) is refused *and the refusal names
the catalog browse*; a URL on an unlisted host is refused before any fetch; an uncatalogued URL on a
listed host resolves with degraded provenance and demands rights acknowledgement.

**No crawl.** The decisive one. A LibreTexts URL whose page has children must issue **exactly one**
upstream fetch. Asserted by counting calls on an injected fetch — the existing adapter tests already
inject one. A test that only asserted the page count would pass while the crawl still ran.

**Byte parity between routes.** The same OpenStax page reached by catalog browse and by URL must
produce **identical** compiled bytes. This is the test that keeps URL import from quietly becoming a
second pipeline, and it is the reason to prefer it over any per-page assertion.

**Provenance.** A URL matching a catalogued book emits authors and a licence *link*; the current
LibreTexts box does not, so this test fails today and must be written to fail first.

**The image fence.** A publisher fixture carrying `<img src="http://169.254.169.254/…">` produces both
a placeholder and a blocker, and the section is not `isPublishable`. Its sibling: an ordinary
`https://assets.openstax.org/…` image is untouched and still absolutized. The pairing is what proves
the fence is a fence and not a ban.

**Failures.** A 429 with `retry-after` is waited on rather than thrown; a 502 names the publisher; an
off-allowlist redirect produces a message about the URL rather than about the relay; a `text/plain` or
`application/pdf` response is refused before parsing.

**Browser.** One end-to-end run per publisher: paste URL → compile → audit → cartridge, asserting the
audited bytes are the cartridge bytes — the invariant, re-measured on the new acquisition path.

## Non-goals

- Firecrawl, any URL on a non-allowlisted host, and any user-supplied API key. That is issue 12,
  deliberately left standing.
- Crawling, recursive import, or a container URL expanding to many pages. The catalog browse is the
  route for a whole chapter and already works.
- Widening `worker/allowlist-hosts.ts`. Considered and rejected above, not deferred.
- Fetching or packaging publisher image bytes. Decided against above, not deferred.
- Routing publisher content through `sanitizeImportedHtml`, or through the issue-10 page-plan editor.
  Both would degrade output that is correct today.
- Consuming the `'web'` / `'firecrawl'` reserved type members. They belong to issue 12.

## Open questions

1. **Scope split.** New issue 17 with 12 deferred (recommended), or renumber so the publisher slice
   takes 12? The recommendation costs a stable issue reference nothing; the alternative keeps frontier
   ordering honest but rewrites references from the map, issue 13, and two design docs.
2. **The compile blocker channel.** Add `Sink.blocker` in this slice so the image fence can refuse
   properly, or ship URL import with *no* new image behaviour and file the fence separately? Adding
   the fence without the channel is not an option.
3. **Uncatalogued publisher URLs.** Accept with a rights acknowledgement (recommended), or refuse?
   This decides whether the catalog snapshot's staleness is a hard boundary.
4. **Rights acknowledgement for catalogued URLs.** When the catalog already asserts a CC licence, is
   the acknowledgement redundant friction, or the same consent the document path always requires?
5. **Multi-tenant exposure — not verified.** Do `*.pressbooks.pub` networks permit open self-signup?
   If they do, URL entry admits arbitrary user-authored content on an allowlisted host, and the image
   fence stops being defence-in-depth and becomes load-bearing. This was reasoned, not measured, and
   someone should check before the slice ships.
6. **Image counts per page — not measured.** The relay-budget argument rests on "ten to twenty images
   per figure-dense section", which was inferred rather than counted. If a real page carries three, the
   budget argument weakens (the other three reasons do not).
7. **Cancellation.** Thread `AbortSignal` into `deps.fetch` — widening `OpenStaxClient`, which
   `openstax.ts:378-386` explicitly declined to do — or state in the UI that cancel takes effect when
   the in-flight request returns?
8. **The silent dropped-`src` hole.** `filterAttrs` drops an off-scheme `img.src` and publishes
   `<img alt="…">` with no source and no finding. It predates this feature and affects catalog content
   too. Fix here, or file separately?
