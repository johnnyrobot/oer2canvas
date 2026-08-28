/**
 * What the steps know, and where publisher-specific knowledge is allowed to live.
 *
 * The compile steps are publisher-AGNOSTIC. Everything that differs between
 * OpenStax, LibreTexts and Pressbooks is a value on this profile, so slice 8
 * adds two more profiles rather than two more step lists — and the three
 * load-bearing orderings cannot drift apart per publisher, because there is
 * only ever one ordering.
 */
import type { Attribution, ContentSourceId } from '../../sources/types'
import type { QueueAnswer } from './answers'

export interface PublisherProfile {
  id: ContentSourceId
  /** The publisher's caption element. */
  captionContainer: string
  /**
   * True when the caption is a FOLLOWING SIBLING of the figure or table rather
   * than a child of it. OpenStax emits `</figure><div class="os-caption-container">`,
   * so the figure step has to look outside the figure to find it.
   */
  captionIsSibling: boolean
  /**
   * A caption matching this is a bare label ("Figure 1") with no description.
   * It is still kept and still associated — body text says "as shown in Figure 1"
   * and dropping the label breaks that reference — but it is never used as a
   * source of alt text, because "Figure 1" describes nothing.
   */
  labelOnlyCaption: RegExp
  /**
   * The descriptive part of a caption, as opposed to its label and its credit.
   * Drafting from the whole caption carries "Figure 3" into the alt attribute.
   * Keeping the descriptive part separate prevents a prefixed draft.
   */
  captionDescription: string
  /**
   * A photo credit inside a caption. Only consulted when the publisher gives no
   * `captionDescription` element to read instead.
   *
   * Chapter 1's intro image in the 1.x book has a caption that is ONLY a credit.
   * Left alone it proposes `alt="Credit: Andreas Kambanls"` — a draft that names
   * a person and describes nothing, offered for a picture the reader cannot see.
   */
  captionCredit: RegExp
  /** Wrapper the publisher puts around media. Unwrapped by the figure step. */
  mediaWrapper: string
  /**
   * An intra-book link. Capture 2 is the target page uuid; capture 3 is the
   * fragment, INCLUDING its `#`, or undefined.
   *
   * The fragment is not incidental: every one of the 29 such links in the 1.4
   * fixture points at the same answer-key page and differs only in its
   * `#fs-id...-solution`. Dropping it would turn 29 distinct solution links into
   * 29 copies of one page.
   */
  xrefHref: RegExp
  /**
   * The image's content hash when the url carries it, else undefined.
   *
   * OpenStax names every resource by the sha1 of its bytes, so the queue's
   * dedupe hash is free with no fetch. Pressbooks will need the bytes, which is
   * why this returns undefined rather than throwing.
   */
  hashFromUrl(url: string): string | undefined
  /**
   * Recover publisher-carried LaTeX from an equation image before that image
   * can enter the alt-text queue.
   */
  mathFromImage?(image: HTMLImageElement): { latex: string; display: boolean } | undefined
  /** Render TeX delimiters embedded in publisher text before sanitization. */
  mathFromText?: boolean
  /** Selectors for elements that are publisher chrome and never content. */
  chrome: readonly string[]
}

