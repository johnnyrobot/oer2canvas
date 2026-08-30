// @ts-expect-error -- shared browser/Node test fixture, like `structured-document-fixtures.ts`.
import { writeZip } from '../../engine/export/zip.ts'
// @ts-expect-error -- shared browser/Node test fixture; see above.
import { RASTER_FIXTURES } from './raster-fixtures.ts'

const utf8 = (value: string) => new TextEncoder().encode(value)
const xmlEscape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** The same Canvas-proven PNG every other format's fixture embeds. */
const EMBEDDED_IMAGE_PNG = RASTER_FIXTURES.png.bytes

/**
 * One paragraph segment: a run's text, `{ break: true }` for an `a:br` soft
 * line break (Shift+Enter) — still inside the SAME paragraph, not a new
 * one — or `{ indent: true }` for raw whitespace text a formatter, repair
 * tool, or indenting generator inserts BETWEEN sibling `<a:r>` elements.
 * PowerPoint's own XML is minified and never has this, but fix-review round
 * 3 measured that a walker treating every text node as content turns such
 * indentation into a wrongly-inserted space mid-word — `{ indent: true }`
 * lets a fixture reproduce that indentation deliberately, independent of the
 * run-joining and soft-break rules `break` and plain strings already cover.
 */
export type PptxParagraphSegment = string | { break: true } | { indent: true }

export interface PptxSlideSpec {
  /** Omitted means the slide has NO title placeholder — design fact 3. */
  title?: string
  /**
   * The title authored as multiple paragraph segments within ONE paragraph,
   * as PowerPoint does at a spell-check (`err="1"`), formatting, or language
   * boundary, or at a Shift+Enter soft break — e.g. `['Photosynthesi', 's']`
   * is the same single word `Photosynthesis` split mid-word. Mutually
   * exclusive with `title`; exercises fix-review Important 1 (`shapeText`
   * must join runs within a paragraph with NO separator, not one string per
   * shape) and round-2 Important A (`a:br` must become a space, not vanish).
   */
  titleRuns?: readonly PptxParagraphSegment[]
  /**
   * How the title shape names itself. `title` is what an ordinary content
   * slide carries; `ctrTitle` is what the Title Slide layout — the one
   * PowerPoint hands you for slide 1 — carries instead. Design fact 9
   * measured both on real decks: 110 slides said `title`, 20 said `ctrTitle`,
   * and nothing else ever named a title.
   */
  titlePlaceholderType?: 'title' | 'ctrTitle'
  /**
   * Emit the title shape's placeholder as `<p:ph idx="0"/>` — no `type` at
   * all, the form that would force a reader to resolve the type through the
   * slide's LAYOUT part. Design fact 9 measured this on 226 real slides and
   * found it exactly zero times for a title (it is common for BODY
   * placeholders, where the schema default of `body` makes it correct), and
   * measured that anydoc emits a plain paragraph rather than a heading for
   * such a shape. The index therefore does not follow the layout chain, and
   * this option exists to pin that decision rather than to support it.
   */
  titleIdentifiedOnlyByIdx?: boolean
  body?: readonly string[]
  /** Speaker notes — design fact 5. Mutually exclusive with `notesRuns`. */
  notes?: string
  /**
   * Speaker notes authored as multiple paragraph segments within ONE
   * paragraph — the notes-body analogue of `titleRuns`, proving the notes
   * path uses the SAME per-run, per-`a:br` joining rule as the slide path
   * (fix-review round-2 Important B) rather than a second rule a routine
   * mid-word split defeats.
   */
  notesRuns?: readonly PptxParagraphSegment[]
  /**
   * Emit the notes body placeholder as `<p:ph idx="1"/>` with NO `type`
   * attribute at all. Under ECMA-376, `CT_Placeholder/@type`'s schema default
   * IS `body`, so this is legitimately the body placeholder too (fix-review
   * round-2 Important C).
   */
  notesOmitPlaceholderType?: boolean
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
  /**
   * N levels of `p:grpSp` nested inside each other, wrapping a plain shape at
   * the bottom. Proves the recursion depth cap (fix-review round-2 Minor D)
   * refuses a package engineered to overflow the call stack with a named
   * `PresentationIndexError`, rather than crashing with a raw `RangeError`.
   */
  nestedGroupDepth?: number
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
 * One paragraph's `a:r` runs and `a:br` soft breaks, in order (see
 * `PptxParagraphSegment`). Shared by the title-run and notes-run fixtures so
 * both exercise the SAME paragraph shape the index has to read.
 */
