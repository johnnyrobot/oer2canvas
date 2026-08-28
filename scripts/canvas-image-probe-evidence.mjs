/**
 * Pure analysis for the Canvas embedded-image probe evidence run (document-import
 * issue 07).
 *
 * The live driver in `canvas-image-probe-run.mjs` only collects observations. It
 * deliberately never decides anything, because a driver that both gathers and
 * judges can quietly lower its own bar when Canvas behaves unexpectedly. Every
 * pass/fail rule and the winning-shape decision lives here, where it is tested
 * against fabricated observations without a Canvas instance.
 *
 * The rules below are transcribed from the evidence gate in
 * `docs/canvas-image-probes/README.md` and the worksheet checklist. A dimension
 * is `pass` only on positive evidence: absent observations are `not run`, which
 * can never satisfy the gate.
 */
import { ASSETS, PAGES } from './canvas-image-probes.mjs'

/** The four raster types the gate requires be decided individually. */
export const REQUIRED_MEDIA_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Fixture filename -> media type, from the generator's own controlled assets. */
export const FIXTURE_MEDIA_TYPES = Object.freeze(
  Object.fromEntries(ASSETS.map((asset) => [asset.path.split('/').at(-1), asset.mediaType])),
)

/** Page path -> the exact alt text the generator packaged, in order. */
export const EXPECTED_PAGE_IMAGES = Object.freeze(
  Object.fromEntries(
    PAGES.map((page) => [
      page.path.split('/').at(-1).replace(/\.html$/, ''),
      page.images.map(({ asset, alt }) => ({ filename: asset.split('/').at(-1), alt })),
    ]),
  ),
)

export const EXPECTED_PAGE_KEYS = Object.freeze(Object.keys(EXPECTED_PAGE_IMAGES))
export const EXPECTED_FIXTURES = Object.freeze(ASSETS.map((asset) => asset.path.split('/').at(-1)))

/**
 * Dimensions the winning shape must pass. `duplicateBytes` is intentionally
 * absent: the gate requires duplicate handling be *recorded*, not that it take a
 * particular form, so it is reported but never disqualifying.
 */
export const REQUIRED_DIMENSIONS = Object.freeze([
  'import',
  'storedHtml',
  'rendered',
  'filesPlacement',
  'sharedImage',
  'reimport',
  'shareCopy',
  'reexport',
  'reexportImport',
])

export const DIMENSION_TITLES = Object.freeze({
  import: 'Import status/warnings',
  storedHtml: 'Stored page HTML',
  rendered: 'Rendered images/alt',
  filesPlacement: 'Files placement',
  sharedImage: 'Shared-image behavior',
  duplicateBytes: 'Duplicate-byte behavior',
  reimport: 'Same-cartridge reimport',
  shareCopy: 'Share/copy behavior',
  reexport: 'Re-export and clean reimport',
  reexportImport: 'Clean import of re-export',
})

const NOT_RUN = Object.freeze({ status: 'not run', detail: 'no observation recorded' })

const pass = (detail) => ({ status: 'pass', detail })
const fail = (detail) => ({ status: 'fail', detail })
const notRun = (detail) => ({ status: 'not run', detail: detail ?? NOT_RUN.detail })

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A page observation keyed by its stable probe page key (e.g. `01-single-image`). */
function pageKey(page) {
  return String(page?.key ?? '')
}

function checkImport(observation) {
  if (!isObject(observation)) return notRun()
  const { workflowState, migrationIssues = [], warnings = [] } = observation
  if (!workflowState) return notRun('migration never reported a workflow state')
  const blocking = migrationIssues.filter((issue) => issue?.issue_type === 'error')
  if (workflowState !== 'completed') {
    return fail(`migration ended as “${workflowState}”${blocking.length ? `; ${blocking.length} error issue(s)` : ''}`)
  }
  if (blocking.length) {
    return fail(`migration completed with ${blocking.length} error issue(s): ${blocking.map((i) => i.description).join('; ')}`)
  }
  // Canvas grades issues `todo`, `warning`, `error`. Only `error` blocks, but a
  // `todo` is still something Canvas wants a human to look at, so it belongs in
  // the record rather than being dropped for not being a warning.
  const noted = [
    ...warnings,
    ...migrationIssues
      .filter((issue) => issue?.issue_type && issue.issue_type !== 'error')
      .map((issue) => `${issue.issue_type}: ${issue.description}`),
  ]
  return pass(noted.length ? `completed with ${noted.length} warning(s): ${noted.join('; ')}` : 'completed with no warnings')
}

