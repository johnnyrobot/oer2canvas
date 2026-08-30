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
  /**
   * WHERE THIS SLIDE'S PICTURES COME FROM: the package parts its pictures
   * reference (`ppt/media/image1.png`, `Pictures/image1.png`), plus the URL of
   * any picture linked from outside the package. DEDUPLICATED, in the order
   * first seen — see `reconcile.ts` for why a set rather than a list.
   *
   * ONE ENTRY IS NEITHER: an opaque sentinel for a reference the slide really
   * makes and this module cannot NAME (a malformed percent sequence, a target
   * resolving to the package root or off it, a raw `#` or `?`). It is
   * deliberately a value no picture's `data-origin-part` can ever equal, so a
   * slide holding one always reaches a refusal instead of quietly losing its
   * pictures to a neighbour that looks like their sole referencer. Treat every
   * entry as OPAQUE and compare it only against a `data-origin-part`; never
   * parse one as a path.
   *
   * anydoc emits a picture as a block carrying an `<img>` and NO text of its
   * own, so no text comparison can attribute one. This replaces the per-slide
   * COUNT that used to do that job. A count required predicting which shapes
   * anydoc turns into a picture block, and five review rounds each found a
   * shape the prediction got wrong; being uncounted is precisely the defect, so
   * no counting rule can see it. A part path is an identity both accounts
   * already hold — `parsers/anydoc-html.ts` tags every picture it emits with
   * its own origin (`data-origin-part`) — so the two are JOINED rather than
   * balanced.
   */
  pictureOrigins: readonly string[]
  /** The title placeholder is not first in reading order. */
  titleOutOfOrder: boolean
  /**
   * Content anydoc drops with no block and no asset.
   *
   * `pictures` is the one that is not anydoc's decision: a blip naming a
   * relationship the package never declared. Nothing anywhere else records it —
   * anydoc emits no block and raises no finding, and the index resolves the
   * reference to no part — so without this the deck imports and NOTHING says a
   * picture was ever there. It is a loss to report, not a disagreement to
   * refuse on: the two accounts agree exactly, and what they agree on is that
   * the deck points at a picture the deck does not contain.
   */
  unrepresentable: { diagrams: number; charts: number; media: number; pictures: number }
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
const OLE_URI = 'http://schemas.openxmlformats.org/presentationml/2006/ole'
const TABLE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table'
/**
 * PowerPoint's 2010 drawing extensions — artistic picture effects, math inside
 * a shape. The ONE `mc:Choice` namespace anydoc renders in preference to the
 * `mc:Fallback`; see `rendersChoiceBranch`.
 */
const A14_NS = 'http://schemas.microsoft.com/office/drawing/2010/main'
const ODF_OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const ODF_TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const ODF_DRAW_NS = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'
const ODF_PRESENTATION_NS = 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

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
 *
 * An `office:annotation` anchored INLINE, mid paragraph, is NOT excluded, and
 * that is measured rather than assumed. Driving real anydoc 0.2.4 over an
 * .odp whose notes paragraph carries one, its blockquote reads `"Mention the
 * labINLINE PRIVATE before class."` — the comment's text included exactly
 * ONCE, concatenated with no separator, because ODF has no isolating leaf
 * element. `notesText` is compared to that blockquote by strict equality
 * downstream, so it has to reproduce anydoc's string exactly; excluding the
 * comment produced `"Mention the lab before class."`, which fails the same
 * comparison from the other side and publishes the notes just as surely.
 * Counting it exactly once is the whole fix — see `odfParagraphs` for the
 * SECOND count that had to go instead.
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

/**
 * `TargetMode="External"` on a relationship: the `Target` is a URL rather than
 * a part inside the package. PowerPoint's "Link to File" insert writes one, and
 * anydoc emits an ordinary `<img src="https://…">` for it (measured) — with no
 * bytes and therefore no package part, so the URL itself is that picture's
 * identity on both sides of the join.
 */
const EXTERNAL_TARGET_MODE = 'External'

/**
 * Every relationship this slide declares, as the string that identifies what it
 * points at: a package part path for an internal target, the URL verbatim for
 * an external one. Filtered by nothing — a relationship is looked up only when
 * a blip names it, so an unused image relationship (a picture background lives
 * in the slide's rels too) can never make the index expect a picture.
 */
