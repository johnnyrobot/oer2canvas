import { describe, it, expect } from 'vitest'
import { compileSection } from '../index'
import { restructureFigures } from './figures'
import { resolveAlt } from './alt'
import { ctx, section } from '../test-support'

const HASH = 'f30414a10cb5f0a0369b27a897885a5341b96a42'
const EQUATION = `<p id="p1">Find the product of the first terms.</p>
<span data-type="media" data-alt=""><img src="https://openstax.org/apps/archive/x/resources/${HASH}" alt="" width="487" height="52"></span>`

const INTERVENING = `<p id="p1">Find the product of the first terms.</p>
<div class="aside"></div>
<span data-type="media"><img src="https://x/a" alt=""></span>`

// The shape real OpenStax content has and our committed fixture does not: the
// container holds a LABEL, a NUMBER, a description and a credit as separate
// spans. Section 1.4 has only the label and number, which is why `proposed` was
// was never exercised by the original goldens.
const CAPTIONED_FIGURE = `
<figure id="fig-1"><img src="https://x/a.png"></figure>
<div class="os-caption-container">
  <span class="os-title-label">Figure </span><span class="os-number">3</span>
  <span class="os-caption">A phospholipid bilayer separating two aqueous compartments.</span>
  <span class="os-credit">Credit: modification of work by Mariana Ruiz Villarreal</span>
</div>`

