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
 * REASONED, not measured — like `MAX_GROUP_NESTING_DEPTH` elsewhere in this
 * module, and for the same purpose, one level down: `joinParagraphText`'s own
 * recursion (below) has no other cap, and fix-review round 3 measured that
 * 5,000 levels of nested `text:span` throws a raw, unnamed `RangeError` that
 * escapes this module — the same failure `MAX_GROUP_NESTING_DEPTH` exists to
 * prevent for shape groups, just inside a single paragraph's runs/spans
 * rather than across a slide's shapes. No real run or span nests anywhere
 * near 32 levels deep (bold-inside-italic-inside-a-hyperlink is 2 or 3); this
 * refuses an adversarial package with a named `PresentationIndexError`
 * instead of letting a raw `RangeError` escape.
 */
const MAX_PARAGRAPH_NESTING_DEPTH = 32

/**
 * ONE shared definition of "how runs become a paragraph string", walking a
 * paragraph's (or a run's) children RECURSIVELY — a text node contributes its
 * data ONLY when its immediate parent is a text carrier (see `isTextCarrier`
 * below), an element matching `isSpace` contributes exactly one space, an
 * excluded element contributes nothing, and any other element (a run, a
 * formatting wrapper, a nested span, a hyperlink) is walked the same way.
 * PPTX (`a:r`/`a:t`/`a:br`) and ODF (`text:span`/`text:line-break`/
 * `text:tab`/`text:s`) differ only in which element names carry text and
 * which ones are a space — both share this rule rather than each carrying a
 * parallel definition of it:
 *
 * - Two adjacent text-bearing elements are concatenated with NO separator.
 *   PowerPoint routinely splits a run mid-word — at a spell-check mark
 *   (`err="1"`), a formatting change, or a language boundary — and Impress
 *   does the same with `text:span`, so `<a:r><a:t>Photosynthesi</a:t></a:r>
 *   <a:r><a:t>s</a:t></a:r>` (or the ODF equivalent) is the single word
 *   `Photosynthesis`, never two words with a space stitched in between.
 * - A space-producing element becomes exactly one space. It is NOT a
 *   paragraph break — anydoc renders it inline within the same block rather
 *   than starting a new one — so `<a:r><a:t>First half</a:t></a:r><a:br/>
 *   <a:r><a:t>second half</a:t></a:r>` is `"First half second half"`, one
 *   `textRuns` entry, not two. (An earlier version of this function joined
 *   every run in a paragraph with the empty string uniformly, which fixed
 *   the mid-word case above by breaking this one — the space belongs at the
 *   space-producing element, not between every pair of runs.)
 * - Depth is capped at `MAX_PARAGRAPH_NESTING_DEPTH` (see above), the same
 *   defence `MAX_GROUP_NESTING_DEPTH` gives `walkShapes`.
 */
function joinParagraphText(
  paragraph: Element,
  { isSpace, isTextCarrier, exclude }: {
    /**
     * True for an element that stands in for one or more space characters
     * within the paragraph — never itself a paragraph break, since anydoc
     * renders all of these inline in the same block: `a:br`/`text:line-break`
     * (a soft line break), and for ODF also `text:tab` and `text:s` (an
     * encoded run of one or more spaces via an optional `text:c` count).
     * `text:s`'s exact count does not need to be read: `collapse` squashes
     * any run of whitespace to a single space regardless, so contributing
     * one space for it is enough — the count would be "mostly benign"
     * either way, but dropping `text:s` entirely (treating it as neither a
     * space nor a text carrier) would wrongly concatenate the words on
     * either side of it with none.
     */
    isSpace: (element: Element) => boolean
    /**
     * True for an element whose OWN direct text-node children are paragraph
     * CONTENT, as opposed to incidental whitespace a formatter, repair tool,
     * or indenting generator inserted between sibling elements.
     *
     * OMITTED means "no restriction — every element carries text directly."
     * That is ODF's shape: ODF has NO isolating leaf element the way OOXML
     * has `a:t`, so bare text lives directly inside `text:p`, `text:span`,
     * `text:a` (a hyperlink), `text:date`, `text:page-number`,
     * `text:bookmark-ref`, `text:meta`, `text:ruby-base`, and more. Fix-review
     * round 4 measured what an ALLOWLIST of "the ODF elements known to carry
     * text" costs against a real .odp: with `<text:span>Mention the
     * </text:span><text:a>lab</text:a><text:span> before class.</text:span>`,
     * `text:a` dropped only ITS OWN text — the enclosing `text:p` and
     * `text:span` were still carriers, so nothing after the link was
     * truncated — turning `"Mention the lab before class."` into `"Mention
     * the before class."`. That alone is enough to fail the strict-equality
     * comparison `notesText` is checked against downstream, publishing the
     * notes. An allowlist of ODF inline elements is a losing, ever-growing
     * list regardless of how far a single dropped element's damage spreads;
     * "everything except the space-producing elements above carries text" is
     * the honest, exhaustive shape, so ODF passes no `isTextCarrier` at all.
     *
     * PPTX keeps the allowlist, and it is correct THERE: OOXML genuinely
     * isolates all real text inside `a:t`, so only `a:t` qualifies — a text
     * node found anywhere else (directly inside `a:p` or `a:r`) is
     * pretty-print indentation, not content. Fix-review round 3 measured
     * that treating EVERY text node as content on the PPTX side (an earlier
     * version of this function did, checking only for a break and nothing
     * else) turns `<a:r><a:t>Photosynthesi</a:t></a:r>\n  <a:r><a:t>s</a:t>
     * </a:r>` — indentation a formatter inserted between the runs — into
     * `"Photosynthesi s"`: the exact mid-word defect two earlier rounds
     * removed, reintroduced through a text node the direct-children
     * implementation that preceded this one could never see.
     */
    isTextCarrier?: (element: Element) => boolean
    exclude?: (element: Element) => boolean
  },
): string {
  const walk = (node: Node, depth: number): string => {
    if (depth > MAX_PARAGRAPH_NESTING_DEPTH) {
      throw new PresentationIndexError(
        `This paragraph nests runs more than ${MAX_PARAGRAPH_NESTING_DEPTH} levels deep.`,
      )
    }
    let text = ''
    const carrier = node.nodeType === Node.ELEMENT_NODE && (isTextCarrier ? isTextCarrier(node as Element) : true)
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (carrier) text += child.nodeValue ?? ''
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const element = child as Element
      if (isSpace(element)) {
        text += ' '
        continue
      }
      if (exclude?.(element)) continue
      text += walk(element, depth + 1)
    }
    return text
  }
  return collapse(walk(paragraph, 0))
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
    isSpace: (element) => element.namespaceURI === DRAWING_NS && element.localName === 'br',
    isTextCarrier: (element) => element.namespaceURI === DRAWING_NS && element.localName === 't',
    exclude: includeFields ? undefined : (element) => element.namespaceURI === DRAWING_NS && element.localName === 'fld',
  })
}

