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
  /**
   * This page produced no marker and a page-restricted re-parse found an image
   * on it, so it is a page that is an image of text. It BLOCKS, exactly as a
   * page named in `pagesNeedingOcr` does.
   *
   * The module does not always name such a page itself — see `PdfUnmarkedPage`
   * — so this is the second, independent route into the blocking set.
   */
  needsOcr?: boolean
}

/*
 * `Scanned` and `ImageBased` mean the whole document is images of text.
 * Anything the module reports that is not one of the values this release has
 * seen is treated the same way, because an unrecognised classification is not
 * evidence that the text came out.
 */
const TEXT_BEARING_TYPES = new Set(['TextBased', 'Mixed'])

/**
 * Non-whitespace characters a page must have produced before its own text is
 * treated as evidence AGAINST the module's OCR call.
 *
 * Not `> 0`, and the reason is the failure mode this guard must not open. A
 * genuinely scanned page very often carries a real text layer holding nothing
 * but a running header or a page number — "17", "Chapter 4" — so any-text-at-all
 * would unblock an unreadable page on two characters. This sits above that noise
 * and below a sentence; anything under it keeps the safe answer, which is to
 * block.
 */
const MIN_TEXT_CONTRADICTING_OCR = 40

/**
 * Words with a character inside them that cannot occur inside a word.
 *
 * The fault this finds is a PDF font subset whose `ToUnicode` map has no entry
 * for a ligature glyph, so the extractor emits the raw GLYPH INDEX instead of
 * the characters. A Word-exported PDF turns every "ti" into whatever index the
 * subset used: "Creative" arrives as "Crea5ve", "Instructions" as "Instruc(ons",
 * and the text reads as prose right up until somebody tries to read it.
 *
 * Two letters are required on BOTH sides, which is what keeps `b2b`, `mp3s` and
 * `H2O` out. It also costs the short cases — "still" corrupted to "s5ll" is not
 * matched — and that trade is deliberate: this rule counts occurrences rather
 * than trying to find every one, so missing the short forms costs nothing as
 * long as the long forms are there, and a false positive costs a warning on a
 * clean document.
 */
