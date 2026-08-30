import {
  MAX_PROPOSED_PAGES,
  blocksOf,
  confirmImport,
  mergeWithNext,
  movePage,
  pageHtml,
  proposePagePlan,
  renamePage,
  setPageIncluded,
  splitPage,
  splitPoints,
  validatePagePlan,
} from './page-plan'
import type { ImportResult, ImportedWork } from './types'

function work(html: string, overrides: Partial<ImportedWork> = {}): ImportedWork {
  return {
    id: 'document-abc123',
    title: 'Cell biology',
    format: 'markdown',
    sections: [{ id: 'document-abc123-page-1', title: 'Cell biology', order: 0, html }],
    assets: [],
    provenance: { kind: 'paste', rights: { authority: 'own', acknowledged: true } },
    ...overrides,
  }
}

function result(html: string): ImportResult {
  const imported = work(html)
  return {
    work: imported,
    report: {
      parser: 'native',
      format: 'markdown',
      findings: [{ code: 'x', severity: 'warning', message: 'm', sectionId: imported.sections[0]!.id }],
      counts: { sections: 1, headings: 0, tables: 0, images: 0, equations: 0, notes: 0, unavailableAssets: 0, packagedAssetBytes: 0 },
    },
  }
}

const STRUCTURED =
  '<h1>Cell biology</h1>' +
  '<h2>Membranes</h2><p>Lipid bilayer.</p><h3>Transport</h3><p>Osmosis.</p>' +
  '<h2>Nucleus</h2><p>Stores DNA.</p>' +
  '<h2>Mitochondria</h2><p>Energy.</p>'

test('pages split at the highest repeated heading level and a lone title is not a split', () => {
  const { plan, splitHeadingLevel } = proposePagePlan(work(STRUCTURED))

  expect(splitHeadingLevel).toBe(2)
  expect(plan.pages.map((page) => page.title)).toEqual(['Membranes', 'Nucleus', 'Mitochondria'])
  expect(plan.pages.every((page) => page.included)).toBe(true)
  expect(pageHtml(plan, plan.pages[0]!)).toBe(
    '<h1>Cell biology</h1><h2>Membranes</h2><p>Lipid bilayer.</p><h3>Transport</h3><p>Osmosis.</p>',
  )
  expect(pageHtml(plan, plan.pages[1]!)).toBe('<h2>Nucleus</h2><p>Stores DNA.</p>')
})

test('preamble body text before the first split heading becomes a page named for the document', () => {
  const { plan } = proposePagePlan(work('<p>Overview.</p><h2>One</h2><p>a</p><h2>Two</h2><p>b</p>'))

  expect(plan.pages.map((page) => page.title)).toEqual(['Cell biology', 'One', 'Two'])
  expect(pageHtml(plan, plan.pages[0]!)).toBe('<p>Overview.</p>')
})

test('content without a repeated heading level stays one page with a split point at every block', () => {
  const { plan, splitHeadingLevel } = proposePagePlan(
    work('<h2>Only heading</h2><p>First.</p><p>Second.</p>Loose text'),
  )

  expect(splitHeadingLevel).toBeUndefined()
  expect(plan.pages).toHaveLength(1)
  expect(plan.pages[0]!.title).toBe('Cell biology')
  expect(pageHtml(plan, plan.pages[0]!)).toBe('<h2>Only heading</h2><p>First.</p><p>Second.</p>Loose text')
  expect(splitPoints(plan, plan.pages[0]!).map((point) => point.offset)).toEqual([1, 2, 3])
  expect(splitPoints(plan, plan.pages[0]!)[0]!.label).toMatch(/First\./)
})

test('repeated heading titles are numbered so proposed pages never collide by name', () => {
  const { plan } = proposePagePlan(work('<h2>Exercises</h2><p>a</p><h2>Exercises</h2><p>b</p>'))

  expect(plan.pages.map((page) => page.title)).toEqual(['Exercises', 'Exercises (2)'])
})

test('page identity derives from the source identity and structural position, not array order', () => {
  const first = proposePagePlan(work(STRUCTURED)).plan
  const second = proposePagePlan(work(STRUCTURED)).plan
  expect(second.pages.map((page) => page.id)).toEqual(first.pages.map((page) => page.id))
  expect(first.pages.map((page) => page.id)).toEqual([
    'document-abc123-page-1',
    'document-abc123-page-6',
    'document-abc123-page-8',
  ])

  const nucleus = first.pages[1]!
  const edited = movePage(
    setPageIncluded(renamePage(first, nucleus.id, 'The nucleus'), first.pages[0]!.id, false),
    first.pages[2]!.id,
    'up',
  )
  expect(edited.pages.map((page) => page.id)).toEqual([
    'document-abc123-page-1',
    'document-abc123-page-8',
    'document-abc123-page-6',
  ])
  expect(edited.pages[2]).toMatchObject({ id: nucleus.id, title: 'The nucleus' })
  expect(edited.pages[0]!.included).toBe(false)
})

