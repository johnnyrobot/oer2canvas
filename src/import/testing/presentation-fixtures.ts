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
 * A minimal EMF header — record type 1, and the ` EMF` signature at byte 40.
 * `prepareAssets` sniffs magic bytes and packages PNG, JPEG, GIF and WebP only,
 * so these bytes are a picture the importer cannot package: exactly what
 * PowerPoint writes for a pasted chart or legacy clip art.
 */
const EMF_BYTES = (() => {
  const bytes = new Uint8Array(88)
  bytes[0] = 1
  bytes[4] = 88
  bytes.set([0x20, 0x45, 0x4d, 0x46], 40)
  return bytes
})()

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
  /**
   * A SECOND picture on the same slide, sharing the first one's relationship.
   * Two pictures on one slide is the shape that proves the reconciler's image
   * budget is a COUNT and not a flag.
   */
  secondImage?: { alt?: string }
  /**
   * A picture whose blip is LINKED (`r:link` to an external target) with no
   * `r:embed` at all — PowerPoint's "Link to File" insert. The package carries
   * no bytes for it, so anydoc has nothing to emit.
   */
  linkedImage?: boolean
  /**
   * A picture whose `r:embed` names a relationship the package does not
   * declare. anydoc emits nothing and raises no finding of its own, so the
   * only account of the missing picture is the index's count — which is why an
   * unspent image budget has to be a disagreement rather than a silence.
   */
  brokenImage?: boolean
  /**
   * The RAW `Target` written for this slide's `rIdImage` relationship, replacing
   * the properly percent-encoded one the fixture writes by default. A
   * relationship `Target` is a URI reference, so a conforming writer encodes a
   * `%` as `%25` and a `#` as `%23`; this option exists to author the
   * NON-conforming forms a converter or a hand-edited package produces, and the
   * shapes that showed an unresolvable target vanishing silently instead of
   * being recorded as a reference to something unknown.
   */
  imageTargetOverride?: string
  /**
   * A `p:pic` whose `p:blipFill` holds a BARE `<a:blip/>` — no `r:embed` and no
   * `r:link`, so it names no image data at all. anydoc emits nothing for it,
   * and it resolves to no part, so neither account records a picture.
   */
  blipWithoutReference?: boolean
  /**
   * A picture whose `r:embed` names a relationship the package DOES declare,
   * pointing at a media part the package does not contain. Unlike
   * `brokenImage` the reference resolves, so the index expects a picture from
   * that part — and anydoc, having no bytes, cannot report an origin for
   * whatever it emits. It is the shape that exercises the join's fail-closed
   * path: a picture that can be identified by neither account.
   */
  missingMediaImage?: boolean
  /**
   * A picture whose bytes are an EMF — what PowerPoint writes for a pasted
   * chart, a Visio drawing, or legacy clip art. `prepareAssets` sniffs magic
   * bytes and packages only PNG/JPEG/GIF/WebP, so this one cannot be packaged,
   * and `anydoc-html.ts` renders it as an `[Embedded image]` placeholder span
   * (and raises its own `embedded-content` blocker for it).
   */
  unpackageableImage?: { alt?: string }
  /**
   * A pasted Excel worksheet: `p:graphicFrame` → `graphicData uri=…/ole` →
   * `p:oleObj` → a preview `p:pic`. The preview is the only part of it anydoc
   * ever sees, and it is a picture — nested two levels below the shape tree,
   * where a walk that only looks at shapes and groups never reaches it. Its
   * bytes here are the EMF a real preview usually is (see `unpackageableImage`).
   */
  oleObject?: boolean
  /**
   * An `mc:AlternateContent` whose branches carry DIFFERENT TEXT, so a test can
   * say which branch was read. Measured: anydoc renders the `mc:Fallback`
   * unless the Choice requires only namespaces it supports.
   */
  alternateContentText?: {
    choice: string
    /**
     * OMITTED emits no `mc:Fallback` element at all — legal, and the shape
     * that exposed the seventh counterexample: with no renderable Choice and
     * no Fallback, anydoc renders NOTHING, so an index that fell back to
     * reading the first Choice collected content no block ever carries.
     */
    fallback?: string
    /**
     * The prefix (or prefixes) `mc:Choice` REQUIRES, keyed into
     * `MC_REQUIRES_NAMESPACES`. An ARRAY declares several and requires all of
     * them, which is the conservative reading `rendersChoiceBranch` takes.
     * `''` emits `Requires=""` — present but empty, which is not the same
     * shape as `false`, which omits the attribute entirely. Defaults to `p14`.
     */
    requires?: keyof typeof MC_REQUIRES_NAMESPACES | readonly (keyof typeof MC_REQUIRES_NAMESPACES)[] | '' | false
    /**
     * A SECOND `mc:Choice`, after the first. An `mc:AlternateContent` may
     * carry several, and the renderable one wins wherever it sits — not the
     * first one written.
     */
    secondChoice?: {
      text: string
      requires?: keyof typeof MC_REQUIRES_NAMESPACES | readonly (keyof typeof MC_REQUIRES_NAMESPACES)[] | '' | false
    }
  }
  /**
   * An `mc:AlternateContent` carrying ONE `mc:Choice` with an unsupported
   * `Requires` and NO `mc:Fallback`, whose Choice holds an ordinary embedded
   * `p:pic` on the slide's own `rIdImage`. MEASURED: anydoc emits no block for
   * it at all. The index used to fall back to reading the first Choice, which
   * made it collect a picture part anydoc never emits — and because that part
   * is the one an EARLIER slide really owns, the earlier slide lost a picture
   * to this one with no finding at all (the seventh counterexample).
   */
  pictureInChoiceOnlyAlternateContent?: boolean
  /**
   * `mc:AlternateContent` as PowerPoint writes an INK ANNOTATION: the
   * `mc:Choice` is a `p14:contentPart` anydoc cannot render, and the
   * `mc:Fallback` is an ordinary embedded `p:pic`. Reading the Choice branch
   * meant the index saw no picture at all while anydoc emitted one.
   */
  inkInAlternateContent?: boolean
  /** Content anydoc drops entirely — design fact 6. */
  diagram?: boolean
  chart?: boolean
  video?: boolean
  /**
   * A media `p:pic` carrying `a:audioFile` rather than `a:videoFile` — an
   * inserted sound clip — with the same embedded poster blip PowerPoint gives a
   * video (an audio clip shows a speaker icon). The index treats the two media
   * kinds identically; this exists so that claim is measured against real
   * anydoc rather than reasoned from the video case.
   */
  audio?: boolean
  table?: boolean
  /**
   * Content authored inside a `p:grpSp` — PowerPoint's own "Group" command.
   * anydoc descends into groups for text but emits nothing for a grouped
   * diagram or grouped media, so the index must descend too, or the loss
   * (and the grouped text) is invisible (fix-review Important 2).
   */
  group?: { text?: string; diagram?: boolean; video?: boolean; image?: boolean }
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
const OLE_URI = 'http://schemas.openxmlformats.org/presentationml/2006/ole'

