import { describe, it, expect } from 'vitest'
import { compileSection } from '../index'
import { absolutize } from './absolutize'
import { ctx, section } from '../test-support'

// ctx.contentBaseUrl is
// 'https://openstax.org/apps/archive/x/contents/b@v:p.json'
describe('absolutize', () => {
  it('resolves a relative image against the url the html was served from', () => {
    const out = compileSection(section('<img src="../resources/abc">'), ctx, [absolutize])
    expect(out.html).toContain('src="https://openstax.org/apps/archive/x/resources/abc"')
  })

  it('leaves a fragment alone', () => {
    const out = compileSection(section('<a href="#fs-id1">x</a>'), ctx, [absolutize])
    expect(out.html).toContain('href="#fs-id1"')
  })

  it('leaves intra-book links for the links step', () => {
    const href = './13ac107a-f15f-49d2-97e8-60ab2e3b519c@ebc5beb:f92fd036-ead4-5380-895d-8f6f9fdbcef7.xhtml#s'
    const out = compileSection(section(`<a href="${href}">x</a>`), ctx, [absolutize])
    expect(out.html).toContain(href)
  })

  it('upgrades an http SUBRESOURCE on any host, because https pages block it outright', () => {
    const out = compileSection(section('<img src="http://cdn.example.com/a.png">'), ctx, [absolutize])
    expect(out.html).toContain('src="https://cdn.example.com/a.png"')
  })

  it('upgrades an http link on the publisher host', () => {
    const out = compileSection(section('<a href="http://openstax.org/l/addsubpoly">x</a>'), ctx, [absolutize])
    expect(out.html).toContain('href="https://openstax.org/l/addsubpoly"')
  })

  it('leaves a third-party http LINK alone, because we cannot know it serves https', () => {
    const out = compileSection(section('<a href="http://example.com/paper">x</a>'), ctx, [absolutize])
    expect(out.html).toContain('href="http://example.com/paper"')
  })

  it('leaves one malformed url alone and notes it, rather than failing the section', () => {
    const out = compileSection(section('<a href="http://[bad">x</a><p>survives</p>'), ctx, [absolutize])
    expect(out.error).toBeUndefined()
    expect(out.html).toContain('survives')
    expect(out.notes.some((n) => /could not be resolved/i.test(n.message))).toBe(true)
  })

  it('resolves object.codebase, which allowlist.ts treats as a URL attribute exactly like data', () => {
    const out = compileSection(section('<object data="../a.swf" codebase="../plugins/"></object>'), ctx, [absolutize])
    expect(out.html).toContain('codebase="https://openstax.org/apps/archive/x/plugins/"')
  })

  it('leaves a packaged cartridge reference exactly as written', () => {
    const out = compileSection(
      section('<p><img src="$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png" alt="A diagram"></p>'),
      ctx,
      [absolutize],
    )
    expect(out.html).toContain('src="$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png"')
    expect(out.html).not.toContain('openstax.org')
  })
})
