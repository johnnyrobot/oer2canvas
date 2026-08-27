import type { CompileContext } from '../context'
import type { Sink } from '../sink'
import { stripChrome } from './strip-chrome'
import { absolutize } from './absolutize'
import { recoverMath } from './math'
import { relevelHeadings } from './headings'
import { restructureFigures } from './figures'
import { fixTables } from './tables'
import { fixLinks } from './links'
import { normalizeTextSemantics } from './text-semantics'
import { normalizeContrast } from './contrast'
import { resolveAlt } from './alt'
import { appendAttribution } from './attribution'
import { applyCanvasTemplate } from './canvas-template'

/** One transform over the shared detached document. Mutates in place. */
export type Step = (doc: Document, ctx: CompileContext, sink: Sink) => void

/**
 * THE ORDER IS THE DESIGN. These orderings are load-bearing:
 *
 *   MATH FIRST — a Pressbooks chapter can carry 80 equation images. If math ran
 *     after alt resolution all 80 would enter the human queue and it would be
 *     abandoned. The difference between a 12-item queue and a 92-item one.
 *   HEADINGS BEFORE ALLOWLIST REPAIR — `validateAllowlist` demotes every heading
 *     on its own when it sees a content <h1>. `relevelHeadings` must eliminate
 *     <h1> so that shift becomes a no-op; leave one behind and the document is
 *     demoted twice.
 *   ATTRIBUTION BEFORE THE AUDIT — D9's block is audited like everything else.
 *   CONTRAST BEFORE ALT — publisher inline colors are normalized before the
 *   final markup is audited, while the text's words and meaning remain intact.
 *   CANVAS TEXT SEMANTICS BEFORE AUDIT — generic links and presentation-only
 *     emphasis are converted while the source context is still available.
 *   AUDIT LAST, on final html — auditing anything but the exact bytes being
 *     published is theater. That is why repair+audit stay in `enforceGate`,
 *     downstream of every step here.
 *   CANVAS TEMPLATE LAST OF THE STEPS — it wraps the whole body, so anything
 *     that ran after it would be reaching into a container it did not expect.
 *     Its banner puts white text on a brand colour and its rules sit beside
 *     content, so it must be BEFORE the audit like everything else: the guide's
 *     own warning is that a brand colour which looks fine in a logo often fails
 *     4.5:1, and the honest way to enforce that is to let the checker see it.
 */
export const STEPS: readonly Step[] = [
  stripChrome,
  absolutize,
  recoverMath,
  relevelHeadings,
  restructureFigures,
  fixTables,
  fixLinks,
  normalizeTextSemantics,
  normalizeContrast,
  resolveAlt,
  appendAttribution,
  applyCanvasTemplate,
]
