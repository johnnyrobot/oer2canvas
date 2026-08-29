/**
 * The load-bearing claim of issue 08's design, measured rather than asserted —
 * IN THE ENVIRONMENT IT NAMES.
 *
 * A packaged reference is a Canvas token, not a url: in the audit frame it
 * cannot load, and a broken image with no dimensions collapses to nothing. If
 * that happened, the audited layout would not be the published layout and the
 * whole reason for putting the token in the gated bytes would be gone.
 *
 * This runs in the `browser` project (real Chromium, real layout) rather than
 * jsdom: jsdom does not lay out replaced elements at all, so a
 * `getBoundingClientRect` assertion there would report zeroes regardless of
 * whether `width`/`height` attributes did anything, and this test would pass
 * for a reason that proves nothing about the property it exists to measure.
 *
 * TWO THINGS THIS FILE GOT WRONG BEFORE, both of which made it measure a
 * different page than the one the audit lays out:
 *
 * 1. IT MEASURED IN A BARE DOCUMENT. The audit frame injects `CANVAS_SHELL_CSS`
 *    (`iframe-runner.ts`, `canvas-shell.ts`), whose `img{max-width:100%;
 *    height:auto;}` inside a `#b2c-content{max-width:1100px;padding:24px}`
 *    column is the rule that actually governs a packaged image. Without it the
 *    attributes were being measured under no rule at all. Both arms now render
 *    through `wrapInCanvasShell`, the shared definition the audit frame writes.
 * 2. EVERY `RASTER_FIXTURES` ENTRY IS 16x16. Under `height:auto` the whole
 *    question is whether the attribute-derived aspect ratio survives, and a
 *    square fixture makes the 1:1 fallback and the true ratio the same number —
 *    the measurement could not fail. The image here is generated non-square
 *    (4:3) so the ratio is observable, and it is generated through a real
 *    `<canvas>` encode so the resolved control has genuinely decodable bytes.
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
import { wrapInCanvasShell } from './canvas-shell'

/** The audit frame's own width (`iframe-runner.ts` sets `el.style.width`). */
const AUDIT_FRAME_WIDTH = 1280
/**
 * Narrower than the shell's 1100px column, so `max-width:100%` actually binds
 * and `height:auto` has to derive a height. This is the only width at which the
 * aspect ratio is observable at all — at 1280 the image fits and both arms
 * simply take their attribute values.
 */
const NARROW_FRAME_WIDTH = 300

/**
 * A real, decodable PNG of `width` x `height`, encoded by the browser itself.
 *
 * Deliberately not a header-only fixture: the resolved arm is the control for
 * what a genuinely LOADED image occupies, so its bytes have to decode. Encoding
 * here rather than committing a second binary fixture also keeps the dimensions
 * a parameter of this test instead of a property of a file somewhere else.
 */
