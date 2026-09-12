/**
 * Choose → fetch → prepare → asset → edit. The asset is reported BEFORE the
 * edit, so that by the time the recompile emits the packaged reference, the
 * chapter's asset list can resolve it for the preview and the exporter.
 *
 * The bytes go through `prepareAssets`, the same sniff/hash/name path every
 * imported image takes: the provider's declared type is not trusted, the
 * size is read from the header, and the archive name is content-addressed.
 */
import { useCallback, useState } from 'react'
import { prepareAssets } from '../../import/assets'
import type { ImportedAsset } from '../../import/types'
import { fetchImageBytes } from '../../engine/idea/images/fetch-image'
import { tasl, type ImageHit } from '../../engine/idea/images/search'
import { imageEditKey, type ImageEdit, type ImagePlacement } from '../../engine/idea/edits'

export interface AddImageRequest {
  chapterKey: string
  sectionId: string
  hit: ImageHit
  placement: ImagePlacement
  alt: string
  caption: string
}

const REFUSAL: Record<string, string> = {
  'unsupported-type': 'That file is not an image this app can package (PNG, JPEG, GIF, WebP).',
  'too-large': 'That image is larger than the cartridge budget allows.',
  'too-many-pixels': 'That image would decode to more pixels than the cartridge budget allows.',
}

export function useAddImage({ onAsset, onEdit, deps = {} }: {
  onAsset: (chapterKey: string, asset: ImportedAsset) => void
  onEdit: (chapterKey: string, key: string, edit: ImageEdit) => void
  deps?: { fetch?: typeof globalThis.fetch }
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fetchImpl = deps.fetch

  /** Resolves true when the image was added, false when the error state says why not. */
  const add = useCallback(async (r: AddImageRequest): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      const bytes = await fetchImageBytes(r.hit, fetchImpl ?? globalThis.fetch)
      // The archive name is slugged from the origin's basename; Commons ids
      // carry a `File:` namespace prefix that would otherwise lead every name.
      const originPart = `idea/${r.hit.provider}/${r.hit.id.replace(/^File:/, '')}`
      const prepared = (await prepareAssets([{ id: 1, mediaType: r.hit.mediaType ?? 'application/octet-stream', originPart, data: bytes }])).get(1)
      if (!prepared || 'rejected' in prepared) {
        const why = prepared && 'rejected' in prepared ? prepared.rejected : 'unavailable'
        throw new Error(REFUSAL[why] ?? 'That image could not be prepared.')
      }
      const asset: ImportedAsset = {
        id: `idea-${prepared.sha256.slice(0, 12)}`, mediaType: prepared.mediaType, extension: prepared.extension,
        bytes: prepared.bytes, sha256: prepared.sha256, originPart, name: prepared.name,
      }
      onAsset(r.chapterKey, asset)
      const credit = tasl(r.hit)
      const edit: ImageEdit = {
        kind: 'image', placement: r.placement, assetName: prepared.name, width: prepared.width, height: prepared.height,
        alt: r.alt, caption: r.caption,
        attribution: {
          text: credit.text, sourcePageUrl: r.hit.sourcePageUrl, licenseName: r.hit.license.name,
          ...(r.hit.license.url ? { licenseUrl: r.hit.license.url } : {}), shareAlike: credit.shareAlike,
        },
      }
      onEdit(r.chapterKey, imageEditKey(r.sectionId, prepared.name), edit)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [onAsset, onEdit, fetchImpl])

  return { add, busy, error }
}
