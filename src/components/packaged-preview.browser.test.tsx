import { StrictMode, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach } from 'vitest'
import { ChapterView } from './ChapterView'
import { ImportPlanEditor, createImportDraft, type ImportDraft } from './ImportPlanEditor'
import { usePackagedAssetUrls } from './usePackagedAssetUrls'
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
 *
 * Also covers the object-url lifecycle directly: one test wraps `ChapterView`
 * in `<StrictMode>` (which `src/main.tsx` enables unconditionally) and
 * asserts the image still decodes despite React's dev-only double-invoked
 * effects — this is the regression pin for a prior defect where a `StrictMode`
 * remount revoked a url that was still displayed. Another spies on
 * `URL.revokeObjectURL` to prove urls are actually released — on an asset-list
 * change and on real unmount — rather than merely leaving the DOM in a state
 * that happens to look correct while leaking memory underneath it.
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

  /**
   * THE REGRESSION TEST FOR THE CRITICAL FINDING.
   *
   * `StrictMode` (enabled unconditionally in `src/main.tsx`) deliberately
   * runs a newly-mounted effect's cleanup and then its setup a second time,
   * back to back, in development only, to surface effects that are not
   * resilient to being started and stopped repeatedly. A version of this
   * hook that created its blob urls once (in a `useMemo` computed during
   * render) and only ever revoked them in the effect would treat that
   * synthetic remount as real: the synthetic cleanup unconditionally revoked
   * every url the memo made, and the synthetic setup that followed had
   * nothing left to do (there was no creation step inside the effect to
   * redo), leaving the already-painted `<img>` pointing at a revoked blob
   * url for the rest of its life. This test is a straight port of the one
   * that proved it, by execution: without the fix, `naturalWidth` measures
   * `0` here, not `16`.
   */
  test('an image with a packaged reference decodes even under React StrictMode\'s double-invoked effects', async () => {
    const chapter: Chapter = { ...baseChapter, assets: [PACKAGED_ASSET] }
    const compiled = compiledWith(chapter, `<img alt="A diagram" src="${PACKAGED_REFERENCE}">`)

    const { container } = render(
      <StrictMode>
        <ChapterView compiled={compiled} />
      </StrictMode>,
    )
    const image = container.querySelector('img')!
    await waitForDecode(image)
    expect(image.naturalWidth).toBe(16)
    expect(image.getAttribute('src')).toMatch(/^blob:/)
  })

  test('urls are revoked when the asset list changes, and again on real unmount — never while still displayed', async () => {
    // Spies rather than the indirect "does the OTHER image still decode"
    // proof above: this is the direct regression pin for "no leak" as its
    // own property, independent of whichever lifecycle mechanism happens to
    // satisfy it.
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const assetB: ImportedAsset = { ...PACKAGED_ASSET, id: 'asset-2', name: 'other-cafef00d.png', bytes: RASTER_FIXTURES.jpeg.bytes, mediaType: RASTER_FIXTURES.jpeg.mediaType, extension: 'jpg' }
    const referenceB = packagedReference(assetB.name)
    const chapterA: Chapter = { ...baseChapter, assets: [PACKAGED_ASSET] }
    const chapterB: Chapter = { ...baseChapter, title: 'Chapter B', assets: [assetB] }

    const { container, rerender, unmount } = render(
      <ChapterView compiled={compiledWith(chapterA, `<img alt="A" src="${PACKAGED_REFERENCE}">`)} />,
    )
    const firstImage = container.querySelector('img')!
    await waitForDecode(firstImage)
    const firstUrl = firstImage.getAttribute('src')!
    // Still on screen, decoded: must not have been revoked yet.
    expect(revoke).not.toHaveBeenCalledWith(firstUrl)

    rerender(<ChapterView compiled={compiledWith(chapterB, `<img alt="B" src="${referenceB}">`)} />)
    // The revoke happens once the effect for the new asset list has run,
    // which is after the render that already swapped the DOM to chapter B's
    // (unresolved, then resolved) html — so `firstUrl` is never in the
    // document any more by the time this fires.
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(firstUrl))

    const secondImage = container.querySelector('img')!
    await waitForDecode(secondImage)
    const secondUrl = secondImage.getAttribute('src')!
    expect(secondUrl).not.toBe(firstUrl)
    expect(revoke).not.toHaveBeenCalledWith(secondUrl)

    unmount()
    expect(revoke).toHaveBeenCalledWith(secondUrl)

    revoke.mockRestore()
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
        counts: { sections: 1, headings: 0, tables: 0, images: 1, equations: 0, notes: 0, unavailableAssets: 0, packagedAssetBytes: 0 },
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

/**
 * IDENTITY-UNSTABLE CALLERS.
 *
 * `assets={x ?? []}`, `assets={[...somethingComputed]}` — a fresh array
 * literal built from unchanging underlying data, every render, is an
 * ordinary React idiom, not a caller bug. The `useMemo`-based version of this
 * hook tolerated that wastefully (recomputing urls it did not need to), but
 * never crashed, because it never called `setState`. The effect-based
 * version added to fix the `StrictMode` defect above turned that same caller
 * into a hard, self-sustaining loop instead: an unstable array kept the
 * effect's `[assets]` dependency looking different on every run, so every
 * effect flush called `setUrls`, which re-rendered the component, which
 * built another fresh array, forever. `usePackagedAssetUrls` now depends on
 * a CONTENT key (each asset's `name` and `sha256`, joined) rather than the
 * array's identity, so two arrays with the same names and hashes settle
 * after one effect run regardless of how many distinct array objects the
 * caller hands it.
 */
describe('usePackagedAssetUrls with an identity-unstable caller', () => {
  // Generous enough that a genuinely settling hook never gets close (it
  // should settle within 1-2 renders), tight enough that a caller which
  // fails to settle throws almost immediately — this is a safety valve
  // against actually spinning for real, not a measurement of exactly how
  // long a real infinite loop would run for.
  const RENDER_CAP = 10

  function ContentStableProbe({ renderCounts }: { renderCounts: number[] }) {
    renderCounts.push(renderCounts.length + 1)
    if (renderCounts.length > RENDER_CAP) {
      throw new Error(`render count exceeded ${RENDER_CAP} — the effect never settled for a content-stable caller`)
    }
    // A BRAND NEW array literal every single render, on purpose — built
    // fresh from the same underlying asset data, the way a caller like
    // `assets={x ?? []}` or `assets={[...list]}` ordinarily would.
    const resolve = usePackagedAssetUrls([{ ...PACKAGED_ASSET }])
    return <div dangerouslySetInnerHTML={{ __html: resolve(`<img alt="A diagram" src="${PACKAGED_REFERENCE}">`) }} />
  }

  test('a fresh inline array with unchanged content settles instead of retriggering the effect forever', async () => {
    const renderCounts: number[] = []
    const { container } = render(<ContentStableProbe renderCounts={renderCounts} />)

    const image = container.querySelector('img')!
    await waitForDecode(image)
    expect(image.naturalWidth).toBe(16)

    const settledCount = renderCounts.length
    expect(settledCount).toBeLessThan(RENDER_CAP)

    // Give any further self-triggered renders a chance to happen, then
    // confirm none did: the render count actually STOPPED climbing, rather
    // than merely being small at the one moment already checked above.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(renderCounts.length).toBe(settledCount)
  })
})

