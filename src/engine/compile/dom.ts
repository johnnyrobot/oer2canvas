/** Replace `el` with the same element under a different tag, keeping attrs and children. */
export function renameElement(el: Element, tag: string): Element {
  const next = el.ownerDocument.createElement(tag)
  for (const attr of Array.from(el.attributes)) next.setAttribute(attr.name, attr.value)
  while (el.firstChild) next.appendChild(el.firstChild)
  el.replaceWith(next)
  return next
}

/** Remove `el` but keep its children where it was. */
export function unwrap(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  el.remove()
}
