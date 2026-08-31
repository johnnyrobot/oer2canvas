import type { ImportFinding, ImportResult } from './types'
import type { ParserProbeOptions, ParserProbeResult } from './parsers/probe'
import type { StructuredDocumentImportOptions } from './document'
import { DOCUMENT_IMPORT_LIMITS } from './limits'
import { documentIds, importProvenance, sha256Hex, validateImportMetadata } from './common'
import { sanitizeImportedMarkdown } from './markup'
import { splitPdfMarkdown, withPageCaptions } from './pdf-pages'
import { glyphCorruptionSamples, pdfFindings, type PdfPageSummary } from './pdf-findings'
import { MAX_TEXT_IMPORT_BYTES } from './text'

export interface PdfImportOptions extends StructuredDocumentImportOptions {
  /**
   * Test seam. Production leaves this undefined and the real `probeParser` is
   * imported lazily, so importing this module does not pull in a Worker client.
   */
  probe?: (options: ParserProbeOptions) => Promise<ParserProbeResult>
}

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
 */
const PDF_SIGNATURE = '%PDF-'

function hasPdfSignature(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(PDF_SIGNATURE.length, bytes.byteLength))
  return new TextDecoder('latin1').decode(head) === PDF_SIGNATURE
}

/** Non-whitespace characters, which is what "this page produced text" means. */
function visibleLength(html: string): number {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length
}

const MODULE_IMAGE = /!\[Image: [^\]]*\]\(image\)/g

