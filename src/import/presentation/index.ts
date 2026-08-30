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
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const DIAGRAM_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram'
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const ODF_OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const ODF_TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const ODF_DRAW_NS = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'
const ODF_PRESENTATION_NS = 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0'

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

/**
 * ONE shared definition of "how runs become a paragraph string", walking a
 * paragraph's (or a run's) children RECURSIVELY — text nodes contribute their
 * data directly, an element matching `{ breakNamespace, breakLocalName }`
 * contributes exactly one space, an excluded element contributes nothing, and
 * any other element (a run, a formatting wrapper, a nested span) is walked
 * the same way. PPTX (`a:r`/`a:br`) and ODF (`text:span`/`text:line-break`)
 * differ only in which element names carry text and which one is a break —
 * both share this rule rather than each carrying a parallel definition of it:
 *
 * - Two adjacent text-bearing elements are concatenated with NO separator.
 *   PowerPoint routinely splits a run mid-word — at a spell-check mark
 *   (`err="1"`), a formatting change, or a language boundary — and Impress
 *   does the same with `text:span`, so `<a:r><a:t>Photosynthesi</a:t></a:r>
 *   <a:r><a:t>s</a:t></a:r>` (or the ODF equivalent) is the single word
 *   `Photosynthesis`, never two words with a space stitched in between.
 * - A break becomes exactly one space. It is NOT a paragraph break — anydoc
 *   renders it inline within the same block rather than starting a new
 *   one — so `<a:r><a:t>First half</a:t></a:r><a:br/><a:r><a:t>second
 *   half</a:t></a:r>` is `"First half second half"`, one `textRuns` entry,
 *   not two. (An earlier version of this function joined every run in a
 *   paragraph with the empty string uniformly, which fixed the mid-word case
 *   above by breaking this one — the space belongs at the break, not between
 *   every pair of runs.)
 */
function joinParagraphText(
  paragraph: Element,
  { breakNamespace, breakLocalName, exclude }: {
    breakNamespace: string
    breakLocalName: string
    exclude?: (element: Element) => boolean
  },
): string {
  const walk = (node: Node): string => {
    let text = ''
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.nodeValue ?? ''
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const element = child as Element
      if (element.namespaceURI === breakNamespace && element.localName === breakLocalName) {
        text += ' '
        continue
      }
      if (exclude?.(element)) continue
      text += walk(element)
    }
    return text
  }
  return collapse(walk(paragraph))
}

/**
 * One PPTX paragraph's (`a:p`) text. `includeFields` controls whether an
 * `a:fld` (a field such as the notes slide-number placeholder's cached
 * `slidenum` text) contributes its own `a:t`. The slide path leaves this on —
 * a deferred minor, `a:fld` text still enters a slide's `textRuns` — but the
 * notes-body path (see `notesBodyText`) turns it off, since a field's cached
 * text is page chrome, not the presenter's authored words.
 */
function paragraphText(paragraph: Element, { includeFields }: { includeFields: boolean }): string {
  return joinParagraphText(paragraph, {
    breakNamespace: DRAWING_NS,
    breakLocalName: 'br',
    exclude: includeFields ? undefined : (element) => element.namespaceURI === DRAWING_NS && element.localName === 'fld',
  })
}

/**
 * One ODF paragraph's (`text:p`) text — the same rule as `paragraphText`,
 * with `text:span` standing in for `a:r` and `text:line-break` for `a:br`.
 * ODF has no field-chrome equivalent to exclude here.
 */
function odfParagraphText(paragraph: Element): string {
  return joinParagraphText(paragraph, { breakNamespace: ODF_TEXT_NS, breakLocalName: 'line-break' })
}

/**
 * Text of one shape, ONE ENTRY PER PARAGRAPH (`a:p`): anydoc emits one block
 * per paragraph, and paragraph-per-entry is what its output is reconciled
 * against — joining a whole SHAPE into one string could never match a
 * two-bullet body against anydoc's two separate blocks.
 */
function shapeParagraphs(shape: Element): string[] {
  return [...shape.getElementsByTagNameNS(DRAWING_NS, 'p')]
    .map((paragraph) => paragraphText(paragraph, { includeFields: true }))
    .filter((text) => text.length > 0)
}

