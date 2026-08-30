import { blocksOf } from '../page-plan'
import type { ImportFinding } from '../types'
import type { PresentationIndex, PresentationSlideIndex } from './index'

/**
 * Aligns the deck's own account of itself against what anydoc produced.
 *
 * THE WALK IS MONOTONIC. Blocks are consumed forward, slides are consumed
 * forward, and neither is ever reordered or revisited. The temptation with two
 * lists is to search for the best global alignment, but a search invents an order
 * neither source claimed — and being confidently wrong about which slide a
 * paragraph came from is the failure this whole module exists to prevent. A
 * forward-only walk can only confirm or fail, and failing is the right outcome
 * when the accounts disagree.
 *
 * Output is one `<section data-slide="N">` per slide. `section` and `data-*` are
 * both already on the Canvas allowlist (`engine/allowlist.ts`), and `h1` is not,
 * which is why slide titles stay at the `h2` anydoc already emits.
 *
 * FINDINGS ARE AGGREGATED PER CODE, not raised per slide. Task 4 measured 96 of
 * 226 real slides (42%) with no title placeholder at all, so one finding per
 * slide would answer a 30-slide deck with a dozen near-identical warnings —
 * drowning the reader in exactly the noise this design exists to avoid. Each of
 * `presentation-untitled-slide`, `presentation-speaker-notes`,
 * `presentation-reading-order` and `presentation-unrepresentable` therefore
 * raises AT MOST ONE finding whose message names every slide it covers, the
 * same convention `parsers/anydoc-html.ts` states for `embedded-content`,
 * `unreferenced-asset`, `duplicate-anchor` and `layout-table`.
 */
export interface ReconcileOptions {
  html: string
  index: PresentationIndex
  /** `PPTX` or `ODP`, for finding messages. */
  sourceLabel: string
}

export interface ReconcileResult {
  html: string
  findings: ImportFinding[]
}

const collapse = (value: string) => value.replace(/\s+/g, ' ').trim()

/**
 * How much of an unattributed block's text the blocker quotes back. Long enough
 * to recognise the paragraph in the deck, short enough that a finding stays one
 * readable sentence — the same span `page-plan.ts`'s block summaries excerpt at.
 */
const ORPHAN_EXCERPT_CHARACTERS = 60

/**
 * What a soft line break contributes to a block's text: ONE SPACE. anydoc
 * renders PPTX `a:br` and ODF `text:line-break` as an inline `<br>` inside the
 * same block, and `textContent` concatenates straight across it — so
 * `<p>First half<br>second half</p>` reads `"First halfsecond half"`. The index
 * deliberately renders the same break as one space (`joinParagraphText`'s
 * `isSpace`), so a RAW `textContent` read would disagree with `notesText` on
 * every note containing a soft break, fail the equality below, and publish the
 * presenter's private words. Both sides must mean "a break is a space".
 */
const SOFT_BREAK_TEXT = ' '

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** The open tag of a heading block, for inserting the slide's id into it. */
const HEADING_OPEN_TAG = /^<h[1-6](?=[\s/>])/i

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** One top-level block, read once: everything the walk below asks about it. */
interface BlockFacts {
  /** The block exactly as `blocksOf` serialized it — never re-serialized. */
  html: string
  /** Its text with soft breaks as spaces, for matching against the index. */
  text: string
  isHeading: boolean
  /** An id anydoc already chose (`anchor`-derived) — never overwritten. */
  hasId: boolean
  isQuote: boolean
}

function readBlock(html: string): BlockFacts {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  // See SOFT_BREAK_TEXT: this is the one place the two accounts' text is
  // compared, so it is the one place the break rule has to be reconciled.
  for (const lineBreak of [...parsed.body.getElementsByTagName('br')]) {
    lineBreak.replaceWith(parsed.createTextNode(SOFT_BREAK_TEXT))
  }
  const element = parsed.body.firstElementChild
  return {
    html,
    text: collapse(parsed.body.textContent ?? ''),
    isHeading: element !== null && HEADING_TAGS.has(element.localName),
    hasId: element !== null && element.hasAttribute('id'),
    isQuote: element !== null && element.localName === 'blockquote',
  }
}

