import { capabilityForFormat } from '../capability'
import { importStructuredDocument } from '../document'
import { importPdfDocument } from '../pdf'
import { importText } from '../text'
import type { ImportMetadata, ImportResult } from '../types'
import type { CorpusCase } from './corpus'

/**
 * Runs one corpus case through the SAME parser dispatch the app uses.
 *
 * Extracted out of `corpus.browser.test.ts` (which wrote this three-way split
 * first) so that a second file needing it — `cartridge-artifact.browser.test.ts` —
 * reuses the exact routing instead of re-deriving it, which would risk the two
 * quietly drifting apart. Routed on the capability's PARSER, exactly as
 * `DocumentImporter.tsx` and `TextContentImporter.tsx` do it, rather than on
 * `format === 'pdf'`: `importStructuredDocument`'s `enabledCapabilityFor`
 * (`document.ts`) rejects any capability whose `parser` is not `'anydoc'`, so
 * text, markdown, and html — all `parser: 'native'` in
 * `DOCUMENT_FORMAT_CAPABILITIES` (`capability.ts`) — would throw if routed
 * there. `TextContentImporter.tsx` sends those three to `importText` instead,
 * and `DocumentImporter.tsx` peels off `pdf-inspector` before falling through
 * to `importStructuredDocument` for the remaining `anydoc` formats.
 */
export async function importCorpusCase(entry: CorpusCase, metadata: ImportMetadata): Promise<ImportResult> {
  const capability = capabilityForFormat(entry.format)!
  // The filename extension has to be the one `capabilityForFilename` actually
  // recognizes for this format, taken from the capability's own `extensions`
  // list rather than reconstructed from `entry.format` — the two disagree for
  // `text`, whose capability extension is `.txt`, not `.text`. `importText`'s
  // file variant (`formatOf` in `text.ts`) and `importStructuredDocument`'s
  // `enabledCapabilityFor` (`document.ts`) both derive format from this
  // extension, so getting it wrong would make the import fail before this
  // case ever reached its parser.
  const file = new File([await entry.bytes()], `corpus${capability.extensions[0]}`, {
    type: capability.mediaTypes[0]!,
  })
  return capability.parser === 'native'
    ? importText({ kind: 'file', file }, { metadata })
    : capability.parser === 'pdf-inspector'
      ? importPdfDocument(file, { metadata })
      : importStructuredDocument(file, { metadata })
}
