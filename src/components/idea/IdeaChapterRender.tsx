/**
 * The read-only chapter render in the IDEA aside — the whole chapter, every
 * section — with the focused finding's element outlined and a section whose
 * recompile is in flight replaced by a sentence.
 *
 * This takes over from `ChapterView` in the IDEA aside (slice 1 used it with
 * the accessibility verdicts off). Same construction as `ChapterView` and the
 * queue's region E, and the same invariant: only `gate.html` (allowlist-
 * repaired) is ever set as innerHTML; `s.html` — compiled but un-audited —
 * never is, which is why a pending section shows a sentence and not "the
 * new bytes, briefly". Packaged-asset tokens are resolved for display only,
 * exactly as `ChapterView` does it.
 *
 * The outline is found INSIDE the target's section. Block ids are minted per
 * section (`b2c-blk-0` exists in every section), so a document-wide id
 * lookup would light up the first section's paragraph for every finding.
 *
 * `data-section` rather than `id={s.id}` on the article: a section id is
 * publisher data and could collide with a block id inside the body; a data
 * attribute cannot.
 */
import { useLayoutEffect, useRef } from 'react'
import type { CompiledChapter } from '../../contracts/index'
import { CanvasShellStyles } from '../CanvasShellStyles'
import { usePackagedAssetUrls } from '../usePackagedAssetUrls'
import { IDEA_COPY } from './copy'
import './idea.css'

const HIGHLIGHT = 'b2c-idea-target'

export function IdeaChapterRender({
  compiled, target, pending,
}: {
  compiled: CompiledChapter
  target: { sectionId: string; elementId: string } | undefined
  pending: ReadonlySet<string>
}) {
  const { chapter } = compiled
  const resolve = usePackagedAssetUrls(chapter.assets)
  const root = useRef<HTMLElement>(null)
  // Re-run when the bytes change too: a recompile replaces the section's
  // article, and the outline has to land on the new element.
  const bytes = compiled.sections.map((s) => s.gate?.html ?? '').join(' ')

  useLayoutEffect(() => {
    if (!root.current || !target) return
    const article = root.current.querySelector(`article[data-section="${CSS.escape(target.sectionId)}"]`)
    const el = article?.querySelector(`#${CSS.escape(target.elementId)}`)
    if (!el) return
    el.classList.add(HIGHLIGHT)
    el.scrollIntoView({ block: 'center' })
    return () => el.classList.remove(HIGHLIGHT)
  }, [target, bytes])

  return (
    <section ref={root} className="b2c-idea-render" aria-labelledby="idea-chapter-heading">
      <CanvasShellStyles />
      <h2 id="idea-chapter-heading">{chapter.title}</h2>
      <p>
        From {chapter.attribution.url
          ? <a href={chapter.attribution.url}>{chapter.attribution.bookTitle}</a>
          : chapter.attribution.bookTitle} by{' '}
        {chapter.attribution.publisher}
        {chapter.attribution.license ? ` — ${chapter.attribution.license.name}` : ''}
      </p>
      {compiled.sections.map((s) => (
        <article key={s.id} data-section={s.id} aria-label={s.title}>
          {pending.has(s.id) || !s.gate
            ? <p className="text-sm">{IDEA_COPY.render.pending}</p>
            : <div className="b2c-section-body" dangerouslySetInnerHTML={{ __html: resolve(s.gate.html) }} />}
        </article>
      ))}
    </section>
  )
}
