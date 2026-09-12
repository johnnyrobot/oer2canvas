/**
 * Every outermost block gets an id, so a finding can point at the element it
 * is about and an edit can be applied to the same element on the next
 * recompile. Deterministic on position, like `ensureId` for images: the same
 * input yields the same ids, which is what makes a stored edit key mean the
 * same thing tomorrow.
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

export const ensureBlockIds: Step = (doc) => {
  blockElements(doc.body)
    .filter((el) => !el.closest(CHROME))
    .forEach((el, index) => {
      if (!el.getAttribute('id')) el.setAttribute('id', `b2c-blk-${index}`)
    })
}
