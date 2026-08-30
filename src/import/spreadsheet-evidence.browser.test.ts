import { probeParser } from './parsers/probe'
import { importStructuredDocument } from './document'
import { toChapter } from './to-chapter'
import { compileAndAuditChapter } from '../engine'
import { DOCUMENT } from '../engine/compile/context'
import { TABLE_REFUSAL } from '../engine/compile/steps/tables'
import { capabilityForFilename } from './capability'
import {
  SPREADSHEET_EVALUATION_CASES,
  buildXlsx,
  buildOds,
  largeButLegalXlsx,
} from './testing/spreadsheet-fixtures'

/**
 * Why issue 16 left spreadsheets disabled, pinned against the real parser.
 *
 * This suite asserts NOTHING about a feature, because there is no feature. It
 * exists so the decision recorded in
 * `.scratch/document-import/16-decide-spreadsheet-imports-design.md` cannot go
 * stale quietly: every assertion below is a measured fact from that design's
 * `## Measured facts`, taken 2026-08-30 against `@firecrawl/anydoc-wasm` 0.2.4.
 * The day the parser stops behaving this way, this file goes red and somebody
 * re-opens the question — which is the only mechanism that makes a "not yet"
 * decision safe to leave in place.
 *
 * It runs in the BROWSER project on purpose. anydoc is WASM in a real Worker,
 * and issue 14 learned four times over that confident reasoning about anydoc's
 * output is worth nothing next to running it.
 *
 * `probeParser` is called directly rather than `importStructuredDocument`,
 * which correctly refuses a disabled format — the last test in this file is
 * what proves it refuses.
 */

const caseNamed = (id: string) => {
  const entry = SPREADSHEET_EVALUATION_CASES.find((candidate) => candidate.id === id)
  if (!entry) throw new Error(`no spreadsheet evaluation case named '${id}'`)
  return entry
}

/** Parses a case exactly as the anydoc Worker would, hint and all. */
async function parse(id: string) {
  const entry = caseNamed(id)
  const bytes = await entry.bytes()
  const parsed = await probeParser({
    parser: 'anydoc',
    bytes: bytes.buffer,
    // `.xlsm` and `.csv` are not `Format` members; the Worker passes the
    // extension through `formatFromExtension`, which is what maps them.
    formatHint: entry.extension.slice(1),
  })
  return { entry, parsed }
}

const documentOf = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const tablesIn = (html: string) => [...documentOf(html).querySelectorAll('table')]
/** Every row's cell count, which is what a ragged grid disagrees about. */
const rowWidths = (table: Element) =>
  [...table.querySelectorAll('tr')].map((row) => row.querySelectorAll('th, td').length)

test('every evaluation case names the real-world property it stands in for', () => {
  const ids = SPREADSHEET_EVALUATION_CASES.map((entry) => entry.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const entry of SPREADSHEET_EVALUATION_CASES) {
    expect(entry.standsInFor.length, `${entry.id} standsInFor`).toBeGreaterThan(40)
  }
  // All four in-scope formats are covered. `.xls` is absent BY MEASUREMENT, not
  // by omission: design fact 2 found `formatFromBytes` reporting `xlsx` for all
  // 37 real legacy files on the measuring machine, so a `.xls` fixture would be
  // an `.xlsx` fixture wearing a different extension. The `xlsm` case pins that
  // same collapse on a container we can actually build.
  expect(new Set(SPREADSHEET_EVALUATION_CASES.map((entry) => entry.extension)))
    .toEqual(new Set(['.xlsx', '.xlsm', '.ods', '.csv']))
})

// ===== Worksheet identity (design facts 4, 5) =============================

test('a worksheet name reaches the page only when more than one sheet survives', async () => {
  const many = await parse('xlsx-two-worksheets')
  const manyDocument = documentOf(many.parsed.normalized!.html)
  expect([...manyDocument.querySelectorAll('h2')].map((heading) => heading.textContent))
    .toEqual(['Enrollment', 'Budget'])

  // The commonest workbook shape of all, and it arrives nameless.
  const one = await parse('xlsx-single-worksheet')
  const oneDocument = documentOf(one.parsed.normalized!.html)
  expect(oneDocument.querySelectorAll('h2')).toHaveLength(0)
  expect(oneDocument.querySelectorAll('table')).toHaveLength(1)
  expect(one.parsed.normalized!.html).not.toContain('Attendance')
})

