// @ts-expect-error -- shared browser/Node test fixture, like `structured-document-fixtures.ts`.
import { writeZip } from '../../engine/export/zip.ts'
// @ts-expect-error -- shared browser/Node test fixture; see above.
import { RASTER_FIXTURES } from './raster-fixtures.ts'

const utf8 = (value: string) => new TextEncoder().encode(value)
const xmlEscape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** The same Canvas-proven PNG every other format's fixture embeds. */
const EMBEDDED_IMAGE_PNG = RASTER_FIXTURES.png.bytes

export interface PptxSlideSpec {
  /** Omitted means the slide has NO title placeholder — design fact 3. */
  title?: string
  body?: readonly string[]
  /** Speaker notes — design fact 5. */
  notes?: string
  /** Emit the title placeholder LAST in `spTree` — design fact 4. */
  titleLast?: boolean
  /** A picture, with `descr` as its alt text (omit for an undescribed image). */
  image?: { alt?: string }
  /** Content anydoc drops entirely — design fact 6. */
  diagram?: boolean
  chart?: boolean
  video?: boolean
  table?: boolean
}

const DIAGRAM_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram'
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const TABLE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table'

function textShape(id: number, name: string, paragraphs: readonly string[], placeholder: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7772400" cy="1325563"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>` +
    paragraphs.map((text) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${xmlEscape(text)}</a:t></a:r></a:p>`).join('') +
    `</p:txBody></p:sp>`
}

function graphicFrame(id: number, name: string, uri: string, payload: string): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/>` +
    `<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="838200" y="365125"/><a:ext cx="7772400" cy="1325563"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="${uri}">${payload}</a:graphicData></a:graphic></p:graphicFrame>`
}

function slideXml(spec: PptxSlideSpec): string {
  const title = spec.title === undefined
    ? ''
    : textShape(2, 'Title 1', [spec.title], '<p:ph type="title"/>')
  const body = spec.body?.length
    ? textShape(3, 'Content Placeholder 2', spec.body, '<p:ph type="body" idx="1"/>')
    : ''
  const image = spec.image
    ? `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 4"` +
      `${spec.image.alt === undefined ? '' : ` descr="${xmlEscape(spec.image.alt)}"`}/>` +
      `<p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr/></p:pic>`
    : ''
  // A SmartArt frame references four diagram parts by relationship; anydoc
  // emits nothing at all for it (design fact 6), so the index is the only
  // place its existence is ever recorded.
  const diagram = spec.diagram
    ? graphicFrame(5, 'Diagram 5', DIAGRAM_URI,
        '<dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
        'r:dm="rIdDm" r:lo="rIdLo" r:qs="rIdQs" r:cs="rIdCs"/>')
    : ''
  const chart = spec.chart
    ? graphicFrame(6, 'Chart 6', CHART_URI,
        '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart"/>')
    : ''
  const video = spec.video
    ? `<p:pic><p:nvPicPr><p:cNvPr id="7" name="Lecture clip"/><p:cNvPicPr/>` +
      `<p:nvPr><a:videoFile r:link="rIdVideo"/></p:nvPr></p:nvPicPr>` +
      `<p:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr/></p:pic>`
    : ''
  const table = spec.table
    ? graphicFrame(8, 'Table 8', TABLE_URI,
        '<a:tbl><a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="3886200"/><a:gridCol w="3886200"/></a:tblGrid>' +
        '<a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Stage</a:t></a:r></a:p></a:txBody></a:tc>' +
        '<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Location</a:t></a:r></a:p></a:txBody></a:tc></a:tr>' +
        '<a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Calvin cycle</a:t></a:r></a:p></a:txBody></a:tc>' +
        '<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Stroma</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>')
    : ''

  const shapes = spec.titleLast
    ? `${body}${image}${diagram}${chart}${video}${table}${title}`
    : `${title}${body}${image}${diagram}${chart}${video}${table}`

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    ${shapes}
  </p:spTree></p:cSld></p:sld>`
}

function notesXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
         xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    ${textShape(2, 'Notes Placeholder 2', [text], '<p:ph type="body" idx="1"/>')}
  </p:spTree></p:cSld></p:notes>`
}

/** The main-part content type each PPTX-family extension carries (design fact 1). */
export const PPTX_CONTENT_TYPES = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
  ppsm: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml',
} as const

export async function pptxFixture(
  slides: readonly PptxSlideSpec[],
  { container = 'pptx', withMacroPart = false }: {
    container?: keyof typeof PPTX_CONTENT_TYPES
    /** Adds `ppt/vbaProject.bin`, as a real .pptm/.ppsm does. Never executed. */
    withMacroPart?: boolean
  } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const overrides = slides.map((_unused, index) =>
    `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
  const notesOverrides = slides.map((slide, index) => slide.notes
    ? `<Override PartName="/ppt/notesSlides/notesSlide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
    : '').join('')
  const slideRels = slides.map((_unused, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')
  const slideIds = slides.map((_unused, index) =>
    `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('')

  const entries: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: utf8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/>` +
      `<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="${PPTX_CONTENT_TYPES[container]}"/>` +
      `${overrides}${notesOverrides}</Types>`) },
    { name: '_rels/.rels', data: utf8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>` +
      `</Relationships>`) },
    { name: 'ppt/presentation.xml', data: utf8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
      `<p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`) },
    { name: 'ppt/_rels/presentation.xml.rels', data: utf8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideRels}</Relationships>`) },
  ]

  slides.forEach((slide, index) => {
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, data: utf8(slideXml(slide)) })
    const rels: string[] = []
    if (slide.notes) {
      rels.push(`<Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${index + 1}.xml"/>`)
      entries.push({ name: `ppt/notesSlides/notesSlide${index + 1}.xml`, data: utf8(notesXml(slide.notes)) })
    }
    if (slide.image) {
      rels.push('<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>')
    }
    if (rels.length > 0) {
      entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: utf8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`) })
    }
  })

  if (slides.some((slide) => slide.image)) {
    entries.push({ name: 'ppt/media/image1.png', data: EMBEDDED_IMAGE_PNG })
  }
  if (withMacroPart) {
    // Deliberately not valid VBA. Its only job is to exist, so a test can prove
    // it is neither inflated nor packaged.
    entries.push({ name: 'ppt/vbaProject.bin', data: utf8('macro payload placeholder') })
  }

  return writeZip(entries) as Promise<Uint8Array<ArrayBuffer>>
}