describe('resolveAlt', () => {
  it('says nothing about an image with real alt text', () => {
    const out = compileSection(section('<img src="https://x/a" alt="A house with a triangular roof">'), ctx, [resolveAlt])
    expect(out.queue).toEqual([])
  })

  it('queues a filename alt as a description question instead of trusting it', () => {
    const out = compileSection(section('<img src="https://x/mixtures.png" alt="mixtures.png">'), ctx, [resolveAlt])
    expect(out.queue).toHaveLength(1)
    expect(out.queue[0]!.kind).toBe('alt')
  })

  it("shortens a publisher's overlong alt text to Canvas's limit", () => {
    const original =
      'Sketch of a house formed by a square and a triangle. The square has a doorway at the bottom center, and the dimensions are labeled with x and feet. '
    const out = compileSection(section(`<img src="https://x/a" alt="${original}">`), ctx, [resolveAlt])
    const image = new DOMParser().parseFromString(out.html, 'text/html').querySelector('img')!
    expect((image.getAttribute('alt') ?? '').length).toBeLessThanOrEqual(120)
    expect(image.getAttribute('alt')).not.toBe(original)
    expect(out.queue).toEqual([])
    expect(out.notes).toContainEqual({
      step: 'alt',
      message: "1 image alt text value(s) shortened to Canvas's 120-character limit",
      count: 1,
    })
  })

  it('queues alt="" as confirm-decorative, NOT as an audit failure', () => {
    // The publisher's empty data-alt is an unfilled CMS field, not an author's
    // decorative declaration. In the 1.4 fixture the claim is wrong 4 times out
    // of 4. alt-text.ts stays right that this is not an audit defect.
    const out = compileSection(section(EQUATION), ctx, [resolveAlt])
    expect(out.queue).toHaveLength(1)
    expect(out.queue[0]!.kind).toBe('confirm-decorative')
  })

  it('queues a missing alt as alt', () => {
    const out = compileSection(section('<img src="https://x/a">'), ctx, [resolveAlt])
    expect(out.queue[0]!.kind).toBe('alt')
  })

  it('queues alt="   " as confirm-decorative, not as alt', () => {
    // The entry guard trims before deciding blank vs. not, so a whitespace-only
    // alt reaches this point exactly like alt="" does — it must be classified
    // the same way, not fall through to the null branch meant for a missing alt.
    const out = compileSection(section('<img src="https://x/a" alt="   ">'), ctx, [resolveAlt])
    expect(out.queue[0]!.kind).toBe('confirm-decorative')
  })

  it('takes the dedupe hash straight out of the url, with no fetch', () => {
    const out = compileSection(section(EQUATION), ctx, [resolveAlt])
    expect(out.queue[0]!.hash).toBe(HASH)
  })

  it('carries the referencing sentence as context', () => {
    const out = compileSection(section(EQUATION), ctx, [resolveAlt])
    expect(out.queue[0]!.context.reference).toBe('Find the product of the first terms.')
  })

  it('scans back past an intervening element to find the nearest paragraph', () => {
    // The paragraph is not the immediate previous sibling of the image's
    // wrapper — an aside div sits between them. Checking only the first
    // previousElementSibling at each ancestor level would climb straight
    // past it and lose the reference.
    const out = compileSection(section(INTERVENING), ctx, [resolveAlt])
    expect(out.queue[0]!.context.reference).toBe('Find the product of the first terms.')
  })

  it('leaves an explicitly presentational image alone', () => {
    // role="presentation" is a deliberate ARIA statement; alt="" is a blank box.
    const out = compileSection(section('<img src="https://x/a" alt="" role="presentation">'), ctx, [resolveAlt])
    expect(out.queue).toEqual([])
    const hidden = compileSection(section('<div aria-hidden="true"><img src="https://x/a" alt=""></div>'), ctx, [resolveAlt])
    expect(hidden.queue).toEqual([])
  })

  it('proposes a descriptive caption as the draft alt', () => {
    const rich = `<figure id="F1"><img src="https://x/a" alt=""></figure><div class="os-caption-container">Figure 1 A house drawn as a square with a triangular roof.</div>`
    const out = compileSection(section(rich), ctx, [restructureFigures, resolveAlt])
    expect(out.queue[0]!.proposed).toContain('A house drawn as a square')
  })

  it('REFUSES a label-only caption as a draft', () => {
    const labelled = `<figure id="F1"><img src="https://x/a" alt=""></figure><div class="os-caption-container">Figure 1</div>`
    const out = compileSection(section(labelled), ctx, [restructureFigures, resolveAlt])
    expect(out.queue[0]!.context.caption).toBe('Figure 1')
    expect(out.queue[0]!.proposed).toBeUndefined()
  })

  it('proposes the caption description, without its label or its credit line', () => {
    const out = compileSection(section(CAPTIONED_FIGURE), ctx, [restructureFigures, resolveAlt])
    expect(out.queue[0]!.proposed).toBe(
      'A phospholipid bilayer separating two aqueous compartments.',
    )
  })

  it('still shows the whole caption on screen, label and all', () => {
    // The visible caption is unchanged: body text says "as
    // shown in Figure 3", and the credit is attribution we are obliged to keep.
    const out = compileSection(section(CAPTIONED_FIGURE), ctx, [restructureFigures, resolveAlt])
    expect(out.queue[0]!.context.caption).toBe(
      'Figure 3 A phospholipid bilayer separating two aqueous compartments. ' +
        'Credit: modification of work by Mariana Ruiz Villarreal',
    )
  })

  it('still proposes nothing for a label-only caption', () => {
    // D6a, already true. Regressing it would propose "Figure 1" as alt text,
    // which is worse than proposing nothing because it looks plausible enough
    // to rubber-stamp.
    const labelOnly = CAPTIONED_FIGURE.replace(
      /<span class="os-caption">.*?<\/span>/s,
      '',
    ).replace(/<span class="os-credit">.*?<\/span>/s, '')
    const out = compileSection(section(labelOnly), ctx, [restructureFigures, resolveAlt])
    expect(out.queue[0]!.proposed).toBeUndefined()
  })

  it('proposes nothing for a caption that is only a photo credit', () => {
    // Measured on chapter 1's intro image of the same book: a container with no
    // description at all. Proposing alt="Credit: Andreas Kambanls" would put a
    // plausible-looking draft naming a PERSON in front of a human, for a picture
    // they cannot see. Worse than the cosmetic prefix, and the same fix.
    const creditOnly = `
<figure id="fig-1"><img src="https://x/a.png"></figure>
<div class="os-caption-container">
  <span class="os-credit">Credit: Andreas Kambanls</span>
</div>`
    const out = compileSection(section(creditOnly), ctx, [restructureFigures, resolveAlt])
    expect(out.queue[0]!.proposed).toBeUndefined()
  })

  it('leaves no scratch attribute behind in the published html', () => {
    // The description crosses three steps as a data attribute on the image,
    // because restructureFigures is the last place the publisher's caption
    // structure still exists. resolveAlt is what clears it, and it must clear it
    // for every image it visits, not only the ones it queues.
    const out = compileSection(
      section(`${CAPTIONED_FIGURE}<img src="https://x/b.png" alt="A real description here">`),
      ctx,
      [restructureFigures, resolveAlt],
    )
    expect(out.html).not.toContain('data-b2c-caption-description')
  })

  it('mints an id and writes it into the html, so the queue item resolves', () => {
    const out = compileSection(section('<img src="https://x/a" alt="">'), ctx, [resolveAlt])
    expect(out.queue[0]!.elementId).toBe('b2c-img-0')
    expect(out.html).toContain('id="b2c-img-0"')
  })
})

