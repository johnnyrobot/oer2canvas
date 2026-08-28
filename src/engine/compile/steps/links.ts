/**
 * Intra-book links become urls a human can open, tagged for slice 7.
 *
 * Chapter html links siblings as `./{bookUuid}@{ver}:{pageUuid}.xhtml#{fragment}`,
 * which resolves to a JSON endpoint. Rewriting to the public page url means every
 * link works the moment the page lands — including on the cartridge path in
 * slice 6, which has no Canvas urls to point at.
 *
 * `data-b2c-xref` carries the target uuid forward (data-* survives allowlist
 * repair) so slice 7 can re-point the subset it actually created in Canvas
 * without re-parsing slugs back into uuids.
 *
 * THE FRAGMENT IS NOT DECORATION. Every one of the 29 such links in the 1.4
 * fixture targets the same answer-key page and differs only in its
 * `#fs-id...-solution`; dropping it would collapse 29 distinct solution links
 * into 29 copies of one page.
 */
import type { Step } from './index'

const GENERIC_LINK_TEXT = /^(?:click here|here|read more|more info(?:rmation)?|learn more|this link|link|more)$/i
const RAW_URL_TEXT = /^(?:https?:\/\/|www\.)\S+$/i

/** Turn a URL/fragment into a short, visible link label when the source says only "here". */
function descriptiveLabel(anchor: HTMLAnchorElement, href: string, doc: Document): string | null {
  if (href.startsWith('#')) {
    const target = doc.getElementById(href.slice(1))
    const targetText = target?.textContent?.replace(/\s+/g, ' ').trim()
    if (targetText) return `Go to ${targetText.slice(0, 96)}`
  }

  if (/^mailto:/i.test(href)) {
    const address = href.slice(href.indexOf(':') + 1).split('?')[0]
    return address ? `Email ${address}` : null
  }

  try {
    const url = new URL(href, doc.baseURI)
    const segment = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')
      .replace(/\.(?:html?|pdf|php)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const subject = segment && !/^index$/i.test(segment) ? segment : url.hostname
    return subject ? `Read more about ${subject}` : null
  } catch {
    return null
  }
}

export const fixLinks: Step = (doc, ctx, sink) => {
  let resolved = 0
  const unresolved: string[] = []
  let descriptive = 0

  for (const anchor of Array.from(doc.body.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href') ?? ''
    const match = ctx.profile.xrefHref.exec(href)
    if (!match) continue

    const uuid = match[2]!
    const fragment = match[3] ?? ''
    const target = ctx.xrefs.get(uuid)

    if (target) {
      anchor.setAttribute('href', `${target}${fragment}`)
      resolved += 1
    } else {
      // Degrade to the book, never to a dead link. The reader still lands
      // somewhere true, and the note says which target could not be resolved.
      if (ctx.attribution.url) anchor.setAttribute('href', ctx.attribution.url)
      else anchor.removeAttribute('href')
      unresolved.push(uuid)
    }
    anchor.setAttribute('data-b2c-xref', uuid)
  }

  // The Canvas guide rejects visible labels such as "click here", "read more",
  // and raw URLs. Replacing only exact generic/URL labels keeps textbook prose
  // intact and uses the target heading/URL to produce a natural, specific label.
  // Existing labels that contain an image alt or other meaningful text are
  // untouched.
  for (const anchor of Array.from(doc.body.querySelectorAll('a[href]'))) {
    const text = anchor.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (!GENERIC_LINK_TEXT.test(text) && !RAW_URL_TEXT.test(text)) continue
    const label = descriptiveLabel(anchor as HTMLAnchorElement, anchor.getAttribute('href') ?? '', doc)
    if (!label) continue
    anchor.textContent = label
    descriptive += 1
  }

  if (resolved > 0) sink.note('links', `Resolved ${resolved} intra-book link(s)`, resolved)
  if (unresolved.length > 0) {
    sink.note(
      'links',
      `${unresolved.length} intra-book link(s) had no entry in the table of contents and now point at the book: ${[...new Set(unresolved)].join(', ')}`,
      unresolved.length,
    )
  }
  if (descriptive > 0) {
    sink.note('links', `Replaced ${descriptive} generic link label(s) with descriptive text`, descriptive)
  }
}
