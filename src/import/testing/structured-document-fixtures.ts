// Node's strip-types loader is used by the production-artifact smoke and
// requires explicit source extensions for its ESM imports.
// @ts-expect-error -- shared browser/Node test fixture.
import { writeZip } from '../../engine/export/zip.ts'
// @ts-expect-error -- shared browser/Node test fixture; see above.
import { RASTER_FIXTURES } from './raster-fixtures.ts'

const utf8 = (value: string) => new TextEncoder().encode(value)

// XHTML text content: only `&`/`<`/`>` are unsafe here, the same rule as
// `docx-fixture.ts`'s matching helper. Used by the `text` options this
// module's builders add for the RTL/CJK corpus case.
const xmlEscape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

// The same Canvas-proven 16x16 PNG the DOCX fixture embeds (see
// `docx-fixture.ts`'s `EMBEDDED_IMAGE_PNG`), reused here so all four formats
// exercise packaging against IDENTICAL bytes rather than four fixtures that
// each merely claim to carry "an image".
const EMBEDDED_IMAGE_PNG = RASTER_FIXTURES.png.bytes

function longParagraphs(count: number, tag: (index: number) => string): string {
  return Array.from({ length: count }, (_unused, index) => tag(index + 1)).join('')
}

export async function semanticOdtFixture(
  {
    additionalParagraphs = 0,
    embeddedImage = false,
    noAltCarrier = false,
  }: { additionalParagraphs?: number; embeddedImage?: boolean; noAltCarrier?: boolean } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  // ODT stores an embedded picture as an ordinary file inside the package
  // (conventionally under `Pictures/`) and references it from a
  // `<draw:frame><draw:image xlink:href="...">` pair — there is no inline
  // binary encoding the way RTF needs. `<svg:desc>` is the ODT alt-text
  // carrier anydoc reads into `Inline.alt`. `noAltCarrier` omits it — verified
  // empirically that a `<draw:frame>` with no `<svg:desc>` collapses to
  // `alt === ''`, the same as RTF's `\pict` (which has no carrier at all) and
  // as DOCX/EPUB with their own alt attribute left out. This is what
  // `anydoc-html.ts` treats as UNDESCRIBED rather than deliberately
  // decorative — see its `altAttribute` comment.
  const imageParagraph = embeddedImage
    ? noAltCarrier
      ? '<text:p><draw:frame draw:name="Diagram" svg:width="1cm" svg:height="1cm">' +
        '<draw:image xlink:href="Pictures/diagram.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>' +
        '</draw:frame></text:p>'
      : '<text:p><draw:frame draw:name="Diagram" svg:width="1cm" svg:height="1cm">' +
        '<draw:image xlink:href="Pictures/diagram.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>' +
        '<svg:desc>Cell diagram</svg:desc></draw:frame></text:p>'
    : ''
  const imageManifestEntry = embeddedImage
    ? '<manifest:file-entry manifest:full-path="Pictures/diagram.png" manifest:media-type="image/png"/>'
    : ''

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  office:version="1.2">
  <office:body><office:text>
    <text:h text:outline-level="1">Cell Biology</text:h>
    <text:p>Cells are organized. <text:a xlink:href="https://example.edu/cells">Read the cell guide</text:a></text:p>
    ${imageParagraph}
    <text:list>
      <text:list-item><text:p>Membrane</text:p></text:list-item>
      <text:list-item><text:p>Cytoplasm</text:p></text:list-item>
    </text:list>
    <table:table table:name="Structures">
      <table:table-header-rows><table:table-row>
        <table:table-cell office:value-type="string"><text:p>Structure</text:p></table:table-cell>
        <table:table-cell office:value-type="string"><text:p>Function</text:p></table:table-cell>
      </table:table-row></table:table-header-rows>
      <table:table-row>
        <table:table-cell office:value-type="string"><text:p>Nucleus</text:p></table:table-cell>
        <table:table-cell office:value-type="string"><text:p>Stores DNA</text:p></table:table-cell>
      </table:table-row>
    </table:table>
    ${longParagraphs(additionalParagraphs, (index) => `<text:p>Long ODT paragraph ${index}.</text:p>`)}
  </office:text></office:body>
</office:document-content>`

  return new Uint8Array(await writeZip([
    { name: 'mimetype', data: utf8('application/vnd.oasis.opendocument.text') },
    {
      name: 'META-INF/manifest.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  ${imageManifestEntry}
</manifest:manifest>`),
    },
    { name: 'content.xml', data: utf8(content) },
    ...(embeddedImage ? [{ name: 'Pictures/diagram.png', data: EMBEDDED_IMAGE_PNG }] : []),
  ]))
}