// ===== The header row (design facts 6, 7) ================================

test('a merged group header produces a table with no header cell at all', async () => {
  const { parsed } = await parse('xlsx-merged-group-header')
  const table = tablesIn(parsed.normalized!.html)[0]!

  expect(table.querySelectorAll('th')).toHaveLength(0)
  expect(table.querySelector('thead')).toBeNull()
  // The header is genuinely there in the data — it just is not marked up.
  expect(table.textContent).toContain('Midterm')
  expect(table.querySelector('[rowspan="2"]')).not.toBeNull()
  expect(table.querySelector('[colspan="2"]')).not.toBeNull()
})

test('one blank corner cell turns the header off for a whole matrix table', async () => {
  const { parsed } = await parse('xlsx-blank-corner-header')
  const table = tablesIn(parsed.normalized!.html)[0]!

  expect(table.querySelectorAll('th')).toHaveLength(0)
  expect(table.textContent).toContain('Monday')
})

test('a data row that happens to be text is marked up as headers, silently', async () => {
  const { parsed } = await parse('xlsx-data-row-read-as-header')
  const table = tablesIn(parsed.normalized!.html)[0]!

  // The failure that has no downstream detector: three ordinary records, and
  // the first is announced to a screen reader as the labels for the other two.
  const headers = [...table.querySelectorAll('th')]
  expect(headers.map((cell) => cell.textContent)).toEqual(['Chapter one', 'Introductions'])
  expect(headers.every((cell) => cell.getAttribute('scope') === 'col')).toBe(true)
  expect(parsed.normalized!.findings).toEqual([])
})

test('two logical tables on one sheet become one table with a false header', async () => {
  const { parsed } = await parse('xlsx-two-tables-one-sheet')
  const tables = tablesIn(parsed.normalized!.html)

  expect(tables).toHaveLength(1)
  const rows = [...tables[0]!.querySelectorAll('tr')]
  expect(rows).toHaveLength(5)
  // The second table's header row is in the body, as data, and the blank row
  // that separated them is now an empty row inside one table.
  expect(rows[3]!.textContent).toContain('Line')
  expect(rows[3]!.querySelectorAll('th')).toHaveLength(0)
  expect(rows[2]!.textContent?.trim()).toBe('')
})

// ===== Cell values (design facts 11, 12) =================================

test('an uncached formula becomes an empty cell, and a cached error becomes text', async () => {
  const { parsed } = await parse('xlsx-formulas')
  const table = tablesIn(parsed.normalized!.html)[0]!
  const cells = [...table.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent))

  expect(cells[1]).toEqual(['2', '3', '5'])
  // No `<v>` was written for this formula, so the whole computed value is gone
  // and nothing says so.
  expect(cells[2]).toEqual(['4', '5', ''])
  expect(parsed.normalized!.findings).toEqual([])
  // An error is indistinguishable from a value a reader should trust.
  expect(cells[3]).toEqual(['0', '0', '#DIV/0!'])
  // The formula SOURCE never reaches the page, which is the one good half of
  // this: a formula can name ranges and sheets an author did not mean to show.
  expect(parsed.normalized!.html).not.toContain('A2+B2')
})

test('number formats are applied to some cells and not others', async () => {
  const { parsed } = await parse('xlsx-number-formats')
  const table = tablesIn(parsed.normalized!.html)[0]!
  const values = [...table.querySelectorAll('tbody td')].map((cell) => cell.textContent)

  // Custom percent and the built-in short date are applied; the built-in
  // currency format is not, so "displayed value" is a partial promise.
  expect(values).toEqual(['7.50%', '2023-03-15', '1234.5'])
})

// ===== Hidden content (design fact 14) ===================================

