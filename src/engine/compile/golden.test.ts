import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { describe, it, expect } from 'vitest'
import { compileSection } from './index'
import { DOCUMENT } from './context'
import type { CompileContext } from './context'
import type { Section } from '../../sources/types'
import { fixtureContext, type FixtureName } from './fixture-context'
import { packagedAssetName, packagedReference } from '../../import/assets'
import { ideaEditKey, type IdeaEdit } from '../idea/edits'

// `fileURLToPath(new URL(...))` rather than `import.meta.dirname`: this module
// goes through Vite's transform, and only `import.meta.url` is guaranteed there.
// The `URL` constructor is imported explicitly from `node:url` rather than
// relying on the global: this project's `unit` suite runs in jsdom, whose
// global `URL` resolves a relative path against `window.location`
// (`http://localhost:3000/`) instead of a `file:` base, silently producing
// the wrong href. Node's own `URL` resolves the `file:` base correctly.
const DIR = fileURLToPath(new NodeURL('./__goldens__/', import.meta.url))
const UPDATE = process.env.UPDATE_GOLDENS === '1'

/**
 * Golden files are committed and reviewed as a DIFF. That is the whole point:
 * a transform regression shows up as a legible change to real chapter html,
 * which is where it is actually recognisable. Regenerate with
 * `UPDATE_GOLDENS=1 npx vitest run --project unit src/engine/compile/golden.test.ts`
 * and READ the diff before committing it.
 *
 * Writing requires the flag, full stop — a missing file is NOT treated as
 * permission to create it. A lost golden (bad rebase, stray `rm`, a
 * `.gitignore` mistake) must fail loudly and name itself, not regenerate
 * silently and report green while pinning nothing.
 */
function golden(file: string, actual: string): void {
  const path = `${DIR}${file}`
  if (UPDATE) {
    writeFileSync(path, actual)
    return
  }
  if (!existsSync(path)) {
    throw new Error(`${file} is missing. Run UPDATE_GOLDENS=1 to create it — do not let this regenerate silently.`)
  }
  expect(actual, `${file} differs — read the diff, then UPDATE_GOLDENS=1 if it is correct`).toBe(
    readFileSync(path, 'utf8'),
  )
}

describe.each<FixtureName>(['page', 'page-section'])('compile %s', (name) => {
  const { section, ctx } = fixtureContext(name)
  const out = compileSection(section, ctx)

  it('compiles without error', () => {
    expect(out.error).toBeUndefined()
  })

  it('matches the html golden', () => {
    golden(`${name}.compiled.html`, `${out.html}\n`)
  })

  it('matches the notes golden', () => {
    golden(`${name}.notes.json`, `${JSON.stringify(out.notes, null, 2)}\n`)
  })

  it('matches the queue golden', () => {
    golden(`${name}.queue.json`, `${JSON.stringify(out.queue, null, 2)}\n`)
  })
})

/**
 * A DOCUMENT-profile page carrying one packaged image, exercised separately
 * from the OpenStax fixtures above because it is not an OpenStax page at
 * all: no `fixtureContext` entry can produce it without dragging in a real
 * archive url and a real book from the catalog.
 *
 * `contentBaseUrl` is set (unlike a plain local-file import, which has
 * none) specifically so `absolutize` does NOT take its early
 * `!ctx.contentBaseUrl` return and actually walks the document's urls — the
 * one place a packaged `$IMS-CC-FILEBASE$/...` reference could accidentally
 * get rewritten into an absolute url pointing at the wrong host. Without a
 * base url that whole code path is skipped and this golden would prove
 * nothing about it.
 *
 * The reference itself is built through the SAME `packagedAssetName` /
 * `packagedReference` helpers `prepareAssets` calls in production, rather
 * than a hand-typed string, so a future change to that naming format shows
 * up here as a diff instead of this fixture silently drifting from reality.
 */
describe('compile page-packaged-image', () => {
  const imageName = packagedAssetName('word/media/image1.png', 'a1b2c3d4e5f6a7b89c0d1e2f3a4b5c6d', 'png')
  const imageReference = packagedReference(imageName)

  const html = `<h2 id="cell-biology">Cell Biology</h2>
<p>Cells are the basic building blocks of all living things.</p>
<p><img src="${imageReference}" alt="Cell diagram" width="16" height="16"></p>`

  const section: Section = {
    id: 's-packaged-image',
    title: 'Cell Biology',
    order: 0,
    html,
    contentBaseUrl: 'https://example.edu/biology.docx',
  }

  const ctx: CompileContext = {
    profile: DOCUMENT,
    contentBaseUrl: section.contentBaseUrl,
    sectionTitle: section.title,
    sectionId: section.id,
    xrefs: new Map(),
    attribution: { bookTitle: 'Cell Biology', publisher: 'Ada Instructor', authors: [] },
  }

  const out = compileSection(section, ctx)

  it('compiles without error', () => {
    expect(out.error).toBeUndefined()
  })

  // Belt-and-suspenders on top of the golden itself: a disappeared reference
  // fails with a message that names exactly what went missing, rather than
  // only showing up as an opaque multi-line html diff.
  it('keeps the packaged reference intact', () => {
    expect(out.html).toContain(imageReference)
  })

  it('matches the html golden', () => {
    golden('page-packaged-image.compiled.html', `${out.html}\n`)
  })

  it('matches the notes golden', () => {
    golden('page-packaged-image.notes.json', `${JSON.stringify(out.notes, null, 2)}\n`)
  })

  it('matches the queue golden', () => {
    golden('page-packaged-image.queue.json', `${JSON.stringify(out.queue, null, 2)}\n`)
  })
})

describe('compile page-section with IDEA edits', () => {
  const { section, ctx } = fixtureContext('page-section')
  // The first block with a MINTED id (the fixture's h2 keeps its own, so
  // that is `b2c-blk-1`, the Learning Objectives heading). Its first three
  // words are the original, so the case stays anchored to text that exists.
  const plain = compileSection(section, ctx)
  const first = new DOMParser().parseFromString(`<body>${plain.html}</body>`, 'text/html').querySelector('[id^="b2c-blk-"]')!
  const original = (first.textContent ?? '').trim().split(/\s+/).slice(0, 3).join(' ')
  const edits = new Map<string, IdeaEdit>([[ideaEditKey(section.id, first.id, 0, original), { kind: 'replace', replacement: 'REPLACED WORDS HERE' }]])
  const out = compileSection(section, { ...ctx, ideaEdits: edits })

  it('applies the edit and appends the change note; nothing else moves', () => {
    expect(out.html).toContain('REPLACED WORDS HERE')
    expect(out.html).toContain('b2c-idea-change')
    golden('page-section.idea-edits.compiled.html', `${out.html}\n`)
  })
})
