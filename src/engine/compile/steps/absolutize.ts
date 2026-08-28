/**
 * Make every url absolute against the url the html was actually served from.
 *
 * This is the step that stops the audit being theater. OpenStax ships images as
 * `../resources/<sha1>`; unresolved they 404 in the audit frame, so the audited
 * layout is not the published layout. Verified live 2026-08-21 that
 * `new URL('../resources/<sha>', '<archive>/contents/<uuid>@<ver>:<page>.json')`
 * returns HTTP 200 image/jpeg.
 */
import type { Step } from './index'

/**
 * URL-bearing attributes, per element — allowlist.ts's B.4 table, minus
 * `source.srcset`: srcset is a multi-value, comma-separated syntax with width
 * and density descriptors this rewriter cannot parse, and mangling it
 * half-way would be worse than leaving it alone.
 */
const URL_ATTRS: Readonly<Record<string, readonly string[]>> = {
  a: ['href'], area: ['href'], blockquote: ['cite'], q: ['cite'],
  img: ['src'], iframe: ['src'], embed: ['src', 'pluginspage'], audio: ['src'],
  video: ['src', 'poster'], source: ['src'], track: ['src'], object: ['data', 'codebase', 'classid'],
}

/**
 * Attributes the browser FETCHES rather than navigates to. An https page blocks
 * an http subresource outright, so upgrading one can only help: at worst it
 * fails the same way it was already going to.
 */
const SUBRESOURCE = new Set(['src', 'poster', 'data'])

export const absolutize: Step = (doc, ctx, sink) => {
  if (!ctx.contentBaseUrl) return
  const base = new URL(ctx.contentBaseUrl)
  let rewritten = 0
  let upgraded = 0
  const failures: string[] = []

  for (const [tag, attrs] of Object.entries(URL_ATTRS)) {
    for (const el of Array.from(doc.body.querySelectorAll(tag))) {
      for (const attr of attrs) {
        const raw = el.getAttribute(attr)
        if (!raw || raw.startsWith('#')) continue
        // Intra-book links are the later link step's responsibility; it needs
        // the uuid still in the href.
        if (ctx.profile.xrefHref.test(raw)) continue
        try {
          const url = new URL(raw, base)
          if (url.protocol === 'http:' && (SUBRESOURCE.has(attr) || url.hostname === base.hostname)) {
            url.protocol = 'https:'
            upgraded += 1
          }
          if (url.href !== raw) {
            el.setAttribute(attr, url.href)
            rewritten += 1
          }
        } catch {
          // One malformed href must not cost a whole section. Leave it exactly
          // as the publisher wrote it and say so.
          failures.push(raw)
        }
      }
    }
  }

  if (rewritten > 0) sink.note('absolutize', `Resolved ${rewritten} relative url(s)`, rewritten)
  if (upgraded > 0) sink.note('absolutize', `Upgraded ${upgraded} url(s) from http to https`, upgraded)
  if (failures.length > 0) {
    sink.note(
      'absolutize',
      `${failures.length} url(s) could not be resolved and were left as-is: ${failures.join(', ')}`,
      failures.length,
    )
  }
}