function paragraphSegmentsXml(segments: readonly PptxParagraphSegment[]): string {
  return segments.map((segment) => {
    if (typeof segment === 'string') return `<a:r><a:rPr lang="en-US"/><a:t>${xmlEscape(segment)}</a:t></a:r>`
    if ('break' in segment) return '<a:br/>'
    // A literal newline-and-indent text node between sibling `<a:r>`
    // elements, exactly as a pretty-printer would insert — never itself a
    // run's `<a:t>` content, and never a break.
    return '\n      '
  }).join('')
}

/**
 * A title paragraph split across multiple segments (see `titleRuns` on
 * `PptxSlideSpec`) — ONE `a:p`, several `a:r`/`a:br` children, no whitespace
 * between adjacent runs' `a:t` text, exactly as PowerPoint authors a
 * spell-check or formatting boundary mid-word (and a real `a:br` where one is
 * requested).
 */
function titleShapeWithRuns(segments: readonly PptxParagraphSegment[]): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7772400" cy="1325563"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p>${paragraphSegmentsXml(segments)}</a:p></p:txBody></p:sp>`
}

/**
 * `depth` levels of `p:grpSp` nested inside each other, wrapping a plain
 * shape at the bottom — see `nestedGroupDepth` on `PptxSlideSpec`.
 */
