/**
 * The ONLY thing the three sources agree on.
 *
 * There is deliberately no shared importer interface. The reader's ADR-0002
 * established that a trait wide enough to cover all importers is almost entirely
 * optional parameters and explains nothing about what any importer does.
 * LibreTexts needs two separate TOC strategies; Pressbooks crawls; OpenStax
 * resolves a release manifest first. They converge at `Chapter` and nowhere earlier.
 */
export type SourceId = 'openstax' | 'libretexts' | 'pressbooks'

export interface Section {
  id: string
  title: string
  order: number
  /** Raw HTML as the publisher served it. Untrusted; transformed downstream. */
  html: string
  /**
   * Absolute url this html was served from. Publisher markup is full of
   * relative urls (`../resources/<sha>`), and resolving them needs the base
   * they were relative TO — which only the fetch knows. Without this the audit
   * runs on html whose images cannot load, so the audited layout is not the
   * published layout.
   */
  contentBaseUrl: string
  /** Public, human-facing url of this section. D9 attribution links it. */
  canonicalUrl: string
}

export interface Chapter {
  source: SourceId
  bookId: string
  title: string
  sections: Section[]
  attribution: Attribution
  /**
   * Page uuid → canonical url, for every page in the source BOOK, not just the
   * sections in this chapter. Intra-book links point anywhere in the book, and
   * most targets will not be in the instructor's selection.
   */
  xrefs: Map<string, string>
}

/**
 * D9: the source is never stripped. Every emitted page carries this.
 * `license` is optional because not every API supplies one; attribution
 * degrades to source + publisher + url, it never disappears.
 */
export interface Attribution {
  bookTitle: string
  publisher: string
  /** Canonical URL of the source book or section. */
  url: string
  authors: string[]
  license?: { name: string; url?: string }
}

export interface BookRef {
  source: SourceId
  id: string
  slug: string
  title: string
  subject?: string
  coverUrl?: string
  license?: string
  licenseUrl?: string
  /** LibreTexts library subdomain or Pressbooks network host. */
  catalog?: string
  /**
   * D9 needs these and the CONTENT api has none, so they are baked into the
   * bundled catalog from the CMS api at generation time (see
   * `scripts/fetch-openstax-authors.mjs`). Always an array — an unmatched book
   * gets an empty one, because D9 permits degradation but not silent degradation.
   */
  authors: string[]
}
