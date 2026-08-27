/**
 * What a human decided, and whether we will take it.
 *
 * An answer is plain data and lives in exactly one place — the session's
 * `answers` map. Nothing answer-shaped ever enters `CompiledChapter`: an
 * answered item simply stops being emitted by compile, which is what makes
 * reversal a map delete and what keeps `isPublishable` the only publishability
 * decision (D5.1, D5.11, D5.12).
 */
import type { QueueItem } from '../../contracts/index'
import { altTextIssue } from '../audit/alt-text'
import { CANVAS_ALT_TEXT_MAX_LENGTH, altTextLength } from '../alt-text'

export type QueueAnswer =
  | { type: 'decorative' }
  | { type: 'alt'; text: string }
  | { type: 'table-headers'; choice: 'row' | 'column' | 'both' | 'presentation' }

/**
 * The identity of a question, not of an element.
 *
 * Hash first, so answering one copy of an image answers every copy of it in the
 * chapter — the propagation D5.2 promises, done at apply time rather than by
 * materializing an occurrence map. A table has no hash and falls back to its
 * section and element, so table answers never propagate. That asymmetry is
 * correct: two identical images are the same picture, two identical tables are
 * not necessarily the same table.
 */
export const queueKeyOf = (
  item: Pick<QueueItem, 'hash' | 'sectionId' | 'elementId'>,
): string => item.hash ?? `${item.sectionId}::${item.elementId}`

export type AnswerVerdict =
  | { refused: true; message: string }
  | { refused: false; note?: string }

/**
 * A caption label used as the opening of a description — "Figure 2 A four-term
 * polynomial."
 *
 * The number is required, and that is the whole point of the rule: "Figure
 * skating jump" and "Table settings for eight" are descriptions, not labels.
 * `PublisherProfile.labelOnlyCaption` (`context.ts:57`) carries the same
 * vocabulary anchored to the WHOLE caption; this is the prefix form, and it is
 * kept local because `validateAnswer` judges a string with no profile in hand.
 *
 * `altTextIssue` does not catch this and should not: a leading label is not a
 * WCAG 1.1.1 failure, it is a duplication the instructor is better placed to
 * judge than the gate. So it accepts, with a note, and never refuses.
 */
const LEADING_LABEL = /^(figure|fig\.?|table|example|exercise)\s*[\d.]+\b/i

/**
 * Layer 1 of the three (design §1.2): the gate's own rule, run in-process at the
 * moment the human presses the button.
 *
 * `error` refuses and the item stays in the queue. `warning` and `alert` accept
 * with a note that survives to the answered list — the gate never blocked on
 * those and neither does this. The UI never re-derives these strings; they are
 * the UX spec's §4 copy and they live here.
 */
export function validateAnswer(answer: QueueAnswer): AnswerVerdict {
  if (answer.type !== 'alt') return { refused: false }

  // BEFORE altTextIssue, deliberately. It returns null for an empty string
  // because alt="" is the correct way to mark an image decorative — true of
  // markup, false of a human who submitted nothing. Only this layer can tell
  // those two apart, because only this layer knows a person just acted.
  const text = answer.text.trim()
  if (text === '') {
    return { refused: true, message: 'Not saved: the description is empty.' }
  }
  if (altTextLength(text) > CANVAS_ALT_TEXT_MAX_LENGTH) {
    return {
      refused: true,
      message: `Not saved: the description must be ${CANVAS_ALT_TEXT_MAX_LENGTH} characters or fewer for Canvas.`,
    }
  }

  const label = LEADING_LABEL.exec(text)
  if (label) {
    return {
      refused: false,
      note:
        `Saved, with a note: this starts with '${label[0].trim()}'. The caption already ` +
        'carries that label, so screen readers will hear it twice.',
    }
  }

  // `src` is not read by any rule — the rules judge the alt alone — and there is
  // no image in hand at accept time anyway. It is here because `ImageAlt`
  // describes an image found in the DOM, and this call site is the one place
  // that judges alt text that is not in a document yet.
  const issue = altTextIssue({ alt: text, src: '', presentation: false })
  if (!issue) return { refused: false }

  if (issue.severity === 'error') return { refused: true, message: refusalFor(issue.id) }

  return { refused: false, note: `Saved, with a note: ${issue.message}` }
}

/**
 * One message per mistake, in the instructor's terms.
 *
 * `altTextIssue`'s own messages are written for an audit report and quote the
 * offending text back — right for a report, wrong for a field the text is still
 * sitting in. These are the UX spec's §4 strings.
 */
function refusalFor(id: string): string {
  if (id === 'alt-text-placeholder') return 'Not saved: that is a placeholder, not a description.'
  return 'Not saved: that looks like a file name or web address. Describe what the image shows.'
}
