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
