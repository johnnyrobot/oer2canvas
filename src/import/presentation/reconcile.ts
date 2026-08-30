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
 * ATTRIBUTION IS BY PREFIX ACCUMULATION, NOT BY MATCHING RUNS ONE AT A TIME.
 * The two accounts do not agree on granularity: anydoc collapses a whole
 * bulleted body into ONE `<ul>` block (measured — `<ul><li><p>Light reactions
 * </p></li><li><p>Calvin cycle</p></li></ul>`), while the index keeps one run
 * per bullet. An earlier rule that matched each block against ANY ONE
 * remaining run therefore left a slide's other bullets spare, and — because
 * the match was loose enough to survive anydoc's reflowing — a LATER block
 * could then be eaten by a spare run: a real three-slide agenda deck whose
 * bullets named its later slides put slide 2's own title heading inside slide
 * 1's section, fabricated a replacement heading for slide 2, and raised no
 * finding at all. Silent misattribution, which is the one outcome this module
 * exists to make impossible.
 *
 * So a slide's expected text is its runs CONCATENATED, and blocks are consumed
 * while the text accumulated so far remains a PREFIX of it. The slide is
 * complete on exact equality, and a slide that ends incomplete is a refusal,
 * never a guess. Both sides are squeezed (all whitespace removed, not merely
 * collapsed) before comparing, because the two accounts disagree about
 * whitespace in ways that carry no meaning: `<li>` boundaries, a soft line
 * break rendered as `<br>` against the index's single space, and ODF
 * whitespace between sibling runs.
 *
 * Output is one `<section data-slide="N">` per slide. `section` and `data-*` are
 * both already on the Canvas allowlist (`engine/allowlist.ts`). Slide titles stay
 * at the `h2` anydoc already emits for them, and an `h1` anydoc emits of its own
 * for an ODP `text:h` body heading (measured) is DEMOTED TO `h3` — see the
 * demotion below for why that is this module's business rather than the
 * allowlist's.
 *
 * `#slide-N` IS NOT A STABLE PER-SLIDE ANCHOR. anydoc gives a heading its own
 * `id` derived from the document's own anchor (measured: `<h2 id="Cell-walls">`),
 * and an id the document chose beats one invented here, so `slide-N` only ever
 * appears on a heading this module generated — for an untitled slide, or where
 * anydoc emitted no heading for the title. Anything wanting to address every
 * slide (a slide-by-slide table of contents, say) must go through
 * `section[data-slide]`, which is always there.
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
 * The comparison form for BOTH accounts: every whitespace character removed,
 * not just runs of it collapsed. anydoc and the deck's own XML disagree about
 * whitespace wherever it carries no meaning — `<li>` boundaries inside the one
 * `<ul>` block a bulleted body becomes, a soft line break anydoc renders as
 * `<br>` (whose `textContent` joins with nothing) against the single space the
 * index renders it as, and the whitespace ODF leaves between sibling runs. None
 * of those differences is a difference in content, and squeezing is the one
 * normalisation under which the two accounts can be compared for equality at
 * all.
 */
const squeeze = (value: string) => value.replace(/\s+/g, '')

/**
 * What a soft line break contributes to a block's text: ONE SPACE. anydoc
 * renders PPTX `a:br` and ODF `text:line-break` as an inline `<br>` inside the
 * same block, and `textContent` concatenates straight across it — so
 * `<p>First half<br>second half</p>` reads `"First halfsecond half"` where the
 * index renders the same break as one space. `squeeze` makes the two agree
 * either way; this keeps `text` readable for a human looking at a block, and
 * keeps the two meanings of "a break" reconciled at the one place that
 * compares them, rather than resting the safety of the notes comparison on a
 * single normalisation.
 */
const SOFT_BREAK_TEXT = ' '

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** The open tag of a heading block, for inserting the slide's id into it. */
const HEADING_OPEN_TAG = /^<h[1-6](?=[\s/>])/i

const H1_OPEN_TAG = /^<h1(?=[\s/>])/i
const H1_CLOSE_TAG = /<\/h1>$/i

