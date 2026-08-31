/**
 * Deterministic alt-text QUALITY checks (WCAG 1.1.1).
 *
 * Why this exists: axe only checks that an `alt` attribute is *present*. It
 * cannot tell `alt="Bar chart of enrollment rising each quarter"` from
 * `alt="SPEED BUMP.jpg"`. Neither can WAVE. So an image with a junk alt passes
 * every automated checker on the market while conveying nothing to a screen
 * reader — and, until now, would have passed this app's gate too.
 *
 * That gap is not theoretical. Run against 8 real Canvas course exports (314
 * pages), these rules found 10 alt failures that axe scored as clean, including
 * `SPEED BUMP.jpg` and `giotto_ Chapel.jpg` (art-103), `DigitalLiteracy2.jpg`
 * (digital-literacy-2016), and `ios-icon.png` — in a course whose own title is
 * "english-102-ACCESSIBLE-template".
 *
 * It also closes a hole in the remediation loop: `describe_image` lets the model
 * *draft* alt text, and the gate's re-audit only ever verified that alt was
 * present. A model that emits a filename or a placeholder was trusted. Now the
 * draft is checked by a rule instead — which is what makes it safe to run the
 * remediation loop on a small on-device model at all.
 *
 * Rules only fire on things a machine can be *sure* about. Severity encodes that
 * confidence: `error` withholds the passed-checks badge (definite 1.1.1
 * failure), `warning` is surfaced but does not, `alert` routes to human review.
 * Judging whether a plausible-sounding description is *accurate* is not
 * decidable here and is deliberately out of scope.
 */
import type { AuditIssue } from '../../contracts/index';
import type { ImageAlt } from './types';
import { CANVAS_ALT_TEXT_MAX_LENGTH, altTextLength } from '../alt-text';

/**
 * A filename used as alt text. Anchored to the whole string: a real description
 * may legitimately *mention* an extension ("The .png versus .jpg tradeoff…"),
 * so a bare /\.\w{3}$/ would produce false errors on good prose.
 *
 * Matches: no whitespace-delimited sentence structure, ending in an image
 * extension — `SPEED BUMP.jpg`, `giotto_ Chapel.jpg`, `Paul Burwick (1) (1).jpg`.
 */
