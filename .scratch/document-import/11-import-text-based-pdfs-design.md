# Import text-based PDFs — design

Design for document-import issue 11. The PDF path is not absent; it is `probe-only` and already runs
the real parser in a real Worker. Most of this issue is carrying signals the parser already computes
out of the Worker and into the findings and page-plan machinery that issues 05, 09 and 10 built.

Everything below marked **verified** was read from code in this repo or from the vendored package.
Everything marked **inferred** is reasoning that a test must pin before it is trusted.

## What already exists

Read before designing anything new. All verified.

- `src/import/capability.ts:97-106` declares `pdf` with `parser: 'pdf-inspector'`, `status:
  'probe-only'`. `probe-only` means the format is excluded from every file-accept string, because
  `STRUCTURED_DOCUMENT_FILE_ACCEPT` filters on `status === 'enabled' && parser === 'anydoc'` —
  flipping the status alone does **not** surface PDF in the UI.
- `src/import/workers/pdf-inspector.worker.ts` calls `init()`, `processPdf(bytes, { profile:
  'compact', includePageMarkers: true })` and `version()`, and reports `pageCount`,
  `pagesNeedingOcr`, `layoutComplex`, `hasEncodingIssues`.
- `src/import/parsers/probe.ts:315` spawns it as `oer2canvas-pdf-inspector-probe`; the same runner
  enforces every budget, the 30 s timeout, and cancellation.
- `src/import/parsers/probe.ts:176` already refuses a PDF over `maximumPdfPages`.
- `src/import/types.ts:86` declares `ImportReport.pageCount` and `types.ts:75` declares
  `ImportFinding.sourcePage`. **Neither is written anywhere in `src/`.** They were declared for this
  issue and are still dead.
- `src/import/testing/pdf-fixture.ts` builds a deterministic multi-page text PDF, already used by
  `probe.browser.test.ts` against the real WASM and by the committed benchmark.

## What the WASM module actually returns

Verified from `node_modules/@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm.d.ts` (v1.17.0). This is
the fact that decides how much of issue 11 is new work, so it is quoted rather than summarised.

```ts
export type PdfType = "TextBased" | "Scanned" | "ImageBased" | "Mixed";

export interface PdfProcessResult {
  pdfType: PdfType;
  markdown?: string;
  pageCount: number;
  processingTimeMs: number;
  pagesNeedingOcr: number[];        // 1-indexed
  ocrReasonsByPage: PageOcrReasons[];  // { page: number; reasons: string[] }
  title?: string;
  confidence: number;
  layout: LayoutComplexity;         // { isComplex, pagesWithTables[], pagesWithColumns[] }
  hasEncodingIssues: boolean;
}

export function processPdf(data: Uint8Array, options?: ProcessOptions): PdfProcessResult;
export function detectPdf(data: Uint8Array, options?: Pick<ProcessOptions,"password">): PdfProcessResult;
```

`ProcessOptions` carries `pages?: number[]`, `password?: string`, `profile`, `includePageMarkers`,
and `includeImages` — the last documented as *"Include image placeholders in Markdown output."*

**The module already computes five of the six classes issue 11 asks for, per page.** The worker
discards `pdfType`, `ocrReasonsByPage`, `confidence`, `layout.pagesWithTables`,
`layout.pagesWithColumns` and `title` — it never puts them on the wire. `pagesNeedingOcr`,
`layoutComplex` and `hasEncodingIssues` reach `ParserProbeResult` and are then read by nothing.

Three things the module does **not** give, verified by absence from the type surface:

- **No image bytes.** `includeImages` produces *placeholders in Markdown*. No field on
  `PdfProcessResult` carries a byte payload. PDF-embedded images cannot be packaged with this
  version at all — see *Images inside PDFs*.
- **No documented error type.** The worker's `failure()` classifies `encrypted` / `malformed` by
  regex over the thrown error's `message`. The sibling `anydoc.worker.ts:55-69` reads a structured
  `error.code` instead. That asymmetry is forced, not chosen.
- **No documented range for `confidence`.** The type is `number`. Nothing states whether it is 0–1
  or 0–100, nor what it is confident *about*. See *Open questions*.

## The measured budget picture

From `docs/evidence/document-parser-benchmark-2026-08-27.json`, Chrome desktop, all `passed`:

| Fixture | `parseMs` | `wasmMemoryBytes` | `outputBytes` |
| --- | --- | --- | --- |
| `pdf-small-1-page` | 37.8 | 5,767,168 | 1,308 |
| `pdf-medium-75-pages` | 94.9 | 8,192,000 | 99,560 |
| `pdf-stress-200-pages` | 167.9 | 10,223,616 | 267,931 |

The 200-page stress fixture — which is exactly `maximumPdfPages` and is the `measuredPdfPages: 200`
entry in `DOCUMENT_IMPORT_LIMIT_EVIDENCE` — finishes in 168 ms against a 30,000 ms timeout and peaks
at 10.2 MiB against a 128 MiB memory budget. The PDF parser is nowhere near any existing budget.

