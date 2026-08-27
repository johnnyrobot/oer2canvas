import { describe, it, expect } from 'vitest'
import { compileSection } from '../index'
import { stripChrome } from './strip-chrome'
import { ctx, section } from '../test-support'

describe('stripChrome', () => {
  it('drops a script in the body', () => {
    const out = compileSection(section('<p>keep</p><script>x=1</script>'), ctx, [stripChrome])
    expect(out.html).not.toContain('script')
    expect(out.html).toContain('keep')
  })

  it('drops an inline style block', () => {
    // The <style> is placed AFTER body content starts so the parser keeps it
    // in the body rather than hoisting it to <head> -- otherwise this
    // assertion would pass even with stripChrome doing nothing, since only
    // doc.body.innerHTML is ever serialized.
    const out = compileSection(section('<p>keep</p><style>p{color:red}</style>'), ctx, [stripChrome])
    expect(out.html).not.toContain('color:red')
    expect(out.html).not.toContain('<style')
    expect(out.html).toContain('keep')
  })

  it('leaves head content out entirely, since only the body is serialized', () => {
    const out = compileSection(
      section('<html><head><style>:target{background:#ffc}</style></head><body><p>keep</p></body></html>'),
      ctx,
      [stripChrome],
    )
    expect(out.html.trim()).toBe('<p>keep</p>')
  })

  it('notes what it removed', () => {
    const out = compileSection(section('<script>a</script><script>b</script><p>x</p>'), ctx, [stripChrome])
    expect(out.notes).toEqual([{ step: 'strip-chrome', message: expect.stringContaining('2'), count: 2 }])
  })
})
