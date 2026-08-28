import {
  EXPECTED_FIXTURES,
  EXPECTED_PAGE_IMAGES,
  EXPECTED_PAGE_KEYS,
  FIXTURE_MEDIA_TYPES,
  REQUIRED_DIMENSIONS,
  REQUIRED_MEDIA_TYPES,
  analyzeVariant,
  decideWinner,
  renderWorksheet,
} from './canvas-image-probe-evidence.mjs'
import { parseStoredImages, pageKeyFromCanvasUrl } from './canvas-image-probe-run.mjs'

/**
 * A variant whose every observation is the ideal Canvas behavior. Individual
 * tests mutate one field, so each assertion measures exactly one rule.
 */
function perfectPages(fileIdBase = 100) {
  return EXPECTED_PAGE_KEYS.map((key) => ({
    key,
    canvasUrl: key,
    title: key,
    storedHtml: `<p>${key}</p>`,
    storedImages: EXPECTED_PAGE_IMAGES[key].map((image) => ({
      src: `/courses/1/files/${fileIdBase + EXPECTED_FIXTURES.indexOf(image.filename)}/preview`,
      alt: image.alt,
      // The shared GIF deliberately resolves to one id from both pages.
      fileId: String(fileIdBase + EXPECTED_FIXTURES.indexOf(image.filename)),
    })),
    renderedImages: EXPECTED_PAGE_IMAGES[key].map((image) => ({
      currentSrc: `https://canvas.test/files/${image.filename}`,
      alt: image.alt,
      naturalWidth: 16,
      naturalHeight: 16,
      complete: true,
    })),
  }))
}

function perfectVariant(id = 'standalone-webcontent') {
  const pages = perfectPages()
  return {
    id,
    sha256: 'a'.repeat(64),
    import: { workflowState: 'completed', migrationIssues: [], warnings: [] },
    pages,
    files: EXPECTED_FIXTURES.map((name, index) => ({
      id: String(100 + index),
      displayName: name,
      folderPath: 'course files/web_resources/probe',
      contentType: FIXTURE_MEDIA_TYPES[name],
    })),
    sharedImage: { pageAFileId: '101', pageBFileId: '101' },
    duplicateBytes: { fileIds: ['105', '106'] },
    reimport: { pagesBefore: 4, pagesAfter: 4, filesBefore: 7, filesAfter: 7, allImagesRendered: true },
    shareCopy: {
      destinationCourseId: 42,
      workflowState: 'completed',
      pageCount: 4,
      pages: perfectPages(200),
      allImagesRendered: true,
      sharedResolvesToOneFile: true,
    },
    reexport: {
      workflowState: 'exported',
      sha256: 'b'.repeat(64),
      unzipOk: true,
      pageReferences: [{ entry: 'wiki_content/01.html', resolvesToPackagedFile: true }],
    },
    reexportImport: {
      courseId: 43,
      workflowState: 'completed',
      pageCount: 4,
      pages: perfectPages(300),
      allImagesRendered: true,
      altTextIntact: true,
    },
  }
}

const perfectRun = (ids = ['standalone-webcontent', 'webcontent-dependencies', 'page-owned-files', 'associatedcontent-dependencies']) => ({
  identity: { operator: 'test', canvasBaseUrl: 'https://canvas.test' },
  expectedVariantIds: ids,
  variants: ids.map((id) => perfectVariant(id)),
})

test('the fixture expectations come from the generator, not from a second hand-written list', () => {
  expect(EXPECTED_PAGE_KEYS).toEqual([
    '01-single-image',
    '02-shared-image-a',
    '03-shared-image-b',
    '04-raster-and-duplicates',
  ])
  expect(EXPECTED_FIXTURES).toHaveLength(7)
  expect(new Set(Object.values(FIXTURE_MEDIA_TYPES))).toEqual(new Set(REQUIRED_MEDIA_TYPES))
})

test('an ideal variant passes every required dimension and every media type', () => {
  const analysis = analyzeVariant(perfectVariant())
  expect(analysis.failedDimensions).toEqual([])
  expect(analysis.unmeasuredDimensions).toEqual([])
  expect(analysis.failedMedia).toEqual([])
  expect(analysis.qualifies).toBe(true)
})

test('an empty variant qualifies for nothing: absent evidence is "not run", never a pass', () => {
  const analysis = analyzeVariant({ id: 'empty' })
  expect(analysis.qualifies).toBe(false)
  expect(analysis.unmeasuredDimensions).toEqual(REQUIRED_DIMENSIONS)
  for (const type of REQUIRED_MEDIA_TYPES) expect(analysis.media[type].status).toBe('not run')
})

test('a completed migration carrying an error issue is a failure, not a warning', () => {
  const variant = perfectVariant()
  variant.import = {
    workflowState: 'completed',
    migrationIssues: [{ issue_type: 'error', description: 'could not import file' }],
  }
  const analysis = analyzeVariant(variant)
  expect(analysis.dimensions.import.status).toBe('fail')
  expect(analysis.qualifies).toBe(false)
})

