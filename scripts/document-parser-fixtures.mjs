import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
export { pdfFixture } from '../src/import/testing/pdf-fixture.ts'

const encoder = new TextEncoder()

export function rtfFixture(targetBytes) {
  const header = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\fs24\n'
  const footer = '}'
  const chunks = [header]
  let size = encoder.encode(header + footer).byteLength
  let index = 1
  while (size < targetBytes) {
    const paragraph = `Browser benchmark paragraph ${index}: semantic text for local conversion.\\par\n`
    if (size + paragraph.length > targetBytes) break
    chunks.push(paragraph)
    size += paragraph.length
    index += 1
  }
  chunks.push(footer)
  return encoder.encode(chunks.join(''))
}

export async function docxFixture() {
  const root = await mkdtemp(join(tmpdir(), 'oer2canvas-docx-fixture-'))
  const archive = join(root, 'benchmark.docx')
  try {
    await mkdir(join(root, '_rels'), { recursive: true })
    await mkdir(join(root, 'word'), { recursive: true })
    await writeFile(join(root, '[Content_Types].xml'), `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
    await writeFile(join(root, '_rels', '.rels'), `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
    await writeFile(join(root, 'word', 'document.xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Browser DOCX benchmark</w:t></w:r></w:p>
  <w:p><w:r><w:t>This semantic paragraph is parsed locally in a module Worker.</w:t></w:r></w:p>
  <w:sectPr/></w:body></w:document>`)
    execFileSync('zip', ['-q', '-X', '-r', archive, '[Content_Types].xml', '_rels', 'word'], { cwd: root })
    const bytes = await readFile(archive)
    return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

export async function odtFixture() {
  const root = await mkdtemp(join(tmpdir(), 'oer2canvas-odt-fixture-'))
  const archive = join(root, 'benchmark.odt')
  try {
    await mkdir(join(root, 'META-INF'), { recursive: true })
    await writeFile(join(root, 'mimetype'), 'application/vnd.oasis.opendocument.text')
    await writeFile(join(root, 'content.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">
  <office:body><office:text><text:h text:outline-level="1">Browser ODT benchmark</text:h>
  <text:p>This semantic paragraph is parsed locally in a module Worker.</text:p></office:text></office:body>
</office:document-content>`)
    await writeFile(join(root, 'META-INF', 'manifest.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`)
    execFileSync('zip', ['-q', '-X', '-0', archive, 'mimetype'], { cwd: root })
    execFileSync('zip', ['-q', '-X', '-r', archive, 'content.xml', 'META-INF'], { cwd: root })
    const bytes = await readFile(archive)
    return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function imageBytes(size) {
  if (size < ONE_PIXEL_PNG.byteLength) throw new Error('generated image size is smaller than the PNG fixture')
  const bytes = Buffer.alloc(size)
  ONE_PIXEL_PNG.copy(bytes)
  return bytes
}

/** A deterministic EPUB with every image referenced once from one XHTML spine item. */
export async function epubAssetFixture(assetSizes) {
  const root = await mkdtemp(join(tmpdir(), 'oer2canvas-parser-fixture-'))
  const archive = join(root, 'assets.epub')
  try {
    await mkdir(join(root, 'META-INF'), { recursive: true })
    await mkdir(join(root, 'OEBPS', 'images'), { recursive: true })
    await writeFile(join(root, 'mimetype'), 'application/epub+zip')
    await writeFile(join(root, 'META-INF', 'container.xml'), `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)

    const images = assetSizes.map((size, index) => ({
      id: `image-${index + 1}`,
      href: `images/image-${index + 1}.png`,
      size,
    }))
    await Promise.all(images.map((image) =>
      writeFile(join(root, 'OEBPS', image.href), imageBytes(image.size))))
    await writeFile(join(root, 'OEBPS', 'chapter.xhtml'), `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Asset benchmark</title></head><body>
<h1>Asset benchmark</h1><p>Every generated image has deterministic local bytes.</p>
${images.map((image) => `<figure><img src="${image.href}" alt="Generated benchmark image ${image.id}"/></figure>`).join('\n')}
</body></html>`)
    await writeFile(join(root, 'OEBPS', 'content.opf'), `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">oer2canvas-benchmark</dc:identifier><dc:title>Asset benchmark</dc:title><dc:language>en</dc:language></metadata>
<manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
${images.map((image) => `<item id="${image.id}" href="${image.href}" media-type="image/png"/>`).join('\n')}
</manifest><spine><itemref idref="chapter"/></spine></package>`)

    execFileSync('zip', ['-q', '-X', '-0', archive, 'mimetype'], { cwd: root })
    execFileSync('zip', ['-q', '-X', '-0', '-r', archive, 'META-INF', 'OEBPS'], { cwd: root })
    const bytes = await readFile(archive)
    return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
