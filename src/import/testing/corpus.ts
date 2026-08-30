import type { ImportedFormat } from '../types'
import { semanticDocxFixture } from './docx-fixture'
import {
  semanticEpubFixture,
  semanticOdtFixture,
  semanticRtfFixture,
} from './structured-document-fixtures'
import { pdfFixture } from './pdf-fixture'
import { pptxFixture } from './presentation-fixtures'

const utf8 = (value: string) => new TextEncoder().encode(value)

/**
 * The corpus this release's support claim rests on.
 *
 * Synthetic and committed, deliberately. Real documents were considered and
 * rejected: they add repo weight, licensing bookkeeping, and fixtures whose
 * meaning changes silently when replaced. The price of generating them is that
 * a reader cannot see what a case is FOR — so `standsInFor` is required, and a
 * test enforces it.
 *
 * COVERAGE SHAPE. Every one of the nine released file formats
 * (`RELEASED_SOURCES` in `../released-sources.ts`) gets its own semantic
 * case — an ordinary document in that format, proving the parser handles the
 * shape it will actually see most often. Beyond that baseline, six
 * structural properties (deep heading nesting, a merged-cell table,
 * footnotes, RTL/CJK text, an equation, and large-but-legal size) are
 * exercised on TWO formats only: DOCX, the richest of the four builders this
 * corpus already has, and EPUB, the other zip-plus-XML format with a
 * genuinely different internal structure (real XHTML rather than a
 * word-processor grammar). These properties test what survives the SHARED
 * normalization path downstream of each parser — `anydoc-html.ts`'s
 * `normalizeAnyDocDocument`, which every non-native format funnels through —
 * not the parser's own format-specific plumbing, so two structurally
 * different carriers are enough evidence without paying for all nine.
 *
 * PPTX does not repeat that DOCX/EPUB structural set — a
 * DOCX-shaped "merged cell" or "footnote" property would not exercise
 * anything a deck actually does — but they are not left at the semantic
 * baseline either. `presentation/reconcile.ts` is a second reconciliation
 * pass downstream of anydoc, unique to the presentation formats, and it has its own
 * failure modes worth a case each: a slide with no title
 * (`pptx-untitled-slide`), speaker notes that must not publish
 * (`pptx-speaker-notes`), and content anydoc drops with
 * no block at all (`pptx-unrepresentable`). `pptx-slideshow-container` and
 * `pptx-macro-container` cover the PPTX-family container variants
 * (`presentation.browser.test.ts` covers the remaining `.ppsm` extension
 * directly). Every one of these six also asserts `expectFindings`, not just
 * `expectInHtml`: an importer that silently dropped the finding a construct
 * is supposed to raise would still pass a check that only looked at the html.
 *
 * `pptx-packaged-image` is the SEVENTH pptx case (there are seven
 * `format: 'pptx'` cases in this file). It is placed FIRST among them rather
 * than after `pptx-semantic`, for a reason specific to
 * `cartridge-artifact.browser.test.ts`: that suite runs the real export
 * pipeline and a real `unzip` against only the FIRST case per format, so a
 * described image has to lead each format's cases for the real
 * parse-compile-cartridge-zip path to ever package a slide's own picture, not
 * merely the synthetic asset `engine/export/cartridge.test.ts` already
 * unit-tests. See that suite's own module comment for the full reasoning.
 *
 * The seventh structural property the design considered, a hostile
 * construct, is deliberately NOT reproduced here: `security.browser.test.ts`
 * already pins the archive-bomb and active-content refusals this release
 * depends on, and duplicating that coverage here would just be two places
 * that could drift apart.
 *
 * NOT IMPORTED HERE. This module and its own test only check the corpus's
 * shape — every released format is covered, every case names what it stands
 * for, every id is unique. Actually running each case through its parser and
 * asserting `expectInHtml` (and `expectBlockers`) survived is
 * `../corpus.browser.test.ts`'s job, which imports `CORPUS_CASES` from this
 * file and drives every one of them through the real parser dispatch.
 */
