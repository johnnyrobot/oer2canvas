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
  /**
   * The title authored as multiple runs within ONE paragraph, as PowerPoint
   * does at a spell-check (`err="1"`), formatting, or language boundary — e.g.
   * `['Photosynthesi', 's']` is the same single word `Photosynthesis` split
   * mid-word. Mutually exclusive with `title`; exercises the task-3 fix-review
   * Important 1 (`shapeText` must join runs within a paragraph with NO
   * separator, not one string per shape).
   */
  titleRuns?: readonly string[]
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
  /**
   * Content authored inside a `p:grpSp` — PowerPoint's own "Group" command.
   * anydoc descends into groups for text but emits nothing for a grouped
   * diagram or grouped media, so the index must descend too, or the loss
   * (and the grouped text) is invisible (fix-review Important 2).
   */
  group?: { text?: string; diagram?: boolean; video?: boolean }
  /**
   * A diagram wrapped in `mc:AlternateContent`, the OOXML markup-compatibility
   * wrapper PowerPoint uses for newer constructs (online video, 3D models,
   * ink). Its `mc:Choice` carries the diagram; its `mc:Fallback` carries a
   * CHART instead of the same content, specifically so a reader that (wrongly)
   * walks both branches is caught: it would report a phantom chart alongside
   * the diagram (fix-review Important 3).
   */
  diagramInAlternateContent?: boolean
}

const DIAGRAM_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram'
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const TABLE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table'
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

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

/**
 * A title paragraph split across multiple runs (see `titleRuns` on
 * `PptxSlideSpec`) — ONE `a:p`, several `a:r` children, no whitespace between
 * their `a:t` text, exactly as PowerPoint authors a spell-check or formatting
 * boundary mid-word.
 */
function titleShapeWithRuns(runs: readonly string[]): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7772400" cy="1325563"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p>` +
    runs.map((text) => `<a:r><a:rPr lang="en-US"/><a:t>${xmlEscape(text)}</a:t></a:r>`).join('') +
    `</a:p></p:txBody></p:sp>`
}

/**
 * A `p:grpSp` — PowerPoint's "Group" command — wrapping a plain text box, a
 * SmartArt diagram frame, and a video-carrying picture, so a test can prove the
 * index descends into it instead of treating the group as opaque.
 */
function groupShape({ text, diagram, video }: NonNullable<PptxSlideSpec['group']>): string {
  const textPart = text
    ? `<p:sp><p:nvSpPr><p:cNvPr id="21" name="Grouped Text 21"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/>` +
      `<a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody></p:sp>`
    : ''
  const diagramPart = diagram
    ? graphicFrame(22, 'Grouped Diagram 22', DIAGRAM_URI,
        '<dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
        'r:dm="rIdDm" r:lo="rIdLo" r:qs="rIdQs" r:cs="rIdCs"/>')
    : ''
  const videoPart = video
    ? `<p:pic><p:nvPicPr><p:cNvPr id="23" name="Grouped clip"/><p:cNvPicPr/>` +
      `<p:nvPr><a:videoFile r:link="rIdGroupedVideo"/></p:nvPr></p:nvPicPr>` +
      `<p:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr/></p:pic>`
    : ''
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="20" name="Group 20"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>${textPart}${diagramPart}${videoPart}</p:grpSp>`
}

/**
 * A diagram wrapped in `mc:AlternateContent` (see `diagramInAlternateContent`
 * on `PptxSlideSpec`). `mc:Choice` and `mc:Fallback` are ALTERNATIVES, never
 * both real content — the fallback here holds a CHART rather than a second
 * diagram, so a reader that (wrongly) visits both branches is caught by a
 * phantom chart count rather than an indistinguishable doubled diagram count.
 */
function alternateContentDiagram(): string {
  return `<mc:AlternateContent xmlns:mc="${MC_NS}">` +
    `<mc:Choice xmlns:v="urn:schemas-microsoft-com:vml" Requires="v">` +
    graphicFrame(9, 'AC Diagram 9', DIAGRAM_URI,
      '<dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'r:dm="rIdDm" r:lo="rIdLo" r:qs="rIdQs" r:cs="rIdCs"/>') +
    `</mc:Choice>` +
    `<mc:Fallback>` +
    graphicFrame(10, 'AC Diagram Fallback 10', CHART_URI,
      '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChartFallback"/>') +
    `</mc:Fallback></mc:AlternateContent>`
}

function slideXml(spec: PptxSlideSpec): string {
  const title = spec.titleRuns
    ? titleShapeWithRuns(spec.titleRuns)
    : spec.title === undefined
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

  const group = spec.group ? groupShape(spec.group) : ''
  const alternateContent = spec.diagramInAlternateContent ? alternateContentDiagram() : ''

  const shapes = spec.titleLast
    ? `${body}${image}${diagram}${chart}${video}${table}${group}${alternateContent}${title}`
    : `${title}${body}${image}${diagram}${chart}${video}${table}${group}${alternateContent}`

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    ${shapes}
  </p:spTree></p:cSld></p:sld>`
}

/**
 * A real PowerPoint notes part is not just the presenter's words: it also
 * carries a `sldImg` placeholder (the slide thumbnail) and a slide-number
 * placeholder whose `<a:fld type="slidenum">` holds a CACHED rendered number
 * ("7", an arbitrary but plausible page) for a reader that does not recompute
 * fields. Both are notes-page CHROME, not authored text — omitting them (as an
 * earlier version of this fixture did) let `notesText` pass by reading every
 * `a:t` in the part, which hid that that approach folds the slide number into
 * the presenter's own notes on a real deck (fix-review Important 4).
 */
function notesXml(text: string): string {
  const slideImagePlaceholder = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Slide Image Placeholder 3"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>`
  const slideNumberPlaceholder = `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number Placeholder 4"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" idx="1"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>` +
    `<a:fld id="{2AB2A61C-1E1C-4D0F-9B2A-000000000001}" type="slidenum">` +
    `<a:rPr lang="en-US"/><a:t>7</a:t></a:fld></a:p></p:txBody></p:sp>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
         xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    ${slideImagePlaceholder}
    ${textShape(2, 'Notes Placeholder 2', [text], '<p:ph type="body" idx="1"/>')}
    ${slideNumberPlaceholder}
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