The same profile records `cancellation: { status: "passed", errorName: "AbortError", totalMs: 19.3,
terminationMs: 0.2 }`.

## Decisions

| Decision | Choice |
| --- | --- |
| Safe renderer | `sanitizeImportedMarkdown` (`markup.ts`), **not** `normalizeAnyDocDocument` |
| Where sanitization runs | Main thread, like `importText` — `DOMParser` does not exist in a Worker |
| Page markers | Split the Markdown on them *before* sanitizing; never inject a sentinel into gated bytes |
| Classification | `detectPdf` first, then `processPdf`; budgets checked between the two |
| Extraction-poor threshold | The zero boundary — a page yielding no non-whitespace text. No invented cutoff |
| Reading-order signal | `layout.pagesWithColumns` / `pagesWithTables`, named per page |
| Scanned pages | One blocker naming the pages; `includeImages: true` so no figure vanishes silently |
| Figures on pages that extracted text | One **warning** naming the pages, plus a visible `[Embedded image: …]` placeholder. The page stays publishable — see *Amendment*, 2026-08-29 |
| PDF page → Canvas page | **Not** one-to-one. PDF pages become split-point labels, not proposed pages |
| Cancellation | Unchanged — `worker.terminate()` in `finish()`. No chunked re-entry |
| PDF-embedded images | Out of scope. v1.17.0 exposes no bytes to give `prepareAssets` |

## Criterion 3 is about `markup.ts`, not `anydoc-html.ts`

This has to be settled first because it decides the shape of everything else.

`normalizeAnyDocDocument(document: Document, ...)` (`anydoc-html.ts:38`) consumes an
`@firecrawl/anydoc-wasm` `Document` — a block/inline tree. `processPdf` returns a **Markdown
string**. There is no adapter between them and building one would mean writing a Markdown-to-anydoc
parser, which is a second parser for content the repo already has a safe renderer for.

The repo's own dependency record agrees. Issue 11 is *blocked by 02, 05 and 10* — 05 is *Import
Markdown and HTML safely*. It is **not** blocked by 03 or 04, the anydoc issues. Issue 05 exists as a
blocker of issue 11 precisely because PDF text arrives as Markdown.

So "the shared safe semantic renderer" for this path is `sanitizeImportedMarkdown` →
`sanitizeImportedHtml` (`markup.ts:381`, `markup.ts:250`), which `importText` already uses for every
Markdown import. That is a shared renderer by the same standard `anydoc-html.ts` is: one function,
four formats, no per-format branch.

Two consequences fall straight out of that choice, both verified:

**Sanitization cannot run in the Worker.** `sanitizeImportedHtml` opens with `new
DOMParser().parseFromString(...)`. `DOMParser` is a Window API and is not exposed in
`DedicatedWorkerGlobalScope`. `anydoc.worker.ts` can normalize in-Worker only because
`normalizeAnyDocDocument` builds strings and never parses. The PDF Worker therefore returns raw
Markdown and the main thread sanitizes it — the division `importText` already has.

**The Markdown output is a main-thread payload and needs a main-thread bound.** `text.ts:26` sets
`MAX_TEXT_IMPORT_BYTES = 2 MiB` with the comment *"Text-like content runs on the main thread through
hashing, normalization, and a live preview. Worker-parser measurements do not justify raising this
path's independently conservative limit."* That reasoning applies verbatim to extracted PDF Markdown,
which reaches the same sanitizer, the same `proposePagePlan`, and the same live preview. The largest
measured PDF output is 267,931 bytes, so the existing constant leaves 7.8× headroom over the
200-page stress fixture. Reuse it; do not add a number.

## Page markers, and why splitting beats injecting

`includePageMarkers: true` makes the module emit `<!-- Page N -->` between pages. That is already set.

It is also already useless downstream: `sanitizeImportedHtml` walks the body with
`NodeFilter.SHOW_COMMENT` and removes every comment (`markup.ts:355-357`). Any page marker that
reaches the sanitizer is deleted, so page provenance dies before the page plan ever sees it.

The tempting fix is to rewrite each marker into something that survives — a `<span id="…">` clears
the allowlist, since `span` is in `ALLOWED_TAGS` and `id` is in `GLOBAL_ATTRIBUTES`. **Reject it.**
That sentinel would then be inside the bytes the accessibility gate audits and
`auditedHtml(section)` (`src/contracts/index.ts:102`) hands verbatim to `buildCartridge`
(`cartridge.ts:268`). Either it ships to Canvas as a stray empty element, or something strips it
after the gate — which is exactly the post-gate rewriting issue 08 built the whole
`$IMS-CC-FILEBASE$`-in-gated-bytes design to avoid. Criterion 6 is audited-byte parity; injecting a
marker to be removed later is the one move that forfeits it.

