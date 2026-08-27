import { OPENSTAX } from './context'
import type { CompileContext } from './context'
import type { Section } from '../../sources/types'

export const ctx: CompileContext = {
  profile: OPENSTAX,
  contentBaseUrl: 'https://openstax.org/apps/archive/x/contents/b@v:p.json',
  canonicalUrl: 'https://openstax.org/books/b/pages/p',
  sectionTitle: 'Polynomials',
  sectionId: 's1',
  xrefs: new Map(),
  attribution: { bookTitle: 'Algebra', publisher: 'OpenStax', url: 'https://x', authors: [] },
}

export const section = (html: string): Section => ({
  id: 's1', title: 'Polynomials', order: 0, html,
  contentBaseUrl: ctx.contentBaseUrl, canonicalUrl: ctx.canonicalUrl,
})
