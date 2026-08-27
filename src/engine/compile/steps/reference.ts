/**
 * The sentence that sends the reader to an element — "as shown in Figure 3.2,
 * the phospholipid bilayer...", "We can use a table to keep track of our work".
 *
 * Shared rather than private to `alt.ts` because it is not image-specific: the
 * walk takes any element, and a table needs the same sentence for the same
 * reason. `fixTables` supplies no `src` and often no caption either, so without
 * this a `table-headers` card can reach the human carrying no context at all.
 *
 * At each ancestor level this walks ALL the way back through
 * `previousElementSibling` — not just the immediate one — before climbing to the
 * parent, so a `<div class="aside">` or similar sitting between the paragraph
 * and the element does not hide it. An empty p/heading is skipped rather than
 * returned, and the walk stops at `document.body`.
 */
export function referenceFor(el: Element): string | undefined {
  let node: Element | null = el
  const body = el.ownerDocument.body
  while (node && node !== body) {
    let sibling = node.previousElementSibling
    while (sibling) {
      if (/^(p|h[1-6])$/i.test(sibling.tagName)) {
        const text = (sibling.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text) return text
      }
      sibling = sibling.previousElementSibling
    }
    node = node.parentElement
  }
  return undefined
}

/**
 * Common abbreviations that end in a period and are routinely followed by a
 * capitalised word — the split this would otherwise get wrong most often.
 * Deliberately short: every entry is one that turns up in textbook prose.
 */
const ABBREVIATION = /\b(?:e\.g|i\.e|cf|vs|etc|Fig|Eq|No|Ch|Sec|Vol|pp|Dr|Prof|approx)\.$/i

/** Below this, a "sentence" is far more often a bad split than a real one. */
const IMPLAUSIBLY_SHORT = 30

/**
 * The opening sentence of a paragraph, for a card that has room for one line.
 *
 * A table's referencing text is not a sentence like an image's is. Where an
 * image is preceded by a short instruction ("Find the product of the first
 * terms."), a table is preceded by an explanation of how to read it — 291
 * characters for the one table in the 1.4 fixture. The card quotes the opening
 * sentence; the whole paragraph is two inches below it in the section render,
 * with the table itself outlined.
 *
 * Splitting publisher prose on "." is a bad idea done carefully. A boundary is
 * a terminator followed by whitespace and something that starts a sentence, so
 * "Table 1.4" and "3.14" survive (no whitespace after the period) while
 * "in Table 1. Write one polynomial" splits (whitespace, then a capital) even
 * though the period follows a digit. Abbreviations are excluded by list, and an
 * implausibly short result is treated as a failed split rather than a sentence.
 * Anything unsplittable comes back whole: too much context is a worse card,
 * never a wrong one.
 */
export function firstSentence(text: string): string {
  const boundary = /[.!?](?=\s+["'\u201C\u2018(\[]?[A-Z])/g
  let match: RegExpExecArray | null
  while ((match = boundary.exec(text)) !== null) {
    const head = text.slice(0, match.index + 1)
    if (ABBREVIATION.test(head)) continue
    if (head.length < IMPLAUSIBLY_SHORT) continue
    return head
  }
  return text
}