**Split instead.** Cut the Markdown on `/^<!-- Page (\d+) -->\s*$/m` before sanitizing, sanitize each
page's Markdown independently, and concatenate the resulting HTML. This gives, at import time and for
free:

- the text of each PDF page, so extraction quality is measurable per page;
- findings attributable to a page, which is what `ImportFinding.sourcePage` was declared for;
- a page → top-level-block-index map, which is what the page plan needs.

The cost is real and should be stated: a Markdown construct that straddles a physical page break —
most plausibly a table continued across two pages — is cut in two. That is not a silent loss; both
halves render, and a document with cross-page tables is already flagged through
`layout.pagesWithTables`. The alternative (sanitize once, lose all page provenance) fails criteria 2
and 5 outright.

The block-index map is exact only if `blocksOf(a) + blocksOf(b)` equals `blocksOf(a + b)`. That holds
when neither fragment contributes a bare top-level text node, which `marked` should guarantee by
wrapping loose text in `<p>` — **inferred, not verified**. A test must assert that per-page block
counts sum to the whole-document block count, or the map silently misattributes findings.

## Classification

Six classes, from four signals. `detectPdf` supplies the first three groups without extracting
anything; the fourth is derived from the split text.

| Class | Signal | Evidence carried |
| --- | --- | --- |
| Text-based | `pdfType === "TextBased"` and `pagesNeedingOcr` empty | none needed |
| Scanned | `pdfType` is `"Scanned"` or `"ImageBased"` | `pagesNeedingOcr`, `ocrReasonsByPage[].reasons` |
| Mixed | `pdfType === "Mixed"`, or `TextBased` with a non-empty `pagesNeedingOcr` | the OCR page list |
| Encrypted | `processPdf`/`detectPdf` throws; `failure()` maps to `'encrypted'` | none available |
| Malformed | throws; `failure()` maps to `'malformed'` | none available |
| Extraction-poor | derived per page, below | the page numbers |

**Scanned and mixed are the same detection with a different blast radius**, which is why they share
`pagesNeedingOcr`. Both block; mixed blocks because the OCR-dependent pages inside it would otherwise
publish as gaps.

**Encrypted and malformed rest on string matching.** `pdf-inspector.worker.ts:29-39` tests the error
message against `/password|encrypted/i`, `/limit|too (?:large|many|deep)/i` and
`/malformed|invalid|xref|trailer/i`, defaulting to `'parse-failed'`. That default is the fail-closed
half: an unrecognised message still refuses, just less specifically. The fragile half is that an
upstream wording change silently downgrades `encrypted` to `parse-failed`, and
`actionableFailure` (`probe.ts:163`) treats `encrypted` as *non-retryable* while `parse-failed` is
retryable — so the user would be told to try again on a file that can never succeed. Fixtures for a
password-protected PDF and a truncated-xref PDF must pin the actual messages against the pinned
`parserVersion`.

**Extraction-poor uses the zero boundary and nothing else.** The tempting design is a
characters-per-page floor, but any such number would be invented: the benchmark's fixtures are
synthetic 20-line pages and measure nothing about real extraction quality, and `confidence` has no
documented scale. So the rule is the only non-arbitrary one available —

> a page is extraction-poor when its slice of the Markdown contains no non-whitespace text **and**
> the module did not already list it in `pagesNeedingOcr`.

That is a page the parser believed it could read and then read nothing from. It is a fact about the
output, not a judgement about it, and it needs no threshold. `hasEncodingIssues` raises the same
class for the whole document without a per-page number, because the module reports it document-wide.

This is the `sniffRaster` stance applied to text (`src/import/assets.ts:145-155`): that comment
refuses to distinguish "not this format" from "this format, broken" because there is no reliable
signal, and refuses both identically rather than guessing. Here, likewise, we refuse to grade
extraction quality on a scale we cannot justify, and instead assert only the one thing we can
measure exactly.

A graded threshold is a real product question, deferred to *Open questions* rather than answered with
a number nobody can defend.

## Reading order

Criterion 5 wants reading-order uncertainty visible. There is a direct signal:
`layout.pagesWithColumns` — 1-indexed page numbers the module found to be multi-column.

This is worth being precise about. `pagesWithColumns` reports that a page **has columns**, not that
the extracted order **is wrong**. Multi-column extraction may well be correct. So the honest finding
is not "the reading order is wrong" but "these pages are multi-column, and column order is the thing
this extractor is most likely to get wrong — check them". A `warning`, not a blocker: the text is
present and readable, and the risk is sequence, which a human reviewing the proposed pages can see.

`pagesWithTables` gets the same treatment for the same reason — a table flattened into Markdown may
have lost its column relationships — and both feed one finding rather than two, because they name the
same remedy: read these pages.

`layout.isComplex` is the module's own summary of both and is already on `ParserProbeResult` as
`layoutComplex`. It is kept as a fallback for the case where the arrays are empty but the flag is
set; **inferred** that this can happen, since the type gives no invariant tying them together.