export async function semanticEpubFixture(
  {
    additionalParagraphs = 0,
    embeddedImage = false,
    noAltCarrier = false,
    mergedCells = false,
    deepHeadings = false,
    footnote = false,
    equation = false,
    text,
  }: {
    additionalParagraphs?: number
    embeddedImage?: boolean
    noAltCarrier?: boolean
    // A `<td colspan="2">` header cell — ordinary HTML, which is exactly why
    // it matters: EPUB carries a table as real XHTML rather than a package
    // format's own grid model, so this is the format's most literal test of
    // `markup.ts`'s allowance of `colspan`/`rowspan` on `td`/`th` (see the
    // matching `mergedCells` option on `semanticDocxFixture` for the DOCX
    // side of the same property).
    mergedCells?: boolean
    // `<h2>`/`<h3>`/`<h4>` nested under the fixture's own `<h1>`. EPUB's
    // headings are literal HTML heading tags, no style-to-outline-level
    // translation the way DOCX needs — so this is the property's simplest
    // possible carrier, deliberately unlike the DOCX side.
    deepHeadings?: boolean
    // An EPUB3 `epub:type="noteref"`/`epub:type="footnote"` pair — the
    // format's own footnote convention. Verified empirically against anydoc
    // 0.2.4 that this convention is NOT recognized as a note at all: no
    // `Document.notes` entry is produced, so the `unsupported-note` blocker
    // in `anydoc-html.ts` never fires, and the reference plus the footnote
    // BODY both flow through as ordinary anchored paragraph text. That is
    // the opposite of the DOCX footnote case, where the body is dropped and
    // only a blocking placeholder survives — the two together are what make
    // "footnotes" a property worth testing on both formats rather than one.
    footnote?: boolean
    // An inline MathML `<math>` element — verified empirically against
    // anydoc 0.2.4 to convert to the same `math` inline kind, with the same
    // LaTeX text (`x^{2}`), that DOCX's OMML equation produces. Unlike the
    // footnote property, EPUB and DOCX equations behave identically: both
    // become a visible `[Equation: ...]` blocker placeholder.
    equation?: boolean
    // Appends one extra paragraph verbatim, mirroring the option of the
    // same name added to `semanticDocxFixture`. See that option's comment
    // for why the RTL/CJK property needs it.
    text?: string
  } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  // EPUB is ordinary XHTML plus an OPF manifest: the image is a real
  // `<img>` referencing a package-relative file, which the manifest must
  // also list (a real EPUB reader — and anydoc — trusts the manifest's
  // declared media type over guessing from the extension). `noAltCarrier`
  // drops the `alt` attribute entirely — verified empirically that an
  // `<img>` with no `alt` at all collapses to `alt === ''`, exactly like
  // `alt=""` would; anydoc has no way to tell "missing" from "empty" apart.
  const imageParagraph = embeddedImage
    ? noAltCarrier
      ? '<p><img src="images/diagram.png"/></p>'
      : '<p><img src="images/diagram.png" alt="Cell diagram"/></p>'
    : ''
  const imageManifestItem = embeddedImage
    ? '<item id="diagram" href="images/diagram.png" media-type="image/png"/>'
    : ''
  const deepHeadingsBlock = deepHeadings
    ? '<h2>Membrane Structure</h2><h3>Phospholipid Bilayer</h3><h4>Hydrophobic Tails</h4>'
    : ''
  const mergedCellsTable = mergedCells
    ? '<table><tr><td colspan="2">Week</td></tr><tr><td>1</td><td>Intro to cells</td></tr></table>'
    : ''
  // `id`/`href` values below are arbitrary strings, not the anchor scheme
  // `anydoc` assigns internally (its own anchors are file-path-qualified —
  // see the `EPUB/chapter.xhtml#fn1` shape in the verification notes on the
  // `footnote` option above); they only need to resolve to each other
  // within this one chapter, which an ordinary same-document `href="#fn1"`
  // does.
  const footnoteMarkup = footnote
    ? '<p>Migration patterns vary<a epub:type="noteref" href="#fn1" id="fnref1">1</a>.</p>' +
      '<aside epub:type="footnote" id="fn1"><p>Source: field observation, 2019.</p></aside>'
    : ''
  const equationParagraph = equation
    ? '<p>Solve <math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup></math> for x.</p>'
    : ''
  const customTextParagraph = text ? `<p>${xmlEscape(text)}</p>` : ''

  const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Cell Biology</title></head><body>
  <h1 id="cell-biology">Cell Biology</h1>
  ${deepHeadingsBlock}
  <p>Cells are organized. <a href="https://example.edu/cells">Read the cell guide</a></p>
  ${imageParagraph}
  ${footnoteMarkup}
  ${equationParagraph}
  ${customTextParagraph}
  <ul><li>Membrane</li><li>Cytoplasm</li></ul>
  <table><thead><tr><th>Structure</th><th>Function</th></tr></thead>
    <tbody><tr><td>Nucleus</td><td>Stores DNA</td></tr></tbody></table>
  ${mergedCellsTable}
  ${longParagraphs(additionalParagraphs, (index) => `<p>Long EPUB paragraph ${index}.</p>`)}
</body></html>`

  return new Uint8Array(await writeZip([
    { name: 'mimetype', data: utf8('application/epub+zip') },
    {
      name: 'META-INF/container.xml',
      data: utf8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    },
    {
      name: 'EPUB/content.opf',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:oer2canvas-epub-fixture</dc:identifier>
    <dc:title>Biology Reader</dc:title><dc:creator>Ada Instructor</dc:creator><dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    ${imageManifestItem}
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`),
    },
    { name: 'EPUB/chapter.xhtml', data: utf8(chapter) },
    ...(embeddedImage ? [{ name: 'EPUB/images/diagram.png', data: EMBEDDED_IMAGE_PNG }] : []),
  ]))
}

