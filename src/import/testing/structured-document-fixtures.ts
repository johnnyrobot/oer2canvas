// Node's strip-types loader is used by the production-artifact smoke and
// requires explicit source extensions for its ESM imports.
// @ts-expect-error -- shared browser/Node test fixture.
import { writeZip } from '../../engine/export/zip.ts'

const utf8 = (value: string) => new TextEncoder().encode(value)

function longParagraphs(count: number, tag: (index: number) => string): string {
  return Array.from({ length: count }, (_unused, index) => tag(index + 1)).join('')
}

export async function semanticOdtFixture(
  { additionalParagraphs = 0 }: { additionalParagraphs?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  office:version="1.2">
  <office:body><office:text>
    <text:h text:outline-level="1">Cell Biology</text:h>
    <text:p>Cells are organized. <text:a xlink:href="https://example.edu/cells">Read the cell guide</text:a></text:p>
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
</manifest:manifest>`),
    },
    { name: 'content.xml', data: utf8(content) },
  ]))
}

export async function semanticEpubFixture(
  { additionalParagraphs = 0 }: { additionalParagraphs?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cell Biology</title></head><body>
  <h1 id="cell-biology">Cell Biology</h1>
  <p>Cells are organized. <a href="https://example.edu/cells">Read the cell guide</a></p>
  <ul><li>Membrane</li><li>Cytoplasm</li></ul>
  <table><thead><tr><th>Structure</th><th>Function</th></tr></thead>
    <tbody><tr><td>Nucleus</td><td>Stores DNA</td></tr></tbody></table>
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
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`),
    },
    { name: 'EPUB/chapter.xhtml', data: utf8(chapter) },
  ]))
}

export function semanticRtfFixture(
  { additionalParagraphs = 0 }: { additionalParagraphs?: number } = {},
): Uint8Array<ArrayBuffer> {
  const extra = longParagraphs(
    additionalParagraphs,
    (index) => String.raw`\pard\s0 Long RTF paragraph ${index}.\par
`,
  )
  return utf8(String.raw`{\rtf1\ansi\deff0
{\fonttbl{\f0 Arial;}}
{\stylesheet{\s0 Normal;}{\s1\outlinelevel0\b\fs32 Heading 1;}}
{\*\listtable{\list\listtemplateid1{\listlevel\levelnfc23\leveljc0\levelfollow0\levelstartat1{\leveltext\'01\u8226 ?;}{\levelnumbers;}\f0\fi-360\li720}\listid1}}
{\*\listoverridetable{\listoverride\listid1\listoverridecount0\ls1}}
\viewkind4\uc1
\pard\s1 Cell Biology\par
\pard\s0 Cells are organized. {\field{\*\fldinst{HYPERLINK "https://example.edu/cells"}}{\fldrslt{Read the cell guide}}}\par
\pard\s0\ls1\ilvl0 Membrane\par
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