What cannot be detected: a single-column page whose text is in the wrong order for any other reason
(an inset, a pull quote, a footnote block, a rotated page). The module reports no signal for it and
this design invents none. The cost is that such a page passes silently. It is bounded by the fact
that the whole extraction is shown in the plan editor preview before anything is confirmed.

## The OCR boundary

Criterion 4: scanned and OCR-dependent pages must block, and say why.

The mechanism exists and needs no new machinery. `ImportPlanEditor.tsx:144` computes `const blockers
= findings.filter((finding) => finding.severity === 'blocker')` and `ImportPlanEditor.tsx:406`
disables the confirm control on `blockers.length > 0 || problems.length > 0`, under the heading *"This
content cannot be prepared until its blockers are resolved."* (`ImportPlanEditor.tsx:245`). A
`blocker` finding on the import report is already a hard stop before compile, gate and export.

**It is worth knowing how thin that mechanism is**, because issue 11 is the first feature to lean on
it for something a user will actively want to work around. It is *one* real `disabled` attribute on
*one* button. `confirmImport` (`page-plan.ts:341`) validates metadata and the plan and never inspects
finding severity, so a caller invoking it directly with blockers present succeeds. `buildPlan`
(`shell/plan.ts`) takes no `findings` parameter at all — import blockers contribute nothing to
`Plan.blockers`, and on `PlanScreen` they are display-only. The chain holds because nothing downstream
exists until confirmation produces an `ImportedWork`, which is sound, but it means the OCR refusal has
exactly one enforcement point and no defence in depth. This design does not widen that — doing so is a
change to how every existing blocker behaves, not a PDF concern — but it names it, and the test below
asserts the disabled control rather than only the finding.

So this is one finding:

> **Blocker:** 12 of 84 pages in this PDF are scanned images with no extractable text (pages 3–9,
> 41, 55–58). This release does not run OCR in the browser, so their content cannot be imported.
> Remove those pages, or supply a PDF with a text layer.

Design notes on that message, each load-bearing:

- It names the pages. Criterion 2 asks for page-specific evidence and criterion 5 asks for visible
  findings; a count alone satisfies neither.
- It states the limitation as a property of *this release*, matching the existing capability
  limitation string `'Scanned pages require OCR and complex reading order requires review.'`
- It gives the user an action. Every existing blocker in this codebase does
  (`anydoc-html.ts:377`: *"Remove or replace them before publishing."*).
- It is **one** finding, not one per page. `ImportPlanEditor.tsx:251` keys findings on
  `` `${finding.code}-${finding.sectionId ?? ''}` `` — twelve findings sharing a code and a
  `sectionId` would collide as React keys. It also matches issue 09's settled disclosure shape: one
  finding, counted causes, rather than an enumeration. `sourcePage` is set only when exactly one
  page is implicated, which is the only case where a single number is not a lie.

`ocrReasonsByPage[].reasons` is carried into the report but not into the message; it is
free-form text from the parser and belongs in diagnostics, not in a sentence shown to an instructor.
**Inferred** that these strings are English and unstable — the type says only `string[]`.

## Budgets and cancellation

**Cancellation already reaches the running WASM call, and nothing new is needed.** The mechanism is
`finish()` in `probe.ts:216-225`, which calls `worker.terminate()` on abort, timeout, or failure.
`terminate()` destroys the thread; it does not wait for the synchronous `processPdf` to return an
event loop it never yields to. The benchmark records `terminationMs: 0.2` with a clean `AbortError`.

The rejected alternative is chunking: use `ProcessOptions.pages` to extract page ranges in a loop so
an abort can land between chunks. It is unnecessary — `terminate()` already interrupts — and it would
be worse, because splitting one document into N parses means N times the PDF structure parsing and
gives `pdfType`, `confidence` and `layout` per chunk rather than per document.

*(Inference flag: the benchmark records one `cancellation` result per browser profile, not per
fixture, so it is not proven that the cancelled parse was the PDF one. The mechanism is
parser-independent — it lives in the shared runner, not in either Worker — so it applies either way,
but a PDF-specific cancellation test should exist rather than resting on that.)*

**Budgets: four exist, one moves, one is added.**

Existing, all enforced in `probe.ts` and all read from `PARSER_PROBE_LIMITS`:

| Budget | Value | Where |
| --- | --- | --- |
| `maximumInputBytes` | 16 MiB | `probe.ts:199`, before a Worker starts |
| `maximumPdfPages` | 200 | `probe.ts:176` |
| `parserTimeoutMs` | 30,000 ms | `probe.ts:274-281` |
| `maximumWasmMemoryBytes` | 128 MiB | `probe.ts:188` |

