import { describe, it, expect } from 'vitest'
import { compileSection } from '../index'
import { fixTables } from './tables'
import { ctx, section } from '../test-support'

const PRESENTATION = `
<table id="Table_01_04_01" data-summary="A table with 3 rows" role="presentation"><tbody>
<tr><td></td><td>a</td></tr>
</tbody></table><div class="os-caption-container">
  <span class="os-title-label">Table </span><span class="os-number">1</span>
</div>`

const DATA = '<table id="T2"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'

const REFERENCED = `
<p>We can use a table to keep track of our work, as shown in Table 1.</p>
<table id="T3"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>`

// The real 1.4 Analysis paragraph: 291 characters, four sentences.
const PARAGRAPH_REFERENCED = `
<p>We can use a table to keep track of our work, as shown in Table 1. Write one polynomial
across the top and the other down the side. For each box in the table, multiply the term for
that row by the term for that column. Then add all of the terms together, combine like terms,
and simplify.</p>
<table id="T5"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>`

// The caption says something beyond its own label, deliberately: A9 keeps a
// label-only caption off the card, so "Table 1" alone would exercise that path
// rather than this one.
const REFERENCED_CAPTIONED = `
<p>We can use a table to keep track of our work, as shown in Table 1.</p>
<table id="T4"><tbody><tr><td>a</td></tr></tbody></table><div class="os-caption-container">
  <span class="os-title-label">Table </span><span class="os-number">1</span>
  <span class="os-caption">Products of the first and outer terms.</span>
</div>`

describe('fixTables', () => {
  it('honours role="presentation" and does not ask a human about it', () => {
    const out = compileSection(section(PRESENTATION), ctx, [fixTables])
    expect(out.queue).toEqual([])
    expect(out.notes.some((n) => /presentation/i.test(n.message))).toBe(true)
  })

  it('turns the sibling caption into a real <caption>, which IS allowlisted', () => {
    const out = compileSection(section(PRESENTATION), ctx, [fixTables])
    expect(out.html).toContain('<caption style="text-align: center;">Table 1</caption>')
    expect(out.html).not.toContain('os-caption-container')
  })

  it('puts the caption first, where the html spec requires it', () => {
    const out = compileSection(section(PRESENTATION), ctx, [fixTables])
    expect(out.html).toMatch(/<table[^>]*><caption(?:\s|>)/)
  })

  it('queues a headerless data table', () => {
    const out = compileSection(section(DATA), ctx, [fixTables])
    expect(out.queue).toEqual([
      { kind: 'table-headers', sectionId: 's1', elementId: 'T2', context: {} },
    ])
  })

  it('carries the referencing sentence as context, the way an image item does', () => {
    const out = compileSection(section(REFERENCED), ctx, [fixTables])
    expect(out.queue[0]!.context.reference).toBe(
      'We can use a table to keep track of our work, as shown in Table 1.',
    )
  })

  it('quotes only the opening sentence of a paragraph, and says it truncated', () => {
    const out = compileSection(section(PARAGRAPH_REFERENCED), ctx, [fixTables])
    expect(out.queue[0]!.context.reference).toBe(
      'We can use a table to keep track of our work, as shown in Table 1.\u2026',
    )
  })

  it('adds no ellipsis when the reference was already one sentence', () => {
    const out = compileSection(section(REFERENCED), ctx, [fixTables])
    expect(out.queue[0]!.context.reference).toBe(
      'We can use a table to keep track of our work, as shown in Table 1.',
    )
  })

  it('carries caption and reference together when both exist', () => {
    const out = compileSection(section(REFERENCED_CAPTIONED), ctx, [fixTables])
    expect(out.queue[0]!.context).toEqual({
      caption: 'Table 1 Products of the first and outer terms.',
      reference: 'We can use a table to keep track of our work, as shown in Table 1.',
    })
  })

  it('omits reference rather than emitting an empty one when no sentence precedes', () => {
    // The card has no "From the text:" line to draw in that case, and §3b of the
    // UX spec needs copy for it. An empty string would read as a found-but-blank
    // sentence, which is a different thing from "there is none".
    const out = compileSection(section(DATA), ctx, [fixTables])
    expect(out.queue[0]!.context).toEqual({})
  })

  it('leaves a table that already has headers alone', () => {
    const out = compileSection(
      section('<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>'),
      ctx,
      [fixTables],
    )
    expect(out.queue).toEqual([])
  })

  it('does not offer a label-only caption as context', () => {
    // Three of the 31 captions on real queued tables are "Table 5", "Table 6",
    // "Table 7". Printing "Caption: Table 5" on the card is the same noise line
    // that printing "No caption" would be, by the same argument (A9).
    const labelOnly =
      DATA +
      '<div class="os-caption-container"><span class="os-title-label">Table </span><span class="os-number">5</span></div>'
    const out = compileSection(section(labelOnly), ctx, [fixTables])
    expect(out.queue[0]!.context.caption).toBeUndefined()
    // The <caption> element still lands in the html — it is the publisher's
    // label and belongs in the render. Only the CARD is spared it.
    expect(out.html).toContain('<caption style="text-align: center;">Table 5</caption>')
  })

  it('still offers a caption that says something', () => {
    const described =
      DATA +
      '<div class="os-caption-container"><span class="os-title-label">Table </span><span class="os-number">5</span>\n<span class="os-caption">Values of the parametric equations.</span></div>'
    const out = compileSection(section(described), ctx, [fixTables])
    expect(out.queue[0]!.context.caption).toBe('Table 5 Values of the parametric equations.')
  })

  it('mints an id when the table has none, so the queue item resolves', () => {
    const out = compileSection(section('<table><tbody><tr><td>a</td></tr></tbody></table>'), ctx, [fixTables])
    expect(out.queue[0]!.elementId).toBe('b2c-table-0')
    expect(out.html).toContain('id="b2c-table-0"')
  })

  it('applies the Canvas table defaults and centers captions', () => {
    const out = compileSection(
      section(
        '<table><caption>Values</caption><tbody>' +
          '<tr><th scope="col">Name</th><th scope="col">Value</th></tr>' +
          '<tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr>' +
          '</tbody></table>',
      ),
      ctx,
      [fixTables],
    )
    expect(out.html).toContain('width="100%"')
    expect(out.html).toContain('border="1"')
    expect(out.html).toContain('<caption style="text-align: center;">Values</caption>')
    expect(out.html).toMatch(/<tr style="background-color: rgb\(242, 242, 242\);"><td[^>]*>B<\/td>/)
  })

  it('adds a caption when the source table has none', () => {
    const out = compileSection(section('<table><tbody><tr><td>A</td></tr></tbody></table>'), ctx, [fixTables])
    expect(out.html).toContain('<caption style="text-align: center;">Data table</caption>')
    expect(out.notes.some((note) => /caption\(s\) added/i.test(note.message))).toBe(true)
  })

  it('does not overwrite explicit table sizing or row colors', () => {
    const out = compileSection(
      section(
        '<table width="80%" border="0" style="border: 2px solid #000"><tbody>' +
          '<tr><td>A</td></tr><tr style="background: #fff"><td>B</td></tr>' +
          '</tbody></table>',
      ),
      ctx,
      [fixTables],
    )
    expect(out.html).toContain('width="80%"')
    expect(out.html).toContain('border="0"')
    expect(out.html).toContain('style="background: #fff"')
  })
})