export async function importPdfDocument(
  file: File,
  options: PdfImportOptions,
): Promise<ImportResult> {
  options.signal?.throwIfAborted()
  validateImportMetadata(options.metadata)
  if (file.size > DOCUMENT_IMPORT_LIMITS.maximumInputBytes) {
    throw new Error('This PDF exceeds the 16 MiB browser limit.')
  }

  // Read and check the signature BEFORE the probe: `probeParser` TRANSFERS the
  // buffer into the Worker, and it is detached afterwards.
  const bytes = await file.arrayBuffer()
  options.signal?.throwIfAborted()
  if (!hasPdfSignature(bytes)) {
    throw new Error(`${file.name} is not a PDF. Its contents do not begin with a PDF header.`)
  }
  const sourceSha256 = await sha256Hex(bytes)
  options.signal?.throwIfAborted()

  const probe = options.probe ?? (await import('./parsers/probe')).probeParser
  options.signal?.throwIfAborted()
  const parsed = await probe({
    parser: 'pdf-inspector',
    bytes,
    formatHint: 'pdf',
    signal: options.signal,
    onProgress: options.onProgress,
  })

  /*
   * The extracted Markdown reaches the same main-thread sanitizer, plan builder
   * and live preview `MAX_TEXT_IMPORT_BYTES` was chosen for, so it is bounded by
   * the same number rather than by a new one. The largest PDF output the browser
   * benchmark measured was 267,931 bytes — 7.8x of headroom — so this refuses
   * nothing real.
   */
  if (parsed.outputBytes > MAX_TEXT_IMPORT_BYTES) {
    throw new Error('Text extracted from a PDF must be 2 MiB or smaller.')
  }

  const split = splitPdfMarkdown(parsed.markdown ?? '')
  const summaries: PdfPageSummary[] = []
  const sanitized: { html: string; findings: ImportFinding[] }[] = []
  const counts = { headings: 0, tables: 0, images: 0, equations: 0, notes: 0, unavailableAssets: 0 }

  const absorb = (markdown: string, page?: number) => {
    /*
     * Whitespace-only slices are SKIPPED, not sanitized. Sanitizing one raises
     * `import-no-supported-content` — a blocker — for what is simply a page that
     * printed nothing, and `pdfFindings` already reports that page as an empty
     * one, at the severity this release decided it deserves.
     */
    if (!markdown.trim()) {
      if (page !== undefined) summaries.push({ page, textLength: 0, images: 0 })
      return
    }
    const source = page === undefined ? markdown : withPageCaptions(markdown, page)
    // One finding per DOCUMENT, not per page: the caller raises its own, because
    // the default would give a multi-page PDF one blocker per page.
    const result = sanitizeImportedMarkdown(source, { deferImageFindings: true })
    sanitized.push({ html: result.html, findings: result.findings })
    counts.headings += result.counts.headings
    counts.tables += result.counts.tables
    counts.images += result.counts.images
    counts.equations += result.counts.equations
    counts.notes += result.counts.notes
    counts.unavailableAssets += result.counts.unavailableAssets
    if (page !== undefined) {
      summaries.push({
        page,
        textLength: visibleLength(result.html),
        images: [...markdown.matchAll(MODULE_IMAGE)].length,
      })
    }
  }

  // The preamble is content the module attributed to no page, so it carries no
  // page number and gets no caption.
  absorb(split.preamble)
  for (const slice of split.pages) absorb(slice.markdown, slice.page)

  /*
   * Pages that emitted no marker, and what a page-restricted re-parse found on
   * each. A page carrying an image is a page that is an IMAGE OF TEXT and must
   * block; a page carrying nothing is blank paper and warns. The module cannot
   * be asked for this directly — it omits a scanned page from `pagesNeedingOcr`
   * whenever the document still reads as `TextBased` overall (measured
   * 2026-08-29) — so without this a scanned page would publish as a gap.
   *
   * `unattributed` means the re-parse failed. It fails CLOSED: not knowing
   * whether a page is blank is not evidence that it is.
   */
  const marked = new Set(split.pages.map((slice) => slice.page))
  for (const unmarked of parsed.unmarkedPages ?? []) {
    if (marked.has(unmarked.page)) continue
    summaries.push({
      page: unmarked.page,
      textLength: 0,
      images: unmarked.images,
      needsOcr: unmarked.unattributed === true || unmarked.images > 0,
    })
    /*
     * The placeholder for an un-marked page's image sits in the PRECEDING
     * slice's markdown, because the page itself emitted no marker to open a
     * slice of its own. It was counted as a figure on that page; subtract it
     * back out so the figure warning names pages that really have figures.
     */
    const preceding = summaries.find((summary) =>
      summary.page === [...marked].filter((page) => page < unmarked.page).sort((a, b) => b - a)[0])
    if (preceding) preceding.images = Math.max(0, preceding.images - unmarked.images)
  }

  const html = sanitized.map((entry) => entry.html).join('')
  const detection = parsed.detection
  /*
   * Measured on the module's own extracted Markdown rather than on the
   * sanitized html, so a tag name can never be mistaken for a corrupted word,
   * and so the check sees exactly the text the module produced.
   */
  const corrupted = glyphCorruptionSamples(parsed.markdown ?? '')
  const findings = detection
    ? pdfFindings(detection, summaries, parsed.hasEncodingIssues === true, corrupted)
    : []

  if (!html) {
    /*
     * Nothing publishable came out, so there is no page to edit and no plan to
     * review: this belongs in the error path, where the anydoc importer puts the
     * same condition, rather than as a blocker on an empty plan. When the
     * detection named OCR pages the error IS the blocker's message, so the
     * importer says exactly what the plan editor would have said.
     */
    const blocker = findings.find((finding) => finding.severity === 'blocker')
    throw new Error(blocker?.message ?? 'No readable text was extracted from this PDF.')
  }

  /*
   * Sanitizer findings are merged BY CODE with the first message winning. The
   * residual, stated: this loses which page an `import-active-content-removed`
   * came from, because `ImportPlanEditor` keys on `code` and duplicates would
   * collide. The PDF-specific findings above carry the page evidence criterion 2
   * asks for.
   */
  const seen = new Set(findings.map((finding) => finding.code))
  const { id, sectionId } = documentIds(sourceSha256)
  for (const entry of sanitized) {
    for (const finding of entry.findings) {
      if (seen.has(finding.code)) continue
      seen.add(finding.code)
      findings.push(finding)
    }
  }

  const title = options.metadata.title.trim()
  return {
    work: {
      id,
      title,
      format: 'pdf',
      sections: [{ id: sectionId, title, order: 0, html }],
      // `PdfProcessResult` exposes no image bytes, so a PDF import can never
      // package an asset. Every figure is a placeholder and a warning instead.
      assets: [],
      provenance: importProvenance(options.metadata, { kind: 'local-file', originalName: file.name }),
    },
    report: {
      parser: 'pdf-inspector',
      parserVersion: parsed.parserVersion,
      format: 'pdf',
      originalName: file.name,
      originalBytes: parsed.inputBytes,
      sourceSha256,
      ...(detection ? { pageCount: detection.pageCount } : {}),
      findings: findings.map((finding) => ({ ...finding, sectionId })),
      counts: {
        sections: 1,
        headings: counts.headings,
        tables: counts.tables,
        images: counts.images,
        equations: counts.equations,
        notes: counts.notes,
        unavailableAssets: counts.unavailableAssets,
        packagedAssetBytes: 0,
      },
    },
  }
}
