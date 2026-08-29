import { ASSETS } from '../../../scripts/canvas-image-probes.mjs'
import { RASTER_FIXTURES } from './raster-fixtures'
import { PDF_FIXTURE_JPEG } from './pdf-fixture'

const PROBE_FILE = { png: 'raster.png', jpeg: 'raster.jpg', gif: 'shared.gif', webp: 'raster.webp' }

test.each(Object.entries(PROBE_FILE))(
  '%s fixture is byte-identical to the raster issue 07 proved in Canvas',
  (key, file) => {
    const probe = ASSETS.find((asset) => asset.path.endsWith(`/${file}`))!
    const fixture = RASTER_FIXTURES[key as keyof typeof RASTER_FIXTURES]
    expect(Array.from(fixture.bytes)).toEqual(Array.from(probe.data))
    expect(fixture.mediaType).toBe(probe.mediaType)
  },
)

test('the pdf fixture builder uses the same jpeg bytes as the shared raster fixture', () => {
  /*
   * `pdf-fixture.ts` inlines this JPEG rather than importing it, because Node
   * loads that module directly (`scripts/document-parser-fixtures.mjs`) and its
   * ESM resolver needs an explicit extension that TypeScript will not accept
   * without `allowImportingTsExtensions` project-wide. This is what stops the
   * two copies drifting.
   */
  expect(PDF_FIXTURE_JPEG).toEqual(RASTER_FIXTURES.jpeg.bytes)
})
