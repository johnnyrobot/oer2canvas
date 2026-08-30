import { importStructuredDocument } from './document'
import { pptxFixture, odpFixture } from './testing/presentation-fixtures'

/**
 * Presentations through the REAL importer, driven by REAL anydoc in the real
 * Worker — like every other format's `*.browser.test.ts` in this module, and
 * for the same reason `presentation/reconcile.browser.test.ts` gives: a
 * hand-written HTML fixture can only restate what its author already
 * believed anydoc does, and four separate rounds of confident-but-wrong
 * reasoning about anydoc were only caught by measurement.
 */
const metadata = { title: 'Lecture', rightsAuthority: 'own' as const, rightsAcknowledged: true }

const deckFile = (bytes: Uint8Array<ArrayBuffer>, name = 'lecture.pptx') =>
  new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })

test('a deck imports as one page of slide sections', async () => {
  const bytes = await pptxFixture([
    { title: 'Photosynthesis', body: ['Light reactions', 'Calvin cycle'] },
    { title: 'Where it happens', table: true },
  ])
  const result = await importStructuredDocument(deckFile(bytes), { metadata })

  expect(result.work.sections).toHaveLength(1)
  expect(result.work.sections[0]!.html).toContain('<section data-slide="1"')
  expect(result.work.sections[0]!.html).toContain('<section data-slide="2"')
  expect(result.work.sections[0]!.html).toContain('<table')
})

test('speaker notes never reach the imported page', async () => {
  const bytes = await pptxFixture([
    { title: 'Photosynthesis', body: ['Light reactions'], notes: 'Do not read this to the class.' },
  ])
  const result = await importStructuredDocument(deckFile(bytes), { metadata })

  expect(result.work.sections[0]!.html).not.toContain('Do not read this')
  expect(result.report.findings).toContainEqual(expect.objectContaining({
    code: 'presentation-speaker-notes', sourcePage: 1,
  }))
})

test('a .ppsm slideshow imports through the same pptx capability', async () => {
  const bytes = await pptxFixture([{ title: 'Show deck' }], { container: 'ppsm', withMacroPart: true })
  const file = new File([bytes], 'lecture.ppsm', {
    type: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
  })
  const result = await importStructuredDocument(file, { metadata })

  expect(result.report.format).toBe('pptx')
  expect(result.work.sections[0]!.html).toContain('Show deck')
})

test('an odp deck imports as slide sections', async () => {
  const bytes = await odpFixture([{ title: 'Photosynthesis', body: ['Light reactions'] }])
  const file = new File([bytes], 'lecture.odp', {
    type: 'application/vnd.oasis.opendocument.presentation',
  })
  const result = await importStructuredDocument(file, { metadata })

  expect(result.work.sections[0]!.html).toContain('<section data-slide="1"')
})

test('an odp deck names an embedded chart on its own page', async () => {
  /*
   * Issue 14's ODP verdict, end to end through the real importer rather than
   * only through the reconciler. ODF gives a `draw:object` frame no
   * `draw:mime-type`, so the kind of an embedded chart lives only in
   * `META-INF/manifest.xml` — a part the Worker did not fetch until this
   * issue, which is exactly why an Impress chart used to vanish with no
   * finding. This asserts the whole chain: Worker part selection, manifest
   * parse, object classification, and the finding reaching `ImportResult`.
   */
  const bytes = await odpFixture([{ title: 'Process overview', embeddedObjects: [{ kind: 'chart' }] }])
  const file = new File([bytes], 'lecture.odp', {
    type: 'application/vnd.oasis.opendocument.presentation',
  })
  const result = await importStructuredDocument(file, { metadata })

  expect(result.report.findings).toContainEqual(expect.objectContaining({
    code: 'presentation-unrepresentable', sourcePage: 1, severity: 'warning',
  }))
})

