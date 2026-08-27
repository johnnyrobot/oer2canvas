/**
 * Every image whose alt cannot be trusted becomes a question for a human.
 *
 * WHY `alt=""` IS NOT TRUSTED. Four of the seven images in the 1.4 fixture are
 * rendered equation pictures inside a worked solution, carrying `alt=""` and no
 * recoverable LaTeX. axe passes `alt=""` as decorative, which is exactly why the
 * milestone measured zero violations while four equations were invisible. The
 * publisher's own markup gives the reason: `<span data-type="media" data-alt="">`
 * is an UNFILLED CMS FIELD propagating into `alt`, not an author's decorative
 * declaration. In that fixture the claim is wrong 4 times out of 4.
 *
 * `role="presentation"` and `aria-hidden` ARE trusted. Someone who writes an
 * ARIA role made a deliberate statement about their own markup; someone who left
 * a description box blank did not. That is the whole line.
 *
 * THIS DOES NOT CONTRADICT `alt-text.ts`, which says correctly that `alt=""` is
 * the right way to mark an image decorative and is not an audit defect. A
 * `QueueItem` is not a WCAG violation claim — it is a request for confirmation.
 * That is why it is a separate type, and why `alt-text.ts` needs no change.
 *
 * The asymmetry justifies itself: slice 5 clears a false positive with one
 * keystroke and dedupes repeats by hash, while a false negative ships an
 * unreadable equation.
 */
import type { Step } from './index'
import { ensureId } from '../ids'
import { queueKeyOf } from '../answers'
import { captionText } from './caption'
import { referenceFor } from './reference'
import { fitCanvasAltText } from '../../alt-text'
import { altTextIssue } from '../../audit/alt-text'

function isPresentational(image: Element): boolean {
  const role = image.getAttribute('role') ?? ''
  if (role === 'presentation' || role === 'none') return true
  return image.closest('[aria-hidden="true"]') !== null
}

/** The caption `restructureFigures` associated with this image, if any. */
function captionFor(image: Element): string | undefined {
  const caption = image.closest('.b2c-figure')?.querySelector('.b2c-caption')
  return caption ? captionText(caption) : undefined
}

/**
 * The descriptive half of that caption, and the end of its short life.
 *
 * `restructureFigures` put it here because it is the last step that can see the
 * publisher's caption structure. Reading it CONSUMES it: the loop
 * below calls this for every image before any early return, so the scratch
 * attribute cannot survive into published html no matter which branch an image
 * takes.
 */
function takeCaptionDescription(image: Element): string | undefined {
  const description = image.getAttribute('data-b2c-caption-description')
  image.removeAttribute('data-b2c-caption-description')
  return description ?? undefined
}

export const resolveAlt: Step = (doc, ctx, sink) => {
  const images = Array.from(doc.body.querySelectorAll('img'))
  let presentational = 0
  // Counted, not noted one by one. A chapter with twelve confirmed decoratives
  // should say so once — `FixNote.count` exists for exactly this, and twelve
  // identical lines is a notes panel nobody reads.
  let confirmedDecorative = 0
  let described = 0
  let shortened = 0

  images.forEach((image, index) => {
    // First, unconditionally: this both reads and clears, and every image must
    // be cleared even when nothing below queues it.
    const description = takeCaptionDescription(image)

    const sourceAlt = image.getAttribute('alt')
    const sourceIssue = sourceAlt && sourceAlt.trim() !== ''
      ? altTextIssue({ alt: sourceAlt, src: image.getAttribute('src') ?? '', presentation: false })
      : null
    // Apply the platform limit before the presentation check as well. A hidden
    // image does not need quality review, but its markup still has to be safe
    // for Canvas to save.
    if (sourceAlt !== null) {
      const fitted = fitCanvasAltText(sourceAlt)
      if (fitted !== sourceAlt) {
        image.setAttribute('alt', fitted)
        shortened += 1
      }
    }

    const alt = image.getAttribute('alt')

    if (isPresentational(image)) {
      presentational += 1
      return
    }

    // A non-empty publisher alt is normally trusted. Definite junk is the
    // exception: it must become an alt-description question so an existing
    // filename/URL/placeholder cannot reach the gate with no way to repair it.
    // Long descriptions are fitted before this check, so they are accepted once
    // they satisfy Canvas's 120-character limit.
    const src = image.getAttribute('src') ?? ''
    const fittedIssue = alt && alt.trim() !== ''
      ? altTextIssue({ alt, src, presentation: false })
      : null
    const definiteIssue = sourceIssue?.id === 'alt-text-too-long' ? fittedIssue : sourceIssue ?? fittedIssue
    if (alt !== null && alt.trim() !== '' && (!definiteIssue || definiteIssue.severity !== 'error')) {
      return
    }

    const elementId = ensureId(image, 'img', index)
    const hash = ctx.profile.hashFromUrl(src)

    // HOW THE QUEUE SHRINKS. Nothing removes an item from a queue; compile
    // stops producing it. So an answered image is written and skipped here, and
    // reversing the answer is a map delete plus a recompile — no undo log, and
    // no answer-shaped thing anywhere in `CompiledChapter` (D5.1, D5.11).
    //
    // The id is minted BEFORE the lookup because a hashless image is keyed by
    // it. `ensureId` is deterministic on position, so the key an answer was
    // stored under is the key this recompile computes. Valid publisher markup
    // returns above without receiving an otherwise unnecessary generated id.
    const answer = ctx.answers?.get(queueKeyOf({ hash, sectionId: ctx.sectionId, elementId }))
    if (answer?.type === 'decorative') {
      image.setAttribute('alt', '')
      confirmedDecorative += 1
      return
    }
    if (answer?.type === 'alt') {
      const fitted = fitCanvasAltText(answer.text)
      image.setAttribute('alt', fitted)
      if (fitted !== answer.text) shortened += 1
      described += 1
      return
    }

    const caption = captionFor(image)
    // D6a: caption-derived -> VLM -> blank. A label-only caption is no caption
    // at all for this purpose — proposing "Figure 1" as alt text would be worse
    // than proposing nothing, because it looks plausible enough to rubber-stamp.
    // The DESCRIPTION is what gets drafted; the whole caption is what gets shown.
    const proposed =
      description && !ctx.profile.labelOnlyCaption.test(description)
        ? fitCanvasAltText(description)
        : undefined

    sink.queue({
      kind: alt !== null && alt.trim() !== '' ? 'alt' : alt !== null ? 'confirm-decorative' : 'alt',
      elementId,
      hash,
      context: { src, caption, reference: referenceFor(image) },
      proposed,
    })
  })

  if (confirmedDecorative > 0) {
    sink.note(
      'alt',
      `${confirmedDecorative} image(s) confirmed decorative by the instructor`,
      confirmedDecorative,
    )
  }
  if (described > 0) {
    sink.note('alt', `${described} image(s) described by the instructor`, described)
  }
  if (shortened > 0) {
    sink.note(
      'alt',
      `${shortened} image alt text value(s) shortened to Canvas's 120-character limit`,
      shortened,
    )
  }

  if (presentational > 0) {
    sink.note(
      'alt',
      `${presentational} image(s) are explicitly marked decorative by the publisher and were not queued`,
      presentational,
    )
  }
}