test('a page that starts as one section keeps the importer section identity', () => {
  const { plan } = proposePagePlan(work('<p>Only one.</p>'))
  expect(plan.pages[0]!.id).toBe('document-abc123-page-1')
})

test('splitting keeps the original identity and names the new page from its first heading', () => {
  const { plan } = proposePagePlan(work(STRUCTURED))
  const membranes = plan.pages[0]!

  const split = splitPage(plan, membranes.id, 3)
  expect(split.pages.map((page) => page.title)).toEqual([
    'Membranes', 'Transport', 'Nucleus', 'Mitochondria',
  ])
  expect(split.pages[0]!.id).toBe(membranes.id)
  expect(split.pages[1]!.id).toBe('document-abc123-page-4')
  expect(pageHtml(split, split.pages[1]!)).toBe('<h3>Transport</h3><p>Osmosis.</p>')

  const noHeading = splitPage(plan, membranes.id, 4)
  expect(noHeading.pages[1]!.title).toBe('Membranes (part 2)')
})

test('invalid splits are rejected explicitly', () => {
  const { plan } = proposePagePlan(work(STRUCTURED))
  const single = proposePagePlan(work('<p>Only one.</p>')).plan

  expect(() => splitPage(plan, plan.pages[0]!.id, 0)).toThrow(/split/i)
  expect(() => splitPage(plan, plan.pages[0]!.id, 6)).toThrow(/split/i)
  expect(() => splitPage(single, single.pages[0]!.id, 1)).toThrow(/split/i)
  expect(() => splitPage(plan, 'missing', 1)).toThrow(/page/i)
  expect(splitPoints(single, single.pages[0]!)).toEqual([])
})

test('merging joins the next page into this one and keeps this identity', () => {
  const { plan } = proposePagePlan(work(STRUCTURED))
  const merged = mergeWithNext(plan, plan.pages[1]!.id)

  expect(merged.pages.map((page) => page.title)).toEqual(['Membranes', 'Nucleus'])
  expect(merged.pages[1]!.id).toBe(plan.pages[1]!.id)
  expect(pageHtml(merged, merged.pages[1]!)).toBe(
    '<h2>Nucleus</h2><p>Stores DNA.</p><h2>Mitochondria</h2><p>Energy.</p>',
  )
  expect(() => mergeWithNext(merged, merged.pages[1]!.id)).toThrow(/last page/i)
})

test('moving a page reorders it and is a no-op at either edge', () => {
  const { plan } = proposePagePlan(work(STRUCTURED))
  const down = movePage(plan, plan.pages[0]!.id, 'down')
  expect(down.pages.map((page) => page.title)).toEqual(['Nucleus', 'Membranes', 'Mitochondria'])
  expect(movePage(plan, plan.pages[0]!.id, 'up')).toBe(plan)
  expect(movePage(plan, plan.pages[2]!.id, 'down')).toBe(plan)
})

test('an automatic split beyond the page budget falls back to one page with a visible warning', () => {
  const html = Array.from({ length: MAX_PROPOSED_PAGES + 1 }, (_, i) => `<h2>Part ${i}</h2><p>x</p>`).join('')
  const { plan, findings } = proposePagePlan(work(html))

  expect(plan.pages).toHaveLength(1)
  expect(findings).toEqual([
    expect.objectContaining({ code: 'page-plan-budget', severity: 'warning' }),
  ])
  expect(findings[0]!.message).toContain(String(MAX_PROPOSED_PAGES))
})

test('manual splits cannot exceed the page budget', () => {
  const html = Array.from({ length: MAX_PROPOSED_PAGES + 1 }, (_, i) => `<p>${i}</p>`).join('')
  let { plan } = proposePagePlan(work(html))
  for (let i = 1; i < MAX_PROPOSED_PAGES; i += 1) {
    plan = splitPage(plan, plan.pages.at(-1)!.id, 1)
  }
  expect(plan.pages).toHaveLength(MAX_PROPOSED_PAGES)
  expect(() => splitPage(plan, plan.pages.at(-1)!.id, 1)).toThrow(/budget|at most/i)
})