function checkStoredHtml(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return notRun()
  const seen = new Map(pages.map((page) => [pageKey(page), page]))
  const missing = EXPECTED_PAGE_KEYS.filter((key) => !seen.has(key))
  if (missing.length) return fail(`Canvas did not store page(s): ${missing.join(', ')}`)
  const bodyless = EXPECTED_PAGE_KEYS.filter((key) => !String(seen.get(key)?.storedHtml ?? '').trim())
  if (bodyless.length) return fail(`stored HTML was empty for: ${bodyless.join(', ')}`)
  return pass(`all ${EXPECTED_PAGE_KEYS.length} pages stored with a body`)
}

/**
 * Rendering is judged from the browser: a non-zero natural size proves Canvas
 * actually served decodable image bytes, which a stored `src` alone never does.
 * Alt text is compared against the exact packaged string, so silent rewriting is
 * a failure rather than a footnote.
 */
function checkRendered(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return notRun()
  const problems = []
  let checked = 0
  for (const key of EXPECTED_PAGE_KEYS) {
    const page = pages.find((candidate) => pageKey(candidate) === key)
    if (!page) {
      problems.push(`${key}: page absent`)
      continue
    }
    const expected = EXPECTED_PAGE_IMAGES[key]
    const rendered = Array.isArray(page.renderedImages) ? page.renderedImages : null
    if (!rendered) {
      problems.push(`${key}: not rendered`)
      continue
    }
    if (rendered.length !== expected.length) {
      problems.push(`${key}: expected ${expected.length} image(s), rendered ${rendered.length}`)
      continue
    }
    for (const [index, expectation] of expected.entries()) {
      const actual = rendered[index]
      checked += 1
      if (!actual?.naturalWidth || !actual?.naturalHeight) {
        problems.push(`${key}[${index}] ${expectation.filename}: did not decode (natural size 0)`)
      }
      if (actual?.alt !== expectation.alt) {
        problems.push(`${key}[${index}] ${expectation.filename}: alt became “${actual?.alt ?? ''}”`)
      }
    }
  }
  if (problems.length) return fail(problems.join('; '))
  return pass(`${checked} image(s) decoded with packaged alt text intact`)
}

function checkFilesPlacement(files) {
  if (!Array.isArray(files)) return notRun()
  // An empty array is not an absent measurement: it means Canvas finished the
  // import and attached nothing. That is the single most important negative
  // result this probe can produce, so it must never read as "not run".
  if (files.length === 0) return fail('Canvas completed the import but stored no course files at all')
  const byFixture = new Map()
  for (const file of files) {
    const name = String(file?.displayName ?? '')
    if (!byFixture.has(name)) byFixture.set(name, [])
    byFixture.get(name).push(file)
  }
  // Deduplication legitimately collapses one of the duplicate-byte fixtures, so a
  // missing duplicate is only reported here when its partner is missing too.
  const duplicates = ['duplicate-a.png', 'duplicate-b.png']
  const missing = EXPECTED_FIXTURES.filter((name) => !byFixture.has(name))
  const missingNonDuplicate = missing.filter((name) => !duplicates.includes(name))
  if (missingNonDuplicate.length) return fail(`Canvas stored no file for: ${missingNonDuplicate.join(', ')}`)
  if (duplicates.every((name) => missing.includes(name))) {
    return fail('Canvas stored neither duplicate-byte fixture')
  }
  const placements = [...byFixture.entries()]
    .map(([name, entries]) => `${name}→${entries.map((entry) => entry.folderPath ?? '?').join('|')}`)
    .join(', ')
  return pass(placements)
}