const GRID = `
<p>Multiply each row by each column.</p>
<table id="T9"><tbody>
<tr><td></td><td>3x</td><td>-x</td></tr>
<tr><td>2x</td><td>6x</td><td>-2x</td></tr>
</tbody></table>`

// The real `10-7-parametric-equations-graphs` shape, in both editions of Algebra
// and Trigonometry: 3 rows x 8 columns declared, rows of differing length.
const RAGGED = `
<p>The parametric values are tabulated below.</p>
<table id="T10"><tbody>
<tr><td>t</td><td>0</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td></tr>
<tr><td>x</td><td>0</td><td>1</td></tr>
</tbody></table>`

// The real `33-3-introduction-to-the-urinary-system` shape: three columns in
// every row, but the header row spans two of them. Counting CELLS reports this
// as ragged (2 vs 3) when it is a regular grid, which is why width is measured
// in columns and the span check is separate from the uniformity check.
const SPANNING_HEADER = `
<p>The nephron's segments are summarised below.</p>
<table id="T11"><tbody>
<tr><td colspan="2">Segment and function</td><td>Location</td></tr>
<tr><td>Loop of Henle</td><td>Concentrates urine</td><td>Medulla</td></tr>
</tbody></table>`

// Same three columns, but the span is in the body and away from both bands.
const SPANNING_BODY = `
<p>The nephron's segments are summarised below.</p>
<table id="T12"><tbody>
<tr><td>Segment</td><td>Function</td><td>Location</td></tr>
<tr><td>Loop of Henle</td><td colspan="2">Concentrates urine, in the medulla</td></tr>
</tbody></table>`

// A rowspan makes the second row genuinely hold fewer cells than the table has
// columns, so every row-by-row measurement misreads it.
const SPANNING_ROWS = `
<p>Each diuretic and its route.</p>
<table id="T13"><tbody>
<tr><td>Furosemide</td><td rowspan="2">Loop diuretic</td><td>Oral</td></tr>
<tr><td>Bumetanide</td><td>IV</td></tr>
</tbody></table>`

const answerFor = (id: string, choice: 'row' | 'column' | 'both' | 'presentation') =>
  new Map([[`s1::${id}`, { type: 'table-headers', choice } as const]])
const ctxWith = (answers: ReturnType<typeof answerFor>) => ({ ...ctx, sectionId: 's1', answers })