/**
 * An `h1` anydoc emitted INSIDE a slide becomes an `h3`. anydoc emits one for
 * an ODP `text:h` body heading (measured), and such a heading is content
 * subordinate to the slide's own `h2` title, so `h3` is the level that says
 * what it is.
 *
 * This is not something to hand downstream. `engine/allowlist.ts` turns on
 * `shiftHeadings` whenever any content `h1` is present and demotes EVERY
 * heading a level, so one stray `text:h` anywhere in a deck would push every
 * slide title on the page from `h2` to `h3` — a whole document's heading
 * structure changed by one paragraph in one slide. Fixing it here, where the
 * enclosing `h2` is known, is the only place the correct level can be worked
 * out at all.
 */
function demoteH1(html: string): string {
  if (!H1_OPEN_TAG.test(html)) return html
  return html.replace(H1_OPEN_TAG, '<h3').replace(H1_CLOSE_TAG, '</h3>')
}

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
  /** Its text with soft breaks as spaces, for a human reading a block. */
  text: string
  /** Its text in comparison form — see `squeeze`. */
  squeezed: string
  isHeading: boolean
  /** An id anydoc already chose (`anchor`-derived) — never overwritten. */
  hasId: boolean
  isQuote: boolean
  /** Carries a picture: the only text-free block a slide can claim. */
  hasImage: boolean
}