export const OPENSTAX: PublisherProfile = {
  id: 'openstax',
  captionContainer: '.os-caption-container',
  captionIsSibling: true,
  labelOnlyCaption: /^(figure|table|example|exercise)\s*[\d.]*$/i,
  captionDescription: '.os-caption',
  captionCredit: /\bcredits?:\s.*$/i,
  mediaWrapper: 'span[data-type="media"]',
  xrefHref: /^\.\/([0-9a-f-]{36})@[^:]*:([0-9a-f-]{36})(?:\.xhtml)?(#.*)?$/i,
  hashFromUrl: (url) => /\/([0-9a-f]{40})(?:\.\w+)?$/i.exec(url)?.[1]?.toLowerCase(),
  // `<script>` and `<style>` would be dropped by the allowlist anyway; naming
  // them here means the audit frame never has to reason about a nested document.
  chrome: ['script', 'style', 'nav#toc'],
}

/**
 * LibreTexts renders the same semantic HTML across its library hosts, but its
 * page chrome and figure wrappers are not OpenStax's. Keeping the profile here
 * lets the shared compile pipeline be exercised before a source adapter hands
 * it a chapter; no source-specific transform fork is allowed.
 */
export const LIBRETEXTS: PublisherProfile = {
  id: 'libretexts',
  captionContainer: 'figcaption, .lt-figure-caption, .caption',
  captionIsSibling: false,
  labelOnlyCaption: /^(figure|table|example|exercise)\s*[\d.]*$/i,
  captionDescription: 'figcaption, .lt-figure-caption, .caption',
  captionCredit: /\bcredits?:\s.*$/i,
  mediaWrapper: '.lt-image, .image, .image-container',
  // LibreTexts links are normally already canonical web URLs. The pattern is
  // intentionally conservative; unresolved links remain external rather than
  // being guessed into another page.
  xrefHref: /(?!)/,
  hashFromUrl: () => undefined,
  mathFromText: true,
  chrome: ['script', 'style', 'nav', '.mt-toc-container', '.mt-page-actions', '.mt-footer'],
}

/** Pressbooks is WordPress-derived and emits ordinary figure/figcaption markup. */
export const PRESSBOOKS: PublisherProfile = {
  id: 'pressbooks',
  captionContainer: 'figcaption, .wp-caption-text',
  captionIsSibling: false,
  labelOnlyCaption: /^(figure|table|example|exercise)\s*[\d.]*$/i,
  captionDescription: 'figcaption, .wp-caption-text',
  captionCredit: /\bcredits?:\s.*$/i,
  mediaWrapper: '.wp-caption, .wp-block-image, figure',
  xrefHref: /(?!)/,
  hashFromUrl: () => undefined,
  mathFromImage: (image) => {
    const classes = image.className.split(/\s+/)
    const quickLatex = classes.some((name) => name.startsWith('ql-img-'))
      || image.getAttribute('src')?.includes('quicklatex.com')
    if (!quickLatex) return undefined
    const raw = image.getAttribute('alt')?.trim()
    if (!raw || /^Rendered by QuickLaTeX\.com$/i.test(raw)) return undefined
    const display = /^\\\[|^\$\$/.test(raw) || classes.some((name) => name.includes('displayed'))
    const latex = raw
      .replace(/^\\\[\s*|\s*\\\]$/g, '')
      .replace(/^\\\(\s*|\s*\\\)$/g, '')
      .replace(/^\$\$\s*|\s*\$\$$/g, '')
      .replace(/^\$\s*|\s*\$$/g, '')
      .trim()
    return latex ? { latex, display } : undefined
  },
  chrome: ['script', 'style', 'nav', 'header', 'footer', '.site-header', '.site-footer'],
}

/** Normalized document HTML needs no publisher-specific recovery rules. */
export const DOCUMENT: PublisherProfile = {
  id: 'document',
  captionContainer: 'figcaption',
  captionIsSibling: false,
  labelOnlyCaption: /^(figure|table)\s*[\d.]*$/i,
  captionDescription: 'figcaption',
  captionCredit: /\bcredits?:\s.*$/i,
  mediaWrapper: 'figure',
  xrefHref: /(?!)/,
  hashFromUrl: () => undefined,
  chrome: ['script', 'style'],
}

export interface CompileContext {
  profile: PublisherProfile
  /** Absolute url the section html was served from — the absolutization base. */
  contentBaseUrl?: string
  /** Public url of THIS section. D9 links it; the attribution step reads it. */
  canonicalUrl?: string
  sectionTitle: string
  /** Page uuid → canonical url, for the whole source book. */
  xrefs: Map<string, string>
  attribution: Attribution
  /**
   * This section's id. Steps need it to build a queue key for an item with no
   * hash — every table, and any image whose publisher does not put a content
   * hash in the url (D5.2). Passing it separately to each step that wants it is
   * how it and the section quietly drift apart.
   */
  sectionId: string
  /**
   * What humans have decided, keyed by `queueKeyOf`. Absent on a first compile
   * and on every call site that predates slice 5, which must keep compiling
   * exactly as they did — asserted against the goldens in `context.test.ts`.
   */
  answers?: ReadonlyMap<string, QueueAnswer>
}
