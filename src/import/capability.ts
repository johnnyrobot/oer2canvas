import type { ImportedFormat } from './types'
import type { ParserKind, ParserProbeOptions, ParserProbeResult } from './parsers/probe'

export type DocumentCapabilityStatus = 'enabled' | 'probe-only'

export interface DocumentFormatCapability {
  format: ImportedFormat
  label: string
  extensions: readonly `.${string}`[]
  mediaTypes: readonly string[]
  parser: 'native' | ParserKind
  status: DocumentCapabilityStatus
  limitations: readonly string[]
  /** Lazy by construction: importing the table does not import either Worker client. */
  probe?: (options: Omit<ParserProbeOptions, 'parser' | 'formatHint'>) => Promise<ParserProbeResult>
}

function parserProbe(parser: ParserKind, formatHint: string): NonNullable<DocumentFormatCapability['probe']> {
  return async (options) => {
    const { probeParser } = await import('./parsers/probe')
    return probeParser({ ...options, parser, formatHint })
  }
}

export const DOCUMENT_FORMAT_CAPABILITIES: readonly DocumentFormatCapability[] = [
  {
    format: 'text',
    label: 'Plain text',
    extensions: ['.txt'],
    mediaTypes: ['text/plain'],
    parser: 'native',
    status: 'enabled',
    limitations: ['Formatting beyond paragraphs and line breaks is not present in plain text.'],
  },
  {
    format: 'markdown',
    label: 'Markdown',
    extensions: ['.md', '.markdown'],
    mediaTypes: ['text/markdown', 'text/x-markdown'],
    parser: 'native',
    status: 'enabled',
    limitations: [
      'Raw HTML is reduced to the controlled HTML-import subset; images remain unavailable until asset packaging ships.',
    ],
  },
  {
    format: 'html',
    label: 'HTML',
    extensions: ['.html', '.htm'],
    mediaTypes: ['text/html', 'application/xhtml+xml'],
    parser: 'native',
    status: 'enabled',
    limitations: [
      'Scripts, active embeds, forms, source styling, unsafe URLs, and image requests are not imported.',
    ],
  },
  {
    format: 'docx',
    label: 'Word document',
    extensions: ['.docx'],
    mediaTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    parser: 'anydoc',
    status: 'enabled',
    limitations: [
      'A footnote blocks import: its body is never rendered, and the file must be resolved before the document can proceed.',
      'An equation blocks import; equation rendering is not supported yet.',
      'Text boxes, complex pagination, and other embedded content may require manual remediation.',
    ],
    probe: parserProbe('anydoc', 'docx'),
  },
  {
    format: 'odt',
    label: 'OpenDocument text',
    extensions: ['.odt'],
    mediaTypes: ['application/vnd.oasis.opendocument.text'],
    parser: 'anydoc',
    status: 'enabled',
    limitations: ['Page styling and visual layout are not reproduced.'],
    probe: parserProbe('anydoc', 'odt'),
  },
  {
    format: 'rtf',
    label: 'Rich Text Format',
    extensions: ['.rtf'],
    mediaTypes: ['application/rtf', 'text/rtf'],
    parser: 'anydoc',
    status: 'enabled',
    limitations: ['Complex drawings and visual layout may be flattened.'],
    probe: parserProbe('anydoc', 'rtf'),
  },
  {
    format: 'epub',
    label: 'EPUB',
    extensions: ['.epub'],
    mediaTypes: ['application/epub+zip'],
    parser: 'anydoc',
    status: 'enabled',
    limitations: [
      'Source styling is discarded; embedded images block this text-oriented workflow.',
      'An equation blocks import; equation rendering is not supported yet.',
      "A footnote (EPUB3's `epub:type=\"footnote\"` convention) is not recognised as a note: its body flows through as ordinary text instead of being set apart, and the reference is not linked to it.",
    ],
    probe: parserProbe('anydoc', 'epub'),
  },
  {
    format: 'pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    mediaTypes: ['application/pdf'],
    parser: 'pdf-inspector',
    status: 'enabled',
    limitations: [
      'Scanned pages have no text to import and block completion; this release does not run OCR in the browser.',
      'Figures are marked in place but not imported — add them in Canvas afterwards.',
      'Multi-column and table reading order needs review.',
    ],
    probe: parserProbe('pdf-inspector', 'pdf'),
  },
  {
    format: 'pptx',
    label: 'PowerPoint presentation',
    /*
     * ONE entry for four extensions, not four entries.
     * `importStructuredDocument` requires `parsed.detectedFormat === capability.format`,
     * and every PPTX-family container — presentation, slideshow, and both
     * macro-enabled variants — reports `pptx` from its content type (design
     * fact 1, measured 2026-08-29). Separate `pptm`/`ppsx`/`ppsm` entries would
     * therefore fail that check on every real file.
     */
    extensions: ['.pptx', '.pptm', '.ppsx', '.ppsm'],
    mediaTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
      'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
      'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
    ],
    parser: 'anydoc',
    /*
     * ENABLED under issue 14's bar, on this evidence (measured 2026-08-30
     * against real anydoc 0.2.4, over the seven `format: 'pptx'` corpus cases):
     * every top-level block attributed with no blocker of any code; all three
     * of design fact 6's constructs named together on the slide that carried
     * them ("Slide 1 contains 1 diagram, 1 chart, 1 media"); the speaker-notes
     * case's note absent from the imported HTML, proven load-bearing by
     * mutation; and the shared accessibility and cartridge suites passing with
     * a real packaged picture inside `web_resources/`.
     *
     * Residuals are stated rather than closed, and the issue's `## Answer`
     * carries the reasoning. The one that reaches a user is A CHART INSERTED IN
     * POWERPOINT: given the cached values PowerPoint stores with it, anydoc
     * renders it as a DATA TABLE, the index has no account of that table, and
     * the deck REFUSES. Measured over 39 real `.pptx` decks on this machine,
     * every deck carrying a `ppt/charts/chartN.xml` refused and every deck
     * without one imported. Two more residuals do not reach a user: WHICH
     * INSTANCE of a shared media part lands under which slide still rests on
     * the index and anydoc agreeing about which shapes produce blocks (a
     * picture can never be published under a slide that does not reference its
     * origin part at all); and criterion 1 is met by measurement over this
     * corpus plus 39 real decks rather than proven for every deck.
     */
    status: 'enabled',
    limitations: [
      'Speaker notes are not imported; slides that had them are listed so you can add what students need.',
      'Diagrams and embedded audio or video are not imported — add them in Canvas afterwards.',
      'A chart inserted in PowerPoint BLOCKS import: the parser turns the chart\'s stored values into a data table, and this importer cannot tell which slide that table belongs to. Delete the chart, or replace it with a picture, to import the rest of the deck.',
      'A slide with no title is titled by its number so you can rename it.',
      'An equation blocks import; equation rendering is not supported yet.',
      'An image not in a format this importer can package (PNG, JPEG, GIF, or WebP) blocks import — a pasted chart, a Visio drawing, or legacy clip art is often saved this way; replace it with one of those formats first.',
      'A chart or drawing PASTED in from Excel or Visio is not named as a chart: it blocks import as an unpackageable image (its preview), and nothing says what the object was. A chart or diagram INSERTED in PowerPoint itself is named. OpenDocument decks name both.',
      "A slide whose content cannot be matched to the deck's own outline blocks import outright, because publishing it could put content under the wrong slide.",
      'Macros are never read or run.',
    ],
    probe: parserProbe('anydoc', 'pptx'),
  },
  {
    format: 'odp',
    label: 'OpenDocument presentation',
    extensions: ['.odp'],
    mediaTypes: ['application/vnd.oasis.opendocument.presentation'],
    parser: 'anydoc',
    /*
     * ENABLED under issue 14's bar, but only after the bar was applied twice.
     *
     * The first pass failed ODP on criterion 2 — "every construct in design
     * fact 6 is named by a finding on the right slide" — because an Impress
     * chart produced no finding at all. That was true of the code and wrong
     * about the cause: ODF gives an embedded object's frame no
     * `draw:mime-type`, so nothing in `content.xml` says what a `draw:object`
     * is, and the index was reading only `content.xml`. The package does say,
     * in `META-INF/manifest.xml`, which the Worker was not fetching. Reading
     * it (one pattern in `parts.ts`, one classifier in `presentation/index.ts`)
     * is the whole fix, and it closes the criterion rather than excusing it.
     *
     * MEASURED 2026-08-30 on a file LibreOffice Impress wrote through its own
     * `impress8` filter, not on hand-authored XML: an inserted chart is
     * `draw:frame > draw:object` with `xlink:href="./Object 1"`, and the
     * manifest carries `Object 1/` as
     * `application/vnd.oasis.opendocument.chart`. A chart and a diagram now
     * each raise `presentation-unrepresentable` on their own page.
     *
     * The same real file also carries an `ObjectReplacements/` preview that is
     * a VCL GDI metafile (`application/x-openoffice-gdimetafile`), which this
     * importer cannot package — so a real Impress chart ALSO takes the
     * ordinary unpackageable-image blocker, exactly as a PowerPoint deck with
     * a pasted chart does through its EMF preview. That is the shared rule
     * both formats already state below, not an ODP defect: it refuses rather
     * than losing anything silently.
     */
    status: 'enabled',
    limitations: [
      'Speaker notes are not imported; slides that had them are listed so you can add what students need.',
      'Charts, diagrams, and embedded audio or video are not imported — add them in Canvas afterwards.',
      'A slide with no title is titled by its number so you can rename it.',
      'An equation blocks import; equation rendering is not supported yet.',
      "An image not in a format this importer can package (PNG, JPEG, GIF, or WebP) blocks import — the preview LibreOffice saves beside an embedded chart or diagram is often one of these; delete the object, or replace it with a picture in one of those formats, first.",
      "A slide whose content cannot be matched to the deck's own outline blocks import outright, because publishing it could put content under the wrong slide.",
    ],
    probe: parserProbe('anydoc', 'odp'),
  },
  /*
   * The two legacy OLE2 formats, PARKED rather than shipped. anydoc 0.2.4
   * accepts both (`formatFromExtension` maps `doc`→`doc` and `ppt`/`pps`/`pot`
   * →`ppt`, and `formatFromBytes` identifies both from their OLE2 stream
   * names), so nothing outside this table refuses them. Issue 15 measured them
   * on 2026-08-30 and disabled both; the design carries the numbers and the
   * issue's `## Answer` carries the reasoning.
   *
   * NO `probe` is attached. A probe is a lazy import of the Worker client for a
   * format `importStructuredDocument` will not route there, and an entry that
   * offers one invites a caller to use it.
   */
  {
    format: 'doc',
    label: 'Word 97–2003 document',
    extensions: ['.doc'],
    mediaTypes: ['application/msword'],
    parser: 'anydoc',
    /*
     * DISABLED on two SILENT failures, in opposite directions, neither of which
     * carries a finding and neither of which can be detected in this browser
     * (there is no second account of a `.doc` to detect it with — see the
     * design's fact 13).
     *
     * OMISSION, measured on a real Microsoft-Word-written file: text inside
     * Word text frames is not read at all. A one-page conference report
     * written by Microsoft Office Word imports 442 of its 1,250 characters
     * short — 35% — because the form's three answers live in text boxes.
     * LibreOffice reads them from the same bytes, and anydoc reads them from
     * the DOCX form of the same content, so it is the DOC reader and not the
     * construct.
     *
     * ADDITION: a tracked-change DELETION is published as ordinary body text.
     * The same document written to DOCX excludes it, and LibreOffice reading
     * the same `.doc` writes it as `<w:delText>` — so the revision mark is in
     * the file and this reader ignores it. Frequency unmeasured: 0 of the 7
     * real `.doc` files on the measuring machine carried a deletion.
     *
     * NOT the reasons: reading order (0 inversions over 474 shared lines),
     * malformed input (24 of 24 damaged OLE2 variants refused as `malformed`
     * in ≤6 ms), or budgets. Ordinary structure survives well — over 30 real
     * documents, headings 265/270, tables 60/60, text 99.1%.
     */
    status: 'probe-only',
    limitations: [
      'Not imported. Open the file in Word or LibreOffice, save it as .docx, and import that.',
      'A legacy .doc can lose text held in text boxes, and can publish text that was deleted with tracked changes, in both cases with nothing to say it happened — which is why this importer refuses the format rather than importing it with a warning.',
    ],
  },
  {
    format: 'ppt',
    label: 'PowerPoint 97–2003 presentation',
    /*
     * ONE entry for three extensions, for the reason the PPTX entry above is
     * one for four: `formatFromExtension` maps `pps` and `pot` to `ppt`, so
     * they are one parser path and would be one capability if they were ever
     * enabled.
     */
    extensions: ['.ppt', '.pps', '.pot'],
    mediaTypes: ['application/vnd.ms-powerpoint'],
    parser: 'anydoc',
    /*
     * DISABLED under issue 14's own bar, which PPTX and ODP passed one issue
     * ago on exactly these axes.
     *
     * NOTES LEAK (bar criterion 3): speaker notes arrive as an ordinary
     * `blockQuote`, exactly as they do for PPTX — but a PPTX's notes are
     * identified against `ppt/notesSlides/` and dropped, and a `.ppt` has no
     * package to match against. Measured over 27 real decks converted to the
     * legacy format: 5 of them publish 20 quote blocks holding 5,641
     * characters of text the author wrote for themselves.
     *
     * EVERY PICTURE VANISHES (bar criterion 2): 0 image inlines across those
     * 27 decks, against 267 image payloads anydoc still extracts and 214
     * pictures LibreOffice reads from the same bytes. The only signal is
     * `anydoc-html.ts`'s generic `unreferenced-asset` WARNING. Tables flatten
     * the same way: 0 against LibreOffice's 8.
     *
     * NO SLIDES TO ATTRIBUTE TO (bar criterion 1): 23 heading blocks across 27
     * decks, against 114 in the same decks' PPTX form, and no `sldIdLst` to
     * count slides from. `presentation/reconcile.ts` has no second account to
     * walk, so `<section data-slide="N">`, the `Slide N` titles and the refusal
     * on unattributable content are all unreachable.
     */
    status: 'probe-only',
    limitations: [
      'Not imported. Open the file in PowerPoint or LibreOffice, save it as .pptx, and import that.',
      "A legacy .ppt loses every picture and every table from the page, and publishes the presenter's speaker notes as ordinary quotations — this importer cannot tell a note from a quotation without the deck's own package, which this format does not have.",
    ],
  },
  /*
   * ===== SPREADSHEETS: PROBE-ONLY, by issue 16's measurement ==============
   *
   * These four entries add NO import path. `enabledCapabilityFor` in
   * `document.ts` refuses any capability whose `status !== 'enabled'`, so they
   * exist to put an accurate explanation in front of a user who selects one —
   * which is what issue 16's sixth criterion asks for when the answer is no.
   *
   * The measurement, 2026-08-30 against anydoc 0.2.4, is in
   * `.scratch/document-import/16-decide-spreadsheet-imports-design.md` and
   * pinned by `spreadsheet-evidence.browser.test.ts`. The one fact that decides
   * all four: `Table.headerRows` is a HEURISTIC on the shape of row 1, not a
   * fact any spreadsheet format records. It comes back 0 for 204 of 252 real
   * `.xlsx` worksheets and for 141 of 141 real legacy `.xls` worksheets, so the
   * table reaches `engine/compile/steps/tables.ts` with no `<th>` at all; and
   * it comes back 1 for a data row that merely happens to be text, marking data
   * up as headers with nothing queued and nothing able to notice. The first
   * failure is then unfixable in this workflow rather than merely inconvenient:
   * a merged group header is a `rowspan`, ragged CSV and ODS rows are unequal
   * widths, and `refusalToPromote` refuses BOTH — so the instructor gets a card
   * that stays queued whatever they answer.
   *
   * Enabling any of these needs the bar in that design's "The bar, committed
   * before the corpus is built", not a fresh judgement call.
   */
  {
    format: 'xlsx',
    label: 'Excel workbook',
    /*
     * `.xlsm` rides this entry for the reason the pptx entry gives above:
     * `formatFromExtension` maps `xls`, `xlsm` and `xlsb` all onto `xlsx`
     * (design fact 1), and a real macro-enabled workbook reports `xlsx` from
     * its own content.
     */
    extensions: ['.xlsx', '.xlsm'],
    mediaTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel.sheet.macroEnabled.12',
    ],
    parser: 'anydoc',
    status: 'probe-only',
    limitations: [
      'Spreadsheets are not imported in this release. Copy the rows you need into a Word document, or paste them into the Markdown tab, and import that instead.',
      'The parser cannot tell which row of a worksheet is its header, so a worksheet becomes a table a screen reader cannot navigate — and a header that spans two rows, or a table whose top-left cell is blank, gets no header at all.',
      'A chart or picture on a worksheet is not imported and is not reported; hidden rows, columns, and sheets are dropped without being reported either.',
      'A large workbook can be well under the 16 MiB limit and still use several times the memory this browser workflow budgets for a parse.',
    ],
    probe: parserProbe('anydoc', 'xlsx'),
  },
  {
    format: 'xls',
    label: 'Excel 97-2003 workbook',
    /*
     * A SEPARATE entry from `xlsx` even though anydoc has no `xls` format and
     * reports `xlsx` for every real legacy file (design fact 2: 37 of 37 OLE2
     * workbooks on the measuring machine). The pptx entry folds its family onto
     * one row because those extensions SHARE a verdict and a released import
     * path; this one is split because `.xls` has its OWN evidence — every one
     * of its 141 measured worksheets produced a table with no header cell,
     * which is worse than the modern format, not merely equal to it — and
     * because the note a user reads should name the format they actually chose.
     * Nothing routes a parse through this entry, so the format collapse costs
     * nothing here.
     */
    extensions: ['.xls'],
    mediaTypes: ['application/vnd.ms-excel'],
    parser: 'anydoc',
    status: 'probe-only',
    limitations: [
      'Spreadsheets are not imported in this release, and this older Excel format is no better supported than the current one.',
      'Every legacy workbook measured produced tables with no header row at all, so nothing in them could be published as an accessible table.',
      'Open the file in Excel or LibreOffice, save the part you need as a Word document, and import that instead.',
    ],
    probe: parserProbe('anydoc', 'xls'),
  },
  {
    format: 'ods',
    label: 'OpenDocument spreadsheet',
    extensions: ['.ods'],
    mediaTypes: ['application/vnd.oasis.opendocument.spreadsheet'],
    parser: 'anydoc',
    status: 'probe-only',
    limitations: [
      'Spreadsheets are not imported in this release.',
      'This format additionally PUBLISHES content you hid: a hidden sheet, a hidden row, and a hidden column all reach the page, which Excel workbooks do not do. That alone would block it.',
      'Worksheets with merged header cells arrive with no header row, and rows of differing width, neither of which can be published as an accessible table.',
    ],
    probe: parserProbe('anydoc', 'ods'),
  },
  {
    format: 'csv',
    label: 'CSV data file',
    extensions: ['.csv'],
    mediaTypes: ['text/csv'],
    parser: 'anydoc',
    status: 'probe-only',
    limitations: [
      'Data files are not imported in this release. Paste the rows into the Markdown tab as a Markdown table, where you can mark the header row yourself.',
      'A CSV that starts with a title line above its header — which is what most reporting tools export — is read as a single-column table for that line and a two-column table below it, so the whole file arrives misaligned.',
      'A CSV carries no signature in its bytes, so unlike every other format here its identity would rest entirely on the file name.',
    ],
    probe: parserProbe('anydoc', 'csv'),
  },
] as const