const TWO_EQUATIONS = `
<p>Find the product of the first terms.</p>
<span data-type="media"><img src="https://x/aaa" alt="" id="i1"></span>
<p>Find the product of the outer terms.</p>
<span data-type="media"><img src="https://x/bbb" alt="" id="i2"></span>`

describe('resolveAlt with answers', () => {
  it('writes a decorative answer and stops asking', () => {
    const answers = new Map([['s1::i1', { type: 'decorative' } as const]])
    const out = compileSection(section(TWO_EQUATIONS), { ...ctx, sectionId: 's1', answers }, [
      resolveAlt,
    ])
    expect(out.queue.map((q) => q.elementId)).toEqual(['i2'])
    expect(out.notes.some((n) => /decorative/i.test(n.message))).toBe(true)
  })

  it('writes an alt answer into the attribute', () => {
    const answers = new Map([
      ['s1::i1', { type: 'alt', text: 'The first terms, multiplied.' } as const],
    ])
    const out = compileSection(section(TWO_EQUATIONS), { ...ctx, sectionId: 's1', answers }, [
      resolveAlt,
    ])
    expect(out.html).toContain('alt="The first terms, multiplied."')
    expect(out.queue.map((q) => q.elementId)).toEqual(['i2'])
  })

  it('replaces a filename alt after an alt answer is submitted', () => {
    const answers = new Map([
      ['s1::i1', { type: 'alt', text: 'Diagram of mixtures and compounds.' } as const],
    ])
    const source = '<img src="https://x/mixtures.png" alt="mixtures.png" id="i1">'
    const out = compileSection(section(source), { ...ctx, sectionId: 's1', answers }, [resolveAlt])
    expect(out.html).toContain('alt="Diagram of mixtures and compounds."')
    expect(out.queue).toEqual([])
  })

  it('fits a long answer before writing it into the attribute', () => {
    const text = 'A detailed description of the figure that keeps going with additional context. '.repeat(4)
    const answers = new Map([
      ['s1::i1', { type: 'alt', text } as const],
    ])
    const out = compileSection(section(TWO_EQUATIONS), { ...ctx, sectionId: 's1', answers }, [
      resolveAlt,
    ])
    const image = new DOMParser().parseFromString(out.html, 'text/html').getElementById('i1')!
    expect((image.getAttribute('alt') ?? '').length).toBeLessThanOrEqual(120)
    expect(out.queue.map((q) => q.elementId)).toEqual(['i2'])
  })

  it('clears every copy of the same image from one answer', () => {
    // The propagation D5.2 promises, and the only test that covers it. Both
    // images share a content hash, so both resolve to the same queue key.
    const twice = `
      <p>One.</p><span data-type="media"><img src="https://x/${HASH}" alt="" id="a"></span>
      <p>Two.</p><span data-type="media"><img src="https://x/${HASH}" alt="" id="b"></span>`
    const answers = new Map([[HASH, { type: 'decorative' } as const]])
    const out = compileSection(section(twice), { ...ctx, sectionId: 's1', answers }, [resolveAlt])
    expect(out.queue).toEqual([])
  })

  it('summarises answered images into one note per kind, not one per image', () => {
    // FixNote.count exists for this. A chapter with twelve confirmed decoratives
    // should say so once; twelve identical lines is a notes panel nobody reads.
    const answers = new Map([
      ['s1::i1', { type: 'decorative' } as const],
      ['s1::i2', { type: 'decorative' } as const],
    ])
    const out = compileSection(section(TWO_EQUATIONS), { ...ctx, sectionId: 's1', answers }, [
      resolveAlt,
    ])
    const decorative = out.notes.filter((n) => /decorative/i.test(n.message))
    expect(decorative).toHaveLength(1)
    expect(decorative[0]!.count).toBe(2)
  })

  it('leaves an unanswered image exactly as it was', () => {
    const out = compileSection(section(TWO_EQUATIONS), { ...ctx, sectionId: 's1' }, [resolveAlt])
    expect(out.queue).toHaveLength(2)
  })

  it('does not answer an image whose key belongs to another section', () => {
    // A table answer can never propagate across sections (D5.2), and neither can
    // a hashless image answer. The key carries the section for exactly this.
    const answers = new Map([['s2::i1', { type: 'decorative' } as const]])
    const out = compileSection(section(TWO_EQUATIONS), { ...ctx, sectionId: 's1', answers }, [
      resolveAlt,
    ])
    expect(out.queue).toHaveLength(2)
  })
})

