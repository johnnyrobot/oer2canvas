/**
 * D9: the source is never stripped.
 *
 * This is a correctness requirement, not a courtesy. All three publishers are
 * openly licensed under varying terms and CC BY REQUIRES attribution; emitting
 * these pages without it would produce license violations at scale. So there is
 * no setting for this and no way to turn it off.
 *
 * It is emitted BEFORE the audit sees it, which means it is held to WCAG like
 * everything else — hence the license link carrying its name as link text
 * rather than a bare url.
 *
 * When metadata is missing the block degrades and says so. It never disappears,
 * and it never degrades silently.
 */
import type { Step } from './index'

export const appendAttribution: Step = (doc, ctx, sink) => {
  // Idempotent: recompiling after the queue is cleared must not stack blocks.
  if (doc.body.querySelector('.b2c-attribution')) return

  const { attribution: a } = ctx
  const block = doc.createElement('div')
  block.className = 'b2c-attribution'

  const heading = doc.createElement('h2')
  heading.textContent = 'Source and license'
  block.appendChild(heading)

  const source = doc.createElement('p')
  if (ctx.canonicalUrl) {
    const link = doc.createElement('a')
    link.setAttribute('href', ctx.canonicalUrl)
    link.textContent = ctx.sectionTitle
    source.appendChild(link)
  } else {
    source.appendChild(doc.createTextNode(ctx.sectionTitle))
  }
  source.appendChild(doc.createTextNode(
    ctx.profile.id === 'document'
      ? ` — source: ${a.publisher}.`
      : ` — from ${a.bookTitle}, published by ${a.publisher}.`,
  ))
  block.appendChild(source)

  const authors = doc.createElement('p')
  authors.textContent =
    a.authors.length > 0
      ? `By ${a.authors.join(', ')}.`
      : ctx.profile.id === 'document'
        ? 'No author or organization was supplied.'
        : 'The authors of this material could not be determined from the publisher’s data.'
  block.appendChild(authors)

  const license = doc.createElement('p')
  if (a.license?.url) {
    const licenseLink = doc.createElement('a')
    licenseLink.setAttribute('href', a.license.url)
    // Descriptive text, never a bare url — this block is audited too.
    licenseLink.textContent = a.license.name
    license.append(doc.createTextNode('Licensed under the '), licenseLink, doc.createTextNode('.'))
  } else if (a.license) {
    license.textContent = `Licensed under the ${a.license.name}.`
  } else {
    license.textContent =
      ctx.profile.id === 'document'
        ? 'No license was supplied.'
        : 'The license for this material could not be determined from the publisher’s data.'
  }
  block.appendChild(license)

  doc.body.appendChild(block)
  sink.note('attribution', 'Added the source and license block required by D9')
}
