import { findMetadata, metadataInventory } from './metadata'

const html = `
<h2 id="h1">9.3 Lifespan Theories</h2>
<p id="b2c-blk-0">Sigmund Freud proposed stages. Sigmund Freud is cited again. Erik Erikson too, and Erik Erikson once more. Piaget once.</p>
<h3 id="h2">Key terms</h3>
<dl id="dl"><dt id="dt1">Ego</dt><dd id="dd1">The rational self.</dd><dt id="dt2">Id</dt><dd id="dd2">Drives.</dd></dl>
<p id="b2c-blk-1"><strong>Schema</strong> is a mental framework.</p>
<div class="os-key-takeaways" id="kt"><p id="b2c-blk-2">Freud and Erikson shaped the field.</p></div>
`

test('headings, glossary terms, defined terms, key blocks, and repeated proper nouns are inventoried', () => {
  const rows = metadataInventory('s1', html)
  expect(rows.filter((r) => r.kind === 'heading').map((r) => r.text)).toEqual(['9.3 Lifespan Theories', 'Key terms'])
  expect(rows.filter((r) => r.kind === 'glossary').map((r) => [r.text, r.detail])).toEqual([['Ego', 'The rational self.'], ['Id', 'Drives.']])
  expect(rows.filter((r) => r.kind === 'defined-term').map((r) => r.text)).toEqual(['Schema'])
  expect(rows.filter((r) => r.kind === 'key-block').map((r) => r.text)).toEqual(['Freud and Erikson shaped the field.'])
  const nouns = rows.filter((r) => r.kind === 'proper-noun').map((r) => [r.text, r.detail])
  expect(nouns).toEqual([['Sigmund Freud', '2'], ['Erik Erikson', '2']])
})

test('a heading row carries the element id so it can be outlined', () => {
  const h = metadataInventory('s1', html).find((r) => r.kind === 'heading')!
  expect(h.elementId).toBe('h1')
})

test('sentence-initial words are not proper nouns unless they repeat as capitalised mid-sentence', () => {
  const rows = metadataInventory('s1', '<p id="a">The cell divides. The cell grows. Then Golgi bodies act, and Golgi bodies rest.</p>')
  expect(rows.filter((r) => r.kind === 'proper-noun').map((r) => r.text)).toEqual(['Golgi'])
})

test('findMetadata yields observations, category 7.7, source inventory, keyed uniquely', () => {
  const f = findMetadata('s1', html)
  expect(f.every((x) => x.kind === 'observation' && x.category === '7.7' && x.rule?.source === 'inventory')).toBe(true)
  expect(new Set(f.map((x) => x.key)).size).toBe(f.length)
})