test('xlsx drops every hidden sheet, row and column — with no finding either way', async () => {
  const { parsed } = await parse('xlsx-hidden-content')
  const html = parsed.normalized!.html

  expect(html).not.toContain('failing, hidden row')
  expect(html).not.toContain('Internal note')
  expect(html).not.toContain('Salaries')
  expect(html).not.toContain('98000')
  expect(html).not.toContain('not for publication')
  // Right for privacy; wrong for fidelity. An instructor whose grade sheet has
  // a hidden helper column gets a table missing a column and is never told.
  expect(parsed.normalized!.findings).toEqual([])
})

test('ods PUBLISHES the same hidden sheet, row and column — the privacy defect', async () => {
  const { parsed } = await parse('ods-hidden-content')
  const html = parsed.normalized!.html

  // Every one of these is content the author hid, in a fixture built the way
  // LibreOffice Calc writes hiding: `table:visibility="collapse"` on the row and
  // the column, and a table-family style carrying `table:display="false"`.
  expect(html).toContain('failing, hidden row')
  expect(html).toContain('Internal note')
  expect(html).toContain('Salaries')
  expect(html).toContain('98000')
  expect(parsed.normalized!.findings).toEqual([])
})

test('the same authoring intent leaks in ods and does not in xlsx', async () => {
  // The two cases above compared as a pair, because the pair IS the finding:
  // one source document, two containers, opposite outcomes.
  const rows = [
    ['Name', 'Internal note', 'Grade'],
    ['Ada', 'reviewed', 'A'],
    ['Bob', 'failing, hidden row', 'F'],
  ] as const
  const xlsx = await probeParser({
    parser: 'anydoc',
    bytes: (await buildXlsx([
      { name: 'Public', rows, hiddenRows: [3], hiddenColumns: [2] },
    ])).buffer,
    formatHint: 'xlsx',
  })
  const ods = await probeParser({
    parser: 'anydoc',
    bytes: (await buildOds([
      { name: 'Public', columnCount: 3, rows, hiddenRows: [3], hiddenColumns: [2] },
    ])).buffer,
    formatHint: 'ods',
  })

  expect(xlsx.normalized!.html).not.toContain('failing, hidden row')
  expect(ods.normalized!.html).toContain('failing, hidden row')
})

// ===== What vanishes, and what stays out (design facts 9, 15) ============

test('a worksheet picture vanishes with no block, no asset, and no finding', async () => {
  const { parsed } = await parse('xlsx-embedded-picture')

  expect(parsed.counts.assets).toBe(0)
  expect(parsed.counts.images).toBe(0)
  expect(parsed.normalized!.packagedAssets).toEqual([])
  expect(parsed.normalized!.unavailableAssets).toBe(0)
  expect(parsed.normalized!.html).not.toContain('Enrollment climbing')
  // The silence is the point: nothing on the page and nothing in the report
  // says a picture was there. For a worksheet, that picture is often the
  // reason the worksheet exists.
  expect(parsed.normalized!.findings).toEqual([])
})

test('a macro-enabled workbook imports no bytes from its macro part', async () => {
  const { parsed } = await parse('xlsm-macro-enabled')

  expect(parsed.detectedFormat).toBe('xlsx')
  expect(parsed.counts.assets).toBe(0)
  expect(parsed.assetBytes ?? 0).toBe(0)
  expect(parsed.normalized!.packagedAssets).toEqual([])
})

test('an external workbook reference is never fetched', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  const { parsed } = await parse('xlsx-external-workbook')
  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()

  // Only the cached value survives; the address does not appear anywhere.
  expect(parsed.normalized!.html).toContain('42')
  expect(parsed.normalized!.html).not.toContain('example.invalid')
})

test('a private cell comment does not reach the page', async () => {
  const { parsed } = await parse('xlsx-cell-comment')

  expect(parsed.normalized!.html).not.toContain('Do not tell the class')
  expect(parsed.normalized!.notes).toBe(0)
})