**The page budget fires too late.** `resultBudgetFailure` runs on the `result` message — after
`processPdf` has already parsed every page and built the Markdown for all of them. The budget is
meant to stop the browser doing that work, and today it only reports that the work was done. The fix
is the module's own designed answer: call `detectPdf`, documented in the binding as *"Classify PDF
bytes without extracting text or producing Markdown"*, check `pageCount` against `maximumPdfPages`,
and only then call `processPdf`. Classification is needed before extraction anyway, to fail closed on
a scanned document without extracting its empty pages, so the second call is not overhead added for
the budget — it is the phase order the criteria require.

The honest counterweight: `detectPdf` re-parses the PDF structure, so a valid document is parsed
twice. At 168 ms for the 200-page fixture that is affordable, but the cost is **not measured** for
`detectPdf` specifically. The benchmark must gain a `detectPdf` timing before this is presented as
free.

**One budget is added: extracted Markdown size, bounded by the existing `MAX_TEXT_IMPORT_BYTES`
(2 MiB).** Justified above — the Markdown reaches the same main-thread sanitizer, plan builder and
preview that constant was chosen for, and the largest measured PDF output is 267,931 bytes. No new
number is introduced; an existing one is applied to a new caller, and the refusal message names it
the same way `text.ts:30` does.

**A budget deliberately not added: a page-count-to-Canvas-page cap.** See below — PDF pages never
become Canvas pages, so `MAX_PROPOSED_PAGES` is never approached by page count.

## PDF pages are not Canvas pages

`MAX_PROPOSED_PAGES = 100` (`page-plan.ts:33`); `maximumPdfPages = 200`. If a PDF page became a
proposed page, every PDF over 100 pages would trip `page-plan-budget` and collapse to one page — the
budget's fallback would become the normal case for exactly the documents this feature is for.

That numeric collision is a symptom, not the reason. The reason is that a PDF page is a *physical*
unit — where the paper ended — and a Canvas page is a *semantic* one. `proposePagePlan` splits at the
highest repeated heading level (`page-plan.ts:142-175`), which is the semantic boundary, and issue 10
built page identity on block indexes precisely so boundaries could be edited without changing ids.
Splitting on paper would discard that.

So PDF pages map onto issue 10's workflow as **split-point labels, not page boundaries**. The
page → block-index map from the marker split gives each `PlanBlock` an optional `sourcePage`, and
`splitPoints` (`page-plan.ts:247`) — which already labels every boundary inside a page from
`PlanBlock.summary` — labels the first block of each PDF page accordingly. A user splitting a long
PDF import sees "Page 12 — Paragraph: …" in the split picker and can cut on paper boundaries when
they happen to be the right ones, without the proposal assuming they are.

Everything else in issue 10 is untouched: identity stays structural, `confirmImport` still strips
`sectionId` and preserves the rest of each finding — which is what lets `sourcePage` survive
confirmation (`page-plan.ts:364`).

## Images inside PDFs

**Out of scope for issue 11, because v1.17.0 makes them impossible, not because they were deferred.**
`PdfProcessResult` has no byte-bearing field. `includeImages` produces *placeholders in Markdown*.
`prepareAssets` (`assets.ts:225`) requires `{ id, mediaType, originPart, data: Uint8Array }` — there
is no `data` to give it. No amount of design work in this repo produces PDF image bytes from this
module.

That settles *whether*, and leaves *what happens to the figures*. The house rule is that nothing
publishes with a silent hole. `includeImages: false` — today's implicit behaviour, since the worker
never passes the option — makes every figure in every PDF disappear with no finding and no
placeholder. That is precisely the hole.

So: **`includeImages: true`, explicitly.** Each placeholder becomes an `<img>` in the sanitizer,
which raises `import-image-unavailable` at `blocker` severity (`markup.ts:222-228`) — *"markup images
cannot be loaded or packaged safely yet"*. The blocking half of the contract is already correct.

The visible-placeholder half is **not**, and this is a real gap this issue must close.
`markup.ts:353` reads:

```ts
element.replaceWith(alt ? document.createTextNode(alt) : document.createTextNode(''))
```

An image with no alt text becomes an **empty text node** — invisible. The sibling importer does the
opposite: `anydoc-html.ts:263` emits `<span>[Embedded image: alt]</span>`, and its comment insists
*"nothing may disappear silently."* The two importers disagree about the same contract, which is the
exact failure mode `anydoc-html.ts:186-194` already worries about aloud for external images.

`markup.ts` must emit the anydoc placeholder form. This fixes the Markdown/HTML import path as well
as the PDF one, and is the smallest change that makes criterion 4's "no silent content loss" true on
this path.

**Superseded on 2026-08-29.** This section originally concluded that *every PDF containing any
figure will block*, because `markup.ts` raises `import-image-unavailable` at `blocker` severity. That
is no longer the decision: a figure on a page that extracted text produces a **warning** plus the
visible placeholder, and the page remains publishable. A scanned or OCR-dependent PAGE still blocks,
unchanged. The reasoning, the boundary between the two, and the mechanism are in the *Amendment*
below.

