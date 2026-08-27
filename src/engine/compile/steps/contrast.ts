/**
 * Normalize publisher inline text colors before the final Canvas audit.
 *
 * A publisher may use CSS names such as `red` for a meaningful label. Canvas
 * keeps that inline style, but renders the text on a white page; pure red is
 * only 4:1 and therefore fails AA for normal text. The words still carry the
 * meaning when the color is normalized, so the safe repair is to choose a
 * high-contrast Canvas ink (or white on a dark inline background), not to drop
 * the text or silently accept a failing page.
 */
import { checkContrast, compositeLayers } from '../../contrast'
import type { Step } from './index'

const WHITE = '#ffffff'
const CANVAS_INK = '#2d3b45'

function styleOf(element: Element): CSSStyleDeclaration | undefined {
  return (element as Element & { style?: CSSStyleDeclaration }).style
}

/** Resolve the inline background stack; the Canvas shell supplies white below it. */
function backgroundFor(element: Element): string {
  const layers: string[] = []
  let current: Element | null = element
  while (current) {
    const background = styleOf(current)?.getPropertyValue('background-color').trim()
    if (background) layers.push(background)
    current = current.parentElement
  }
  layers.push(WHITE)
  try {
    return compositeLayers(layers)
  } catch {
    // Unknown CSS backgrounds are left for the audit's manual-review path. A
    // white fallback is conservative for choosing replacement foreground ink.
    return WHITE
  }
}

function safeForeground(background: string): string {
  try {
    const dark = checkContrast(CANVAS_INK, background).ratio
    const light = checkContrast(WHITE, background).ratio
    return dark >= light ? CANVAS_INK : WHITE
  } catch {
    return CANVAS_INK
  }
}

function passesAgainst(color: string, background: string): boolean {
  try {
    // Composite translucent foreground over the same background the browser
    // displays before measuring the resulting opaque colors.
    return checkContrast(compositeLayers([color, background]), background).passesAA
  } catch {
    // Unsupported values (var(), currentColor, gradients) are not rewritten;
    // the browser audit can still report them as unresolvable for review.
    return true
  }
}

export const normalizeContrast: Step = (doc, _ctx, sink) => {
  let changed = 0

  for (const element of Array.from(doc.body.querySelectorAll('*'))) {
    const background = backgroundFor(element)
    const style = styleOf(element)
    const inlineColor = style?.getPropertyValue('color').trim()
    if (style && inlineColor && !passesAgainst(inlineColor, background)) {
      style.setProperty('color', safeForeground(background), style.getPropertyPriority('color'))
      changed += 1
      continue
    }

    // `<font color="red">` is still present in a few older webbooks. It is
    // allowlisted by Canvas, so normalize it when no inline style already wins.
    const legacyColor = element.getAttribute('color')?.trim()
    if (legacyColor && !inlineColor && !passesAgainst(legacyColor, background)) {
      element.setAttribute('color', safeForeground(background))
      changed += 1
    }
  }

  if (changed > 0) {
    sink.note(
      'contrast',
      `${changed} low-contrast text color(s) normalized for Canvas contrast requirements`,
      changed,
    )
  }
}
