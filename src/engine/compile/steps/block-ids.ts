/**
 * Every outermost block gets an id, so a finding can point at the element it
 * is about and an edit can be applied to the same element on the next
 * recompile. Deterministic on position, like `ensureId` for images: the same
 * input yields the same ids, which is what makes a stored edit key mean the
 * same thing tomorrow.
 *
 * UNIQUE ACROSS THE CHAPTER, not just the section. A Canvas page is one
 * section, but the app's own chapter views render every section of a chapter
 * on one page, and `App.a11y.browser.test.tsx` holds that page to "no id
 * appears twice". So the id carries a short hash of the section id ahead of
 * the index: `b2c-blk-<section>-<n>`.
 *
 * Not a fix, so not noted: an id changes nothing a reader or a screen reader
 * can perceive, and a notes panel that reports "added 140 ids" is noise.
 *
 * The app's own chrome is skipped. The attribution block and the Canvas
 * template's footer and fallback title are minted by LATER steps, so on a
 * first compile they are not here to see; on a compile of compiled output
 * they are, and giving them ids then would make compile(compile(x)) differ
 * from compile(x). Nothing in them is publisher text a finding could name.
 */
import type { Step } from './index'
import { blockElements } from '../../idea/text'

const CHROME = '.b2c-attribution, .b2c-canvas-footer, .b2c-canvas-title'

/** FNV-1a, 32-bit, in base 36: seven characters at most, no dependency. */
function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

export function blockId(sectionId: string, index: number): string {
  return `b2c-blk-${shortHash(sectionId)}-${index}`
}

export const ensureBlockIds: Step = (doc, ctx) => {
  blockElements(doc.body)
    .filter((el) => !el.closest(CHROME))
    .forEach((el, index) => {
      if (!el.getAttribute('id')) el.setAttribute('id', blockId(ctx.sectionId, index))
    })
}