test('an Impress chart names the chart AND blocks on its preview, both in one ImportResult', async () => {
  /*
   * THE FILE A USER ACTUALLY HAS, asserted where BOTH halves are visible.
   *
   * `reconcile.browser.test.ts` can only see the reconciler's own findings;
   * the unpackageable-image blocker is raised upstream by
   * `parsers/anydoc-html.ts` and only meets the reconciler's findings here, on
   * `ImportResult`. A test that named both halves and could structurally check
   * only one is the same defect as a guard that cannot go red, so the claim is
   * made in the one place that can carry it.
   *
   * Measured on LibreOffice's own `impress8` output: the `ObjectReplacements/`
   * preview beside an embedded object is a VCL GDI metafile
   * (`application/x-openoffice-gdimetafile`), which this importer cannot
   * package. So a real Impress deck with a chart does not import until the
   * object is removed or replaced — and it says WHY on both counts.
   */
  const bytes = await odpFixture([
    { title: 'Process overview', embeddedObjects: [{ kind: 'chart', replacement: 'gdi-metafile' }] },
  ])
  const file = new File([bytes], 'lecture.odp', {
    type: 'application/vnd.oasis.opendocument.presentation',
  })
  const result = await importStructuredDocument(file, { metadata })

  expect(result.report.findings).toContainEqual(expect.objectContaining({
    code: 'presentation-unrepresentable', severity: 'warning', sourcePage: 1,
    message: expect.stringContaining('1 chart'),
  }))
  expect(result.report.findings).toContainEqual(expect.objectContaining({
    code: 'embedded-content', severity: 'blocker',
  }))
})

test('a PPTX pasted chart blocks on its preview and never names the chart — the asymmetry, measured', async () => {
  /*
   * ODP IS BETTER THAN PPTX ON THIS CONSTRUCT, and that is worth a test rather
   * than an assumption, because the obvious reading of the two formats'
   * `limitations` is that they behave alike here.
   *
   * A chart pasted into PowerPoint is an OLE embedding
   * (`p:graphicFrame > p:oleObj` plus an EMF preview), NOT the
   * `graphicData` chart uri design fact 6 measured. `pptxIndex` counts the uri,
   * so a native PowerPoint chart IS named — but an OLE-embedded one is not:
   * the deck raises only the unpackageable-image blocker for its EMF preview,
   * and nothing anywhere says a chart was what the slide held.
   *
   * ODP has no such split. Every embedded object goes through the manifest, so
   * a chart is named whatever produced it.
   *
   * This is a LIMITATION and not a bar failure: criterion 2 requires design
   * fact 6's constructs to be named, and for PPTX they are. It is stated in
   * `capability.ts`'s pptx `limitations` and pinned here so it cannot quietly
   * become untrue in either direction.
   */
  const bytes = await pptxFixture([{ title: 'Process overview', oleObject: true }])
  const result = await importStructuredDocument(deckFile(bytes), { metadata })

  expect(result.report.findings.map((finding) => finding.code)).toEqual(['embedded-content'])
  expect(result.report.findings[0]!.severity).toBe('blocker')
  // The half that matters: no finding mentions a chart at all.
  for (const finding of result.report.findings) {
    expect(finding.message).not.toContain('chart')
  }
})

test('a deck reconcilePresentation blocks on is refused, not published with a misattributed guess', async () => {
  /*
   * `missingMediaImage` declares a relationship pointing at a media part the
   * package never writes — measured (`reconcile.browser.test.ts`, "a picture
   * anydoc cannot identify refuses rather than joining the open slide") to
   * raise `presentation-unattributed-content` at `severity: 'blocker'`.
   *
   * `reconcilePresentation` itself still returns HTML built on that
   * disagreement (its own comment: "nothing publishes on a blocker" — the
   * calling convention is the caller's job, not the reconciler's). Unlike a
   * DOCX footnote or an equation, where the unsupported content is ONE named
   * block and every other block on the page is still correctly placed, a
   * presentation blocker means the page's own claim about which slide held
   * what may be wrong from that point on — there is no safe partial page to
   * publish. So this importer refuses the whole file outright rather than
   * returning a result for `ImportPlanEditor`'s blocker gate to catch, the
   * way it does for a DOCX footnote or equation blocker.
   */
  const bytes = await pptxFixture([
    { title: 'One', body: ['Body one'], missingMediaImage: true },
    { title: 'Two', body: ['Body two'] },
  ])
  await expect(importStructuredDocument(deckFile(bytes), { metadata }))
    .rejects.toThrow(/do not agree/)
})
