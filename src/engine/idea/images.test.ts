import { findImages, imageInventory, imageSummary } from './images'

const html = `
<p id="b2c-blk-0">As Figure 1 shows, the nurse checks the chart.</p>
<div class="b2c-figure" id="b2c-fig-0">
  <img id="i1" src="a.png" alt="A nurse reading a patient chart" aria-describedby="b2c-cap-b2c-fig-0">
  <p class="b2c-caption" id="b2c-cap-b2c-fig-0">Figure 1 A nurse at work.</p>
</div>
<p id="b2c-blk-1">Molecules:</p>
<div class="b2c-figure" id="b2c-fig-1"><img src="b.png" alt="Ball-and-stick model of glucose"></div>
<p id="b2c-blk-2"><img src="c.png" alt="" role="presentation"></p>
<p id="b2c-blk-3"><img src="d.png"></p>
`

test('one row per image with alt, caption, reference, and people flag', () => {
  const rows = imageInventory('s1', html)
  expect(rows).toHaveLength(4)
  expect(rows[0]).toMatchObject({
    sectionId: 's1', elementId: 'i1', src: 'a.png', alt: 'A nurse reading a patient chart',
    caption: 'Figure 1 A nurse at work.', reference: 'As Figure 1 shows, the nurse checks the chart.',
    mentionsPeople: true, presentational: false,
  })
  expect(rows[1]).toMatchObject({ elementId: 'b2c-fig-1', alt: 'Ball-and-stick model of glucose', mentionsPeople: false })
  expect(rows[2]).toMatchObject({ elementId: 'b2c-blk-2', alt: '', presentational: true })
  expect(rows[3]).toMatchObject({ elementId: 'b2c-blk-3', alt: null, presentational: false })
})

test('people detection is a word-boundary noun list, not a guess', () => {
  const row = (alt: string) => imageInventory('s', `<p id="p"><img src="x" alt="${alt}"></p>`)[0]!
  expect(row('Two students at a bench').mentionsPeople).toBe(true)
  expect(row('A doctor').mentionsPeople).toBe(true)
  expect(row('The doctorate ceremony hall, empty').mentionsPeople).toBe(false)
  expect(row('Manganese ore').mentionsPeople).toBe(false)
  expect(row('A woman and her child').mentionsPeople).toBe(true)
})

test('the summary counts images, people, decoratives, and missing alt', () => {
  expect(imageSummary(imageInventory('s1', html))).toEqual({ images: 4, withPeople: 1, decorative: 1, noAlt: 1 })
})

test('findImages yields one observation per image plus a summary, category 7.1, source inventory', () => {
  const f = findImages('s1', html)
  expect(f).toHaveLength(5)
  expect(f.every((x) => x.kind === 'observation' && x.category === '7.1' && x.rule?.source === 'inventory')).toBe(true)
  const summary = f.find((x) => x.key === 's1::summary::7.1')!
  expect(summary.kind === 'observation' && summary.columns).toEqual({ images: '4', 'mention people': '1', decorative: '1', 'no alt text': '1' })
  const first = f[0]!
  expect(first.kind === 'observation' && first.columns).toEqual({
    image: 'a.png', description: 'A nurse reading a patient chart', caption: 'Figure 1 A nurse at work.',
    reference: 'As Figure 1 shows, the nurse checks the chart.', 'mentions people': 'yes',
  })
  expect(first.elementId).toBe('i1')
  expect(first.key).toBe('s1::i1::0::image')
})

test('a section with no images yields only a zero summary', () => {
  const f = findImages('s1', '<p id="a">text</p>')
  expect(f).toHaveLength(1)
  expect(f[0]!.kind === 'observation' && f[0]!.columns.images).toBe('0')
})