/**
 * The namespaces a real `mc:Choice`'s `Requires` names, by their conventional
 * prefix. Measured against real anydoc on an otherwise identical package,
 * anydoc renders the `mc:Fallback` for all of these EXCEPT `a14` — PowerPoint's
 * 2010 drawing extensions, which it writes for artistic picture effects and
 * math inside a shape — where it renders the `mc:Choice`, as it does when
 * `Requires` is absent altogether.
 */
export const MC_REQUIRES_NAMESPACES: Record<string, string> = {
  p14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
  p15: 'http://schemas.microsoft.com/office/powerpoint/2012/main',
  a14: 'http://schemas.microsoft.com/office/drawing/2010/main',
  a16: 'http://schemas.microsoft.com/office/drawing/2014/main',
  cx: 'http://schemas.microsoft.com/office/drawing/2014/chartex',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  v: 'urn:schemas-microsoft-com:vml',
  unknown: 'https://example.invalid/office/2099/unknown',
}
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
function groupShape({ text, diagram, video, image }: NonNullable<PptxSlideSpec['group']>): string {
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
  const imagePart = image
    ? `<p:pic><p:nvPicPr><p:cNvPr id="24" name="Grouped Picture 24" descr="Grouped cell"/>` +
      `<p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr/></p:pic>`
    : ''
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="20" name="Group 20"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>${textPart}${diagramPart}${videoPart}${imagePart}</p:grpSp>`
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
 * `mc:AlternateContent` with a different TEXT SHAPE in each branch — the
 * simplest possible probe for which branch a reader takes, and the one that
 * measured anydoc rendering the `mc:Fallback`.
 */
/**
 * One `mc:Choice`'s namespace declarations and `Requires` attribute.
 * `false` omits the attribute; `''` writes it empty; an array declares every
 * prefix it names and requires all of them at once.
 */
function choiceRequiresXml(
  requires: NonNullable<PptxSlideSpec['alternateContentText']>['requires'],
): string {
  if (requires === false) return ''
  const prefixes = requires === undefined ? ['p14'] : typeof requires === 'string'
    ? (requires === '' ? [] : [requires])
    : [...requires]
  const declarations = prefixes
    .map((prefix) => ` xmlns:${prefix}="${MC_REQUIRES_NAMESPACES[prefix]}"`)
    .join('')
  return `${declarations} Requires="${prefixes.join(' ')}"`
}

function alternateContentTextShapes(
  { choice, fallback, requires, secondChoice }: NonNullable<PptxSlideSpec['alternateContentText']>,
): string {
  const second = secondChoice
    ? `<mc:Choice${choiceRequiresXml(secondChoice.requires)}>` +
      textShape(27, 'AC Second Choice Text 27', [secondChoice.text], '') +
      `</mc:Choice>`
    : ''
  const fallbackBranch = fallback === undefined
    ? ''
    : `<mc:Fallback>${textShape(14, 'AC Fallback Text 14', [fallback], '')}</mc:Fallback>`
  return `<mc:AlternateContent xmlns:mc="${MC_NS}">` +
    `<mc:Choice${choiceRequiresXml(requires)}>` +
    textShape(13, 'AC Choice Text 13', [choice], '') +
    `</mc:Choice>${second}${fallbackBranch}</mc:AlternateContent>`
}

/**
 * `mc:AlternateContent` with ONE unsupported `mc:Choice` holding a picture and
 * NO `mc:Fallback` — see `pictureInChoiceOnlyAlternateContent`.
 */
function choiceOnlyAlternateContentPicture(): string {
  return `<mc:AlternateContent xmlns:mc="${MC_NS}">` +
    `<mc:Choice xmlns:p14="${MC_REQUIRES_NAMESPACES.p14}" Requires="p14">` +
    `<p:pic><p:nvPicPr><p:cNvPr id="28" name="Choice Only Picture 28" descr="Choice only"/>` +
    `<p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr/></p:pic>` +
    `</mc:Choice></mc:AlternateContent>`
}

/**
 * `mc:AlternateContent` as PowerPoint writes an ink annotation: a
 * `p14:contentPart` in the `mc:Choice` and an ordinary embedded picture in the
 * `mc:Fallback`. anydoc renders the picture; a reader preferring the Choice
 * sees no picture at all.
 */
function alternateContentInk(): string {
  return `<mc:AlternateContent xmlns:mc="${MC_NS}">` +
    `<mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14">` +
    `<p14:contentPart xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `p14:bwMode="auto" r:id="rIdInk"><p14:nvContentPartPr><p14:cNvPr id="15" name="Ink 15"/>` +
    `<p14:cNvContentPartPr/><p14:nvPr/></p14:nvContentPartPr></p14:contentPart>` +
    `</mc:Choice><mc:Fallback>` +
    `<p:pic><p:nvPicPr><p:cNvPr id="16" name="Ink Fallback 16" descr="Ink annotation"/>` +
    `<p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr/></p:pic>` +
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
  /*
   * A media `p:pic` AS POWERPOINT WRITES ONE: the `a:videoFile` link that makes
   * it media, AND a POSTER FRAME — an ordinary embedded picture in the
   * `p:blipFill` — because a video on a slide always shows a still. An earlier
   * version of this fixture wrote `<a:blip/>` with no `r:embed`, which is not a
   * shape PowerPoint produces, and that omission hid a defect twice over:
   * anydoc emits `<p><img …></p>` for the poster, so a deck with a video was
   * refused for a block no slide would claim.
   */
  const video = spec.video
    ? `<p:pic><p:nvPicPr><p:cNvPr id="7" name="Lecture clip"/><p:cNvPicPr/>` +
      `<p:nvPr><a:videoFile r:link="rIdVideo"/></p:nvPr></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr/></p:pic>`
    : ''
  const audio = spec.audio
    ? `<p:pic><p:nvPicPr><p:cNvPr id="25" name="Lecture audio"/><p:cNvPicPr/>` +
      `<p:nvPr><a:audioFile r:link="rIdAudio"/></p:nvPr></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr/></p:pic>`
    : ''
  const secondImage = spec.secondImage
    ? `<p:pic><p:nvPicPr><p:cNvPr id="9" name="Picture 9"` +
      `${spec.secondImage.alt === undefined ? '' : ` descr="${xmlEscape(spec.secondImage.alt)}"`}/>` +
      `<p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr/></p:pic>`
    : ''
  const linkedImage = spec.linkedImage
    ? `<p:pic><p:nvPicPr><p:cNvPr id="10" name="Linked Picture 10"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:link="rIdLinkedImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr/></p:pic>`
    : ''
  const unpackageableImage = spec.unpackageableImage
    ? `<p:pic><p:nvPicPr><p:cNvPr id="12" name="Pasted Chart 12" ` +
      `descr="${xmlEscape(spec.unpackageableImage.alt ?? 'A pasted chart')}"/>` +
      `<p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rIdEmf"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr/></p:pic>`
    : ''
  const brokenImage = spec.brokenImage
    ? `<p:pic><p:nvPicPr><p:cNvPr id="11" name="Broken Picture 11"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rIdMissingImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr/></p:pic>`
    : ''
  const blipWithoutReference = spec.blipWithoutReference
    ? `<p:pic><p:nvPicPr><p:cNvPr id="26" name="Unreferenced Blip 26"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr/></p:pic>`
    : ''
  const missingMediaImage = spec.missingMediaImage
    ? `<p:pic><p:nvPicPr><p:cNvPr id="19" name="Missing Media 19" descr="A missing picture"/>` +
      `<p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rIdMissingMedia"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr/></p:pic>`
    : ''
  const oleObject = spec.oleObject
    ? graphicFrame(17, 'Worksheet 17', OLE_URI,
        `<p:oleObj spid="_x0000_s1026" name="Worksheet" r:id="rIdOle" imgW="2540000" imgH="1270000" ` +
        `progId="Excel.Sheet.12"><p:embed/>` +
        `<p:pic><p:nvPicPr><p:cNvPr id="18" name="Worksheet" descr="Worksheet"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
        `<p:blipFill><a:blip r:embed="rIdEmf"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        `<p:spPr/></p:pic></p:oleObj>`)
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
  const alternateContent = (spec.diagramInAlternateContent ? alternateContentDiagram() : '') +
    (spec.alternateContentText ? alternateContentTextShapes(spec.alternateContentText) : '') +
    (spec.inkInAlternateContent ? alternateContentInk() : '') +
    (spec.pictureInChoiceOnlyAlternateContent ? choiceOnlyAlternateContentPicture() : '')
  const nested = spec.nestedGroupDepth ? nestedGroups(spec.nestedGroupDepth) : ''

  const pictures = `${image}${secondImage}${linkedImage}${brokenImage}${blipWithoutReference}` +
    `${missingMediaImage}${unpackageableImage}`
  const shapes = spec.titleLast
    ? `${body}${pictures}${diagram}${chart}${video}${audio}${table}${oleObject}${group}${alternateContent}${nested}${title}`
    : `${title}${body}${pictures}${diagram}${chart}${video}${audio}${table}${oleObject}${group}${alternateContent}${nested}`

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
  { container = 'pptx', withMacroPart = false, imagePartName = 'image1.png' }: {
    container?: keyof typeof PPTX_CONTENT_TYPES
    /** Adds `ppt/vbaProject.bin`, as a real .pptm/.ppsm does. Never executed. */
    withMacroPart?: boolean
    /**
     * The BASENAME of the embedded picture part, `image1.png` by default. A
     * relationship `Target` is a URI reference, so the name is percent-encoded
     * into the rels while the ZIP entry keeps it literally — which is how a
     * media file with a space or a reserved character in its name reaches the
     * index's part resolver at all. PowerPoint itself always writes
     * `imageN.ext`, but a converter, a Google Slides export, or a hand-edited
     * package carries the author's own filename through.
     */
    imagePartName?: string
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
      `<Default Extension="emf" ContentType="image/x-emf"/>` +
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
    // One `rIdImage` relationship serves every embedded picture on the slide,
    // including a video's poster frame and a grouped picture — exactly as
    // PowerPoint reuses one relationship for one media part.
    if (slide.oleObject) {
      rels.push('<Relationship Id="rIdOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/worksheet1.xlsx"/>')
    }
    if (slide.unpackageableImage || slide.oleObject) {
      rels.push('<Relationship Id="rIdEmf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.emf"/>')
    }
    if (slide.audio) {
      rels.push('<Relationship Id="rIdAudio" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio" Target="../media/audio1.m4a" TargetMode="External"/>')
    }
    if (slide.image || slide.secondImage || slide.video || slide.audio || slide.group?.image ||
      slide.inkInAlternateContent || slide.pictureInChoiceOnlyAlternateContent) {
      const target = slide.imageTargetOverride ?? `../media/${encodeURIComponent(imagePartName)}`
      rels.push(`<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`)
    }
    if (slide.missingMediaImage) {
      // Declared, and pointing at a part deliberately never written below.
      rels.push('<Relationship Id="rIdMissingMedia" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image3.png"/>')
    }
    if (slide.linkedImage) {
      rels.push('<Relationship Id="rIdLinkedImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.edu/cell.png" TargetMode="External"/>')
    }
    if (rels.length > 0) {
      entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: utf8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`) })
    }
  })

  if (slides.some((slide) => slide.image || slide.secondImage || slide.video || slide.audio ||
    slide.group?.image || slide.inkInAlternateContent || slide.pictureInChoiceOnlyAlternateContent)) {
    entries.push({ name: `ppt/media/${imagePartName}`, data: EMBEDDED_IMAGE_PNG })
  }
  if (slides.some((slide) => slide.unpackageableImage || slide.oleObject)) {
    entries.push({ name: 'ppt/media/image2.emf', data: EMF_BYTES })
  }
  if (slides.some((slide) => slide.oleObject)) {
    // The worksheet itself: anydoc never renders it, but a real package always
    // carries it, and its absence would make the OLE frame unrealistic.
    entries.push({ name: 'ppt/embeddings/worksheet1.xlsx', data: utf8('worksheet payload placeholder') })
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
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
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
 *
 * `{ comment: text }` is an `office:annotation` anchored INLINE, in the
 * middle of the paragraph, rather than as a direct child of `draw:page` the
 * way `commentText` authors it. Impress itself anchors a comment at page
 * level, but format converters (and Google Slides exports) emit the inline
 * form, and it is the shape that made `notesText` count the comment's own
 * `text:p` twice — once inside the enclosing paragraph's text, once again as
 * a standalone paragraph — which is a failed strict-equality comparison, and
 * therefore published speaker notes.
 */
export type OdpParagraphSegment =
  | string
  | { break: true }
  | { tab: true }
  | { spaces: number }
  | { link: string }
  | { comment: string }

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
  /**
   * A `text:h` heading authored BEFORE the notes body, inside speaker notes.
   * Fix-review round 5 measured that anydoc's OWN blockquote rendering of
   * the notes includes the heading's text (`"Notes heading Notes body."`),
   * while `odfParagraphs` (feeding `notesText`) queried `text:p` only and
   * silently dropped it — the half of the round-2 `text:h` fix that landed
   * on the page query but not the notes query, on the safety-critical path.
   */
  notesHeadingText?: string
  /** Emit the title frame LAST in the page — ODP's form of design fact 4. */
  titleLast?: boolean
  image?: { alt?: string }
  /**
   * A SECOND `draw:frame` referencing the SAME picture part as `image` — the
   * ODF analogue of PPTX's `secondImage`, and the shape that makes "twice on
   * one page" and "once on each of two pages" the same set of parts.
   */
  secondImage?: { alt?: string }
  /**
   * ONE `draw:frame` holding TWO `draw:image` children — `Pictures/image2.gif`
   * then `Pictures/image1.png`. ODF 1.3 §10.4.2 makes a frame's children
   * ALTERNATIVE representations of one object, of which a consumer renders the
   * first it supports, so this frame is ONE picture and not two. Converters
   * write it (a vector original with a raster fallback, or the reverse);
   * collecting both children made an index expect a picture anydoc never
   * emits, which was measured misattributing another page's picture rather
   * than merely refusing.
   */
  alternateImages?: boolean
  /**
   * A `draw:plugin` carrying a media mime type — the shape Impress writes for
   * an inserted video — optionally with a `draw:image` POSTER in the same
   * frame. anydoc emits nothing for the plugin and an ordinary picture for the
   * poster, so without counting the plugin a video imports as a still with
   * nothing saying a video was ever there.
   */
  video?: { poster?: boolean }
  /**
   * The `text:outline-level` of `headingText`. Level 2 makes anydoc emit an
   * `<h2>`, which would otherwise ship as a SIBLING of the slide title.
   */
  headingLevel?: number
  /**
   * A `draw:image` INSIDE `presentation:notes`. anydoc publishes nothing from
   * the notes, so a picture in there is not a picture on the slide, and
   * counting it would leave the reconciler holding a budget no block can ever
   * spend — which is now a refusal.
   */
  notesImage?: boolean
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
  /**
   * A `table:table` inside a `draw:frame` — Impress's data table, which anydoc
   * emits as a real `<table>` (design fact 8). The same two rows the PPTX
   * fixture's `table` option authors, so both formats can be measured against
   * anydoc's row-major rendering with one expectation.
   */
  table?: boolean
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
    if ('comment' in segment) return odpAnnotation('Inline comment', segment.comment)
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

/** A `table:table` in a `draw:frame` — see `table` on `OdpPageSpec`. */
function odpTable(name: string): string {
  return `<draw:frame draw:name="${name}" svg:width="20cm" svg:height="3cm" svg:x="2cm" svg:y="6cm">` +
    `<table:table table:name="${name}">` +
    `<table:table-column table:number-columns-repeated="2"/>` +
    `<table:table-row><table:table-cell><text:p>Stage</text:p></table:table-cell>` +
    `<table:table-cell><text:p>Location</text:p></table:table-cell></table:table-row>` +
    `<table:table-row><table:table-cell><text:p>Calvin cycle</text:p></table:table-cell>` +
    `<table:table-cell><text:p>Stroma</text:p></table:table-cell></table:table-row>` +
    `</table:table></draw:frame>`
}

/** A `text:h` heading paragraph — see `headingText` on `OdpPageSpec`. */
function odpHeading(text: string, level = 1): string {
  // `text:outline-level="1"` is the top level a presentation body uses;
  // level 2 is what makes anydoc emit an `h2`, the level a slide title itself
  // occupies.
  return `<text:h text:outline-level="${level}">${xmlEscape(text)}</text:h>`
}

/**
 * A `draw:frame` holding a `draw:plugin` with a media mime type — Impress's
 * inserted video — and optionally a `draw:image` poster in the same frame.
 */
function odpMedia(name: string, poster: boolean | undefined, imageHref: string): string {
  return `<draw:frame draw:name="${name}" svg:width="8cm" svg:height="5cm" svg:x="2cm" svg:y="6cm">` +
    `<draw:plugin xlink:href="Media/media1.mp4" xlink:type="simple" xlink:show="embed" ` +
    `xlink:actuate="onLoad" draw:mime-type="application/vnd.sun.star.media"/>` +
    (poster
      ? `<draw:image xlink:href="${imageHref}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>`
      : '') +
    `</draw:frame>`
}

/**
 * An optional `text:h` (see `notesHeadingText`), followed by `page.notes`
 * (a single run) or `page.notesRuns` (multiple segments in one paragraph) as
 * one `text:p`.
 */
function odpNotesContentXml(page: OdpPageSpec, imageHref: string): string {
  const heading = page.notesHeadingText ? odpHeading(page.notesHeadingText) : ''
  if (page.notesImage) {
    const picture = `<draw:frame draw:name="Notes picture" svg:width="1cm" svg:height="1cm">` +
      `<draw:image xlink:href="${imageHref}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
      `</draw:frame>`
    if (page.notes !== undefined) return `${heading}<text:p>${xmlEscape(page.notes)}</text:p>${picture}`
    return `${heading}${picture}`
  }
  if (page.notesRuns) return `${heading}<text:p>${odpParagraphSegmentsXml(page.notesRuns)}</text:p>`
  if (page.notes !== undefined) return `${heading}<text:p>${xmlEscape(page.notes)}</text:p>`
  return heading
}

export async function odpFixture(
  pages: readonly OdpPageSpec[],
  { imagePartName = 'image1.png' }: {
    /**
     * The BASENAME of the embedded picture part inside `Pictures/`. ODF's
     * `xlink:href` is an IRI, so the name is percent-encoded into the href
     * while the ZIP entry and the manifest keep it literally — the ODF twin of
     * PPTX's `imagePartName`, and the only way a picture named `image 1.png`
     * reaches the index's href resolver at all.
     */
    imagePartName?: string
  } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const imagePart = `Pictures/${imagePartName}`
  const imageHref = `Pictures/${encodeURIComponent(imagePartName)}`
  const body = pages.map((page, index) => {
    const title = page.title === undefined
      ? ''
      : odpFrame(`Title ${index + 1}`, 'title', `<text:p>${xmlEscape(page.title)}</text:p>`)
    const outlineContent = `${odpParagraphsXml(page)}${page.bulletList ? odpBulletListXml(page.bulletList) : ''}` +
      (page.nestedSpanDepth ? odpNestedSpans(page.nestedSpanDepth, 'Deeply nested') : '') +
      (page.headingText ? odpHeading(page.headingText, page.headingLevel) : '')
    const outline = outlineContent ? odpFrame(`Body ${index + 1}`, 'outline', outlineContent) : ''
    const image = page.image
      ? `<draw:frame draw:name="Diagram ${index + 1}" svg:width="1cm" svg:height="1cm">` +
        `<draw:image xlink:href="${imageHref}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
        (page.image.alt === undefined ? '' : `<svg:desc>${xmlEscape(page.image.alt)}</svg:desc>`) +
        `</draw:frame>`
      : ''
    const secondImage = page.secondImage
      ? `<draw:frame draw:name="Second diagram ${index + 1}" svg:width="1cm" svg:height="1cm">` +
        `<draw:image xlink:href="${imageHref}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
        (page.secondImage.alt === undefined ? '' : `<svg:desc>${xmlEscape(page.secondImage.alt)}</svg:desc>`) +
        `</draw:frame>`
      : ''
    // ONE frame, TWO alternative children: the first a consumer supports wins.
    const alternateImages = page.alternateImages
      ? `<draw:frame draw:name="Alternatives ${index + 1}" svg:width="1cm" svg:height="1cm">` +
        `<draw:image xlink:href="Pictures/image2.gif" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
        `<draw:image xlink:href="${imageHref}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
        `</draw:frame>`
      : ''
    const customShape = page.customShapeText ? odpCustomShape(`Custom Shape ${index + 1}`, page.customShapeText) : ''
    const groupedCustomShape = page.groupedCustomShapeText
      ? odpGroup(`Group ${index + 1}`, odpCustomShape(`Grouped Custom Shape ${index + 1}`, page.groupedCustomShapeText))
      : ''
    const table = page.table ? odpTable(`Table ${index + 1}`) : ''
    const media = page.video ? odpMedia(`Video ${index + 1}`, page.video.poster, imageHref) : ''
    const nestedFrame = page.nestedFrameText
      ? odpNestedFrame(`Outer Frame ${index + 1}`, `Inner Frame ${index + 1}`, page.nestedFrameText)
      : ''
    const notesContent = odpNotesContentXml(page, imageHref)
    const notes = notesContent
      ? `<presentation:notes>${odpFrame(`Notes ${index + 1}`, 'notes', notesContent)}</presentation:notes>`
      : ''
    // A direct child of draw:page, the same level presentation:notes sits at.
    const comment = page.commentText ? odpAnnotation(`Comment ${index + 1}`, page.commentText) : ''
    const extras = `${customShape}${groupedCustomShape}${nestedFrame}${table}${media}`
    const pictures = `${image}${secondImage}${alternateImages}`
    const frames = page.titleLast
      ? `${outline}${pictures}${extras}${title}`
      : `${title}${outline}${pictures}${extras}`
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
      (pages.some((page) => page.image || page.secondImage || page.alternateImages || page.notesImage ||
        page.video?.poster)
        ? `<manifest:file-entry manifest:full-path="${imagePart}" manifest:media-type="image/png"/>`
        : '') +
      (pages.some((page) => page.alternateImages)
        ? `<manifest:file-entry manifest:full-path="Pictures/image2.gif" manifest:media-type="image/gif"/>`
        : '') +
      `</manifest:manifest>`) },
    { name: 'content.xml', data: utf8(content) },
  ]
  if (pages.some((page) => page.image || page.secondImage || page.alternateImages || page.notesImage ||
    page.video?.poster)) {
    entries.push({ name: imagePart, data: EMBEDDED_IMAGE_PNG })
  }
  if (pages.some((page) => page.alternateImages)) {
    // Deliberately different bytes AND a different part, so a test can tell the
    // two alternatives apart by which one anydoc actually rendered.
    entries.push({ name: 'Pictures/image2.gif', data: RASTER_FIXTURES.gif.bytes })
  }
  return writeZip(entries) as Promise<Uint8Array<ArrayBuffer>>
}
