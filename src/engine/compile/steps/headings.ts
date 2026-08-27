/**
 * Re-level headings so the shallowest is `h2`, then close any skip.
 *
 * The shift is SIGNED. A document starting at `h1` demotes; one starting at `h3`
 * is PROMOTED, because Canvas renders the page title as the page's `h1` and an
 * `h3` directly beneath it is a skipped level — the very violation this exists
 * to prevent.
 *
 * ELIMINATING `h1` IS LOAD-BEARING, not a side effect. `allowlist.ts` demotes
 * EVERY heading by one when it sees a content `h1` (`shiftHeadings`, C15). If
 * this step left one behind, repair would demote the whole document a second
 * time and it would ship one level too deep throughout. There is a test above
 * that pins it, and the whole-fixture invariant test in Task 24 pins it again
 * end to end.
 */
import type { Step } from './index'
import { renameElement } from '../dom'

const LEVEL: Readonly<Record<string, number>> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }

export const relevelHeadings: Step = (doc, _ctx, sink) => {
  const headings = Array.from(doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  if (headings.length === 0) return

  const source = headings.map((h) => LEVEL[h.tagName.toLowerCase()]!)
  const shift = 2 - Math.min(...source)

  // The Canvas page title is the page's h1, so the first content heading may be
  // at most h2 — hence a previous level of 1 going in.
  let previous = 1
  let changed = 0
  headings.forEach((heading, i) => {
    let target = Math.min(6, Math.max(2, source[i]! + shift))
    if (target > previous + 1) target = previous + 1
    previous = target
    const tag = `h${target}`
    if (heading.tagName.toLowerCase() !== tag) {
      renameElement(heading, tag)
      changed += 1
    }
  })

  if (changed > 0) {
    sink.note('headings', `Re-levelled ${changed} heading(s) so none skips a level`, changed)
  }
}
