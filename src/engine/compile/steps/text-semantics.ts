/**
 * Normalize presentation-only text markup to the semantic forms used by the
 * Canvas content guide. The transform is intentionally narrow: it changes
 * `<b>`/`<i>` to `<strong>`/`<em>` and removes underlining from non-link text,
 * while preserving every child and attribute. Publisher wording is not
 * rewritten here; spelling and clarity edits require a human who knows the
 * subject and are outside a safe deterministic compile step.
 */
import type { Step } from './index'

function replaceTag(element: Element, tag: 'strong' | 'em' | 'span'): Element {
  const replacement = element.ownerDocument.createElement(tag)
  for (const attr of Array.from(element.attributes)) replacement.setAttribute(attr.name, attr.value)
  while (element.firstChild) replacement.appendChild(element.firstChild)
  element.replaceWith(replacement)
  return replacement
}

export const normalizeTextSemantics: Step = (doc, _ctx, sink) => {
  let emphasis = 0
  let underline = 0

  for (const element of Array.from(doc.body.querySelectorAll('b, i'))) {
    replaceTag(element, element.tagName.toLowerCase() === 'b' ? 'strong' : 'em')
    emphasis += 1
  }

  for (const element of Array.from(doc.body.querySelectorAll('u'))) {
    if (element.closest('a')) continue
    const span = replaceTag(element, 'span') as HTMLElement
    span.style.textDecoration = 'none'
    underline += 1
  }

  for (const element of Array.from(doc.body.querySelectorAll('[style]'))) {
    if (element.closest('a')) continue
    const style = (element as HTMLElement).style
    if (!/underline/i.test(style.textDecoration)) continue
    style.textDecoration = 'none'
    underline += 1
  }

  if (emphasis > 0) {
    sink.note('text-semantics', `Normalized ${emphasis} presentation emphasis element(s) to semantic markup`, emphasis)
  }
  if (underline > 0) {
    sink.note('text-semantics', `Removed ${underline} non-link underline(s) per Canvas content guidance`, underline)
  }
}
