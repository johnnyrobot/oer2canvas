// The production-artifact smoke imports this fixture with Node's strip-types
// loader, whose ESM resolver requires the source extension. Vite also accepts
// it; TypeScript's no-emit project rejects only the spelling of the path.
// @ts-expect-error -- shared browser/Node test fixture; see above.
import { writeZip } from '../../engine/export/zip.ts'

const utf8 = (value: string) => new TextEncoder().encode(value)

const ONE_PIXEL_PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
), (character) => character.charCodeAt(0))

export async function semanticDocxFixture(
  {
    embeddedImage = false,
    unresolvedLink = false,
  }: { embeddedImage?: boolean; unresolvedLink?: boolean } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const imageRelationship = embeddedImage
    ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>'
    : ''
  const imageParagraph = embeddedImage
    ? `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Diagram" descr="Cell diagram"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr/><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    : ''
  const unresolvedLinkParagraph = unresolvedLink
    ? '<w:p><w:hyperlink w:anchor="missing-section"><w:r><w:t>Missing section</w:t></w:r></w:hyperlink></w:p>'
    : ''

  const entries = [
    {
      name: '[Content_Types].xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`),
    },
    {
      name: '_rels/.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.edu/cells" TargetMode="External"/>
  ${imageRelationship}
</Relationships>`),
    },
    {
      name: 'word/styles.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
</w:styles>`),
    },
    {
      name: 'word/numbering.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`),
    },
    {
      name: 'word/document.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:bookmarkStart w:id="0" w:name="cell-biology"/><w:r><w:t>Cell Biology</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>
  <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Cells</w:t></w:r><w:r><w:t xml:space="preserve"> are </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>organized</w:t></w:r><w:r><w:t xml:space="preserve"> &lt;unsafe &amp; literal&gt;. </w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:t>Read the cell guide</w:t></w:r></w:hyperlink></w:p>
  <w:p><w:hyperlink w:anchor="cell-biology"><w:r><w:t>Return to Cell Biology</w:t></w:r></w:hyperlink></w:p>
  ${unresolvedLinkParagraph}
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Membrane</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Cytoplasm</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Observe</w:t></w:r></w:p>
  <w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Structure</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Function</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Nucleus</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Stores DNA</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  ${imageParagraph}
  <w:sectPr/>
</w:body></w:document>`),
    },
    ...(embeddedImage ? [{ name: 'word/media/image1.png', data: ONE_PIXEL_PNG }] : []),
  ]
  return new Uint8Array(await writeZip(entries))
}