const plainText = DOCUMENT_FORMAT_CAPABILITIES.find((entry) => entry.format === 'text')!
export const PLAIN_TEXT_FILE_ACCEPT = [...plainText.extensions, ...plainText.mediaTypes].join(',')
export const TEXT_CONTENT_FILE_ACCEPT = DOCUMENT_FORMAT_CAPABILITIES
  .filter((entry) => entry.status === 'enabled' && entry.parser === 'native')
  .flatMap((entry) => [...entry.extensions, ...entry.mediaTypes])
  .join(',')
const docx = DOCUMENT_FORMAT_CAPABILITIES.find((entry) => entry.format === 'docx')!
export const DOCX_FILE_ACCEPT = [...docx.extensions, ...docx.mediaTypes].join(',')

export const ENABLED_ANYDOC_CAPABILITIES = DOCUMENT_FORMAT_CAPABILITIES.filter(
  (entry) => entry.status === 'enabled' && entry.parser === 'anydoc',
)
export const STRUCTURED_DOCUMENT_FILE_ACCEPT = ENABLED_ANYDOC_CAPABILITIES
  .flatMap((entry) => [...entry.extensions, ...entry.mediaTypes])
  .join(',')
const structuredDocumentExtensionLabels = ENABLED_ANYDOC_CAPABILITIES
  .flatMap((entry) => entry.extensions)
  .map((extension) => extension.slice(1).toUpperCase())