/**
 * A slide's title is the placeholder that SAYS SO ON THE SLIDE — `title`, or
 * `ctrTitle` for the Title Slide layout PowerPoint hands you for slide 1.
 *
 * The type is deliberately NOT resolved through the slide's layout part, and
 * design fact 9 is why. Over 226 slides in 34 real decks (PowerPoint 16 on
 * Windows and Mac, plus generator-written decks), every one of the 130 slides
 * that had a title placeholder wrote the type on the slide itself — 110
 * `title`, 20 `ctrTitle` — and NOT ONE identified its title by an `idx`
 * reference into the layout alone. Type-less `<p:ph idx="N"/>` is common (46
 * slides carried one), but always for a BODY placeholder, where ECMA-376's
 * schema default of `body` makes it correct — the same default `notesBodyText`
 * relies on.
 *
 * anydoc 0.2.4 draws the line in the same place: a title shape carrying only
 * `<p:ph idx="0"/>` comes out as a `paragraph`, not a `heading`, even when a
 * layout part in the package says `title`. So resolving the chain here would
 * not rescue such a slide — it would manufacture a DISAGREEMENT between the
 * two accounts on a slide anydoc gives no heading for. The remaining 96
 * slides carried no placeholder at all: genuinely untitled, which is a
 * warning with a generated title (design fact 3), never a refusal.
 */