const FILENAME = /^[\w\-.,'’()[\]{}~ &+%#@!]{1,120}\.(jpe?g|png|gif|bmp|webp|svgz?|tiff?|ico|avif|heic)$/i;

/** The alt is just a generic noun for "an image" — conveys nothing. */
const PLACEHOLDER =
  /^(image|images|picture|pic|photo|photograph|graphic|graphics|img|figure|screen ?shot|untitled|placeholder|blank|spacer|divider|banner|thumbnail|icon|logo)\s*\d*$/i;

/** Redundant lead-in. Screen readers already announce "image".
 *  The colon form needs no leading space — "Image: chart" is as redundant as
 *  "Image of chart", and requiring `\s+` before `:` would miss it. */
const REDUNDANT =
  /^\s*(image|images|picture|photo|photograph|graphic|pic|img)(?:\s+(?:of|showing|shows|depicting|that shows)\b|\s*:\s*)/i;

/** An alt that is a bare URL. */
const URLISH = /^(https?:\/\/|www\.|\/\/)\S+$/i;

/**
 * Alt text a program wrote about the image, not a person.
 *
 * Word and PowerPoint fill `alt` in automatically when a picture is inserted,
 * and the result passes every other rule in this file: it is not a filename,
 * not a URL, not a bare placeholder noun, and comfortably over MIN_MEANINGFUL.
 * So "A screenshot of a computer" was trusted exactly as a written description
 * was, and an instructor was never told the difference. That is the single most
 * common way a document arrives here looking described and is not.
 *
 * `alert`, never `error`. The text might happen to be adequate, and this rule
 * cannot know — what it knows is that no person chose it for this image, which
 * is precisely the "route to human review" case the severity exists for.
 */

/** Office appends this verbatim. Nothing else does; no length test needed. */
const OFFICE_MARKER = /\bdescriptions?\s+automatically\s+generated\b/i;

/**
 * Office's stock openers, LENGTH-CAPPED so they only fire on the terse
 * generated form. "A screenshot of a computer" is machine output; "A screenshot
 * of the Canvas gradebook showing three unsubmitted assignments" is somebody
 * doing the job properly, and must not be dragged into the queue for starting
 * with the same four words.
 */
const OFFICE_STEM =
  /^\s*(?:graphical user interface|a picture containing|an?\s+(?:screenshot|close[-\s]?up)\s+of)\b/i;
const OFFICE_STEM_MAX_LENGTH = 45;

/** The comma-separated noun list Office emits: "Chart, bar chart". No verb, no sentence. */
const GENERIC_NOUN_LIST =
  /^(?:text|chart|diagram|table|icon|logo|shape|map|application|website|qr code|graphical user interface)(?:,\s*[a-z][a-z ]{1,20})+$/i;

function isMachineGenerated(text: string): boolean {
  if (OFFICE_MARKER.test(text)) return true;
  if (GENERIC_NOUN_LIST.test(text)) return true;
  return OFFICE_STEM.test(text) && text.length <= OFFICE_STEM_MAX_LENGTH;
}

/** Below this, a description cannot be doing real work — but short-yet-valid alt
 *  exists ("CEO", "Map"), so this is human-review, never a block. */
const MIN_MEANINGFUL = 6;

/** Category tracks severity: a definite failure reports under `error`, anything
 *  softer under `alert`. An `error`-severity issue filed as an `alert` would be
 *  under-counted by the WAVE-style report that groups on category. */
const issue = (
  id: string,
  severity: AuditIssue['severity'],
  message: string,
): AuditIssue => ({ id, severity, message, category: severity === 'error' ? 'error' : 'alert' });

/**
 * Judge one image's alt text. Returns `null` when there is nothing to say.
 *
 * Mirrors `runContrastIssue`: a pure `(input) => AuditIssue | null` the auditor
 * folds over, so it is fully unit-testable with no browser.
 */
export function altTextIssue(image: ImageAlt): AuditIssue | null {
  const { alt, presentation } = image;

  // An image marked decorative (role="presentation"/"none", or inside an
  // aria-hidden subtree) is removed from the accessibility tree — a screen
  // reader never announces its alt at all. Judging that alt's *quality* would
  // manufacture a badge-withholding error for text nobody will ever hear.
  // (The markup is sloppy, but it is not a WCAG 1.1.1 failure, and axe already
  // owns the aria-* rules that police role misuse.)
  if (presentation) return null;

  // Missing alt is axe's `image-alt` rule, already an error. Reporting it again
  // would double-count and mis-attribute what the remediation "fixed".
  if (alt === null) return null;

  const text = alt.trim();

  // alt="" is the CORRECT way to mark an image decorative. Not a defect.
  if (text === '') return null;

  if (altTextLength(text) > CANVAS_ALT_TEXT_MAX_LENGTH) {
    return issue(
      'alt-text-too-long',
      'error',
      `Alt text exceeds Canvas's ${CANVAS_ALT_TEXT_MAX_LENGTH}-character limit (${altTextLength(text)} characters).`,
    );
  }

  if (URLISH.test(text)) {
    return issue('alt-text-url', 'error', `Alt text is a URL ("${text}"), not a description of the image.`);
  }
  if (FILENAME.test(text)) {
    return issue(
      'alt-text-filename',
      'error',
      `Alt text is a filename ("${text}"), not a description of the image. A screen reader will read the filename aloud.`,
    );
  }
  if (PLACEHOLDER.test(text)) {
    return issue(
      'alt-text-placeholder',
      'error',
      `Alt text is a placeholder word ("${text}") and does not describe the image.`,
    );
  }
  if (REDUNDANT.test(text)) {
    return issue(
      'alt-text-redundant',
      'warning',
      `Alt text begins with redundant boilerplate ("${text}"). Screen readers already announce that this is an image — describe the content instead.`,
    );
  }
  if (isMachineGenerated(text)) {
    return issue(
      'alt-text-machine-generated',
      'alert',
      `Alt text ("${text}") looks automatically generated rather than written for this image. ` +
        'Confirm it says what the image actually shows.',
    );
  }
  if (text.length < MIN_MEANINGFUL) {
    return issue(
      'alt-text-too-short',
      'alert',
      `Alt text ("${text}") may be too short to describe the image. Confirm it conveys the same information as the image.`,
    );
  }
  return null;
}
