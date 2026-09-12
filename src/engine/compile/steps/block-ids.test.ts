import { blockId, ensureBlockIds } from './block-ids'
import { createSink } from '../sink'
import { fixtureContext } from '../fixture-context'

const run = (html: string) => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const { ctx } = fixtureContext('page-section')
  const sink = createSink('s1')
  ensureBlockIds(doc, ctx, sink)
  return { doc, notes: sink.result().notes }
}

test('every outermost block gets a deterministic id; existing ids are kept', () => {
  const { doc } = run('<p>a</p><p id="own">b</p><ul><li>c<p>nested</p></li></ul>')
  const ids = Array.from(doc.body.querySelectorAll('p, li')).map((e) => e.id)
  const { ctx } = fixtureContext('page-section')
  expect(ids).toEqual([blockId(ctx.sectionId, 0), 'own', blockId(ctx.sectionId, 2), ''])
})

test('ids differ between sections, so two sections on one page cannot collide', () => {
  expect(blockId('s1', 0)).not.toBe(blockId('s2', 0))
  expect(blockId('s1', 0)).toMatch(/^b2c-blk-[0-9a-z]{1,7}-0$/)
})

test('the same input yields the same ids on a second run', () => {
  const html = '<p>a</p><h2>b</h2><p>c</p>'
  const a = run(html).doc.body.innerHTML
  const b = run(a).doc.body.innerHTML
  expect(b).toBe(a)
})

test('it records nothing in the notes: an id is not a fix', () => {
  expect(run('<p>a</p>').notes).toEqual([])
})
