import { describe, it, expect } from 'vitest'
import { compileSection, compileChapter } from './index'
import { LIBRETEXTS, OPENSTAX } from './context'
import { ctx, section } from './test-support'
import { blockId } from './steps/block-ids'
import type { Chapter, Section } from '../../sources/types'
import preface from '../../sources/fixtures/openstax/page.json'

describe('compileSection', () => {
  it('round-trips html through the parser', () => {
    const out = compileSection(section('<p id="a">hello</p>'), ctx)
    expect(out.html).toContain('hello')
    expect(out.error).toBeUndefined()
  })

  it('unwraps a whole document down to its body', () => {
    const out = compileSection(section('<html><head><title>t</title></head><body><p>b</p></body></html>'), ctx)
    expect(out.html).toContain(`<p id="${blockId(ctx.sectionId, 0)}">b</p>`)
    expect(out.html).not.toContain('<title>')
  })

  it('never executes a script in the source html', () => {
    // The parsed document is INERT. This is what keeps DOMParser inside the
    // safety story allowlist.ts documents.
    ;(globalThis as Record<string, unknown>).__b2c_pwned = undefined
    compileSection(section('<script>globalThis.__b2c_pwned = true</script><p>x</p>'), ctx)
    expect((globalThis as Record<string, unknown>).__b2c_pwned).toBeUndefined()
  })

  it('parses into a document with no window', () => {
    const doc = new DOMParser().parseFromString('<p>x</p>', 'text/html')
    expect(doc.defaultView).toBeNull()
  })

  it('makes no network request', () => {
    // Task 1's guard throws synchronously on the ambient fetch, so this passes
    // only because nothing in compile reaches for it.
    expect(() => compileSection(section('<img src="../r/x"><p>y</p>'), ctx)).not.toThrow()
  })

  it('repairs the LibreTexts filename and color pattern before the gate', () => {
    const out = compileSection(
      section(
        '<h1>Mixtures and Compounds</h1>' +
          '<p><span style="color:red">red dots</span></p>' +
          '<img src="https://bio.libretexts.org/image.png" alt="mixtures&compounds.png">',
      ),
      { ...ctx, profile: LIBRETEXTS },
    )
    const doc = new DOMParser().parseFromString(out.html, 'text/html')
    expect(out.queue).toHaveLength(1)
    expect(out.queue[0]!.kind).toBe('alt')
    expect(doc.querySelector('span')?.style.color).toBe('rgb(45, 59, 69)')
    expect(out.html).not.toMatch(/color:\s*red/i)
    expect(out.notes).toContainEqual(expect.objectContaining({ step: 'contrast', count: 1 }))
  })
})

describe('compileSection failure containment', () => {
  it('records the error and emits NO html when a step throws', () => {
    const boom = () => {
      throw new Error('step exploded')
    }
    const out = compileSection(section('<p>x</p>'), ctx, [boom])
    expect(out.error).toBe('step exploded')
    // Steps mutate one shared document in place, so a throw mid-step leaves a
    // half-transformed tree. Emitting it would ship unverified html.
    expect(out.html).toBe('')
    expect(out.queue).toEqual([])
  })
})

describe('compileSection idempotency', () => {
  it('compiling a compile output byte-matches the first compile (compile(compile(x)) === compile(x))', () => {
    // A trivial `<p>x</p>` round-trips even untrimmed and proves nothing. This
    // uses the real committed Preface fixture, whose publisher html has the
    // shape that actually breaks the invariant: whitespace ("\n    ") between
    // <body> and its first element. That text node survives into
    // doc.body.innerHTML on the first pass, but feeding that output back in as
    // a fragment lands the parser in "before head" insertion mode, which
    // discards leading whitespace — so an untrimmed compile would differ from
    // its own recompile with every step having found nothing to do.
    expect(preface.content).toMatch(/<body>\s*\n\s+<div/)

    const once = compileSection(section(preface.content), ctx)
    expect(once.error).toBeUndefined()

    const twice = compileSection(section(once.html), ctx)
    expect(twice.error).toBeUndefined()

    expect(twice.html).toBe(once.html)
  })
})

describe('compileChapter', () => {
  const chapter = (sections: Section[]): Chapter => ({
    source: 'openstax', bookId: 'b', title: 'Ch 1', sections, xrefs: new Map(),
    attribution: ctx.attribution,
  })

  it('compiles every section', () => {
    const out = compileChapter(chapter([section('<p>one</p>'), { ...section('<p>two</p>'), id: 's2' }]), OPENSTAX)
    expect(out.sections).toHaveLength(2)
    expect(out.sections[1]!.html).toContain('two')
  })

  it('merges section queues and dedupes by hash', () => {
    // Textbooks reuse images relentlessly; this is the single largest efficiency
    // lever in the compliance queue.
    const dup = '<img src="https://x/resources/' + 'a'.repeat(40) + '" alt="">'
    const out = compileChapter(
      chapter([section(dup), { ...section(dup), id: 's2' }]),
      OPENSTAX,
      {
        steps: [
          (doc, c, sink) =>
            sink.queue({
              kind: 'confirm-decorative',
              elementId: 'e',
              hash: 'a'.repeat(40),
              context: {},
            }),
        ],
      },
    )
    expect(out.queue).toHaveLength(1)
  })

  it('keeps every hashless item, because they cannot be proven identical', () => {
    const out = compileChapter(
      chapter([section('<p>a</p>'), { ...section('<p>b</p>'), id: 's2' }]),
      OPENSTAX,
      { steps: [(doc, c, sink) => sink.queue({ kind: 'table-headers', elementId: 'e', context: {} })] },
    )
    expect(out.queue).toHaveLength(2)
  })
})
