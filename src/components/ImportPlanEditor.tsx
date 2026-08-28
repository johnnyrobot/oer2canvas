import { useEffect, useId, useRef, useState } from 'react'
import { capabilityForFormat } from '../import/capability'
import {
  confirmImport,
  mergeWithNext,
  movePage,
  pageHtml,
  proposePagePlan,
  renamePage,
  setPageIncluded,
  splitPage,
  splitPoints,
  validatePagePlan,
  type PagePlan,
  type ProposedPage,
} from '../import/page-plan'
import type { ImportFinding, ImportReport, ImportResult } from '../import/types'
import { messageOf } from '../errors'
import {
  completeImportMetadata,
  ImportMetadataFields,
  useImportErrorFocus,
  type ImportMetadataDraft,
} from './ImportMetadataFields'

/**
 * Everything the user can change about an import before it is prepared, kept
 * apart from the parse result it was derived from.
 *
 * `App` owns this value and the editor is controlled by it, so the draft
 * survives leaving the Content phase: an instructor can prepare, look at Review
 * and Plan, come back, exclude a page, and prepare again — and the source is
 * never reparsed, because `source` is exactly what the parser returned.
 */
export interface ImportDraft {
  source: ImportResult
  plan: PagePlan
  metadata: ImportMetadataDraft
  /** Findings from page formation itself, e.g. the page budget being exceeded. */
  planFindings: ImportFinding[]
  splitHeadingLevel?: number
}

function metadataFrom(result: ImportResult): ImportMetadataDraft {
  const { provenance } = result.work
  return {
    title: result.work.title,
    author: provenance.author ?? '',
    sourceName: provenance.sourceName ?? '',
    sourceUrl: provenance.sourceUrl ?? '',
    licenseName: provenance.license?.name ?? '',
    licenseUrl: provenance.license?.url ?? '',
    rightsAuthority: provenance.rights.authority,
    rightsAcknowledged: provenance.rights.acknowledged,
  }
}

export function createImportDraft(source: ImportResult): ImportDraft {
  const { plan, findings, splitHeadingLevel } = proposePagePlan(source.work)
  return {
    source,
    plan,
    metadata: metadataFrom(source),
    planFindings: findings,
    ...(splitHeadingLevel !== undefined ? { splitHeadingLevel } : {}),
  }
}

