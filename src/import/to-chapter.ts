import type { Chapter } from '../sources/types'
import type { ImportedWork } from './types'

/** The one convergence point shared with publisher adapters. */
export function toChapter(work: ImportedWork): Chapter {
  const { provenance } = work
  return {
    source: 'document',
    bookId: work.id,
    title: work.title,
    sections: work.sections.map((section) => ({
      id: section.id,
      title: section.title,
      order: section.order,
      html: section.html,
      ...(provenance.sourceUrl
        ? { contentBaseUrl: provenance.sourceUrl, canonicalUrl: provenance.sourceUrl }
        : {}),
    })),
    attribution: {
      bookTitle: work.title,
      publisher: provenance.sourceName ?? 'User-provided document',
      url: provenance.sourceUrl,
      authors: provenance.author ? [provenance.author] : [],
      ...(provenance.license ? { license: provenance.license } : {}),
    },
    xrefs: new Map(),
  }
}
