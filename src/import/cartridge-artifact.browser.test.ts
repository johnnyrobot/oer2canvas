import { commands } from 'vitest/browser'
import { releaseEnabledFormats } from './capability'
import { CORPUS_CASES, type CorpusCase } from './testing/corpus'
import { importCorpusCase } from './testing/import-corpus-case'
import { cartridgeArtifactPath } from './testing/cartridge-artifact-paths'
import { toBase64 } from './testing/base64'
import { createImportDraft } from '../components/ImportPlanEditor'
import { confirmImport } from './page-plan'
import { toChapter } from './to-chapter'
import { compileAndAuditChapter } from '../engine'
import { DOCUMENT } from '../engine/compile/context'
import { buildCartridge } from '../engine/export/cartridge'
import { writeZip } from '../engine/export/zip'

/**
 * Half of a deliberate two-file split — see `cartridge-artifact.test.ts` for
 * the other half and why the split exists at all.
 *
 * THIS file drives the real pipeline (real WASM anydoc/pdf-inspector parsers,
 * the real compile+audit gate with no `deps` override, and the real
 * `buildCartridge`+`writeZip` pair `download.ts` uses) because that pipeline
 * only runs where a real browser does — `unit` is jsdom, and jsdom has no WASM
 * runtime and no layout for the audit's iframe to measure. It proves
 * DETERMINISM (building the same source twice must produce byte-identical
 * output) and then hands the bytes to disk for a REAL, third-party `unzip` to
 * judge — this file's own `expect` calls are never allowed to be the last word
 * on whether the archive itself is well-formed, for the same reason
 * `zip.test.ts` gives: a zip verified only by its own writer is marking its
 * own homework.
 *
 * ONE CASE PER RELEASED FORMAT (eight), NOT THE WHOLE CORPUS (twenty) — the
 * cartridge builder in `engine/export/cartridge.ts` is format-agnostic
 * downstream of import: by the time `toChapter` hands it a `Chapter`, every
 * format looks the same. Structural variants (merged cells, footnotes,
 * equations, deep headings, …) exercise the IMPORTER, which
 * `corpus.browser.test.ts` already runs across the full twenty-case corpus.
 * Running all twenty here, twice each for determinism, would be forty full
 * compile+audit+zip pipelines that could only ever re-confirm what that file
 * already confirms about parsing — nothing about cartridge shape depends on
 * which structural property a given DOCX or EPUB exercises.
 */
const metadata = {
  title: 'Artifact release check',
  rightsAuthority: 'own' as const,
  rightsAcknowledged: true,
}

/*
 * `CORPUS_CASES` (testing/corpus.ts) lists its per-format baseline case —
 * `*-semantic` for every format except PDF, whose baseline is
 * `pdf-text-multipage` — BEFORE any structural variant, and its own module
 * comment says so explicitly: "Every one of the eight released file formats
 * … gets its own semantic case" ahead of "Beyond that baseline, six
 * structural properties … are exercised on TWO formats only". Taking the
 * FIRST case seen for each format, rather than matching on an id suffix like
 * `-semantic`, is what makes this selection correct for PDF too without a
 * special case, and keeps this file from needing its own hard-coded id list
 * that could drift from the corpus's actual contents.
 */
const RELEASED_FORMAT_CASES: readonly CorpusCase[] = (() => {
  const seen = new Set<CorpusCase['format']>()
  return CORPUS_CASES.filter((entry) => {
    if (seen.has(entry.format)) return false
    seen.add(entry.format)
    return true
  })
})()

test('the corpus has exactly one baseline case per released format', () => {
  // Guards the dedup-by-first-occurrence above against `testing/corpus.ts`
  // changing shape out from under it — e.g. a new format landing after a
  // structural variant of an existing one, which would make "first occurrence"
  // pick the wrong case. `releaseEnabledFormats()` (`capability.ts`) is the
  // same independent statement of "the eight released formats" that
  // `released-sources.ts` is built against, not a value derived from this
  // corpus, so this comparison can actually fail.
  const released = new Set(releaseEnabledFormats())
  expect(new Set(RELEASED_FORMAT_CASES.map((entry) => entry.format))).toEqual(released)
  expect(RELEASED_FORMAT_CASES).toHaveLength(released.size)
})

async function cartridgeFor(entry: CorpusCase): Promise<Uint8Array> {
  const imported = await importCorpusCase(entry, metadata)
  const confirmed = confirmImport(imported, createImportDraft(imported).plan, metadata)
  const compiled = await compileAndAuditChapter(toChapter(confirmed.work), { profile: DOCUMENT })
  return new Uint8Array(await writeZip(buildCartridge([compiled])))
}

test.each(RELEASED_FORMAT_CASES)(
  '$format cartridge builds deterministically and is written for a real unzip to judge',
  async (entry) => {
    const [first, second] = [await cartridgeFor(entry), await cartridgeFor(entry)]
    /*
     * DETERMINISM. This is what makes re-importing the same document UPDATE
     * its Canvas pages instead of duplicating them: page identity derives
     * from the source content hash and structural position
     * (`engine/export/page-identity.ts`), so the same source has to produce
     * the same bytes on every export. If this assertion ever fails, that is a
     * genuine finding about the exporter — not something to relax — and the
     * failure message below is the diff between the two runs.
     */
    expect(Array.from(second), `${entry.id} did not build the same cartridge twice`).toEqual(Array.from(first))

    await commands.writeFile(cartridgeArtifactPath(entry.format), toBase64(first), { encoding: 'base64' })
  },
)
