import type { PresentationPackageKind } from './parts'

/**
 * The deck's own account of itself — every question anydoc cannot answer.
 *
 * Parsed on the MAIN THREAD with `DOMParser`, because a Worker has none; see the
 * design's "Where the work happens" section and `parsers/probe.ts`'s note on the
 * PDF path for the same constraint stated where it was first met.
 */
export interface PresentationSlideIndex {
  /** 1-based, in presentation order: `sldIdLst` order, or `draw:page` order. */
  number: number
  /** Title placeholder text as authored. Absent when the slide has no title. */
  title?: string
  /** Text runs on the slide in the deck's own reading order. */
  textRuns: readonly string[]
  /** Notes text, when the slide has a notes part that is not whitespace. */
  notesText?: string
  /** The title placeholder is not first in reading order. */
  titleOutOfOrder: boolean
  /** Content anydoc drops with no block and no asset. */
  unrepresentable: { diagrams: number; charts: number; media: number }
}

export interface PresentationIndex {
  kind: PresentationPackageKind
  slides: readonly PresentationSlideIndex[]
}

export class PresentationIndexError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresentationIndexError'
  }
}

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PML_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const DIAGRAM_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram'
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'

function parseXml(xml: string, what: string): Document {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  // `DOMParser` reports an XML syntax error as a document containing
  // `<parsererror>` rather than by throwing, so a caller that does not look for
  // it treats a broken part as an empty one.
  if (parsed.getElementsByTagName('parsererror').length > 0) {
    throw new PresentationIndexError(`This presentation's ${what} is not readable XML.`)
  }
  return parsed
}

function collapse(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/** Text of one shape: its `a:t` runs joined, paragraph by paragraph. */
function shapeText(shape: Element): string {
  return collapse([...shape.getElementsByTagNameNS(DRAWING_NS, 't')]
    .map((run) => run.textContent ?? '')
    .join(' '))
}

function isTitleShape(shape: Element): boolean {
  const placeholder = shape.getElementsByTagNameNS(PML_NS, 'ph')[0]
  const type = placeholder?.getAttribute('type') ?? ''
  // `title` and `ctrTitle` are the two placeholder types PowerPoint uses for a
  // slide's title; `ctrTitle` is what a title-layout slide carries.
  return type === 'title' || type === 'ctrTitle'
}

function relationshipTargets(relsXml: string | undefined, type: string): string[] {
  if (!relsXml) return []
  const document = parseXml(relsXml, 'relationship part')
  return [...document.getElementsByTagNameNS(RELS_NS, 'Relationship')]
    .filter((relationship) => relationship.getAttribute('Type') === `${R_NS}/${type}`)
    .map((relationship) => relationship.getAttribute('Target') ?? '')
    .filter(Boolean)
}

/** `../notesSlides/notesSlide1.xml` relative to `ppt/slides/` is `ppt/notesSlides/…`. */
function resolveFromSlides(target: string): string {
  return `ppt/${target.replace(/^\.\.\//, '')}`
}

function pptxIndex(parts: Record<string, string>): PresentationIndex {
  const presentation = parts['ppt/presentation.xml']
  if (!presentation) {
    throw new PresentationIndexError('This presentation has no presentation part to read slides from.')
  }
  const presentationDocument = parseXml(presentation, 'presentation part')
  const relationships = parts['ppt/_rels/presentation.xml.rels']
  if (!relationships) {
    throw new PresentationIndexError('This presentation has no relationship part naming its slides.')
  }
  const relsDocument = parseXml(relationships, 'relationship part')
  const targetById = new Map<string, string>()
  for (const relationship of relsDocument.getElementsByTagNameNS(RELS_NS, 'Relationship')) {
    targetById.set(relationship.getAttribute('Id') ?? '', relationship.getAttribute('Target') ?? '')
  }

  // `sldIdLst` order IS presentation order. Part NUMBERS are not: a deck whose
  // slides were reordered keeps its original `slideN.xml` names, so sorting on
  // the filename would show the author's first draft rather than their deck.
  const slideIds = [...presentationDocument.getElementsByTagNameNS(PML_NS, 'sldId')]
  const slides: PresentationSlideIndex[] = []

  slideIds.forEach((slideId, position) => {
    const target = targetById.get(slideId.getAttributeNS(R_NS, 'id') ?? '')
    const path = target ? `ppt/${target.replace(/^\.\.\//, '')}` : undefined
    const xml = path ? parts[path] : undefined
    if (!xml) {
      throw new PresentationIndexError(
        `This presentation names a slide (${position + 1}) whose part is missing from the package.`,
      )
    }
    const slideDocument = parseXml(xml, `slide ${position + 1}`)
    const tree = slideDocument.getElementsByTagNameNS(PML_NS, 'spTree')[0]
    if (!tree) {
      throw new PresentationIndexError(`Slide ${position + 1} has no shape tree to read.`)
    }

    const textRuns: string[] = []
    let title: string | undefined
    let titleIndex = -1
    const unrepresentable = { diagrams: 0, charts: 0, media: 0 }

    // Direct children only, in document order — which for PPTX IS reading order
    // (it is what PowerPoint's own Reading Order pane shows).
    for (const shape of tree.children) {
      if (shape.namespaceURI === PML_NS && shape.localName === 'sp') {
        const text = shapeText(shape)
        if (isTitleShape(shape)) {
          if (title === undefined) {
            title = text
            titleIndex = textRuns.length
          }
        }
        if (text) textRuns.push(text)
        continue
      }
      if (shape.namespaceURI === PML_NS && shape.localName === 'graphicFrame') {
        const data = shape.getElementsByTagNameNS(DRAWING_NS, 'graphicData')[0]
        const uri = data?.getAttribute('uri') ?? ''
        if (uri === DIAGRAM_URI) unrepresentable.diagrams += 1
        else if (uri === CHART_URI) unrepresentable.charts += 1
        // A table frame is deliberately NOT counted: anydoc emits it as a real
        // data table (design fact 8), so it is not a loss to report.
        continue
      }
      if (shape.namespaceURI === PML_NS && shape.localName === 'pic') {
        // A picture carrying `a:videoFile` (or `a:audioFile`) is media, which
        // anydoc drops entirely. A plain picture is an ordinary image and
        // travels the existing asset path.
        const isMedia = shape.getElementsByTagNameNS(DRAWING_NS, 'videoFile').length > 0 ||
          shape.getElementsByTagNameNS(DRAWING_NS, 'audioFile').length > 0
        if (isMedia) unrepresentable.media += 1
      }
    }

    const notesTarget = relationshipTargets(
      parts[`ppt/slides/_rels/${path!.split('/').pop()}.rels`],
      'notesSlide',
    )[0]
    const notesXml = notesTarget ? parts[resolveFromSlides(notesTarget)] : undefined
    const notesText = notesXml
      ? collapse([...parseXml(notesXml, 'notes part').getElementsByTagNameNS(DRAWING_NS, 't')]
          .map((run) => run.textContent ?? '').join(' ')) || undefined
      : undefined

    slides.push({
      number: position + 1,
      ...(title ? { title } : {}),
      textRuns,
      ...(notesText ? { notesText } : {}),
      titleOutOfOrder: titleIndex > 0,
      unrepresentable,
    })
  })

  return { kind: 'pptx', slides }
}

function odpIndex(_parts: Record<string, string>): PresentationIndex {
  throw new PresentationIndexError('ODP indexing arrives in Task 5.')
}

export function readPresentationIndex(
  kind: PresentationPackageKind,
  parts: Record<string, string>,
): PresentationIndex {
  return kind === 'pptx' ? pptxIndex(parts) : odpIndex(parts)
}
