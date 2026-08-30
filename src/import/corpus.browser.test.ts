import { CORPUS_CASES } from './testing/corpus'
import { importCorpusCase } from './testing/import-corpus-case'

/**
 * Runs every corpus case through the SAME parser dispatch the app uses, in a
 * real browser (real WASM, not jsdom) — this is what makes "corpus-tested"
 * in the capability table's supporting evidence true rather than aspirational.
 *
 * The routing itself — capability's PARSER, not `format === 'pdf'` — lives in
 * `importCorpusCase` (`testing/import-corpus-case.ts`), which this file wrote
 * first; see that module's comment for the full reasoning. It is reused
 * as-is by `cartridge-artifact.browser.test.ts` rather than re-derived there.
 */
const metadata = {
  title: 'Corpus case',
  rightsAuthority: 'own' as const,
  rightsAcknowledged: true,
}

test.each(CORPUS_CASES)('$id imports and keeps the structure it stands in for', async (entry) => {
  const imported = await importCorpusCase(entry, metadata)

  expect(imported.work.sections).toHaveLength(1)
  const html = imported.work.sections[0]!.html
  for (const fragment of entry.expectInHtml) {
    expect(html, `${entry.id} lost ${fragment}`).toContain(fragment)
  }
  // `expectInHtml` can only prove presence. The speaker-notes cases exist
  // precisely to prove an ABSENCE — that the author's private notes did not
  // reach the page — and a case that only asserted `expectInHtml` would pass
  // while still leaking the note.
  for (const fragment of entry.expectNotInHtml ?? []) {
    expect(html, `${entry.id} leaked ${fragment}`).not.toContain(fragment)
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

  // The exact set of `warning`-severity codes, asserted the same way as the
  // blocker set above and for the same reason: `expectBlockers` alone left
  // `presentation-unrepresentable` (and every other warning) unchecked by this
  // corpus — fix-review round 1 proved that gap by deleting the finding from
  // `reconcile.ts` and watching this suite stay green. Checking both
  // directions matters here too: an unexpected warning means this release
  // makes a claim its own findings contradict, and an expected warning that
  // stops appearing means a construct this corpus exists to prove "produces a
  // specific finding" (the issue's fourth acceptance criterion) quietly
  // stopped doing so.
  const warningCodes = imported.report.findings
    .filter((finding) => finding.severity === 'warning')
    .map((finding) => finding.code)
    .sort()
  expect(warningCodes, `${entry.id} warning codes`).toEqual([...(entry.expectFindings ?? [])].sort())
})