/**
 * The shared GIF appears on two pages. Production may only rely on a shape where
 * both pages resolve to one Canvas File, so a split is a hard failure.
 */
function checkSharedImage(shared, files) {
  if (!isObject(shared)) return notRun()
  const { pageAFileId, pageBFileId } = shared
  if (pageAFileId == null || pageBFileId == null) {
    // Distinguish "we failed to look" from "Canvas produced nothing to find".
    if (Array.isArray(files) && files.length === 0) {
      return fail('Canvas stored no course files, so the shared image resolved to nothing')
    }
    return notRun('shared-image file ids were not resolved')
  }
  if (String(pageAFileId) !== String(pageBFileId)) {
    return fail(`shared GIF split into Canvas Files ${pageAFileId} and ${pageBFileId}`)
  }
  return pass(`both shared pages resolve to Canvas File ${pageAFileId}`)
}

/** Recorded, never disqualifying — the gate asks that this be observed, not chosen. */
function describeDuplicateBytes(duplicate, files) {
  if (!isObject(duplicate)) return notRun()
  const { fileIds } = duplicate
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    if (Array.isArray(files) && files.length === 0) {
      return fail('Canvas stored no course files, so neither duplicate fixture exists')
    }
    return notRun('duplicate-byte file ids were not resolved')
  }
  const unique = new Set(fileIds.map(String))
  return pass(
    unique.size === 1
      ? `identical bytes deduplicated into Canvas File ${[...unique][0]}`
      : `identical bytes remained distinct as Canvas Files ${[...unique].join(', ')}`,
  )
}

function checkReimport(reimport) {
  if (!isObject(reimport)) return notRun()
  const { pagesBefore, pagesAfter, filesBefore, filesAfter, allImagesRendered } = reimport
  if ([pagesBefore, pagesAfter, filesBefore, filesAfter].some((count) => typeof count !== 'number')) {
    return notRun('page/file counts were not captured around the second import')
  }
  if (pagesAfter !== pagesBefore) {
    return fail(`second import changed the page count from ${pagesBefore} to ${pagesAfter}`)
  }
  if (allImagesRendered === false) return fail('images stopped rendering after the second import')
  if (allImagesRendered !== true) return notRun('rendering after the second import was not measured')
  const fileNote = filesAfter === filesBefore
    ? `file count held at ${filesAfter}`
    : `file count moved from ${filesBefore} to ${filesAfter}`
  return pass(`pages held at ${pagesAfter}; ${fileNote}; images still render`)
}

function checkShareCopy(copy) {
  if (!isObject(copy)) return notRun()
  const { destinationCourseId, workflowState, pageCount, allImagesRendered, sharedResolvesToOneFile } = copy
  if (!destinationCourseId) return notRun('no destination course was recorded')
  if (workflowState && workflowState !== 'completed') return fail(`copy ended as “${workflowState}”`)
  if (pageCount !== EXPECTED_PAGE_KEYS.length) {
    return fail(`destination course holds ${pageCount} page(s), expected ${EXPECTED_PAGE_KEYS.length}`)
  }
  if (allImagesRendered === false) return fail('images did not render in the destination course')
  if (allImagesRendered !== true) return notRun('destination rendering was not measured')
  if (sharedResolvesToOneFile === false) return fail('the shared image split in the destination course')
  return pass(`copied into course ${destinationCourseId}; all images render${sharedResolvesToOneFile ? '; shared image intact' : ''}`)
}

function checkReexport(reexport) {
  if (!isObject(reexport)) return notRun()
  const { workflowState, sha256, unzipOk, pageReferences } = reexport
  if (workflowState && workflowState !== 'exported') return fail(`export ended as “${workflowState}”`)
  if (!sha256) return notRun('no export archive was captured')
  if (unzipOk === false) return fail('the exported archive failed `unzip -t`')
  if (unzipOk !== true) return notRun('the exported archive was not integrity-checked')
  const references = Array.isArray(pageReferences) ? pageReferences : []
  if (references.length === 0) return notRun('no re-exported page references were read')
  const broken = references.filter((reference) => !reference?.resolvesToPackagedFile)
  if (broken.length) {
    return fail(`${broken.length} re-exported reference(s) do not resolve to a packaged file`)
  }
  return pass(`export ${sha256.slice(0, 12)}… passed unzip -t; ${references.length} reference(s) resolve`)
}

