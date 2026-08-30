import { DOCUMENT_FORMAT_CAPABILITIES } from './capability'
import { DOCUMENT_IMPORT_LIMITS } from './limits'
import { MAX_TEXT_IMPORT_BYTES } from './text'
import type { ImportedFormat } from './types'

/**
 * Everything this release can import, as one list.
 *
 * A SIBLING of `DOCUMENT_FORMAT_CAPABILITIES`, not a replacement and not a new
 * row in it. That table is a file-format table: `DOCUMENT_FILE_ACCEPT` turns its
 * extensions and media types into a file picker's `accept` string, and URL
 * acquisition has neither an extension nor a media type. Putting `web` in it
 * would hand the picker an entry it cannot express.
 *
 * The file entries below are WRITTEN OUT BY HAND rather than filtered from
 * `DOCUMENT_FORMAT_CAPABILITIES` by `status === 'enabled'`. Deriving them from
 * the table would make `released-sources.test.ts`'s reconciliation checks
 * tautological: they would compare the capability table's enabled formats
 * against a list computed BY filtering the capability table for enabled
 * formats, which cannot ever disagree with itself. That defeats the point of
 * criterion 1, which is that the published capability table is checked
 * against an INDEPENDENT statement of what this release actually shipped.
 *
 * Concretely, this literal list is what a later engineer's mistake — flipping
 * a capability's `status` to `'enabled'` to unblock some unrelated change,
 * without adding test coverage or a release note for the newly-exposed format
 * — is caught by. With a hand-typed list, that flip makes `enabled` grow past
 * `released` and the reconciliation test in `released-sources.test.ts` fails.
 * With a derived list, the same mistake sails through silently because both
 * sides of the comparison moved together.
 */
export interface ReleasedSource {
  format: ImportedFormat
  kind: 'file' | 'url'
  label: string
  /** The ceiling a user actually meets, from an existing constant. */
  maximumBytes: number
  limitations: readonly string[]
}

/** Looks up label/limitations prose from the capability table for a format known to be there. */
function capabilityFor(format: ImportedFormat) {
  const entry = DOCUMENT_FORMAT_CAPABILITIES.find((candidate) => candidate.format === format)
  if (!entry) {
    throw new Error(`released-sources.ts declares '${format}' but DOCUMENT_FORMAT_CAPABILITIES has no entry for it`)
  }
  return entry
}

export const RELEASED_SOURCES: readonly ReleasedSource[] = [
  // Native parser (main thread): text, markdown, html. Bounded by the same
  // 2 MiB ceiling as a pasted import, because that is the sanitizer both paths
  // run through — see MAX_TEXT_IMPORT_BYTES in ./text.ts.
  {
    format: 'text',
    kind: 'file',
    label: capabilityFor('text').label,
    maximumBytes: MAX_TEXT_IMPORT_BYTES,
    limitations: capabilityFor('text').limitations,
  },
  {
    format: 'markdown',
    kind: 'file',
    label: capabilityFor('markdown').label,
    maximumBytes: MAX_TEXT_IMPORT_BYTES,
    limitations: capabilityFor('markdown').limitations,
  },
  {
    format: 'html',
    kind: 'file',
    label: capabilityFor('html').label,
    maximumBytes: MAX_TEXT_IMPORT_BYTES,
    limitations: capabilityFor('html').limitations,
  },
  // Worker-hosted parser ("anydoc" and pdf-inspector): docx, odt, rtf, epub,
  // pdf. Bounded by DOCUMENT_IMPORT_LIMITS.maximumInputBytes, the 16 MiB input
  // ceiling both parser probes enforce before they touch the file — see
  // src/import/document.ts and src/import/pdf.ts.
  {
    format: 'docx',
    kind: 'file',
    label: capabilityFor('docx').label,
    maximumBytes: DOCUMENT_IMPORT_LIMITS.maximumInputBytes,
    limitations: capabilityFor('docx').limitations,
  },
  {
    format: 'odt',
    kind: 'file',
    label: capabilityFor('odt').label,
    maximumBytes: DOCUMENT_IMPORT_LIMITS.maximumInputBytes,
    limitations: capabilityFor('odt').limitations,
  },
  {
    format: 'rtf',
    kind: 'file',
    label: capabilityFor('rtf').label,
    maximumBytes: DOCUMENT_IMPORT_LIMITS.maximumInputBytes,
    limitations: capabilityFor('rtf').limitations,
  },
  {
    format: 'epub',
    kind: 'file',
    label: capabilityFor('epub').label,
    maximumBytes: DOCUMENT_IMPORT_LIMITS.maximumInputBytes,
    limitations: capabilityFor('epub').limitations,
  },
  {
    format: 'pdf',
    kind: 'file',
    label: capabilityFor('pdf').label,
    maximumBytes: DOCUMENT_IMPORT_LIMITS.maximumInputBytes,
    limitations: capabilityFor('pdf').limitations,
  },
  // Both presentation formats graduated under issue 14's bar — PPTX on the
  // first pass, ODP only after the index learned to read `META-INF/manifest.xml`
  // and so to name an embedded chart or diagram. The `.pptm`/`.ppsx`/`.ppsm`
  // containers ride on the PPTX row: fact 1 measured all four reporting `pptx`
  // from their own content type, so they are one capability entry and one
  // released source, not four.
  {
    format: 'pptx',
    kind: 'file',
    label: capabilityFor('pptx').label,
    maximumBytes: DOCUMENT_IMPORT_LIMITS.maximumInputBytes,
    limitations: capabilityFor('pptx').limitations,
  },
  {
    format: 'odp',
    kind: 'file',
    label: capabilityFor('odp').label,
    maximumBytes: DOCUMENT_IMPORT_LIMITS.maximumInputBytes,
    limitations: capabilityFor('odp').limitations,
  },
  // The legacy OLE2 formats have NO row here, and their absence is a decision
  // rather than an omission. Issue 15 measured `.doc` and `.ppt` against real
  // anydoc 0.2.4 on 2026-08-30 and disabled both — a legacy Word file can drop
  // text-box content and publish tracked-change deletions with no finding
  // either way, and a legacy deck loses every picture and publishes the
  // presenter's speaker notes. They sit in `DOCUMENT_FORMAT_CAPABILITIES` as
  // `probe-only`, which `releaseEnabledFormats()` filters out, so the
  // reconciliation test in `released-sources.test.ts` stays satisfied without a
  // row being added or removed here.
  {
    format: 'web',
    kind: 'url',
    label: 'Web page',
    // The extracted Markdown reaches the same main-thread sanitizer as a pasted
    // Markdown import, so it is bounded by the same constant.
    maximumBytes: MAX_TEXT_IMPORT_BYTES,
    limitations: [
      'Requires your own Firecrawl account and API key; each import costs one Firecrawl credit.',
      'One address becomes one page, and no links are followed.',
      'Images are marked in place but not imported, and block preparation.',
      'A PDF address is refused; import it from the Document tab instead.',
    ],
  },
]