const IN_WORD_INTRUDER = /[a-z]{2,}([0-9(){}[\]<>|\\@#$%^&*+=~])[a-z]{2,}/gi

/**
 * How many times ONE substituted character must appear inside words.
 *
 * Grouping by the character is what makes this precise rather than merely
 * suspicious. Real technical prose does contain `sha1sum` and `md5sum`, but they
 * use DIFFERENT digits; a broken font subset maps one ligature to one glyph
 * index, so the same intruder recurs on every instance of the same letter pair.
 * Three of a kind is a font, not a vocabulary.
 */
const MIN_SAME_INTRUDER = 3

/**
 * Words that show the corruption, for the message to quote. Empty when the text
 * is clean.
 *
 * Exported and pure so the rule can be measured against real extracted text
 * without a PDF, a Worker or a browser.
 */
export function glyphCorruptionSamples(text: string): string[] {
  const byIntruder = new Map<string, string[]>()
  for (const match of text.matchAll(IN_WORD_INTRUDER)) {
    const intruder = match[1]!
    const samples = byIntruder.get(intruder) ?? []
    // One sample per distinct word: a term repeated forty times is one piece of
    // evidence, not forty, and quoting it forty times would say nothing extra.
    if (!samples.includes(match[0])) samples.push(match[0])
    byIntruder.set(intruder, samples)
  }
  const worst = [...byIntruder.values()]
    .filter((samples) => samples.length >= MIN_SAME_INTRUDER)
    .sort((first, second) => second.length - first.length)[0]
  return worst ?? []
}

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
  corrupted: readonly string[] = [],
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
  /*
   * A page whose text WE extracted is not a page with no text layer, whatever
   * the module called it.
   *
   * This is the route out, and until now there was none — two independent routes
   * in and no way to contradict either. `pagesNeedingOcr` means the module wants
   * OCR run on a page, and `ocrReasonsByPage` gives `scanned` for a page that
   * merely CONTAINS an image of text. A step-by-step document whose last page is
   * one screenshot plus two sentences satisfies that, so the module named it,
   * this file translated the name into "is an image of text with no text layer",
   * and a blocker withheld a page whose text was sitting in the extraction the
   * whole time. Measured against the module's own classification, our per-page
   * character count is the better evidence: it is what actually came out.
   *
   * Only on the text-bearing branch. A document the module did not classify as
   * text-bearing still implicates every page — an unrecognised `pdfType` is not
   * evidence that anything came out, and this file fails closed on that
   * deliberately.
   */
  const contradicted = new Set(
    pages
      .filter((page) => page.textLength >= MIN_TEXT_CONTRADICTING_OCR)
      .map((page) => page.page),
  )
  const ocrPages = TEXT_BEARING_TYPES.has(detection.pdfType)
    // Two independent routes in, because one of them is not reliable: the module
    // omits a scanned page from `pagesNeedingOcr` whenever the document still
    // reads as `TextBased` overall, and `needsOcr` is what the caller measured
    // for itself on a page that produced no marker.
    ? [...new Set([
        ...detection.pagesNeedingOcr,
        ...pages.filter((page) => page.needsOcr).map((page) => page.page),
      ])].filter((page) => !contradicted.has(page)).sort((first, second) => first - second)
    : everyPage
  if (ocrPages.length > 0) {
    const count = ocrPages.length
    findings.push({
      code: 'pdf-ocr-required',
      severity: 'blocker',
      message:
        // "1 of 3 pages … is an image": the noun agrees with the TOTAL, the verb
        // with the count.
        `${count} of ${detection.pageCount} ${detection.pageCount === 1 ? 'page' : 'pages'} in this PDF ` +
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
   * A figure on a page that produced no text lands in the PRECEDING page's
   * slice, because a text-less page emits no marker. The importer subtracts it
   * back out using the per-page attribution, so the count here is figures that
   * really are on the page it names.
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
   * Blank paper — a chapter divider, the back of a title page. This bucket is
   * "nothing was there", not "content we lost": a page that produced no marker
   * only reaches it after a page-restricted re-parse found no image on it
   * either, which is what `needsOcr` above records. Refusing to import a book
   * because it contains a blank divider would protect nobody.
   *
   * `pagesNeedingOcr` alone could NOT carry this distinction — measured
   * 2026-08-29, the module omits a scanned page from it whenever the document
   * still reads as `TextBased` overall.
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

  /*
   * ONE finding, from two independent detectors, because they are the same
   * defect and reporting it twice would just be louder.
   *
   * The module's own flag is not sufficient: measured on a Word-exported PDF
   * whose every "ti" came out as "5" or "(", `hasEncodingIssues` was FALSE while
   * the text was plainly mangled — so this warning, the one thing standing
   * between corrupted prose and a published Canvas page, never fired. When we
   * have samples we quote them, because "some characters may have been extracted
   * incorrectly" sends a reader looking at a page that reads fine at a glance,
   * and "Crea5ve, Founda5on, direc5ons" ends the search immediately.
   */
  if (corrupted.length > 0 || hasEncodingIssues) {
    // Document-wide: neither detector reports page numbers, so the message must
    // not pretend to have any.
    findings.push({
      code: 'pdf-encoding',
      severity: 'warning',
      message:
        corrupted.length > 0
          ? 'Characters inside words were extracted incorrectly, which usually means this PDF\'s ' +
            'fonts are missing the map from glyphs to text. ' +
            `Affected words include ${corrupted.slice(0, 4).map((word) => `"${word}"`).join(', ')}. ` +
            'Read the preview closely — the text looks like prose but does not say what it appears to.'
          : 'This PDF reported character-encoding problems, so some characters may have been ' +
            'extracted incorrectly. Read the preview before preparing these pages.',
    })
  }

  return findings
}
