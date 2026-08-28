import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach } from 'vitest'
import { ChapterView } from './ChapterView'
import { ImportPlanEditor, createImportDraft, type ImportDraft } from './ImportPlanEditor'
import { packagedReference } from '../import/assets'
import { RASTER_FIXTURES } from '../import/testing/raster-fixtures'
import type { Chapter } from '../sources/types'
import type { CompiledChapter } from '../contracts/index'
import type { GateResult } from '../engine/gate'
import type { ImportedAsset, ImportResult } from '../import/types'

/**
 * Proves `usePackagedAssetUrls` resolves `$IMS-CC-FILEBASE$/oer2canvas/…`
 * tokens to real, decodable `blob:` urls for both preview surfaces
 * (`ChapterView` and `ImportPlanEditor`), without ever touching the stored
 * html those surfaces read from. Runs against real Chromium (see
 * `vitest.config.ts`'s `browser` project) because the assertion that matters
 * — `naturalWidth === 16` — can only be true if the browser actually decoded
 * real image bytes behind the blob url; jsdom has no image decoder and would
 * pass this test for a `blob:` url pointing at garbage.
 */

afterEach(() => cleanup())

// A name deliberately unrelated to `originPart`/`sha256`/`extension`, so a
// hook that (incorrectly) recomputed the reference via
// `packagedAssetName(asset.originPart, asset.sha256, asset.extension)` -
// what the task-9 brief's sketch does, and what task-9's corrected
// instructions forbid - would compute a DIFFERENT string than
// `packagedReference(asset.name)` and this test would fail with the image
// left broken. Keying on `asset.name` (the winning name `prepareAssets`
// already assigned) is the only way the map agrees with the html.
const PACKAGED_NAME = 'diagram-deadbeef.png'
const PACKAGED_ASSET: ImportedAsset = {
  id: 'asset-1',
  name: PACKAGED_NAME,
  mediaType: RASTER_FIXTURES.png.mediaType,
  extension: 'png',
  bytes: RASTER_FIXTURES.png.bytes,
  sha256: '0000000000000000000000000000000000000000000000000000000000000000',
  // Content-identical assets share one `name`, assigned to whichever
  // occurrence was seen FIRST; this occurrence's own `originPart` need not
  // (and here deliberately does not) match the slug in `PACKAGED_NAME`.
  originPart: 'word/media/image99.png',
}
const PACKAGED_REFERENCE = packagedReference(PACKAGED_NAME)
const DANGLING_REFERENCE = packagedReference('never-packaged-9999999.png')

async function waitForDecode(image: HTMLImageElement) {
  await waitFor(() => expect(image.complete).toBe(true))
  // `complete` also flips true for a failed/broken load; only a decoded
  // `naturalWidth` proves the bytes behind the blob url were a real image.
}

describe('ChapterView', () => {
  const baseChapter: Omit<Chapter, 'assets'> = {
    source: 'document',
    bookId: 'b',
    title: 'Chapter with an embedded image',
    xrefs: new Map(),
    attribution: { bookTitle: 'A document', publisher: 'Self', authors: [] },
    sections: [{ id: 's1', title: 'Section one', order: 0, html: '<p>raw</p>' }],
  }

  const gate = (html: string): GateResult => ({
    html,
    conformance: { passedChecks: true, blockers: [], warnings: [], needsHumanReview: [] },
    badgeWithheld: false,
  })

  function compiledWith(chapter: Chapter, html: string): CompiledChapter {
    return {
      chapter,
      queue: [],
      sections: [{ id: 's1', title: 'Section one', html: '<p>compiled but unaudited</p>', notes: [], queue: [], gate: gate(html) }],
    }
  }

  test('the preview shows a real image while the stored html keeps the token', async () => {
    const chapter: Chapter = { ...baseChapter, assets: [PACKAGED_ASSET] }
    const compiled = compiledWith(chapter, `<img alt="A diagram" src="${PACKAGED_REFERENCE}">`)

    const { container } = render(<ChapterView compiled={compiled} />)
    const image = container.querySelector('img')!
    expect(image.getAttribute('src')).toMatch(/^blob:/)

    await waitForDecode(image)
    expect(image.naturalWidth).toBe(16)

    // The gated bytes must be untouched: only the live DOM was resolved.
    expect(compiled.sections[0]!.gate!.html).toContain(PACKAGED_REFERENCE)
    expect(compiled.sections[0]!.gate!.html).not.toContain('blob:')
  })

  test('a reference with no matching asset is left alone rather than guessed at', () => {
    const chapter: Chapter = { ...baseChapter, assets: [PACKAGED_ASSET] }
    const compiled = compiledWith(chapter, `<img alt="A diagram" src="${DANGLING_REFERENCE}">`)

    const { container } = render(<ChapterView compiled={compiled} />)
    const src = container.querySelector('img')!.getAttribute('src')!
    expect(src).toBe(DANGLING_REFERENCE)
    expect(src).toContain('$IMS-CC-FILEBASE$')
  })

  test('a chapter with no packaged assets at all leaves the token alone', () => {
    // `Chapter.assets` is absent entirely for catalog sources (OpenStax,
    // LibreTexts, Pressbooks) whose images are remote urls, not packaged
    // bytes. The resolver must degrade to a no-op rather than throw.
    const chapter: Chapter = { ...baseChapter }
    const compiled = compiledWith(chapter, `<img alt="A diagram" src="${PACKAGED_REFERENCE}">`)

    const { container } = render(<ChapterView compiled={compiled} />)
    expect(container.querySelector('img')!.getAttribute('src')).toBe(PACKAGED_REFERENCE)
  })

  test('revoking an old chapter\'s blob url never breaks the newly rendered one', async () => {
    // Regression guard for the lifecycle requirement: the cleanup that
    // revokes chapter A's object urls must run only after chapter B's urls
    // are already the ones painted, never while A's image is still on
    // screen and never leaking B's urls when the component unmounts.
    const assetB: ImportedAsset = { ...PACKAGED_ASSET, id: 'asset-2', name: 'other-cafef00d.png', bytes: RASTER_FIXTURES.jpeg.bytes, mediaType: RASTER_FIXTURES.jpeg.mediaType, extension: 'jpg' }
    const referenceB = packagedReference(assetB.name)
    const chapterA: Chapter = { ...baseChapter, assets: [PACKAGED_ASSET] }
    const chapterB: Chapter = { ...baseChapter, title: 'Chapter B', assets: [assetB] }

    const { container, rerender } = render(
      <ChapterView compiled={compiledWith(chapterA, `<img alt="A" src="${PACKAGED_REFERENCE}">`)} />,
    )
    const firstImage = container.querySelector('img')!
    await waitForDecode(firstImage)
    expect(firstImage.naturalWidth).toBe(16)
    const firstUrl = firstImage.getAttribute('src')!

    rerender(<ChapterView compiled={compiledWith(chapterB, `<img alt="B" src="${referenceB}">`)} />)
    const secondImage = container.querySelector('img')!
    expect(secondImage.getAttribute('src')).not.toBe(firstUrl)
    await waitForDecode(secondImage)
    expect(secondImage.naturalWidth).toBe(16)

    cleanup()
    // No assertion possible on revocation itself (the browser gives no way to
    // ask), but reaching this point without the second image failing to
    // decode is what proves the first chapter's cleanup did not fire early.
  })
})

