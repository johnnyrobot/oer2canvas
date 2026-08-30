/**
 * Measure what anydoc extracts from a set of documents, so a support verdict
 * rests on numbers someone else can reproduce.
 *
 * Written for issue 15, which used it to decide that legacy `.doc` and `.ppt`
 * stay disabled (`.scratch/document-import/15-evaluate-legacy-doc-ppt-design.md`
 * carries the facts). Nothing in `src/` imports this; it runs the same
 * `anydoc_wasm_bg.wasm` the browser Worker loads, through `initSync`, so the
 * numbers describe the shipped parser rather than a Node-only build of it.
 *
 * ## Usage
 *
 *   node scripts/measure-legacy-office.mjs <file-or-directory>...
 *   node scripts/measure-legacy-office.mjs --pair <left.tsv> <right.tsv>
 *
 * The first form prints one TSV row per file. The second joins two of those
 * runs on the filename stem (`report.doc` pairs with `report.docx`) and prints
 * the difference in each column, plus totals.
 *
 * ## How to use it honestly
 *
 * A legacy file has to come from somewhere, and on most machines it has to be
 * produced — e.g. with LibreOffice:
 *
 *   soffice --headless --convert-to 'doc:MS Word 97'      --outdir legacy in.docx
 *   soffice --headless --convert-to 'ppt:MS PowerPoint 97' --outdir legacy in.pptx
 *
 * DO NOT then compare the original against the converted file and attribute the
 * difference to the parser. Issue 15 measured that trap: converting a
 * hand-authored DOCX fixture `.docx` → `.docx` THROUGH LibreOffice loses the
 * same headings, lists and table boundary that `.docx` → `.doc` loses. Those
 * losses belong to the converter.
 *
 * Attribute a loss to the parser only against a READ-BACK — convert the legacy
 * file to the modern format and measure THAT:
 *
 *   soffice --headless --convert-to docx --outdir back legacy/report.doc
 *   node scripts/measure-legacy-office.mjs legacy > legacy.tsv
 *   node scripts/measure-legacy-office.mjs back   > back.tsv
 *   node scripts/measure-legacy-office.mjs --pair back.tsv legacy.tsv
 *
 * Both sides are then anydoc reading the SAME bytes, once directly and once
 * through a second implementation of the same format. Content in the read-back
 * and not in the direct reading is content anydoc's reader lost.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { initSync, formatFromBytes, toDocument } from '@firecrawl/anydoc-wasm'

const COLUMNS = [
  'file', 'bytes', 'detected', 'ms', 'wasmMiB', 'status', 'blocks', 'headings', 'levels',
  'paragraphs', 'lists', 'tables', 'quotes', 'math', 'inlineMath', 'images', 'imageAlt', 'links',
  'notes', 'noteRefs', 'assets', 'assetTypes', 'chars', 'detail',
]
/** Columns the `--pair` mode sums; the rest are compared but not totalled. */
const NUMERIC = new Set([
  'blocks', 'headings', 'paragraphs', 'lists', 'tables', 'quotes', 'math', 'inlineMath', 'images',
  'imageAlt', 'links', 'notes', 'noteRefs', 'assets', 'chars',
])

const wasmUrl = new URL('../node_modules/@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm', import.meta.url)
const runtime = initSync({ module: await readFile(wasmUrl) })

function tallyInlines(inlines, tally) {
  for (const inline of inlines ?? []) {
    if (inline.kind === 'text') tally.chars += (inline.text ?? '').length
    // Counted apart from the `math` BLOCK: an equation set on its own line and
    // one inside a sentence are different findings downstream.
    if (inline.kind === 'math') tally.inlineMath += 1
    if (inline.kind === 'image') {
      tally.images += 1
      if ((inline.alt ?? '') !== '') tally.imageAlt += 1
    }
    if (inline.kind === 'link') {
      tally.links += 1
      tallyInlines(inline.content, tally)
    }
    if (inline.kind === 'noteRef') tally.noteRefs += 1
  }
}

/** Every block at every depth: cells and list items are content too. */
function tallyBlocks(blocks, tally) {
  for (const block of blocks ?? []) {
    tally.blocks += 1
    tally.kinds[block.kind] = (tally.kinds[block.kind] ?? 0) + 1
    if (block.kind === 'heading') tally.levels[block.level] = (tally.levels[block.level] ?? 0) + 1
    tallyInlines(block.content, tally)
    tallyBlocks(block.blocks, tally)
    for (const item of block.list?.items ?? []) tallyBlocks(item.blocks, tally)
    for (const row of block.table?.grid ?? []) {
      for (const slot of row) tallyBlocks(slot.cell?.blocks, tally)
    }
  }
}

