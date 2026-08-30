import { importProvenance, validateImportMetadata } from './common'
import type { ImportFinding, ImportMetadata, ImportResult, ImportedWork } from './types'

/**
 * The proposed page plan: how one imported document becomes Canvas pages, and
 * every edit a user can make to that proposal before confirming it.
 *
 * This module is pure. It reads normalized HTML and returns values; the editor
 * component and `App` own state and focus. That split is what lets the plan be
 * edited, confirmed, edited again, and reconfirmed without ever reparsing the
 * source file: the parse produced `ImportedWork`, and everything here is a
 * function of it.
 *
 * IDENTITY IS STRUCTURAL, NEVER POSITIONAL. The normalized document is cut into
 * top-level blocks, and a page is a list of block indexes. A page's id is the
 * source-derived work id plus the 1-based index of its FIRST block. Renaming,
 * excluding, and reordering therefore change no id; a split gives the new page
 * the id of the block it starts at; a merge keeps the surviving page's id. Two
 * runs over the same bytes propose the same pages with the same ids, which is
 * what keeps a re-imported cartridge updating pages rather than duplicating
 * them (see `cartridge.ts`). A one-page proposal is `<work>-page-1`, the same
 * identity the importers assign their single section.
 */

/**
 * The most pages one document may propose. Measured against heading-rich
 * fixtures rather than parser page counts: a chapter-sized document splits into
 * tens of pages, not hundreds, and a Canvas module with more than a hundred
 * pages is not something an instructor reviews page by page. Beyond it the
 * proposal falls back to one page with a visible warning, and manual splitting
 * stops at the budget.
 */
export const MAX_PROPOSED_PAGES = 100

export interface PlanBlock {
  /** Serialized top-level node, joined verbatim to form page html. */
  html: string
  heading?: { level: number; text: string }
  /** Short human label for split-point pickers: kind plus an excerpt. */
  summary: string
}

export interface ProposedPage {
  id: string
  title: string
  /** Indexes into `PagePlan.blocks`, in the order they appear on the page. */
  blocks: readonly number[]
  included: boolean
}

export interface PagePlan {
  workId: string
  blocks: readonly PlanBlock[]
  pages: readonly ProposedPage[]
}

export interface ProposedPagePlan {
  plan: PagePlan
  findings: ImportFinding[]
  /** The heading level pages were split at, when a repeated one was found. */
  splitHeadingLevel?: number
}

export interface SplitPoint {
  /** Number of blocks that stay on the original page. */
  offset: number
  label: string
}

export interface PlanProblem {
  code: 'empty' | 'blank-title' | 'duplicate-title'
  message: string
  pageId?: string
}

const HEADING_LEVEL: Readonly<Record<string, number>> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }
const KIND_LABEL: Readonly<Record<string, string>> = {
  p: 'Paragraph',
  ul: 'List',
  ol: 'List',
  table: 'Table',
  pre: 'Code',
  blockquote: 'Quotation',
  hr: 'Rule',
  dl: 'Definition list',
  section: 'Section',
  div: 'Block',
}

function collapse(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function excerpt(text: string): string {
  return text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text
}

function serializeText(node: Node): string {
  const holder = node.ownerDocument!.createElement('div')
  holder.append(node.cloneNode(true))
  return holder.innerHTML
}

/**
 * Exported so a caller that needs to count blocks the way a plan does can use
 * THIS function rather than a copy of its rule. Two definitions that disagree
 * about whether a whitespace text node is a block would misattribute every
 * index derived from them.
 */
export function blocksOf(html: string): PlanBlock[] {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const blocks: PlanBlock[] = []
  for (const node of document.body.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element
      const tag = element.localName.toLowerCase()
      // A block may name itself. The presentation importer uses this so split
      // points read as slide boundaries; nothing here knows what a slide is,
      // which is the point of naming the attribute for the plan rather than for
      // the format that happens to set it.
      const declared = element.getAttribute('data-plan-label')?.trim()
      const level = HEADING_LEVEL[tag]
      const text = collapse(element.textContent)
      if (level) {
        blocks.push({
          html: element.outerHTML,
          heading: { level, text },
          summary: declared || `Heading: ${excerpt(text)}`,
        })
      } else {
        const kind = KIND_LABEL[tag] ?? `<${tag}>`
        blocks.push({
          html: element.outerHTML,
          summary: declared || (text ? `${kind}: ${excerpt(text)}` : kind),
        })
      }
    } else if (node.nodeType === Node.TEXT_NODE && collapse(node.textContent)) {
      blocks.push({ html: serializeText(node), summary: `Text: ${excerpt(collapse(node.textContent))}` })
    }
  }
  return blocks
}