function parserLabel(report: ImportReport): string {
  switch (report.parser) {
    case 'anydoc': return `AnyDoc ${report.parserVersion ?? ''}`.trim()
    case 'pdf-inspector': return `PDF Inspector ${report.parserVersion ?? ''}`.trim()
    case 'firecrawl': return 'Firecrawl'
    default: return report.format === 'markdown' ? 'Marked GFM browser parser' : 'Native browser parser'
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** What a page is called in control names and announcements; never empty. */
function nameOf(page: ProposedPage, position: number): string {
  return page.title.trim() || `page ${position}`
}

const BUTTON = 'min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium dark:border-neutral-700'
const FIELD = 'mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900'

export function ImportPlanEditor({
  draft,
  onChange,
  onConfirm,
  onDiscard,
  notice,
}: {
  draft: ImportDraft
  onChange: (next: ImportDraft) => void
  onConfirm: (result: ImportResult) => void
  onDiscard: () => void
  /** Why earlier prepared output is gone, from the owner that discarded it. */
  notice?: string
}) {
  const idPrefix = useId()
  const [announcement, setAnnouncement] = useState('')
  const [error, setError] = useState('')
  const [splitting, setSplitting] = useState<{ pageId: string; offset: number } | undefined>()
  // Preview bodies are mounted only while open: a hundred-page plan should not
  // put a hundred documents in the DOM, and closed previews must not put their
  // headings into the page outline the shell's own heading lives in.
  const [previews, setPreviews] = useState<ReadonlySet<string>>(new Set())
  const errorElement = useImportErrorFocus(error)

  /*
    Focus restoration after a structural edit. Controls are registered by page
    id and role, so a request survives the re-render that reorders or removes
    the list item the user was on. A split lands on the new page's title; a
    merge stays on the merge button when it still exists and otherwise on the
    surviving page's title; a move stays on the button that was pressed.
  */
  const controls = useRef(new Map<string, HTMLElement>())
  const [focusKey, setFocusKey] = useState<string | undefined>()
  const register = (key: string) => (element: HTMLElement | null) => {
    if (element) controls.current.set(key, element)
    else controls.current.delete(key)
  }
  useEffect(() => {
    if (!focusKey) return
    controls.current.get(focusKey)?.focus()
    setFocusKey(undefined)
  }, [focusKey])

  const { source, plan, metadata } = draft
  const title = metadata.title.trim() || source.work.title
  const capability = capabilityForFormat(source.work.format)
  const findings = [...source.report.findings, ...draft.planFindings]
  const blockers = findings.filter((finding) => finding.severity === 'blocker')
  const problems = validatePagePlan(plan)
  const included = plan.pages.filter((page) => page.included).length
  const counts = source.report.counts

  const update = (next: PagePlan) => onChange({ ...draft, plan: next })

  function confirm() {
    setError('')
    try {
      onConfirm(confirmImport(source, plan, completeImportMetadata(metadata)))
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  function move(page: ProposedPage, position: number, direction: 'up' | 'down') {
    const name = nameOf(page, position)
    const next = movePage(plan, page.id, direction)
    if (next === plan) {
      setAnnouncement(`${name} is already ${direction === 'up' ? 'first' : 'last'}.`)
    } else {
      update(next)
      const target = next.pages.findIndex((entry) => entry.id === page.id) + 1
      setAnnouncement(`Moved ${name} to position ${target} of ${next.pages.length}.`)
    }
    setFocusKey(`${page.id}:${direction}`)
  }

  function merge(page: ProposedPage, position: number) {
    const next = plan.pages[position]
    if (!next) return
    const name = nameOf(page, position)
    const merged = mergeWithNext(plan, page.id)
    update(merged)
    setAnnouncement(`Merged ${nameOf(next, position + 1)} into ${name}.`)
    const stillHasNext = merged.pages.findIndex((entry) => entry.id === page.id) < merged.pages.length - 1
    setFocusKey(`${page.id}:${stillHasNext ? 'merge' : 'title'}`)
  }

  function toggleSplit(page: ProposedPage, position: number) {
    const name = nameOf(page, position)
    const points = splitPoints(plan, page)
    if (points.length === 0) {
      setAnnouncement(`${name} has one block and cannot be split.`)
      return
    }
    if (splitting?.pageId === page.id) {
      setSplitting(undefined)
      return
    }
    // Default to the first heading inside the page, the boundary a person is
    // most likely to want; otherwise the first boundary there is.
    const heading = points.find((point) => plan.blocks[page.blocks[point.offset]!]!.heading)
    setSplitting({ pageId: page.id, offset: (heading ?? points[0]!).offset })
  }

  function split(page: ProposedPage, position: number) {
    if (!splitting) return
    const name = nameOf(page, position)
    try {
      const next = splitPage(plan, page.id, splitting.offset)
      const created = next.pages[next.pages.findIndex((entry) => entry.id === page.id) + 1]!
      update(next)
      setSplitting(undefined)
      setAnnouncement(`Split ${name}. New page ${nameOf(created, position + 1)} added after it.`)
      setFocusKey(`${created.id}:title`)
    } catch (caught) {
      setAnnouncement(messageOf(caught))
    }
  }

  return (
    <section aria-labelledby={`${idPrefix}-heading`} className="mx-auto max-w-3xl pb-24">
      <h2 id={`${idPrefix}-heading`} className="text-xl font-semibold">Page plan: {title}</h2>
      <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
        {capability?.label ?? source.work.format.toUpperCase()} · {parserLabel(source.report)} ·{' '}
        {plural(plan.pages.length, 'proposed page', 'proposed pages')} · {included} included ·{' '}
        {counts.headings} headings · {counts.tables} tables · {counts.equations} equations ·{' '}
        {counts.images} images · {counts.notes} notes · {counts.unavailableAssets} unavailable assets ·{' '}
        {source.work.assets.length} packaged assets
        {source.report.originalBytes !== undefined && ` · ${source.report.originalBytes.toLocaleString()} bytes`}
        {' '}· processed in this browser
      </p>
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
        {draft.splitHeadingLevel !== undefined
          ? `Pages were split at heading level ${draft.splitHeadingLevel}, the highest level that repeats. Rename, reorder, split, merge, or exclude them below; nothing is reread from the source.`
          : 'No repeated heading level was found, so the document starts as one page. Split it wherever you want a new Canvas page; nothing is reread from the source.'}
      </p>
      {capability && (
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
          <strong>{capability.label} limitation:</strong> {capability.limitations.join(' ')}
        </p>
      )}

      {findings.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">No extraction warnings or blockers.</p>
      ) : (
        <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-medium">
            {blockers.length > 0
              ? 'This content cannot be prepared until its blockers are resolved.'
              : 'Review these findings before preparing the pages.'}
          </p>
          <ul role="list" className="mt-2 list-disc space-y-1 pl-5">
            {findings.map((finding) => (
              <li key={`${finding.code}-${finding.sectionId ?? ''}`}>
                <strong>{finding.severity === 'blocker' ? 'Blocker' : 'Warning'}:</strong> {finding.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-4 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
        <summary className="cursor-pointer text-sm font-medium">Document details and rights</summary>
        <ImportMetadataFields
          value={metadata}
          onChange={(next) => onChange({ ...draft, metadata: next })}
          idPrefix={`${idPrefix}-plan`}
        />
      </details>

      <p role="status" aria-live="polite" className="mt-4 min-h-5 text-sm">{announcement}</p>

      <h3 className="mt-2 text-lg font-semibold">Proposed pages</h3>
      <ol aria-label="Proposed Canvas pages" className="mt-2 flex flex-col gap-3">
        {plan.pages.map((page, index) => {
          const position = index + 1
          const name = nameOf(page, position)
          const points = splitPoints(plan, page)
          const open = splitting?.pageId === page.id
          const titleId = `${idPrefix}-${page.id}-title`
          const selectId = `${idPrefix}-${page.id}-split`
          return (
            <li
              key={page.id}
              className={`rounded-lg border p-4 ${page.included
                ? 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900'
                : 'border-dashed border-neutral-400 bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-950'}`}
            >
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Page {position} of {plan.pages.length}
                {!page.included && ' — excluded'}
                {' '}· {plural(page.blocks.length, 'block', 'blocks')}
              </p>
              <label htmlFor={titleId} className="mt-2 block text-sm font-medium">Title</label>
              <input
                id={titleId}
                ref={register(`${page.id}:title`)}
                aria-label={`Title of page ${position}`}
                value={page.title}
                onChange={(event) => update(renamePage(plan, page.id, event.target.value))}
                className={FIELD}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Include: ${name}`}
                    checked={page.included}
                    onChange={(event) => {
                      update(setPageIncluded(plan, page.id, event.target.checked))
                      setAnnouncement(`${name} is ${event.target.checked ? 'included in' : 'excluded from'} export.`)
                    }}
                  />
                  Include
                </label>
                <button type="button" ref={register(`${page.id}:up`)} aria-label={`Move up: ${name}`} className={BUTTON} onClick={() => move(page, position, 'up')}>
                  Move up
                </button>
                <button type="button" ref={register(`${page.id}:down`)} aria-label={`Move down: ${name}`} className={BUTTON} onClick={() => move(page, position, 'down')}>
                  Move down
                </button>
                <button
                  type="button"
                  aria-label={`Split: ${name}`}
                  aria-expanded={points.length > 0 ? open : undefined}
                  aria-disabled={points.length === 0 ? 'true' : undefined}
                  className={`${BUTTON} ${points.length === 0 ? 'opacity-60' : ''}`}
                  onClick={() => toggleSplit(page, position)}
                >
                  Split
                </button>
                {index < plan.pages.length - 1 && (
                  <button type="button" ref={register(`${page.id}:merge`)} aria-label={`Merge with next page: ${name}`} className={BUTTON} onClick={() => merge(page, position)}>
                    Merge with next page
                  </button>
                )}
              </div>
              {open && (
                <div className="mt-3 rounded-md border border-brand-500 p-3">
                  <label htmlFor={selectId} className="block text-sm font-medium">Start a new page at</label>
                  <select
                    id={selectId}
                    value={splitting!.offset}
                    onChange={(event) => setSplitting({ pageId: page.id, offset: Number(event.target.value) })}
                    className={FIELD}
                  >
                    {points.map((point) => (
                      <option key={point.offset} value={point.offset}>{point.label}</option>
                    ))}
                  </select>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="min-h-9 rounded-md bg-brand-700 px-3 text-sm font-medium text-white" onClick={() => split(page, position)}>
                      Split page
                    </button>
                    <button type="button" className={BUTTON} onClick={() => setSplitting(undefined)}>
                      Cancel split
                    </button>
                  </div>
                </div>
              )}
              <details
                className="mt-3"
                open={previews.has(page.id)}
                onToggle={(event) => {
                  const open = event.currentTarget.open
                  setPreviews((current) => {
                    if (current.has(page.id) === open) return current
                    const next = new Set(current)
                    if (open) next.add(page.id)
                    else next.delete(page.id)
                    return next
                  })
                }}
              >
                <summary className="cursor-pointer text-sm">Preview {name}</summary>
                {previews.has(page.id) && (
                  /* Page html is a verbatim slice of the importer's inert,
                     sanitized output; no source markup is parsed live here. */
                  <div className="mt-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800" dangerouslySetInnerHTML={{ __html: pageHtml(plan, page) }} />
                )}
              </details>
            </li>
          )
        })}
      </ol>

      {problems.length > 0 && (
        <ul role="list" className="mt-4 list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300">
          {problems.map((problem) => <li key={`${problem.code}-${problem.pageId ?? ''}`}>{problem.message}</li>)}
        </ul>
      )}
      {notice && (
        <p className="mt-4 rounded-md border border-brand-500 bg-brand-50 p-3 text-sm text-brand-700 dark:bg-neutral-900 dark:text-brand-300">
          {notice}
        </p>
      )}
      {error && (
        <p ref={errorElement} role="alert" tabIndex={-1} className="mt-4 text-sm text-red-700 outline-none focus:ring-2 focus:ring-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={blockers.length > 0 || problems.length > 0}
          className="min-h-9 rounded-md bg-brand-700 px-4 text-sm font-medium text-white disabled:opacity-60"
          onClick={confirm}
        >
          Prepare {plural(included, 'page', 'pages')}
        </button>
        <button type="button" className={BUTTON} onClick={onDiscard}>
          Choose different content
        </button>
      </div>
    </section>
  )
}
