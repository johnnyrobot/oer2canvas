/**
 * Text-node helpers shared by the finders (which compute where a term is) and
 * the compile step (which changes it). One implementation, so an occurrence
 * index computed on the compiled html means the same thing at apply time.
 *
 * A MATCH LIVES INSIDE ONE TEXT NODE. "falling on <em>deaf</em> ears" is not
 * matched as an idiom, and an edit whose original spans an inline boundary is
 * not applied. Crossing boundaries would mean deciding which element the
 * replacement belongs to, and a wrong guess rewrites somebody's emphasis.
 */
export const BLOCK_SELECTOR =
  'p, li, dd, dt, td, th, h2, h3, h4, h5, h6, blockquote, figcaption, .b2c-caption'

/** Outermost blocks only: a <p> inside an <li> is part of the <li>'s text. */
export function blockElements(root: ParentNode): Element[] {
  const all = Array.from(root.querySelectorAll(BLOCK_SELECTOR))
  return all.filter((el) => !(el.parentElement?.closest(BLOCK_SELECTOR)))
}

const SKIP = new Set(['SCRIPT', 'STYLE'])

export function textNodesOf(el: Element): Text[] {
  const out: Text[] = []
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      (node.parentElement && SKIP.has(node.parentElement.tagName))
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  let n = walker.nextNode()
  while (n) {
    out.push(n as Text)
    n = walker.nextNode()
  }
  return out
}

export interface Occurrence {
  node: Text
  offset: number
}

/** The nth (0-based) occurrence of `original`, counted across the block's text nodes but never spanning two. */
export function findOccurrence(el: Element, original: string, n: number): Occurrence | undefined {
  if (original === '') return undefined
  let seen = 0
  for (const node of textNodesOf(el)) {
    let from = 0
    while (true) {
      const at = node.data.indexOf(original, from)
      if (at === -1) break
      if (seen === n) return { node, offset: at }
      seen += 1
      from = at + original.length
    }
  }
  return undefined
}

export function countOccurrences(text: string, original: string): number {
  if (original === '') return 0
  let count = 0
  let from = 0
  while (true) {
    const at = text.indexOf(original, from)
    if (at === -1) return count
    count += 1
    from = at + original.length
  }
}

/** "Suffers from" → "Has"; "CRAZY" → "WILD"; otherwise the replacement as written. */
export function preserveCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase() && /[A-Z]/.test(original)) {
    return replacement.toUpperCase()
  }
  const first = original.charAt(0)
  if (first !== first.toLowerCase() && first === first.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  }
  return replacement
}

export function replaceAt(occ: Occurrence, original: string, replacement: string): void {
  const { node, offset } = occ
  node.data = node.data.slice(0, offset) + replacement + node.data.slice(offset + original.length)
}

/**
 * The Framework's own rule: an outdated term inside a quotation is kept and
 * given context, not rewritten. A paragraph that carries a citation pattern is
 * treated as quoting too, because "as Smith (1911) wrote, the …" is a
 * quotation without the markup.
 */
const CITATION = /\(\d{4}[a-z]?\)|\bv\.\s|\bet al\.|\[\d+\]/
export function isQuotation(el: Element): boolean {
  if (el.closest('blockquote, q, cite')) return true
  return CITATION.test(el.textContent ?? '')
}
