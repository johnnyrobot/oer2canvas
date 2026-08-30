/**
 * Which parts of a deck package the slide index needs.
 *
 * Pure path matching, deliberately: it runs inside the anydoc Worker, which has
 * no `DOMParser` (see `parsers/probe.ts` on why the PDF path carries unsanitized
 * Markdown out to the main thread). Anything that needed to READ the XML to
 * decide would have to be a hand-rolled scanner over hostile input, which is the
 * wrong answer twice.
 */
export type PresentationPackageKind = 'pptx' | 'odp'

const PRESENTATION_PACKAGE_KINDS: readonly PresentationPackageKind[] = ['pptx', 'odp']

/**
 * Whether a detected format is a deck whose own package index will be read.
 *
 * ONE predicate, deliberately, because two decisions have to agree exactly:
 * the Worker only collects the package parts above for these formats, and
 * `parsers/anydoc-html.ts` only tags its pictures with the join key
 * (`data-origin-part`) for these formats. If those two ever disagreed, either
 * a deck would arrive with an index and no join keys — refusing every deck
 * with a picture — or a DOCX would carry a join key nothing reads into the
 * exported page. Neither is visible from inside either module alone.
 */
export function isPresentationPackageKind(format: string): format is PresentationPackageKind {
  return PRESENTATION_PACKAGE_KINDS.some((kind) => kind === format)
}

const PPTX_PATTERNS: readonly RegExp[] = [
  /^ppt\/presentation\.xml$/,
  /^ppt\/_rels\/presentation\.xml\.rels$/,
  /^ppt\/slides\/slide\d+\.xml$/,
  /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/,
  /^ppt\/notesSlides\/notesSlide\d+\.xml$/,
]

// ODP keeps every page, frame, and notes body in one part, so the index needs
// exactly that part and nothing else.
const ODP_PATTERNS: readonly RegExp[] = [/^content\.xml$/]

export function wantedPresentationPart(kind: PresentationPackageKind, path: string): boolean {
  const patterns = kind === 'pptx' ? PPTX_PATTERNS : ODP_PATTERNS
  return patterns.some((pattern) => pattern.test(path))
}