function slideRelationshipTargets(relsXml: string | undefined): Map<string, string> {
  const targets = new Map<string, string>()
  if (!relsXml) return targets
  const document = parseXml(relsXml, 'relationship part')
  for (const relationship of document.getElementsByTagNameNS(RELS_NS, 'Relationship')) {
    const id = relationship.getAttribute('Id')
    const target = relationship.getAttribute('Target')
    if (!id || !target) continue
    if (relationship.getAttribute('TargetMode') === EXTERNAL_TARGET_MODE) {
      targets.set(id, target)
      continue
    }
    // A DECLARED relationship always produces an entry, even when its target
    // cannot be named: the difference between "this slide references something
    // I cannot identify" and "this slide references nothing" is the difference
    // between a refusal and a neighbouring slide quietly claiming exclusivity
    // it does not have. See `UNRESOLVABLE_REFERENCE`.
    targets.set(id, resolvePackagePath(target, SLIDE_PART_DIRECTORY) ?? UNRESOLVABLE_REFERENCE)
  }
  return targets
}

function relationshipTargets(relsXml: string | undefined, type: string): string[] {
  if (!relsXml) return []
  const document = parseXml(relsXml, 'relationship part')
  return [...document.getElementsByTagNameNS(RELS_NS, 'Relationship')]
    .filter((relationship) => relationship.getAttribute('Type') === `${R_NS}/${type}`)
    .map((relationship) => relationship.getAttribute('Target') ?? '')
    .filter(Boolean)
}

/**
 * The directory every relationship in `ppt/slides/_rels/slideN.xml.rels` is
 * relative to — the part's OWN directory, per OPC.
 */
const SLIDE_PART_DIRECTORY = 'ppt/slides/'

/**
 * A host that exists only to give `URL` something to resolve against. Nothing
 * is ever fetched from it; a package part name is a relative reference and
 * `URL` is the one correct implementation of relative-reference resolution
 * available here (no `node:path` — `tsconfig.json` omits node types).
 */
const PACKAGE_ORIGIN = 'https://package.invalid/'

const PACKAGE_ROOT = ''

/**
 * A reference the index can see but cannot NAME: a relationship target or an
 * `xlink:href` that will not resolve to a package part (a malformed percent
 * sequence, an absolute URL where a part was expected, a raw `#` or `?`).
 *
 * It is recorded as an origin — a reference to something unknown — rather than
 * dropped, and that distinction is the whole point. MEASURED: with slide 1
 * naming `../media/100%.png` (a literal, unencoded `%`) and slide 2 naming the
 * same ZIP entry through a properly encoded `../media/100%25.png`, dropping
 * slide 1's reference made slide 2 the SOLE referencer of that part — so it
 * claimed BOTH blocks, sections came out `[[], ["ONE PIC", "TWO PIC"]]`, and
 * the only finding was a warning saying slide 1's picture "could not be
 * imported", which was false: it was imported, under slide 2's heading.
 *
 * Nothing can ever satisfy this origin — no `data-origin-part` can equal a
 * string containing a NUL, which is not a legal character in a ZIP entry name
 * or a URL — so a slide holding one ALWAYS reaches the refusal rather than
 * silently losing its pictures to a neighbour.
 */
const UNRESOLVABLE_REFERENCE = '\u0000unresolvable-reference'

const PACKAGE_ORIGIN_ORIGIN = new URL(PACKAGE_ORIGIN).origin

/**
 * A relative reference as the ZIP entry name it denotes, resolved against
 * `baseDirectory` (a package-root-relative directory, `''` for the root
 * itself), or `undefined` when it names no part inside this package.
 *
 * The PPTX side used to be `ppt/${target.replace(/^\.\.\//, '')}` — a string
 * hack that was harmless while it only located a notes part, and is not
 * harmless now the same string is a picture's IDENTITY — and the ODP side took
 * `xlink:href` verbatim, which is the same defect on the other format. Both are
 * URI references, and three things went wrong without real resolution:
 *
 * - NO PERCENT-DECODING. A media part named `image 1.png` is written
 *   `../media/image%201.png` (PPTX) or `Pictures/image%201.png` (ODP).
 *   MEASURED on both formats: the index kept the encoded form while anydoc
 *   reported the decoded one, so an entirely ordinary filename refused the
 *   whole deck.
 * - NO REAL RESOLUTION. `media/x.png` (a legal sibling reference) resolved as
 *   though it had been written `../media/x.png`, and `.` / `..` segments
 *   anywhere but the very front were left in place.
 * - A RAW `#` OR `?` TRUNCATED THE NAME. `../media/im#age.png` resolved to
 *   `ppt/media/im` — a silently WRONG value, which is worse than an absent one
 *   because it still feeds the sole-referencer test. A part name is a path, not
 *   a URL with a fragment or a query, so a reference carrying either is refused
 *   rather than trimmed. MEASURED: anydoc cannot resolve it either and reports
 *   an empty origin, so "neither account can name it" is the honest agreement.
 */
