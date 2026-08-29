import { CORPUS_CASES } from './testing/corpus'
import { importStructuredDocument } from './document'
import { importPdfDocument } from './pdf'
import { importText } from './text'
import { capabilityForFormat } from './capability'
import type { ImportResult } from './types'

/**
 * Runs every corpus case through the SAME parser dispatch the app uses, in a
 * real browser (real WASM, not jsdom) — this is what makes "corpus-tested"
 * in the capability table's supporting evidence true rather than aspirational.
 *
 * Routed on the capability's PARSER, exactly as `DocumentImporter.tsx` and
 * `TextContentImporter.tsx` do it, rather than on `format === 'pdf'`:
 * `importStructuredDocument`'s `enabledCapabilityFor` (`document.ts`) rejects
 * any capability whose `parser` is not `'anydoc'`, so text, markdown, and html
 * — all `parser: 'native'` in `DOCUMENT_FORMAT_CAPABILITIES` (`capability.ts`)
 * — would throw if routed there. `TextContentImporter.tsx` sends those three to
 * `importText` instead, and `DocumentImporter.tsx` peels off `pdf-inspector`
 * before falling through to `importStructuredDocument` for the remaining
 * `anydoc` formats. This test mirrors that three-way split.
 */
const metadata = {
  title: 'Corpus case',
  rightsAuthority: 'own' as const,
  rightsAcknowledged: true,
}

test.each(CORPUS_CASES)('$id imports and keeps the structure it stands in for', async (entry) => {
  const capability = capabilityForFormat(entry.format)!
  // The filename extension has to be the one `capabilityForFilename` actually
  // recognizes for this format, taken from the capability's own `extensions`
  // list rather than reconstructed from `entry.format` — the two disagree for
  // `text`, whose capability extension is `.txt`, not `.text`.
  // `importText`'s file variant (`formatOf` in `text.ts`) and
  // `importStructuredDocument`'s `enabledCapabilityFor` (`document.ts`) both
  // derive format from this extension, so getting it wrong would make the
  // import fail before this case ever reached its parser.
  const file = new File([await entry.bytes()], `corpus${capability.extensions[0]}`, {
    type: capability.mediaTypes[0]!,
  })
  const imported: ImportResult = capability.parser === 'native'
    ? await importText({ kind: 'file', file }, { metadata })
    : capability.parser === 'pdf-inspector'
      ? await importPdfDocument(file, { metadata })
      : await importStructuredDocument(file, { metadata })

  expect(imported.work.sections).toHaveLength(1)
  const html = imported.work.sections[0]!.html
  for (const fragment of entry.expectInHtml) {
    expect(html, `${entry.id} lost ${fragment}`).toContain(fragment)
  }

  // Assert the EXACT set of blocker codes this case produces, not merely
  // "no blockers anywhere": `docx-footnote`, `docx-equation`, and
  // `epub-equation` legitimately block (verified against anydoc 0.2.4 — see
  // `expectBlockers` on each case in `testing/corpus.ts`), so a blanket
  // "nothing blocks" assertion would be false for this corpus. Checking both
  // directions matters: an unexpected blocker means this release claims
  // support it cannot actually publish, and an expected blocker that stops
  // appearing means the corpus's own record of what a format cannot publish
  // has gone stale.
  const blockerCodes = imported.report.findings
    .filter((finding) => finding.severity === 'blocker')
    .map((finding) => finding.code)
    .sort()
  expect(blockerCodes, `${entry.id} blocker codes`).toEqual([...(entry.expectBlockers ?? [])].sort())
})
