import type { ParserDetection } from './parsers/probe'
import type { ImportFinding } from './types'
import { formatPageRanges } from './pdf-pages'

/**
 * What the sanitizer actually kept for one PDF page, as the importer measured
 * it. One row per page that produced a slice; a page that produced no marker has
 * no row at all, which is how a blank page is told apart from an empty one.
 */
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

/** `page 3` / `pages 1–3`, so a message never says "pages 3". */
function namePages(pages: readonly number[]): string {
  return `${pages.length === 1 ? 'page' : 'pages'} ${formatPageRanges(pages)}`
}

/**
 * `ImportPlanEditor` keys findings on `` `${code}-${sectionId ?? ''}` ``, and a
 * finding that names several pages has no single source page. Writing one anyway
 * would point a reader at an arbitrary member of the set, so the field is set
 * only where a single number is not a lie.
 */
function sourcePageOf(pages: readonly number[]): { sourcePage?: number } {
  return pages.length === 1 ? { sourcePage: pages[0]! } : {}
}

/**
 * Turn the module's classification, plus one summary row per extracted page,
 * into findings a person can act on.
 *
 * Pure, so both sides of the block/warn boundary — and the mixed document that
 * contains both — can be tested without a Worker, a file, or a browser.
 *
 * `hasEncodingIssues` is a separate argument because it lives on
 * `ParserProbeResult` rather than on `ParserDetection`: `detectPdf` does not
 * report it, so it is not part of what a classification knows.
 */
export function pdfFindings(
  detection: ParserDetection,
  pages: readonly PdfPageSummary[],
  hasEncodingIssues = false,
): ImportFinding[] {
  const findings: ImportFinding[] = []
  const everyPage = Array.from({ length: detection.pageCount }, (_, index) => index + 1)

  /*
   * THE BLOCKER, and the only one this module raises. A page that is an image of
   * text has no content to import at all, and publishing it would ship a blank
   * Canvas page where a chapter section should be.
   *
   * A document the module did not classify as text-bearing implicates every
   * page, not just the ones it happened to list: an unrecognised `pdfType` is
   * not evidence that the rest of the text came out.
   */
  const ocrPages = TEXT_BEARING_TYPES.has(detection.pdfType)
    ? [...detection.pagesNeedingOcr].sort((first, second) => first - second)
    : everyPage
  if (ocrPages.length > 0) {
    const count = ocrPages.length
    findings.push({
      code: 'pdf-ocr-required',
      severity: 'blocker',
      message:
        `${count} of ${detection.pageCount} ${count === 1 ? 'page' : 'pages'} in this PDF ` +
        `${count === 1 ? 'is an image' : 'are images'} of text with no text layer (${namePages(ocrPages)}). ` +
        'This release does not run OCR in the browser, so their content cannot be imported. ' +
        'Remove those pages, or supply a PDF with a text layer.',
      ...sourcePageOf(ocrPages),
    })
  }
  const blocked = new Set(ocrPages)

  /*
   * A WARNING, not a blocker. For DOCX and EPUB the image bytes exist and
   * refusing them is a real safety decision; `PdfProcessResult` exposes no
   * byte-bearing field at all, so a PDF figure can never become a Canvas image
   * and blocking would protect nobody while making PDF import useless.
   *
   * The residual, stated: a figure on a page that produced NO text lands in the
   * preceding page's slice, because a text-less page emits no marker. It is
   * bounded — a page with an image and no text is exactly the `scanned` case, so
   * such a document blocks anyway and the mis-attributed number never reaches a
   * published page.
   */
  const figurePages = pages.filter((page) => page.images > 0 && !blocked.has(page.page))
  if (figurePages.length > 0) {
    const figures = figurePages.reduce((total, page) => total + page.images, 0)
    findings.push({
      code: 'pdf-figure-not-imported',
      severity: 'warning',
      message:
        `${figures} ${figures === 1 ? 'figure' : 'figures'} could not be imported ` +
        `(${namePages(figurePages.map((page) => page.page))}). ` +
        'This release cannot extract images from a PDF, so each one is marked in the page as ' +
        '"[Embedded image: Figure on page N]" and the text around it was kept. ' +
        'Add the figures in Canvas after importing these pages.',
      ...sourcePageOf(figurePages.map((page) => page.page)),
    })
  }

  /*
   * Blank paper — a chapter divider, the back of a title page. Measured: a
   * genuinely empty page leaves `pagesNeedingOcr` untouched while a scanned one
   * does not, so this bucket is "nothing was there", not "content we lost".
   * Refusing to import a book because it contains one would protect nobody.
   */
  const summaryByPage = new Map(pages.map((page) => [page.page, page]))
  const emptyPages = everyPage.filter((page) => {
    if (blocked.has(page)) return false
    const summary = summaryByPage.get(page)
    return summary === undefined || (summary.textLength === 0 && summary.images === 0)
  })
  if (emptyPages.length > 0) {
    const count = emptyPages.length
    findings.push({
      code: 'pdf-page-empty',
      severity: 'warning',
      message:
        `No text was extracted from ${count} ${count === 1 ? 'page' : 'pages'} (${namePages(emptyPages)}). ` +
        'Those pages are blank in the source, or nothing could be read from them. ' +
        'Nothing was imported for them.',
      ...sourcePageOf(emptyPages),
    })
  }

  /*
   * Named honestly: the module reports that a page HAS columns or tables, not
   * that their order came out wrong. So this asks for a look rather than
   * claiming a defect.
   */
  const layoutPages = [...new Set([
    ...detection.layout.pagesWithColumns,
    ...detection.layout.pagesWithTables,
  ])].sort((first, second) => first - second)
  if (layoutPages.length > 0) {
    const count = layoutPages.length
    findings.push({
      code: 'pdf-reading-order',
      severity: 'warning',
      message:
        `${count} ${count === 1 ? 'page uses' : 'pages use'} multiple columns or tables ` +
        `(${namePages(layoutPages)}). ` +
        'Column and table order is what a PDF extractor is most likely to get wrong. ' +
        'Read those pages in the preview before preparing them.',
      ...sourcePageOf(layoutPages),
    })
  } else if (detection.layout.isComplex) {
    // Nothing in the module's type ties `isComplex` to the arrays, so this
    // branch must not name pages it does not have.
    findings.push({
      code: 'pdf-reading-order',
      severity: 'warning',
      message:
        'This PDF uses a complex layout with multiple columns or tables. ' +
        'Column and table order is what a PDF extractor is most likely to get wrong. ' +
        'Read the preview before preparing these pages.',
    })
  }

  if (hasEncodingIssues) {
    // Document-wide: the module reports no page numbers for this, so the message
    // must not pretend to have any.
    findings.push({
      code: 'pdf-encoding',
      severity: 'warning',
      message:
        'This PDF reported character-encoding problems, so some characters may have been ' +
        'extracted incorrectly. Read the preview before preparing these pages.',
    })
  }

  return findings
}