/**
 * One ODF paragraph's (`text:p` or `text:h`) text — the same rule as
 * `paragraphText`, with `text:line-break`/`text:tab`/`text:s` all standing in
 * for `a:br`. Unlike PPTX, no `isTextCarrier` is passed at all: see that
 * option's own doc comment on `joinParagraphText` for why an ODF allowlist
 * (of `text:span`, in an earlier version of this function) is a losing list
 * that dropped a hyperlink's own text. ODF has no field-chrome equivalent to
 * exclude here.
 */
function odfParagraphText(paragraph: Element): string {
  return joinParagraphText(paragraph, {
    isSpace: (element) => element.namespaceURI === ODF_TEXT_NS &&
      (element.localName === 'line-break' || element.localName === 'tab' || element.localName === 's'),
  })
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
 * PER PARAGRAPH (`text:p` or `text:h`) — the ODF analogue of
 * `shapeParagraphs`, and for the same reason: anydoc emits one block per
 * paragraph, and paragraph-per-entry is what its output is reconciled
 * against. `text:h` (a heading) is queried alongside `text:p` for the same
 * reason the page-level query in `odpIndex` does: fix-review round 5
 * measured that a `text:h` inside speaker notes made anydoc's own rendering
 * of the notes blockquote read `"Notes heading Notes body."` while this
 * function, `text:p`-only, produced `"Notes body."` alone — a failed
 * strict-equality comparison that publishes the notes, the exact failure
 * this module exists to prevent. The two element kinds are queried
 * separately (`getElementsByTagNameNS` takes one name at a time) and merged
 * back into document order with `documentOrder`, the same merge the page
 * query already does. `getElementsByTagNameNS` finds a match at ANY depth
 * under `container`, which is exactly what is needed for Impress's bulleted
 * body — `text:list > text:list-item > text:p` — where a paragraph is
 * nested two levels below the frame it belongs to, not a direct child of
 * it. Collapsing a whole FRAME's `textContent` into one string instead (the
 * ORIGINAL form of this module's ODP stub) merges every bullet into a
 * single run, which anydoc's own per-paragraph blocks never do, and which
 * the later reconciliation cannot match against.
 */
function odfParagraphs(container: Element): string[] {
  return [
    ...container.getElementsByTagNameNS(ODF_TEXT_NS, 'p'),
    ...container.getElementsByTagNameNS(ODF_TEXT_NS, 'h'),
  ]
    .sort(documentOrder)
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

/**
 * Document order between two elements NOT necessarily fetched by the same
 * `getElementsByTagNameNS` call — needed because the page's paragraph query
 * (below) merges `text:p` and `text:h` results from two separate calls, and
 * `compareDocumentPosition` is the DOM's own answer for "which comes first,"
 * rather than assuming a document only ever mixes the two element kinds in
 * an order this module would have to guess at.
 */
function documentOrder(a: Element, b: Element): number {
  const position = a.compareDocumentPosition(b)
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1
  return 0
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

    /*
     * Roots to exclude from the page's own text below: the notes subtree
     * (`presentation:notes`, a direct child of `draw:page`), AND every
     * `office:annotation` — an Impress comment, ALSO a direct child of
     * `draw:page`. anydoc emits no block for a comment, so leaving it in
     * would invent a content-loss disagreement whose payload is a private
     * reviewer remark — the same category of harm as publishing speaker
     * notes (fix-review round 4 measured a real comment leaking into
     * `textRuns` before this exclusion existed). The deep `contains()` check
     * below is the same one already confirmed airtight for notes nested
     * several levels down.
     */
    const excludedRoots: readonly Element[] = notesElement
      ? [notesElement, ...page.getElementsByTagNameNS(ODF_OFFICE_NS, 'annotation')]
      : [...page.getElementsByTagNameNS(ODF_OFFICE_NS, 'annotation')]

    /*
     * Every `text:p` AND `text:h` in the page, in document order, wherever
     * they live — inside a `draw:frame`, inside a shape drawn from the
     * toolbar (`draw:custom-shape`, `draw:rect`, `draw:caption`, ... —
     * Impress puts typed text directly inside one of these, with no
     * enclosing frame at all), inside a `draw:g` group, or inside a frame
     * nested inside another frame — EXCEPT `excludedRoots` above.
     * `text:h` (a heading) is included alongside `text:p`: anydoc emits a
     * `heading` block for `<text:h text:outline-level="1">`, and leaving it
     * out of this query made the index blind to ordinary Impress content
     * that anydoc reports, a false content-loss disagreement on decks that
     * never touched anything unusual. The two element kinds are queried
     * separately (`getElementsByTagNameNS` takes one name at a time) and
     * merged back into a single document-order list with `documentOrder`.
     *
     * This is deliberately ONE flat query, not a per-shape walk that widens
     * a shape-kind allowlist (`draw:frame` plus `draw:custom-shape` plus
     * ...): fix-review round 3 measured that a per-shape walk double-counts
     * a frame nested inside another frame, because the OUTER frame's own
     * descendant query finds the SAME `text:p` the inner frame also finds —
     * three copies once a title frame is also present. Querying directly
     * against the page, once, counts each physical paragraph exactly once
     * no matter what — or how much — wraps it. It also means `draw:g`
     * (Impress's own "Group" command) needs no explicit recursion the way
     * PPTX's `p:grpSp` does in `walkShapes`: `getElementsByTagNameNS` finds
     * a match at ANY depth in a single call, so a paragraph inside a group
     * is found exactly as if it were not grouped. That single browser-native
     * call has no recursion of ITS OWN to overflow — the recursion that DOES
     * exist in this module, `joinParagraphText`'s per-paragraph run/span
     * walk, is capped separately by `MAX_PARAGRAPH_NESTING_DEPTH`.
     */
    const paragraphs = [
      ...page.getElementsByTagNameNS(ODF_TEXT_NS, 'p'),
      ...page.getElementsByTagNameNS(ODF_TEXT_NS, 'h'),
    ]
      .sort(documentOrder)
      .filter((paragraph) => !excludedRoots.some((root) => root.contains(paragraph)))
      .map((paragraph) => ({ element: paragraph, text: odfParagraphText(paragraph) }))
      .filter((paragraph) => paragraph.text.length > 0)

    /*
     * Title identification is unchanged from the frame-only version: the
     * first `draw:frame` carrying `presentation:class="title"`, first
     * non-empty paragraph inside it, wins — matching `walkShapes`'s "first
     * wins" rule on the PPTX side. `findIndex` locates that exact paragraph
     * in the FLAT list above by DOM identity (`contains`), not by string
     * value, so the hoist below splices out the one paragraph that really
     * was the title, never a different paragraph that happens to share its
     * text.
     */
    const titleFrame = [...page.getElementsByTagNameNS(ODF_DRAW_NS, 'frame')]
      .find((frame) => frame.getAttributeNS(ODF_PRESENTATION_NS, 'class') === 'title' && !notesElement?.contains(frame))
    const titleIndex = titleFrame ? paragraphs.findIndex((paragraph) => titleFrame.contains(paragraph.element)) : -1
    const title = titleIndex >= 0 ? paragraphs[titleIndex]!.text : undefined
    const textRuns = paragraphs.map((paragraph) => paragraph.text)

    /*
     * ODP hoists a title frame to the top of its page regardless of where it
     * was authored (design fact 4, measured 2026-08-29), so a title is never
     * out of order downstream. Reporting the AUTHORED position here would
     * raise a warning about a disagreement the reader never sees. The runs
     * are reordered to match, title first — spliced out by INDEX
     * (`titleIndex`, resolved by DOM identity above) rather than by
     * re-filtering for a value equal to the title string, so a body
     * paragraph that happens to repeat the title's exact text is never also
     * removed.
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