function pageIdAt(workId: string, firstBlock: number): string {
  return `${workId}-page-${firstBlock + 1}`
}

function titleKey(title: string): string {
  return title.trim().toLowerCase()
}

function uniqueTitle(base: string, taken: Set<string>): string {
  let title = base
  for (let n = 2; taken.has(titleKey(title)); n += 1) title = `${base} (${n})`
  taken.add(titleKey(title))
  return title
}

/** Pages as ordered block-index ranges, before titles and ids are assigned. */
function proposeRanges(
  blocks: readonly PlanBlock[],
  documentTitle: string,
): { ranges: { blocks: number[]; title: string }[]; splitHeadingLevel?: number } {
  const counts = new Map<number, number>()
  for (const block of blocks) {
    if (block.heading) counts.set(block.heading.level, (counts.get(block.heading.level) ?? 0) + 1)
  }
  const repeated = [...counts.entries()].filter(([, count]) => count >= 2).map(([level]) => level)
  if (repeated.length === 0 || blocks.length === 0) {
    return { ranges: [{ blocks: blocks.map((_, index) => index), title: documentTitle }] }
  }
  const level = Math.min(...repeated)
  const ranges: { blocks: number[]; title: string }[] = []
  let preamble: number[] = []
  blocks.forEach((block, index) => {
    if (block.heading?.level === level) {
      ranges.push({ blocks: [index], title: block.heading.text || documentTitle })
    } else if (ranges.length === 0) {
      preamble.push(index)
    } else {
      ranges.at(-1)!.blocks.push(index)
    }
  })
  // A lone document title (or any heading-only preamble) belongs with the first
  // page rather than becoming a page of its own with nothing to read.
  if (preamble.some((index) => !blocks[index]!.heading)) {
    ranges.unshift({ blocks: preamble, title: documentTitle })
  } else if (preamble.length > 0) {
    ranges[0]!.blocks.unshift(...preamble)
    preamble = []
  }
  return { ranges, splitHeadingLevel: level }
}

export function proposePagePlan(work: ImportedWork): ProposedPagePlan {
  const findings: ImportFinding[] = []
  const blocks: PlanBlock[] = []
  let ranges: { blocks: number[]; title: string }[]
  let splitHeadingLevel: number | undefined

  if (work.sections.length > 1) {
    // The adapter already chose boundaries; respect them one page per section.
    ranges = []
    for (const section of work.sections) {
      const start = blocks.length
      const own = blocksOf(section.html)
      blocks.push(...own)
      ranges.push({ blocks: own.map((_, index) => start + index), title: section.title || work.title })
    }
  } else {
    blocks.push(...blocksOf(work.sections[0]?.html ?? ''))
    const proposed = proposeRanges(blocks, work.title)
    ranges = proposed.ranges
    splitHeadingLevel = proposed.splitHeadingLevel
    if (ranges.length > MAX_PROPOSED_PAGES) {
      findings.push({
        code: 'page-plan-budget',
        severity: 'warning',
        message: `Splitting at heading level ${splitHeadingLevel} would create ${ranges.length} pages, more than the ${MAX_PROPOSED_PAGES}-page limit for one document. The document starts as one page; split it manually where it matters.`,
      })
      ranges = [{ blocks: blocks.map((_, index) => index), title: work.title }]
      splitHeadingLevel = undefined
    }
  }

  const taken = new Set<string>()
  const pages: ProposedPage[] = ranges.map((range) => ({
    id: pageIdAt(work.id, range.blocks[0] ?? 0),
    title: uniqueTitle(range.title.trim() || work.title, taken),
    blocks: range.blocks,
    included: true,
  }))
  return {
    plan: { workId: work.id, blocks, pages },
    findings,
    ...(splitHeadingLevel !== undefined ? { splitHeadingLevel } : {}),
  }
}

export function pageHtml(plan: PagePlan, page: ProposedPage): string {
  return page.blocks.map((index) => plan.blocks[index]!.html).join('')
}

function indexOfPage(plan: PagePlan, pageId: string): number {
  const index = plan.pages.findIndex((page) => page.id === pageId)
  if (index < 0) throw new Error('That page is no longer in the plan.')
  return index
}

function replacePages(plan: PagePlan, pages: readonly ProposedPage[]): PagePlan {
  return { ...plan, pages }
}

export function renamePage(plan: PagePlan, pageId: string, title: string): PagePlan {
  const index = indexOfPage(plan, pageId)
  return replacePages(plan, plan.pages.map((page, i) => (i === index ? { ...page, title } : page)))
}

export function setPageIncluded(plan: PagePlan, pageId: string, included: boolean): PagePlan {
  const index = indexOfPage(plan, pageId)
  return replacePages(plan, plan.pages.map((page, i) => (i === index ? { ...page, included } : page)))
}