function nestedGroups(depth: number): string {
  let xml = `<p:sp><p:nvSpPr><p:cNvPr id="30" name="Deeply Nested"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/>` +
    `<a:t>Bottom</a:t></a:r></a:p></p:txBody></p:sp>`
  for (let level = 0; level < depth; level += 1) {
    xml = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${31 + level}" name="Nested Group ${level}"/>` +
      `<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${xml}</p:grpSp>`
  }
  return xml
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

/**
 * The `idx` a type-less title placeholder would carry. A slide layout writes
 * its title placeholder as `<p:ph type="title"/>` with `idx` OMITTED, and
 * ECMA-376's schema default for `CT_Placeholder/@idx` is 0 — so 0 is the only
 * index a slide could use to point at a layout's title.
 */
const LAYOUT_TITLE_PLACEHOLDER_INDEX = 0

function titlePlaceholderXml(spec: PptxSlideSpec): string {
  if (spec.titleIdentifiedOnlyByIdx) return `<p:ph idx="${LAYOUT_TITLE_PLACEHOLDER_INDEX}"/>`
  return `<p:ph type="${spec.titlePlaceholderType ?? 'title'}"/>`
}

function slideXml(spec: PptxSlideSpec): string {
  const title = spec.titleRuns
    ? titleShapeWithRuns(spec.titleRuns)
    : spec.title === undefined
      ? ''
      : textShape(2, 'Title 1', [spec.title], titlePlaceholderXml(spec))
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
  const nested = spec.nestedGroupDepth ? nestedGroups(spec.nestedGroupDepth) : ''

  const shapes = spec.titleLast
    ? `${body}${image}${diagram}${chart}${video}${table}${group}${alternateContent}${nested}${title}`
    : `${title}${body}${image}${diagram}${chart}${video}${table}${group}${alternateContent}${nested}`

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
function notesXml(
  segments: readonly PptxParagraphSegment[],
  { omitPlaceholderType = false }: { omitPlaceholderType?: boolean } = {},
): string {
  const slideImagePlaceholder = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Slide Image Placeholder 3"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>`
  // `<p:ph idx="1"/>` with no `type` attribute at all is legitimately the body
  // placeholder too — `CT_Placeholder/@type`'s schema default (ECMA-376) IS
  // `body` — which is exactly what `omitPlaceholderType` exercises.
  const bodyPlaceholder = omitPlaceholderType ? '<p:ph idx="1"/>' : '<p:ph type="body" idx="1"/>'
  const notesBody = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr>${bodyPlaceholder}</p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7772400" cy="1325563"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p>${paragraphSegmentsXml(segments)}</a:p></p:txBody></p:sp>`
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
    ${notesBody}
    ${slideNumberPlaceholder}
  </p:spTree></p:cSld></p:notes>`
}

/** `slide.notes` (a single run) or `slide.notesRuns` (multiple segments in one
 * paragraph) as the segments `notesXml` needs — the two options are mutually
 * exclusive ways to author the SAME body placeholder. */
function notesSegments(slide: PptxSlideSpec): readonly PptxParagraphSegment[] | undefined {
  if (slide.notesRuns) return slide.notesRuns
  if (slide.notes !== undefined) return [slide.notes]
  return undefined
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
  const notesOverrides = slides.map((slide, index) => notesSegments(slide)
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
    const segments = notesSegments(slide)
    if (segments) {
      rels.push(`<Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${index + 1}.xml"/>`)
      entries.push({
        name: `ppt/notesSlides/notesSlide${index + 1}.xml`,
        data: utf8(notesXml(segments, { omitPlaceholderType: slide.notesOmitPlaceholderType })),
      })
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

const ODP_NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
}

/**
 * One paragraph segment: a `text:span` run's text, `{ break: true }` for a
 * `text:line-break`, `{ tab: true }` for a `text:tab`, `{ spaces: n }` for a
 * `text:s` encoded run of `n` spaces, or `{ link: text }` for an ordinary
 * `text:a` hyperlink wrapping `text` mid-paragraph — none of them a
 * paragraph break. The ODF analogue of `PptxParagraphSegment`, letting a
 * fixture author a `text:span` split mid-word, a hyperlink, or any of ODF's
 * space-producing elements in the SAME paragraph, matching the rule
 * `paragraphText`/its ODF counterpart apply on the index side. `link` exists
 * to pin fix-review round 4's Critical: ODF has no isolating leaf element
 * the way OOXML has `a:t`, so `text:a`'s own text is paragraph content too,
 * not just `text:span`'s.
 */
export type OdpParagraphSegment =
  | string
  | { break: true }
  | { tab: true }
  | { spaces: number }
  | { link: string }

export interface OdpPageSpec {
  title?: string
  /** Each entry becomes its own `text:p` — Impress's one-paragraph-per-bullet-line shape. */
  body?: readonly string[]
  /**
   * ONE paragraph built from `text:span`/`text:line-break` segments, the way
   * Impress splits a run at a spell-check mark or a formatting boundary — e.g.
   * `['Photosynthesi', 's']` is the single word `Photosynthesis` split across
   * two `text:span` elements with no space between them.
   */
  bodyRuns?: readonly OdpParagraphSegment[]
  /**
   * Bullets authored inside a `text:list`, one `text:list-item > text:p` each
   * — how Impress stores a bulleted body placeholder, and why the index must
   * search for `text:p` through the WHOLE frame subtree rather than only its
   * direct children.
   */
  bulletList?: readonly string[]
  /** Speaker notes as a single run. Mutually exclusive with `notesRuns`. */
  notes?: string
  /** Speaker notes authored as multiple `text:span`/`text:line-break` segments in ONE paragraph — the notes analogue of `bodyRuns`. */
  notesRuns?: readonly OdpParagraphSegment[]
  /** Emit the title frame LAST in the page — ODP's form of design fact 4. */
  titleLast?: boolean
  image?: { alt?: string }
  /**
   * A shape drawn from the toolbar (rectangle, callout, arrow, connector) —
   * `draw:custom-shape` — holding typed text as a DIRECT `text:p` child, with
   * NO enclosing `draw:frame` at all. Exercises fix-review round 3 Important
   * 3: a query that only looks at `draw:frame` cannot see this shape's text,
   * which anydoc still emits a block for.
   */
  customShapeText?: string
  /** The above, wrapped in a `draw:g` (Impress's own "Group" command), proving the flat `text:p` query passes through a group for free. */
  groupedCustomShapeText?: string
  /**
   * A `draw:frame` nested inside the body `draw:frame`, both `draw:frame`
   * elements. Proves the flat `text:p` query counts the inner frame's text
   * exactly ONCE, where a per-shape walk over every `draw:frame` would find
   * the same paragraph twice: once via the outer frame's own descendant
   * query, once via the inner frame directly.
   */
  nestedFrameText?: string
  /**
   * N levels of `text:span` nested inside each other, wrapping plain text —
   * the paragraph-internal analogue of `nestedGroupDepth` on the PPTX side,
   * proving the recursion depth cap on `joinParagraphText` refuses a
   * package engineered to overflow the call stack with a named
   * `PresentationIndexError`, rather than crashing with a raw `RangeError`.
   */
  nestedSpanDepth?: number
  /**
   * An `office:annotation` — an Impress reviewer comment — authored as a
   * DIRECT child of `draw:page`, the same level `presentation:notes` sits
   * at. anydoc emits no block for a comment; leaving it out of the
   * exclusion (fix-review round 4 Important) let a private reviewer remark
   * leak into `textRuns` as an invented content-loss disagreement.
   */
  commentText?: string
  /**
   * A `text:h` heading paragraph (`text:outline-level="1"`), which anydoc
   * reports as a `heading` block. Fix-review round 4 measured that the
   * paragraph query missed it entirely — a false content-loss disagreement
   * on ordinary Impress content that never touched anything unusual.
   */
  headingText?: string
}

/**
 * A paragraph's `text:span` runs and `text:line-break`s, in order (see
 * `OdpParagraphSegment`). Shared by the body-run and notes-run fixtures so
 * both exercise the SAME paragraph shape the index has to read.
 */
function odpParagraphSegmentsXml(segments: readonly OdpParagraphSegment[]): string {
  return segments.map((segment) => {
    if (typeof segment === 'string') return `<text:span>${xmlEscape(segment)}</text:span>`
    if ('break' in segment) return '<text:line-break/>'
    if ('tab' in segment) return '<text:tab/>'
    if ('link' in segment) {
      return `<text:a xlink:type="simple" xlink:href="https://example.edu/lab-safety">${xmlEscape(segment.link)}</text:a>`
    }
    return `<text:s text:c="${segment.spaces}"/>`
  }).join('')
}

/** Plain one-string-per-bullet paragraphs, plus an optional run-built paragraph (see `bodyRuns`). */
function odpParagraphsXml(spec: Pick<OdpPageSpec, 'body' | 'bodyRuns'>): string {
  const plain = spec.body?.map((text) => `<text:p>${xmlEscape(text)}</text:p>`).join('') ?? ''
  const runs = spec.bodyRuns ? `<text:p>${odpParagraphSegmentsXml(spec.bodyRuns)}</text:p>` : ''
  return `${plain}${runs}`
}

/** A `text:list` of `text:list-item > text:p` bullets — see `bulletList` on `OdpPageSpec`. */
function odpBulletListXml(bullets: readonly string[]): string {
  const items = bullets.map((text) => `<text:list-item><text:p>${xmlEscape(text)}</text:p></text:list-item>`).join('')
  return `<text:list>${items}</text:list>`
}

function odpFrame(name: string, presentationClass: string, contentXml: string): string {
  const attribute = presentationClass ? ` presentation:class="${presentationClass}"` : ''
  return `<draw:frame draw:name="${name}"${attribute} svg:width="20cm" svg:height="3cm" svg:x="2cm" svg:y="1cm">` +
    `<draw:text-box>${contentXml}</draw:text-box>` +
    `</draw:frame>`
}

/** A `draw:custom-shape` with typed text as a direct `text:p` child — see `customShapeText` on `OdpPageSpec`. */
function odpCustomShape(name: string, text: string): string {
  return `<draw:custom-shape draw:name="${name}" svg:width="5cm" svg:height="2cm" svg:x="2cm" svg:y="6cm">` +
    `<text:p>${xmlEscape(text)}</text:p>` +
    `</draw:custom-shape>`
}

/** `contentXml` wrapped in a `draw:g` group — Impress's own "Group" command. */
function odpGroup(name: string, contentXml: string): string {
  return `<draw:g draw:name="${name}">${contentXml}</draw:g>`
}

/** A `draw:frame` nested inside another `draw:frame` — see `nestedFrameText` on `OdpPageSpec`. */
function odpNestedFrame(outerName: string, innerName: string, text: string): string {
  return `<draw:frame draw:name="${outerName}" svg:width="10cm" svg:height="3cm" svg:x="2cm" svg:y="9cm">` +
    odpFrame(innerName, '', `<text:p>${xmlEscape(text)}</text:p>`) +
    `</draw:frame>`
}

/** `depth` levels of `text:span` nested inside each other, wrapping plain text — see `nestedSpanDepth` on `OdpPageSpec`. */
function odpNestedSpans(depth: number, text: string): string {
  let xml: string = xmlEscape(text)
  for (let level = 0; level < depth; level += 1) {
    xml = `<text:span>${xml}</text:span>`
  }
  return `<text:p>${xml}</text:p>`
}

/** An `office:annotation` (Impress reviewer comment) — see `commentText` on `OdpPageSpec`. */
function odpAnnotation(name: string, text: string): string {
  return `<office:annotation office:name="${name}"><text:p>${xmlEscape(text)}</text:p></office:annotation>`
}

/** A `text:h` heading paragraph — see `headingText` on `OdpPageSpec`. */
function odpHeading(text: string): string {
  // `text:outline-level="1"` is the top level a presentation body uses;
  // anydoc's heading level is not this fixture's concern, only that a
  // `text:h` exists for the index to find.
  return `<text:h text:outline-level="1">${xmlEscape(text)}</text:h>`
}

/** `page.notes` (a single run) or `page.notesRuns` (multiple segments in one paragraph) as one `text:p`. */
function odpNotesContentXml(page: OdpPageSpec): string {
  if (page.notesRuns) return `<text:p>${odpParagraphSegmentsXml(page.notesRuns)}</text:p>`
  if (page.notes !== undefined) return `<text:p>${xmlEscape(page.notes)}</text:p>`
  return ''
}

export async function odpFixture(pages: readonly OdpPageSpec[]): Promise<Uint8Array<ArrayBuffer>> {
  const body = pages.map((page, index) => {
    const title = page.title === undefined
      ? ''
      : odpFrame(`Title ${index + 1}`, 'title', `<text:p>${xmlEscape(page.title)}</text:p>`)
    const outlineContent = `${odpParagraphsXml(page)}${page.bulletList ? odpBulletListXml(page.bulletList) : ''}` +
      (page.nestedSpanDepth ? odpNestedSpans(page.nestedSpanDepth, 'Deeply nested') : '') +
      (page.headingText ? odpHeading(page.headingText) : '')
    const outline = outlineContent ? odpFrame(`Body ${index + 1}`, 'outline', outlineContent) : ''
    const image = page.image
      ? `<draw:frame draw:name="Diagram ${index + 1}" svg:width="1cm" svg:height="1cm">` +
        `<draw:image xlink:href="Pictures/image1.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
        (page.image.alt === undefined ? '' : `<svg:desc>${xmlEscape(page.image.alt)}</svg:desc>`) +
        `</draw:frame>`
      : ''
    const customShape = page.customShapeText ? odpCustomShape(`Custom Shape ${index + 1}`, page.customShapeText) : ''
    const groupedCustomShape = page.groupedCustomShapeText
      ? odpGroup(`Group ${index + 1}`, odpCustomShape(`Grouped Custom Shape ${index + 1}`, page.groupedCustomShapeText))
      : ''
    const nestedFrame = page.nestedFrameText
      ? odpNestedFrame(`Outer Frame ${index + 1}`, `Inner Frame ${index + 1}`, page.nestedFrameText)
      : ''
    const notesContent = odpNotesContentXml(page)
    const notes = notesContent
      ? `<presentation:notes>${odpFrame(`Notes ${index + 1}`, 'notes', notesContent)}</presentation:notes>`
      : ''
    // A direct child of draw:page, the same level presentation:notes sits at.
    const comment = page.commentText ? odpAnnotation(`Comment ${index + 1}`, page.commentText) : ''
    const extras = `${customShape}${groupedCustomShape}${nestedFrame}`
    const frames = page.titleLast ? `${outline}${image}${extras}${title}` : `${title}${outline}${image}${extras}`
    return `<draw:page draw:name="Slide ${index + 1}" draw:master-page-name="Default">${frames}${notes}${comment}</draw:page>`
  }).join('')

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${Object.entries(ODP_NS).map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`).join(' ')} office:version="1.2">
  <office:body><office:presentation>${body}</office:presentation></office:body>
</office:document-content>`

  const entries: { name: string; data: Uint8Array }[] = [
    { name: 'mimetype', data: utf8('application/vnd.oasis.opendocument.presentation') },
    { name: 'META-INF/manifest.xml', data: utf8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">` +
      `<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.presentation"/>` +
      `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
      (pages.some((page) => page.image)
        ? `<manifest:file-entry manifest:full-path="Pictures/image1.png" manifest:media-type="image/png"/>`
        : '') +
      `</manifest:manifest>`) },
    { name: 'content.xml', data: utf8(content) },
  ]
  if (pages.some((page) => page.image)) {
    entries.push({ name: 'Pictures/image1.png', data: EMBEDDED_IMAGE_PNG })
  }
  return writeZip(entries) as Promise<Uint8Array<ArrayBuffer>>
}
