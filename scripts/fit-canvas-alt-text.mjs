/** Keep benchmark/review candidates aligned with the Canvas 120-character fit. */
export const CANVAS_ALT_TEXT_MAX_LENGTH = 120

export function fitCanvasAltText(input) {
  if (input.length <= CANVAS_ALT_TEXT_MAX_LENGTH) return input

  const text = input.replace(/\s+/g, ' ').trim()
  if (text.length <= CANVAS_ALT_TEXT_MAX_LENGTH) return text

  const chars = Array.from(text)
  const prefix = takeCodePoints(chars, CANVAS_ALT_TEXT_MAX_LENGTH)
  const sentenceEnds = [...prefix.matchAll(/[.!?](?=\s|$)/g)]
  const sentenceEnd = sentenceEnds.at(-1)?.index
  if (sentenceEnd !== undefined && sentenceEnd + 1 >= 20) {
    return prefix.slice(0, sentenceEnd + 1).trim()
  }

  const cut = takeCodePoints(chars, CANVAS_ALT_TEXT_MAX_LENGTH - 1)
  const boundary = cut.lastIndexOf(' ')
  const body = (boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()
  return `${body}…`
}

function takeCodePoints(chars, units) {
  let used = 0
  let end = 0
  while (end < chars.length && used + chars[end].length <= units) {
    used += chars[end].length
    end += 1
  }
  return chars.slice(0, end).join('')
}