/** Every boundary inside a page at which it can be cut. Empty for a one-block page. */
export function splitPoints(plan: PagePlan, page: ProposedPage): SplitPoint[] {
  return page.blocks.slice(1).map((blockIndex, i) => ({
    offset: i + 1,
    label: plan.blocks[blockIndex]!.summary,
  }))
}

export function splitPage(plan: PagePlan, pageId: string, offset: number): PagePlan {
  const index = indexOfPage(plan, pageId)
  const page = plan.pages[index]!
  if (page.blocks.length < 2) throw new Error('A page with one block cannot be split.')
  if (!Number.isInteger(offset) || offset < 1 || offset >= page.blocks.length) {
    throw new Error('Choose a point inside the page to split at.')
  }
  if (plan.pages.length >= MAX_PROPOSED_PAGES) {
    throw new Error(`A document can propose at most ${MAX_PROPOSED_PAGES} pages; merge pages before splitting again.`)
  }
  const kept = page.blocks.slice(0, offset)
  const moved = page.blocks.slice(offset)
  const taken = new Set(plan.pages.map((entry) => titleKey(entry.title)))
  const heading = plan.blocks[moved[0]!]!.heading?.text
  let title: string
  if (heading) {
    title = uniqueTitle(heading, taken)
  } else {
    let n = 2
    while (taken.has(titleKey(`${page.title} (part ${n})`))) n += 1
    title = `${page.title} (part ${n})`
  }
  const created: ProposedPage = {
    id: pageIdAt(plan.workId, moved[0]!),
    title,
    blocks: moved,
    included: page.included,
  }
  const pages = [...plan.pages]
  pages.splice(index, 1, { ...page, blocks: kept }, created)
  return replacePages(plan, pages)
}

export function mergeWithNext(plan: PagePlan, pageId: string): PagePlan {
  const index = indexOfPage(plan, pageId)
  const next = plan.pages[index + 1]
  if (!next) throw new Error('The last page has no next page to merge with.')
  const page = plan.pages[index]!
  const pages = [...plan.pages]
  pages.splice(index, 2, { ...page, blocks: [...page.blocks, ...next.blocks] })
  return replacePages(plan, pages)
}

export function movePage(plan: PagePlan, pageId: string, direction: 'up' | 'down'): PagePlan {
  const index = indexOfPage(plan, pageId)
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= plan.pages.length) return plan
  const pages = [...plan.pages]
  const [page] = pages.splice(index, 1)
  pages.splice(target, 0, page!)
  return replacePages(plan, pages)
}

export function validatePagePlan(plan: PagePlan): PlanProblem[] {
  const problems: PlanProblem[] = []
  const included = plan.pages.filter((page) => page.included)
  if (included.length === 0) {
    problems.push({ code: 'empty', message: 'Include at least one page before preparing this document.' })
  }
  const seen = new Map<string, ProposedPage>()
  const reported = new Set<string>()
  for (const page of included) {
    if (!page.title.trim()) {
      problems.push({ code: 'blank-title', pageId: page.id, message: 'Every included page needs a title.' })
      continue
    }
    const key = titleKey(page.title)
    const first = seen.get(key)
    if (first && !reported.has(key)) {
      reported.add(key)
      problems.push({
        code: 'duplicate-title',
        pageId: page.id,
        message: `Two or more included pages are titled "${first.title.trim()}". Give each page a distinct title.`,
      })
    } else if (!first) {
      seen.set(key, page)
    }
  }
  return problems
}

/**
 * The confirmed result: only included pages, in plan order, under the edited
 * metadata. The source result is left alone so the plan can be changed and
 * confirmed again without a reparse.
 */
export function confirmImport(source: ImportResult, plan: PagePlan, metadata: ImportMetadata): ImportResult {
  validateImportMetadata(metadata)
  const [problem] = validatePagePlan(plan)
  if (problem) throw new Error(problem.message)

  const { provenance } = source.work
  const sections = plan.pages
    .filter((page) => page.included)
    .map((page, order) => ({ id: page.id, title: page.title.trim(), order, html: pageHtml(plan, page) }))
  return {
    work: {
      ...source.work,
      title: metadata.title.trim(),
      sections,
      provenance: importProvenance(metadata, {
        kind: provenance.kind,
        ...(provenance.originalName ? { originalName: provenance.originalName } : {}),
      }),
    },
    report: {
      ...source.report,
      // Section ids from the parse no longer name a page; a finding stays a
      // document-level fact rather than pointing at an id nothing resolves.
      findings: source.report.findings.map(({ sectionId: _stale, ...finding }) => finding),
      counts: { ...source.report.counts, sections: sections.length },
    },
  }
}