test('hostile cell text is escaped, not executed', async () => {
  const { parsed } = await parse('xlsx-hostile-cell-text')
  const html = parsed.normalized!.html

  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
  expect(documentOf(html).querySelector('script')).toBeNull()
  // Inert in HTML. Checked on the parsed TEXT, not the serialized markup: the
  // apostrophes come back as `&#39;`, which is the escaping working, and an
  // assertion against the raw string would have read that as the payload being
  // gone when it is merely encoded.
  const cells = [...documentOf(html).querySelectorAll('td')].map((cell) => cell.textContent)
  expect(cells).toContain('<script>alert(1)</script>')
  // A leading `=` only matters if the rendered table is pasted back into a
  // spreadsheet, which is a documentation matter, not a refusal.
  expect(cells).toContain("=cmd|' /C calc'!A0")
})

// ===== Ragged grids (design facts 16, 17) ================================

test('a csv with a title line above its header arrives ragged', async () => {
  const { parsed } = await parse('csv-title-line')
  const table = tablesIn(parsed.normalized!.html)[0]!

  // anydoc's own `Table` doc-comment promises "every logical grid position
  // appears exactly once". For CSV it does not hold.
  expect(rowWidths(table)).toEqual([1, 2, 2])
  expect(table.querySelectorAll('th')).toHaveLength(0)
})

test('a csv whose rows disagree about their width keeps the disagreement', async () => {
  const { parsed } = await parse('csv-ragged-rows')
  expect(rowWidths(tablesIn(parsed.normalized!.html)[0]!)).toEqual([3, 2, 4])
})

test('an ordinary csv is the one shape that produces a header row', async () => {
  const { parsed } = await parse('csv-ordinary')
  const table = tablesIn(parsed.normalized!.html)[0]!

  expect(rowWidths(table)).toEqual([2, 2, 2])
  expect([...table.querySelectorAll('th')].map((cell) => cell.textContent))
    .toEqual(['Term', 'Students'])
})

test('an ods worksheet with merged cells is ragged too', async () => {
  const { parsed } = await parse('ods-merged-group-header')
  const table = tablesIn(parsed.normalized!.html)[0]!

  // Row 1 carries one cell more than the rows around it once the covered
  // positions are removed — the same shape the audit refuses.
  expect(new Set(rowWidths(table)).size).toBeGreaterThan(1)
  expect(table.querySelectorAll('th')).toHaveLength(0)
})

// ===== The accessibility verdict, checked against the real audit =========

/**
 * Compiles imported-shaped HTML through the same pipeline every import uses.
 *
 * The allowlist and axe deps are stubbed exactly as `document.browser.test.ts`
 * stubs them: this suite is measuring what `fixTables` decides, not what
 * Canvas's allowlist or axe reports, and leaving the real ones in would make a
 * table-header assertion fail for reasons that have nothing to do with tables.
 */
async function auditImportedHtml(html: string) {
  return compileAndAuditChapter(
    toChapter({
      id: 'spreadsheet-evidence',
      title: 'Worksheet',
      format: 'xlsx',
      sections: [{ id: 'section-1', title: 'Worksheet', order: 0, html }],
      assets: [],
      provenance: { kind: 'local-file', rights: { authority: 'own', acknowledged: true } },
    }),
    {
      profile: DOCUMENT,
      deps: {
        validateAllowlist: async (candidate: string) => ({ html: candidate, removedSemantic: [] }),
        audit: async () => ({ issues: [] }),
      },
    },
  )
}