export interface CorpusCase {
  id: string
  format: ImportedFormat
  /** The real-world property this case exists to represent. Required. */
  standsInFor: string
  bytes: () => Promise<Uint8Array<ArrayBuffer>>
  /** Substrings the imported html must contain, proving the structure survived. */
  expectInHtml: readonly string[]
  /**
   * Substrings the imported html must NOT contain. Presence is not enough for a
   * case whose whole point is that something was excluded: a notes case would
   * pass `expectInHtml` while still leaking the note.
   */
  expectNotInHtml?: readonly string[]
  /**
   * Finding codes this case is EXPECTED to block on, if any.
   *
   * Declared per case rather than asserting no case blocks, because some
   * constructs legitimately do — a DOCX footnote and an equation both raise
   * blockers, verified against anydoc 0.2.4 on 2026-08-29. Declaring them makes
   * this list the machine-readable record of WHICH constructs a released format
   * cannot publish, which is what criterion 1 needs; a blanket "nothing blocks"
   * assertion would simply have been false.
   */
  expectBlockers?: readonly string[]
  /**
   * Finding codes this case is EXPECTED to raise at `warning` severity, if any.
   *
   * `expectBlockers` alone leaves every `warning`-severity finding
   * (`presentation-untitled-slide`, `presentation-speaker-notes`,
   * `presentation-reading-order`, `presentation-unrepresentable`) unchecked by
   * this corpus: fix-review round 1 proved that gap by deleting the
   * `presentation-unrepresentable` finding from `reconcile.ts` entirely and
   * watching the corpus stay green. Asserted the same way as `expectBlockers` —
   * the exact set, both directions — because the issue's fourth acceptance
   * criterion is that specific constructs "produce specific findings and
   * limitations", which an assertion that only checks blockers cannot carry.
   */
  expectFindings?: readonly string[]
}

// Four times the 1,000-paragraph fixture `document.browser.test.ts` already
// builds for its "long corpus remains ordered" case — chosen to be plainly
// bigger than every other case in this corpus (all single- or low-double-digit
// digit block counts) while staying fast. It is NOT chosen to approach
// `DOCUMENT_IMPORT_LIMITS.maximumInputBytes` (16 MiB) in actual file bytes:
// DOCX and EPUB are zip containers, and even numbered-paragraph prose — not
// literally identical, but repetitive at the scale DEFLATE's window sees —
// compresses far faster than it grows. Measured empirically, 4,000 paragraphs
// of the shape this file generates produce roughly 13 KB of DOCX and 12 KB of
// EPUB, nowhere close to the 16 MiB ceiling. Reaching that ceiling with
// content a reader would recognize as an actual chapter would need a fixture
// too large to keep committed and a test too slow to keep in this suite; the
// byte ceiling itself is already pinned exactly, at `maximumInputBytes + 1`,
// by `file.test.ts` and `security.browser.test.ts`. What THIS case proves is
// narrower and does not need the literal byte count: that a document with far
// more content than anything else in the corpus still imports, in order,
// without some unrelated per-block or per-node limit firing first.
const LARGE_BUT_LEGAL_PARAGRAPHS = 4_000