describe('ImportPlanEditor', () => {
  function importResult(html: string, assets: ImportedAsset[]): ImportResult {
    return {
      work: {
        id: 'document-abc123',
        title: 'Diagram doc',
        format: 'markdown',
        sections: [{ id: 'document-abc123-page-1', title: 'Diagram doc', order: 0, html }],
        assets,
        provenance: { kind: 'paste', rights: { authority: 'own', acknowledged: true } },
      },
      report: {
        parser: 'native',
        format: 'markdown',
        findings: [],
        counts: { sections: 1, headings: 0, tables: 0, images: 1, equations: 0, notes: 0, unavailableAssets: 0 },
      },
    }
  }

  function Harness({ initial }: { initial: ImportDraft }) {
    const [draft, setDraft] = useState(initial)
    return <ImportPlanEditor draft={draft} onChange={setDraft} onConfirm={() => {}} onDiscard={() => {}} />
  }

  test('the page preview shows a real image while the source work keeps the token', async () => {
    const source = importResult(`<p>Diagram: <img alt="A diagram" src="${PACKAGED_REFERENCE}"></p>`, [PACKAGED_ASSET])
    render(<Harness initial={createImportDraft(source)} />)

    // Preview bodies mount only once opened. The `<summary>` toggle has no
    // ARIA role mapping (browsers do not expose one to accessibility trees),
    // so it is found by its visible text, matching the pattern already used
    // in `ImportPlanEditor.test.tsx` and `markup.browser.test.tsx`.
    // The native `<details>`/`<summary>` toggle fires its `toggle` event (and
    // thus the `onToggle` handler that mounts the preview) asynchronously, so
    // the image is awaited rather than asserted on immediately — the same
    // pattern `ImportPlanEditor.test.tsx` uses (`await screen.findByText(...)`).
    fireEvent.click(screen.getByText(/^Preview /))
    const list = screen.getByRole('list', { name: 'Proposed Canvas pages' })
    const image = await within(list).findByRole('img', { name: 'A diagram' }) as HTMLImageElement
    expect(image.getAttribute('src')).toMatch(/^blob:/)

    await waitForDecode(image)
    expect(image.naturalWidth).toBe(16)

    // The confirmed result is built from `source`/`plan`, never from the
    // resolved preview string, so it must still carry the packaged token.
    expect(source.work.sections[0]!.html).toContain(PACKAGED_REFERENCE)
    expect(source.work.sections[0]!.html).not.toContain('blob:')
  })

  test('a dangling reference in the page preview is left alone', async () => {
    const source = importResult(`<p><img alt="A diagram" src="${DANGLING_REFERENCE}"></p>`, [PACKAGED_ASSET])
    render(<Harness initial={createImportDraft(source)} />)

    fireEvent.click(screen.getByText(/^Preview /))
    const list = screen.getByRole('list', { name: 'Proposed Canvas pages' })
    const image = await within(list).findByRole('img', { name: 'A diagram' })
    expect(image.getAttribute('src')).toBe(DANGLING_REFERENCE)
  })
})