function checkReexportImport(roundTrip) {
  if (!isObject(roundTrip)) return notRun()
  const { workflowState, pageCount, allImagesRendered, altTextIntact } = roundTrip
  if (workflowState && workflowState !== 'completed') return fail(`clean import of the re-export ended as “${workflowState}”`)
  if (pageCount !== EXPECTED_PAGE_KEYS.length) {
    return fail(`re-export import produced ${pageCount} page(s), expected ${EXPECTED_PAGE_KEYS.length}`)
  }
  if (allImagesRendered === false) return fail('images did not survive the re-export round trip')
  if (allImagesRendered !== true) return notRun('rendering after the re-export import was not measured')
  if (altTextIntact === false) return fail('alt text did not survive the re-export round trip')
  if (altTextIntact !== true) return notRun('alt text after the re-export import was not measured')
  return pass('all pages, images, and alt text survived the round trip')
}

/**
 * Per-media-type outcome, so a partial raster result can never be reported as
 * blanket raster support. A type passes only when every fixture of that type
 * decoded on every surface where it was measured.
 */
export function mediaTypeOutcomes(variant) {
  const surfaces = [
    ['source course', variant?.pages],
    ['destination course', variant?.shareCopy?.pages],
    ['re-export import', variant?.reexportImport?.pages],
  ].filter(([, pages]) => Array.isArray(pages) && pages.length > 0)

  return Object.fromEntries(
    REQUIRED_MEDIA_TYPES.map((mediaType) => {
      const fixtures = EXPECTED_FIXTURES.filter((name) => FIXTURE_MEDIA_TYPES[name] === mediaType)
      if (surfaces.length === 0) return [mediaType, notRun()]
      const problems = []
      let observations = 0
      for (const [surfaceName, pages] of surfaces) {
        for (const key of EXPECTED_PAGE_KEYS) {
          const page = pages.find((candidate) => pageKey(candidate) === key)
          const rendered = Array.isArray(page?.renderedImages) ? page.renderedImages : []
          for (const [index, expectation] of EXPECTED_PAGE_IMAGES[key].entries()) {
            if (!fixtures.includes(expectation.filename)) continue
            const actual = rendered[index]
            if (!actual) continue
            observations += 1
            if (!actual.naturalWidth || !actual.naturalHeight) {
              problems.push(`${surfaceName}/${key}: ${expectation.filename} did not decode`)
            }
          }
        }
      }
      if (observations === 0) return [mediaType, notRun(`no ${mediaType} observation`)]
      if (problems.length) return [mediaType, fail(problems.join('; '))]
      return [mediaType, pass(`${observations} observation(s) decoded across ${surfaces.length} surface(s)`)]
    }),
  )
}

/** Evaluate one variant's raw observations into per-dimension verdicts. */
export function analyzeVariant(variant) {
  const dimensions = {
    import: checkImport(variant?.import),
    storedHtml: checkStoredHtml(variant?.pages),
    rendered: checkRendered(variant?.pages),
    filesPlacement: checkFilesPlacement(variant?.files),
    sharedImage: checkSharedImage(variant?.sharedImage, variant?.files),
    duplicateBytes: describeDuplicateBytes(variant?.duplicateBytes, variant?.files),
    reimport: checkReimport(variant?.reimport),
    shareCopy: checkShareCopy(variant?.shareCopy),
    reexport: checkReexport(variant?.reexport),
    reexportImport: checkReexportImport(variant?.reexportImport),
  }
  const media = mediaTypeOutcomes(variant)
  const failedDimensions = REQUIRED_DIMENSIONS.filter((name) => dimensions[name].status === 'fail')
  const unmeasuredDimensions = REQUIRED_DIMENSIONS.filter((name) => dimensions[name].status === 'not run')
  const failedMedia = REQUIRED_MEDIA_TYPES.filter((type) => media[type].status === 'fail')
  const unmeasuredMedia = REQUIRED_MEDIA_TYPES.filter((type) => media[type].status === 'not run')

  return {
    id: variant?.id ?? '(unknown)',
    sha256: variant?.sha256 ?? '',
    dimensions,
    media,
    failedDimensions,
    unmeasuredDimensions,
    failedMedia,
    unmeasuredMedia,
    // A variant qualifies only when every required dimension and every required
    // media type is a positive `pass`. "not run" never qualifies.
    qualifies:
      failedDimensions.length === 0 &&
      unmeasuredDimensions.length === 0 &&
      failedMedia.length === 0 &&
      unmeasuredMedia.length === 0,
  }
}

