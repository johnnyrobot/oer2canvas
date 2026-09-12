import type { Step } from './index'

/**
 * Dress the compiled section as a Canvas page, per Template 1 (General Content
 * Page) of the institution's Canvas design guide.
 *
 * WHY THIS IS A COMPILE STEP AND NOT AN EXPORT ONE. It runs before the audit, so
 * the banner's white-on-brand text, the heading colours and the rules are all
 * held to WCAG AA by the same gate as the publisher's own content. That is the
 * point: `{{Color_1}}` sits behind white text and the guide says so explicitly —
 * "a mid-tone brand color that looks fine in a logo will often fail there" — and
 * the honest way to enforce that is to let the contrast checker see it rather
 * than to trust the hex.
 *
 * INLINE STYLES ARE THE TEMPLATE'S OWN MECHANISM, not a deviation. The style
 * guide's "DO NOT ADD CSS in the code" rules out stylesheets and `<style>`
 * blocks — which Canvas strips anyway — while every one of the eight templates
 * carries its styling on `style` attributes. Every property used here is on the
 * Canvas HTML allowlist (`allowlist.ts`'s B.5 table: background, border,
 * border-radius, color, padding, margin, text-align), so none of it is stripped
 * on the way out.
 *
 * THE DOCUMENT WRAPPER IS NOT ADDED HERE. The guide also forbids `<!DOCTYPE>`
 * and `<html>` in page code; the cartridge adds those because a cartridge
 * resource must be a document, and Canvas discards them on import — measured, a
 * 38,655-byte file became a 38,143-byte page body. So the page in Canvas ends up
 * exactly as the guide requires.
 */

/** Primary. Behind white text, so it carries the 4.5:1 obligation. ~7.5:1. */
const COLOR_1 = '#1f4e79'
/** Secondary. Rules and left borders only — never behind text. */
const COLOR_2 = '#2e75b6'

const BANNER_STYLE =
  `background-color: ${COLOR_1}; color: white; border-radius: 5px; padding: 16px;`
const H3_STYLE = `color: ${COLOR_1}; border-bottom: 2px solid ${COLOR_2}; padding-bottom: 5px;`
const H4_STYLE = `color: ${COLOR_1};`
const FOOTER_STYLE =
  `background-color: ${COLOR_1}; color: white; padding: 5px; margin-top: 5px; ` +
  `border-radius: 5px; text-align: center;`

function ensureStrongHeading(heading: Element): void {
  if (heading.querySelector('strong')) return
  const strong = heading.ownerDocument.createElement('strong')
  while (heading.firstChild) strong.appendChild(heading.firstChild)
  heading.appendChild(strong)
}

function ensureH4GuideMarkup(heading: Element): void {
  const existing = heading.querySelector(':scope > span > strong')
  if (existing) return

  let strong = heading.querySelector(':scope > strong')
  if (!strong) {
    strong = heading.ownerDocument.createElement('strong')
    while (heading.firstChild) strong.appendChild(heading.firstChild)
  }
  const span = heading.ownerDocument.createElement('span')
  span.setAttribute('style', `color: ${COLOR_1};`)
  span.appendChild(strong)
  heading.appendChild(span)
}