export function semanticRtfFixture(
  {
    additionalParagraphs = 0,
    embeddedImage = false,
  }: { additionalParagraphs?: number; embeddedImage?: boolean } = {},
): Uint8Array<ArrayBuffer> {
  const extra = longParagraphs(
    additionalParagraphs,
    (index) => String.raw`\pard\s0 Long RTF paragraph ${index}.\par
`,
  )
  // RTF has no filesystem to embed a picture INTO — the bytes themselves
  // ride in the document stream as a hex-encoded `\pict` destination.
  // `\pngblip` names the encoding; `picw`/`pich` are the format's OWN
  // declared dimensions, which `assets.ts` deliberately never trusts —
  // intrinsic size always comes from sniffing the actual bytes, so a lying
  // `picw`/`pich` here would not change what gets packaged.
  //
  // RTF's `\pict` destination has NO attribute that could carry alt text at
  // all, so every RTF image takes this path unconditionally. That is NOT a
  // property unique to RTF, though: verified empirically against anydoc
  // 0.2.4 directly, DOCX (no `descr`), EPUB (no `alt`) and ODT (no
  // `<svg:desc>`) collapse to the exact same `alt === ''` the moment their
  // OWN optional alt carrier is left out — anydoc never reports `undefined`
  // for any of the four formats. RTF is just the one format where that
  // carrier can never exist in the first place, not the one format where
  // this behaviour exists at all. See the `noAltCarrier`-gated cases in
  // `document.browser.test.ts` for DOCX/EPUB/ODT pinned the same way.
  const imageHex = Array.from(EMBEDDED_IMAGE_PNG)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const imageParagraph = embeddedImage
    ? String.raw`\pard\s0{\pict\pngblip\picw16\pich16\picwgoal240\pichgoal240 ${imageHex}}\par
`
    : ''
  return utf8(String.raw`{\rtf1\ansi\deff0
{\fonttbl{\f0 Arial;}}
{\stylesheet{\s0 Normal;}{\s1\outlinelevel0\b\fs32 Heading 1;}}
{\*\listtable{\list\listtemplateid1{\listlevel\levelnfc23\leveljc0\levelfollow0\levelstartat1{\leveltext\'01\u8226 ?;}{\levelnumbers;}\f0\fi-360\li720}\listid1}}
{\*\listoverridetable{\listoverride\listid1\listoverridecount0\ls1}}
\viewkind4\uc1
\pard\s1 Cell Biology\par
\pard\s0 Cells are organized. {\field{\*\fldinst{HYPERLINK "https://example.edu/cells"}}{\fldrslt{Read the cell guide}}}\par
${imageParagraph}\pard\s0\ls1\ilvl0 Membrane\par
\pard\s0\ls1\ilvl0 Cytoplasm\par
${extra}\pard\s0\trowd\trhdr\cellx2400\cellx4800 Structure\cell Function\cell\row
\pard\s0\trowd\cellx2400\cellx4800 Nucleus\cell Stores DNA\cell\row
}
`)
}

export function malformedStructuredFixture(format: 'epub' | 'odt' | 'rtf'): Uint8Array<ArrayBuffer> {
  if (format === 'rtf') return utf8(String.raw`{\rtf1\ansi}`)
  return utf8(format === 'epub' ? 'not an EPUB container' : 'not an ODT container')
}
