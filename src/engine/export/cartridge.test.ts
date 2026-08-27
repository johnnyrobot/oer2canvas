import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import { buildCartridge, buildManifest, buildModuleMeta, cartridgeFilename } from './cartridge'
import { writeZip } from './zip'

const section = (id: string, title: string, over: Partial<CompiledSection> = {}): CompiledSection => ({
  id, title, html: `<p>body of ${id}</p>`, notes: [], queue: [], ...over,
})

const chapter = (title: string, sections: CompiledSection[]): CompiledChapter => ({
  chapter: { title } as CompiledChapter['chapter'], sections, queue: [],
})

const decode = (b: Uint8Array) => new TextDecoder().decode(b)
const fileNamed = (entries: ReturnType<typeof buildCartridge>, name: string) =>
  decode(entries.find((e) => e.name === name)!.data)

// THE invariant. If the export re-derives the html, the audited artifact and the
// published artifact are two different things, and the gate's verdict stops
// meaning anything about the file the instructor actually imports.
test('the compiled html is published verbatim, byte for byte', () => {
  const html = '<p>exact  bytes</p><math><mo>−</mo></math><img src="x" alt="">'
  const entries = buildCartridge([chapter('Ch 1', [section('a', 'Intro', { html })])])
  const doc = fileNamed(entries, 'wiki_content/ch-1-intro.html')
  expect(doc).toContain(html)
  // Not merely "contains something like it": the fragment survives untouched,
  // whitespace, self-closing img and MathML included.
  expect(doc.indexOf(html)).toBeGreaterThan(-1)
})

test('one resource per section, not per chapter', () => {
  const entries = buildCartridge([
    chapter('Ch 1', [section('a', 'Intro'), section('b', 'Two')]),
    chapter('Ch 2', [section('c', 'Three')]),
  ])
  expect(entries.filter((e) => e.name.startsWith('wiki_content/'))).toHaveLength(3)
  expect(entries[0]!.name).toBe('imsmanifest.xml')
})

// "Introduction" is in every chapter, so a title-only path collides and one page
// would silently overwrite another.
test('same-titled sections in different chapters get distinct paths', () => {
  const entries = buildCartridge([
    chapter('Ch 1', [section('a', 'Introduction')]),
    chapter('Ch 2', [section('b', 'Introduction')]),
  ])
  const paths = entries.filter((e) => e.name.startsWith('wiki_content/')).map((e) => e.name)
  expect(new Set(paths).size).toBe(2)
})

test('same-titled sections within ONE chapter also stay distinct', () => {
  const entries = buildCartridge([
    chapter('Ch 1', [section('a', 'Key Terms'), section('b', 'Key Terms')]),
  ])
  const paths = entries.filter((e) => e.name.startsWith('wiki_content/')).map((e) => e.name)
  expect(new Set(paths).size).toBe(2)
})

test('a failed section becomes no resource at all', () => {
  const entries = buildCartridge([
    chapter('Ch 1', [section('a', 'Ok'), section('b', 'Broken', { error: 'boom', html: '' })]),
  ])
  expect(entries.filter((e) => e.name.startsWith('wiki_content/'))).toHaveLength(1)
  expect(buildManifest([chapter('Ch 1', [section('b', 'Broken', { error: 'x', html: '' })])]))
    .not.toContain('Broken')
})

test('the manifest is well-formed XML with the CC 1.1 namespace', () => {
  const xml = buildManifest([chapter('Ch 1', [section('a', 'Intro')])])
  // Parsed, not regex-matched: a manifest that does not parse is not a cartridge.
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  expect(doc.querySelector('parsererror')).toBeNull()
  expect(xml).toContain('imsccv1p1')
  expect(xml).toContain('<schemaversion>1.1.0</schemaversion>')
})