async function decodablePng(width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = '#3366aa'
  context.fillRect(0, 0, width, height)
  const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * The fragment, mounted exactly as the audit mounts it: inside `#b2c-content`
 * in a document styled by `CANVAS_SHELL_CSS`. `wrapInCanvasShell` is that
 * document's single definition — `iframe-runner.ts` writes a layout-identical
 * shell around the same id (same `CANVAS_SHELL_CSS`, same `#b2c-content`; the
 * `<title>` and DOM-construction method differ), which is the invariant
 * `canvas-shell.ts` documents.
 */
function shellFrame(fragment: string, frameWidth: number) {
  const frame = document.createElement('iframe')
  frame.style.cssText = `position:absolute;left:-10000px;width:${frameWidth}px;height:900px;border:0`
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write(wrapInCanvasShell(fragment))
  doc.close()
  return { image: doc.querySelector('img')!, dispose: () => frame.remove() }
}

const boxOf = (image: HTMLImageElement) => {
  const rect = image.getBoundingClientRect()
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

/** The `<img>` the real emitter writes for a one-image document. */
async function emittedImage(width: number, height: number) {
  const asset = {
    id: 0,
    mediaType: 'image/png',
    originPart: 'word/media/diagram.png',
    data: await decodablePng(width, height),
  }
  const result = normalizeAnyDocDocument(documentWith([asset]), 'docx', await prepareAssets([asset]))
  const markup = result.html.match(/<img[^>]*>/)?.[0]
  if (!markup) throw new Error(`Expected an <img> in the emitted html, got: ${result.html}`)
  // Exactly what the audit frame is handed: the gated html still carries the
  // Canvas token, which this frame (unlike the preview surfaces covered in
  // `packaged-preview.browser.test.tsx`) never resolves to a blob url.
  expect(markup).toContain('$IMS-CC-FILEBASE$/oer2canvas/')
  return { markup, bytes: asset.data }
}

/**
 * WIDTH AND HEIGHT PARITY BOTH HOLD, and the numbers below are what Chromium
 * measured under the real shell css:
 *
 *   frame     resolved    unresolved (token, before it errors)
 *   1280px    800x600     800x600
 *    300px    220x165     220x165
 *
 * 220x165 is the whole reason the image is non-square: 300 - 2x16 body padding
 * - 2x24 column padding leaves a 220px column, `max-width:100%` shrinks the
 * image to it, and `height:auto` derives 165 from the attribute-declared 4:3.
 * That the unresolved arm lands on 165 rather than 220 is the measurement a
 * 16x16 fixture could never make.
 *
 * NOTE ON THE MOMENT OF MEASUREMENT, because it is a real limitation and not a
 * detail. The unresolved arm is read BEFORE its request fails. That is the
 * state the audit reads too — `settleLayout` waits one frame — but it is a race
 * the audit can lose, and the sibling test below pins what happens when it
 * does. Reading it synchronously here is deterministic (a network response
 * cannot be delivered inside this task), so this test measures one defined
 * state rather than whichever one it happened to catch.
 */
test('an unresolved packaged image reserves the same box as a resolved one, under the audit shell', async () => {
  const declared = { width: 800, height: 600 }
  const { markup, bytes } = await emittedImage(declared.width, declared.height)
  expect(markup).toContain(`width="${declared.width}"`)
  expect(markup).toContain(`height="${declared.height}"`)

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
  try {
    // The control: real bytes behind a real, fetchable url, carrying the SAME
    // attributes the emitter wrote — the only variable left between the two
    // arms is whether the `src` actually resolves.
    const resolvedMarkup = markup.replace(/src="[^"]*"/, `src="${url}"`)

    for (const frameWidth of [AUDIT_FRAME_WIDTH, NARROW_FRAME_WIDTH]) {
      const broken = shellFrame(markup, frameWidth)
      const unresolved = boxOf(broken.image)
      broken.dispose()

      const control = shellFrame(resolvedMarkup, frameWidth)
      if (!control.image.complete) {
        await new Promise<void>((resolve, reject) => {
          control.image.addEventListener('load', () => resolve())
          control.image.addEventListener('error', () => reject(new Error('control image failed to load from its own blob url')))
        })
      }
      const resolved = boxOf(control.image)
      control.dispose()

      // The claim under test: the box the audit measures for a token that never
      // loaded is pixel-identical to the box a real, decoded image occupies —
      // in BOTH dimensions — so the audited layout matches what Canvas will
      // publish.
      expect({ frameWidth, ...unresolved }).toEqual({ frameWidth, ...resolved })

      // Anchored to concrete numbers rather than merely "the two sides agree",
      // which would still pass if both collapsed to the same wrong value. Both
      // are derived from the declared size, not written as literals.
      if (frameWidth === AUDIT_FRAME_WIDTH) {
        expect(unresolved).toEqual(declared)
      } else {
        // Constrained by the column, and still 4:3 — the aspect ratio survived.
        expect(unresolved.width).toBeLessThan(declared.width)
        expect(unresolved.height).toBeCloseTo(
          (unresolved.width * declared.height) / declared.width,
          1,
        )
      }
    }
  } finally {
    URL.revokeObjectURL(url)
  }
})

/**
 * THE LIMIT OF THE CLAIM ABOVE, measured rather than assumed — and a real
 * residual, recorded here so nobody reads the parity test as unconditional.
 *
 * Once the token's request actually fails, Chromium stops treating the `<img>`
 * as a replaced element and renders its alt text instead. Width and height
 * attributes do not apply to a non-replaced inline box, so the reserved box is
 * gone: measured 73.8x24 (the alt run "Figure 0") at BOTH 1280 and 300, against
 * the 800x600 / 220x165 above.
 *
 * The mechanism is the alt substitution, not the attributes losing their
 * effect — which is why the `alt=""` arm below is here. With nothing to
 * substitute, the same failed image keeps its full attribute-derived box. That
 * distinction is what makes this actionable: it is not that the emitter's
 * attributes stopped working.
 *
 * WHY THIS IS NOT A FAILING TEST. The audit's `settleLayout` waits one frame
 * (~16ms) against a request that has to reach the network, so in practice it
 * reads the reserved box — but it is a race, and on a slow-to-fail request it
 * can read this one instead. Bounding it properly is not a test change; it is a
 * question for the audit runner, and it is deliberately left open here rather
 * than papered over.
 */
test('once the unresolved reference fails, the reserved box is lost to the alt text', async () => {
  const { markup } = await emittedImage(800, 600)

  const withAlt = shellFrame(markup, AUDIT_FRAME_WIDTH)
  const reserved = boxOf(withAlt.image)
  await new Promise<void>((resolve) => withAlt.image.addEventListener('error', () => resolve()))
  await new Promise((resolve) => requestAnimationFrame(resolve))
  const collapsed = boxOf(withAlt.image)
  withAlt.dispose()

  expect(reserved).toEqual({ width: 800, height: 600 })
  expect(collapsed.width).toBeLessThan(reserved.width)
  expect(collapsed.height).toBeLessThan(reserved.height)

  // Same bytes, same failure, same attributes — only the alt text removed. The
  // box survives, which is what identifies alt substitution as the cause.
  const withoutAlt = shellFrame(markup.replace(/alt="[^"]*"/, 'alt=""'), AUDIT_FRAME_WIDTH)
  await new Promise<void>((resolve) => withoutAlt.image.addEventListener('error', () => resolve()))
  await new Promise((resolve) => requestAnimationFrame(resolve))
  const emptyAlt = boxOf(withoutAlt.image)
  withoutAlt.dispose()

  expect(emptyAlt).toEqual(reserved)
})

test('without width and height the box collapses — which is why they are emitted', async () => {
  // The negative control. If this ever matched or exceeded the sized case, the
  // parity test would be passing for the wrong reason and would pin nothing: it
  // would mean a broken image reserves its declared box (or more) regardless of
  // whether width/height are present, so the attributes the emitter writes
  // would be doing no work at all. Both arms use the same alt text and the same
  // frame, so a longer fallback alt string cannot be the reason the unsized box
  // comes out smaller.
  const { markup } = await emittedImage(800, 600)

  const sized = shellFrame(markup, AUDIT_FRAME_WIDTH)
  const sizedBox = boxOf(sized.image)
  sized.dispose()

  const unsized = shellFrame(markup.replace(/ width="[^"]*"| height="[^"]*"/g, ''), AUDIT_FRAME_WIDTH)
  const unsizedBox = boxOf(unsized.image)
  unsized.dispose()

  expect(unsizedBox.width).toBeLessThan(sizedBox.width)
  expect(unsizedBox.height).toBeLessThan(sizedBox.height)
})