When PDF images do become extractable, they go through `prepareAssets` and nothing else. There is
one asset path, it sniffs bytes, it enforces `maximumAssetPixels`, and it returns per-cause
`AssetRejection`s that `anydoc-html.ts:367-379` counts. A second path would duplicate every one of
those guarantees and would drift.

## Audited-byte parity

Criterion 6 needs no PDF-specific mechanism, and the design's job is to avoid breaking the one that
exists.

The PDF path produces sanitized HTML with no packaged assets — every image is a placeholder, so no
`$IMS-CC-FILEBASE$` token is emitted and `cartridge.ts:241`'s referential-integrity check has nothing
PDF-specific to verify. `auditedHtml(section)` returns `section.gate?.html ?? section.html` and
`buildCartridge` writes those bytes verbatim, concatenated into the document shell rather than parsed
into one. `cartridge.ts`'s own docblock states the rule this design has to not break:

> THE INVARIANT THAT IS NOT NEGOTIABLE: the cartridge publishes `CompiledSection.html` VERBATIM. Not
> re-parsed, not re-serialised, not run through another transform on the way out. […] If the export
> re-derived the html, the audited artifact and the published artifact would be two different things
> and the gate's verdict would stop meaning anything about the file the instructor imports.

Nothing in this design writes, rewrites, or strips anything after the gate.

The one way this design could have broken parity was the page-marker sentinel, rejected above for
that reason. Splitting before sanitization means no PDF-specific token ever exists in the gated
bytes, so parity holds by construction rather than by a check.

## Content-based format detection

`importStructuredDocument` refuses unless `parsed.formatDetection === 'content'`
(`document.ts:50-58`). The PDF Worker never sets `formatDetection` and hardcodes `detectedFormat:
'pdf'` — verified. So the PDF path cannot reuse that guard, and today accepts a file on its
extension alone.

Issue 09 settled that refusal is content-based, never extension-based, and proved it holds for every
asset. The same must hold here: check the `%PDF-` signature on the bytes before the Worker starts,
alongside the existing size check, and refuse a mislabelled file by content. This is a few lines and
closes an inconsistency, not a new subsystem.

## Files

| File | Change |
| --- | --- |
| `src/import/pdf.ts` *(new)* | `importPdfDocument`: signature check, probe, marker split, per-page sanitize, classification findings, report |
| `src/import/workers/pdf-inspector.worker.ts` | `detectPdf` phase; `includeImages: true`; carry `pdfType`, `ocrReasonsByPage`, `confidence`, `layout.pagesWith*`, `title`, raw `markdown` |
| `src/import/parsers/probe.ts` | Widen `ParserProbeResult` with those fields; page budget checked at the detect phase |
| `src/import/markup.ts` | `[Embedded image: alt]` placeholder instead of an empty text node |
| `src/import/capability.ts` | `pdf` → `enabled`; a file-accept constant that is not `anydoc`-filtered |
| `src/import/page-plan.ts` | Optional `sourcePage` on `PlanBlock`; page-aware `splitPoints` labels |
| `src/import/types.ts` | Write `ImportReport.pageCount`; `ImportFinding.sourcePage` finally populated |
| `src/components/DocumentImporter.tsx` | Offer PDF; surface the PDF capability limitation |
| `src/components/ImportPlanEditor.tsx` | Finding key includes `sourcePage` |
| `src/import/testing/pdf-fixture.ts` | Scanned, mixed, encrypted, malformed and multi-column fixtures |

## Testing

**The runtime shape must be pinned before anything is built on it.** `probe.browser.test.ts` already
drives the real WASM with a real fixture. It gains assertions on the literal runtime values of
`pdfType` (the `.d.ts` says `"TextBased"`; serde could emit `"text_based"` — **unverified**), on
`confidence`'s observed range, and on the exact `<!-- Page N -->` marker text. Every one of those is
an assumption this design rests on and none is verified today.

**Classification, per class, against a real fixture.** `pdf-fixture.ts` currently builds only
text-based PDFs. It needs a scanned page (an image XObject with no text layer), a mixed document, an
encrypted document, and a truncated-xref document. The encrypted and malformed fixtures matter most,
because they are the two classes decided by regex over an error message — the test is what stops a
version bump silently turning `encrypted` (non-retryable, correct) into `parse-failed` (retryable,
which tells the user to retry forever).

**The block-index map.** Per-page block counts must sum to the whole-document block count. If they do
not, every `sourcePage` on every finding is off by an unknown amount and the page-specific evidence
criterion 2 asks for is quietly wrong. This is the test that catches the one inferred assumption in
the split design.

**The empty-page placeholder.** A Markdown image with no alt currently vanishes. The regression test
asserts a visible `[Embedded image]` in the output HTML, on the Markdown/HTML path as well as the PDF
one, since the fix lives in `markup.ts` and serves both.

**Blocking actually blocks.** A scanned fixture must leave the confirm control disabled. Asserting
the finding exists is not the same as asserting nothing can publish past it, and criterion 4 is about
the latter.