async function measure(path) {
  const bytes = new Uint8Array(await readFile(path))
  const detected = formatFromBytes(bytes)
  const tally = {
    blocks: 0, kinds: {}, levels: {}, chars: 0, inlineMath: 0, images: 0, imageAlt: 0, links: 0,
    noteRefs: 0,
  }
  let status = 'ok'
  let detail = ''
  let notes = 0
  let assets = 0
  const assetTypes = {}
  const started = performance.now()
  try {
    const document = toDocument(bytes, detected)
    tallyBlocks(document.blocks, tally)
    for (const note of document.notes) tallyBlocks(note.blocks, tally)
    notes = document.notes.length
    assets = document.assets.length
    for (const asset of document.assets) {
      assetTypes[asset.mediaType] = (assetTypes[asset.mediaType] ?? 0) + 1
    }
  } catch (error) {
    // A refusal is a measurement, not an error: `code` is anydoc's own
    // `ConvertErrorCode`, and which code a damaged file earns is exactly what a
    // malformed-input assessment needs to record.
    status = `refused:${error?.code ?? 'none'}`
    detail = String(error?.message ?? error).replaceAll('\t', ' ').slice(0, 160)
  }
  return {
    file: basename(path),
    bytes: bytes.byteLength,
    detected: detected ?? 'undetected',
    ms: Math.round(performance.now() - started),
    wasmMiB: Math.round(runtime.memory.buffer.byteLength / 1048576),
    status,
    blocks: tally.blocks,
    headings: Object.values(tally.levels).reduce((total, count) => total + count, 0),
    levels: JSON.stringify(tally.levels),
    paragraphs: tally.kinds.paragraph ?? 0,
    lists: tally.kinds.list ?? 0,
    tables: tally.kinds.table ?? 0,
    quotes: tally.kinds.blockQuote ?? 0,
    math: tally.kinds.math ?? 0,
    inlineMath: tally.inlineMath,
    images: tally.images,
    imageAlt: tally.imageAlt,
    links: tally.links,
    notes,
    noteRefs: tally.noteRefs,
    assets,
    assetTypes: JSON.stringify(assetTypes),
    chars: tally.chars,
    detail,
  }
}

async function filesUnder(target) {
  const entry = await stat(target)
  if (!entry.isDirectory()) return [target]
  const names = await readdir(target)
  return names.filter((name) => extname(name) !== '').map((name) => join(target, name)).sort()
}

async function readTsv(path) {
  const [header, ...rows] = (await readFile(path, 'utf8')).trim().split('\n')
  const keys = header.split('\t')
  return rows.map((row) => Object.fromEntries(row.split('\t').map((value, index) => [keys[index], value])))
}

const stem = (name) => name.replace(/\.[^.]+$/, '')

async function pair(leftPath, rightPath) {
  const left = await readTsv(leftPath)
  const right = new Map((await readTsv(rightPath)).map((row) => [stem(row.file), row]))
  const totals = {}
  console.log(['file', ...COLUMNS.slice(2, -1)].join('\t'))
  for (const row of left) {
    const other = right.get(stem(row.file))
    if (!other) {
      console.log(`${row.file}\t(no counterpart in ${basename(rightPath)})`)
      continue
    }
    const cells = COLUMNS.slice(2, -1).map((column) =>
      row[column] === other[column] ? row[column] : `${row[column]} -> ${other[column]}`)
    for (const column of COLUMNS.slice(2, -1)) {
      if (!NUMERIC.has(column)) continue
      totals[column] ??= [0, 0]
      totals[column][0] += Number(row[column])
      totals[column][1] += Number(other[column])
    }
    console.log([row.file, ...cells].join('\t'))
  }
  console.log('')
  for (const [column, [leftTotal, rightTotal]] of Object.entries(totals)) {
    const verdict = leftTotal === rightTotal ? 'same' : `${rightTotal - leftTotal >= 0 ? '+' : ''}${rightTotal - leftTotal}`
    console.log(`TOTAL ${column}: ${basename(leftPath)}=${leftTotal} ${basename(rightPath)}=${rightTotal} (${verdict})`)
  }
}

const args = process.argv.slice(2)
if (args[0] === '--pair') {
  if (args.length !== 3) {
    console.error('usage: measure-legacy-office.mjs --pair <left.tsv> <right.tsv>')
    process.exit(2)
  }
  await pair(args[1], args[2])
} else if (args.length === 0) {
  console.error('usage: measure-legacy-office.mjs <file-or-directory>...  |  --pair <left.tsv> <right.tsv>')
  process.exit(2)
} else {
  console.log(COLUMNS.join('\t'))
  for (const target of args) {
    for (const path of await filesUnder(target)) {
      const row = await measure(path)
      console.log(COLUMNS.map((column) => row[column]).join('\t'))
    }
  }
}