function resolvePackagePath(reference: string, baseDirectory: string): string | undefined {
  let resolved: URL
  try {
    resolved = new URL(reference, `${PACKAGE_ORIGIN}${baseDirectory}`)
  } catch {
    return undefined
  }
  if (resolved.origin !== PACKAGE_ORIGIN_ORIGIN) return undefined
  if (resolved.hash !== '' || resolved.search !== '') return undefined
  let path: string
  try {
    path = decodeURIComponent(resolved.pathname.replace(/^\//, ''))
  } catch {
    return undefined
  }
  /*
   * THE EMPTY STRING IS NOT A PART NAME, and returning it was a silent
   * misattribution rather than a harmless oddity: `''` is exactly the origin
   * `parsers/anydoc-html.ts` writes for a picture it could NOT identify, and a
   * slide holding it therefore became the sole referencer of every
   * unidentifiable picture in the deck. MEASURED, an ODP with
   * `xlink:href="."` on page 1 and an `office:binary-data` picture on page 2:
   * page 1 claimed BOTH placeholders and the only finding was the untitled
   * slide warning. A reference resolving to the package root (`.`, `/`, `..`)
   * names no part, so it is unresolvable like any other — one "cannot name it"
   * value, deliberately unclaimable, instead of two of which one was claimable.
   */
  return path === '' ? undefined : path
}

/** Whether a reference names its own scheme, and so points outside the package. */
function isAbsoluteReference(reference: string): boolean {
  try {
    new URL(reference)
    return true
  } catch {
    return false
  }
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

/**
 * Whether anydoc renders THIS `mc:Choice` rather than the `mc:Fallback`.
 *
 * MEASURED with real anydoc 0.2.4, nine `Requires` values on an otherwise
 * identical package: the Choice is rendered when `Requires` is ABSENT, and when
 * it names `a14` (PowerPoint's 2010 drawing extensions — artistic picture
 * effects, math inside a shape, which PowerPoint itself writes); the Fallback
 * is rendered for `p14`, `p15`, `a16`, `cx`, `wps`, `v`, and for a namespace
 * anydoc has never heard of.
 *
 * So neither blanket rule works, and both were tried: preferring the Choice was
 * wrong for seven of the nine (silent for a picture — PowerPoint writes an ink
 * annotation as a `p14:contentPart` Choice with an ordinary `p:pic` Fallback,
 * so the index saw no picture while anydoc emitted one, and that picture was
 * published under the NEXT slide's heading), and preferring the Fallback is
 * wrong for the other two.
 *
 * `Requires` holds PREFIXES, not URIs, so each is resolved through the element's
 * own namespace scope — the prefix `a14` is a convention, not a guarantee. A
 * `Requires` listing several prefixes takes the Choice only if anydoc could
 * render all of them, which is the conservative reading of "requires".
 */
function rendersChoiceBranch(choice: Element): boolean {
  const requires = choice.getAttribute('Requires')?.trim()
  if (!requires) return true
  return requires.split(/\s+/).every((prefix) => choice.lookupNamespaceURI(prefix) === A14_NS)
}

/**
 * WHERE A PICTURE SHAPE'S BYTES COME FROM: every `a:blip` under a `p:blipFill`
 * anywhere beneath `shape`, resolved through the slide's own relationships and
 * recorded on `state` — as an origin when it resolves, and as a reported loss
 * (`unrepresentable.pictures`) when it does not.
 *
 * The scoping that matters is being INSIDE A `p:pic` — the element that IS a
 * picture — not the namespace of its fill. This is only ever called with a
 * `p:pic`, so a slide background's, a shape's or a table cell's `a:blipFill`
 * (drawingml) is out of reach by construction; anydoc emits no picture block
 * for any of those, and all three are measured agreeing.
 *
 * WITHIN a `p:pic`, both namespaces are read. PowerPoint writes
 * `p:blipFill` (presentationml) and that is preferred when present, but
 * MEASURED with real anydoc 0.2.4, a `p:pic` whose fill is written
 * `a:blipFill` instead renders with a real origin — and so does one whose
 * `a:blipFill` sits under `p:spPr` where a SHAPE fill would go. Scoping to the
 * presentationml element recorded nothing for either, which alone is a loud
 * blocker but beside an untitled picture-only slide let the previous slide stay
 * sole referencer and claim both blocks.
 *
 * ONE FILL, because one picture shape is one picture: the first `p:blipFill`,
 * else the first `a:blipFill`. A `p:pic` carrying a real picture fill AND a
 * decorative one would otherwise make the index expect two pictures where
 * anydoc emits one.
 *
 * `r:embed` wins over `r:link` when a blip carries both — REASONED, not
 * measured: bytes present in the package are what a renderer prefers, and
 * adding both would make the index expect two pictures where anydoc emits one.
 * A blip naming neither, or naming a relationship the package never declared,
 * contributes NO ORIGIN — which is exactly what anydoc emits for it (measured:
 * a `p:pic` whose `r:embed` names an undefined relationship produces no block
 * and no finding). That is the whole of the old `hasRenderablePicture`
 * prediction, now falling out of the resolution instead of being modelled.
 */
function readBlipOrigins(shape: Element, state: ShapeWalkState): void {
  const fill = shape.getElementsByTagNameNS(PML_NS, 'blipFill')[0]
    ?? shape.getElementsByTagNameNS(DRAWING_NS, 'blipFill')[0]
  if (fill) {
    for (const blip of fill.getElementsByTagNameNS(DRAWING_NS, 'blip')) {
      const relationshipId = blip.getAttributeNS(R_NS, 'embed') ?? blip.getAttributeNS(R_NS, 'link')
      // A blip naming NO relationship references no image data at all, so
      // nothing was ever there to lose — measured: anydoc emits nothing, and
      // the two accounts agree on nothing.
      if (!relationshipId) continue
      const origin = state.resolveRelationship(relationshipId)
      // A blip naming an UNDECLARED relationship is the opposite: the deck says
      // a picture is there and the package does not contain it. Both accounts
      // still agree — anydoc emits no block for it either — so it is a LOSS to
      // report, not a disagreement to refuse on. A relationship that IS
      // declared but whose target cannot be named is a third thing again, and
      // `slideRelationshipTargets` has already turned it into
      // `UNRESOLVABLE_REFERENCE`, which lands in `pictureOrigins` below and
      // refuses.
      if (origin === undefined) state.unrepresentable.pictures += 1
      else state.pictureOrigins.add(origin)
    }
  }
}

interface ShapeWalkState {
  textRuns: string[]
  title: string | undefined
  titleIndex: number
  /** Deduplicated, in the order first seen — see `PresentationSlideIndex`. */
  pictureOrigins: Set<string>
  unrepresentable: { diagrams: number; charts: number; media: number; pictures: number }
  /** A relationship id from this slide's own rels, as a part path or a URL. */
  resolveRelationship: (relationshipId: string) => string | undefined
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
 *   ALTERNATIVE representations of the SAME content, never both real. Exactly
 *   one branch is walked — that is what keeps a single diagram from being
 *   counted twice — and WHICH one is decided by `rendersChoiceBranch` from the
 *   `Requires` namespace, because anydoc's own answer depends on it.
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
      else if (uri === OLE_URI) {
        /*
         * A pasted Excel worksheet, Word table or Visio drawing:
         * `p:graphicFrame` → `p:oleObj` → a PREVIEW `p:pic`. The preview is all
         * anydoc ever sees of it, and anydoc emits a picture block for it
         * (measured: `<p><span>[Embedded image: Worksheet]</span></p>`, since a
         * preview is usually an EMF this importer cannot package).
         *
         * It is read HERE because the preview sits two levels below the shape
         * tree, where the `p:pic` branch below — which only ever sees a
         * shape-level or group-level picture — never reaches it. Recording
         * nothing for it meant a slide could not claim its own worksheet
         * preview, and measured alongside a broken embed on an earlier slide,
         * slide 2's content published under slide 1's heading with no blocker
         * at all.
         *
         * THE IDENTITY IS THE OLE OBJECT'S OWN PART, NOT THE PREVIEW'S BLIP,
         * and that is measured rather than assumed: real anydoc 0.2.4 reports
         * this picture's `originPart` as `ppt/embeddings/worksheet1.xlsx` —
         * the `p:oleObj/@r:id` target — even though the bytes it renders come
         * from the preview `p:pic`'s own `r:embed` (`ppt/media/image2.emf`).
         * Reading the blip here instead made the index expect a part that
         * never arrives and the preview belong to no slide, which is a refusal
         * on an ordinary pasted worksheet. The blip is deliberately NOT also
         * recorded: it would be a second part nothing ever carries.
         */
        for (const oleObject of shape.getElementsByTagNameNS(PML_NS, 'oleObj')) {
          const relationshipId = oleObject.getAttributeNS(R_NS, 'id')
          if (!relationshipId) continue
          const origin = state.resolveRelationship(relationshipId)
          // Same rule as a blip's: a named relationship the package does not
          // declare is an embedded object the deck says is there and is not.
          if (origin === undefined) state.unrepresentable.pictures += 1
          else state.pictureOrigins.add(origin)
        }
      }
      else if (uri === TABLE_URI) {
        /*
         * A table frame is NOT a loss — anydoc emits it as a real data table
         * (design fact 8) — so its text is CONTENT, and content anydoc emits
         * that the index does not know about is a disagreement the reconciler
         * can only answer by refusing. Measured with real anydoc 0.2.4: a slide
         * carrying a title, a body and a two-by-two table emitted the table's
         * every cell, while `textRuns` held only the title and the body, and
         * the deck refused to import. (The ODP side needed no equivalent: its
         * flat `text:p` query already finds a `table:table-cell`'s paragraph
         * wherever it sits.)
         *
         * `shapeParagraphs` over the frame returns every `a:p` under `a:tbl` in
         * DOCUMENT ORDER, which for a table is row-major — row by row, cell by
         * cell — the same order anydoc renders `thead` then `tbody` in. Header
         * rows are not hoisted by either account, because OOXML has no separate
         * header row: `a:tblPr/@firstRow` merely styles the first row, which is
         * already first.
         */
        state.textRuns.push(...shapeParagraphs(shape))
      }
      continue
    }
    if (shape.namespaceURI === PML_NS && shape.localName === 'pic') {
      /*
       * A picture carrying `a:videoFile` (or `a:audioFile`) is media, which
       * anydoc drops entirely. A plain picture is an ordinary image and travels
       * the existing asset path.
       *
       * THESE ARE NOT EXCLUSIVE, and treating them as if they were made a deck
       * with a video unimportable. PowerPoint writes a media `p:pic` with a
       * POSTER FRAME — the still shown before the video plays — as an ordinary
       * embedded blip in the same shape's `p:blipFill`, and anydoc emits
       * `<p><img …></p>` for that poster (measured, real anydoc 0.2.4). So the
       * shape is BOTH: one media loss to report, and one picture whose origin
       * its slide must be able to claim, or the poster block belongs to nobody
       * and the whole import refuses.
       */
      const isMedia = shape.getElementsByTagNameNS(DRAWING_NS, 'videoFile').length > 0 ||
        shape.getElementsByTagNameNS(DRAWING_NS, 'audioFile').length > 0
      if (isMedia) state.unrepresentable.media += 1
      readBlipOrigins(shape, state)
      continue
    }
    if (shape.namespaceURI === PML_NS && shape.localName === 'grpSp') {
      walkShapes(shape, state, depth + 1)
      continue
    }
    if (shape.namespaceURI === MC_NS && shape.localName === 'AlternateContent') {
      /*
       * ONE branch, chosen the way ANYDOC chooses it — see
       * `rendersChoiceBranch` for the measurement. Neither "always Choice" nor
       * "always Fallback" is right: measured across nine `Requires` values on
       * an otherwise identical package, anydoc renders the Fallback for seven
       * of them and the Choice for the other two.
       *
       * The first `mc:Choice` anydoc would render wins; otherwise the
       * `mc:Fallback`; otherwise NOTHING.
       *
       * That last clause used to read "otherwise the first Choice, because an
       * `mc:AlternateContent` with no Fallback is legal and reading its Choice
       * beats reading nothing". It is legal, and reading it does NOT beat
       * reading nothing: MEASURED, an `mc:AlternateContent` carrying one
       * `mc:Choice` with an unsupported `Requires` and no `mc:Fallback` makes
       * anydoc emit no block at all — not for text (`<h2>One</h2>` alone, with
       * the Choice's paragraph nowhere) and not for a picture. Walking that
       * branch therefore collected content nothing carries, and for a picture
       * that is not merely a spurious refusal: the part it over-collected was
       * the part an EARLIER slide really owns, so the sole-referencer rule
       * capped that slide at one block and handed this one the surplus, and
       * slide 1's second picture published under slide 2's heading with no
       * findings at all. Collecting nothing is what anydoc does.
       */
      const children = [...shape.children]
      const choices = children.filter((child) => child.namespaceURI === MC_NS && child.localName === 'Choice')
      const fallback = children.find((child) => child.namespaceURI === MC_NS && child.localName === 'Fallback')
      const chosen = choices.find(rendersChoiceBranch) ?? fallback
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

    const relsXml = parts[`ppt/slides/_rels/${path!.split('/').pop()}.rels`]
    const relationshipTargetById = slideRelationshipTargets(relsXml)

    const state: ShapeWalkState = {
      textRuns: [],
      title: undefined,
      titleIndex: -1,
      pictureOrigins: new Set<string>(),
      unrepresentable: { diagrams: 0, charts: 0, media: 0, pictures: 0 },
      resolveRelationship: (relationshipId) => relationshipTargetById.get(relationshipId),
    }
    walkShapes(tree, state)

    const notesTarget = relationshipTargets(relsXml, 'notesSlide')[0]
    const notesPath = notesTarget ? resolvePackagePath(notesTarget, SLIDE_PART_DIRECTORY) : undefined
    const notesXml = notesPath ? parts[notesPath] : undefined
    const notesText = notesXml ? notesBodyText(parseXml(notesXml, 'notes part')) : undefined

    slides.push({
      number: position + 1,
      ...(state.title ? { title: state.title } : {}),
      textRuns: state.textRuns,
      ...(notesText ? { notesText } : {}),
      pictureOrigins: [...state.pictureOrigins],
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
 *
 * THE NESTING RULE THE SLIDE BODY OBEYS DOES NOT APPLY HERE, AND THAT IS
 * MEASURED, NOT AN OVERSIGHT. On a `draw:page`, anydoc's walk stops the moment
 * a shape contains another shape (see `enclosingShapeCount` and `isWalkedText`):
 * a `draw:frame` inside a `draw:frame` emits no block at all. Inside
 * `presentation:notes` it does NOT stop — measured with real anydoc 0.2.4 on a
 * notes frame containing a nested frame:
 *
 *     <blockquote><p>PRIVATE NOTE.</p><p>NESTED PRIVATE</p></blockquote>
 *
 * so this any-depth query is the one that AGREES, producing
 * `"PRIVATE NOTE. NESTED PRIVATE"` — byte-for-byte the blockquote's own text,
 * which is the only definition under which the strict-equality comparison
 * downstream can work.
 *
 * DO NOT "FIX" THIS BY APPLYING `isWalkedText`. Measured by doing exactly that:
 * `notesText` becomes `"PRIVATE NOTE."`, the comparison against anydoc's
 * blockquote fails, the blockquote is no longer recognised as speaker notes,
 * and the deck takes a `presentation-unattributed-content` blocker — a refusal
 * on an ordinary deck at best, and on a deck whose notes happen to fit the
 * slide's own run accumulation, the presenter's private notes published into a
 * student-facing page. That is the single failure this module exists to
 * prevent, and the "consistency" fix causes it rather than preventing it.
 *
 * A paragraph living INSIDE an `office:annotation` is skipped, because this
 * flat any-depth query would otherwise find it TWICE over: once as part of
 * the paragraph the comment is anchored in (`odfParagraphText` walks into the
 * annotation, as anydoc does), and once again here as a standalone paragraph
 * of its own. The doubled text fails the strict-equality comparison
 * `notesText` exists for, and a failed comparison publishes the speaker
 * notes. Removing this second visit — rather than the inline text anydoc
 * itself emits — is what makes the two strings agree.
 */
function odfParagraphs(container: Element): string[] {
  const annotations = [...container.getElementsByTagNameNS(ODF_OFFICE_NS, 'annotation')]
  return [
    ...container.getElementsByTagNameNS(ODF_TEXT_NS, 'p'),
    ...container.getElementsByTagNameNS(ODF_TEXT_NS, 'h'),
  ]
    .filter((paragraph) => !annotations.some((annotation) => annotation.contains(paragraph)))
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
 * ODF drawing elements that are NOT a shape of their own on the page, and so do
 * not count toward the nesting depth `enclosingShapeCount` measures:
 * `draw:g`, Impress's own Group command, which anydoc walks straight through
 * (measured at one, two, three, four and five levels); and `draw:text-box`, a
 * frame's own text container rather than a second shape inside it.
 *
 * Anything else in the drawing namespace between a page and its content is a
 * SHAPE — a `draw:frame`, a `draw:custom-shape`, a toolbar rectangle, a
 * `draw:a` picture hyperlink.
 */
const ODF_TRANSPARENT_CONTAINERS = new Set(['g', 'text-box'])

/**
 * How many ODF SHAPES enclose this element on its way up to its `draw:page`, or
 * `undefined` when it is not on a page at all. Elements outside the drawing
 * namespace — `table:table-cell`, `text:list`, `text:list-item` — are neither
 * shapes nor terminators and are simply passed through.
 */
function enclosingShapeCount(node: Element): number | undefined {
  let shapes = 0
  for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.namespaceURI !== ODF_DRAW_NS) continue
    if (ancestor.localName === 'page') return shapes
    if (!ODF_TRANSPARENT_CONTAINERS.has(ancestor.localName)) shapes += 1
  }
  return undefined
}

/**
 * ONE RULE, TWO CONTENT TYPES: **a shape's own content is read; a shape nested
 * inside another shape is not entered.** A page places shapes, `draw:g` groups
 * them, and anydoc's walk stops the moment a shape contains another shape.
 *
 * ODF puts almost no constraint on where a `draw:image` or a `text:p` may sit,
 * and the flat any-depth queries this replaces collected every one of them;
 * anydoc reaches content by WALKING A SHAPE TREE. The two disagree at every
 * placement the walk does not visit, and MEASURED with real anydoc 0.2.4 that
 * is at least eight for pictures — `draw:frame > draw:a > draw:image` (ODF's
 * hyperlinked picture), an image inside a `table:table` cell, a frame nested
 * inside another frame's `draw:text-box`, an image hung off a
 * `draw:custom-shape`, a bare `draw:image` directly under `draw:page`, and a
 * frame inside a frame reached directly, through a group, and inside a group.
 * anydoc emits NO block for any of them while the index recorded a part for
 * each.
 *
 * That was not merely a spurious refusal. The over-collected part is one an
 * EARLIER page really owns, so the sole-referencer rule capped that page at one
 * block and handed this one the surplus: measured with page 1 showing a picture
 * twice and page 2 holding that same part inside a table cell — and again with
 * a frame inside a frame — page 1's second picture published under page 2's
 * heading with NO findings at all.
 *
 * An earlier version of this rule allowed `draw:frame` as an intermediate
 * container as well as `draw:g`. Every measurement across four rounds is
 * consistent with groups being the ONLY thing a frame may be reached through,
 * and `draw:frame` was the one member of that set never backed by a
 * measurement — which is exactly the member that admitted the ninth
 * counterexample.
 *
 * The TEXT half is not identical, and the difference is measured rather than
 * assumed: a `draw:custom-shape`'s OWN text IS emitted (task 5), and so is a
 * grouped one's, while a frame nested inside another shape is not entered for
 * text any more than for pictures. So text allows any shape at depth one, where
 * a picture additionally requires that shape to be the `draw:frame` holding it.
 *
 * Both are chain tests rather than a recursive walk because the page's queries
 * must stay FLAT: fix round 3 of task 6 measured that a per-shape text walk
 * double-counts a paragraph inside a frame inside a frame, finding it once for
 * each enclosing frame's own descendant query.
 */

/** A shape's own content: the shape that holds it, and nothing above it but groups. */
const OWN_CONTENT_SHAPE_DEPTH = 1

function isWalkedPicture(image: Element): boolean {
  const frame = image.parentElement
  if (!frame || frame.namespaceURI !== ODF_DRAW_NS || frame.localName !== 'frame') return false
  return enclosingShapeCount(image) === OWN_CONTENT_SHAPE_DEPTH
}

/**
 * Text belongs to the shape that holds it, so it may sit at most that one shape
 * deep. Zero — a paragraph directly under the `draw:page`, outside any shape —
 * is left alone rather than newly excluded: it is not a shape anydoc was
 * measured skipping, and the flat query has always collected it.
 */
function isWalkedText(paragraph: Element): boolean {
  const shapes = enclosingShapeCount(paragraph)
  return shapes !== undefined && shapes <= OWN_CONTENT_SHAPE_DEPTH
}

/**
 * What a `draw:image`'s `xlink:href` identifies: the package part it names, the
 * URL itself when it points outside the package, or `UNRESOLVABLE_REFERENCE`
 * when the href is there but cannot be named. `undefined` means the element
 * references nothing at all — ODF also allows the bytes inline as
 * `office:binary-data`, and anydoc emits a block with an empty origin for that,
 * which no slide can claim and which therefore already refuses.
 *
 * An href is an IRI, so it needs exactly the same percent-decoding and
 * resolution as a PPTX relationship target — see `resolvePackagePath` for the
 * measurement on both formats.
 */
function odfPictureOrigin(href: string | null): string | undefined {
  if (!href) return undefined
  if (isAbsoluteReference(href)) return href
  return resolvePackagePath(href, PACKAGE_ROOT) ?? UNRESOLVABLE_REFERENCE
}

/**
 * The first `draw:image` among an element's OWN children — the one alternative
 * representation a consumer renders (ODF 1.3 §10.4.2). See the page query below
 * for the misattribution taking all of them produced.
 */
function firstImageChild(parent: Element | null): Element | undefined {
  return [...parent?.children ?? []]
    .find((child) => child.namespaceURI === ODF_DRAW_NS && child.localName === 'image')
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

/**
 * A `draw:mime-type` naming audio or video. `application/vnd.sun.star.media`
 * is the one LibreOffice writes for its own media player object; a converter
 * writes the concrete type (`video/mp4`, `audio/mpeg`) instead, so both forms
 * are recognised rather than only the one Impress happens to use.
 */
function isOdfMediaMime(mimeType: string | null): boolean {
  if (!mimeType) return false
  return mimeType.startsWith('video/') || mimeType.startsWith('audio/') ||
    mimeType === 'application/vnd.sun.star.media'
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
      .filter((paragraph) => isWalkedText(paragraph))
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
      /*
       * THE FIRST `draw:image` OF EACH FRAME, and only the first.
       *
       * ODF 1.3 §10.4.2: a `draw:frame`'s children are ALTERNATIVE
       * representations of the same object, of which a consumer renders the
       * first it supports — not several pictures side by side. Collecting all
       * of them (this query did) makes the index expect pictures anydoc never
       * emits, and that is not merely a spurious refusal. MEASURED, real
       * anydoc, real .odp: page 1 with two frames both on `Pictures/image1.png`
       * and page 2 with ONE frame holding `Pictures/image2.png` then
       * `Pictures/image1.png` as alternatives — the over-collected reference
       * made `image1.png` look like two slides' part, the sole-referencer rule
       * then capped page 1 (its true and only owner) at one block and handed
       * page 2 a claim on the surplus, and the balance check passed because the
       * part page 2 over-claimed is exactly the part it over-collected. Page
       * 1's second picture published inside `<section data-slide="2">` with no
       * findings at all.
       *
       * The first child is taken by DOM position among its parent's own
       * children, not by the flat query's order, so a frame nested inside
       * another frame keeps its own first child.
       *
       * Otherwise as PPTX: excluded roots (notes, comments) are skipped, and
       * ODF needs no relationship part — `xlink:href` names the part directly,
       * and MEASURED against real anydoc 0.2.4 that is byte-for-byte the
       * `originPart` it reports (`Pictures/image1.png`). An href pointing
       * outside the package is carried verbatim, for the same reason PPTX
       * carries an external relationship target verbatim.
       *
       * A `draw:image` with no `xlink:href` at all — ODF also allows the bytes
       * inline as `office:binary-data` — contributes nothing, so the block
       * anydoc emits for one belongs to no slide and refuses.
       */
      pictureOrigins: [...new Set([...page.getElementsByTagNameNS(ODF_DRAW_NS, 'image')]
        .filter((image) => !excludedRoots.some((root) => root.contains(image)))
        .filter((image) => isWalkedPicture(image))
        .filter((image) => image === firstImageChild(image.parentElement))
        .map((image) => odfPictureOrigin(image.getAttributeNS(XLINK_NS, 'href')))
        .filter((origin) => origin !== undefined))],
      titleOutOfOrder: false,
      /*
       * ODF carries a chart or a diagram as an embedded OBJECT rather than as
       * the distinct frame kinds PPTX uses, and nothing in the corpus
       * exercises one yet, so those two still report zero rather than guess.
       *
       * MEDIA is no longer among them. Impress writes an inserted video as a
       * `draw:plugin` carrying a media mime type, optionally with a
       * `draw:image` poster in the same frame, and measured against real
       * anydoc BOTH shapes are silent: with a poster the deck imports as an
       * ordinary picture with nothing saying a video was ever there — the
       * worse case, since the reader sees a still and has no reason to
       * suspect otherwise — and without one it vanishes entirely. Reporting
       * nothing is not the same as declining to guess.
       */
      unrepresentable: {
        diagrams: 0,
        charts: 0,
        /*
         * ODF names a picture's part directly in `xlink:href`, so there is no
         * relationship to dangle: an href pointing at a part the package does
         * not contain still RESOLVES here, anydoc still emits a placeholder for
         * it with no origin of its own, and the two accounts disagree — which
         * is a refusal, not a silent loss. Nothing on this side goes missing
         * the way a dangling `r:embed` does on the PPTX side.
         */
        pictures: 0,
        media: [
          ...page.getElementsByTagNameNS(ODF_DRAW_NS, 'plugin'),
          ...page.getElementsByTagNameNS(ODF_DRAW_NS, 'object'),
        ]
          .filter((element) => !excludedRoots.some((root) => root.contains(element)))
          .filter((element) => isOdfMediaMime(element.getAttributeNS(ODF_DRAW_NS, 'mime-type')))
          .length,
      },
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
