import { importWebArticle } from './web'
import { FIXTURE_URL, fixtureFetcher } from './testing/firecrawl-fixture'
import { createImportDraft } from '../components/ImportPlanEditor'
import { confirmImport } from './page-plan'
import { toChapter } from './to-chapter'
import { compileAndAuditChapter } from '../engine'
import { DOCUMENT } from '../engine/compile/context'
import { buildCartridge } from '../engine/export/cartridge'
import { messageOf } from '../errors'

const metadata = {
  title: 'Photosynthesis',
  author: 'Wikipedia contributors',
  sourceUrl: '',
  rightsAuthority: 'permission' as const,
  rightsAcknowledged: true,
}

test('every refused image leaves both a blocker and a visible placeholder', async () => {
  const result = await importWebArticle(FIXTURE_URL, { metadata, fetcher: fixtureFetcher('article') })
  const html = result.work.sections[0]!.html

  // Both halves, for every image. A finding with no placeholder loses WHERE the
  // gap is; a placeholder with no finding lets the page publish with holes.
  for (const alt of ['A leaf cross-section', 'The Calvin cycle']) {
    expect(html).toContain(`[Embedded image: ${alt}]`)
  }
  expect(result.report.findings).toContainEqual(
    expect.objectContaining({ code: 'import-image-unavailable', severity: 'blocker' }),
  )
  // Inherited from `markup.ts`, not reimplemented here.
  expect(result.report.counts.images).toBe(2)
  expect(result.report.counts.unavailableAssets).toBe(2)
})

test('a relative link resolves against the page that was actually extracted', async () => {
  const result = await importWebArticle(FIXTURE_URL, { metadata, fetcher: fixtureFetcher('article') })
  expect(result.work.sections[0]!.html)
    .toContain('href="https://en.wikipedia.org/wiki/Chlorophyll"')
})

test('the 404 that arrives inside a 200 never reaches the plan editor', async () => {
  /*
   * The envelope is HTTP 200 with `success: true` and a full markdown body.
   * Only `metadata.statusCode` reveals it, and this asserts the refusal happens
   * before an `ImportResult` exists at all — a publisher's "not found" screen
   * must never become an article.
   */
  const caught = await importWebArticle(FIXTURE_URL, { metadata, fetcher: fixtureFetcher('not-found') })
    .then(() => undefined, (error: unknown) => error)
  expect(caught).toBeDefined()
  expect(messageOf(caught)).toMatch(/404/)
})

test('the vendor’s own error text is never carried into a message', async () => {
  const caught = await importWebArticle(FIXTURE_URL, { metadata, fetcher: fixtureFetcher('forbidden') })
    .then(() => undefined, (error: unknown) => error)
  expect(messageOf(caught)).toMatch(/could not read this site/)
  // A vendor-controlled URL pointing at an enterprise sales form.
  expect(messageOf(caught)).not.toContain('typeform')
})

test('a fetched article exports the exact bytes the gate audited', async () => {
  const result = await importWebArticle(FIXTURE_URL, {
    metadata, fetcher: fixtureFetcher('article-no-images'),
  })
  const draft = createImportDraft(result)
  const confirmed = confirmImport(result, draft.plan, {
    ...metadata,
    sourceUrl: FIXTURE_URL,
  })
  const compiled = await compileAndAuditChapter(toChapter(confirmed.work), { profile: DOCUMENT })
  const entries = buildCartridge([compiled])

  /*
   * Criterion 6. Nothing rewrites `html` after `compileAndAuditChapter`, so the
   * bytes the accessibility gate audited are the bytes the cartridge ships. A
   * failure here means something did rewrite them — find it; do not relax this.
   */
  expect(compiled.sections.length).toBeGreaterThan(0)
  for (const section of compiled.sections) {
    const audited = section.gate?.html ?? ''
    expect(audited).not.toBe('')
    const entry = entries.find((candidate) =>
      new TextDecoder().decode(candidate.data).includes(audited))
    expect(entry, `no cartridge entry contains the audited bytes for "${section.title}"`).toBeDefined()
  }
})
