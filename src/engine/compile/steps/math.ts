/**
 * Math first — and for OpenStax, math first means RESTRAINT.
 *
 * The parent spec puts this step first because a Pressbooks chapter can carry 80
 * QuickLaTeX PNGs: if math ran after alt resolution, all 80 would enter the human
 * queue as images needing alt text and the queue would be abandoned. That is the
 * difference between a 12-item queue and a 92-item one.
 *
 * OpenStax ships real MathML — 132 `<math>` elements in the 1.4 fixture, with
 * content-MathML `annotation-xml` alongside the presentation form, every tag of
 * which is on Canvas's allowlist. So the correct action here is to leave it
 * alone and say how much of it there was.
 *
 * OpenStax is NOT purely MathML, and this step is honest about the gap rather
 * than papering over it: the four equation pictures in the 1.4 fixture carry no
 * LaTeX in their alt, no MathML, and no data attribute — there is nothing to
 * recover. They fall through to `resolveAlt` and become queue items.
 *
 * Slice 8 plugs in here: the Pressbooks profile recovers the LaTeX encoded in
 * QuickLaTeX image alt text and Temml emits MathML before image review runs.
 */
import temml from 'temml'
import type { Step } from './index'

function recoverDelimitedMath(doc: Document): number {
  const textNodes: Text[] = []
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    if (!text.parentElement?.closest('math, pre, code, textarea, script, style')) textNodes.push(text)
  }

  let recovered = 0
  const delimiters = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g
  for (const text of textNodes) {
    const source = text.data
    let cursor = 0
    let changed = false
    const fragment = doc.createDocumentFragment()
    for (const match of source.matchAll(delimiters)) {
      const index = match.index
      if (index > cursor) fragment.append(source.slice(cursor, index))
      const latex = match[1] ?? match[2] ?? ''
      const display = match[2] !== undefined
      try {
        const template = doc.createElement('template')
        template.innerHTML = temml.renderToString(latex, { displayMode: display, throwOnError: true })
        const math = template.content.querySelector('math')
        if (!math) throw new Error('Temml did not emit MathML')
        fragment.append(math)
        recovered++
        changed = true
      } catch {
        fragment.append(match[0])
      }
      cursor = index + match[0].length
    }
    if (!changed) continue
    if (cursor < source.length) fragment.append(source.slice(cursor))
    text.replaceWith(fragment)
  }
  return recovered
}

export const recoverMath: Step = (doc, ctx, sink) => {
  let recovered = 0
  if (ctx.profile.mathFromImage) {
    for (const image of Array.from(doc.body.querySelectorAll('img'))) {
      const source = ctx.profile.mathFromImage(image)
      if (!source) continue
      try {
        const rendered = temml.renderToString(source.latex, { displayMode: source.display, throwOnError: true })
        const template = doc.createElement('template')
        template.innerHTML = rendered
        const math = template.content.querySelector('math')
        if (!math) continue
        image.replaceWith(math)
        recovered++
      } catch {
        // Unparseable publisher LaTeX stays an image and reaches the human
        // review queue; silently dropping the only representation is worse.
      }
    }
  }

  if (ctx.profile.mathFromText) {
    // A malformed expression remains its original TeX text; replacing the
    // only source with an error-colored approximation would overstate success.
    recovered += recoverDelimitedMath(doc)
  }

  const math = doc.body.querySelectorAll('math')
  if (math.length === 0) return
  // This note is also where the axe contrast suppression of Task 20 stays
  // VISIBLE. axe reports `color-contrast` incomplete on every MathML operator
  // glyph — 1446 of them in this one section — because it cannot judge an
  // element whose content is only non-text characters. Task 20 stops asking it
  // to. `run-contrast.ts` still measures those exact text nodes against real
  // computed colours, so nothing goes unchecked; this line is what says so.
  sink.note(
    'math',
    (recovered > 0
      ? `${math.length} equation(s) represented as real MathML (${recovered} recovered from publisher LaTeX). Contrast inside them is `
      : `${math.length} equation(s) already MathML; left as real math. Contrast inside them is `) +
      'measured by computed style rather than by axe, which cannot judge operator glyphs.',
    math.length,
  )
}
