import type { PageTarget } from '../engine/export/page-identity'
import type { CanvasPage } from './client'

/**
 * WHICH EXISTING CANVAS PAGE, IF ANY, IS THIS SECTION'S PAGE.
 *
 * MEASURED 2026-08-23 against a live Canvas, and it overturned the design this
 * code was first written to:
 *
 *   - `PUT /courses/:id/pages/:url` does **not** create a page at `:url`.
 *   - Canvas derives every page url from the TITLE. "1.4 Polynomials" became
 *     `1-dot-4-polynomials`; "Alpha Title" became `alpha-title`.
 *   - `wiki_page[url]` is **ignored** on both `POST` and `PUT`. Sending it
 *     changed nothing.
 *   - So a `PUT` aimed at a url that does not exist creates a SECOND page —
 *     `alpha-title`, then `alpha-title-2`. Repeating a push that way duplicates
 *     every page, which is the exact opposite of what this product promises.
 *
 * The cartridge importer behaves differently: it takes the url from the file
 * NAME, producing names such as `chapter-1-1-4-polynomials`.
 * The two entry points genuinely disagree, and no amount of care on our side
 * makes them agree — Canvas simply does not let a REST client choose a url.
 *
 * Therefore: THE ONLY WAY TO UPDATE IN PLACE IS TO AIM AT A URL CANVAS ALREADY
 * HAS. This module decides which one that is, from the course's own page list —
 * §2.4's list, which the Destination screen already loads for the Plan screen.
 */

export interface ResolvedTarget extends PageTarget {
  /**
   * The url to `PUT`. Absent means create, and accept whatever url Canvas picks.
   */
  existingUrl?: string
  /**
   * Set when an existing page might be this section's and might be another's.
   *
   * Not a failure — a refusal. The Plan screen renders it as "unknown" and the
   * push creates rather than overwriting, because writing this section's bytes
   * over a page that turns out to belong to a different chapter is silent,
   * irreversible, and indistinguishable from working.
   */
  ambiguous?: boolean
}

export function resolveTargets(
  targets: readonly PageTarget[],
  existing?: readonly CanvasPage[],
): ResolvedTarget[] {
  // Nobody looked at the course, so nothing may be claimed about it.
  if (existing === undefined) return targets.map((t) => ({ ...t }))

  const byUrl = new Map(existing.map((p) => [p.url, p]))
  const byTitle = new Map<string, CanvasPage[]>()
  for (const p of existing) {
    const list = byTitle.get(p.title) ?? []
    list.push(p)
    byTitle.set(p.title, list)
  }

  const claimed = new Set<string>()
  const resolved: ResolvedTarget[] = targets.map((t) => ({ ...t }))

  /*
   * SLUG FIRST, and it is a stronger signal than the title rather than merely an
   * earlier one. A page whose url is `chapter-2-introduction` was put there by
   * our own cartridge, so it identifies its section exactly — which is what lets
   * two chapters that both contain "Introduction" be told apart at all.
   */
  for (const r of resolved) {
    const hit = byUrl.get(r.slug)
    if (hit && !claimed.has(hit.url)) {
      r.existingUrl = hit.url
      claimed.add(hit.url)
    }
  }

  /*
   * Then the title, for pages a previous PUSH created — those live at a url
   * Canvas invented, so the title is the only thing about them we recognise.
   *
   * How many sections still want this title decides whether it can be used at
   * all. One wanting section and one free page is an identification. Two of
   * either is a coin toss, and this module does not toss coins: those sections
   * are marked ambiguous and will be created rather than overwriting a page that
   * may belong to a different chapter.
   */
  for (const [title, pages] of byTitle) {
    const wanting = resolved.filter((r) => r.existingUrl === undefined && r.section.title === title)
    if (wanting.length === 0) continue
    const free = pages.filter((p) => !claimed.has(p.url))
    if (free.length === 0) continue
    if (wanting.length > 1 || free.length > 1) {
      for (const r of wanting) r.ambiguous = true
      continue
    }
    wanting[0]!.existingUrl = free[0]!.url
    claimed.add(free[0]!.url)
  }

  return resolved
}
