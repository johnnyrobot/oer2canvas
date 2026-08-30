# Decide and gate spreadsheet imports — implementation plan

**Goal:** Record the spreadsheet decision as code that fails when the decision goes stale —
four `probe-only` capability entries with accurate explanations, an evaluation corpus, and a
browser test that pins every measured fact against the real parser.

**Architecture:** No import path is added and no existing one changes.
`document.ts`'s `enabledCapabilityFor` already refuses any capability whose
`status !== 'enabled'`, so the four new entries are refused by existing code the moment
they exist. The work is a corpus, an evidence test, and truthful prose.

**Tech Stack:** TypeScript, Vitest (jsdom `unit` + Chromium `browser` projects). No new
runtime dependency.

**Spec:** [`16-decide-spreadsheet-imports-design.md`](16-decide-spreadsheet-imports-design.md)
— read its `## Measured facts` section first. Nineteen facts are measured against anydoc
0.2.4 on 2026-08-30; **do not re-derive them.**

**Issue:** [`issues/16-decide-spreadsheet-imports.md`](issues/16-decide-spreadsheet-imports.md)

## Global constraints

- **This issue enables nothing.** If a task appears to need `status: 'enabled'`, stop.
- **Nothing from a real user file may enter this repository.** The design's real-file facts
  are aggregate counts taken from the operator's own documents. Every committed fixture is
  synthetic or LibreOffice-written from a synthetic source.
- **Keep the footprint on `capability.ts`, `capability.test.ts` and `README.md` small and
  contiguous.** A sibling agent is editing the same files for issue 15 and a human will
  merge by hand. `document.ts`, `released-sources.ts` (beyond one comment) and
  `testing/corpus.ts` are deliberately NOT touched — see design, "What this issue therefore
  builds".
- **Every number is read from an existing constant or justified in a comment**, and every
  cited measurement carries its date (2026-08-30).
- **A test that asserts "does not crash" documents nothing.** Every assertion names the fact
  it pins and the design fact number it comes from.
- **Run `npm run typecheck && npx vitest run` before every commit.** Two pre-existing
  intermittent flakes live in `src/components/DocumentImporter.browser.test.tsx` and
  `src/components/TextContentImporter.test.tsx` — rerun and say so; do NOT "fix" them.

## File structure

| File | Responsibility |
| --- | --- |
| `src/import/testing/spreadsheet-fixtures.ts` (new) | XLSX/ODS/CSV builders and the evaluation corpus. |
| `src/import/spreadsheet-evidence.browser.test.ts` (new) | Drives each fixture through the real parser and the real audit; pins every measured fact. |
| `src/import/capability.ts` | Four `probe-only` entries: `xlsx` (with `.xlsm`), `xls`, `ods`, `csv`. |
| `src/import/capability.test.ts` | The pinned probe-only set stops being `[]`. |
| `src/import/released-sources.ts` | One comment: spreadsheets are absent on purpose. |
| `src/components/DocumentImporter.tsx` | A probe-only format's note reads as unavailable, not as a limitation. |
| `src/components/DocumentImporter.browser.test.tsx` | That wording, asserted. |
| `README.md` | One row per spreadsheet format in the capability table. |

---

### Task 1: The evaluation corpus

**Files:** create `src/import/testing/spreadsheet-fixtures.ts`.

Covers the issue's first criterion in full: multiple worksheets, headings, merged cells,
formulas, hidden content, sparse ranges, and large tables — plus the security constructs the
fourth criterion names.

- [ ] Write `buildXlsx(sheets, options)` and `buildOds(sheets)` over `writeZip` from
      `engine/export/zip.ts`, following `presentation-fixtures.ts`'s shape (a `@ts-expect-error`
      `.ts` import, because these are shared browser/Node fixtures).
- [ ] Export `SPREADSHEET_EVALUATION_CASES`, each with a required `standsInFor`, covering:
      two worksheets; a single worksheet (fact 5); a two-row merged group header (facts 6, 7);
      a sparse range starting at C5 (fact 10); formulas with a cached value, without one, and
      with a cached error (facts 11, 12); a hidden sheet, row and column in XLSX (fact 14);
      the same three in ODS (fact 14); an embedded PNG behind a drawing (fact 9); a
      `vbaProject.bin` (fact 15); an external workbook reference (fact 15); a cell comment
      (fact 15); two logical tables separated by a blank row (fact 13); a CSV with a title
      line above its header (fact 16); a CSV with ragged rows (fact 16).
