import type { CompiledSection, QueueItem } from '../../contracts/index'
import type { Chapter, Section } from '../../sources/types'
import { OPENSTAX } from './context'
import type { CompileContext, PublisherProfile } from './context'
import type { QueueAnswer } from './answers'
import { createSink } from './sink'
import { STEPS, type Step } from './steps/index'

export type { Step } from './steps/index'
export type { Sink } from './sink'

/**
 * Compile one section: parse once, run every step over the same detached
 * document, serialize once.
 *
 * `DOMParser.parseFromString` executes no script and loads no subresource, and
 * the document it returns is never attached to the live one — so the property
 * `allowlist.ts` documents, that publisher html is never parsed live, still
 * holds. Both halves of that are pinned by tests rather than asserted here.
 *
 * `steps` is injectable for tests only; production passes nothing.
 */
export function compileSection(
  section: Section,
  ctx: CompileContext,
  steps: readonly Step[] = STEPS,
): CompiledSection {
  const sink = createSink(section.id)
  try {
    const doc = new DOMParser().parseFromString(section.html, 'text/html')
    for (const step of steps) step(doc, ctx, sink)
    // Trimmed, not cosmetic: this is what makes compile(compile(x)) === compile(x)
    // actually hold. Publisher html carries whitespace between <body> and its
    // first element, which survives into doc.body.innerHTML on this pass. Feed
    // that output back in as a fragment and the parser's "before head" insertion
    // mode discards leading whitespace — so an untrimmed compile would differ
    // from its own recompile with every compile step genuinely
    // idempotent and none of them having done anything.
    const html = doc.body.innerHTML.trim()
    return { id: section.id, title: section.title, html, ...sink.result() }
  } catch (e) {
    // The try/catch wraps the WHOLE array rather than each step, deliberately.
    // Steps mutate one shared document in place, so a throw mid-step leaves a
    // half-transformed tree — emitting it would ship html nothing verified.
    // One section fails; the other fourteen still compile, and this one says so.
    return {
      id: section.id,
      title: section.title,
      html: '',
      notes: [],
      queue: [],
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * The `CompileContext` for one section of a chapter.
 *
 * Extracted because `compileAndAuditChapter` compiles section by section inside
 * its own loop rather than calling `compileChapter` — it has to, to report
 * progress and honour a cancel between sections — and two places building this
 * object by hand is how the two quietly drift.
 */
export function sectionContext(
  chapter: Chapter,
  section: Section,
  profile: PublisherProfile,
  answers?: ReadonlyMap<string, QueueAnswer>,
): CompileContext {
  return {
    profile,
    contentBaseUrl: section.contentBaseUrl,
    canonicalUrl: section.canonicalUrl,
    sectionTitle: section.title,
    xrefs: chapter.xrefs,
    attribution: chapter.attribution,
    sectionId: section.id,
    // Spread rather than `answers,`: an explicit `answers: undefined` key is a
    // different object from an absent one, and `context.test.ts` asserts the
    // absent shape for every caller that predates slice 5.
    ...(answers ? { answers } : {}),
  }
}

/**
 * `steps` and `answers` travel in an options object rather than as positional
 * arguments: `compileChapter(chapter, profile, answers)` and
 * `compileChapter(chapter, profile, steps)` are indistinguishable at a call site
 * and only one of them is right.
 */
export function compileChapter(
  chapter: Chapter,
  profile: PublisherProfile,
  opts: { steps?: readonly Step[]; answers?: ReadonlyMap<string, QueueAnswer> } = {},
): { sections: CompiledSection[]; queue: QueueItem[] } {
  const sections = chapter.sections.map((s) =>
    compileSection(s, sectionContext(chapter, s, profile, opts.answers), opts.steps ?? STEPS),
  )
  return { sections, queue: mergeQueues(sections) }
}

/**
 * Layer 2 of the three (design §1.2): recompile the named sections, and stop.
 *
 * An answer must reach the html in tens of milliseconds, because a 25-item queue
 * cannot cost two seconds an item — and the two seconds is the iframe audit, not
 * the compile, which is 0-15 ms a section. So this path runs the same compile steps
 * over the same raw publisher html and does not gate the result.
 *
 * The gate is therefore ABSENT on what comes back, not stale. "Absent until the
 * section has been audited" is `CompiledSection.gate`'s own contract wording,
 * and it is the honest state for bytes that have just changed: a verdict carried
 * over from the previous compile would be a claim about html that no longer
 * exists. Layer 3 puts the gate back in the background, where the human's
 * reading time hides it.
 *
 * Returns only the sections asked for, in the chapter's order.
 */
export function recompileSections(
  chapter: Chapter,
  sectionIds: readonly string[],
  opts: { profile?: PublisherProfile; answers?: ReadonlyMap<string, QueueAnswer>; steps?: readonly Step[] },
): CompiledSection[] {
  const profile = opts.profile ?? OPENSTAX
  const wanted = new Set(sectionIds)
  return chapter.sections
    .filter((s) => wanted.has(s.id))
    .map((s) => compileSection(s, sectionContext(chapter, s, profile, opts.answers), opts.steps ?? STEPS))
}

/** The chapter-level queue: every section's items, deduped by content hash. */
export function mergeQueues(sections: readonly CompiledSection[]): QueueItem[] {
  return dedupe(sections.flatMap((s) => s.queue))
}

/**
 * Merge the per-section queues, keeping the first item per content hash.
 *
 * Textbooks reuse images relentlessly — select four chapters and the same icon
 * may appear thirty times. Fixing it once and propagating is what turns a
 * 90-item queue into a 25-item one. An item with NO hash is always kept: two
 * items we cannot prove identical must both be asked about.
 */
function dedupe(items: QueueItem[]): QueueItem[] {
  const seen = new Set<string>()
  return items.filter((i) => {
    if (!i.hash) return true
    if (seen.has(i.hash)) return false
    seen.add(i.hash)
    return true
  })
}
