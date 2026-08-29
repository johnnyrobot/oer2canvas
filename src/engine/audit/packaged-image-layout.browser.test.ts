/**
 * The load-bearing claim of issue 08's design, measured rather than asserted.
 *
 * A packaged reference is a Canvas token, not a url: in the audit frame it
 * cannot load, and a broken image with no dimensions collapses to a few pixels.
 * If that happened, the audited layout would not be the published layout and the
 * whole reason for putting the token in the gated bytes would be gone.
 *
 * This runs in the `browser` project (real Chromium, real layout) rather than
 * jsdom: jsdom does not lay out replaced elements at all, so a `getBoundingClientRect`
 * assertion there would report zeroes regardless of whether `width`/`height`
 * attributes did anything, and this test would pass for a reason that proves
 * nothing about the property it exists to measure.
 *
 * The unresolved markup is not a string literal: it is pulled out of
 * `result.html`, the actual output of `prepareAssets` + `normalizeAnyDocDocument`
 * (`src/import/parsers/anydoc-html.ts`) for a one-image document, the same pair
 * `anydoc-html.test.ts` drives. That is what makes this file load-bearing rather
 * than decorative — if the emitter ever stopped writing `width`/`height` onto a
 * packaged `<img>`, THIS file would redden, not just the compile golden that
 * merely proves the attributes are emitted.
 */
import type { Document } from '@firecrawl/anydoc-wasm'
import { prepareAssets } from '../../import/assets'
import { normalizeAnyDocDocument } from '../../import/parsers/anydoc-html'
import { RASTER_FIXTURES } from '../../import/testing/raster-fixtures'

const box = (html: string) => {
  const host = document.createElement('div')
  host.style.width = '1280px'
  host.innerHTML = html
  document.body.appendChild(host)
  const rect = host.querySelector('img')!.getBoundingClientRect()
  host.remove()
  return { width: rect.width, height: rect.height }
}

// The exact document shape `anydoc-html.test.ts`'s own `documentWith` helper
// builds: one paragraph holding one asset-sourced image.
const documentWith = (assets: { id: number; mediaType: string; originPart: string; data: Uint8Array }[]) => ({
  kind: 'document',
  blocks: [{
    kind: 'paragraph',
    content: assets.map((asset) => ({
      kind: 'image', alt: `Figure ${asset.id}`, source: { kind: 'asset', assetId: asset.id },
    })),
  }],
  assets, notes: [],
}) as never as Document

test('an unresolved packaged image reserves the same box as a resolved one', async () => {
  const asset = { id: 0, mediaType: 'image/png', originPart: 'word/media/diagram.png', data: RASTER_FIXTURES.png.bytes }
  const result = normalizeAnyDocDocument(documentWith([asset]), 'docx', await prepareAssets([asset]))

  // Exactly what the audit frame is handed: the gated html still carries the
  // Canvas token, which this frame (unlike the preview surfaces covered in
  // `packaged-preview.browser.test.tsx`) never resolves to a blob url. The
  // browser tries to fetch `$IMS-CC-FILEBASE$/oer2canvas/…` as a literal
  // relative path, fails, and renders a broken image — `width`/`height` are
  // the only thing standing between that failure and a collapsed box.
  const emitted = result.html.match(/<img[^>]*>/)?.[0]
  if (!emitted) throw new Error(`Expected an <img> in the emitted html, got: ${result.html}`)
  expect(emitted).toContain('$IMS-CC-FILEBASE$/oer2canvas/')

  const unresolved = box(emitted)

  // The control for what a genuinely LOADED image of the same declared size
  // occupies: real bytes behind a real, fetchable url, carrying the SAME
  // alt/width/height attributes the emitter wrote — the only variable left
  // between the two arms is whether the `src` actually resolves.
  const alt = emitted.match(/alt="([^"]*)"/)?.[1] ?? ''
  const width = emitted.match(/width="([^"]*)"/)?.[1]
  const height = emitted.match(/height="([^"]*)"/)?.[1]
  const url = URL.createObjectURL(new Blob([RASTER_FIXTURES.png.bytes as BlobPart], { type: 'image/png' }))
  try {
    const host = document.createElement('div')
    host.style.width = '1280px'
    host.innerHTML = `<img src="${url}" alt="${alt}" width="${width}" height="${height}">`
    document.body.appendChild(host)
    const image = host.querySelector('img')!
    if (!image.complete) {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve())
        image.addEventListener('error', () => reject(new Error('control image failed to load from its own blob url')))
      })
    }
    const resolved = image.getBoundingClientRect()
    host.remove()

    // The claim under test: a box the audit measured for a token that never
    // loaded is pixel-identical to the box a real, decoded image occupies —
    // so the audited layout matches what Canvas will actually publish.
    expect(unresolved).toEqual({ width: resolved.width, height: resolved.height })
    // Anchors the comparison to a concrete number rather than merely "the two
    // sides agree", which would still pass if both collapsed to the same
    // (wrong) value. Derived from the fixture itself, not a literal, so this
    // stays true if the fixture's dimensions ever change.
    expect(unresolved.width).toBe(RASTER_FIXTURES.png.width)
  } finally {
    URL.revokeObjectURL(url)
  }
})

test('without width and height the box collapses — which is why they are emitted', () => {
  // The negative control. If this ever matched or exceeded the sized case,
  // the test above would be passing for the wrong reason and would pin
  // nothing: it would mean a broken image reserves its declared box (or
  // more) regardless of whether width/height are present, so the attributes
  // `prepareAssets`/the compiler emit would be doing no work at all, and this
  // whole test file would be measuring a browser behaviour that was never
  // actually load-bearing. Both arms use the same short alt text and the
  // same host width, so a longer fallback alt string cannot be the reason
  // the unsized box happens to come out smaller.
  const sized = box('<img src="$IMS-CC-FILEBASE$/oer2canvas/x-a3f91c2e.png" alt="x" width="16" height="16">')
  const unsized = box('<img src="$IMS-CC-FILEBASE$/oer2canvas/x-a3f91c2e.png" alt="x">')
  expect(unsized.width).toBeLessThan(sized.width)
})
