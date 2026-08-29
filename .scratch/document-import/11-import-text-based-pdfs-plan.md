# Import text-based PDFs — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user import a text-based PDF entirely in the browser, see per-page evidence of how
well each page was extracted, edit the proposed Canvas pages, and export with audited-byte parity —
while a page that is an image of text refuses to publish and a figure inside a readable page warns,
marks its place, and publishes.

**Architecture:** About 70% of this is carrying signals the WASM module already computes and the
Worker already discards. `processPdf` returns Markdown; the Worker sends it up raw; the main thread
splits it on `<!-- Page N -->` markers, sanitizes each page's slice through the same
`sanitizeImportedMarkdown` every Markdown import uses, concatenates the HTML, and hands one section
to the existing `proposePagePlan` → compile → gate → cartridge chain. Nothing PDF-specific exists
downstream of the importer. The genuinely new work is the marker split, `detectPdf` as a
pre-extraction phase so the page budget fires before the parse it exists to prevent, and a `%PDF-`
content check.

**Tech Stack:** TypeScript, React 19, Vite, Vitest (jsdom `unit` + Chromium `browser` projects).

**Spec:** [`11-import-text-based-pdfs-design.md`](11-import-text-based-pdfs-design.md) — read its
`## Amendment — 2026-08-29` section first. Every measured fact this plan relies on is recorded there.

**Issue:** [`issues/11-import-text-based-pdfs.md`](issues/11-import-text-based-pdfs.md)

## Global Constraints

- **The path is `markup.ts`, not `anydoc-html.ts`.** `processPdf` (Markdown out) → split on page
  markers → per-page `sanitizeImportedMarkdown` → concatenate → `proposePagePlan` → existing
  compile/gate/cartridge. `normalizeAnyDocDocument` consumes an anydoc block tree and there is no
  adapter from a Markdown string to one. The design argues this at length; do not re-litigate it.
- **Sanitization runs on the main thread.** `sanitizeImportedHtml` opens with `new DOMParser()`, and
  `DOMParser` does not exist in a Worker. The Worker returns raw Markdown, exactly the division
  `importText` already has.
- **The block/warn boundary, which is the point of this issue:**
  - a **figure on a page that extracted text** → `warning` + a visible `[Embedded image: …]`
    placeholder. The page stays publishable.
  - a **scanned or OCR-dependent page** (no extractable text, listed in `pagesNeedingOcr`, or a
    document whose `pdfType` is `Scanned`/`ImageBased`) → `blocker`. Unchanged.
  - a page that produced no text and is NOT flagged for OCR → `warning`. Measured: a genuinely
    blank page leaves `pagesNeedingOcr` empty while a scanned one does not, so this bucket is
    "blank paper", not "content we lost".
- **`MAX_TEXT_IMPORT_BYTES` (2 MiB, `src/import/text.ts:26`) bounds the extracted Markdown.** No new
  number: the Markdown reaches the same main-thread sanitizer, plan builder and live preview that
  constant was chosen for. The 200-page fixture measured 267,931 bytes in the browser benchmark —
  7.8x headroom.
