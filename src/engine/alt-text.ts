/** Canvas's image editor rejects alt text longer than 120 characters. */
export const CANVAS_ALT_TEXT_MAX_LENGTH = 120

/**
 * Count the way an HTML maxlength field does: UTF-16 code units. This keeps
 * the compile-time check aligned with the browser control used by the queue.
 */
export function altTextLength(text: string): number {
  return text.length
}

/**
 * Fit a text alternative to Canvas's 120-character field without splitting a
 * Unicode character or leaving a word half-cut when a sensible boundary is
 * available. Text already within the limit is returned byte-for-byte so the
 * compiler does not rewrite a publisher's valid description unnecessarily.
 */
export function fitCanvasAltText(input: string): string {
  if (altTextLength(input) <= CANVAS_ALT_TEXT_MAX_LENGTH) return input

  const text = input.replace(/\s+/g, ' ').trim()
  if (altTextLength(text) <= CANVAS_ALT_TEXT_MAX_LENGTH) return text

  const chars = Array.from(text)
  const prefix = takeCodePoints(chars, CANVAS_ALT_TEXT_MAX_LENGTH)

  // Prefer a complete sentence when one fits. A tiny fragment such as "A." is
  // less useful than a little more context, so only use a boundary after the
  // first twenty characters.
  const sentenceEnds = [...prefix.matchAll(/[.!?](?=\s|$)/g)]
  const sentenceEnd = sentenceEnds.at(-1)?.index
  if (sentenceEnd !== undefined && sentenceEnd + 1 >= 20) {
    return prefix.slice(0, sentenceEnd + 1).trim()
  }

  // Leave room for an ellipsis, then back up to a word boundary. If the input
  // has no spaces at all, the code-point slice is still safe and deterministic.
  const cut = takeCodePoints(chars, CANVAS_ALT_TEXT_MAX_LENGTH - 1)
  const boundary = cut.lastIndexOf(' ')
  const body = (boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()
  return `${body}…`
}

/** Take whole Unicode characters without exceeding a UTF-16-unit budget. */
function takeCodePoints(chars: readonly string[], units: number): string {
  let used = 0
  let end = 0
  while (end < chars.length && used + chars[end]!.length <= units) {
    used += chars[end]!.length
    end += 1
  }
  return chars.slice(0, end).join('')
}