- [ ] A `largeButLegalXlsx()` builder for fact 19, generated rather than committed as bytes.

**Verify:** `npx vitest run --project unit` still green (the new module has no test yet).

**Commit:** `test: build the spreadsheet evaluation corpus this decision rests on`

---

### Task 2: The evidence test

**Files:** create `src/import/spreadsheet-evidence.browser.test.ts`.

- [ ] Drive each case through `probeParser({ parser: 'anydoc', bytes, formatHint })` —
      NOT `importStructuredDocument`, which correctly refuses a disabled format.
- [ ] Assert per case: `detectedFormat`, the block outline (heading present or absent),
      each table's `headerRows`, its row widths, and the absence of assets and findings
      where the design measured absence.
- [ ] Assert the ODS leak DIRECTLY: the hidden sheet's name and its hidden cell text are
      both present in `normalized.html`, and absent from the XLSX built from the same source.
      A test that only checked XLSX would pass while the leak stood.
- [ ] For the merged-group-header case and the ragged-CSV case, run
      `compileAndAuditChapter(toChapter(...), { profile: DOCUMENT })` and assert the table is
      queued AND that answering it is refused with the `TABLE_REFUSAL` prefix — this is the
      accessibility verdict, checked against `engine/compile/steps/tables.ts` rather than
      asserted in prose.
- [ ] Fact 19's resource case asserts the two anydoc ceilings by their own error text
      (`max_xml_nodes`, `max_grid_slots`) rather than by timing, which is not stable in CI.

**Verify:** `npx vitest run --project browser src/import/spreadsheet-evidence.browser.test.ts`

**Commit:** `test: pin what a spreadsheet actually becomes, against the real parser`

---

### Task 3: Four probe-only capability entries

**Files:** `src/import/capability.ts`, `src/import/capability.test.ts`,
`src/import/released-sources.ts`.

- [ ] Append four entries AFTER `odp`, as one contiguous block, each carrying the format's
      own reason in `limitations` — written for an instructor, naming what would go wrong
      rather than citing this design.
- [ ] `xlsx` carries `.xlsx` and `.xlsm` (fact 1 measured both reporting `xlsx`); `xls`
      carries `.xls` alone with a comment that its content ALSO reports `xlsx` (fact 2), so
      the entry exists to name the extension in the picker, not to route a parse.
- [ ] `capability.test.ts`: change the pinned probe-only set from `[]` to the four formats
      and rewrite the comment above it to say why they are parked.
- [ ] `released-sources.ts`: four lines of comment before the `web` entry recording that
      spreadsheets are deliberately absent and where the evidence is.

**Verify:** `npx vitest run --project unit src/import/capability.test.ts src/import/released-sources.test.ts`

**Commit:** `feat: park the four spreadsheet formats as probe-only, with their reasons`

---

### Task 4: Say so in the picker

**Files:** `src/components/DocumentImporter.tsx`,
`src/components/DocumentImporter.browser.test.tsx`.

A user who force-selects a `.xlsx` currently sees `Excel workbook limitation: …` and then a
generic refusal on submit. One line makes the note read as unavailability.

- [ ] Label the note by status: `limitation` when enabled, `— not available in this release`
      when not.
- [ ] Assert it for one spreadsheet extension.

**Verify:** `npx vitest run --project browser src/components/DocumentImporter.browser.test.tsx`

**Commit:** `fix: tell a user a spreadsheet is unavailable before they submit it`

---

### Task 5: Documentation, and close the issue

**Files:** `README.md`, `.scratch/document-import/issues/16-decide-spreadsheet-imports.md`,
`.scratch/document-import/map.md`.

- [ ] One README capability-table row per spreadsheet format, stating "not imported" and the
      reason in a clause.
- [ ] Append the `## Answer`: the verdict per format, the measurement behind each, which
      criteria are closed and which are not, and the residuals. Tick only what was verified.
- [ ] `Status: resolved`; update the map's row and frontier.

**Verify:** `npm run typecheck && npx vitest run && npm run build`

**Commit:** `docs: record the spreadsheet verdict, and why a tracer would not rescue it`