test('validation names empty plans, blank titles, and duplicate included titles', () => {
  const { plan } = proposePagePlan(work(STRUCTURED))
  expect(validatePagePlan(plan)).toEqual([])

  const empty = plan.pages.reduce((current, page) => setPageIncluded(current, page.id, false), plan)
  expect(validatePagePlan(empty)).toEqual([
    expect.objectContaining({ code: 'empty' }),
  ])

  const blank = renamePage(plan, plan.pages[0]!.id, '   ')
  expect(validatePagePlan(blank)).toEqual([
    expect.objectContaining({ code: 'blank-title', pageId: plan.pages[0]!.id }),
  ])

  const duplicate = renamePage(plan, plan.pages[2]!.id, 'nucleus ')
  expect(validatePagePlan(duplicate)).toEqual([
    expect.objectContaining({ code: 'duplicate-title', message: expect.stringContaining('Nucleus') }),
  ])
  // An excluded page cannot collide with anything that ships.
  expect(validatePagePlan(setPageIncluded(duplicate, plan.pages[2]!.id, false))).toEqual([])
})

test('a work with several importer sections proposes one page per section', () => {
  const { plan } = proposePagePlan(work('', {
    sections: [
      { id: 'a', title: 'First', order: 0, html: '<h2>x</h2><p>1</p>' },
      { id: 'b', title: 'Second', order: 1, html: '<h2>y</h2><p>2</p>' },
    ],
  }))
  expect(plan.pages.map((page) => page.title)).toEqual(['First', 'Second'])
  expect(pageHtml(plan, plan.pages[1]!)).toBe('<h2>y</h2><p>2</p>')
})

test('confirming sends only included pages, in plan order, with edited metadata', () => {
  const source = result(STRUCTURED)
  const { plan } = proposePagePlan(source.work)
  const edited = movePage(
    setPageIncluded(renamePage(plan, plan.pages[1]!.id, 'The nucleus'), plan.pages[0]!.id, false),
    plan.pages[2]!.id,
    'up',
  )

  const confirmed = confirmImport(source, edited, {
    title: 'Cells, week 1',
    author: 'Ada Instructor',
    sourceUrl: 'https://example.edu/cells',
    rightsAuthority: 'permission',
    rightsAcknowledged: true,
  })

  expect(confirmed.work.title).toBe('Cells, week 1')
  expect(confirmed.work.id).toBe(source.work.id)
  expect(confirmed.work.provenance).toMatchObject({
    kind: 'paste',
    author: 'Ada Instructor',
    sourceUrl: 'https://example.edu/cells',
    rights: { authority: 'permission', acknowledged: true },
  })
  expect(confirmed.work.sections).toEqual([
    { id: 'document-abc123-page-8', title: 'Mitochondria', order: 0, html: '<h2>Mitochondria</h2><p>Energy.</p>' },
    { id: 'document-abc123-page-6', title: 'The nucleus', order: 1, html: '<h2>Nucleus</h2><p>Stores DNA.</p>' },
  ])
  expect(confirmed.report.counts.sections).toBe(2)
  expect(confirmed.report.findings).toEqual([{ code: 'x', severity: 'warning', message: 'm' }])
  // The source result is untouched, so the plan can be edited and confirmed again.
  expect(source.work.sections).toHaveLength(1)
})

test('confirming an invalid plan or metadata fails before anything is built', () => {
  const source = result(STRUCTURED)
  const { plan } = proposePagePlan(source.work)
  const metadata = { title: 'Cells', rightsAuthority: 'own' as const, rightsAcknowledged: true }
  const empty = plan.pages.reduce((current, page) => setPageIncluded(current, page.id, false), plan)

  expect(() => confirmImport(source, empty, metadata)).toThrow(/include at least one page/i)
  expect(() => confirmImport(source, plan, { ...metadata, title: ' ' })).toThrow(/title/i)
})

test('a block may declare its own plan label', () => {
  const blocks = blocksOf('<section data-plan-label="Slide 2: Photosynthesis"><h2>Photosynthesis</h2><p>Light</p></section>')

  expect(blocks).toHaveLength(1)
  expect(blocks[0]!.summary).toBe('Slide 2: Photosynthesis')
})

test('a deck of sections proposes one page, not one page per slide', () => {
  // Every slide title is an `h2`, so WITHOUT the section wrapper `proposeRanges`
  // would split at the minimum repeated heading level and propose one page per
  // slide. Wrapping makes each slide a single top-level block with no top-level
  // heading, which is the existing "no repeated heading" path.
  const html =
    '<section data-slide="1" data-plan-label="Slide 1: A"><h2>A</h2></section>' +
    '<section data-slide="2" data-plan-label="Slide 2: B"><h2>B</h2></section>'
  const { plan } = proposePagePlan(work(html, { format: 'pptx' }))

  expect(plan.pages).toHaveLength(1)
  expect(plan.blocks.map((block) => block.summary)).toEqual(['Slide 1: A', 'Slide 2: B'])
})