function isTitleShape(shape: Element): boolean {
  const placeholder = shape.getElementsByTagNameNS(PML_NS, 'ph')[0]
  const type = placeholder?.getAttribute('type') ?? ''
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

/**
 * A notes part is not just the presenter's own words: it also carries a
 * `sldImg` placeholder (the slide thumbnail) and a slide-number placeholder,
 * whose `<a:fld type="slidenum">` holds a CACHED rendered page number for a
 * reader that does not recompute fields. Both are notes-page CHROME. Reading
 * every `a:t` in the part (an earlier version of this function did) folds
 * that chrome into `notesText` — on a real deck the slide number rides along
 * as trailing text — and `notesText` is exactly the string a later
 * reconciliation step compares the deck's own blockquote against, so that
 * comparison silently fails and the speaker notes get published as body text.
 * Only the BODY placeholder holds authored notes text — and per ECMA-376,
 * `CT_Placeholder/@type`'s schema default IS `body`, so `<p:ph idx="1"/>`
 * with NO `type` attribute at all is legitimately the body placeholder too.
 * Requiring an explicit `type="body"` (an earlier version of this function
 * did) makes that deck's notes text invisible, and the reconciliation then
 * treats the notes blockquote as ordinary content and publishes it with no
 * speaker-notes warning — the same leak, through a different door.
 *
 * Paragraph text is built with `paragraphText` — the SAME per-run,
 * per-`a:br` logic `shapeParagraphs` uses on the slide path, with
 * `includeFields: false` so the slide-number field's cached text is excluded
 * even where it sits inside the body placeholder itself. Maintaining a
 * second, different joining rule here is exactly what let a routine mid-word
 * run split (`"Photosynthesi" + "s"`) reach `notesText` as two words with a
 * space wrongly stitched in between, breaking the exact-string comparison
 * the later reconciliation relies on.
 */
function notesBodyText(notesDocument: Document): string | undefined {
  const bodyShape = [...notesDocument.getElementsByTagNameNS(PML_NS, 'sp')].find((shape) => {
    const placeholder = shape.getElementsByTagNameNS(PML_NS, 'ph')[0]
    return placeholder !== undefined && (placeholder.getAttribute('type') ?? 'body') === 'body'
  })
  if (!bodyShape) return undefined
  const paragraphs = [...bodyShape.getElementsByTagNameNS(DRAWING_NS, 'p')]
    .map((paragraph) => paragraphText(paragraph, { includeFields: false }))
    .filter((text) => text.length > 0)
  // Paragraphs join with a single space rather than concatenating: unlike
  // `textRuns` (one array entry per paragraph, matching anydoc's
  // block-per-paragraph output), `notesText` is ONE string compared by
  // strict equality against a single blockquote, and two authored notes
  // paragraphs are never mid-word the way two runs inside one paragraph can be.
  return collapse(paragraphs.join(' ')) || undefined
}

interface ShapeWalkState {
  textRuns: string[]
  title: string | undefined
  titleIndex: number
  unrepresentable: { diagrams: number; charts: number; media: number }
}

/**
 * REASONED, not measured — like `PRESENTATION_PACKAGE_LIMITS` in `zip-read.ts`.
 * No real deck's authored `p:grpSp` nesting comes close to 32 levels; this
 * exists only to refuse a package engineered to overflow the call stack via
 * nested groups (or nested `mc:AlternateContent`) with a named
 * `PresentationIndexError`, instead of letting a raw `RangeError` escape the
 * module the way an unbounded recursion did before this cap existed.
 */
const MAX_GROUP_NESTING_DEPTH = 32

/**
 * Walks one container's shapes — `spTree` itself, or a `p:grpSp` reached by
 * recursion — mutating `state` in place so a nested call and its caller share
 * the same `textRuns` array and the same "first title wins" decision.
 *
 * Direct children only, in document order — which for PPTX IS reading order
 * (it is what PowerPoint's own Reading Order pane shows) — EXCEPT for two
 * wrapper elements that are not shapes themselves and must be looked through:
 *
 * - `p:grpSp` (PowerPoint's "Group" command): its own position in `spTree`
 *   already fixes where its contents sit in reading order, so recursing INTO
 *   it at this point preserves that order; it does not invent one. Skipping
 *   it (as an earlier version of this function did) makes a grouped diagram
 *   or grouped video a completely silent loss — anydoc drops them too, so
 *   nothing anywhere records they ever existed — and makes grouped TEXT
 *   invisible to `textRuns` even though anydoc *does* descend into groups and
 *   emits a block for it.
 * - `mc:AlternateContent` (OOXML markup compatibility, used for PowerPoint
 *   constructs newer than a reader might support: online video, 3D models,
 *   ink): its `mc:Choice` element(s) and its optional `mc:Fallback` are
 *   ALTERNATIVE representations of the SAME content, never both real. Walking
 *   the first `mc:Choice` when one exists, or `mc:Fallback` otherwise, and
 *   never both, is what keeps a single diagram from being counted twice.
 */
function walkShapes(container: Element, state: ShapeWalkState, depth = 0): void {
  if (depth > MAX_GROUP_NESTING_DEPTH) {
    throw new PresentationIndexError(
      `This slide nests groups more than ${MAX_GROUP_NESTING_DEPTH} levels deep.`,
    )
  }
  for (const shape of container.children) {
    if (shape.namespaceURI === PML_NS && shape.localName === 'sp') {
      const paragraphs = shapeParagraphs(shape)
      // The title is the FIRST paragraph of the FIRST title shape encountered;
      // any further paragraphs in that same shape are ordinary text, and any
      // later shape that also claims to be a title is treated as ordinary text
      // too — "first wins" only decides which paragraph gets to BE the title,
      // it does not hide any paragraph from `textRuns`.
      if (isTitleShape(shape) && state.title === undefined && paragraphs.length > 0) {
        const [first, ...rest] = paragraphs
        state.title = first
        state.titleIndex = state.textRuns.length
        state.textRuns.push(first!, ...rest)
      } else {
        state.textRuns.push(...paragraphs)
      }
      continue
    }
    if (shape.namespaceURI === PML_NS && shape.localName === 'graphicFrame') {
      const data = shape.getElementsByTagNameNS(DRAWING_NS, 'graphicData')[0]
      const uri = data?.getAttribute('uri') ?? ''
      if (uri === DIAGRAM_URI) state.unrepresentable.diagrams += 1
      else if (uri === CHART_URI) state.unrepresentable.charts += 1
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
      if (isMedia) state.unrepresentable.media += 1
      continue
    }
    if (shape.namespaceURI === PML_NS && shape.localName === 'grpSp') {
      walkShapes(shape, state, depth + 1)
      continue
    }
    if (shape.namespaceURI === MC_NS && shape.localName === 'AlternateContent') {
      const children = [...shape.children]
      const choice = children.find((child) => child.namespaceURI === MC_NS && child.localName === 'Choice')
      const fallback = children.find((child) => child.namespaceURI === MC_NS && child.localName === 'Fallback')
      const chosen = choice ?? fallback
      if (chosen) walkShapes(chosen, state, depth + 1)
      continue
    }
  }
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

    const state: ShapeWalkState = {
      textRuns: [],
      title: undefined,
      titleIndex: -1,
      unrepresentable: { diagrams: 0, charts: 0, media: 0 },
    }
    walkShapes(tree, state)

    const notesTarget = relationshipTargets(
      parts[`ppt/slides/_rels/${path!.split('/').pop()}.rels`],
      'notesSlide',
    )[0]
    const notesXml = notesTarget ? parts[resolveFromSlides(notesTarget)] : undefined
    const notesText = notesXml ? notesBodyText(parseXml(notesXml, 'notes part')) : undefined

    slides.push({
      number: position + 1,
      ...(state.title ? { title: state.title } : {}),
      textRuns: state.textRuns,
      ...(notesText ? { notesText } : {}),
      titleOutOfOrder: state.titleIndex > 0,
      unrepresentable: state.unrepresentable,
    })
  })

  return { kind: 'pptx', slides }
}

/**
 * Text of one ODP container (a `draw:frame`, or the whole page), ONE ENTRY
 * PER PARAGRAPH (`text:p`) — the ODF analogue of `shapeParagraphs`, and for
 * the same reason: anydoc emits one block per paragraph, and paragraph-per-
 * entry is what its output is reconciled against. `getElementsByTagNameNS`
 * finds a `text:p` at ANY depth under `container`, which is exactly what is
 * needed for Impress's bulleted body — `text:list > text:list-item > text:p`
 * — where a paragraph is nested two levels below the frame it belongs to,
 * not a direct child of it. Collapsing a whole FRAME's `textContent` into one
 * string instead (the ORIGINAL form of this module's ODP stub) merges every
 * bullet into a single run, which anydoc's own per-paragraph blocks never
 * do, and which the later reconciliation cannot match against.
 */
