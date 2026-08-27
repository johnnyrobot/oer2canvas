/**
 * `<figure>` becomes an allowlist-safe div that keeps the caption ASSOCIATED.
 *
 * Canvas's Appendix B allows neither `<figure>` nor `<figcaption>`, so
 * `validateAllowlist` unwraps both and reports semantic loss, which the gate
 * turns into a blocker. Textbook chapters are built almost entirely from
 * figures, so taken literally every chapter would be permanently unpublishable.
 * `aria-describedby` IS allowed, so the caption stays programmatically tied to
 * the image however strict the sanitizer turns out to be — and the rule holds
 * either way: never ship a caption that merely sits near an image.
 *
 * A LABEL-ONLY caption ("Figure 1") is kept, not dropped. Body text says "as
 * shown in Figure 1", so the label is what makes that cross-reference resolve.
 * It is noted, and `resolveAlt` refuses to use it as an alt source, because
 * "Figure 1" describes nothing.
 *
 * The visible caption keeps its label and its credit. Only the ALT DRAFT wants
 * the description alone, and this step is the last one that can still tell the
 * two apart — see `data-b2c-caption-description` below.
 */
import type { Step } from './index'
import { unwrap } from '../dom'
import { captionDescriptionText, captionText, findCaption } from './caption'

export const restructureFigures: Step = (doc, ctx, sink) => {
  const figures = Array.from(doc.body.querySelectorAll('figure'))

  figures.forEach((figure, index) => {
    const caption = findCaption(figure, ctx.profile)
    const figureId = figure.getAttribute('id') ?? `b2c-fig-${index}`

    const div = doc.createElement('div')
    div.className = 'b2c-figure'
    div.id = figureId

    for (const wrapper of Array.from(figure.querySelectorAll(ctx.profile.mediaWrapper))) {
      unwrap(wrapper)
    }
    while (figure.firstChild) div.appendChild(figure.firstChild)

    if (caption) {
      const text = captionText(caption)
      if (text) {
        const captionId = `b2c-cap-${figureId}`
        const p = doc.createElement('p')
        p.className = 'b2c-caption'
        p.id = captionId
        p.textContent = text
        div.appendChild(p)
        const image = div.querySelector('img')
        if (image) {
          image.setAttribute('aria-describedby', captionId)
          // THE DESCRIPTION HAS TO BE TAKEN HERE OR NOT AT ALL. The line above
          // flattens the container to `p.textContent`, so by the time
          // `resolveAlt` runs — three steps later — the publisher's `.os-caption`
          // span no longer exists to read. The attribute carries it across, and
          // `resolveAlt` removes it from every image it visits, so it never
          // reaches published html. Compare `data-b2c-xref` in `links.ts`, which
          // uses the same channel deliberately and does ship.
          const description = captionDescriptionText(caption, ctx.profile)
          if (description) image.setAttribute('data-b2c-caption-description', description)
        }
        if (ctx.profile.labelOnlyCaption.test(text)) {
          sink.note(
            'figures',
            `Caption for ${figureId} is label-only ("${text}"); kept so the cross-reference resolves, not used as an alt source`,
          )
        }
      }
      caption.remove()
    }

    figure.replaceWith(div)
  })

  if (figures.length > 0) {
    sink.note('figures', `Restructured ${figures.length} figure(s) into allowlist-safe markup`, figures.length)
  }
}
