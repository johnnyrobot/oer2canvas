/**
 * The evaluation corpus for issue 16's spreadsheet decision.
 *
 * NOT part of `corpus.ts`. That corpus is "the corpus this release's support
 * claim rests on", and a disabled format makes no support claim — putting these
 * cases there would also break its own coverage-shape test, which requires every
 * case's format to be a released one.
 *
 * These fixtures exist so the decision can go stale LOUDLY. Every case pins a
 * fact measured against `@firecrawl/anydoc-wasm` 0.2.4 on 2026-08-30 and
 * recorded in `.scratch/document-import/16-decide-spreadsheet-imports-design.md`;
 * the day the parser stops behaving that way, `spreadsheet-evidence.browser.test.ts`
 * fails and somebody re-opens the question rather than nobody noticing.
 *
 * Every fixture here is SYNTHETIC. The design's real-file facts were measured
 * against the operator's own spreadsheets and recorded as aggregate counts only;
 * nothing from a real file is reproduced in this repository.
 */

// @ts-expect-error -- shared browser/Node test fixture, like `presentation-fixtures.ts`.
import { writeZip } from '../../engine/export/zip.ts'
// @ts-expect-error -- shared browser/Node test fixture; see above.
import { RASTER_FIXTURES } from './raster-fixtures.ts'