function odfParagraphs(container: Element): string[] {
  return [...container.getElementsByTagNameNS(ODF_TEXT_NS, 'p')]
    .map((paragraph) => odfParagraphText(paragraph))
    .filter((text) => text.length > 0)
}

/**
 * A notes frame's text as ONE STRING, paragraphs joined with a single space —
 * the ODF analogue of `notesBodyText`, and for the same reason: `notesText`
 * is compared by STRICT EQUALITY against a single blockquote downstream, and
 * two authored notes paragraphs are never mid-word the way two `text:span`
 * runs inside one paragraph can be, so a plain space join between them is
 * safe where joining WITHIN a paragraph with a space is not.
 */
function odfNotesText(notesElement: Element): string | undefined {
  const paragraphs = odfParagraphs(notesElement)
  return collapse(paragraphs.join(' ')) || undefined
}

function odpIndex(parts: Record<string, string>): PresentationIndex {
  const content = parts['content.xml']
  if (!content) {
    throw new PresentationIndexError('This presentation has no content part to read pages from.')
  }
  const document = parseXml(content, 'content part')
  const presentation = document.getElementsByTagNameNS(ODF_OFFICE_NS, 'presentation')[0]
  if (!presentation) {
    throw new PresentationIndexError('This presentation has no pages to read.')
  }

  const slides = [...presentation.getElementsByTagNameNS(ODF_DRAW_NS, 'page')].map((page, position) => {
    const notesElement = page.getElementsByTagNameNS(ODF_PRESENTATION_NS, 'notes')[0]
    const notesText = notesElement ? odfNotesText(notesElement) : undefined
    // Notes live INSIDE the page element, so every text query below must exclude
    // that subtree — otherwise a note would be read as page text, which is the
    // exact confusion this index exists to prevent. `draw:g` (Impress's own
    // "Group" command) needs no explicit recursion here the way PPTX's
    // `p:grpSp` does in `walkShapes`: both this frame query and `odfParagraphs`
    // above use `getElementsByTagNameNS`, which already finds a match at ANY
    // depth in one call, so a frame or paragraph nested inside a group is found
    // exactly as if it were not grouped, with no risk of the stack-depth
    // exhaustion `MAX_GROUP_NESTING_DEPTH` guards against on the PPTX side —
    // there is no recursive function of THIS module's own to overflow.
    const frames = [...page.getElementsByTagNameNS(ODF_DRAW_NS, 'frame')]
      .filter((frame) => !notesElement?.contains(frame))

    const textRuns: string[] = []
    let title: string | undefined
    let titleIndex = -1
    for (const frame of frames) {
      const paragraphs = odfParagraphs(frame)
      // The title is the FIRST paragraph of the FIRST title frame encountered,
      // matching `walkShapes`'s "first wins" rule on the PPTX side — any
      // further paragraph in that same frame is ordinary text, and any later
      // frame that also claims to be a title is treated as ordinary text too.
      if (frame.getAttributeNS(ODF_PRESENTATION_NS, 'class') === 'title' && title === undefined && paragraphs.length > 0) {
        title = paragraphs[0]
        titleIndex = textRuns.length
      }
      textRuns.push(...paragraphs)
    }

    /*
     * ODP hoists a title frame to the top of its page regardless of where it
     * was authored (design fact 4, measured 2026-08-29), so a title is never
     * out of order downstream. Reporting the AUTHORED position here would
     * raise a warning about a disagreement the reader never sees. The runs
     * are reordered to match, title first — spliced out by INDEX
     * (`titleIndex`, recorded above) rather than by re-filtering for a value
     * equal to the title string, so a body paragraph that happens to repeat
     * the title's exact text is never also removed.
     */
    const ordered = title === undefined
      ? textRuns
      : [title, ...textRuns.slice(0, titleIndex), ...textRuns.slice(titleIndex + 1)]

    return {
      number: position + 1,
      ...(title ? { title } : {}),
      textRuns: ordered,
      ...(notesText ? { notesText } : {}),
      titleOutOfOrder: false,
      // ODF carries charts and media as embedded objects rather than as the
      // distinct frame kinds PPTX uses. Nothing in the corpus exercises one
      // yet, so nothing is claimed: this reports zero rather than guessing, and
      // Task 12's verdict records it as a known limit of the ODP evidence.
      unrepresentable: { diagrams: 0, charts: 0, media: 0 },
    }
  })

  return { kind: 'odp', slides }
}

export function readPresentationIndex(
  kind: PresentationPackageKind,
  parts: Record<string, string>,
): PresentationIndex {
  return kind === 'pptx' ? pptxIndex(parts) : odpIndex(parts)
}
