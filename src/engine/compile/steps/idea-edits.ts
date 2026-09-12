/**
 * Apply the IDEA phase's edits, from source, on every recompile.
 *
 * Same discipline as `resolveAlt` applying answers: nothing edit-shaped is
 * stored in the output, so reversal is a map delete plus a recompile. An edit
 * whose original text is no longer where the key says it was is DROPPED WITH
 * A NOTE — applying a replacement to whatever text happens to be there now
 * would be rewriting a sentence nobody looked at.
 *
 * Runs AFTER `appendAttribution`, because the change sentence CC BY asks for
 * ("indicate if changes were made") belongs in the attribution block, and this
 * is the only step that knows whether a change was made.
 */
import type { Step } from './index'
import { parseIdeaEditKey } from '../../idea/edits'
import { findOccurrence, preserveCase, replaceAt } from '../../idea/text'

export const IDEA_CHANGE_NOTE = 'Modified from the original: wording updated for inclusive language.'

export const applyIdeaEdits: Step = (doc, ctx, sink) => {
  const edits = ctx.ideaEdits
  if (!edits || edits.size === 0) return

  let applied = 0
  let stale = 0
  for (const [key, edit] of edits) {
    const { sectionId, elementId, occurrence, original } = parseIdeaEditKey(key)
    if (sectionId !== ctx.sectionId) continue
    if (edit.kind === 'keep' && edit.context === undefined) continue

    const el = doc.getElementById(elementId)
    const occ = el ? findOccurrence(el, original, occurrence) : undefined
    if (!occ) {
      stale += 1
      continue
    }
    if (edit.kind === 'replace') {
      replaceAt(occ, original, preserveCase(original, edit.replacement))
    } else {
      replaceAt(occ, original, `${original} (${edit.context})`)
    }
    applied += 1
  }

  if (applied > 0) {
    const block = doc.body.querySelector('.b2c-attribution')
    if (block && !block.querySelector('.b2c-idea-change')) {
      const p = doc.createElement('p')
      p.className = 'b2c-idea-change'
      p.textContent = IDEA_CHANGE_NOTE
      block.appendChild(p)
    }
    sink.note('idea-edits', `${applied} inclusive-language edit(s) applied`, applied)
  }
  if (stale > 0) {
    // Singular-shaped on purpose; the count field carries the number.
    sink.note('idea-edits', `${stale} inclusive-language edit no longer matched and was not applied`, stale)
  }
}