test('a merged group header is queued and then REFUSED for every answer', async () => {
  const { parsed } = await parse('xlsx-merged-group-header')
  const compiled = await auditImportedHtml(parsed.normalized!.html)
  const section = compiled.sections[0]!

  // Headerless, so the audit asks a human.
  const queued = section.queue.filter((item) => item.kind === 'table-headers')
  expect(queued).toHaveLength(1)

  // And every answer that human can give is refused, for a structural reason
  // that is a property of the file and cannot be edited away in this workflow.
  for (const choice of ['row', 'column', 'both'] as const) {
    const answers = new Map([[
      `${section.id}::${queued[0]!.elementId}`,
      { type: 'table-headers' as const, choice },
    ]])
    const answered = await compileAndAuditChapter(
      toChapter({
        id: 'spreadsheet-evidence',
        title: 'Worksheet',
        format: 'xlsx',
        sections: [{ id: 'section-1', title: 'Worksheet', order: 0, html: parsed.normalized!.html }],
        assets: [],
        provenance: { kind: 'local-file', rights: { authority: 'own', acknowledged: true } },
      }),
      {
        profile: DOCUMENT,
        answers,
        deps: {
          validateAllowlist: async (candidate: string) => ({ html: candidate, removedSemantic: [] }),
          audit: async () => ({ issues: [] }),
        },
      },
    )
    const answeredSection = answered.sections[0]!
    const refusal = answeredSection.notes.find((note) => note.message.startsWith(TABLE_REFUSAL))
    expect(refusal, `choice '${choice}' should be refused`).toBeDefined()
    expect(refusal!.message).toContain('spans more than one row')
    // Refused AND still queued: the card cannot be cleared.
    expect(answeredSection.queue.filter((item) => item.kind === 'table-headers')).toHaveLength(1)
  }
})

test('a single worksheet reaches the audit with a caption that names nothing', async () => {
  const { parsed } = await parse('xlsx-single-worksheet')
  const compiled = await auditImportedHtml(parsed.normalized!.html)
  const caption = documentOf(compiled.sections[0]!.html).querySelector('caption')

  // There is no heading (design fact 5) and no introducing paragraph, so the
  // caption falls all the way through to the literal fallback — on the one
  // element whose real name, the worksheet's, the parser had and dropped.
  expect(caption?.textContent).toBe('Data table')
})

// ===== Resource usage (design facts 18, 19) ==============================

test("anydoc's own per-part node ceiling refuses a single enormous worksheet", async () => {
  // 1,000,000 cells in one part, well past the measured 2,000,000-node ceiling,
  // in a package far under `maximumInputBytes`. Asserted by the refusal, not by
  // a timing, because a timing is not stable in CI.
  const bytes = await largeButLegalXlsx(1, 50_000, 20)

  await expect(probeParser({ parser: 'anydoc', bytes: bytes.buffer, formatHint: 'xlsx' }))
    .rejects.toMatchObject({ code: 'resource-limit' })
}, 120_000)

test("anydoc's workbook-extent ceiling refuses many merely-large worksheets", async () => {
  // 6,000,000 grid positions across 12 sheets, each sheet under the per-part
  // ceiling the previous test crosses — so this one can only be caught by the
  // workbook-wide `max_grid_slots` limit.
  const bytes = await largeButLegalXlsx(12, 25_000, 20)

  await expect(probeParser({ parser: 'anydoc', bytes: bytes.buffer, formatHint: 'xlsx' }))
    .rejects.toMatchObject({ code: 'resource-limit' })
}, 180_000)

// ===== The gate itself ===================================================

test('a spreadsheet is refused by the importer, with the format named', async () => {
  const bytes = await caseNamed('xlsx-two-worksheets').bytes()
  const file = new File([bytes], 'enrollment.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  await expect(importStructuredDocument(file, {
    metadata: { title: 'Enrollment', rightsAuthority: 'own', rightsAcknowledged: true },
    // Names the format, per this test's own title, because issue 15 taught
    // `enabledCapabilityFor` to refuse a known-but-disabled capability with its
    // own label and first limitation instead of the generic extension list.
  })).rejects.toThrow(/Excel workbook: Spreadsheets are not imported in this release/)
})

test('the capability table explains the refusal before a user submits', () => {
  for (const [filename, format] of [
    ['enrollment.xlsx', 'xlsx'],
    ['budget.xlsm', 'xlsx'],
    ['legacy.xls', 'xls'],
    ['grades.ods', 'ods'],
    ['export.csv', 'csv'],
  ] as const) {
    const capability = capabilityForFilename(filename)
    expect(capability, filename).toBeDefined()
    expect(capability!.format, filename).toBe(format)
    expect(capability!.status, filename).toBe('probe-only')
    // Not an empty gesture: each entry has to say what would go wrong.
    expect(capability!.limitations.length, filename).toBeGreaterThan(0)
  }
})