**Budget ordering.** A PDF over `maximumPdfPages` must be refused *without* Markdown having been
produced — observable as the absence of extraction work, not merely as a rejection. Today's check
would pass a naive version of this test while doing all the work it exists to prevent.

**Cancellation.** A PDF-specific abort test, rather than relying on the benchmark's
profile-level cancellation record.

**Parity.** A text-based PDF fixture through the full path — import, plan, compile, gate,
`buildCartridge` — asserting the cartridge bytes equal `auditedHtml`. The `packaged-cartridge`
browser seam does this shape already for assets; this is the same seam with a PDF source.

**Benchmark.** Add `detectPdf` timing so the two-phase cost is measured rather than assumed, and
record it in `DOCUMENT_IMPORT_LIMIT_EVIDENCE` alongside the existing `measuredPdfPages`.

## Non-goals

- **Browser OCR.** Explicitly out; that is what criterion 4 blocks on and says.
- **Decrypting password-protected PDFs.** `ProcessOptions.password` exists and is not used. Issue 11
  asks to *classify* encrypted documents, not open them.
- **PDF-embedded images.** Impossible with v1.17.0, as argued above. When possible, `prepareAssets`.
- **PDF pages as Canvas pages.** Decided against, not deferred.
- **A confidence-based extraction score.** Not until `confidence` has a documented meaning.
- **Reconstructing reading order.** The design reports uncertainty; it does not reorder text.
- **A second asset, sanitizer, or export path.** Every one of those exists once already.

## Amendment — 2026-08-29: figures warn, scanned pages block, and what the module actually does

Two things changed after this design was first written. A product decision was taken about figures,
and the module was run directly rather than read from its `.d.ts`. Both are recorded here rather than
by rewriting the sections above, so the reasoning that was superseded stays visible.

### The decision: a figure warns, a scanned page blocks

A figure inside a PDF produces a **`warning`** and a visible `[Embedded image: …]` placeholder, and
the page remains publishable. It does not block.

The reason is that the three importers are not in the same position. For DOCX and EPUB the image
BYTES EXIST — `prepareAssets` can see them, sniff them, and refuse them — so refusing one is a real
safety decision about a real payload. `PdfProcessResult` exposes no byte-bearing field at all, so a
figure in a PDF can never become a Canvas image no matter what anyone decides here. Blocking would
therefore protect nobody. It would only make PDF import useless, because most real textbook PDFs are
full of figures and a blocker stops the entire commit rather than one page.

What keeps the loss honest is the placeholder, not the refusal. The reader sees exactly where each
figure was, and one warning lists every affected page so the instructor can add them in Canvas
afterwards. That is the no-silent-holes rule satisfied by disclosure instead of by refusal, which is
the correct trade when refusal cannot recover anything.

**The boundary against criterion 4 is sharp and does not move.** A scanned or OCR-dependent PAGE
still BLOCKS. A page with a figure is a page with a gap in it; a page that is entirely an image of
text is a page with no content at all, and publishing it would ship a blank Canvas page where a
chapter section should be. The two cases are distinguishable from the module's own output, measured
below, and a document containing both must block on the second while only warning about the first.

### What running the module showed

Run directly against `@firecrawl/pdf-inspector-wasm` 1.17.0 under Node 22, with synthetic PDFs built
the way `pdf-fixture.ts` builds them. Every claim below is a measurement, and several correct claims
this design previously made from the type surface alone.

1. **`pdfType` is emitted as declared** — `"TextBased"`, `"Scanned"`, `"Mixed"` — not snake_case.
   The `.d.ts` can be trusted on this.
2. **The page marker is exactly `<!-- Page N -->` followed by a blank line, and a page that yields
   no text emits NO MARKER AT ALL.** A four-page document whose third page was blank emitted markers
   for 1, 2 and 4. Page provenance therefore comes from READING the number out of each marker, never
   from counting markers, and a number absent from the sequence is itself the signal that the page
   produced nothing.
3. **`includeImages: true` emits `![Image: Im1](image)`** — the alt text is the PDF XObject's
   RESOURCE NAME, not a caption, and the "url" is the literal word `image`. It has no effect on an
   image the module cannot decode: an uncompressed `/DeviceRGB` XObject produced nothing at all,
   while a `/DCTDecode` (JPEG) XObject produced the placeholder. Fixtures that need a figure must
   embed a real JPEG.
4. **Blank and scanned are distinguishable, which is what makes the boundary above implementable.**
   A page carrying only a decodable JPEG, in a document whose other page was text, produced
   `pdfType: "Mixed"`, `pagesNeedingOcr: [2]`, `ocrReasonsByPage: [{ page: 2, reasons: ["scanned"] }]`
   and `confidence: 0.70`. A genuinely empty page in the same shape of document produced no marker,
   an EMPTY `pagesNeedingOcr`, and left `pdfType` at `"TextBased"`. A blank page therefore does not
   block, and a scanned page does.