const utf8 = (value: string) => new TextEncoder().encode(value)
const xmlEscape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** `0` -> `A`, `26` -> `AA`. Spreadsheet column letters, for a cell reference. */
function columnLetter(index: number): string {
  let letters = ''
  let n = index + 1
  while (n > 0) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

/**
 * One cell.
 *
 * `null` is a GENUINELY ABSENT cell — no `<c>` element at all — which is what a
 * sparse range and a merged cell's covered positions look like in a real file,
 * and is measurably different from an empty string (design fact 6: a blank cell
 * in row 1 turns `headerRows` off, an empty-string cell does too, and a missing
 * `<c>` is how Excel writes the first of those).
 */
export type XlsxCell =
  | string
  | number
  | null
  | {
      /** Stored value. Omit entirely for a formula with no cached result (fact 12). */
      value?: string | number
      /** Formula source, written to `<f>`. */
      formula?: string
      /** Cell type. Defaults to `n` for a number, `inlineStr` otherwise. `e` is an error. */
      type?: 'n' | 'inlineStr' | 'e'
      /** Index into the fixture stylesheet's `cellXfs`: 1 percent, 2 date, 3 currency. */
      style?: number
    }

export interface XlsxSheetSpec {
  name: string
  rows: readonly (readonly XlsxCell[])[]
  /** `A1:B2`-style merge ranges. */
  merges?: readonly string[]
  /** 1-based row numbers to mark `hidden="1"`. */
  hiddenRows?: readonly number[]
  /** 1-based column numbers to mark `hidden="1"`. */
  hiddenColumns?: readonly number[]
  /** Workbook-level sheet visibility. */
  state?: 'hidden' | 'veryHidden'
  /** 1-based row the first `rows` entry occupies. Above 1 makes the range sparse. */
  startRow?: number
  /** 0-based column the first cell of each row occupies. */
  startColumn?: number
}

export interface XlsxOptions {
  /** Adds `xl/vbaProject.bin` and the macro-enabled main content type. */
  macroEnabled?: boolean
  /** Adds an `xl/externalLinks/` part targeting an absolute https URL. */
  externalWorkbook?: boolean
  /** Adds a cell comment part on the first worksheet. */
  cellComment?: string
  /** Adds a drawing referencing an embedded PNG on the first worksheet. */
  embeddedPicture?: { description: string }
}

/**
 * The four number formats fact 11 measured. `numFmtId` 164 is the custom
 * percent; 14 and 44 are the built-in short-date and currency formats, whose
 * codes live in the spec rather than in the file — which is why the fixture
 * declares only the custom one.
 */
const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00%"/></numFmts>' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="44" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs></styleSheet>'

function worksheetXml(sheet: XlsxSheetSpec, hasComment: boolean, hasDrawing: boolean): string {
  const startRow = sheet.startRow ?? 1
  const startColumn = sheet.startColumn ?? 0
  const hiddenRows = new Set(sheet.hiddenRows ?? [])
  const columns = (sheet.hiddenColumns ?? []).length > 0
    ? `<cols>${(sheet.hiddenColumns ?? [])
        .map((column) => `<col min="${column}" max="${column}" width="0" hidden="1" customWidth="1"/>`)
        .join('')}</cols>`
    : ''
  const rows = sheet.rows.map((cells, rowIndex) => {
    const rowNumber = startRow + rowIndex
    const body = cells.map((cell, columnIndex) => {
      if (cell === null || cell === undefined) return ''
      const reference = `${columnLetter(startColumn + columnIndex)}${rowNumber}`
      if (typeof cell === 'number') return `<c r="${reference}"><v>${cell}</v></c>`
      if (typeof cell === 'string') {
        return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`
      }
      const type = cell.type ?? (typeof cell.value === 'number' ? 'n' : 'inlineStr')
      const style = cell.style === undefined ? '' : ` s="${cell.style}"`
      const typeAttribute = type === 'n' ? '' : ` t="${type}"`
      const formula = cell.formula ? `<f>${xmlEscape(cell.formula)}</f>` : ''
      const value = cell.value === undefined
        ? ''
        : type === 'inlineStr'
          ? `<is><t>${xmlEscape(String(cell.value))}</t></is>`
          : `<v>${xmlEscape(String(cell.value))}</v>`
      return `<c r="${reference}"${style}${typeAttribute}>${formula}${value}</c>`
    }).join('')
    return `<row r="${rowNumber}"${hiddenRows.has(rowNumber) ? ' hidden="1"' : ''}>${body}</row>`
  }).join('')
  const merges = (sheet.merges ?? []).length > 0
    ? `<mergeCells count="${(sheet.merges ?? []).length}">${(sheet.merges ?? [])
        .map((range) => `<mergeCell ref="${range}"/>`).join('')}</mergeCells>`
    : ''
  // Order matters to the schema: cols, sheetData, mergeCells, then the parts
  // that reference other parts.
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `${columns}<sheetData>${rows}</sheetData>${merges}` +
    (hasComment ? '<legacyDrawing r:id="rIdComment"/>' : '') +
    (hasDrawing ? '<drawing r:id="rIdDrawing"/>' : '') +
    '</worksheet>'
}

/** A minimal, well-formed `.xlsx` (or `.xlsm`) package. */
export async function buildXlsx(
  sheets: readonly XlsxSheetSpec[],
  options: XlsxOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const sheetPaths = sheets.map((_sheet, index) => `xl/worksheets/sheet${index + 1}.xml`)
  const mainType = options.macroEnabled
    ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'

  const entries: { name: string; data: Uint8Array }[] = [
    {
      name: '[Content_Types].xml',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        (options.macroEnabled ? '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' : '') +
        `<Override PartName="/xl/workbook.xml" ContentType="${mainType}"/>` +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheetPaths.map((path) =>
          `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        (options.cellComment
          ? '<Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>'
          : '') +
        (options.embeddedPicture
          ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
          : '') +
        (options.externalWorkbook
          ? '<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/>'
          : '') +
        '</Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((sheet, index) =>
          `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"` +
          `${sheet.state ? ` state="${sheet.state}"` : ''}/>`).join('') +
        '</sheets>' +
        (options.externalWorkbook
          ? '<externalReferences><externalReference r:id="rIdExternal"/></externalReferences>'
          : '') +
        '</workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheetPaths.map((path, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${path.replace('xl/', '')}"/>`).join('') +
        `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        (options.macroEnabled
          ? '<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>'
          : '') +
        (options.externalWorkbook
          ? '<Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/>'
          : '') +
        '</Relationships>',
      ),
    },
    { name: 'xl/styles.xml', data: utf8(STYLES_XML) },
    ...sheetPaths.map((path, index) => ({
      name: path,
      data: utf8(worksheetXml(
        sheets[index]!,
        index === 0 && options.cellComment !== undefined,
        index === 0 && options.embeddedPicture !== undefined,
      )),
    })),
  ]

  if (options.cellComment || options.embeddedPicture) {
    entries.push({
      name: 'xl/worksheets/_rels/sheet1.xml.rels',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        (options.cellComment
          ? '<Relationship Id="rIdComment" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/>'
          : '') +
        (options.embeddedPicture
          ? '<Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'
          : '') +
        '</Relationships>',
      ),
    })
  }

  if (options.cellComment) {
    entries.push({
      name: 'xl/comments1.xml',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<authors><author>Instructor</author></authors><commentList>' +
        `<comment ref="A2" authorId="0"><text><t>${xmlEscape(options.cellComment)}</t></text></comment>` +
        '</commentList></comments>',
      ),
    })
  }

  if (options.embeddedPicture) {
    entries.push({
      name: 'xl/drawings/drawing1.xml',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"' +
        ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<xdr:twoCellAnchor>' +
        '<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
        '<xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>14</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
        '<xdr:pic><xdr:nvPicPr>' +
        `<xdr:cNvPr id="1" name="Picture 1" descr="${xmlEscape(options.embeddedPicture.description)}"/>` +
        '<xdr:cNvPicPr/></xdr:nvPicPr>' +
        '<xdr:blipFill><a:blip r:embed="rIdImage"/></xdr:blipFill><xdr:spPr/></xdr:pic>' +
        '<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>',
      ),
    })
    entries.push({
      name: 'xl/drawings/_rels/drawing1.xml.rels',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>' +
        '</Relationships>',
      ),
    })
    entries.push({ name: 'xl/media/image1.png', data: RASTER_FIXTURES.png.bytes })
  }

  if (options.externalWorkbook) {
    entries.push({
      name: 'xl/externalLinks/externalLink1.xml',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<externalBook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1">' +
        '<sheetNames><sheetName val="Rates"/></sheetNames>' +
        '<sheetDataSet><sheetData sheetId="0"><row r="1"><cell r="A1"><v>42</v></cell></row></sheetData></sheetDataSet>' +
        '</externalBook></externalLink>',
      ),
    })
    entries.push({
      name: 'xl/externalLinks/_rels/externalLink1.xml.rels',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath"' +
        ' Target="https://example.invalid/rates.xlsx" TargetMode="External"/>' +
        '</Relationships>',
      ),
    })
  }

  if (options.macroEnabled) {
    // The OLE2 signature and nothing else. Enough for the package to CARRY a
    // vbaProject part; this project never reads it and never runs it, and the
    // evidence test's job is to keep that true.
    entries.push({
      name: 'xl/vbaProject.bin',
      data: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
    })
  }

  return writeZip(entries) as Promise<Uint8Array<ArrayBuffer>>
}

export interface OdsCell {
  value?: string | number
  /** Displayed text, when it differs from the stored value. */
  display?: string
  formula?: string
  columnSpan?: number
  rowSpan?: number
  /** `<table:covered-table-cell/>` elements to emit after this cell. */
  covered?: number
}

export interface OdsSheetSpec {
  name: string
  rows: readonly (readonly (string | number | OdsCell | null)[])[]
  /** Total column count, needed before any column can be marked hidden. */
  columnCount?: number
  /** 1-based column numbers hidden with `table:visibility="collapse"`. */
  hiddenColumns?: readonly number[]
  /** 1-based row numbers hidden with `table:visibility="collapse"`. */
  hiddenRows?: readonly number[]
  /**
   * Hidden sheet. Written the way LibreOffice Calc writes one — a table-family
   * automatic style carrying `table:display="false"` — NOT as an attribute on
   * `table:table`, which is not where ODF puts it. Design fact 14 was measured
   * against a file LibreOffice wrote through its own `calc8` filter, and this
   * builder reproduces that shape so the fixture tests the real construct.
   */
  hidden?: boolean
}

/** A minimal, well-formed `.ods` package. */
export async function buildOds(sheets: readonly OdsSheetSpec[]): Promise<Uint8Array<ArrayBuffer>> {
  const cellXml = (cell: string | number | OdsCell | null): string => {
    if (cell === null || cell === undefined) return '<table:table-cell/>'
    if (typeof cell === 'number') {
      return `<table:table-cell office:value-type="float" office:value="${cell}"><text:p>${cell}</text:p></table:table-cell>`
    }
    if (typeof cell === 'string') {
      return `<table:table-cell office:value-type="string"><text:p>${xmlEscape(cell)}</text:p></table:table-cell>`
    }
    const spans = (cell.columnSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1
      ? ` table:number-columns-spanned="${cell.columnSpan ?? 1}" table:number-rows-spanned="${cell.rowSpan ?? 1}"`
      : ''
    const formula = cell.formula ? ` table:formula="${xmlEscape(cell.formula)}"` : ''
    const valueType = typeof cell.value === 'number'
      ? `office:value-type="float" office:value="${cell.value}"`
      : 'office:value-type="string"'
    const text = xmlEscape(String(cell.display ?? cell.value ?? ''))
    return `<table:table-cell ${valueType}${formula}${spans}><text:p>${text}</text:p></table:table-cell>` +
      '<table:covered-table-cell/>'.repeat(cell.covered ?? 0)
  }

  const tables = sheets.map((sheet, sheetIndex) => {
    const styleName = sheet.hidden ? 'taHidden' : 'taVisible'
    const columns = sheet.columnCount === undefined
      ? ''
      : Array.from({ length: sheet.columnCount }, (_unused, index) =>
          `<table:table-column${(sheet.hiddenColumns ?? []).includes(index + 1) ? ' table:visibility="collapse"' : ''}/>`).join('')
    const rows = sheet.rows.map((cells, rowIndex) => {
      const hidden = (sheet.hiddenRows ?? []).includes(rowIndex + 1) ? ' table:visibility="collapse"' : ''
      return `<table:table-row${hidden}>${cells.map(cellXml).join('')}</table:table-row>`
    }).join('')
    void sheetIndex
    return `<table:table table:name="${xmlEscape(sheet.name)}" table:style-name="${styleName}">${columns}${rows}</table:table>`
  }).join('')

  const content =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
    ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"' +
    ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"' +
    ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">' +
    '<office:automatic-styles>' +
    '<style:style style:name="taVisible" style:family="table"><style:table-properties table:display="true"/></style:style>' +
    '<style:style style:name="taHidden" style:family="table"><style:table-properties table:display="false"/></style:style>' +
    '</office:automatic-styles>' +
    `<office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body>` +
    '</office:document-content>'

  return writeZip([
    // `mimetype` first and stored, as the ODF package specification requires.
    { name: 'mimetype', data: utf8('application/vnd.oasis.opendocument.spreadsheet') },
    {
      name: 'META-INF/manifest.xml',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
        '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>' +
        '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
        '</manifest:manifest>',
      ),
    },
    { name: 'content.xml', data: utf8(content) },
  ]) as Promise<Uint8Array<ArrayBuffer>>
}

/**
 * A workbook that is LEGAL under every gate this release enforces and still
 * costs more than any document it has ever measured — design fact 19.
 *
 * Deliberately generated rather than committed: the bytes are megabytes of
 * repetitive XML, and what the case is FOR is the shape, not any particular
 * value in it. `sheets` and `rows` are parameters so a test can pick a size
 * that crosses one of anydoc's own ceilings (`max_xml_nodes` at 2,000,000 nodes
 * per part, `max_grid_slots` at 4,500,000 positions per workbook, both measured
 * 2026-08-30) without hard-coding a fixture at each.
 */
export function largeButLegalXlsx(
  sheets: number,
  rows: number,
  columns: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const header = Array.from({ length: columns }, (_unused, index) => `Column ${index + 1}`)
  const body = Array.from({ length: rows - 1 }, (_unused, rowIndex) =>
    Array.from({ length: columns }, (_column, columnIndex) => (rowIndex * columns + columnIndex) % 100_000))
  return buildXlsx(Array.from({ length: sheets }, (_unused, index) => ({
    name: `Sheet${index + 1}`,
    rows: [header, ...body],
  })))
}

export interface SpreadsheetCase {
  id: string
  /** The extension a user would actually choose, which decides the format hint. */
  extension: '.xlsx' | '.xlsm' | '.xls' | '.ods' | '.csv'
  /** The format anydoc is expected to report from the CONTENT, or `undefined` for CSV. */
  detects: 'xlsx' | 'ods' | undefined
  /** The real-world property this case exists to represent. Required. */
  standsInFor: string
  bytes: () => Promise<Uint8Array<ArrayBuffer>>
}

const utf8Bytes = (value: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>

export const SPREADSHEET_EVALUATION_CASES: readonly SpreadsheetCase[] = [
  {
    id: 'xlsx-two-worksheets',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'The ordinary multi-sheet workbook: a term summary beside a budget. Design fact 4 — a worksheet name reaches the model as an h2 — and fact 5, which only holds while more than one sheet survives.',
    bytes: () => buildXlsx([
      { name: 'Enrollment', rows: [['Term', 'Students'], ['Fall', 120], ['Spring', 98]] },
      { name: 'Budget', rows: [['Line', 'Amount'], ['Printing', 340]] },
    ]),
  },
  {
    id: 'xlsx-single-worksheet',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'The commonest workbook of all — one sheet — which design fact 5 measured arriving with NO heading, so the worksheet name the file carries never reaches the page and the table has no accessible name.',
    bytes: () => buildXlsx([
      { name: 'Attendance', rows: [['Week', 'Present'], ['1', 31], ['2', 29]] },
    ]),
  },
  {
    id: 'xlsx-merged-group-header',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'A gradebook with a two-row header — "Midterm" spanning Score and Grade, "Student" spanning both header rows. Design facts 6 and 7: the merge turns headerRows off entirely, and the rowspan then makes the audit REFUSE every header answer an instructor could give.',
    bytes: () => buildXlsx([
      {
        name: 'Scores',
        rows: [
          ['Student', 'Midterm', null, 'Final', null],
          [null, 'Score', 'Grade', 'Score', 'Grade'],
          ['Ada', 88, 'B+', 91, 'A-'],
          ['Grace', 94, 'A', 90, 'A-'],
        ],
        merges: ['A1:A2', 'B1:C1', 'D1:E1'],
      },
    ]),
  },
  {
    id: 'xlsx-blank-corner-header',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'The matrix table every instructor draws: row labels down the side, column labels across the top, and A1 left empty above them. Design fact 6 measured that one blank cell in row 1 turning headerRows off, so the table arrives with no header cell at all.',
    bytes: () => buildXlsx([
      {
        name: 'Rooms',
        rows: [
          [null, 'Monday', 'Tuesday'],
          ['101', 'Chemistry', 'Biology'],
          ['102', 'Biology', 'Physics'],
        ],
      },
    ]),
  },
  {
    id: 'xlsx-data-row-read-as-header',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'A list with no header row whose first record happens to be all text. Design fact 6\'s OTHER direction: headerRows comes back 1, so a screen reader is told a data row labels everything under it — silently, with nothing queued and nothing to check it against.',
    bytes: () => buildXlsx([
      {
        name: 'Readings',
        rows: [['Chapter one', 'Introductions'], ['Chapter two', 'Method'], ['Chapter three', 'Results']],
      },
    ]),
  },
  {
    id: 'xlsx-sparse-range',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'A worksheet whose data starts at C5 with a blank row through the middle. Design fact 10: it arrives as a dense grid padded with empty strings, and nothing in the model records that the first cell was C5 — there is no cell provenance to join a second reader against.',
    bytes: () => buildXlsx([
      {
        name: 'Sparse',
        rows: [['Term', null, 'Students'], [], ['Fall', null, 120]],
        startRow: 5,
        startColumn: 2,
      },
    ]),
  },
  {
    id: 'xlsx-two-tables-one-sheet',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'The report worksheet: two unrelated tables separated by a blank row. Design fact 13 — they arrive as ONE table whose header is the first table\'s, with the second table\'s header row sitting in the body as data.',
    bytes: () => buildXlsx([
      {
        name: 'Report',
        rows: [
          ['Term', 'Students'],
          ['Fall', 120],
          [],
          ['Line', 'Amount'],
          ['Printing', 340],
        ],
      },
    ]),
  },
  {
    id: 'xlsx-formulas',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'A total column: one formula with a cached value, one with none, and one caching an error. Design facts 11 and 12 — only the cached value survives, an uncached formula becomes an EMPTY CELL with no finding, and a cached error is indistinguishable from data.',
    bytes: () => buildXlsx([
      {
        name: 'Calc',
        rows: [
          ['Left', 'Right', 'Total'],
          [2, 3, { formula: 'A2+B2', value: 5, type: 'n' }],
          [4, 5, { formula: 'A3+B3' }],
          [0, 0, { formula: 'A4/B4', value: '#DIV/0!', type: 'e' }],
        ],
      },
    ]),
  },
  {
    id: 'xlsx-number-formats',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'A rate, a due date and a fee — three number formats. Design fact 11: the custom percent and the built-in date are applied to the displayed text, and the built-in currency format is NOT, so displayed-value fidelity is partial rather than absent.',
    bytes: () => buildXlsx([
      {
        name: 'Formats',
        rows: [
          ['Rate', 'Due', 'Fee'],
          [
            { value: 0.075, type: 'n', style: 1 },
            { value: 45000, type: 'n', style: 2 },
            { value: 1234.5, type: 'n', style: 3 },
          ],
        ],
      },
    ]),
  },
  {
    id: 'xlsx-hidden-content',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'A roster with a hidden failing-student row, a hidden internal-note column, and a hidden Salaries sheet. Design fact 14: XLSX hides all three — right for privacy, and wrong for fidelity, with no finding in either direction.',
    bytes: () => buildXlsx([
      {
        name: 'Public',
        rows: [
          ['Name', 'Internal note', 'Grade'],
          ['Ada', 'reviewed', 'A'],
          ['Bob', 'failing, hidden row', 'F'],
        ],
        hiddenRows: [3],
        hiddenColumns: [2],
      },
      { name: 'Salaries', rows: [['Name', 'Salary'], ['Ada', 98000]], state: 'hidden' },
      { name: 'Draft', rows: [['Notes'], ['not for publication']], state: 'veryHidden' },
    ]),
  },
  {
    id: 'ods-hidden-content',
    extension: '.ods',
    detects: 'ods',
    standsInFor: 'THE SAME roster, hidden the way OpenDocument hides things. Design fact 14: ODS publishes all three — the hidden row, the hidden column, and the whole hidden Salaries sheet — which is a privacy leak, not a fidelity choice.',
    bytes: () => buildOds([
      {
        name: 'Public',
        columnCount: 3,
        hiddenColumns: [2],
        hiddenRows: [3],
        rows: [
          ['Name', 'Internal note', 'Grade'],
          ['Ada', 'reviewed', 'A'],
          ['Bob', 'failing, hidden row', 'F'],
        ],
      },
      { name: 'Salaries', hidden: true, rows: [['Name', 'Salary'], ['Ada', 98000]] },
    ]),
  },
  {
    id: 'ods-merged-group-header',
    extension: '.ods',
    detects: 'ods',
    standsInFor: 'The gradebook header again, in OpenDocument. Design facts 6 and 7 hold for ODS too, so the verdict is not an artifact of one container.',
    bytes: () => buildOds([
      {
        name: 'Scores',
        rows: [
          [{ value: 'Student', rowSpan: 2 }, { value: 'Midterm', columnSpan: 2, covered: 1 }],
          [null, 'Score', 'Grade'],
          ['Ada', 88, 'B+'],
        ],
      },
    ]),
  },
  {
    id: 'xlsx-embedded-picture',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'A worksheet whose point is the chart sitting on it, carried as a described PNG behind a drawing. Design fact 9: no block, no asset, and no finding — the picture vanishes without a trace, and unlike a slide\'s diagram it was often the whole worksheet.',
    bytes: () => buildXlsx(
      [{ name: 'Chart', rows: [['Enrollment over time']] }],
      { embeddedPicture: { description: 'Enrollment climbing from 2019 to 2024' } },
    ),
  },
  {
    id: 'xlsm-macro-enabled',
    extension: '.xlsm',
    detects: 'xlsx',
    standsInFor: 'A macro-enabled workbook carrying xl/vbaProject.bin. Design facts 1 and 15: it reports itself as xlsx like every other container in the family, and the macro is never read, never packaged, and never run.',
    bytes: () => buildXlsx(
      [{ name: 'Data', rows: [['Label', 'Value'], ['Total', 12]] }],
      { macroEnabled: true },
    ),
  },
  {
    id: 'xlsx-external-workbook',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'A workbook whose rate comes from another workbook over https. Design fact 15: the cached value is published, the external address is never fetched, and nothing on the page says the number came from somewhere else.',
    bytes: () => buildXlsx(
      [{ name: 'Data', rows: [['Rate'], [{ formula: '[1]Rates!A1', value: 42, type: 'n' }]] }],
      { externalWorkbook: true },
    ),
  },
  {
    id: 'xlsx-cell-comment',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'A grade with a private note attached to the cell. Design fact 15: the comment does not reach the page — the opposite of a deck\'s speaker notes, which issue 14 had to exclude deliberately.',
    bytes: () => buildXlsx(
      [{ name: 'Notes', rows: [['Grade'], ['B+']] }],
      { cellComment: 'Bumped from C. Do not tell the class.' },
    ),
  },
  {
    id: 'xlsx-hostile-cell-text',
    extension: '.xlsx',
    detects: 'xlsx',
    standsInFor: 'Cells holding a script tag and a spreadsheet formula-injection payload. Design fact 15: both arrive as ordinary text and are escaped, so neither is a browser vector — the injection payload matters only if the rendered table is pasted back into a spreadsheet.',
    bytes: () => buildXlsx([
      {
        name: 'Hostile',
        rows: [
          ['Label', 'Value'],
          ['Script', '<script>alert(1)</script>'],
          ['Injection', "=cmd|' /C calc'!A0"],
        ],
      },
    ]),
  },
  {
    id: 'csv-title-line',
    extension: '.csv',
    detects: undefined,
    standsInFor: 'A CSV exported with a report title above its header, which is what every reporting tool writes. Design fact 16: delimiter sniffing reads the first line only, so the whole file arrives RAGGED — one cell in row 0, two in the rest.',
    bytes: async () => utf8Bytes('Quarterly report\nTerm,Students\nFall,120\n'),
  },
  {
    id: 'csv-ragged-rows',
    extension: '.csv',
    detects: undefined,
    standsInFor: 'A CSV whose rows disagree about how many fields they have — a hand-edited export, or one whose last column is sometimes omitted. Design fact 17: the grid comes back ragged, which is exactly what the table audit refuses.',
    bytes: async () => utf8Bytes('Term,Students,Notes\nFall,120\nSpring,98,make-up week,extra\n'),
  },
  {
    id: 'csv-ordinary',
    extension: '.csv',
    detects: undefined,
    standsInFor: 'The one CSV shape that works: a header row, then data, nothing above it. Committed so the verdict rests on what the format does in general rather than only on its failures.',
    bytes: async () => utf8Bytes('Term,Students\nFall,120\nSpring,98\n'),
  },
]
