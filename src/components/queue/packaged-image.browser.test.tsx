import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { QueueView } from './QueueView'
import { newSession, type QueueSession } from './session'
import { queueKeyOf } from '../../engine/compile/answers'
import { packagedReference } from '../../import/assets'
import { RASTER_FIXTURES } from '../../import/testing/raster-fixtures'
import type { CompiledChapter, CompiledSection, QueueItem } from '../../contracts/index'
import type { GateResult } from '../../engine/gate'
import type { ImportedAsset } from '../../import/types'

/**
 * Region E for a DOCX-sourced image, in a real browser.
 *
 * This is the exact case the whole-branch review flagged: a mid-branch
 * decision made the parser omit `alt` when the source document has no alt
 * carrier at all — the ordinary case for DOCX — so those images land in the
 * queue as kind `alt`, whose prompt is "Describe this image for a student
 * who cannot see it." Region E resolves the section's html for `ChapterView`
 * and `ImportPlanEditor` already, via `usePackagedAssetUrls`, but `QueueView`
 * mounted `section.gate.html` with no resolution at all — so the very
 * screen asking an instructor to describe an image showed them a broken one.
 *
 * Real Chromium (see `vitest.config.ts`'s `browser` project), because the
 * assertion that matters — `naturalWidth === 16` — can only be true if the
 * browser actually decoded real image bytes behind a `blob:` url; jsdom has
 * no image decoder and would pass this test for a url pointing at nothing.
 */

afterEach(cleanup)

const PACKAGED_NAME = 'diagram-deadbeef.png'
const PACKAGED_ASSET: ImportedAsset = {
  id: 'asset-1',
  name: PACKAGED_NAME,
  mediaType: RASTER_FIXTURES.png.mediaType,
  extension: 'png',
  bytes: RASTER_FIXTURES.png.bytes,
  sha256: '0000000000000000000000000000000000000000000000000000000000000000',
  originPart: 'word/media/image1.png',
}
const PACKAGED_REFERENCE = packagedReference(PACKAGED_NAME)

const gate = (html: string): GateResult =>
  ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult

/** One `alt`-kind item — no caption, no reference — pointing at a packaged image. */
const item: QueueItem = {
  kind: 'alt',
  sectionId: 's1',
  elementId: 'img-1',
  context: { src: PACKAGED_REFERENCE },
}

function fixtureSession(): QueueSession {
  const section: CompiledSection = {
    id: 's1',
    title: '1.1 A section with an embedded image',
    html: '<p>compiled — must never be rendered</p>',
    notes: [],
    queue: [item],
    gate: gate(`<img id="img-1" src="${PACKAGED_REFERENCE}">`),
  }
  const compiled = {
    chapter: { sections: [], assets: [PACKAGED_ASSET] },
    sections: [section],
    queue: [item],
  } as unknown as CompiledChapter
  const session = newSession(compiled)
  return { ...session, cursor: queueKeyOf(item) }
}

async function waitForDecode(image: HTMLImageElement) {
  await waitFor(() => expect(image.complete).toBe(true))
  // `complete` also flips true for a failed/broken load; only a decoded
  // `naturalWidth` proves the bytes behind the `blob:` url were a real image.
}

describe('the queue render for a packaged (DOCX-sourced) image', () => {
  it('shows a real, decoded image rather than the broken filebase token', async () => {
    const session = fixtureSession()
    const { container } = render(<QueueView session={session} />)

    const image = container.querySelector('#img-1') as HTMLImageElement
    expect(image).not.toBeNull()
    expect(image.getAttribute('src')).toMatch(/^blob:/)

    await waitForDecode(image)
    expect(image.naturalWidth).toBe(16)

    // Display-only: the gated bytes that pass to export must be untouched.
    expect(session.compiled.sections[0]!.gate!.html).toContain(PACKAGED_REFERENCE)
    expect(session.compiled.sections[0]!.gate!.html).not.toContain('blob:')
  })
})
