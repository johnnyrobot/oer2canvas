/**
 * The extractor, against a PDF whose bytes we control.
 *
 * Browser-project only: `OffscreenCanvas`, `ImageBitmap` and pdf.js's worker are
 * all real browser machinery, and a jsdom stand-in would be asserting the mock.
 */
import { expect, test } from 'vitest'
import { extractPdfImages } from './pdf-images'
import { pdfFixturePages } from './testing/pdf-fixture'
import { sniffRaster } from './assets'

test('recovers a drawn image, on the page it was drawn on', async () => {
  const pdf = pdfFixturePages(['text', 'text-and-figure', 'text'], 'Extract')
  const images = await extractPdfImages(pdf.buffer as ArrayBuffer)
  expect(images).toHaveLength(1)
  expect(images[0]!.page, 'the figure is on page 2, not page 1').toBe(2)
  expect(images[0]!.width).toBeGreaterThan(0)
  expect(images[0]!.height).toBeGreaterThan(0)
})

test('produces bytes the asset pipeline can already sniff', async () => {
  // The whole point: what comes out must be something `prepareAssets` accepts,
  // because that is what packages it into the cartridge and puts it in the
  // alt-text queue. Bytes nothing can sniff would be recovered and then dropped.
  const pdf = pdfFixturePages(['text-and-figure'], 'Sniff')
  const [image] = await extractPdfImages(pdf.buffer as ArrayBuffer)
  expect(image).toBeDefined()
  const sniffed = sniffRaster(image!.data)
  expect(sniffed, 'sniffRaster recognised the encoded bytes').toBeDefined()
  expect(sniffed!.mediaType).toBe(image!.mediaType)
  expect(sniffed!.width).toBe(image!.width)
  expect(sniffed!.height).toBe(image!.height)
})

test('a document with no drawn image yields nothing, and does not throw', async () => {
  const pdf = pdfFixturePages(['text', 'text'], 'Textonly')
  await expect(extractPdfImages(pdf.buffer as ArrayBuffer)).resolves.toEqual([])
})

test('finds the image on a scanned page too', async () => {
  // A scanned page is one image covering the sheet. It still has bytes worth
  // recovering even though its TEXT cannot be read.
  const pdf = pdfFixturePages(['text', 'scanned'], 'Scan')
  const images = await extractPdfImages(pdf.buffer as ArrayBuffer)
  expect(images.map((image) => image.page)).toEqual([2])
})

test('leaves the caller\'s buffer usable, rather than detaching it', async () => {
  // pdf.js transfers what it is given. The importer still needs these bytes for
  // hashing and for the extraction probe, so a detached buffer would break the
  // import in a way no unit test of this module alone would notice.
  const pdf = pdfFixturePages(['text-and-figure'], 'Detach')
  const buffer = pdf.buffer as ArrayBuffer
  await extractPdfImages(buffer)
  expect(buffer.byteLength, 'buffer was not detached').toBeGreaterThan(0)
  expect(new Uint8Array(buffer, 0, 5)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))
})
