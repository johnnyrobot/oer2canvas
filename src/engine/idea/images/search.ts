/**
 * The port both image providers implement, and the one licence set the app
 * will show. Anything outside `ALLOWED_LICENSES` never reaches a result grid:
 * a CC BY textbook page cannot carry an NC or ND image, and "unknown" is not a
 * licence.
 */
export type License = 'cc0' | 'by' | 'by-sa' | 'pd'

export const ALLOWED_LICENSES: readonly License[] = ['cc0', 'by', 'by-sa', 'pd']

export const LICENSE_LABEL: Readonly<Record<License, string>> = {
  cc0: 'CC0', by: 'CC BY', 'by-sa': 'CC BY-SA', pd: 'Public domain',
}

export type ImageProvider = 'commons' | 'openverse'

export interface ImageHit {
  provider: ImageProvider
  id: string
  title: string
  thumbUrl: string
  fullUrl: string
  width: number
  height: number
  mediaType?: string
  license: { kind: License; name: string; url?: string }
  creator?: string
  sourcePageUrl: string
}

export interface SearchOpts {
  licenses: readonly License[]
  page?: number
  signal?: AbortSignal
}

export interface ImageSearch {
  id: ImageProvider
  label: string
  /** Measured, not promised: from `evidence`. A provider not offered is listed but cannot be searched. */
  offered: boolean
  evidence: string
  search(query: string, opts: SearchOpts): Promise<ImageHit[]>
}

const SOURCE_LABEL: Record<ImageProvider, string> = { commons: 'Wikimedia Commons', openverse: 'via Openverse' }

/** Title · Author · Source · License, as one sentence. */
export function tasl(hit: ImageHit): { text: string; shareAlike: boolean } {
  const by = hit.creator ? ` by ${hit.creator}` : ''
  return {
    text: `“${hit.title}”${by}, ${SOURCE_LABEL[hit.provider]}, ${hit.license.name}`,
    shareAlike: hit.license.kind === 'by-sa',
  }
}
