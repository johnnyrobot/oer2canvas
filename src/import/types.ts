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