- **Never inject a sentinel into the html.** `sanitizeImportedHtml` deletes every HTML comment
  (`markup.ts`'s `NodeFilter.SHOW_COMMENT` walk), and a marker rewritten into something that survives
  would sit in the bytes the accessibility gate audits and would have to be stripped after the gate —
  forfeiting the audited-byte parity criterion 6 is about. Split BEFORE sanitizing; no PDF-specific
  token ever exists in gated bytes.
- **Every number is read from an existing constant or justified in a comment.** Never a bare literal.
  `PARSER_PROBE_LIMITS` / `DOCUMENT_IMPORT_LIMITS` and `MAX_TEXT_IMPORT_BYTES` are the sources.
- **Fail closed: refuse rather than guess.** `sniffRaster`'s comment in `src/import/assets.ts` is the
  canonical statement of that stance. No invented threshold gets added to make a task look finished;
  if a threshold is needed and cannot be derived from evidence in this repo, escalate it.
- **The placeholder wording is `[Embedded image: caption]`**, matching
  `src/import/parsers/anydoc-html.ts:263` and — as of commit `0ddeeea` — `src/import/markup.ts`. All
  import paths must describe the same loss in the same words. **Read `markup.ts`'s image branch
  before changing anything there; it was just rewritten.**
- **House style:** substantial comments explaining WHY, and every factual claim in a comment must be
  true of the source it names.
- **Run `npm run typecheck && npx vitest run` before every commit; the whole suite must pass.** It is
  currently 110 files / 1071 tests. Two pre-existing intermittent flakes live in
  `src/components/DocumentImporter.browser.test.tsx` and `src/components/TextContentImporter.test.tsx`
  — rerun and say so; do NOT "fix" them.

---

### Task 1: Record the figure decision and the measured module behaviour in the design

**Already applied** in the commit that introduced this plan. Read the amended sections before
starting Task 2 — every later task cites them — then tick these boxes and move on. They are listed as
a task because the plan and the design must not disagree, and this is what made them agree.

**Files:**
- Modified: `.scratch/document-import/11-import-text-based-pdfs-design.md`

- [x] **Step 1: The figure decision, with its reasoning**

A new `## Amendment — 2026-08-29` section records that a figure warns rather than blocks, because
for DOCX and EPUB the image bytes EXIST and refusing them is a real safety decision, while
`PdfProcessResult` exposes no byte-bearing field at all — so a PDF figure can never become a Canvas
image and blocking would protect nobody while making PDF import useless. It also states the boundary
that does not move: a page that is entirely an image of text still blocks.

- [x] **Step 2: The contradicting claims, corrected in place**

The *Images inside PDFs* section's closing paragraph ("every PDF containing any figure will block")
is marked superseded rather than deleted, the Decisions table gains a figures row, and open questions
4, 5, 6 and 9 are marked answered. Question 9 was fixed independently in commit `0b77d74`.

- [x] **Step 3: Ten measured facts about `@firecrawl/pdf-inspector-wasm` 1.17.0**

Recorded in the same amendment, from running the module directly under Node 22. The four that
reshape the implementation:

- a page that yields no text emits **no marker at all** (a 4-page document with a blank third page
  emitted markers 1, 2, 4), so page numbers must be READ from markers, never counted;
- `includeImages: true` emits `![Image: Im1](image)` — the alt is the XObject RESOURCE NAME, not a
  caption — and only for images the module can decode (a `/DCTDecode` JPEG worked, an uncompressed
  `/DeviceRGB` XObject produced nothing);
- blank and scanned pages are distinguishable: a page carrying only a JPEG produced
  `pagesNeedingOcr: [3]` with reason `"scanned"`, while a genuinely empty page produced neither;
- thrown values are plain `Error`s with **no `code`** (`Object.keys(error)` is `[]`), so the Worker's
  message regexes stay.

---

### Task 2: Extend the PDF fixture builder, and pin what the real module does

Every later task rests on runtime facts that no test currently asserts. Pin them first, against the
real WASM in a real Worker, so a version bump breaks a test instead of quietly breaking an import.

**Files:**
- Modify: `src/import/testing/pdf-fixture.ts`
- Modify: `src/import/parsers/probe.browser.test.ts`

**Interfaces:**
- Produces: `pdfFixturePages(pages, label?)`, `encryptedPdfFixture()`, `malformedPdfFixture()`.
- `pdfFixture(pageCount, label?)` keeps its exact current signature —
  `scripts/benchmark-document-parsers.mjs` and the committed benchmark evidence depend on the bytes
  it produces. Do not change what it emits.

- [ ] **Step 1: Write the failing test**

Add to `src/import/parsers/probe.browser.test.ts`:

```ts
import { encryptedPdfFixture, malformedPdfFixture, pdfFixturePages } from '../testing/pdf-fixture'

/*
 * The runtime shape every later PDF decision rests on, asserted against the real
 * module rather than read from its `.d.ts`. `pdfType` COULD have been serialised
 * snake_case, the marker text could have been anything, and the image
 * placeholder's alt could have been a caption. It is none of those, and this is
 * where a version bump says so.
 */
test('the pdf module reports pages, figures and scanned pages the way this feature assumes', async () => {
  const bytes = pdfFixturePages(['text', 'text-and-figure', 'scanned', 'blank']).buffer
  const inspected = await probeParser({ parser: 'pdf-inspector', bytes, formatHint: 'pdf' })

  expect(inspected.detection).toMatchObject({
    pdfType: 'Mixed',
    pageCount: 4,
    pagesNeedingOcr: [3],
    ocrReasonsByPage: [{ page: 3, reasons: ['scanned'] }],
  })
  // 0-1, and for a TextBased document it tracked the fraction of pages that
  // produced text in every measurement. Asserted as a RANGE, because nothing
  // upstream documents it and no threshold may be built on it.
  expect(inspected.detection!.confidence).toBeGreaterThan(0)
  expect(inspected.detection!.confidence).toBeLessThanOrEqual(1)

  const markdown = inspected.markdown ?? ''
  // Pages 3 and 4 produced no text, so they produced NO MARKER. The numbers are
  // read, never counted.
  expect(markdown.match(/<!-- Page \d+ -->/g)).toEqual(['<!-- Page 1 -->', '<!-- Page 2 -->'])
  // `includeImages` is on, and this is the exact placeholder form it emits: the
  // alt is the PDF XObject's resource name, and the "url" is the literal word.
  expect(markdown).toContain('![Image: Im1](image)')
})

test('encrypted and malformed pdfs keep their distinct, correctly retryable failures', async () => {
  // `encrypted` must stay NON-retryable: `actionableFailure` decides that from
  // the code, and the code is decided by a regex over an English error message.
  // If an upstream wording change ever downgraded this to `parse-failed`, the
  // user would be told to retry a file that can never succeed.
  await expect(probeParser({
    parser: 'pdf-inspector', bytes: encryptedPdfFixture().buffer, formatHint: 'pdf',
  })).rejects.toMatchObject({ name: 'ParserProbeError', code: 'encrypted', retryable: false })

  await expect(probeParser({
    parser: 'pdf-inspector', bytes: malformedPdfFixture().buffer, formatHint: 'pdf',
  })).rejects.toMatchObject({ name: 'ParserProbeError', code: 'malformed', retryable: true })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project browser src/import/parsers/probe.browser.test.ts`
Expected: FAIL — `pdfFixturePages` does not exist, and `ParserProbeResult` carries neither
`detection` nor `markdown`. (`detection` and `markdown` arrive in Task 3; this test stays red until
then. That is deliberate: it is the specification Task 3 implements.)

- [ ] **Step 3: Build the fixtures**

In `src/import/testing/pdf-fixture.ts`, keep `pdfFixture` exactly as it is and add beside it. The
recipes below were run against the real module and produced the classifications the test above
asserts; deviate from them and the module classifies something else.

```ts
import { RASTER_FIXTURES } from './raster-fixtures'

/**
 * What one physical sheet of a fixture PDF contains.
 *
 * `scanned` is a page whose only content is a DECODABLE image — a real JPEG,
 * `/DCTDecode`. That detail is load-bearing: an uncompressed `/DeviceRGB`
 * XObject is not recognised as an image at all, so a fixture built with one
 * classifies as `TextBased` with an empty `pagesNeedingOcr` and silently
 * measures nothing.
 *
 * `blank` is a page with an empty content stream. It is the negative control
 * for `scanned`: the module leaves it out of `pagesNeedingOcr`, which is the
 * measured fact that lets a blank page warn while a scanned page blocks.
 */
export type PdfFixturePage = 'text' | 'text-and-figure' | 'scanned' | 'blank'
```

`pdfFixturePages(pages, label = 'Fixture')` assembles the same object graph `pdfFixture` does, with
three differences:

1. it appends ONE image object, referenced by every page that needs a figure, whose stream is
   `RASTER_FIXTURES.jpeg.bytes` under `/Filter /DCTDecode /Width 16 /Height 16 /ColorSpace
   /DeviceRGB /BitsPerComponent 8`;
2. it therefore assembles `Uint8Array` parts rather than a string, because JPEG bytes are not text —
   accumulate `Uint8Array`s, track byte offsets for the xref from the running total, and concatenate
   once at the end;
3. its prose must NOT begin with `Page N`. The module strips running headers: a fixture whose every
   line began `Page 1 line 3` extracted to nothing at all. Use the existing
   `${label} page ${page} line ${line}` shape, which measured fine.

Content streams, measured:

```ts
// text                → `BT /F1 11 Tf 72 720 Td 14 TL ${lines} ET`
// text-and-figure     → `BT /F1 11 Tf 72 620 Td 14 TL ${lines} ET\nq 200 0 0 200 72 100 cm /Im1 Do Q`
// scanned             → `q 500 0 0 700 56 46 cm /Im1 Do Q`
// blank               → `` (a zero-length stream)
```

A page needing the figure declares `/XObject << /Im1 N 0 R >>` in its `/Resources`, where `N` is the
image object's number; `text` and `blank` pages must not.

```ts
/**
 * A PDF whose trailer declares `/Encrypt`. `processPdf` and `detectPdf` both
 * throw `"… PDF is encrypted"` on it — the message the Worker's
 * `/password|encrypted/i` branch matches, which is what keeps the failure
 * NON-retryable.
 */
export function encryptedPdfFixture(): Uint8Array<ArrayBuffer>
```

Build it with the four objects `[Catalog, Pages(Count 0, Kids []), Font, Encrypt dictionary]` and the
trailer `<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<01> <02>] >>`, the encrypt dictionary being
`<< /Filter /Standard /V 1 /R 2 /O <0102> /U <0304> /P -1 >>`. The module refuses before it reaches
the page tree, which is why an empty page tree is enough.

```ts
/**
 * A PDF cut off before its xref table, which the module reports as
 * `"… Invalid PDF structure"` — the `/malformed|invalid|xref|trailer/i` branch,
 * and correctly RETRYABLE, unlike an encrypted file.
 */
export function malformedPdfFixture(): Uint8Array<ArrayBuffer> {
  const whole = pdfFixture(2, 'Truncated')
  // 60%: past the header and into the object stream, well before the xref. A
  // shorter cut would look like "not a PDF"; a longer one might still parse.
  return whole.slice(0, Math.floor(whole.length * 0.6)) as Uint8Array<ArrayBuffer>
}
```

- [ ] **Step 4: Run to verify only the expected half passes**

Run: `npx vitest run --project browser src/import/parsers/probe.browser.test.ts`
Expected: the encrypted/malformed test PASSES; the shape test still FAILS on `detection` and
`markdown`. If the encrypted or malformed test fails, the measured message has changed — report the
actual message rather than loosening the assertion, because the retryability of the failure hangs
off it.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add src/import/testing/pdf-fixture.ts src/import/parsers/probe.browser.test.ts
git commit -m "test: build pdf fixtures for figures, scanned pages, encryption and truncation"
```

Note: the suite is not green at this point — one new test is red by design. If leaving the tree red
across a commit is unacceptable in this repo's history, fold Task 2 and Task 3 into one commit and
run the whole suite once at the end of Task 3.

---

### Task 3: Carry the signals the Worker already computes onto the wire

`processPdf` returns `pdfType`, `ocrReasonsByPage`, `confidence`, `layout.pagesWithTables`,
`layout.pagesWithColumns` and `title`. The Worker computes all of them and posts none of them, and
posts no Markdown at all. Nothing else in this plan can work until it does.

**Files:**
- Modify: `src/import/parsers/probe.ts` (`ParserProbeResult`)
- Modify: `src/import/workers/pdf-inspector.worker.ts`
- Test: `src/import/parsers/probe.test.ts` (fake-worker unit seam)

**Interfaces:**
- Produces: `ParserDetection`; `ParserProbeResult.detection?`, `ParserProbeResult.markdown?`.

- [ ] **Step 1: Write the failing test**

In `src/import/parsers/probe.test.ts`, beside the existing fake-worker cases:

```ts
test('a pdf result carries the module detection and the raw markdown', async () => {
  const detection = {
    pdfType: 'Mixed',
    pageCount: 4,
    confidence: 0.7,
    pagesNeedingOcr: [3],
    ocrReasonsByPage: [{ page: 3, reasons: ['scanned'] }],
    layout: { isComplex: true, pagesWithTables: [2], pagesWithColumns: [1, 2] },
  }
  const result = await runFakeProbe({ detection, markdown: '<!-- Page 1 -->\n\nText.\n' })
  expect(result.detection).toEqual(detection)
  expect(result.markdown).toBe('<!-- Page 1 -->\n\nText.\n')
})
```

Match the file's existing fake-worker helper rather than inventing `runFakeProbe`; the point is that
both fields survive the postMessage seam untouched.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/parsers/probe.test.ts`
Expected: FAIL — `ParserProbeResult` declares neither field, so this does not typecheck.

- [ ] **Step 3: Widen the wire type**

In `src/import/parsers/probe.ts`, above `ParserProbeResult`:

```ts
/**
 * What `@firecrawl/pdf-inspector-wasm` concluded about a PDF, carried verbatim.
 *
 * Verbatim on purpose. Every field here is the module's own judgement, and the
 * importer's job is to translate it into findings a person can act on — not to
 * pre-digest it in a Worker where nothing can be tested against a real browser.
 * `pdfType` is typed as `string` rather than a union because the union lives in
 * the vendor `.d.ts`, which no non-Worker module imports; the importer treats
 * an unrecognised value as "not text-based" and fails closed.
 */
export interface ParserDetection {
  pdfType: string
  pageCount: number
  /**
   * 0-1. Measured to track the fraction of pages that produced text for a
   * `TextBased` document (3/3 = 1.00, 2/3 = 0.67, 3/4 = 0.75); `Scanned`
   * reported 0.90 and `Mixed` 0.70. Nothing upstream documents what it means,
   * so it is carried as DIAGNOSTICS and no decision is taken on it.
   */
  confidence: number
  /** 1-indexed. */
  pagesNeedingOcr: number[]
  /** Reasons observed so far: `no_text`, `scanned`. Identifiers, not English. */
  ocrReasonsByPage: { page: number; reasons: string[] }[]
  layout: { isComplex: boolean; pagesWithTables: number[]; pagesWithColumns: number[] }
  title?: string
}
```

and inside `ParserProbeResult`:

```ts
  /** PDF only. The module's classification, before any extraction happened. */
  detection?: ParserDetection
  /**
   * PDF only, and UNSANITIZED. The main thread splits and sanitizes it, because
   * `sanitizeImportedHtml` needs `DOMParser`, which a Worker does not have.
   */
  markdown?: string
```

- [ ] **Step 4: Send them**

In `src/import/workers/pdf-inspector.worker.ts`, pass `includeImages: true` and put the fields on the
result:

```ts
      const result = processPdf(new Uint8Array(request.bytes), {
        profile: 'compact',
        includePageMarkers: true,
        /*
         * ON, so a figure leaves a `![Image: …](image)` placeholder in the
         * Markdown instead of vanishing. It is the only trace of a figure this
         * version produces — `PdfProcessResult` carries no image bytes — and it
         * is what the importer turns into a visible `[Embedded image: …]` mark
         * and a warning naming the page.
         */
        includeImages: true,
      })
```

and, inside the posted `result` object:

```ts
          markdown,
          detection: {
            pdfType: result.pdfType,
            pageCount: result.pageCount,
            confidence: result.confidence,
            pagesNeedingOcr: result.pagesNeedingOcr,
            ocrReasonsByPage: result.ocrReasonsByPage,
            layout: result.layout,
            ...(result.title ? { title: result.title } : {}),
          },
```

`title` is carried and deliberately never used to set the import title: the user typed one, and a
PDF `/Title` is frequently the authoring tool's filename.

- [ ] **Step 5: Classify "not a PDF" as unsupported rather than retryable**

Still in the Worker's `failure()`, before the `malformed` branch:

```ts
    : /not a pdf/i.test(message)
      ? 'unsupported'
```

Measured messages: `"process PDF: Not a PDF: file appears to be plain text"`, `"… HTML"`, `"… a ZIP
archive (possibly an Office document)"`. All three currently fall through to `'parse-failed'`, which
`actionableFailure` treats as RETRYABLE — telling the user to try again with a file whose contents
will never be a PDF. `'unsupported'` is already in the non-retryable set.

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run --project unit src/import/parsers/probe.test.ts && npx vitest run --project browser src/import/parsers/probe.browser.test.ts && npm run typecheck`
Expected: PASS, including Task 2's shape test, which was written against exactly this.

- [ ] **Step 7: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/parsers/probe.ts src/import/parsers/probe.test.ts src/import/workers/pdf-inspector.worker.ts
git commit -m "feat: carry the pdf module's classification and markdown out of the worker"
```

---

### Task 4: Check the page budget before extraction, not after

`resultBudgetFailure` runs on the `result` message — after `processPdf` has parsed every page and
built Markdown for all of them. The budget exists to stop the browser doing that work and today only
reports that it was done. `detectPdf` is the module's own answer: it classifies without extracting,
and it measured 9.8 ms against `processPdf`'s 106.6 ms on the 200-page fixture.

**Files:**
- Modify: `src/import/parsers/probe.ts` (request/response unions, `createParserProbeRunner`)
- Modify: `src/import/workers/pdf-inspector.worker.ts`
- Test: `src/import/parsers/probe.test.ts`

**Interfaces:**
- Produces: response `{ kind: 'detected'; requestId; detection }`; request
  `{ kind: 'extract'; requestId }`.
- The budget stays in the shared runner, where every other budget is enforced. The Worker does not
  decide; it reports and waits.

- [ ] **Step 1: Write the failing test**

```ts
test('an over-budget pdf is refused before any text is extracted', async () => {
  const sent: ParserProbeRequest[] = []
  const probe = createParserProbeRunner({ createWorker: () => fakeWorker(sent, (post) => {
    post({ kind: 'ready', requestId: ID, parser: 'pdf-inspector', parserVersion: '1.17.0', initializationMs: 1 })
    post({ kind: 'detected', requestId: ID, detection: { ...detection, pageCount: PARSER_PROBE_LIMITS.maximumPdfPages + 1 } })
  }), requestId: () => ID })

  await expect(probe({ parser: 'pdf-inspector', bytes: new ArrayBuffer(8) }))
    .rejects.toMatchObject({ name: 'ParserProbeError', code: 'resource-limit' })

  // THE POINT OF THE TEST. Refusing is easy; refusing before the extraction is
  // the budget's whole purpose, and the only way to observe it from outside the
  // Worker is that the second phase was never asked for.
  expect(sent.map((request) => request.kind)).toEqual(['parse'])
})

test('a pdf inside the budget is asked to extract, and the detection reaches the caller', async () => {
  const sent: ParserProbeRequest[] = []
  const probe = createParserProbeRunner({ createWorker: () => fakeWorker(sent, (post) => {
    post({ kind: 'ready', requestId: ID, parser: 'pdf-inspector', parserVersion: '1.17.0', initializationMs: 1 })
    post({ kind: 'detected', requestId: ID, detection })
  }, { onExtract: (post) => post({ kind: 'result', requestId: ID, result: pdfResult }) }), requestId: () => ID })

  await expect(probe({ parser: 'pdf-inspector', bytes: new ArrayBuffer(8) })).resolves.toMatchObject({
    detection: { pageCount: detection.pageCount },
  })
  expect(sent.map((request) => request.kind)).toEqual(['parse', 'extract'])
})
```

Build `fakeWorker` from the file's existing fake — the new part is that it must RECORD every request
it receives and react to `extract`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/parsers/probe.test.ts`
Expected: FAIL — `'detected'` is not in the response union and the runner never sends `'extract'`.

- [ ] **Step 3: Widen the protocol**

In `src/import/parsers/probe.ts`:

```ts
export type ParserProbeRequest =
  | { kind: 'parse'; requestId: string; bytes: ArrayBuffer; formatHint?: string }
  /*
   * Phase two, PDF only. The Worker classifies, sends `detected`, and STOPS
   * until this arrives. That pause is what puts the page budget ahead of the
   * parse it exists to prevent, and it keeps budget enforcement in this runner
   * — where `maximumInputBytes`, the timeout and the memory ceiling already
   * live — instead of copying a limit into a Worker where no unit test can
   * observe the ordering.
   */
  | { kind: 'extract'; requestId: string }
```

and in the response union:

```ts
  | { kind: 'detected'; requestId: string; detection: ParserDetection }
```

`anydoc.worker.ts` already ignores anything that is not `kind: 'parse'`, and never sends `detected`,
so it never receives an `extract`. No change there.

- [ ] **Step 4: Enforce it in the runner**

Beside `resultBudgetFailure`:

```ts
/*
 * The page budget, checked on the CLASSIFICATION and not on the result.
 * `detectPdf` reads the page tree without extracting text, so this refuses a
 * 300-page document having built no Markdown for any of it. `resultBudgetFailure`
 * keeps its own page check as defence in depth: this one only runs for a parser
 * that sends `detected`, and a budget with one enforcement point is a budget one
 * refactor away from having none.
 */
function detectionBudgetFailure(detection: ParserDetection): ParserProbeError | undefined {
  if (detection.pageCount > DOCUMENT_IMPORT_LIMITS.maximumPdfPages) {
    return resourceLimit(
      `This PDF has ${detection.pageCount} pages; the browser limit is ${DOCUMENT_IMPORT_LIMITS.maximumPdfPages}. ` +
      'It was rejected before any text was extracted.',
    )
  }
  return undefined
}
```

and in `onMessage`, before the `failure` branch:

```ts
        if (response.kind === 'detected') {
          const detectionFailure = detectionBudgetFailure(response.detection)
          if (detectionFailure) {
            finish(() => reject(detectionFailure))
            return
          }
          worker.postMessage({ kind: 'extract', requestId }, [])
          return
        }
```

The timeout spans both phases unchanged: it is one budget on the whole parse, and splitting it would
introduce a second number nobody measured.

- [ ] **Step 5: Split the Worker into two phases**

In `src/import/workers/pdf-inspector.worker.ts`, import `detectPdf`, and after `ready`:

```ts
    /*
     * Classify first. This is not an optimisation — it is the phase order the
     * criteria need. The page budget must refuse a 300-page document before its
     * text is built, and a scanned document must be recognised without
     * extracting its empty pages. `detectPdf` measured about a tenth of
     * `processPdf` (9.8 ms against 106.6 ms on the 200-page fixture), so the
     * PDF structure being parsed twice is affordable.
     */
    let detection: ParserDetection
    try {
      detection = describe(detectPdf(bytes))
    } catch (error) {
      send({ kind: 'failure', requestId: request.requestId, error: failure(error) })
      return
    }
    send({ kind: 'detected', requestId: request.requestId, detection })
```

then wait for the `extract` request before running `processPdf`. The Worker holds `bytes` and
`detection` in the closure; keep one `message` listener with a `switch` on `request.kind` rather than
adding a second listener, so cancellation still has exactly one thing to tear down.

Note the byte ownership: `bytes` is transferred INTO the Worker once, on `parse`, and stays there.
The `extract` message carries nothing.

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run --project unit src/import/parsers/probe.test.ts && npx vitest run --project browser src/import/parsers/probe.browser.test.ts`
Expected: PASS. The browser test exercises both phases against the real module.

- [ ] **Step 7: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/parsers/probe.ts src/import/parsers/probe.test.ts src/import/workers/pdf-inspector.worker.ts
git commit -m "fix: refuse an over-budget pdf before its text is extracted, not after"
```

---

### Task 5: Let a caller own the unavailable-image finding

The PDF importer sanitizes one page slice at a time. Left alone, `findingsFrom` raises
`import-image-unavailable` — a `blocker` — once per slice, so a 12-page document with figures on
three pages produces three blocking findings that collide on the React key
`` `${finding.code}-${finding.sectionId ?? ''}` `` and refuse to publish a document this release has
decided should publish.

**Files:**
- Modify: `src/import/markup.ts` (`MarkupSanitizationOptions`, `findingsFrom`, `sanitizeImportedHtml`)
- Test: `src/import/markup.test.ts` (or wherever `sanitizeImportedHtml` is currently tested)

**Interfaces:**
- Produces: `MarkupSanitizationOptions.deferImageFindings?: boolean` (default `false`).
- Does NOT change the placeholder, the counts, or any default behaviour. `importText` is untouched.

- [ ] **Step 1: Write the failing test**

```ts
test('a caller can take ownership of the unavailable-image finding', () => {
  const source = '<p>Before <img src="https://example.org/a.png" alt="A cell"> after.</p>'

  const owned = sanitizeImportedHtml(source)
  expect(owned.findings.map((finding) => finding.code)).toContain('import-image-unavailable')

  const deferred = sanitizeImportedHtml(source, { deferImageFindings: true })
  expect(deferred.findings.map((finding) => finding.code)).not.toContain('import-image-unavailable')

  // Deferring the FINDING never defers the placeholder or the count. The gap in
  // the page is still marked, in the same words, and the caller still knows how
  // many there were — otherwise this option would be a way to lose an image
  // silently, which is the one thing the whole contract forbids.
  expect(deferred.html).toContain('[Embedded image: A cell]')
  expect(deferred.counts.images).toBe(1)
  expect(deferred.counts.unavailableAssets).toBe(1)
  expect(deferred.html).toBe(owned.html)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/markup.test.ts`
Expected: FAIL — the option does not exist, so the deferred call still raises the finding.

- [ ] **Step 3: Add the option**

In `MarkupSanitizationOptions`:

```ts
  /**
   * Suppress the `import-image-unavailable` finding — and ONLY that finding —
   * because the caller will raise its own.
   *
   * For a caller that sanitizes a whole document in one call, the default is
   * right: one document, one finding, blocking, because a Markdown or HTML
   * import CAN carry image bytes one day and refusing is a real decision about
   * real content. The PDF importer sanitizes one PDF PAGE per call, so the
   * default would give it one blocker per page — colliding React keys, and a
   * refusal where this release deliberately warns, since `PdfProcessResult`
   * exposes no image bytes and refusing a figure protects nobody.
   *
   * The placeholder, `counts.images` and `counts.unavailableAssets` are
   * unaffected. Nothing here can make an image disappear quietly.
   */
  deferImageFindings?: boolean
```

Thread it into `findingsFrom(summary, options.deferImageFindings === true)` and guard only the
`summary.unavailableImages > 0` branch with it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/markup.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/markup.ts src/import/markup.test.ts
git commit -m "feat: let a per-page caller own the unavailable-image finding"
```

---

### Task 6: Split extracted Markdown on page markers, and prove the block map adds up

This is the load-bearing new piece. Everything page-specific — findings, `sourcePage`, the split-point
labels — is a function of this split being right.

**Files:**
- Create: `src/import/pdf-pages.ts`
- Create: `src/import/pdf-pages.test.ts`

**Interfaces:**
- Produces: `splitPdfMarkdown(markdown)`, `withPageCaptions(markdown, page)`,
  `formatPageRanges(pages)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { formatPageRanges, splitPdfMarkdown, withPageCaptions } from './pdf-pages'
import { sanitizeImportedMarkdown } from './markup'

test('page numbers are read from the markers, not counted', () => {
  // Measured: a page that produced no text emits NO marker. A four-page PDF
  // whose third page was scanned and whose fourth was blank emits 1, 2 and 4.
  const split = splitPdfMarkdown('<!-- Page 1 -->\n\nOne.\n\n<!-- Page 2 -->\n\nTwo.\n\n<!-- Page 4 -->\n\nFour.\n')
  expect(split.pages.map((page) => page.page)).toEqual([1, 2, 4])
  expect(split.pages.map((page) => page.markdown.trim())).toEqual(['One.', 'Two.', 'Four.'])
  expect(split.preamble.trim()).toBe('')
})

test('text before the first marker belongs to no page and is not dropped', () => {
  const split = splitPdfMarkdown('Front matter.\n\n<!-- Page 1 -->\n\nOne.\n')
  expect(split.preamble.trim()).toBe('Front matter.')
  expect(split.pages).toHaveLength(1)
})

test('a document with no markers at all is one pageless slice', () => {
  const split = splitPdfMarkdown('Just text.\n')
  expect(split.pages).toEqual([])
  expect(split.preamble.trim()).toBe('Just text.')
})

test('the module image placeholder gains a caption naming its page', () => {
  // The module's alt text is the PDF XObject's RESOURCE NAME (`Im1`), which
  // would read as `[Embedded image: Image: Im1]`. The page number is the one
  // true, useful thing available to put there.
  expect(withPageCaptions('Before\n\n![Image: Im1](image)\n\nAfter\n', 7))
    .toBe('Before\n\n![Figure on page 7](image)\n\nAfter\n')
  // An alt the module did not write is left alone.
  expect(withPageCaptions('![A real caption](image)\n', 7)).toBe('![A real caption](image)\n')
})

test('per-page block counts sum to the whole-document block count', () => {
  /*
   * The one inferred assumption in the split design, pinned. The page -> block
   * map is exact only if sanitizing two slices separately yields the same number
   * of top-level blocks as sanitizing their concatenation. If `marked` ever left
   * a bare top-level text node, the two would differ and EVERY `sourcePage` on
   * every finding would be off by an unknown amount — silently.
   */
  const one = '# Heading\n\nA paragraph.\n\n- a\n- b\n'
  const two = 'Loose text with no block wrapper\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n'
  const blocks = (markdown: string) =>
    new DOMParser().parseFromString(sanitizeImportedMarkdown(markdown).html, 'text/html')
      .body.childNodes.length

  expect(blocks(one) + blocks(two)).toBe(blocks(`${one}\n${two}`))
})

test('page numbers print as ranges, and every named page survives the round trip', () => {
  expect(formatPageRanges([3, 4, 5, 6, 7, 8, 9, 41, 55, 56, 57, 58])).toBe('3–9, 41, 55–58')
  expect(formatPageRanges([2])).toBe('2')
  expect(formatPageRanges([2, 3])).toBe('2, 3')
  expect(formatPageRanges([9, 1, 1, 2])).toBe('1, 2, 9')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/pdf-pages.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the split**

`src/import/pdf-pages.ts`:

```ts
/**
 * Cutting extracted PDF Markdown into pages, and saying which page something
 * came from.
 *
 * SPLIT, NEVER MARK. `sanitizeImportedHtml` deletes every HTML comment, so a
 * page marker that reached it would be gone. The tempting fix — rewriting each
 * marker into a `<span id>` that clears the allowlist — is rejected: that
 * sentinel would then sit inside the bytes the accessibility gate audits and
 * `buildCartridge` publishes VERBATIM, so it would either ship to Canvas as a
 * stray element or be stripped after the gate. Post-gate rewriting is exactly
 * what issue 08's design was built to avoid, and criterion 6 is audited-byte
 * parity. Splitting before sanitization means no PDF-specific token ever exists
 * in gated bytes: parity holds by construction rather than by a check.
 *
 * The cost, stated: a construct straddling a physical page break — most
 * plausibly a table continued across two sheets — is cut in two. Both halves
 * render, and `layout.pagesWithTables` already flags such a document. The
 * alternative loses all page provenance and fails criteria 2 and 5 outright.
 */

/** `<!-- Page 7 -->` on its own line, the exact form the module emits. */
const PAGE_MARKER = /^<!-- Page (\d+) -->[ \t]*$/gm

export interface PdfPageSlice {
  /** 1-indexed, READ from the marker. A page that produced no text has none. */
  page: number
  markdown: string
}

export interface PdfMarkdownSplit {
  /** Content before the first marker, which the module attributed to no page. */
  preamble: string
  pages: PdfPageSlice[]
}

export function splitPdfMarkdown(markdown: string): PdfMarkdownSplit {
  const pages: PdfPageSlice[] = []
  let preambleEnd = markdown.length
  let open: { page: number; from: number } | undefined
  for (const match of markdown.matchAll(PAGE_MARKER)) {
    const at = match.index ?? 0
    if (open === undefined) preambleEnd = at
    else pages.push({ page: open.page, markdown: markdown.slice(open.from, at) })
    open = { page: Number(match[1]), from: at + match[0].length }
  }
  if (open) pages.push({ page: open.page, markdown: markdown.slice(open.from) })
  return { preamble: markdown.slice(0, preambleEnd), pages }
}

/**
 * The module writes `![Image: Im1](image)`, where `Im1` is the PDF XObject's
 * resource name and `image` is a literal, not a url. Rendered as-is that reads
 * `[Embedded image: Image: Im1]`, which tells a reader nothing. The page number
 * is the one true and useful caption available, and this is the last moment it
 * is known — after the split, before the sanitizer flattens the image away.
 *
 * Rewritten BEFORE sanitization, so the caption is ordinary audited content and
 * nothing is touched after the gate. Only the module's own exact form is
 * rewritten; anything else is left alone, so a future version that emits a real
 * caption keeps it (and the test above fails loudly if the form changes).
 */
export function withPageCaptions(markdown: string, page: number): string {
  return markdown.replace(/!\[Image: [^\]]*\]\(image\)/g, `![Figure on page ${page}](image)`)
}

/**
 * `[3,4,5,6,7,8,9,41,55,56,57,58]` -> `3–9, 41, 55–58`.
 *
 * NOT TRUNCATED, deliberately. Criterion 2 asks for page-specific evidence, and
 * a count alone is not that. The worst case is bounded by a budget that is
 * already enforced BEFORE extraction: `maximumPdfPages` is 200, so a pathological
 * alternating document names at most 100 ranges — long, but finite, and a
 * document with 100 unreadable stretches is refused rather than published
 * anyway. `describe()` in `markup.ts` sets the same precedent of enumerating
 * everything. Any truncation limit would be a number with nothing behind it.
 */
export function formatPageRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((first, second) => first - second)
  const ranges: string[] = []
  for (let index = 0; index < sorted.length;) {
    let last = index
    while (last + 1 < sorted.length && sorted[last + 1] === sorted[last]! + 1) last += 1
    // Two adjacent pages print as "2, 3": a dash saves nothing and reads worse.
    if (last - index >= 2) ranges.push(`${sorted[index]}–${sorted[last]}`)
    else for (let at = index; at <= last; at += 1) ranges.push(`${sorted[at]}`)
    index = last + 1
  }
  return ranges.join(', ')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/pdf-pages.test.ts && npm run typecheck`
Expected: PASS. **If the block-count test fails, stop.** It means the page → block map cannot be
exact, every `sourcePage` would be a guess, and the split design needs revisiting rather than the
test needs loosening.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/pdf-pages.ts src/import/pdf-pages.test.ts
git commit -m "feat: split extracted pdf markdown on page markers"
```

---

### Task 7: Turn the detection into findings — the block/warn boundary

The heart of criteria 2, 4 and 5, as a pure function over the detection plus one summary row per
page. Pure so both sides of the boundary — and the mixed document that contains both — can be tested
without a Worker, a file, or a browser.

**Files:**
- Create: `src/import/pdf-findings.ts`
- Create: `src/import/pdf-findings.test.ts`

**Interfaces:**
- Consumes: `ParserDetection` (Task 3), `formatPageRanges` (Task 6).
- Produces: `pdfFindings(detection, pages): ImportFinding[]`, `PdfPageSummary`.

- [ ] **Step 1: Write the failing tests**

```ts
const detection = (over: Partial<ParserDetection> = {}): ParserDetection => ({
  pdfType: 'TextBased', pageCount: 3, confidence: 1, pagesNeedingOcr: [], ocrReasonsByPage: [],
  layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] }, ...over,
})
const read = (page: number, images = 0) => ({ page, textLength: 400, images })

test('a clean text-based pdf produces no findings at all', () => {
  expect(pdfFindings(detection(), [read(1), read(2), read(3)])).toEqual([])
})

test('a figure on a readable page warns, and does not block', () => {
  const findings = pdfFindings(detection(), [read(1), read(2, 1), read(3, 2)])
  const figure = findings.find((finding) => finding.code === 'pdf-figure-not-imported')!
  expect(figure.severity).toBe('warning')
  expect(figure.message).toMatch(/3 figures/)
  expect(figure.message).toMatch(/pages 2, 3/)
  expect(figure.message).toMatch(/\[Embedded image/)
  expect(findings.some((finding) => finding.severity === 'blocker')).toBe(false)
})

test('a scanned page blocks, names its pages, and says why OCR is not available', () => {
  const findings = pdfFindings(
    detection({ pdfType: 'Mixed', pageCount: 4, pagesNeedingOcr: [3], ocrReasonsByPage: [{ page: 3, reasons: ['scanned'] }] }),
    [read(1), read(2), read(4)],
  )
  const blocker = findings.find((finding) => finding.code === 'pdf-ocr-required')!
  expect(blocker.severity).toBe('blocker')
  expect(blocker.message).toMatch(/page 3/)
  expect(blocker.message).toMatch(/OCR/)
  expect(blocker.message).toMatch(/Remove those pages|text layer/)
  // Exactly one page implicated, so the declared-and-until-now-dead field is
  // finally written — and only in the one case where a single number is not a lie.
  expect(blocker.sourcePage).toBe(3)
})

test('a mixed document blocks on its scanned pages while only warning about its figures', () => {
  /*
   * THE BOUNDARY, in one document. The figure on page 2 is a gap in a page a
   * reader can still read; page 5 is a page with no content at all, and
   * publishing it would ship a blank Canvas page where a chapter section should
   * be. One document, two verdicts, and the blocker must not swallow the warning.
   */
  const findings = pdfFindings(
    detection({ pdfType: 'Mixed', pageCount: 6, pagesNeedingOcr: [5], ocrReasonsByPage: [{ page: 5, reasons: ['scanned'] }] }),
    [read(1), read(2, 1), read(3), read(4), read(6)],
  )
  expect(findings.find((finding) => finding.code === 'pdf-ocr-required')?.severity).toBe('blocker')
  expect(findings.find((finding) => finding.code === 'pdf-figure-not-imported')?.severity).toBe('warning')
  // Page 5 is named by the blocker and must NOT also be reported as a blank page.
  expect(findings.some((finding) => finding.code === 'pdf-page-empty')).toBe(false)
})

test('a wholly scanned document names every page', () => {
  const findings = pdfFindings(detection({ pdfType: 'Scanned', pageCount: 3, pagesNeedingOcr: [1, 2, 3] }), [])
  expect(findings.find((finding) => finding.code === 'pdf-ocr-required')!.message).toMatch(/pages 1–3/)
})

test('an unrecognised pdfType is treated as not text-based', () => {
  // Fail closed: a value nobody has seen is not evidence that the text is fine.
  const findings = pdfFindings(detection({ pdfType: 'SomethingNew', pageCount: 2 }), [read(1), read(2)])
  expect(findings.find((finding) => finding.code === 'pdf-ocr-required')?.severity).toBe('blocker')
})

test('a page that produced nothing and was not flagged for OCR warns rather than blocks', () => {
  // Measured: a blank page leaves `pagesNeedingOcr` empty while a scanned page
  // does not. This bucket is blank paper — a chapter divider, the back of a
  // title page — and refusing to import a book because it has one would be a
  // refusal that protects nobody.
  const findings = pdfFindings(detection({ pageCount: 3 }), [read(1), read(3)])
  const empty = findings.find((finding) => finding.code === 'pdf-page-empty')!
  expect(empty.severity).toBe('warning')
  expect(empty.message).toMatch(/page 2/)
  expect(empty.sourcePage).toBe(2)
})

test('columns and tables raise one reading-order warning naming both', () => {
  const findings = pdfFindings(
    detection({ layout: { isComplex: true, pagesWithTables: [2], pagesWithColumns: [1, 2] } }),
    [read(1), read(2), read(3)],
  )
  const layout = findings.find((finding) => finding.code === 'pdf-reading-order')!
  expect(layout.severity).toBe('warning')
  expect(layout.message).toMatch(/pages 1, 2/)
})

test('a complex layout with no page numbers still warns', () => {
  // The fallback branch. Nothing in the module's type ties `isComplex` to the
  // arrays, so it is not known whether this is reachable at runtime; it is
  // covered here so it is not silently dead, and it must not name pages it
  // does not have.
  const findings = pdfFindings(
    detection({ layout: { isComplex: true, pagesWithTables: [], pagesWithColumns: [] } }),
    [read(1)],
  )
  expect(findings.find((finding) => finding.code === 'pdf-reading-order')!.message).not.toMatch(/page \d/)
})

test('reported encoding problems warn for the whole document', () => {
  const findings = pdfFindings(detection({ hasEncodingIssues: true } as never), [read(1)])
  expect(findings.find((finding) => finding.code === 'pdf-encoding')!.severity).toBe('warning')
})
```

`hasEncodingIssues` sits on `ParserProbeResult`, not on `ParserDetection` — `detectPdf` does not
report it. Pass it as a third argument to `pdfFindings` rather than faking it onto the detection, and
adjust the last test to match the signature you settle on.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/pdf-findings.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write it**

```ts
export interface PdfPageSummary {
  page: number
  /** Non-whitespace characters the sanitizer kept for this page. */
  textLength: number
  /** Module image placeholders found in this page's slice. */
  images: number
}

/*
 * `Scanned` and `ImageBased` mean the whole document is images of text.
 * Anything the module reports that is not one of the values this release has
 * seen is treated the same way, because an unrecognised classification is not
 * evidence that the text came out.
 */
const TEXT_BEARING_TYPES = new Set(['TextBased', 'Mixed'])
```

Rules, in the order the findings should appear:

1. **`pdf-ocr-required`, `blocker`.** Pages = `pagesNeedingOcr`, or every page `1..pageCount` when
   `pdfType` is not in `TEXT_BEARING_TYPES`. Message:

   ```
   `${count} of ${detection.pageCount} pages in this PDF are images of text with no text layer (${pages}). ` +
   'This release does not run OCR in the browser, so their content cannot be imported. ' +
   'Remove those pages, or supply a PDF with a text layer.'
   ```

   `pages` is `formatPageRanges(...)` prefixed `page ` or `pages `. Set `sourcePage` only when
   exactly one page is named — `ImportPlanEditor` keys findings on
   `` `${code}-${sectionId ?? ''}` ``, and a single number is the only case where one is not a lie.

2. **`pdf-figure-not-imported`, `warning`.** Pages with `images > 0`, excluding any page in the
   blocker's set. Message:

   ```
   `${figures} ${figures === 1 ? 'figure' : 'figures'} could not be imported (${pages}). ` +
   'This release cannot extract images from a PDF, so each one is marked in the page as ' +
   '"[Embedded image: Figure on page N]" and the text around it was kept. ' +
   'Add the figures in Canvas after importing these pages.'
   ```

   State the residual in a comment: a figure on a page that produced no text lands in the PRECEDING
   page's slice, because the text-less page emits no marker — measured. It is bounded, because a
   page with an image and no text is exactly the `scanned` case, so that document blocks anyway and
   the mis-attributed number never reaches a published page.

3. **`pdf-page-empty`, `warning`.** Every page in `1..pageCount` that has no summary row, or a row
   with `textLength === 0 && images === 0`, minus the blocker's pages. Message:

   ```
   `No text was extracted from ${count} ${count === 1 ? 'page' : 'pages'} (${pages}). ` +
   'Those pages are blank in the source, or nothing could be read from them. Nothing was imported for them.'
   ```

4. **`pdf-reading-order`, `warning`.** Pages = `pagesWithColumns` ∪ `pagesWithTables`. When both are
   empty and `layout.isComplex`, warn without page numbers. Message names the risk honestly — the
   module reports that a page HAS columns, not that the order came out wrong:

   ```
   `${count} ${count === 1 ? 'page uses' : 'pages use'} multiple columns or tables (${pages}). ` +
   'Column and table order is what a PDF extractor is most likely to get wrong. ' +
   'Read those pages in the preview before preparing them.'
   ```

5. **`pdf-encoding`, `warning`,** when `hasEncodingIssues`. Document-wide; the module reports no page
   numbers for it, so the message must not pretend to have any.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/pdf-findings.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/pdf-findings.ts src/import/pdf-findings.test.ts
git commit -m "feat: classify pdf pages into blocking and warning findings"
```

---

### Task 8: `importPdfDocument`

Assemble the parts: refuse by content, probe, bound the extracted text, split, sanitize per page,
concatenate, and report.

**Files:**
- Create: `src/import/pdf.ts`
- Create: `src/import/pdf.test.ts` (unit, with a stubbed probe)
- Modify: `src/import/types.ts` — only if `ImportResult` needs `sourcePages` for Task 11; leave it
  alone otherwise.

**Interfaces:**
- Produces: `importPdfDocument(file, options): Promise<ImportResult>`, taking the same
  `StructuredDocumentImportOptions` `importStructuredDocument` takes.
- Consumes: `probeParser`, `splitPdfMarkdown`, `withPageCaptions`, `sanitizeImportedMarkdown`,
  `pdfFindings`, `MAX_TEXT_IMPORT_BYTES`, `DOCUMENT_IMPORT_LIMITS`.

- [ ] **Step 1: Write the failing tests**

Stub the probe by injecting it (`options.probe ?? probeParser`, or a module-level dependency object
matching whatever pattern the neighbouring importers use) so this suite runs in `unit` without a
Worker.

```ts
test('a file that is not a pdf is refused on its content, not its name', async () => {
  const file = new File([new TextEncoder().encode('%ZIP-1.4 nope')], 'chapter.pdf', { type: 'application/pdf' })
  await expect(importPdfDocument(file, { metadata })).rejects.toThrow(/not a PDF/i)
  // Refused BEFORE a Worker started: no probe call was made at all.
  expect(probeCalls).toBe(0)
})

test('extracted text over the main-thread limit is refused, naming the limit', async () => {
  const oversize = 'x'.repeat(MAX_TEXT_IMPORT_BYTES + 1)
  await expect(importPdfDocument(pdfFile, { metadata, probe: stub({ markdown: oversize }) }))
    .rejects.toThrow(/2 MiB/)
})

test('a text-based pdf becomes one section of sanitized html with a page count', async () => {
  const result = await importPdfDocument(pdfFile, { metadata, probe: stub({
    markdown: '<!-- Page 1 -->\n\n# Chapter one\n\nText.\n\n<!-- Page 2 -->\n\nMore text.\n',
    detection: detection({ pageCount: 2 }),
  }) })
  expect(result.work.sections).toHaveLength(1)
  expect(result.work.sections[0]!.html).toContain('<h1>Chapter one</h1>')
  expect(result.work.sections[0]!.html).toContain('More text.')
  // Declared in `types.ts` since this issue was written and until now written nowhere.
  expect(result.report.pageCount).toBe(2)
  expect(result.report.parser).toBe('pdf-inspector')
  expect(result.work.assets).toEqual([])
})

test('a figure survives as a visible placeholder and a warning, and the page still publishes', async () => {
  const result = await importPdfDocument(pdfFile, { metadata, probe: stub({
    markdown: '<!-- Page 1 -->\n\nBefore.\n\n![Image: Im1](image)\n\nAfter.\n',
    detection: detection({ pageCount: 1 }),
  }) })
  expect(result.work.sections[0]!.html).toContain('[Embedded image: Figure on page 1]')
  expect(result.report.findings.every((finding) => finding.severity === 'warning')).toBe(true)
  expect(result.report.counts.images).toBe(1)
  expect(result.report.counts.unavailableAssets).toBe(1)
})

test('a pdf with no readable text at all fails the import outright', async () => {
  // There is no page to edit, no plan to review and nothing to publish, so this
  // belongs in the importer's error path — where the anydoc importer puts the
  // same condition — rather than as a blocker on an empty plan.
  await expect(importPdfDocument(pdfFile, { metadata, probe: stub({
    markdown: '', detection: detection({ pdfType: 'Scanned', pageCount: 3, pagesNeedingOcr: [1, 2, 3] }),
  }) })).rejects.toThrow(/OCR/)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/pdf.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the importer**

Order matters, and each step's position is the point:

```ts
/*
 * REFUSED ON CONTENT, NEVER ON THE EXTENSION. `importStructuredDocument` gets
 * this from `parsed.formatDetection === 'content'`, which the PDF Worker never
 * sets, so this path has to check for itself — and issue 09 settled that
 * refusal is content-based everywhere.
 *
 * Offset 0, no tolerance window. The spec permits junk before the header, but
 * the module itself does not: thirteen bytes of junk ahead of a valid header
 * produced "Not a PDF: file appears to be plain text". So this is parity with
 * the parser rather than a stricter rule invented here, and it needs no
 * scan-length constant nobody could justify.
 *
 * Read before the probe, because `probeParser` TRANSFERS the buffer into the
 * Worker and it is detached afterwards.
 */
const PDF_SIGNATURE = '%PDF-'
```

1. `options.signal?.throwIfAborted()`, `validateImportMetadata`.
2. `file.size > DOCUMENT_IMPORT_LIMITS.maximumInputBytes` → throw, wording matching `document.ts`.
3. `bytes = await file.arrayBuffer()`; check the signature; `sha256Hex(bytes)`.
4. `probeParser({ parser: 'pdf-inspector', bytes, formatHint: 'pdf', signal, onProgress })`.
5. `if (parsed.outputBytes > MAX_TEXT_IMPORT_BYTES) throw` — message reading the constant, in
   `text.ts:30`'s shape. Comment: the extracted Markdown reaches the same main-thread sanitizer,
   plan builder and live preview that constant was chosen for; the largest measured PDF output is
   267,931 bytes, so this refuses nothing real.
6. `splitPdfMarkdown(parsed.markdown ?? '')`; for each slice with non-whitespace content,
   `sanitizeImportedMarkdown(withPageCaptions(slice.markdown, slice.page), { deferImageFindings: true })`.
   **Skip whitespace-only slices** — sanitizing one raises `import-no-supported-content`, a blocker,
   for what is simply a page that printed nothing.
7. Sanitize `preamble` the same way when it has content, with no page number.
8. Concatenate the HTML in page order; if it is empty, throw. When the detection named OCR pages,
   the message is the blocker's message, so the importer's error says the same thing the plan
   editor would have.
9. Findings = `pdfFindings(detection, summaries, parsed.hasEncodingIssues)` first, then the
   per-slice sanitizer findings merged BY CODE, first message winning. Comment the residual: merging
   loses which page an `import-active-content-removed` came from, because `ImportPlanEditor` keys on
   `code` and duplicates would collide; the PDF-specific findings carry the page evidence criterion 2
   asks for.
10. Return `{ work, report }` in `document.ts`'s exact shape: one section, `assets: []`,
    `parser: 'pdf-inspector'`, `parserVersion: parsed.parserVersion`, `pageCount:
    parsed.detection?.pageCount`, `counts` summed across slices with `packagedAssetBytes: 0`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/pdf.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/pdf.ts src/import/pdf.test.ts
git commit -m "feat: import a text-based pdf through the shared markdown sanitizer"
```

---

### Task 9: Offer PDF in the document importer

`STRUCTURED_DOCUMENT_FILE_ACCEPT` filters on `status === 'enabled' && parser === 'anydoc'`, so
flipping the capability status alone surfaces nothing.

**Files:**
- Modify: `src/import/capability.ts`
- Modify: `src/components/DocumentImporter.tsx`
- Test: `src/import/capability.test.ts`, `src/components/DocumentImporter.browser.test.tsx`

**Interfaces:**
- Produces: `IMPORTABLE_DOCUMENT_CAPABILITIES`, `DOCUMENT_FILE_ACCEPT`, `DOCUMENT_FORMAT_SUMMARY`.
- The existing `ENABLED_ANYDOC_CAPABILITIES` and `STRUCTURED_DOCUMENT_FILE_ACCEPT` stay:
  `document.ts` uses the anydoc list to say which formats IT accepts, and that sentence must not
  start claiming PDF.

- [ ] **Step 1: Write the failing tests**

```ts
test('pdf is offered, and the accept string is not filtered to anydoc parsers', () => {
  expect(DOCUMENT_FILE_ACCEPT).toContain('.pdf')
  expect(DOCUMENT_FILE_ACCEPT).toContain('application/pdf')
  expect(DOCUMENT_FORMAT_SUMMARY).toMatch(/PDF/)
  // The anydoc-only list stays anydoc-only; `document.ts`'s refusal message
  // must not offer a format it cannot import.
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).not.toContain('.pdf')
})

test('the pdf limitation states the block/warn boundary a user is about to meet', () => {
  const pdf = capabilityForFormat('pdf')!
  expect(pdf.status).toBe('enabled')
  expect(pdf.limitations.join(' ')).toMatch(/scanned/i)
  expect(pdf.limitations.join(' ')).toMatch(/figure/i)
})
```

and in the browser test, selecting a PDF file and inspecting it reaches the plan editor.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/capability.test.ts`
Expected: FAIL — `pdf` is `probe-only` and the constants do not exist.

- [ ] **Step 3: Enable and widen**

```ts
    status: 'enabled',
    limitations: [
      'Scanned pages have no text to import and block completion; this release does not run OCR in the browser.',
      'Figures are marked in place but not imported — add them in Canvas afterwards.',
      'Multi-column and table reading order needs review.',
    ],
```

```ts
/*
 * Every format the file picker offers: anydoc's four plus PDF. Separate from
 * `ENABLED_ANYDOC_CAPABILITIES` because that list answers a different question —
 * which formats `importStructuredDocument` itself handles — and its answer
 * appears in that function's refusal message.
 */
export const IMPORTABLE_DOCUMENT_CAPABILITIES = DOCUMENT_FORMAT_CAPABILITIES.filter(
  (entry) => entry.status === 'enabled' && entry.parser !== 'native',
)
export const DOCUMENT_FILE_ACCEPT = /* extensions + media types, joined */
export const DOCUMENT_FORMAT_SUMMARY = /* the same shape as STRUCTURED_DOCUMENT_FORMAT_SUMMARY */
```

- [ ] **Step 4: Route the file**

In `DocumentImporter.inspect`, choose the importer from the capability rather than the extension:

```ts
      /*
       * Routed on the capability's PARSER, not on the file name, so the table in
       * `capability.ts` stays the single place that says which module reads
       * which format. Imported lazily for the same reason the probes are: the
       * PDF module pulls in the split, findings and sanitizer path, and a user
       * importing a DOCX should not pay for it.
       */
      const imported = selectedCapability?.parser === 'pdf-inspector'
        ? await (await import('../import/pdf')).importPdfDocument(file, importOptions)
        : await importStructuredDocument(file, importOptions)
```

and swap the `accept` and the help text over to the new constants.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run --project unit src/import/capability.test.ts && npx vitest run --project browser src/components/DocumentImporter.browser.test.tsx`
Expected: PASS. `DocumentImporter.browser.test.tsx` carries one of the two known intermittent
flakes — if a failure is in an unrelated existing case, rerun and say so.

- [ ] **Step 6: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/capability.ts src/import/capability.test.ts src/components/DocumentImporter.tsx src/components/DocumentImporter.browser.test.tsx
git commit -m "feat: offer pdf import in the document importer"
```

---

### Task 10: Prove it end to end — blocking blocks, cancellation, audited-byte parity

Three properties that only a real browser can demonstrate, and that asserting a finding exists does
not.

**Files:**
- Create: `src/import/pdf.browser.test.ts`
- Modify: `src/components/ImportPlanEditor.browser.test.tsx` (or the existing plan-editor browser
  suite, whichever holds the confirm-control assertions)

- [ ] **Step 1: Write the tests**

```ts
test('a scanned pdf leaves nothing publishable, not merely a finding', async () => {
  /*
   * Criterion 4 is about the second half of that sentence. `ImportPlanEditor`
   * disables the confirm control on `blockers.length > 0`, and that ONE
   * `disabled` attribute is the entire enforcement point: `confirmImport`
   * never inspects severity and `buildPlan` takes no findings at all. So this
   * asserts the control, not the finding.
   */
  const file = new File([pdfFixturePages(['text', 'scanned', 'text'])], 'chapter.pdf', { type: 'application/pdf' })
  const imported = await importPdfDocument(file, { metadata })
  render(<ImportPlanEditor draft={createImportDraft(imported)} /* real props */ />)
  expect(screen.getByRole('button', { name: /prepare|confirm/i })).toBeDisabled()
  expect(screen.getByText(/images of text with no text layer/)).toBeInTheDocument()
})

test('a pdf with a figure stays publishable, and says where the figure was', async () => {
  const file = new File([pdfFixturePages(['text', 'text-and-figure'])], 'chapter.pdf', { type: 'application/pdf' })
  const imported = await importPdfDocument(file, { metadata })
  render(<ImportPlanEditor draft={createImportDraft(imported)} /* real props */ />)
  expect(screen.getByRole('button', { name: /prepare|confirm/i })).toBeEnabled()
  expect(screen.getByText(/Embedded image: Figure on page 2/)).toBeInTheDocument()
})

test('cancelling a pdf import stops the parse', async () => {
  // The benchmark records one cancellation per browser profile, not per fixture,
  // so it is not proven that the cancelled parse was ever the PDF one.
  const controller = new AbortController()
  const running = importPdfDocument(bigPdfFile, { metadata, signal: controller.signal })
  controller.abort()
  await expect(running).rejects.toMatchObject({ name: 'AbortError' })
})

test('a text-based pdf exports the exact bytes the gate audited', async () => {
  const file = new File([pdfFixture(3, 'Parity')], 'chapter.pdf', { type: 'application/pdf' })
  const imported = await importPdfDocument(file, { metadata })
  const confirmed = confirmImport(imported, createImportDraft(imported).plan, metadata)
  const compiled = await compileAndAuditChapter(toChapter(confirmed.work), { profile: DOCUMENT })
  const entries = buildCartridge([compiled])
  for (const [index, section] of compiled.sections.entries()) {
    const published = new TextDecoder().decode(entryFor(entries, section).data)
    expect(published).toContain(auditedHtml(section))
    expect(index).toBeGreaterThanOrEqual(0)
  }
})
```

Follow `src/import/packaged-cartridge.browser.test.ts` for the pipeline calls and the entry lookup
rather than inventing a second way to build a cartridge.

- [ ] **Step 2: Run them**

Run: `npx vitest run --project browser src/import/pdf.browser.test.ts`
Expected: PASS. A parity failure means something rewrote html after the gate — stop and find it; do
not relax the assertion.

- [ ] **Step 3: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/pdf.browser.test.ts src/components/
git commit -m "test: prove pdf blockers block, cancellation stops, and audited bytes ship"
```

---

### Task 11: Label split points with the PDF page they start

The only task here that no acceptance criterion depends on. If time runs out, stop after Task 10 and
say so — criterion 2's page-specific evidence lives in the findings, not in the split picker.

**Files:**
- Modify: `src/import/types.ts` (`ImportResult`), `src/import/page-plan.ts`, `src/import/pdf.ts`,
  `src/components/ImportPlanEditor.tsx`
- Test: `src/import/page-plan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('a split point that starts a pdf page says so', () => {
  const plan = proposePagePlan(work, [{ page: 1, firstBlock: 0 }, { page: 12, firstBlock: 3 }])
  expect(splitPoints(plan.plan, plan.plan.pages[0]!).map((point) => point.label))
    .toEqual(['Paragraph: …', 'Paragraph: …', 'Page 12 — Heading: …'])
})
```

- [ ] **Step 2: Carry the map**

`ImportResult` gains an optional third field rather than hiding a structural map inside `report`,
which is a record of what happened, not of where things are:

```ts
  /**
   * Where each source page began, as an index into the blocks
   * `proposePagePlan` will derive from `work.sections`. PDF only.
   *
   * A PDF page is a PHYSICAL unit — where the paper ended — and a Canvas page
   * is a semantic one, so these are split-point LABELS, never page boundaries.
   * `MAX_PROPOSED_PAGES` is 100 and `maximumPdfPages` is 200: proposing one
   * Canvas page per sheet would make the page-plan budget's fallback the normal
   * case for exactly the documents this feature exists for.
   */
  sourcePages?: readonly { page: number; firstBlock: number }[]
```

`pdf.ts` builds it from the per-slice block counts. `page-plan.ts` exports the block counter it
already has so `pdf.ts` counts blocks the same way `proposePagePlan` does — two different counts
would misattribute every label. `createImportDraft` passes `source.sourcePages` through.

- [ ] **Step 3: Run, then run the whole suite and commit**

```bash
npx vitest run --project unit src/import/page-plan.test.ts
npm run typecheck && npx vitest run
git add src/import/types.ts src/import/page-plan.ts src/import/page-plan.test.ts src/import/pdf.ts src/components/ImportPlanEditor.tsx
git commit -m "feat: label split points with the pdf page they start"
```

---

### Task 12: Measure the second parse, and close the issue

**Files:**
- Modify: `scripts/benchmark-document-parsers.mjs`, `src/import/limits.ts`
- Modify: `.scratch/document-import/issues/11-import-text-based-pdfs.md`,
  `.scratch/document-import/map.md`

- [ ] **Step 1: Record the detect phase in the benchmark**

The two-phase design was justified on a Node measurement (9.8 ms against 106.6 ms on the 200-page
fixture). The committed evidence is a browser measurement, and that is what
`DOCUMENT_IMPORT_LIMIT_EVIDENCE` cites. Add a `detectMs` alongside `parseMs` for the PDF fixtures and
regenerate the report, so the claim in the design's amendment is backed by the same kind of evidence
every other budget is.

- [ ] **Step 2: Resolve the issue**

Tick all six criteria in `.scratch/document-import/issues/11-import-text-based-pdfs.md`, each with
the file and test that closes it. Add an `## Answer` recording: the block/warn boundary and why
figures warn; that page provenance comes from reading marker numbers because a text-less page emits
none; that `detectPdf` moved the page budget ahead of the parse; and the residuals listed under
*Open questions* below. Set `Status: resolved` and move the frontier in `.scratch/document-import/map.md`.

- [ ] **Step 3: Commit**

```bash
npm run typecheck && npx vitest run
git add scripts/benchmark-document-parsers.mjs src/import/limits.ts docs/evidence/ .scratch/document-import/
git commit -m "docs: record the detect-phase measurement and resolve issue 11"
```

---

## Open questions

Settled here, with the evidence, so an implementer does not re-open them:

- **What `confidence` measures** — measured 0–1, and for a `TextBased` document it tracked the
  fraction of pages that produced text in four separate measurements (3/3 = 1.00, 2/3 = 0.67,
  3/4 = 0.75, 1/2 = 0.50); `Scanned` reported 0.90 and `Mixed` 0.70. It is not a per-page quality
  score, and for the text-based case it is redundant with the marker gaps this plan computes. Carried
  as diagnostics on `ParserDetection`; **no decision is taken on it**.
- **How many page numbers a finding may name** — all of them, as ranges. The worst case is bounded by
  `maximumPdfPages` (200, and now enforced BEFORE extraction), so a pathological document names at
  most 100 ranges, and `markup.ts`'s `describe()` already enumerates without truncating. A truncation
  threshold would be a number with nothing behind it.
- **Whether `detectPdf` is cheap enough to run first** — yes, about a tenth of `processPdf`
  (Task 12 confirms it in a browser). And the phase order is required for correctness independently
  of cost, since a scanned document must be recognised without extracting its empty pages.
- **Whether the module throws structured errors** — no. Thrown values are plain `Error`s with no own
  keys. The regexes stay; Task 2's fixtures pin the measured messages.
- **Whether `ocrReasonsByPage[].reasons` may be shown to a user** — no. The observed values are
  `no_text` and `scanned`: identifiers, not English. Carried in the detection, kept out of messages.
- **Whether a blank page blocks** — no. Measured: a genuinely empty page leaves `pagesNeedingOcr`
  empty while a page carrying only a decodable image does not. Blank warns, scanned blocks.

**Escalate rather than guess:**

1. **Is a graded extraction-poor threshold wanted?** The zero boundary catches a page that yielded
   nothing. It does not catch a page that yielded three garbled words. A characters-per-page floor is
   a product decision needing real PDFs; there is no evidence in this repo to derive one from, and
   `confidence` is not it. Do not invent one to make a task look finished.
2. **Is the blank-page warning right for a document with MANY blank pages?** One `pdf-page-empty`
   warning naming forty pages is honest and useless. There is no evidence for a count at which it
   should become something else, so it stays a single warning; escalate if a real document makes it
   unreadable.

**Known residuals, recorded rather than fixed:**

- **`encrypted` and `malformed` are still decided by a regex over an English error message.** The
  experiment that would have removed them was run and came back negative: no `code` on the thrown
  value. So an upstream wording change still silently downgrades the non-retryable `encrypted` to the
  retryable `parse-failed`, telling a user to retry a file that can never succeed. Task 2's fixtures
  turn that from silent into a red test, which is the most this plan can do. Task 3 fixes the
  adjacent case — `"Not a PDF: …"` was falling through to the retryable default.
- **A figure on a page that produced no text is attributed to the previous page**, because a
  text-less page emits no marker and its image placeholder lands in the preceding slice — measured.
  Bounded: a page with an image and no text is the `scanned` case, so the document blocks and the
  mis-attributed number never reaches a published page.
- **Sanitizer findings are merged by code across pages**, so `import-active-content-removed` loses
  which page it came from. `ImportPlanEditor` keys findings on `code`, so duplicates would collide;
  the PDF-specific findings carry the page evidence instead.
- **`layout.isComplex` with both page arrays empty** may be unreachable. The fallback branch is
  covered by a unit test so it is not silently dead, but nothing in the module's type ties the flag
  to the arrays and no fixture has produced that combination.
- **Only one enforcement point stands behind the OCR blocker.** `ImportPlanEditor` disables the
  confirm control; `confirmImport` never inspects severity, and `buildPlan` takes no findings at all.
  Widening that is a change to how every existing import blocker behaves, not a PDF concern. Task 10
  asserts the control rather than the finding, which is the most this issue should do about it.
