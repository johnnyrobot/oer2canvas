import type { ImportedFormat } from '../types'
import { semanticDocxFixture } from './docx-fixture'
import {
  semanticEpubFixture,
  semanticOdtFixture,
  semanticRtfFixture,
} from './structured-document-fixtures'
import { pdfFixture } from './pdf-fixture'

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
 * COVERAGE SHAPE. Every one of the eight released file formats
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
 * different carriers are enough evidence without paying for all eight.
 *
 * The seventh structural property the design considered, a hostile
 * construct, is deliberately NOT reproduced here: `security.browser.test.ts`
 * already pins the archive-bomb and active-content refusals this release
 * depends on, and duplicating that coverage here would just be two places
 * that could drift apart.
 *
 * NOT IMPORTED HERE. This module and its test only check the corpus's own
 * shape — every released format is covered, every case names what it stands
 * for, every id is unique. Actually running each case through its parser and
 * asserting `expectInHtml` survived is a later task's job, once the corpus
 * itself is trustworthy.
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

  // ===== Structural properties, on DOCX and EPUB only =================
  //
  // See the module comment above for why these two formats and not all
  // eight: they exercise the shared `anydoc-html.ts` normalization path
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