test('warnings are recorded without disqualifying the shape', () => {
  const variant = perfectVariant()
  variant.import = {
    workflowState: 'completed',
    migrationIssues: [{ issue_type: 'warning', description: 'unrecognised element' }],
  }
  const analysis = analyzeVariant(variant)
  expect(analysis.dimensions.import.status).toBe('pass')
  expect(analysis.dimensions.import.detail).toContain('unrecognised element')
  expect(analysis.qualifies).toBe(true)
})

test('an image that does not decode fails, even when Canvas stored a plausible src', () => {
  const variant = perfectVariant()
  variant.pages[0].renderedImages[0].naturalWidth = 0
  variant.pages[0].renderedImages[0].naturalHeight = 0
  const analysis = analyzeVariant(variant)
  expect(analysis.dimensions.rendered.status).toBe('fail')
  expect(analysis.dimensions.rendered.detail).toContain('did not decode')
  expect(analysis.qualifies).toBe(false)
})

test('silently rewritten alt text fails rather than being footnoted', () => {
  const variant = perfectVariant()
  variant.pages[0].renderedImages[0].alt = 'something Canvas invented'
  const analysis = analyzeVariant(variant)
  expect(analysis.dimensions.rendered.status).toBe('fail')
  expect(analysis.dimensions.rendered.detail).toContain('alt became')
})

test('a shared image that splits into two Canvas Files disqualifies the shape', () => {
  const variant = perfectVariant()
  variant.sharedImage = { pageAFileId: '101', pageBFileId: '999' }
  const analysis = analyzeVariant(variant)
  expect(analysis.dimensions.sharedImage.status).toBe('fail')
  expect(analysis.qualifies).toBe(false)
})

test('duplicate-byte handling is recorded in both directions and never disqualifies', () => {
  const distinct = analyzeVariant(perfectVariant())
  expect(distinct.dimensions.duplicateBytes.detail).toContain('remained distinct')
  expect(distinct.qualifies).toBe(true)

  const deduplicated = perfectVariant()
  deduplicated.duplicateBytes = { fileIds: ['105', '105'] }
  const analysis = analyzeVariant(deduplicated)
  expect(analysis.dimensions.duplicateBytes.detail).toContain('deduplicated')
  expect(analysis.qualifies).toBe(true)
  expect(REQUIRED_DIMENSIONS).not.toContain('duplicateBytes')
})

test('a reimport that duplicates pages fails', () => {
  const variant = perfectVariant()
  variant.reimport = { pagesBefore: 4, pagesAfter: 8, filesBefore: 7, filesAfter: 14, allImagesRendered: true }
  const analysis = analyzeVariant(variant)
  expect(analysis.dimensions.reimport.status).toBe('fail')
  expect(analysis.dimensions.reimport.detail).toContain('4 to 8')
})

test('a re-export whose references resolve to nothing fails', () => {
  const variant = perfectVariant()
  variant.reexport.pageReferences = [{ entry: 'wiki_content/01.html', resolvesToPackagedFile: false }]
  const analysis = analyzeVariant(variant)
  expect(analysis.dimensions.reexport.status).toBe('fail')
})

test('an archive that fails unzip -t fails, and one never checked is "not run"', () => {
  const broken = perfectVariant()
  broken.reexport.unzipOk = false
  expect(analyzeVariant(broken).dimensions.reexport.status).toBe('fail')

  const unchecked = perfectVariant()
  delete unchecked.reexport.unzipOk
  expect(analyzeVariant(unchecked).dimensions.reexport.status).toBe('not run')
})

test('media types are decided individually, so one bad raster cannot pass as raster support', () => {
  const variant = perfectVariant()
  const webpIndex = EXPECTED_PAGE_IMAGES['04-raster-and-duplicates'].findIndex(
    (image) => image.filename === 'raster.webp',
  )
  for (const pages of [variant.pages, variant.shareCopy.pages, variant.reexportImport.pages]) {
    const page = pages.find((candidate) => candidate.key === '04-raster-and-duplicates')
    page.renderedImages[webpIndex].naturalWidth = 0
    page.renderedImages[webpIndex].naturalHeight = 0
  }
  const analysis = analyzeVariant(variant)
  expect(analysis.media['image/webp'].status).toBe('fail')
  expect(analysis.media['image/png'].status).toBe('pass')
  expect(analysis.media['image/jpeg'].status).toBe('pass')
  expect(analysis.media['image/gif'].status).toBe('pass')
  expect(analysis.qualifies).toBe(false)
})

