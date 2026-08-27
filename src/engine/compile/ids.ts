/**
 * The id a `QueueItem` will point at, guaranteed to resolve in the compiled html.
 *
 * Returns the element's own id when it has one — every OpenStax element does —
 * and otherwise mints one from its position AND SETS IT. Setting it is the point:
 * `QueueItem.elementId` that resolves to nothing is a question slice 5's UI
 * cannot show the user, so the id is written into the document rather than
 * merely computed. Deterministic either way, which is what makes golden files
 * mean anything: the same input must produce the same bytes on every run.
 */
export function ensureId(el: Element, kind: string, index: number): string {
  const own = el.getAttribute('id')
  if (own) return own
  const id = `b2c-${kind}-${index}`
  el.setAttribute('id', id)
  return id
}