export const applyCanvasTemplate: Step = (doc, ctx, sink) => {
  const body = doc.body
  // Idempotent, like `appendAttribution`: an answer rebuilds a section from its
  // source, and a second pass must not nest one template inside another.
  if (body.querySelector('.b2c-canvas-template')) return

  let banners = 0
  let headings = 0

  /*
   * The section's own title becomes the banner. `relevelHeadings` has already
   * guaranteed the document starts at h2 and that there is exactly one — the
   * guide forbids h1 and requires headers to start at h2, and doing that work
   * twice in two places is how the two answers drift apart.
   */
  let title = body.querySelector('h2')
  // A few publisher sections contain only a lead paragraph. Template 1 still
  // requires a page title/banner, so use the canonical section title supplied
  // by the source adapter when no heading survived import. Never invent a
  // heading when the adapter has no title (the isolated step tests exercise
  // that case).
  if (!title && ctx.sectionTitle?.trim()) {
    title = doc.createElement('h2')
    // Marked as the template's own, like the footer, so `ensureBlockIds` does
    // not mint an id for it on a recompile of compiled output.
    title.className = 'b2c-canvas-title'
    title.textContent = ctx.sectionTitle.trim()
    body.insertBefore(title, body.firstChild)
  }
  if (title) {
    title.classList.add('content-box', 'pad-box-large')
    title.setAttribute('style', `${title.getAttribute('style') ?? ''}${BANNER_STYLE}`)
    // `<strong>` per the template. Wrapping the existing children rather than
    // rewriting them keeps the publisher's own markup — os-number, os-divider —
    // intact inside the heading.
    const strong = doc.createElement('strong')
    while (title.firstChild) strong.appendChild(title.firstChild)
    title.appendChild(strong)
    banners += 1
  }

  for (const h of Array.from(body.querySelectorAll('h3'))) {
    h.setAttribute('style', `${h.getAttribute('style') ?? ''}${H3_STYLE}`)
    ensureStrongHeading(h)
    headings += 1
  }
  for (const h of Array.from(body.querySelectorAll('h4'))) {
    h.setAttribute('style', `${h.getAttribute('style') ?? ''}${H4_STYLE}`)
    ensureH4GuideMarkup(h)
    headings += 1
  }

  /*
   * The outer/inner containers, and the footer that closes the page.
   *
   * The template's per-h3 left-bordered content div is deliberately NOT applied.
   * It assumes an h3 followed by a flat run of siblings, which is true of
   * authored content and false of this: OpenStax nests its h3s inside
   * `div[data-type="abstract"]`, `div.visual-connection` and similar, so
   * "everything until the next h3" is not well defined at any single level.
   * Wrapping it mechanically would move content out of the containers the
   * publisher put it in, and this pipeline's whole discipline is that the audit
   * sees what gets published. The banner, the heading treatment and the footer
   * carry the template's identity without that risk.
   */
  const outer = doc.createElement('div')
  outer.className = 'b2c-canvas-template'
  outer.setAttribute('style', 'padding: 20px; border-radius: 5px;')

  // Template 1 has a second padded container and a content border wrapper. The
  // wrapper is intentionally around the post-title content as a whole rather
  // than around each h3: imported publishers nest h3s in semantic containers,
  // and splitting those containers would move content or change reading order.
  const inner = doc.createElement('div')
  inner.setAttribute('style', 'padding: 20px; border-radius: 5px;')
  while (body.firstChild) inner.appendChild(body.firstChild)
  const content = doc.createElement('div')
  content.className = 'border border-b'
  content.setAttribute(
    'style',
    'border-color: #ffffff; padding-left: 15px; padding-right: 15px;',
  )
  if (title && title.parentElement === inner) {
    for (const child of Array.from(inner.childNodes)) {
      if (child !== title) content.appendChild(child)
    }
    inner.appendChild(content)
  } else {
    while (inner.firstChild) content.appendChild(inner.firstChild)
    inner.appendChild(content)
  }
  outer.appendChild(inner)

  const footer = doc.createElement('div')
  footer.className = 'b2c-canvas-footer'
  footer.setAttribute('style', FOOTER_STYLE)
  const note = doc.createElement('p')
  note.setAttribute('style', 'text-align: right;')
  const em = doc.createElement('em')
  em.textContent = 'Click on the Next button below to continue.'
  note.appendChild(em)
  // The guide's arrow is decorative, so mark it aria-hidden. The iframe audit
  // excludes aria-hidden subtrees from axe (while its computed-contrast walker
  // still checks visible pixels), preventing axe's glyph-only incomplete result
  // from becoming a meaningless review row on every page.
  const arrow = doc.createElement('span')
  arrow.setAttribute('aria-hidden', 'true')
  arrow.textContent = '▼'
  note.append(' ', arrow)
  footer.appendChild(note)
  inner.appendChild(footer)

  body.appendChild(outer)

  sink.note(
    'canvasTemplate',
    'Applied the Canvas page template: title banner, heading rules, and footer.',
    banners + headings,
  )
}
