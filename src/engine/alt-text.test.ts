import { describe, expect, it } from 'vitest'
import {
  CANVAS_ALT_TEXT_MAX_LENGTH,
  altTextLength,
  fitCanvasAltText,
} from './alt-text'

describe('Canvas alt-text limits', () => {
  it('keeps short text intact', () => {
    expect(fitCanvasAltText('  A   short description.  ')).toBe('  A   short description.  ')
  })

  it('prefers a complete sentence when shortening', () => {
    const input = `${'A detailed description of the diagram. '.repeat(4)}A final sentence.`
    const fitted = fitCanvasAltText(input)
    expect(altTextLength(fitted)).toBeLessThanOrEqual(CANVAS_ALT_TEXT_MAX_LENGTH)
    expect(fitted.endsWith('.')).toBe(true)
  })

  it('backs up to a word boundary and adds an ellipsis when needed', () => {
    const fitted = fitCanvasAltText(
      'A diagram shows a long sequence of labeled steps that continues beyond the space available in Canvas with additional labels and explanatory details continuing around the figure.',
    )
    expect(altTextLength(fitted)).toBeLessThanOrEqual(CANVAS_ALT_TEXT_MAX_LENGTH)
    expect(fitted.endsWith('…')).toBe(true)
    expect(fitted).not.toMatch(/\s…$/)
  })

  it('does not split an astral Unicode character', () => {
    const fitted = fitCanvasAltText(`${'😀'.repeat(121)}`)
    expect(fitted.length).toBeLessThanOrEqual(CANVAS_ALT_TEXT_MAX_LENGTH)
    expect(fitted).toBe(`${'😀'.repeat(59)}…`)
  })
})
