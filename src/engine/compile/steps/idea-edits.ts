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
 *
 * Image edits (slice 5) were placed by `insertIdeaImages` earlier; here they
 * get their line in the Source-and-license block — TASL with the licence as
 * a link, once per asset, and the share-alike sentence where CC BY-SA asks
 * for it. Only an image whose figure is actually in the document is credited:
 * a credit for an image that could not be placed would be a lie.
 */
import type { Step } from './index'
import { ideaFigureId, parseIdeaEditKey, type ImageEdit } from '../../idea/edits'
import { findOccurrence, preserveCase, replaceAt } from '../../idea/text'

export const IDEA_CHANGE_NOTE = 'Modified from the original: wording updated for inclusive language.'

export const applyIdeaEdits: Step = (doc, ctx, sink) => {
  const edits = ctx.ideaEdits
  if (!edits || edits.size === 0) return

  let applied = 0
  let stale = 0
  const images: ImageEdit[] = []
  for (const [key, edit] of edits) {
    const { sectionId, elementId, occurrence, original } = parseIdeaEditKey(key)
    if (sectionId !== ctx.sectionId) continue
    if (edit.kind === 'image') { images.push(edit); continue }
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

  const block = doc.body.querySelector('.b2c-attribution')
  for (const edit of images) {
    if (!block || !doc.getElementById(ideaFigureId(edit))) continue
    if (block.querySelector(`.b2c-idea-image-credit[data-asset="${CSS.escape(edit.assetName)}"]`)) { applied += 1; continue }
    block.appendChild(imageCredit(doc, edit))
    applied += 1
  }

  if (applied > 0) {
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

/** "Additional image: Title by Author, Source, <a>Licence</a> (source)." plus the share-alike sentence. */
function imageCredit(doc: Document, edit: ImageEdit): HTMLParagraphElement {
  const { attribution } = edit
  const p = doc.createElement('p')
  p.className = 'b2c-idea-image-credit'
  p.setAttribute('data-asset', edit.assetName)
  // The TASL text ends in ", <licence>"; the licence is emitted once, as a link.
  p.append(doc.createTextNode(`Additional image: ${attribution.text.replace(/, [^,]+$/, '')}, `))
  if (attribution.licenseUrl) {
    const a = doc.createElement('a')
    a.setAttribute('href', attribution.licenseUrl)
    a.textContent = attribution.licenseName
    p.append(a)
  } else {
    p.append(doc.createTextNode(attribution.licenseName))
  }
  const src = doc.createElement('a')
  src.setAttribute('href', attribution.sourcePageUrl)
  src.textContent = 'source'
  p.append(doc.createTextNode(' ('), src, doc.createTextNode(').'))
  if (attribution.shareAlike) {
    p.append(doc.createTextNode(' This image is licensed share-alike; adaptations of it must carry the same licence.'))
  }
  return p
}
