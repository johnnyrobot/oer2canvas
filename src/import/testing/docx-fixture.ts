// The production-artifact smoke imports this fixture with Node's strip-types
// loader, whose ESM resolver requires the source extension. Vite also accepts
// it; TypeScript's no-emit project rejects only the spelling of the path.
// @ts-expect-error -- shared browser/Node test fixture; see above.
import { writeZip } from '../../engine/export/zip.ts'
// @ts-expect-error -- shared browser/Node test fixture; see above.
import { RASTER_FIXTURES } from './raster-fixtures.ts'

const utf8 = (value: string) => new TextEncoder().encode(value)

// A 1x1 image is indistinguishable from a broken one and degenerate for a
// dimension decoder, so the embedded-image case uses the same Canvas-proven
// 16x16 PNG the raster fixtures share — not a synthetic pixel of its own.
const EMBEDDED_IMAGE_PNG = RASTER_FIXTURES.png.bytes

// SVG bytes are real, well-formed XML — nothing here is truncated or corrupt
// — but `sniffRaster` only recognizes PNG/JPEG/GIF/WebP signatures, so this
// is refused as `unsupported-type` regardless of what the OOXML part's own
// declared content type claims. That is exactly the "cannot package" half of
// the embedded-image split this fixture needs to pin.
const UNSUPPORTED_IMAGE_SVG = utf8('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>')

/**
 * A minimal DOCX whose body contains ONLY an embedded image — no heading, no
 * paragraph text, no table. This is the "figure-only" shape `document.ts`'s
 * no-readable-content guard used to reject outright, back when every image
 * left an `[Embedded image: ...]` text placeholder behind regardless of
 * whether it could be packaged. Now that a packageable image renders as a
 * bare `<img>` with no surrounding text, a real cover-page or plate-section
 * document must still import successfully.
 */
export async function imageOnlyDocxFixture(): Promise<Uint8Array<ArrayBuffer>> {
  const entries = [
    {
      name: '[Content_Types].xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
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
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`),
    },
    {
      name: 'word/document.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
  <w:p><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Cover" descr="Cover plate"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr/><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
  <w:sectPr/>
</w:body></w:document>`),
    },
    { name: 'word/media/image1.png', data: EMBEDDED_IMAGE_PNG },
  ]
  return new Uint8Array(await writeZip(entries))
}

export async function semanticDocxFixture(
  {
    embeddedImage = false,
    unsupportedImage = false,
    unresolvedLink = false,
    noAltCarrier = false,
    activeContent = false,
  }: {
    embeddedImage?: boolean
    unsupportedImage?: boolean
    unresolvedLink?: boolean
    // Omits `docPr`'s `descr` attribute — DOCX's alt-text carrier — entirely.
    // Verified empirically that a `docPr` with no `descr` at all collapses to
    // `alt === ''` in anydoc, the same as EPUB's missing `alt` and ODT's
    // missing `<svg:desc>`; anydoc has no way to tell "the carrier is absent"
    // from "the carrier is present and empty" apart, on ANY of the four
    // formats. See `structured-document-fixtures.ts`'s matching comment on
    // the RTF fixture, which has no carrier at all.
    noAltCarrier?: boolean
    // A hyperlink whose relationship target is a `javascript:` URI — the
    // hostile construct OOXML can actually carry. DOCX has no way to embed a
    // live `<script>` element at all (a run's `<w:t>` is always plain text,
    // rendered through `escapeHtml` in `anydoc-html.ts`), so a `javascript:`
    // hyperlink target is the closest analogue: the one place a DOCX author
    // can smuggle an executable-looking URL past a reader who trusts link
    // text over the target it points to.
    activeContent?: boolean
  } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const hasImage = embeddedImage || unsupportedImage
  const imageTarget = unsupportedImage ? 'media/image1.svg' : 'media/image1.png'
  const imageAlt = unsupportedImage ? 'Unsupported diagram' : 'Cell diagram'
  const imageBytes = unsupportedImage ? UNSUPPORTED_IMAGE_SVG : EMBEDDED_IMAGE_PNG
  const imageDescr = noAltCarrier ? '' : ` descr="${imageAlt}"`
  const imageRelationship = hasImage
    ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${imageTarget}"/>`
    : ''
  const imageParagraph = hasImage
    ? `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Diagram"${imageDescr}/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr/><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    : ''
  const unresolvedLinkParagraph = unresolvedLink
    ? '<w:p><w:hyperlink w:anchor="missing-section"><w:r><w:t>Missing section</w:t></w:r></w:hyperlink></w:p>'
    : ''
  const activeContentRelationship = activeContent
    ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(document.cookie)" TargetMode="External"/>'
    : ''
  const activeContentParagraph = activeContent
    ? '<w:p><w:hyperlink r:id="rId3"><w:r><w:t>Click for extra credit</w:t></w:r></w:hyperlink></w:p>'
    : ''

  const entries = [
    {
      name: '[Content_Types].xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
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
  ${activeContentRelationship}
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
  ${activeContentParagraph}
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Membrane</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Cytoplasm</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Observe</w:t></w:r></w:p>
  <w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Structure</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Function</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Nucleus</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Stores DNA</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  ${imageParagraph}
  <w:sectPr/>
</w:body></w:document>`),
    },
    ...(hasImage ? [{ name: `word/${imageTarget}`, data: imageBytes }] : []),
  ]
  return new Uint8Array(await writeZip(entries))
}
