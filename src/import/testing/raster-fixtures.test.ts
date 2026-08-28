import { ASSETS } from '../../../scripts/canvas-image-probes.mjs'
import { RASTER_FIXTURES } from './raster-fixtures'

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