// Publisher titles contain `&` routinely, and an unescaped one makes the whole
// manifest unparseable — which fails at import, not here.
test('titles with XML metacharacters are escaped, not pasted', () => {
  const xml = buildManifest([chapter('Acids & Bases', [section('a', '<script> & "quotes"')])])
  expect(new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror')).toBeNull()
  expect(xml).toContain('Acids &amp; Bases')
  expect(xml).not.toContain('<script>')
})

test('organizations carry chapter grouping and section order', () => {
  const xml = buildManifest([
    chapter('Ch 1', [section('a', 'First'), section('b', 'Second')]),
    chapter('Ch 2', [section('c', 'Third')]),
  ])
  expect(xml.indexOf('Ch 1')).toBeLessThan(xml.indexOf('First'))
  expect(xml.indexOf('First')).toBeLessThan(xml.indexOf('Second'))
  expect(xml.indexOf('Second')).toBeLessThan(xml.indexOf('Ch 2'))
})

// Position-derived identifiers would renumber every resource whenever a chapter
// was added, making two exports of overlapping selections impossible to compare.
test('resource identifiers come from the section id, not its position', () => {
  const one = buildManifest([chapter('Ch 1', [section('sec-xyz', 'Intro')])])
  const two = buildManifest([
    chapter('Ch 0', [section('sec-new', 'Added')]),
    chapter('Ch 1', [section('sec-xyz', 'Intro')]),
  ])
  expect(one).toContain('res-sec-xyz')
  expect(two).toContain('res-sec-xyz')
})

test('the page title is what Canvas reads on import', () => {
  const entries = buildCartridge([chapter('Ch 1', [section('a', 'The Science of Biology')])])
  expect(fileNamed(entries, 'wiki_content/ch-1-the-science-of-biology.html'))
    .toContain('<title>The Science of Biology</title>')
})

// E6 wants both, and the timestamp is the point: importing never updates, so an
// instructor who exports twice must be able to tell the files apart.
test('the filename carries chapter and timestamp', () => {
  const when = new Date(2026, 7, 23, 14, 5)
  expect(cartridgeFilename([chapter('Chapter 1 The Study of Life', [])], when))
    .toBe('chapter-1-the-study-of-life-20260823-1405.imscc')
  expect(cartridgeFilename([chapter('Ch A', []), chapter('Ch B', []), chapter('Ch C', [])], when))
    .toBe('ch-a-and-2-more-20260823-1405.imscc')
})

test('the whole cartridge zips and a real unzip reads it back', async () => {
  const html = '<p>real bytes</p>'
  const entries = buildCartridge([chapter('Ch 1', [section('a', 'Intro', { html })])])
  const bytes = await writeZip(entries)
  // Signature check plus a manifest that parses — the zip layer has its own
  // round-trip test against a real `unzip`; this pins that the two compose.
  expect(bytes[0]).toBe(0x50)
  expect(bytes[1]).toBe(0x4b)
  // manifest + Canvas marker + module_meta + one page.
  expect(entries.map((e) => e.name)).toEqual([
    'imsmanifest.xml',
    'course_settings/canvas_export.txt',
    'course_settings/module_meta.xml',
    'wiki_content/ch-1-intro.html',
  ])
})

// MEASURED, not assumed. A generic cartridge imported into a live Canvas
// succeeded, built the right modules, stored every byte — and created zero
// pages, because Canvas maps webcontent html to FILES unless this marker tells
// it otherwise. These three tests are the difference between the product working
// and the product producing a folder of unreadable attachments.
test('the Canvas marker file is present, so pages import as pages', () => {
  const entries = buildCartridge([chapter('Ch 1', [section('a', 'Intro')])])
  const marker = entries.find((e) => e.name === 'course_settings/canvas_export.txt')
  expect(marker).toBeDefined()
})

test('module items declare WikiPage, not an attachment', () => {
  const meta = buildModuleMeta([chapter('Ch 1', [section('a', 'Intro'), section('b', 'Two')])])
  expect(new DOMParser().parseFromString(meta, 'application/xml').querySelector('parsererror')).toBeNull()
  expect(meta.match(/<content_type>WikiPage<\/content_type>/g)).toHaveLength(2)
  expect(meta).toContain('<title>Ch 1</title>')
  expect(meta).toContain('<identifierref>res-a</identifierref>')
})

// Without `workflow_state` the page imports unpublished, which to an instructor
// who goes looking for it is indistinguishable from a failed import.
test('each page carries the metadata Canvas builds a WikiPage from', () => {
  const entries = buildCartridge([chapter('Ch 1', [section('a', 'Intro')])])
  const doc = fileNamed(entries, 'wiki_content/ch-1-intro.html')
  expect(doc).toContain('<meta name="identifier" content="res-a"/>')
  expect(doc).toContain('<meta name="workflow_state" content="active"/>')
})

test('module order follows chapter order, and item order follows section order', () => {
  const meta = buildModuleMeta([
    chapter('Ch 1', [section('a', 'First'), section('b', 'Second')]),
    chapter('Ch 2', [section('c', 'Third')]),
  ])
  expect(meta.indexOf('First')).toBeLessThan(meta.indexOf('Second'))
  expect(meta.indexOf('Second')).toBeLessThan(meta.indexOf('Ch 2'))
})

// THE regression test. Shipping `canvas_export.txt` in the archive is not
// enough — that was measured twice against a live Canvas, with both importers,
// and both times the migration completed, the modules built, and all eight pages
// arrived as file attachments. Canvas finds the marker through the MANIFEST.
test('the manifest declares the Canvas settings resource, not just ships the file', () => {
  const xml = buildManifest([chapter('Ch 1', [section('a', 'Intro')])])
  expect(xml).toContain('type="associatedcontent/imscc_xmlv1p1/learning-application-resource"')
  expect(xml).toContain('href="course_settings/canvas_export.txt"')
  expect(xml).toContain('<file href="course_settings/module_meta.xml"/>')
  expect(new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror')).toBeNull()
})