5. **`confidence` is 0–1 and, for a `TextBased` document, tracked the fraction of pages that produced
   text in every measurement**: 3 of 3 → 1.00, 2 of 3 → 0.67, 3 of 4 → 0.75, 1 of 2 → 0.50. `Scanned`
   reported 0.90 and `Mixed` 0.70. It is not a per-page extraction-quality score, and for the
   `TextBased` case it is redundant with the marker gaps this design already computes. Carry it as
   diagnostics; build no threshold on it.
6. **Thrown values are plain `Error`s with no `code`.** `Object.keys(error)` is `[]`. Measured
   messages: `"process PDF: PDF is encrypted"`, `"process PDF: Invalid PDF structure"` (a truncated
   file), and `"process PDF: Not a PDF: file appears to be plain text"` / `"… HTML"` / `"… a ZIP
   archive (possibly an Office document)"`. `detectPdf` throws the same messages under a `detect PDF:`
   prefix. So the Worker's regexes stay, and the latent downgrade they carry — an upstream wording
   change turning the non-retryable `encrypted` into the retryable `parse-failed` — stays with them.
   One improvement is available and cheap: `"Not a PDF: …"` currently falls through to
   `'parse-failed'`, which invites the user to retry a file that will never parse; it should map to
   `'unsupported'`.
7. **`detectPdf` costs about a tenth of `processPdf`**: 9.8 ms against 106.6 ms for the 200-page
   fixture, 4.2 against 41.7 at 75 pages, 0.3 against 1.3 at one page (mean of five, after a warm-up).
   The two-phase order is affordable.
8. **`profile` accepts only `"compact"` and `"fidelity"`.** Anything else throws
   `invalid options: Error: unknown variant …`.
9. **The module itself refuses a file that does not begin with `%PDF-`.** Thirteen bytes of junk
   before an otherwise valid header produced `"Not a PDF: file appears to be plain text"`. A strict
   offset-0 signature check on the main thread is therefore PARITY with the parser, not a stricter
   rule invented here.
10. **The module strips running headers.** A fixture whose every line began `Page N line k`
    extracted to nothing at all. Fixture prose must not look like a running header, or the fixture
    silently measures the wrong thing.

## Open questions

1. **What is `confidence`?** The type is `number` with no documented range or subject. If it is a
   calibrated per-document extraction score, it is a better extraction-poor signal than the zero
   boundary this design falls back to. Someone must read the upstream Rust or measure it against
   known-good and known-bad PDFs. **Do not build a threshold on it before then.**
2. **Is a graded extraction-poor threshold wanted at all?** The zero boundary catches a page that
   yielded nothing. It does not catch a page that yielded three garbled words. Setting a
   characters-per-page floor is a product decision requiring real PDFs; there is no evidence in this
   repo to derive one from, and inventing one would be exactly the guessing `sniffRaster` refuses.
3. **How many page numbers may a finding name before it truncates?** "Pages 3–9, 41, 55–58" is
   readable; a worst-case alternating pattern over 200 pages produces 100 ranges. A truncation
   threshold is needed and no existing constant justifies one. `MAX_PROPOSED_PAGES` is unrelated.
4. ~~**Is "any figure blocks the whole PDF" acceptable for this release?**~~ **Answered
   2026-08-29: no.** A figure produces a warning plus a visible placeholder and the page publishes.
   See the *Amendment* below for the reasoning and for the boundary against scanned pages, which
   still block.
5. ~~**Does `pdf-inspector-wasm` throw structured errors?**~~ **Answered 2026-08-29: no.** The
   experiment was run (see *Amendment*): thrown values are plain `Error`s whose own enumerable keys
   are `[]`. The regexes stay, and the latent downgrade they carry stays with them; fixtures pin the
   measured messages against the pinned `parserVersion`.
6. ~~**Does `detectPdf` cost materially less than `processPdf`?**~~ **Answered 2026-08-29:
   yes, about a tenth.** 9.8 ms against 106.6 ms for the 200-page fixture; see *Amendment*. The
   browser benchmark should still record it, but the two-phase order no longer rests on an
   assumption.
7. **Can `layout.isComplex` be true while both page arrays are empty?** The type ties them to
   nothing. It decides whether the fallback branch in the reading-order finding is reachable or dead
   code.
8. **Are `ocrReasonsByPage[].reasons` stable, English, and safe to surface?** Partly answered
   2026-08-29: the two observed values are `no_text` and `scanned` — snake_case identifiers, not
   English sentences, so they are unfit to show an instructor as written. Whether the SET of
   identifiers is stable across versions is still unknown, so they stay out of user-facing text.
9. ~~**Adjacent, not this issue's to fix, but it touches criterion 6.**~~ **Fixed before this
   plan was written**, in commit `0b77d74` — `PlanScreen`'s commit button now enforces the gate's
   decision in its handler rather than only announcing it through `aria-disabled`. Nothing is left
   here for issue 11 to carry.