describe('fixTables with answers', () => {
  it('first row becomes column headers', () => {
    const out = compileSection(section(GRID), ctxWith(answerFor('T9', 'row')), [fixTables])
    expect(out.html).toMatch(/<th[^>]*scope="col"[^>]*>3x<\/th>/)
    expect(out.html).not.toContain('<td>3x</td>')
    expect(out.queue).toEqual([])
  })

  it('first column becomes row headers', () => {
    const out = compileSection(section(GRID), ctxWith(answerFor('T9', 'column')), [fixTables])
    expect(out.html).toMatch(/<th[^>]*scope="row"[^>]*>2x<\/th>/)
  })

  it('both makes the corner cell a plain th with no scope', () => {
    // A corner cell labels neither its row nor its column; giving it a scope
    // would claim it does. Empty is the honest answer and screen readers
    // handle it.
    const out = compileSection(section(GRID), ctxWith(answerFor('T9', 'both')), [fixTables])
    expect(out.html).toMatch(/<tr><th[^>]*><\/th><th[^>]*scope="col"[^>]*>3x<\/th>/)
    expect(out.html).toMatch(/<th[^>]*scope="row"[^>]*>2x<\/th>/)
  })

  it('layout writes the role the publisher could have written', () => {
    const out = compileSection(section(GRID), ctxWith(answerFor('T9', 'presentation')), [fixTables])
    expect(out.html).toMatch(/<table[^>]*role="presentation"/)
    expect(out.html).not.toContain('<th')
    expect(out.queue).toEqual([])
  })

  it('keeps the promoted cell\'s own attributes and children', () => {
    const withId = GRID.replace('<td>3x</td>', '<td id="c1"><em>3x</em></td>')
    const out = compileSection(section(withId), ctxWith(answerFor('T9', 'row')), [fixTables])
    expect(out.html).toMatch(/<th id="c1"[^>]*scope="col"[^>]*><em>3x<\/em><\/th>/)
  })

  it('REFUSES a ragged shape, and keeps the item queued', () => {
    // A ragged table has no single first row to promote, and guessing produces a
    // header row that labels columns that do not exist. Dropping the item
    // instead would ship a headerless table gate-clean, which is the failure
    // this slice exists to prevent.
    const out = compileSection(section(RAGGED), ctxWith(answerFor('T10', 'row')), [fixTables])
    expect(out.queue.map((q) => q.elementId)).toEqual(['T10'])
    expect(out.html).not.toContain('<th')
    expect(out.notes.some((n) => /could not/i.test(n.message))).toBe(true)
  })

  it('REFUSES a span across the cells it would promote, and says which reason', () => {
    const out = compileSection(section(SPANNING_HEADER), ctxWith(answerFor('T11', 'row')), [
      fixTables,
    ])
    expect(out.queue.map((q) => q.elementId)).toEqual(['T11'])
    expect(out.notes.some((n) => /spans more than one column/i.test(n.message))).toBe(true)
  })

  it('does not call a spanned row ragged — width is columns, not cells', () => {
    // Every row here is three columns wide; only the cell COUNT differs. If
    // uniformity were measured in cells this would refuse for the wrong reason,
    // and the reason is what the instructor is eventually told.
    const out = compileSection(section(SPANNING_HEADER), ctxWith(answerFor('T11', 'row')), [
      fixTables,
    ])
    expect(out.notes.some((n) => /same width/i.test(n.message))).toBe(false)
  })

  it('promotes both bands when the span sits away from them', () => {
    // The cells being promoted are the first row and every row's first cell, and
    // none of them spans. Refusing here would send the instructor back to a card
    // with no better answer available to them.
    const out = compileSection(section(SPANNING_BODY), ctxWith(answerFor('T12', 'both')), [
      fixTables,
    ])
    expect(out.html).toMatch(/<th[^>]*scope="row"[^>]*>Loop of Henle<\/th>/)
    expect(out.html).toMatch(/<th[^>]*scope="col"[^>]*>Function<\/th>/)
    expect(out.queue).toEqual([])
  })

  it('REFUSES any rowspan, wherever it sits', () => {
    const out = compileSection(section(SPANNING_ROWS), ctxWith(answerFor('T13', 'column')), [
      fixTables,
    ])
    expect(out.queue.map((q) => q.elementId)).toEqual(['T13'])
    expect(out.notes.some((n) => /spans more than one row/i.test(n.message))).toBe(true)
  })

  it('a refused answer still marks the table layout when the human picks that instead', () => {
    // The way out of a refusal. If this did not work the item would be
    // unanswerable and the chapter permanently unpublishable.
    const out = compileSection(section(RAGGED), ctxWith(answerFor('T10', 'presentation')), [
      fixTables,
    ])
    expect(out.queue).toEqual([])
    expect(out.html).toMatch(/<table[^>]*role="presentation"/)
  })

  it('leaves an unanswered table queued exactly as before', () => {
    const out = compileSection(section(GRID), { ...ctx, sectionId: 's1' }, [fixTables])
    expect(out.queue.map((q) => q.elementId)).toEqual(['T9'])
    expect(out.html).not.toContain('<th')
  })
})
