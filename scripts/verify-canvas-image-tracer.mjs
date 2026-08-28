/**
 * Live Canvas acceptance check for the packaged-image tracer (document-import
 * issue 08): imports `artifacts/packaged-image-tracer/tracer.imscc` — the
 * cartridge `src/import/packaged-cartridge.browser.test.ts` builds from the
 * REAL pipeline (anydoc Worker, compile, gate, `buildCartridge`) — into one
 * disposable Canvas course and measures whether the packaged image actually
 * decoded in a real browser, not merely that Canvas reported "completed".
 *
 *   CANVAS_BASE_URL=https://canvas.example.edu
 *   CANVAS_TOKEN=<token that may create and delete courses in a disposable account>
 *
 *   npm run verify:canvas-image-tracer -- [--account <id>] [--cartridge <path>]
 *
 * This is the SECOND half of a two-half proof. The first half (the browser
 * test above) is what makes the artifact worth anything: it already asserts
 * the gated html carries a `$IMS-CC-FILEBASE$/oer2canvas/` reference before
 * it ever gets zipped. This script's job is narrower and purely observational
 * — it does not re-derive or second-guess that packaging decision, it just
 * watches what a real Canvas does with the resulting bytes.
 *
 * Deliberately reuses `Canvas`, `createCourse`, `importCartridge`,
 * `readCourseContent` and `renderPages` from `canvas-image-probe-run.mjs`
 * rather than re-implementing this exact create → import → read → render
 * shape a second time — that module already proved this shape against a
 * live Canvas (see `docs/evidence/canvas-image-probes-2026-08-28.md`), and a
 * second, slightly-different implementation here would just be a second
 * opinion of "the import worked" that could quietly drift from the first.
 *
 * DISPOSABLE BY CONSTRUCTION: exactly one course is created, and it is
 * deleted in a `finally` — even when the import fails, even when rendering
 * throws, even when the browser itself fails to close. A probe that leaves
 * courses behind on failure is a leak that compounds every time this script
 * is re-run to chase down a real bug.
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { Canvas, createCourse, importCartridge, readCourseContent, renderPages } from './canvas-image-probe-run.mjs'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main() {
  const argv = process.argv.slice(2)
  const flag = (name) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const cartridgePath = resolve(flag('--cartridge') ?? 'artifacts/packaged-image-tracer/tracer.imscc')
  // Screenshots land next to the cartridge, not in a fresh timestamped
  // directory the way `canvas-image-probe-run.mjs`'s multi-variant evidence
  // does — this script only ever produces one course's worth of evidence, so
  // there is nothing for a timestamp to disambiguate.
  const evidenceDir = resolve(flag('--out') ?? 'artifacts/packaged-image-tracer')
  mkdirSync(evidenceDir, { recursive: true })

  const baseUrl = required('CANVAS_BASE_URL').replace(/\/$/, '')
  const canvas = new Canvas(baseUrl, required('CANVAS_TOKEN'))
  const accountId = flag('--account') ?? (await canvas.paginate('/api/v1/accounts'))[0]?.id
  if (!accountId) throw new Error('no Canvas account is visible to this token; pass --account <id>')

  const browser = await chromium.launch()
  // Same context options `canvas-image-probe-run.mjs` uses: a tall viewport
  // keeps the tracer image on screen, and blocking service workers keeps a
  // stale cached response from masquerading as a fresh import.
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 2000 } })

  const course = await createCourse(canvas, accountId, `oer2canvas image tracer ${Date.now()}`)
  try {
    // A Canvas API token is not a browser session — this endpoint trades one
    // for the other so rendering is measured as a signed-in user actually
    // sees it, the same login dance `canvas-image-probe-run.mjs` performs
    // before rendering any page.
    const session = await canvas.request(`/api/v1/login/session_token?return_to=${encodeURIComponent(`${baseUrl}/`)}`)
    const login = await context.newPage()
    await login.goto(session.session_url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await login.close()

    const result = await importCartridge(canvas, course.id, cartridgePath, 'tracer.imscc')
    if (result.workflowState !== 'completed') {
      throw new Error(`import ${result.workflowState}: ${JSON.stringify(result.migrationIssues)}`)
    }

    const content = await readCourseContent(canvas, course.id)
    await renderPages(context, baseUrl, course.id, content.pages, evidenceDir, 'tracer')

    const images = content.pages.flatMap((page) => page.renderedImages ?? [])
    if (images.length === 0) throw new Error('no images rendered')
    for (const image of images) {
      if (!image.naturalWidth) throw new Error(`image did not decode: ${image.currentSrc}`)
      if (!image.alt) throw new Error('alt text did not survive the import')
    }
    console.log(`PASS ${images.length} packaged image(s) rendered with alt text intact`)
  } finally {
    // Two independent cleanups, each swallowing its own error: a browser that
    // fails to close must never be the reason the course delete is skipped,
    // and vice versa.
    try {
      await browser.close()
    } catch (error) {
      console.error(`browser close: ${error.message}`)
    }
    try {
      await canvas.request(`/api/v1/courses/${course.id}?event=delete`, { method: 'DELETE' })
    } catch (error) {
      console.error(`cleanup course ${course.id}: ${error.message}`)
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  })
}