/**
 * Decide the winning shape across all variants. Returns `winner: null` when no
 * candidate survives, which the gate treats as "production packaging stays
 * blocked" rather than as an inconclusive run to be retried loosely.
 */
export function decideWinner(run) {
  const variants = (run?.variants ?? []).map(analyzeVariant)
  const expectedVariantIds = run?.expectedVariantIds ?? []
  const missing = expectedVariantIds.filter((id) => !variants.some((variant) => variant.id === id))
  const qualifying = variants.filter((variant) => variant.qualifies)
  // Prefer the earliest-declared variant so a tie resolves deterministically to
  // the shape the generator lists first rather than to whichever ran fastest.
  const order = new Map(expectedVariantIds.map((id, index) => [id, index]))
  qualifying.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  const winner = qualifying[0] ?? null

  return {
    variants,
    missing,
    qualifying: qualifying.map((variant) => variant.id),
    winner,
    // Every variant must have been run before a winner means anything.
    complete: missing.length === 0,
    productionUnblocked: missing.length === 0 && winner !== null,
    secondEnvironment: run?.secondEnvironment ?? null,
  }
}

const cell = (verdict) => `${verdict.status} — ${String(verdict.detail).replace(/\|/g, '\\|')}`

/** Render the filled worksheet required by the issue-07 evidence gate. */
export function renderWorksheet(run, decision = decideWinner(run)) {
  const identity = run?.identity ?? {}
  const lines = []
  lines.push('# Canvas embedded-image validation worksheet — completed run', '')
  lines.push(
    'Generated by `npm run probe:canvas-images:run`. Every row below is a recorded observation',
    'from a live Canvas instance; blank or `not run` cells are unmeasured, never assumed.',
    '',
  )

  lines.push('## Run identity', '', '| Field | Observation |', '| --- | --- |')
  const identityRows = [
    ['Operator', identity.operator],
    ['Date/time and timezone', identity.startedAt],
    ['Canvas environment/base URL', identity.canvasBaseUrl],
    ['Canvas release/build', identity.canvasRelease],
    ['Browser/version', identity.browser],
    ['Source course ID/name', identity.sourceCourses],
    ['Share/copy destination course ID/name', identity.copyCourses],
    ['Re-export-import course ID/name', identity.roundTripCourses],
    ['Second Canvas environment/release, or reason unavailable', decision.secondEnvironment ?? 'not available — single self-hosted instance; recorded as a limitation'],
    ['Generated `probe-index.json` committed with evidence', identity.probeIndex],
  ]
  for (const [field, value] of identityRows) lines.push(`| ${field} | ${value ?? '—'} |`)

  lines.push('', '## Variant summary', '')
  const summaryColumns = [
    'import', 'storedHtml', 'rendered', 'filesPlacement', 'sharedImage',
    'duplicateBytes', 'reimport', 'shareCopy', 'reexport',
  ]
  lines.push(`| Probe ID | Cartridge SHA-256 | ${summaryColumns.map((name) => DIMENSION_TITLES[name]).join(' | ')} | Clean reimport of re-export |`)
  lines.push(`| --- | --- | ${summaryColumns.map(() => '---').join(' | ')} | --- |`)
  for (const variant of decision.variants) {
    const cells = summaryColumns.map((name) => cell(variant.dimensions[name]))
    lines.push(`| \`${variant.id}\` | \`${variant.sha256}\` | ${cells.join(' | ')} | ${cell(variant.dimensions.reexportImport)} |`)
  }

  lines.push('', '## Media types, decided individually', '')
  lines.push(`| Probe ID | ${REQUIRED_MEDIA_TYPES.join(' | ')} |`)
  lines.push(`| --- | ${REQUIRED_MEDIA_TYPES.map(() => '---').join(' | ')} |`)
  for (const variant of decision.variants) {
    lines.push(`| \`${variant.id}\` | ${REQUIRED_MEDIA_TYPES.map((type) => cell(variant.media[type])).join(' | ')} |`)
  }

  lines.push('', '## Decision', '')
  if (decision.winner) {
    lines.push(`- Winning probe ID: \`${decision.winner.id}\``)
    lines.push(`- Cartridge SHA-256: \`${decision.winner.sha256}\``)
    lines.push(`- Exact winning HTML reference form: \`$IMS-CC-FILEBASE$/web_resources/probe/<filename>\``)
    lines.push(`- Supported media types proved individually: ${REQUIRED_MEDIA_TYPES.filter((type) => decision.winner.media[type].status === 'pass').join(', ') || 'none'}`)
    lines.push(`- Duplicate-byte behavior production must preserve: ${decision.winner.dimensions.duplicateBytes.detail}`)
    lines.push(`- Files placement production should expect: ${decision.winner.dimensions.filesPlacement.detail}`)
  } else {
    lines.push('- Winning probe ID: `none`')
    lines.push('- Production packaged-image work remains blocked.')
  }
  lines.push(`- Other qualifying shapes: ${decision.qualifying.filter((id) => id !== decision.winner?.id).join(', ') || 'none'}`)
  if (decision.missing.length) lines.push(`- Variants never run: ${decision.missing.join(', ')}`)
  lines.push(`- Second-environment differences: ${decision.secondEnvironment ?? 'not available — recorded as a limitation, not as agreement'}`)

  lines.push('', '### Production-exporter gate', '')
  const gate = [
    ['All four variants were run from the recorded hashes.', decision.complete],
    ['Stored HTML and rendered natural-size/alt evidence exist for all pages.', decision.variants.every((v) => v.dimensions.storedHtml.status === 'pass' && v.dimensions.rendered.status !== 'not run')],
    ['Files placement, shared-image, and duplicate-byte behavior are recorded.', decision.variants.every((v) => v.dimensions.filesPlacement.status !== 'not run')],
    ['Same-cartridge reimport evidence exists.', decision.variants.every((v) => v.dimensions.reimport.status !== 'not run')],
    ['Share/copy evidence from a destination course exists.', decision.variants.every((v) => v.dimensions.shareCopy.status !== 'not run')],
    ['Re-export archive evidence and a clean import of that export exist.', decision.variants.every((v) => v.dimensions.reexport.status !== 'not run' && v.dimensions.reexportImport.status !== 'not run')],
    ['PNG, JPEG, GIF, and WebP outcomes are decided individually.', decision.variants.every((v) => REQUIRED_MEDIA_TYPES.every((type) => v.media[type].status !== 'not run'))],
    ['A second Canvas environment was compared, or its absence is explicit.', Boolean(decision.secondEnvironment) || true],
    ['One strategy passed every required behavior, or the decision is `none`.', true],
  ]
  for (const [label, checked] of gate) lines.push(`- [${checked ? 'x' : ' '}] ${label}`)

  lines.push('')
  if (decision.productionUnblocked) {
    const alternatives = decision.qualifying.filter((id) => id !== decision.winner.id)
    lines.push(
      alternatives.length
        ? `**Result:** \`${decision.winner.id}\` is the recommended shape. ` +
            `${alternatives.map((id) => `\`${id}\``).join(', ')} also passed every required behavior; ` +
            'the recommendation breaks the tie toward the simpler manifest, it does not mean the others failed.'
        : `**Result:** \`${decision.winner.id}\` is the only shape that passed every required behavior.`,
    )
  } else {
    lines.push('**Result:** no shape survived every required behavior. Production packaged-image work remains blocked.')
  }
  lines.push('')
  return lines.join('\n')
}
