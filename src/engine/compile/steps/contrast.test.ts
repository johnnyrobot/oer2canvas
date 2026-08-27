import { describe, expect, it } from 'vitest'
import { compileSection } from '../index'
import { normalizeContrast } from './contrast'
import { ctx, section } from '../test-support'

describe('normalizeContrast', () => {
  it('darkens low-contrast inline colors while keeping readable colors intact', () => {
    const out = compileSection(
      section('<p><span style="color:red">red dots</span> <span style="color:blue">blue disks</span></p>'),
      ctx,
      [normalizeContrast],
    )
    const doc = new DOMParser().parseFromString(out.html, 'text/html')
    expect(doc.querySelector('span')?.style.color).toBe('rgb(45, 59, 69)')
    expect(doc.querySelectorAll('span')[1]?.style.color).toBe('blue')
    expect(out.notes).toContainEqual({
      step: 'contrast',
      message: '1 low-contrast text color(s) normalized for Canvas contrast requirements',
      count: 1,
    })
  })

  it('chooses white ink when a low-contrast color sits on a dark inline background', () => {
    const out = compileSection(
      section('<p style="background-color:#1f4e79"><span style="color:#6384a6">label</span></p>'),
      ctx,
      [normalizeContrast],
    )
    const doc = new DOMParser().parseFromString(out.html, 'text/html')
    expect(doc.querySelector('span')?.style.color).toBe('rgb(255, 255, 255)')
  })

  it('normalizes legacy font colors that Canvas still permits', () => {
    const out = compileSection(section('<p><font color="red">legacy label</font></p>'), ctx, [normalizeContrast])
    const doc = new DOMParser().parseFromString(out.html, 'text/html')
    expect(doc.querySelector('font')?.getAttribute('color')).toBe('#2d3b45')
  })
})
