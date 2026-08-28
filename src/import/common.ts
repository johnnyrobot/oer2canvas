import { RIGHTS_AUTHORITIES, type ImportMetadata, type ImportProvenance } from './types'

export const MISSING_RIGHTS_MESSAGE = 'Choose why you have permission to republish this content.'
const IP_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$|^\[?[0-9a-f:]+\]?$/i

function isPrivateHostname(host: string): boolean {
  if (!host.includes('.')) return true
  if (
    host.endsWith('.corp')
    || host.endsWith('.lan')
    || host.endsWith('.home')
    || host.endsWith('.test')
    || host.endsWith('.intranet')
    || host.endsWith('.private')
    || host === 'home.arpa'
    || host.endsWith('.home.arpa')
  ) return true
  return /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)
}

export function isPublicNetworkUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return (url.protocol === 'https:' || url.protocol === 'http:')
    && url.username === ''
    && url.password === ''
    && !isPrivateHostname(host)
    && !IP_LITERAL.test(host)
}

export function requireRightsAuthority(value: unknown): asserts value is ImportMetadata['rightsAuthority'] {
  if (!RIGHTS_AUTHORITIES.some((authority) => authority === value)) {
    throw new Error(MISSING_RIGHTS_MESSAGE)
  }
}

export function validateImportMetadata(metadata: ImportMetadata): void {
  if (!metadata.title.trim()) throw new Error('Enter a document title before creating the preview.')
  requireRightsAuthority(metadata.rightsAuthority)
  if (!metadata.rightsAcknowledged) {
    throw new Error('Confirm responsibility for rights and the final accessibility review.')
  }
  if (metadata.licenseUrl?.trim() && !metadata.licenseName?.trim()) {
    throw new Error('Enter a license name when you provide a license URL.')
  }
  parsePublicSourceUrl(metadata.sourceUrl)
}

export function parsePublicSourceUrl(value: string | undefined): URL | undefined {
  const source = value?.trim()
  if (!source) return undefined
  try {
    const url = new URL(source)
    if (url.protocol !== 'https:' || !isPublicNetworkUrl(url)) throw new Error('not public HTTPS')
    return url
  } catch {
    throw new Error('Enter a valid HTTPS public source URL.')
  }
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const owned = bytes instanceof ArrayBuffer ? bytes : bytes.slice().buffer
  const digest = await globalThis.crypto.subtle.digest('SHA-256', owned)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function documentIds(sourceSha256: string): { id: string; sectionId: string } {
  const id = `document-${sourceSha256.slice(0, 24)}`
  return { id, sectionId: `${id}-page-1` }
}

export function importProvenance(
  metadata: ImportMetadata,
  source: { kind: ImportProvenance['kind']; originalName?: string },
): ImportProvenance {
  const author = metadata.author?.trim()
  const sourceName = metadata.sourceName?.trim()
  const sourceUrl = metadata.sourceUrl?.trim()
  const licenseName = metadata.licenseName?.trim()
  const licenseUrl = metadata.licenseUrl?.trim()
  return {
    kind: source.kind,
    ...(source.originalName ? { originalName: source.originalName } : {}),
    ...(author ? { author } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(licenseName ? { license: { name: licenseName, ...(licenseUrl ? { url: licenseUrl } : {}) } } : {}),
    rights: {
      authority: metadata.rightsAuthority,
      acknowledged: metadata.rightsAcknowledged,
    },
  }
}