/**
 * `3` / `3 and 7` / `3, 7, and 12` — the readable list every aggregated finding
 * names its slides with. Exported and tested directly: a joining bug here is
 * invisible to every other assertion until a user reads the warning.
 */
export function formatSlideList(numbers: readonly number[]): string {
  const parts = numbers.map((number) => String(number))
  if (parts.length <= 2) return parts.join(' and ')
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

/** `Slide 3` or `Slides 3, 7, and 12`, agreeing with how many there are. */
function slidesPhrase(numbers: readonly number[]): string {
  return `${numbers.length === 1 ? 'Slide' : 'Slides'} ${formatSlideList(numbers)}`
}

function countPhrase(counts: PresentationSlideIndex['unrepresentable']): string {
  return [
    counts.diagrams > 0 ? `${counts.diagrams} diagram${counts.diagrams === 1 ? '' : 's'}` : '',
    counts.charts > 0 ? `${counts.charts} chart${counts.charts === 1 ? '' : 's'}` : '',
    // "media" is already both singular and plural; a count is enough.
    counts.media > 0 ? `${counts.media} media` : '',
  ].filter(Boolean).join(', ')
}

/**
 * One aggregated finding, pointed at a slide ONLY when exactly one slide is
 * affected. One is the degenerate case of the list, not an invented threshold:
 * with two or more slides there is no single page for `sourcePage` to name, and
 * naming the first would tell the reader the others do not exist.
 */
function aggregate(
  code: string,
  slideNumbers: readonly number[],
  message: string,
): ImportFinding {
  return {
    code,
    severity: 'warning',
    message,
    ...(slideNumbers.length === 1 ? { sourcePage: slideNumbers[0] } : {}),
  }
}

export function reconcilePresentation(options: ReconcileOptions): ReconcileResult {
  const findings: ImportFinding[] = []
  const blocks = blocksOf(options.html).map((block) => readBlock(block.html))
  const slides = options.index.slides
  const sections: string[] = []
  let at = 0

  if (slides.length === 0) {
    findings.push({
      code: 'presentation-unattributed-content',
      severity: 'blocker',
      message: `This ${options.sourceLabel} declares no slides, so its content cannot be attributed to any slide.`,
    })
    return { html: options.html, findings }
  }

  const untitled: number[] = []
  const withNotes: number[] = []
  const outOfOrder: number[] = []
  const lossy: number[] = []
  const lostTotals = { diagrams: 0, charts: 0, media: 0 }

  for (const slide of slides) {
    const remaining = slide.textRuns.map(collapse).filter(Boolean)
    const taken: BlockFacts[] = []

    while (at < blocks.length) {
      const block = blocks[at]!

      /*
       * NOTES ARE TESTED BEFORE THE RUN MATCH, and consumed without one.
       * Notes reach the page as a `<blockquote>` indistinguishable from a real
       * quotation (design fact 5), and they are NOT in `textRuns` — so a block
       * tested against the runs first would end the slide here and be reported
       * as unattributed content, blocking every deck that has speaker notes.
       * Testing notes first also closes the narrower leak: the run match is
       * deliberately loose (`text.includes(run)`), so a note long enough to
       * contain a short run of its own slide — "Mention the thylakoid
       * membrane." against the run "membrane" — would otherwise be taken for
       * slide content and PUBLISHED.
       *
       * The comparison is STRICT EQUALITY against `notesText` and nothing else.
       * That is what keeps a genuine pull quote on the page: a quotation is
       * only ever mistaken for notes if its whole text equals the whole of the
       * notes, and any looser rule (prefix, substring, similarity) would start
       * deleting quotations the presenter also mentioned in their notes.
       */
      const isNotes = slide.notesText !== undefined &&
        block.isQuote &&
        block.text === collapse(slide.notesText)
      if (isNotes) {
        at += 1
        continue
      }

      // A block whose text no remaining run of this slide accounts for ends the
      // slide — it belongs to the next one, or to nobody, and the check after
      // the loop decides which. The match is loose because anydoc reflows text;
      // its failure mode is the blocker below, a refusal rather than a guess.
      if (block.text) {
        const match = remaining.findIndex((run) =>
          run === block.text || run.includes(block.text) || block.text.includes(run))
        if (match === -1) break
        remaining.splice(match, 1)
      }
      taken.push(block)
      at += 1
    }

    const title = slide.title?.trim() || `Slide ${slide.number}`
    if (!slide.title?.trim()) untitled.push(slide.number)
    if (slide.notesText !== undefined) withNotes.push(slide.number)
    if (slide.titleOutOfOrder) outOfOrder.push(slide.number)
    if (countPhrase(slide.unrepresentable)) {
      lossy.push(slide.number)
      lostTotals.diagrams += slide.unrepresentable.diagrams
      lostTotals.charts += slide.unrepresentable.charts
      lostTotals.media += slide.unrepresentable.media
    }

    // A slide whose title never reached the HTML still gets a heading, so every
    // section is navigable and every slide is visible in the plan editor.
    const heading = taken.some((block) => block.isHeading)
      ? ''
      : `<h2 id="slide-${slide.number}">${escapeText(title)}</h2>`
    // The slide's id goes on the FIRST heading that has none. Not on every
    // heading, because a slide with a second heading would then carry the id
    // twice — invalid HTML that breaks the in-page link it exists to serve —
    // and not over an id anydoc derived from the document's own anchor, which
    // an internal link may already point at.
    let idPlaced = false
    const body = taken.map((block) => {
      if (!block.isHeading || block.hasId || idPlaced) return block.html
      idPlaced = true
      return block.html.replace(HEADING_OPEN_TAG, (open) => `${open} id="slide-${slide.number}"`)
    }).join('')
    const label = slide.title?.trim() ? `Slide ${slide.number}: ${title}` : `Slide ${slide.number}`
    sections.push(
      `<section data-slide="${slide.number}" data-plan-label="${escapeAttribute(label)}">` +
      `${heading}${body}</section>`,
    )
  }

  if (untitled.length > 0) {
    findings.push(aggregate(
      'presentation-untitled-slide',
      untitled,
      untitled.length === 1
        ? `Slide ${untitled[0]} has no title. It was titled "Slide ${untitled[0]}" so it can be found and renamed.`
        : `${slidesPhrase(untitled)} have no title. Each was titled with its own slide number so it can be found and renamed.`,
    ))
  }
  if (withNotes.length > 0) {
    findings.push(aggregate(
      'presentation-speaker-notes',
      withNotes,
      `${slidesPhrase(withNotes)} ${withNotes.length === 1 ? 'has' : 'have'} speaker notes; they were not imported,` +
      ' because notes are written for the presenter rather than the reader.',
    ))
  }
  if (outOfOrder.length > 0) {
    findings.push(aggregate(
      'presentation-reading-order',
      outOfOrder,
      `On ${outOfOrder.length === 1 ? 'slide' : 'slides'} ${formatSlideList(outOfOrder)} the title is not first in` +
      ` the deck's reading order, so ${outOfOrder.length === 1 ? 'that section may' : 'those sections may'} not read` +
      ` top to bottom. Check ${outOfOrder.length === 1 ? 'it' : 'them'} before publishing.`,
    ))
  }
  if (lossy.length > 0) {
    findings.push(aggregate(
      'presentation-unrepresentable',
      lossy,
      `${slidesPhrase(lossy)} ${lossy.length === 1 ? 'contains' : 'contain'} ${countPhrase(lostTotals)}` +
      ' that could not be imported. Add the content in Canvas afterwards.',
    ))
  }

  if (at < blocks.length) {
    const orphan = blocks[at]!.text
    findings.push({
      code: 'presentation-unattributed-content',
      severity: 'blocker',
      message:
        `This ${options.sourceLabel} produced content that belongs to no slide ` +
        `(starting "${orphan.slice(0, ORPHAN_EXCERPT_CHARACTERS)}"). ` +
        'Publishing it under the wrong slide would be a silent error, so this file must be resolved before it can be imported.',
    })
  }

  return { html: sections.join(''), findings }
}