export const STRUCTURED_DOCUMENT_FORMAT_SUMMARY = [
  structuredDocumentExtensionLabels.slice(0, -1).join(', '),
  structuredDocumentExtensionLabels.at(-1),
].filter(Boolean).join(', or ')

/*
 * Every format the file picker offers: anydoc's six (docx, odt, rtf, epub,
 * pptx, odp — a COUNT OF ENTRIES, not of extensions, since the pptx entry
 * carries four) plus PDF. Separate from
 * `ENABLED_ANYDOC_CAPABILITIES` because that list answers a different question —
 * which formats `importStructuredDocument` itself handles — and its answer
 * appears in that function's refusal message, which must not offer PDF.
 */
export const IMPORTABLE_DOCUMENT_CAPABILITIES = DOCUMENT_FORMAT_CAPABILITIES.filter(
  (entry) => entry.status === 'enabled' && entry.parser !== 'native',
)
export const DOCUMENT_FILE_ACCEPT = IMPORTABLE_DOCUMENT_CAPABILITIES
  .flatMap((entry) => [...entry.extensions, ...entry.mediaTypes])
  .join(',')
const importableDocumentExtensionLabels = IMPORTABLE_DOCUMENT_CAPABILITIES
  .flatMap((entry) => entry.extensions)
  .map((extension) => extension.slice(1).toUpperCase())
export const DOCUMENT_FORMAT_SUMMARY = [
  importableDocumentExtensionLabels.slice(0, -1).join(', '),
  importableDocumentExtensionLabels.at(-1),
].filter(Boolean).join(', or ')

export function releaseEnabledFormats(): ImportedFormat[] {
  return DOCUMENT_FORMAT_CAPABILITIES
    .filter((entry) => entry.status === 'enabled')
    .map((entry) => entry.format)
}

export function capabilityForFilename(filename: string): DocumentFormatCapability | undefined {
  const lower = filename.toLowerCase()
  return DOCUMENT_FORMAT_CAPABILITIES.find((entry) =>
    entry.extensions.some((extension) => lower.endsWith(extension)))
}

export function capabilityForFormat(format: ImportedFormat): DocumentFormatCapability | undefined {
  return DOCUMENT_FORMAT_CAPABILITIES.find((entry) => entry.format === format)
}
