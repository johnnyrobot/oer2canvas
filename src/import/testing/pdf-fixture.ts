/** A deterministic text PDF used at Worker, built-artifact, and benchmark seams. */
export function pdfFixture(pageCount: number, label = 'Benchmark'): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const safeLabel = label.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  const objects: string[] = []
  const kids = Array.from({ length: pageCount }, (_, index) => `${4 + (index * 2)} 0 R`).join(' ')
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`)
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (let page = 1; page <= pageCount; page += 1) {
    const pageObject = 4 + ((page - 1) * 2)
    const contentObject = pageObject + 1
    const lines = Array.from({ length: 20 }, (_, line) =>
      `(${safeLabel} page ${page} line ${line + 1} has extractable browser-local PDF text.) Tj${line === 19 ? '' : ' T*'}`)
      .join(' ')
    const stream = `BT /F1 11 Tf 72 720 Td 14 TL ${lines} ET`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
    )
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(pdf).byteLength)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = encoder.encode(pdf).byteLength
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return encoder.encode(pdf)
}

/**
 * What one physical sheet of a fixture PDF contains.
 *
 * `scanned` is a page whose only content is a DECODABLE image — a real JPEG,
 * `/DCTDecode`. That detail is load-bearing: an uncompressed `/DeviceRGB`
 * XObject is not recognised as an image at all, so a fixture built with one
 * classifies as `TextBased` with an empty `pagesNeedingOcr` and silently
 * measures nothing.
 *
 * `blank` is a page with an empty content stream. It is the negative control
 * for `scanned`: the module leaves it out of `pagesNeedingOcr`, which is the
 * measured fact that lets a blank page warn while a scanned page blocks.
 */
export type PdfFixturePage = 'text' | 'text-and-figure' | 'scanned' | 'blank'

/**
 * The same 16x16 JPEG as `RASTER_FIXTURES.jpeg`, inlined rather than imported.
 *
 * This module is loaded DIRECTLY BY NODE — `scripts/document-parser-fixtures.mjs`
 * and `scripts/smoke-dist.mjs` import it as `pdf-fixture.ts` — and Node's ESM
 * resolver requires an explicit extension on a relative specifier, which
 * TypeScript rejects here without turning on `allowImportingTsExtensions` for
 * the whole project. `raster-fixtures.test.ts` pins these bytes to
 * `RASTER_FIXTURES.jpeg`, so the two cannot drift apart.
 *
 * It must be a real, decodable JPEG: an uncompressed `/DeviceRGB` XObject is not
 * recognised as an image at all, and a fixture built with one classifies as
 * `TextBased` with an empty `pagesNeedingOcr` — silently measuring nothing.
 */
const FIXTURE_JPEG_BASE64 =
  '/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQABADAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAcI/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AiJozUAAA/9k='

export const PDF_FIXTURE_JPEG: Uint8Array =
  Uint8Array.from(atob(FIXTURE_JPEG_BASE64), (character) => character.charCodeAt(0))

const FIXTURE_JPEG_SIZE = 16

function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const whole = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    whole.set(part, at)
    at += part.byteLength
  }
  return whole
}

/**
 * Wrap numbered objects in a header, an xref table and a trailer.
 *
 * Objects arrive as BYTES rather than a string because a `/DCTDecode` stream is
 * JPEG data, not text: building the file as a string and encoding it once at the
 * end — which `pdfFixture` can do because everything it writes is ASCII — would
 * corrupt every byte above 0x7f and produce a file the module cannot decode.
 *
 * `pdfFixture` deliberately does NOT route through here. Its exact bytes are
 * cited by `scripts/benchmark-document-parsers.mjs` and by the committed
 * benchmark evidence, so it is left untouched rather than refactored.
 */
function assemblePdf(objects: readonly Uint8Array[], trailerExtra = ''): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  let total = 0
  const push = (bytes: Uint8Array) => {
    parts.push(bytes)
    total += bytes.byteLength
  }
  const pushText = (text: string) => push(encoder.encode(text))

  pushText('%PDF-1.4\n')
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(total)
    pushText(`${index + 1} 0 obj\n`)
    push(object)
    pushText('\nendobj\n')
  })
  const xref = total
  pushText(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  pushText(offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join(''))
  pushText(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`)
  return concatBytes(parts)
}

