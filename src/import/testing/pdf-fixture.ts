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
