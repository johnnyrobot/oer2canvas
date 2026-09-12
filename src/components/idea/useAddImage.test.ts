import { act, renderHook } from '@testing-library/react'
import { useAddImage } from './useAddImage'
import type { ImageHit } from '../../engine/idea/images/search'

// A 1x1 PNG. `prepareAssets` sniffs the signature and reads the size from IHDR.
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3, 253, 99, 38, 229, 120, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
const hit: ImageHit = { provider: 'commons', id: 'File:Dot.png', title: 'Dot', thumbUrl: 't', fullUrl: 'https://upload.wikimedia.org/dot.png', width: 1, height: 1, mediaType: 'image/png', license: { kind: 'by', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, creator: 'A', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Dot.png' }
const request = { chapterKey: 'ch', sectionId: 's1', hit, placement: { kind: 'insert-after' as const, elementId: 'b2c-blk-0' }, alt: 'A single dot.', caption: '' }

test('fetches, prepares, reports the asset, then the edit keyed by the asset name', async () => {
  const fetch = vi.fn(async () => new Response(PNG, { status: 200 }))
  const onAsset = vi.fn()
  const onEdit = vi.fn()
  const { result } = renderHook(() => useAddImage({ onAsset, onEdit, deps: { fetch } }))
  let ok: boolean | undefined
  await act(async () => { ok = await result.current.add(request) })
  expect(ok).toBe(true)
  expect(onAsset).toHaveBeenCalledTimes(1)
  const [ck, asset] = onAsset.mock.calls[0]!
  expect(ck).toBe('ch')
  expect(asset).toMatchObject({ mediaType: 'image/png', extension: 'png', originPart: 'idea/commons/Dot.png' })
  expect(asset.name).toMatch(/^dot-[0-9a-f]{8}\.png$/)
  expect(asset.bytes.byteLength).toBe(PNG.byteLength)
  expect(onEdit).toHaveBeenCalledTimes(1)
  const [, key, edit] = onEdit.mock.calls[0]!
  expect(key).toBe(`s1::image::0::${asset.name}`)
  expect(edit).toMatchObject({ kind: 'image', assetName: asset.name, width: 1, height: 1, alt: 'A single dot.', caption: '', attribution: { text: '“Dot” by A, Wikimedia Commons, CC BY 4.0', licenseName: 'CC BY 4.0', licenseUrl: hit.license.url, shareAlike: false, sourcePageUrl: hit.sourcePageUrl } })
  expect(onAsset.mock.invocationCallOrder[0]!).toBeLessThan(onEdit.mock.invocationCallOrder[0]!)
  expect(result.current.error).toBe('')
})

test('an unfetchable image reports the host message and adds nothing', async () => {
  const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
  const onAsset = vi.fn()
  const { result } = renderHook(() => useAddImage({ onAsset, onEdit: vi.fn(), deps: { fetch } }))
  let ok: boolean | undefined
  await act(async () => { ok = await result.current.add(request) })
  expect(ok).toBe(false)
  expect(result.current.error).toMatch(/upload\.wikimedia\.org/)
  expect(onAsset).not.toHaveBeenCalled()
})

test('a byte stream that is not a raster is refused', async () => {
  const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }))
  const onAsset = vi.fn()
  const { result } = renderHook(() => useAddImage({ onAsset, onEdit: vi.fn(), deps: { fetch } }))
  await act(async () => { await result.current.add(request) })
  expect(result.current.error).toMatch(/not an image this app can package/)
  expect(onAsset).not.toHaveBeenCalled()
})