/**
 * A PDF whose pages each exercise one of the four cases this feature has to
 * tell apart. The recipes below were run against the real module and produced
 * the classifications `probe.browser.test.ts` asserts; deviate from them and the
 * module classifies something else.
 */
export function pdfFixturePages(
  pages: readonly PdfFixturePage[],
  label = 'Fixture',
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const safeLabel = label.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  // One image object, shared by every page that shows a figure, placed after the
  // last page/content pair so the page objects keep `pdfFixture`'s numbering.
  const imageObject = 4 + (pages.length * 2)
  const kids = pages.map((_, index) => `${4 + (index * 2)} 0 R`).join(' ')

  const objects: Uint8Array[] = [
    encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'),
    encoder.encode(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`),
    encoder.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]

  pages.forEach((kind, index) => {
    const page = index + 1
    const contentObject = 4 + (index * 2) + 1
    /*
     * The prose must NOT begin with `Page N`. The module strips running headers:
     * a fixture whose every line began `Page 1 line 3` extracted to nothing at
     * all. This is `pdfFixture`'s shape, which measured fine.
     */
    const lines = Array.from({ length: 20 }, (_, line) =>
      `(${safeLabel} page ${page} line ${line + 1} has extractable browser-local PDF text.) Tj${line === 19 ? '' : ' T*'}`)
      .join(' ')
    const stream = kind === 'text'
      ? `BT /F1 11 Tf 72 720 Td 14 TL ${lines} ET`
      : kind === 'text-and-figure'
        ? `BT /F1 11 Tf 72 620 Td 14 TL ${lines} ET\nq 200 0 0 200 72 100 cm /Im1 Do Q`
        : kind === 'scanned'
          // No text operators at all: the page is one image covering the sheet,
          // which is what makes the module report it as needing OCR.
          ? 'q 500 0 0 700 56 46 cm /Im1 Do Q'
          : ''
    const showsFigure = kind === 'text-and-figure' || kind === 'scanned'
    const resources = `<< /Font << /F1 3 0 R >>${showsFigure ? ` /XObject << /Im1 ${imageObject} 0 R >>` : ''} >>`
    objects.push(encoder.encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources ${resources} /Contents ${contentObject} 0 R >>`,
    ))
    objects.push(encoder.encode(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`))
  })

  objects.push(concatBytes([
    encoder.encode(
      `<< /Type /XObject /Subtype /Image /Width ${FIXTURE_JPEG_SIZE} ` +
      `/Height ${FIXTURE_JPEG_SIZE} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
      `/Filter /DCTDecode /Length ${PDF_FIXTURE_JPEG.byteLength} >>\nstream\n`,
    ),
    PDF_FIXTURE_JPEG,
    encoder.encode('\nendstream'),
  ]))

  return assemblePdf(objects)
}

/**
 * A PDF whose trailer declares `/Encrypt`. `processPdf` and `detectPdf` both
 * throw `"… PDF is encrypted"` on it — the message the Worker's
 * `/password|encrypted/i` branch matches, which is what keeps the failure
 * NON-retryable.
 *
 * The module refuses before it reaches the page tree, which is why an empty page
 * tree is enough.
 */
export function encryptedPdfFixture(): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  return assemblePdf([
    encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'),
    encoder.encode('<< /Type /Pages /Kids [] /Count 0 >>'),
    encoder.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    encoder.encode('<< /Filter /Standard /V 1 /R 2 /O <0102> /U <0304> /P -1 >>'),
  ], ' /Encrypt 4 0 R /ID [<01> <02>]')
}

/**
 * A PDF cut off before its xref table, which the module reports as
 * `"… Invalid PDF structure"` — the `/malformed|invalid|xref|trailer/i` branch,
 * and correctly RETRYABLE, unlike an encrypted file.
 */
export function malformedPdfFixture(): Uint8Array<ArrayBuffer> {
  const whole = pdfFixture(2, 'Truncated')
  // 60%: past the header and into the object stream, well before the xref. A
  // shorter cut would look like "not a PDF"; a longer one might still parse.
  return whole.slice(0, Math.floor(whole.length * 0.6)) as Uint8Array<ArrayBuffer>
}
