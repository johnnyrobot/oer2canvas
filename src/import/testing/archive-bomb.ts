import { writeZip } from '../../engine/export/zip'

const utf8 = (value: string) => new TextEncoder().encode(value)

/**
 * A VALID DOCX whose `word/document.xml` is enormous and trivially compressible.
 *
 * The attack this stands in for: a small upload that a parser expands until it
 * exhausts the tab. `writeZip` deflates, so the archive stays far inside
 * `maximumInputBytes` while the expanded part does not.
 *
 * `paragraphs` is the dial. Each paragraph is about 78 bytes expanded, so the
 * expanded size is roughly `paragraphs * 78`.
 */
export async function compressionBombDocx(paragraphs: number): Promise<Uint8Array<ArrayBuffer>> {
  const body = '<w:p><w:r><w:t>AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA</w:t></w:r></w:p>'
    .repeat(paragraphs)
  const entries = [
    {
      name: '[Content_Types].xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
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
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`),
    },
    {
      name: 'word/document.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`),
    },
  ]
  return new Uint8Array(await writeZip(entries))
}
