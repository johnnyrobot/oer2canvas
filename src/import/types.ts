export type ImportedFormat =
  | 'pdf' | 'epub' | 'doc' | 'docx' | 'odt' | 'rtf'
  | 'ppt' | 'pptx' | 'odp'
  | 'xls' | 'xlsx' | 'ods' | 'csv'
  | 'text' | 'markdown' | 'html' | 'web'

export const RIGHTS_AUTHORITIES = ['own', 'permission', 'open-license', 'public-domain'] as const
export type RightsAuthority = typeof RIGHTS_AUTHORITIES[number]

export interface ImportMetadata {
  title: string
  author?: string
  sourceName?: string
  sourceUrl?: string
  licenseName?: string
  licenseUrl?: string
  rightsAuthority: RightsAuthority
  rightsAcknowledged: boolean
}

export interface ImportProvenance {
  kind: 'paste' | 'local-file' | 'web'
  originalName?: string
  author?: string
  sourceName?: string
  sourceUrl?: string
  license?: { name: string; url?: string }
  rights: { authority: RightsAuthority; acknowledged: boolean }
}

export interface ImportedSection {
  id: string
  title: string
  order: number
  html: string
}

export interface ImportedAsset {
  id: string
  mediaType: string
  extension: string
  bytes: Uint8Array
  sha256: string
  originPart?: string
  /**
   * The packaged archive filename (e.g. `image1-a3f91c2e.png`), assigned once
   * at import by `prepareAssets` (src/import/assets.ts). Content-identical
   * assets share one `name` even when their `originPart`s differ, because
   * `originPart` records where THIS occurrence came from while `name` records
   * the ONE archive entry all occurrences of that content resolve to.
   * Consumers must use this field as-is rather than recomputing it from
   * `originPart` via `packagedAssetName` — recomputing from a non-winning
   * occurrence's `originPart` would produce a name that does not match the
   * archive entry actually referenced elsewhere.
   */
  name: string
}

export interface ImportedWork {
  id: string
  title: string
  format: ImportedFormat
  sections: ImportedSection[]
  assets: ImportedAsset[]
  provenance: ImportProvenance
}

export type ImportFindingSeverity = 'warning' | 'blocker'

export interface ImportFinding {
  code: string
  severity: ImportFindingSeverity
  message: string
  sectionId?: string
  sourcePage?: number
}

export interface ImportReport {
  parser: 'native' | 'anydoc' | 'pdf-inspector' | 'firecrawl'
  parserVersion?: string
  format: ImportedFormat
  originalName?: string
  originalBytes?: number
  sourceUrl?: string
  sourceSha256?: string
  pageCount?: number
  findings: ImportFinding[]
  counts: {
    sections: number
    headings: number
    tables: number
    images: number
    equations: number
    notes: number
    unavailableAssets: number
  }
}

export interface ImportResult {
  work: ImportedWork
  report: ImportReport
}