export const CORPUS_CASES: readonly CorpusCase[] = [
  // ===== One semantic case per released file format ==================

  {
    id: 'text-semantic',
    format: 'text',
    standsInFor: 'A quick unformatted note saved as .txt — blank-line paragraphs and internal line breaks are the only structure plain text can carry, so this is the shape the native text path must never mangle.',
    bytes: async () => utf8(
      'Office hours are Tuesdays and Thursdays.\nRoom 214B, no appointment needed.\n\n' +
      'Bring your lab notebook and a calculator.',
    ),
    // `semanticHtml` in `text.ts` joins one paragraph's internal lines with
    // `<br>` and starts a new `<p>` at each blank line — verified against its
    // own source, which this fixture's blank-line placement is built to hit.
    expectInHtml: ['<br>', 'Office hours are Tuesdays and Thursdays.', 'Bring your lab notebook and a calculator.'],
  },
  {
    id: 'markdown-semantic',
    format: 'markdown',
    standsInFor: 'A syllabus or reading written in Markdown, the format an instructor is most likely to author fresh rather than convert from something else — headings, a link, and a GFM table must all survive `marked`\'s parse and the shared HTML sanitizer.',
    bytes: async () => utf8(
      '# Cell Biology\n\n' +
      'Cells are organized. [Read the cell guide](https://example.edu/cells)\n\n' +
      '| Structure | Function |\n| --- | --- |\n| Nucleus | Stores DNA |\n',
    ),
    // Verified empirically with `marked` directly: this exact source produces
    // an `<h1>`, the paragraph and link text, and a `<table>` with `<th>`/`<td>`
    // rows — the same substrings the DOCX/EPUB/ODT semantic cases check.
    expectInHtml: ['<h1>', 'Cell Biology', '<table'],
  },
  {
    id: 'html-semantic',
    format: 'html',
    standsInFor: 'An HTML export from another authoring tool — the format most likely to arrive with markup this importer must sanitize rather than merely parse, so headings and a table need to survive `sanitizeImportedHtml`, not just a naive DOM read.',
    bytes: async () => utf8(
      '<h1>Cell Biology</h1>' +
      '<p>Cells are organized. <a href="https://example.edu/cells">Read the cell guide</a></p>' +
      '<table><tr><th>Structure</th><th>Function</th></tr><tr><td>Nucleus</td><td>Stores DNA</td></tr></table>',
    ),
    expectInHtml: ['<h1>', 'Cell Biology', '<table'],
  },
  {
    id: 'docx-semantic',
    format: 'docx',
    standsInFor: 'An ordinary teaching handout: headings, paragraphs, a link, and a table — the shape most instructor documents actually have.',
    bytes: () => semanticDocxFixture(),
    expectInHtml: ['<h1>', 'Cell Biology', '<table'],
  },
  {
    id: 'epub-semantic',
    format: 'epub',
    standsInFor: 'A chapter exported from an OER platform, where styling is carried in CSS this importer discards and structure must survive without it.',
    bytes: () => semanticEpubFixture(),
    // Verified empirically against anydoc 0.2.4: the default fixture also
    // emits a `<table>`, which the DOCX semantic case already checks and
    // this one did not. `'<h1>'` (WITH the closing bracket, unlike the RTF
    // and ODT cases) is intentional, not an inconsistency left behind by
    // accident: the real output is two `<h1>` elements — a bare
    // `<h1>Biology Reader</h1>` from the EPUB's own book-title heading,
    // then `<h1 id="EPUB-chapter.xhtml-cell-biology">Cell Biology</h1>` for
    // the actual chapter heading. The exact `'<h1>'` substring is
    // genuinely present (matching the bare title heading), so it is left
    // as-is; the separate `'Cell Biology'` fragment is what proves the
    // chapter heading's text survived, regardless of which `<h1>` carries
    // an id.
    expectInHtml: ['<h1>', 'Cell Biology', '<table'],
  },
  {
    id: 'odt-semantic',
    format: 'odt',
    standsInFor: 'A document authored in LibreOffice, whose visual layout is not reproducible and whose semantics must come through anyway.',
    bytes: () => semanticOdtFixture(),
    // `<h1`, not `<h1>`: verified empirically against anydoc 0.2.4 that ODT's
    // `<text:h>` heading gets an `id` attribute in the output (e.g.
    // `<h1 id="Cell-Biology">`), unlike the DOCX-semantic case's heading,
    // which carries no id. (EPUB's own "Cell Biology" heading also gets an
    // id — see the epub-semantic case above — so this is not unique to
    // ODT; it just happens not to be true of DOCX.) Other tests in this
    // suite (`structured-formats.browser.test.ts`, `document.browser.test.ts`)
    // confirm an id is not part of what "a heading survived" means: they
    // select on the `h1` tag name and ignore attributes entirely. An exact
    // `<h1>` match here would assert something this corpus case never
    // claimed to prove.
    expectInHtml: ['<h1', 'Cell Biology'],
  },
  {
    id: 'rtf-semantic',
    format: 'rtf',
    standsInFor: 'An older handout saved as RTF, the format most likely to arrive with flattened drawings and no reliable structure.',
    // `semanticRtfFixture` is synchronous — unlike the other three structured
    // builders — because RTF has no zip container to await; wrapped in an
    // async thunk so its shape matches `CorpusCase.bytes` regardless.
    bytes: async () => semanticRtfFixture(),
    // A bare-text check alone would let a regression that flattened every
    // RTF structural element into plain paragraphs — dropping the
    // style-to-heading mapping, the list, and the table — pass silently,
    // which matters most for exactly this case: RTF is the format this
    // corpus case calls out as "most likely to arrive with flattened
    // drawings and no reliable structure." Verified empirically against
    // anydoc 0.2.4: the real output is
    // `<h1>Cell Biology</h1>...<ul><li><p>Membrane</p></li>...</ul>...
    // <table><thead>...<th scope="col">...`. RTF's own `<h1>` carries no
    // id attribute (unlike ODT's and EPUB's), but `'<h1'` (no closing
    // bracket) is used anyway for consistency with the odt-semantic case
    // and the sibling browser tests, which select on tag name and ignore
    // attributes.
    expectInHtml: ['<h1', 'Cell Biology', '<ul', '<table'],
  },
  {
    id: 'pdf-text-multipage',
    format: 'pdf',
    standsInFor: 'A multi-page text-based PDF chapter: the case PDF import exists for, where page markers drive the split and every page must produce text.',
    bytes: async () => pdfFixture(3, 'Corpus'),
    expectInHtml: ['Corpus page 1', 'Corpus page 3'],
  },
  {
    /*
     * Placed BEFORE `pptx-semantic` deliberately, not appended after it:
     * `cartridge-artifact.browser.test.ts` takes the FIRST case seen per
     * format as its one real-export-and-`unzip` case for that format, and no
     * other case in this corpus (for ANY format) puts an image on the page
     * that first case exports. `engine/export/cartridge.test.ts` already
     * unit-tests `web_resources/` packaging against a synthetic, hand-built
     * asset, but that never proves the real path — anydoc parse →
     * `presentation/reconcile.ts` → compile → `buildCartridge` → a real
     * zip — actually carries a slide's own picture into the archive a real
     * `unzip` can open. Putting this case first is what makes that path a
     * cartridge-artifact case at all, for pptx or any other format.
     */
    id: 'pptx-packaged-image',
    format: 'pptx',
    standsInFor: 'A deck with a described image, proving slide media packages into web_resources like every other format — exercised end to end (real parse, real compile, real cartridge, real unzip) rather than only at the unit level `cartridge.test.ts` already covers with a synthetic asset.',
    bytes: () => pptxFixture([{ title: 'Diagram slide', image: { alt: 'A labelled chloroplast' } }]),
    // `<img` alone would also pass for an UNpackaged reference (a raw
    // openstax.org-style URL); `$IMS-CC-FILEBASE$/oer2canvas/` (`FILEBASE` in
    // `import/assets.ts`) is the token `prepareAssets` writes only once a
    // picture has actually been packaged, so its presence is what actually
    // proves this. The alt text is pinned too: it is what carries the image
    // past the accessibility audit's decorative/alt gate into the cartridge
    // at all — an image `expectInHtml` proved present but whose alt silently
    // regressed to empty would still block the audit, not merely look wrong.
    expectInHtml: ['Diagram slide', '<img', '$IMS-CC-FILEBASE$/oer2canvas/', 'A labelled chloroplast'],
  },
  {
    id: 'pptx-semantic',
    format: 'pptx',
    standsInFor: 'An ordinary lecture deck exported from PowerPoint: a titled slide with bulleted body text, and a second slide carrying a data table — proving the reconciler turns anydoc\'s flat output into one section per slide without losing either shape.',
    bytes: () => pptxFixture([
      { title: 'Photosynthesis', body: ['Light reactions', 'Calvin cycle'] },
      { title: 'Where it happens', table: true },
    ]),
    expectInHtml: ['<section data-slide="1"', '<section data-slide="2"', 'Photosynthesis', '<table'],
  },
  {
    id: 'pptx-untitled-slide',
    format: 'pptx',
    standsInFor: 'A deck with a slide that carries only a text box — the case where anydoc alone loses the slide boundary entirely and content silently joins the previous slide.',
    bytes: () => pptxFixture([
      { title: 'First slide' },
      { body: ['Body of an untitled slide'] },
      { title: 'Third slide' },
    ]),
    expectInHtml: ['<section data-slide="2"', 'Slide 2'],
    // `reconcile.ts` raises `presentation-untitled-slide` (severity `warning`)
    // whenever a slide's title is empty — verified empirically for this exact
    // fixture, which is the only one in the corpus authoring an untitled slide.
    expectFindings: ['presentation-untitled-slide'],
  },
  {
    id: 'pptx-speaker-notes',
    format: 'pptx',
    standsInFor: "A deck whose author wrote private presenter reminders — the case where importing anydoc's output verbatim would publish them to students.",
    bytes: () => pptxFixture([
      { title: 'Photosynthesis', body: ['Light reactions'], notes: 'Do not read this to the class.' },
    ]),
    expectInHtml: ['<section data-slide="1"', 'Photosynthesis'],
    expectNotInHtml: ['Do not read this to the class.'],
    // `reconcile.ts` raises `presentation-speaker-notes` (severity `warning`)
    // whenever a slide's notes text is present but excluded from the page —
    // verified empirically for this fixture.
    expectFindings: ['presentation-speaker-notes'],
  },
  {
    id: 'pptx-unrepresentable',
    format: 'pptx',
    // Measured, not assumed (fix-review round 1 caught the first draft
    // asserting the opposite): the diagram and chart vanish entirely — no
    // block, no asset, only the index's own record that they existed — but
    // the video is different. PowerPoint always gives a video a poster frame
    // (an ordinary embedded picture in the same `p:pic`, see `video` on
    // `PptxSlideSpec`), and anydoc packages that picture like any other, so
    // the deck imports a real `<img>` for it. What is actually lost is the
    // MOTION: the index is the only place recording that a video, not a
    // still, was ever there.
    standsInFor: 'A deck whose slide carries a SmartArt diagram, a chart, and a video: the diagram and chart drop with no block and no asset at all, while the video leaves only its still poster frame, so the index is the only account that a video (not a picture) was ever on the slide.',
    bytes: () => pptxFixture([
      { title: 'Process overview', diagram: true, chart: true, video: true },
    ]),
    // `<img` proves the poster frame's picture survived; verified empirically
    // against the real reconciler output (see the standsInFor comment above).
    expectInHtml: ['<section data-slide="1"', 'Process overview', '<img'],
    // `reconcile.ts` raises `presentation-unrepresentable` (severity
    // `warning`) whenever the index counts a diagram, chart, or media the
    // slide's own html does not account for — the video still counts here
    // even though its poster picture imports, because the MEDIA itself (not
    // the still) is what anydoc cannot represent. Verified empirically: fix-
    // review round 1 proved this assertion is load-bearing by deleting the
    // finding in `reconcile.ts` and confirming the corpus went green without
    // it, which is exactly the gap `expectFindings` exists to close.
    expectFindings: ['presentation-unrepresentable'],
  },
  {
    id: 'pptx-slideshow-container',
    format: 'pptx',
    // `importCorpusCase` always names the file `corpus.pptx` (the first
    // extension `capability.extensions` lists for the format), so this case
    // never actually presents a `.ppsx` FILENAME to the importer — extension
    // acceptance for the real file extension is `presentation.browser.test.ts`'s
    // job, with a real `.ppsm`. What this case exercises instead is the
    // slideshow container's own main-part CONTENT TYPE
    // (`application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml`,
    // written by `pptxFixture`'s `container: 'ppsx'` option) being recognized
    // by anydoc's own content sniffing as the same `pptx` format the ordinary
    // presentation container reports.
    standsInFor: "A deck saved as PowerPoint's slideshow container rather than its presentation container, proving anydoc's own content sniffing recognizes the slideshow main-part content type as the same format, rather than anything about the .ppsx file extension.",
    bytes: () => pptxFixture([{ title: 'Slideshow deck' }], { container: 'ppsx' }),
    expectInHtml: ['<section data-slide="1"', 'Slideshow deck'],
  },
  {
    id: 'pptx-macro-container',
    format: 'pptx',
    standsInFor: 'A macro-enabled .pptm carrying a vbaProject part, proving a macro deck imports its slides and nothing of its macro.',
    bytes: () => pptxFixture([{ title: 'Macro deck' }], { container: 'pptm', withMacroPart: true }),
    expectInHtml: ['<section data-slide="1"', 'Macro deck'],
    // The half of the claim that actually matters for safety: `pptxFixture`'s
    // `withMacroPart` writes `ppt/vbaProject.bin` containing this literal
    // string (see `presentation-fixtures.ts`), so its presence in the
    // imported html would mean the macro's own bytes reached a published
    // page rather than merely being carried, unread, inside the zip.
    expectNotInHtml: ['macro payload placeholder'],
  },
  /*
   * NO `odp-*` CASES, and their absence is issue 14's verdict rather than an
   * omission. This corpus is evidence for what `RELEASED_SOURCES` claims, and
   * ODP is `status: 'probe-only'` in `../capability.ts` — measured 2026-08-30
   * to publish an Impress chart as a still picture of itself, or to drop it
   * entirely, with no finding either way. Three `odp-*` cases lived here until
   * that measurement (`odp-packaged-image`, `odp-semantic`,
   * `odp-speaker-notes`, at commit 0d1f4e1); the ODP path they exercised is
   * still covered against real anydoc by `presentation/reconcile.browser.test.ts`
   * and `presentation/index.test.ts`, which do not route through
   * `importStructuredDocument` and so do not assert a release claim.
   */

  // ===== Structural properties, on DOCX and EPUB only =================
  //
  // See the module comment above for why these two formats and not all
  // nine: they exercise the shared `anydoc-html.ts` normalization path
  // that every non-native parser funnels through, from two structurally
  // different package shapes.

  {
    id: 'docx-deep-headings',
    format: 'docx',
    standsInFor: 'A chapter with real sub-sub-sections — unit, chapter, section, sub-section — so the page-plan split (`proposePagePlan`, which splits at the highest REPEATED heading level) has a document with something to be wrong about; every other fixture in this corpus stops at one heading level.',
    bytes: () => semanticDocxFixture({ deepHeadings: true }),
    expectInHtml: ['<h2>Membrane Structure', '<h3>Phospholipid Bilayer', '<h4>Hydrophobic Tails'],
  },
  {
    id: 'epub-deep-headings',
    format: 'epub',
    standsInFor: 'The same four-deep heading chain as the DOCX case, but carried as literal `<h2>`-`<h4>` tags rather than a style-to-outline-level mapping — EPUB\'s simplest possible representation of the property, deliberately unlike DOCX\'s.',
    bytes: () => semanticEpubFixture({ deepHeadings: true }),
    expectInHtml: ['<h2>Membrane Structure', '<h3>Phospholipid Bilayer', '<h4>Hydrophobic Tails'],
  },
  {
    id: 'docx-merged-cells',
    format: 'docx',
    standsInFor: 'A syllabus grid or a data table with a header spanning two columns — the structure most likely to be silently flattened into unreadable rows.',
    // Requires the `mergedCells` option added to `semanticDocxFixture`,
    // emitting `<w:gridSpan w:val="2"/>` on the first cell. `markup.ts`
    // allows `colspan` and `rowspan` on `td`/`th`, so the attribute must
    // survive to the html.
    bytes: () => semanticDocxFixture({ mergedCells: true }),
    expectInHtml: ['<table', 'colspan="2"'],
  },
  {
    id: 'epub-merged-cells',
    format: 'epub',
    standsInFor: 'The same spanning-header grid as the DOCX case, but via a plain HTML `colspan` attribute — EPUB carries a table as real XHTML rather than a package format\'s own grid model, so this is the most literal possible test of the property.',
    bytes: () => semanticEpubFixture({ mergedCells: true }),
    expectInHtml: ['<table', 'colspan="2"'],
  },
  {
    id: 'docx-footnote',
    format: 'docx',
    standsInFor: 'A journal-style footnote citing a source. Verified empirically against anydoc 0.2.4 that a DOCX footnote becomes a real `Document.notes` entry, which `anydoc-html.ts` treats as an unconditional `unsupported-note` blocker — the note BODY is never rendered at all, but the reference must not vanish silently: it becomes a visible `[Note reference]` placeholder instead.',
    bytes: () => semanticDocxFixture({ footnote: true }),
    expectInHtml: ['[Note reference]'],
    // `anydoc-html.ts` raises `unsupported-note` unconditionally whenever
    // `Document.notes` is non-empty — see the `finding('unsupported-note', …)`
    // calls in that module. Verified empirically against anydoc 0.2.4.
    expectBlockers: ['unsupported-note'],
  },
  {
    id: 'epub-footnote',
    format: 'epub',
    standsInFor: 'The same footnote citation, but carried as EPUB3\'s own `epub:type="noteref"`/`epub:type="footnote"` convention. Verified empirically that anydoc 0.2.4 does NOT recognize this convention as a note at all — no `Document.notes` entry results, so the blocker never fires and both the reference and the footnote body flow through as ordinary anchored text. This is the opposite of the DOCX case, which is exactly why footnotes are worth testing on both formats rather than one.',
    bytes: () => semanticEpubFixture({ footnote: true }),
    expectInHtml: ['Migration patterns vary', 'Source: field observation, 2019.'],
  },
  {
    id: 'docx-equation',
    format: 'docx',
    standsInFor: 'A formula in a science or math handout — Temml conversion sits downstream of import, so today the equation must not disappear; it has to survive as a visible, blocking placeholder that names the LaTeX source anydoc extracted from the OOXML.',
    // Verified empirically against anydoc 0.2.4: an `<m:oMath>` superscript
    // for x^2 converts to the inline `math` kind with `text: "x^{2}"`, which
    // `anydoc-html.ts` renders as `[Equation: x^{2}]` and flags as a blocker.
    bytes: () => semanticDocxFixture({ equation: true }),
    expectInHtml: ['[Equation: x^{2}]'],
    // `anydoc-html.ts` raises `unsupported-equation` whenever an inline `math`
    // node appears — see the `finding('unsupported-equation', …)` calls in
    // that module. Verified empirically against anydoc 0.2.4.
    expectBlockers: ['unsupported-equation'],
  },
  {
    id: 'epub-equation',
    format: 'epub',
    standsInFor: 'The same formula, but embedded as inline MathML rather than OOXML — verified empirically against anydoc 0.2.4 to convert to the identical LaTeX text and the identical blocker placeholder as the DOCX case, unlike footnotes, where the two formats disagree.',
    bytes: () => semanticEpubFixture({ equation: true }),
    expectInHtml: ['[Equation: x^{2}]'],
    // Same `unsupported-equation` blocker as the DOCX case — verified
    // empirically to fire identically against anydoc 0.2.4 for MathML.
    expectBlockers: ['unsupported-equation'],
  },
  {
    id: 'docx-rtl-cjk',
    format: 'docx',
    standsInFor: 'A language handout mixing Arabic and Japanese with English. No existing fixture contains a non-Latin character, so nothing today would catch a sanitizer that dropped or reordered them.',
    bytes: () => semanticDocxFixture({ text: 'مرحبا بالعالم — 光合成 — hello' }),
    expectInHtml: ['مرحبا بالعالم', '光合成'],
  },
  {
    id: 'epub-rtl-cjk',
    format: 'epub',
    standsInFor: 'The same Arabic-and-Japanese mix, carried as ordinary XHTML text content rather than an OOXML run — a different encoding path (real UTF-8 in a zip entry, parsed by an XML/HTML parser) that could drop or reorder the same characters for entirely different reasons than the DOCX path would.',
    bytes: () => semanticEpubFixture({ text: 'مرحبا بالعالم — 光合成 — hello' }),
    expectInHtml: ['مرحبا بالعالم', '光合成'],
  },
  {
    id: 'docx-large-but-legal',
    format: 'docx',
    standsInFor: 'A genuinely long chapter — far more paragraphs than any other fixture in this corpus — proving that legitimate size, on its own, does not trip a per-block or per-node limit before the last paragraph is reached. See `LARGE_BUT_LEGAL_PARAGRAPHS` above for why this is sized the way it is rather than against the literal byte ceiling.',
    bytes: () => semanticDocxFixture({ additionalParagraphs: LARGE_BUT_LEGAL_PARAGRAPHS }),
    expectInHtml: ['Long DOCX paragraph 1.', `Long DOCX paragraph ${LARGE_BUT_LEGAL_PARAGRAPHS}.`],
  },
  {
    id: 'epub-large-but-legal',
    format: 'epub',
    standsInFor: 'The same long-chapter property as the DOCX case, on the other zip-plus-XML format, using the `additionalParagraphs` option `semanticEpubFixture` already had before this task.',
    bytes: () => semanticEpubFixture({ additionalParagraphs: LARGE_BUT_LEGAL_PARAGRAPHS }),
    expectInHtml: ['Long EPUB paragraph 1.', `Long EPUB paragraph ${LARGE_BUT_LEGAL_PARAGRAPHS}.`],
  },
]