function readBlock(html: string): BlockFacts {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  for (const lineBreak of [...parsed.body.getElementsByTagName('br')]) {
    lineBreak.replaceWith(parsed.createTextNode(SOFT_BREAK_TEXT))
  }
  const element = parsed.body.firstElementChild
  const text = collapse(parsed.body.textContent ?? '')
  return {
    html,
    text,
    squeezed: squeeze(text),
    isHeading: element !== null && HEADING_TAGS.has(element.localName),
    hasId: element !== null && element.hasAttribute('id'),
    isQuote: element !== null && element.localName === 'blockquote',
    hasImage: parsed.body.getElementsByTagName('img').length > 0,
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
  const incomplete: number[] = []
  const lostTotals = { diagrams: 0, charts: 0, media: 0 }

  for (const slide of slides) {
    const expected = squeeze(slide.textRuns.join(''))
    const taken: BlockFacts[] = []
    let accumulated = ''
    let imagesLeft = slide.images

    while (at < blocks.length) {
      const block = blocks[at]!

      /*
       * NOTES ARE TESTED FIRST, and consumed without contributing any text.
       * Notes reach the page as a `<blockquote>` indistinguishable from a real
       * quotation (design fact 5), and they are NOT in `textRuns` — so a block
       * tested against the accumulation first would end the slide here, leave
       * it incomplete, and refuse every deck that has speaker notes.
       *
       * The comparison is STRICT EQUALITY against `notesText` and nothing else
       * (in the squeezed form both accounts are compared in). That is what
       * keeps a genuine pull quote on the page: a quotation is only ever
       * mistaken for notes if its WHOLE text equals the WHOLE of the notes, and
       * any looser rule — containment in either direction, a prefix, a
       * similarity score — starts deleting quotations a presenter also
       * mentioned in their notes. A deleted quotation is invisible to the
       * reader; that is why the rule does not bend.
       */
      const isNotes = slide.notesText !== undefined &&
        block.isQuote &&
        block.squeezed === squeeze(slide.notesText)
      if (isNotes) {
        at += 1
        continue
      }

      /*
       * A TEXT-FREE BLOCK IS CLAIMED AGAINST THE SLIDE'S IMAGE COUNT, never
       * absorbed because it happens to be next. anydoc emits a picture as
       * `<p><img …></p>` — measured — which carries no text for the
       * accumulation to test, so an earlier version let ANY text-free block
       * through unconditionally. Measured on a three-slide deck whose middle
       * slide is image-only, in both ODP and PPTX: the image landed in slide
       * 1's section, slide 2 shipped holding nothing but a generated heading,
       * and no finding said so — misattribution AND content loss, silently.
       *
       * The index's per-slide image count is what disambiguates it, and it has
       * to be a count rather than a position: a titled slide with its own
       * picture must still take that picture, and nothing about where the block
       * sits distinguishes that from the next slide's. A text-free block this
       * slide has no budget for — or one carrying no picture at all — ends the
       * slide and becomes the refusal below rather than being swallowed.
       */
      if (!block.squeezed) {
        if (!block.hasImage || imagesLeft <= 0) break
        imagesLeft -= 1
        taken.push(block)
        at += 1
        continue
      }

      // A block that would take the accumulation off the slide's own text ends
      // the slide: it belongs to the next one, or to nobody, and the checks
      // below decide which.
      if (!expected.startsWith(accumulated + block.squeezed)) break
      accumulated += block.squeezed
      taken.push(block)
      at += 1
    }

    /*
     * A slide whose content anydoc never produced in full — text the
     * accumulation never reached, or a picture the index counted that no block
     * ever spent. The deck says the slide carries something this HTML does not
     * account for, so something was lost or reordered, and every later slide's
     * attribution is now a guess. This is the refusal that makes the walk's
     * promise true — without it, total content loss (`html: ''` against a
     * fully populated deck) produced a page of empty sections and NO finding.
     *
     * UNSPENT IMAGE BUDGET IS THE SAME KIND OF DISAGREEMENT AS UNMATCHED TEXT,
     * and is counted here rather than being left to lapse. A slide holding a
     * budget it never spent will otherwise spend it on the NEXT slide's
     * picture: measured with a `p:pic` whose `r:embed` names an undefined
     * relationship — anydoc emits nothing and raises no finding of its own —
     * slide 1 took slide 2's image, slide 2 shipped holding only its generated
     * heading, and the only finding was `presentation-untitled-slide`. Refusing
     * on the unspent budget closes that whole class ("a counted picture anydoc
     * did not emit") rather than the one trigger that exposed it.
     */
    if (accumulated !== expected || imagesLeft > 0) incomplete.push(slide.number)

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

    /*
     * The heading anydoc emitted for THIS SLIDE'S TITLE, if it emitted one —
     * identified by its text, not merely by being a heading. An untitled slide
     * has none by definition, and a slide can carry headings that are not its
     * title: an ODP `text:h` in the body becomes an `<h1>` of anydoc's own
     * (measured). Treating any heading as the title left an untitled slide with
     * no generated `<h2 id="slide-N">` at all — no anchor, and a
     * `presentation-untitled-slide` finding claiming a title the section did
     * not have.
     */
    const titleBlock = slide.title?.trim()
      ? taken.find((block) => block.isHeading && block.squeezed === squeeze(title))
      : undefined
    // Every section gets a heading: anydoc's own when it produced one, and
    // otherwise a generated `h2` carrying the slide's anchor, so every slide is
    // navigable and visible in the plan editor.
    const heading = titleBlock ? '' : `<h2 id="slide-${slide.number}">${escapeText(title)}</h2>`
    // The slide's id goes on that ONE heading — not on every heading, because a
    // slide with a second heading would then carry the id twice, invalid HTML
    // that breaks the in-page link the id exists to serve — and never over an
    // id anydoc derived from the document's own anchor, which an internal link
    // may already point at.
    const body = taken.map((block) => {
      const html = block === titleBlock && !block.hasId
        ? block.html.replace(HEADING_OPEN_TAG, (open) => `${open} id="slide-${slide.number}"`)
        : block.html
      return block === titleBlock ? html : demoteH1(html)
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

  /*
   * ONE blocker for the whole disagreement, whichever side it fell on: slides
   * missing text the deck says they carry, blocks belonging to no slide, or
   * both. It DESCRIBES the mismatch without reproducing any of the content —
   * an earlier version quoted 60 characters of the orphaned block, which for a
   * failed notes match is the presenter's private note itself, copied into a
   * finding that may be logged, exported, or shared. A feature whose purpose is
   * not publishing private notes must not publish them through its own error
   * reporting either.
   */
  const orphaned = blocks.length - at
  if (incomplete.length > 0 || orphaned > 0) {
    const problems = [
      incomplete.length > 0
        ? `${slidesPhrase(incomplete).toLowerCase()} ${incomplete.length === 1 ? 'is' : 'are'} missing content the deck says ${incomplete.length === 1 ? 'it carries' : 'they carry'}`
        : '',
      orphaned > 0
        ? `${orphaned === 1 ? '1 block of content belongs' : `${orphaned} blocks of content belong`} to no slide`
        : '',
    ].filter(Boolean)
    findings.push({
      code: 'presentation-unattributed-content',
      severity: 'blocker',
      message:
        `This ${options.sourceLabel} and the slides it declares do not agree: ${problems.join(', and ')}. ` +
        'Publishing content under the wrong slide would be a silent error, so this file must be resolved before it can be imported.',
    })
  }

  return { html: sections.join(''), findings }
}