describe('resolveAlt and alt the auditor flagged', () => {
  it("queues Word's automatic alt and hands it back as the current value", () => {
    const out = compileSection(
      section('<img src="https://x/a.png" alt="A screenshot of a computer">'),
      ctx,
      [resolveAlt],
    )
    expect(out.queue).toHaveLength(1)
    expect(out.queue[0]!.kind).toBe('alt')
    // Carried as `current`, never as `proposed`: the card labels the two
    // differently and only `proposed` suppresses the local model.
    expect(out.queue[0]!.current).toBe('A screenshot of a computer')
    expect(out.queue[0]!.proposed).toBeUndefined()
  })

  it('queues a redundant lead-in and a too-short alt, which used to be diagnosed and dropped', () => {
    const redundant = compileSection(
      section('<img src="https://x/a.png" alt="Image of a bar chart of enrollment">'),
      ctx,
      [resolveAlt],
    )
    expect(redundant.queue).toHaveLength(1)
    expect(redundant.queue[0]!.current).toBe('Image of a bar chart of enrollment')

    const short = compileSection(section('<img src="https://x/a.png" alt="Map">'), ctx, [resolveAlt])
    expect(short.queue).toHaveLength(1)
    expect(short.queue[0]!.current).toBe('Map')
  })

  it('never seeds the field with alt the auditor is certain conveys nothing', () => {
    // A filename is queued, but prefilling it would put junk one keystroke from
    // being saved — which is the defect this app exists to catch.
    const out = compileSection(
      section('<img src="https://x/mixtures.png" alt="mixtures.png">'),
      ctx,
      [resolveAlt],
    )
    expect(out.queue).toHaveLength(1)
    expect(out.queue[0]!.current).toBeUndefined()
  })

  it('says out loud when images were accepted on the publisher word', () => {
    const out = compileSection(
      section(
        '<img src="https://x/a.png" alt="A house with a triangular roof">' +
          '<img src="https://x/b.png" alt="A bar chart of enrollment by quarter">',
      ),
      ctx,
      [resolveAlt],
    )
    expect(out.queue).toEqual([])
    const note = out.notes.find((entry) => /already had alt text/.test(entry.message))
    expect(note?.count).toBe(2)
  })
})
