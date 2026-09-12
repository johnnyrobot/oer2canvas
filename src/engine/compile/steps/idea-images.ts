/**
 * Place the images the IDEA phase added. Runs AFTER `ensureBlockIds` — so
 * the ids existing edits were keyed on do not shift — and BEFORE `resolveAlt`,
 * so the new image is judged by the same alt rules as every other image and
 * would be queued if its alt were missing (the dialog does not allow that, but
 * the step does not rely on the dialog).
 *
 * Markup mirrors what `restructureFigures` emits, because that is the shape
 * the allowlist, the gate, and the exporter already accept. The `src` is a
 * packaged reference; the chapter's `assets` carry the bytes under the same
 * name, and the exporter resolves one against the other.
 *
 * Like `applyIdeaEdits`, nothing edit-shaped survives in the output: an undo
 * is a map delete plus a recompile, and a target that no longer exists is
 * DROPPED WITH A NOTE rather than placed somewhere nobody chose.
 */
import type { Step } from './index'
import { packagedReference } from '../../../import/assets'
import { ideaFigureId, parseIdeaEditKey } from '../../idea/edits'

export const insertIdeaImages: Step = (doc, ctx, sink) => {
  const edits = ctx.ideaEdits
  if (!edits || edits.size === 0) return
  let placed = 0
  let lost = 0
  for (const [key, edit] of edits) {
    if (edit.kind !== 'image') continue
    if (parseIdeaEditKey(key).sectionId !== ctx.sectionId) continue
    const figureId = ideaFigureId(edit)
    if (doc.getElementById(figureId)) continue // compile(compile(x)) === compile(x)
    const target = doc.getElementById(edit.placement.elementId)
    if (!target) { lost += 1; continue }

    const figure = doc.createElement('div')
    figure.className = 'b2c-figure'
    figure.id = figureId
    const img = doc.createElement('img')
    img.setAttribute('src', packagedReference(edit.assetName))
    img.setAttribute('alt', edit.alt)
    img.setAttribute('width', String(edit.width))
    img.setAttribute('height', String(edit.height))
    const captionId = `b2c-cap-${figureId}`
    img.setAttribute('aria-describedby', captionId)
    figure.appendChild(img)
    // The caption carries the TASL credit, so the attribution travels with
    // the image wherever the page is copied (spec §6.4).
    const caption = doc.createElement('p')
    caption.className = 'b2c-caption'
    caption.id = captionId
    caption.append(doc.createTextNode(`${edit.caption ? `${edit.caption} ` : ''}${edit.attribution.text} (`))
    const link = doc.createElement('a')
    link.setAttribute('href', edit.attribution.sourcePageUrl)
    link.textContent = 'source'
    caption.append(link, doc.createTextNode(')'))
    figure.appendChild(caption)

    if (edit.placement.kind === 'replace') target.replaceWith(figure)
    else target.after(figure)
    placed += 1
  }
  if (placed > 0) sink.note('idea-images', `${placed} image(s) added by the instructor`, placed)
  // Singular-shaped on purpose, like idea-edits; the count field carries the number.
  if (lost > 0) sink.note('idea-images', `${lost} added image could not be placed because its target is gone`, lost)
}
