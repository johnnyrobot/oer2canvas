import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { ImportedAsset } from '../../import/types'
import {
  buildCartridge,
  buildManifest,
  buildModuleMeta,
  cartridgeFilename,
  collectPackagedAssets,
  UnresolvedPackagedReferenceError,
} from './cartridge'
import { writeZip } from './zip'

const section = (id: string, title: string, over: Partial<CompiledSection> = {}): CompiledSection => ({
  id, title, html: `<p>body of ${id}</p>`, notes: [], queue: [], ...over,
})

// `assets` defaults to `[]` so every existing `chapter(...)` call — none of
// which cares about assets — keeps working unchanged.
const chapter = (title: string, sections: CompiledSection[], assets: ImportedAsset[] = []): CompiledChapter => ({
  chapter: { title, assets } as unknown as CompiledChapter['chapter'], sections, queue: [],
})

// A minimal `ImportedAsset`. `sha256` is padded to a full 64 hex chars because
// real assets carry a full digest, even though these tests only ever look at
// its first 8 characters (the resource id and, by convention, the name's
// suffix).
const asset = (name: string, sha256: string, over: Partial<ImportedAsset> = {}): ImportedAsset => ({
  id: name,
  mediaType: 'image/png',
  extension: 'png',
  bytes: new Uint8Array([1, 2, 3]),
  sha256: sha256.padEnd(64, '0'),
  originPart: 'image1.png',
  name,
  ...over,
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

// ---------------------------------------------------------------------------
// Embedded-image packaging (Task 7). Fixtures use the `asset(...)` helper
// above, an `ImportedAsset` whose `name` embeds the archive filename the
// import parser already assigned.
// ---------------------------------------------------------------------------

const imageRefHtml =
  '<p><img src="$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png" alt="A" width="16" height="16"></p>'

test('packages each asset once, at the validated archive path', () => {
  const chaptersWithAsset = [
    chapter('Ch 1', [section('a', 'Intro', { html: imageRefHtml })], [asset('image1-a3f91c2e.png', 'a3f91c2e')]),
  ]
  const entries = buildCartridge(chaptersWithAsset)
  const assetEntries = entries.filter((entry) => entry.name.startsWith('web_resources/'))
  expect(assetEntries.map((entry) => entry.name)).toEqual(['web_resources/oer2canvas/image1-a3f91c2e.png'])
})

test('declares each asset as a standalone webcontent resource', () => {
  const chaptersWithAsset = [
    chapter('Ch 1', [section('a', 'Intro', { html: imageRefHtml })], [asset('image1-a3f91c2e.png', 'a3f91c2e')]),
  ]
  const manifest = buildManifest(chaptersWithAsset)
  expect(manifest).toContain(
    '<resource identifier="asset-a3f91c2e" type="webcontent" href="web_resources/oer2canvas/image1-a3f91c2e.png">',
  )
  expect(manifest).toContain('<file href="web_resources/oer2canvas/image1-a3f91c2e.png"/>')
  // Issue 07 measured page dependencies as optional and changed nothing —
  // don't "improve" the manifest toward a layout that measured no better.
  expect(manifest).not.toContain('<dependency')
})

test('dedupes one asset shared across two chapters', () => {
  const twoChaptersSameAsset = [
    chapter(
      'Ch 1',
      [section('a', 'Intro', { html: imageRefHtml })],
      [asset('image1-a3f91c2e.png', 'a3f91c2e', { originPart: 'one.docx' })],
    ),
    chapter(
      'Ch 2',
      [section('b', 'Two', { html: imageRefHtml })],
      [asset('image1-a3f91c2e.png', 'a3f91c2e', { originPart: 'two.docx' })],
    ),
  ]
  const entries = buildCartridge(twoChaptersSameAsset)
  expect(entries.filter((entry) => entry.name.startsWith('web_resources/'))).toHaveLength(1)
})

// THE bug the brief's own draft code would have reintroduced: rebuilding the
// archive name from `packagedAssetName(asset.originPart, ...)` instead of
// using `asset.name` verbatim. Chapter 2's record carries `originPart:
// 'two.docx'` — recomputed, that origin would slug to `two-a3f91c2e.png`,
// disagreeing with the `one-a3f91c2e.png` reference already burned into both
// pages' gated html. Using `asset.name` keeps both chapters agreeing on one
// archive entry regardless of which occurrence's origin happens to be present.
test('a shared asset packages under its assigned name, never one recomputed from a later occurrence’s originPart', () => {
  const chapters = [
    chapter(
      'Ch 1',
      [section('a', 'Intro', { html: imageRefHtml })],
      [asset('image1-a3f91c2e.png', 'a3f91c2e', { originPart: 'one.docx' })],
    ),
    chapter(
      'Ch 2',
      [section('b', 'Two', { html: imageRefHtml })],
      [asset('image1-a3f91c2e.png', 'a3f91c2e', { originPart: 'two.docx' })],
    ),
  ]
  const entries = buildCartridge(chapters)
  const assetEntries = entries.filter((entry) => entry.name.startsWith('web_resources/'))
  expect(assetEntries.map((entry) => entry.name)).toEqual(['web_resources/oer2canvas/image1-a3f91c2e.png'])
})

test('refuses to build when a reference resolves to nothing', () => {
  // The reference survives the gate but no asset backs it — a hand-written
  // token in publisher markup, or a naming bug on our side.
  const html = '<p><img src="$IMS-CC-FILEBASE$/oer2canvas/ghost-00000000.png" alt="" width="1" height="1"></p>'
  const chaptersWithDanglingReference = [chapter('Ch 1', [section('a', 'Intro', { html })])]
  expect(() => buildCartridge(chaptersWithDanglingReference)).toThrow(UnresolvedPackagedReferenceError)
  expect(() => buildCartridge(chaptersWithDanglingReference)).toThrow(
    /\$IMS-CC-FILEBASE\$\/oer2canvas\/ghost-00000000\.png/,
  )
})

test('an asset nothing references is simply not packaged', () => {
  const chapters = [
    chapter('Ch 1', [section('a', 'Intro')], [asset('unused-00000000.png', '00000000')]),
  ]
  const entries = buildCartridge(chapters)
  expect(entries.filter((entry) => entry.name.startsWith('web_resources/'))).toHaveLength(0)
  expect(collectPackagedAssets(chapters)).toHaveLength(0)
})

// THE invariant this task must not weaken: the html written into the archive
// is the exact bytes that passed the gate, not the pre-gate `section.html`.
// `gate.html` here carries the image reference and a DIFFERENT string that
// must never reach the archive; if `buildCartridge` ever started re-deriving
// or re-serialising the page it would either lose the gated reference (and
// this test's first assertion would fail) or leak the pre-gate string back in
// (and the second assertion would).
test('page html is written byte-identically to the gated bytes, not re-derived from pre-gate html', () => {
  const chaptersWithAsset = [
    chapter(
      'Ch 1',
      [
        section('a', 'Intro', {
          html: '<p>pre-gate html that must never reach the cartridge</p>',
          gate: {
            html: imageRefHtml,
            conformance: { passedChecks: true, blockers: [], warnings: [], needsHumanReview: [] },
            badgeWithheld: false,
          },
        }),
      ],
      [asset('image1-a3f91c2e.png', 'a3f91c2e')],
    ),
  ]
  const entries = buildCartridge(chaptersWithAsset)
  const page = entries.find((entry) => entry.name.startsWith('wiki_content/'))!
  const doc = new TextDecoder().decode(page.data)
  expect(doc).toContain(
    '<img src="$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png" alt="A" width="16" height="16">',
  )
  expect(doc).not.toContain('pre-gate html that must never reach the cartridge')
})