test('a run missing a variant is incomplete and cannot unblock production', () => {
  const run = perfectRun()
  run.variants = run.variants.slice(0, 3)
  const decision = decideWinner(run)
  expect(decision.missing).toEqual(['associatedcontent-dependencies'])
  expect(decision.complete).toBe(false)
  expect(decision.productionUnblocked).toBe(false)
})

test('with several qualifying shapes the winner is the earliest declared, deterministically', () => {
  const decision = decideWinner(perfectRun())
  expect(decision.qualifying).toHaveLength(4)
  expect(decision.winner.id).toBe('standalone-webcontent')
  expect(decision.productionUnblocked).toBe(true)
})

test('when no shape survives, the decision is an explicit block rather than a best guess', () => {
  const run = perfectRun()
  for (const variant of run.variants) variant.sharedImage = { pageAFileId: '1', pageBFileId: '2' }
  const decision = decideWinner(run)
  expect(decision.winner).toBeNull()
  expect(decision.productionUnblocked).toBe(false)
  expect(renderWorksheet(run, decision)).toContain('Production packaged-image work remains blocked')
})

test('the worksheet records every variant, every media type, and the gate', () => {
  const run = perfectRun()
  const markdown = renderWorksheet(run)
  for (const id of run.expectedVariantIds) expect(markdown).toContain(`\`${id}\``)
  for (const type of REQUIRED_MEDIA_TYPES) expect(markdown).toContain(type)
  expect(markdown).toContain('### Production-exporter gate')
  expect(markdown).toContain('WINNER'.toLowerCase() === '' ? '' : 'Winning probe ID: `standalone-webcontent`')
  // A single-instance run must state the missing comparison instead of implying it.
  expect(markdown).toContain('not available')
})

test('stored-HTML parsing recovers the src, alt, and Canvas file id that rewriting produces', () => {
  const parsed = parseStoredImages(
    '<figure><img src="/courses/7/files/512/preview" alt="Red square PNG — single image probe" width="16"/></figure>' +
      "<img src='/courses/7/files/513/download' alt='Orange square GIF'>",
  )
  expect(parsed).toEqual([
    { src: '/courses/7/files/512/preview', alt: 'Red square PNG — single image probe', fileId: '512' },
    { src: '/courses/7/files/513/download', alt: 'Orange square GIF', fileId: '513' },
  ])
})

test('page keys match between packaged filenames and Canvas page urls', () => {
  expect(pageKeyFromCanvasUrl('01-single-image')).toBe('01-single-image')
  expect(pageKeyFromCanvasUrl('wiki_content/01-single-image.html')).toBe('01-single-image')
  expect(EXPECTED_PAGE_KEYS).toContain(pageKeyFromCanvasUrl('/courses/1/pages/04-raster-and-duplicates'))
})

test('a `todo` migration issue is recorded rather than dropped for not being a warning', () => {
  const variant = perfectVariant()
  variant.import = {
    workflowState: 'completed',
    migrationIssues: [{ issue_type: 'todo', description: 'verify the imported module order' }],
  }
  const analysis = analyzeVariant(variant)
  // Canvas documents three severities; only `error` blocks, but all are evidence.
  expect(analysis.dimensions.import.status).toBe('pass')
  expect(analysis.dimensions.import.detail).toContain('todo: verify the imported module order')
  expect(analysis.qualifies).toBe(true)
})

test('an import that stores zero files fails rather than reading as unmeasured', () => {
  const variant = perfectVariant()
  variant.files = []
  variant.sharedImage = { pageAFileId: null, pageBFileId: null }
  variant.duplicateBytes = { fileIds: [] }
  const analysis = analyzeVariant(variant)
  // Canvas completing an import and attaching nothing is this probe's most
  // important negative result; "not run" would hide it behind an unchecked box.
  expect(analysis.dimensions.filesPlacement.status).toBe('fail')
  expect(analysis.dimensions.sharedImage.status).toBe('fail')
  expect(analysis.dimensions.duplicateBytes.status).toBe('fail')
  expect(analysis.unmeasuredDimensions).toEqual([])
  expect(analysis.qualifies).toBe(false)
})

test('genuinely absent file evidence is still "not run", not a fabricated failure', () => {
  const variant = perfectVariant()
  delete variant.files
  delete variant.sharedImage
  const analysis = analyzeVariant(variant)
  expect(analysis.dimensions.filesPlacement.status).toBe('not run')
  expect(analysis.dimensions.sharedImage.status).toBe('not run')
})

test('a winner is not described as the only shape when others also qualified', () => {
  const markdown = renderWorksheet(perfectRun())
  expect(markdown).toContain('recommended shape')
  expect(markdown).not.toContain('is the only shape production may implement')
  expect(markdown).toContain('does not mean the others failed')
})

test('a lone qualifying shape is described as the only one', () => {
  const run = perfectRun()
  for (const variant of run.variants.slice(1)) variant.files = []
  const markdown = renderWorksheet(run)
  expect(markdown).toContain('is the only shape that passed every required behavior')
})
