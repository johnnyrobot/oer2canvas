import type { AllowlistResult, IssueSet } from '../engine/gate'

export type {
  Severity, AuditIssue, IssueSet, AllowlistResult,
  GateDeps, Conformance, GateResult,
} from '../engine/gate'

/** WCAG text-size class. "large" = >=18pt, or >=14pt bold. */
export type TextSize = 'normal' | 'large'

/** Shared WCAG 2.2 contrast thresholds. Never hardcode these elsewhere. */
export const WCAG = {
  AA_NORMAL: 4.5,
  AA_LARGE: 3.0,
  AAA_NORMAL: 7.0,
  AAA_LARGE: 4.5,
} as const

export interface ContrastResult {
  /** Contrast ratio, 1.0-21.0, rounded to 2 dp. */
  ratio: number
  level: 'AAA' | 'AA' | 'fail'
  passesAA: boolean
  passesAAA: boolean
  size: TextSize
}

export type ContrastChecker = (fg: string, bg: string, size?: TextSize) => ContrastResult
export type AllowlistValidator = (html: string) => Promise<AllowlistResult>
export type Auditor = (html: string) => Promise<IssueSet>

import type { Chapter } from '../sources/types'
import type { GateResult } from '../engine/gate'

/** One thing the pipeline fixed on its own. Visible for trust, collapsed by default. */
export interface FixNote {
  /** The step that made the change, e.g. `absolutize`. */
  step: string
  message: string
  /** How many elements this note covers, when it summarises more than one. */
  count?: number
}

/**
 * Why a human is being asked.
 *
 * `confirm-decorative` is deliberately distinct from `alt`: the publisher SAID
 * decorative and we are asking whether that is true, which is a one-keystroke
 * confirmation rather than a writing task, and slice 5 groups them apart.
 */
export type QueueKind = 'alt' | 'confirm-decorative' | 'table-headers'

/**
 * One item of human judgment.
 *
 * NOT a WCAG violation claim — that is what `AuditIssue` is for. `alt-text.ts`
 * is correct that `alt=""` is not an audit defect; a `QueueItem` asks for
 * confirmation, and the two never contradict each other.
 */
export interface QueueItem {
  kind: QueueKind
  sectionId: string
  /** Stable id of the element in the compiled html. Slice 5 highlights it. */
  elementId: string
  /**
   * Content hash, for dedupe across the whole selection. Optional because only
   * some publishers put it in the url — OpenStax does, Pressbooks will not, and
   * hashing bytes needs a fetch this pipeline deliberately does not make.
   */
  hash?: string
  /** What slice 5 puts on screen next to the question. */
  context: { caption?: string; reference?: string; src?: string }
  /** A draft the human confirms or replaces. Slice 9's VLM fills this in. */
  proposed?: string
  /**
   * Alt text ALREADY on the image, surfaced because the auditor had something to
   * say about it — too short, a redundant lead-in, or written by Word rather
   * than by a person.
   *
   * Deliberately not `proposed`, and the difference is load-bearing in two
   * places. The card labels it as the current value rather than as a
   * suggestion, because calling somebody else's existing text a "suggested
   * description" is a lie about where it came from. And `proposed` suppresses
   * the local-draft offer while this does not: a caption is evidence a model
   * should not overwrite, whereas flagged alt is the exact case the instructor
   * opened the queue to improve on.
   *
   * Set only for alt the auditor did NOT rate `error`. A filename or a URL is
   * worthless as a starting point, and prefilling the field with it would
   * invite a rubber-stamp of the junk this app exists to catch.
   */
  current?: string
}

export interface CompiledSection {
  id: string
  title: string
  /** Compiled html. Empty when `error` is set — a failed compile emits nothing. */
  html: string
  notes: FixNote[]
  queue: QueueItem[]
  /** Set when a step threw. The section is not publishable and its html is not used. */
  error?: string
  /** The gate's verdict. Absent until the section has been audited. */
  gate?: GateResult
}

export interface CompiledChapter {
  chapter: Chapter
  sections: CompiledSection[]
  /** Every section's queue, merged and deduped by `hash`. */
  queue: QueueItem[]
}

/**
 * Bytes approved for output. Production publication is gated by
 * `isPublishable`, so the fallback exists only for lower-level builders and
 * fixtures that intentionally exercise pre-gate structure.
 */
export function auditedHtml(section: CompiledSection): string {
  return section.gate?.html ?? section.html
}

/**
 * D5: nothing publishes until the queue is empty.
 *
 * READ THIS, NOT `GateResult.passedChecks`. `passedChecks` is upstream's
 * contract and is `true` whenever `blockers` is empty — it knows nothing about
 * `needsHumanReview` and nothing at all about the queue. A chapter with four
 * unanswered alt questions has `passedChecks === true` on every section and is
 * not publishable. Slices 6 and 7 call this function.
 */
export function isPublishable(c: CompiledChapter): boolean {
  if (c.queue.length > 0) return false
  return c.sections.every(
    (s) => !s.error && s.gate !== undefined && s.gate.conformance.blockers.length === 0,
  )
}
