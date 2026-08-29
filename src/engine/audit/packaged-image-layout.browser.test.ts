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
 */
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

test('an unresolved packaged image reserves the same box as a resolved one', async () => {
  // Exactly what the audit frame is handed: the gated html still carries the
  // Canvas token, which this frame (unlike the preview surfaces covered in
  // `packaged-preview.browser.test.tsx`) never resolves to a blob url. The
  // browser tries to fetch `$IMS-CC-FILEBASE$/oer2canvas/…` as a literal
  // relative path, fails, and renders a broken image — `width`/`height` are
  // the only thing standing between that failure and a collapsed box.
  const unresolved = box(
    '<img src="$IMS-CC-FILEBASE$/oer2canvas/diagram-a3f91c2e.png" alt="A diagram" width="16" height="16">',
  )

  // The control for what a genuinely LOADED image of the same declared size
  // occupies: real bytes behind a real, fetchable url.
  const url = URL.createObjectURL(new Blob([RASTER_FIXTURES.png.bytes as BlobPart], { type: 'image/png' }))
  try {
    const host = document.createElement('div')
    host.innerHTML = `<img src="${url}" alt="A diagram" width="16" height="16">`
    document.body.appendChild(host)
    const image = host.querySelector('img')!
    if (!image.complete) await new Promise((done) => image.addEventListener('load', done))
    const resolved = image.getBoundingClientRect()
    host.remove()

    // The claim under test: a box the audit measured for a token that never
    // loaded is pixel-identical to the box a real, decoded image occupies —
    // so the audited layout matches what Canvas will actually publish.
    expect(unresolved).toEqual({ width: resolved.width, height: resolved.height })
    // Anchors the comparison to a concrete number rather than merely "the two
    // sides agree", which would still pass if both collapsed to the same
    // (wrong) value.
    expect(unresolved.width).toBe(16)
  } finally {
    URL.revokeObjectURL(url)
  }
})

test('without width and height the box collapses — which is why they are emitted', () => {
  // The negative control. If this ever matched the sized case, the test above
  // would be passing for the wrong reason and would pin nothing: it would mean
  // a broken image reserves its declared box regardless of whether width/height
  // are present, so the attributes `prepareAssets`/the compiler emit would be
  // doing no work at all, and this whole test file would be measuring a
  // browser behaviour that was never actually load-bearing.
  const sized = box('<img src="$IMS-CC-FILEBASE$/oer2canvas/x-a3f91c2e.png" alt="x" width="16" height="16">')
  const unsized = box('<img src="$IMS-CC-FILEBASE$/oer2canvas/x-a3f91c2e.png" alt="x">')
  expect(unsized.width).not.toBe(sized.width)
})
