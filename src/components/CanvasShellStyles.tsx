import { canvasShellCssFor } from '../engine/audit/canvas-shell'

/**
 * The Canvas shell's own styling, scoped to the element the app mounts gated
 * html into.
 *
 * THE SELECTOR MUST MATCH THE CLASS ON THAT ELEMENT. `ChapterView` and
 * `QueueView` are the only two places a compiled fragment is ever rendered on
 * screen, and both mount it into `.b2c-section-body`; if one of them renames its
 * container without renaming this, that surface silently loses every shell rule
 * and goes back to showing publisher content in the app's own typeface — the
 * exact drift `preview-parity.browser.test.tsx` exists to catch. That test
 * covers both surfaces for this reason.
 *
 * Computed ONCE at module scope, not per render: the css is a pure function of a
 * constant, so recomputing it per render would rebuild the same string on every
 * keystroke in the queue.
 */
const PREVIEW_ROOT = '.b2c-section-body'
const SHELL_CSS =
  canvasShellCssFor(PREVIEW_ROOT) +
  // Defense in depth for already-compiled or restored sessions: paint/layout
  // containment makes this root the containing block for fixed descendants and
  // clips their paint to the textbook preview. Publisher content therefore
  // cannot cover the app's navigation or credential controls even if old bytes
  // predate the positional-style filter in the allowlist gate.
  `${PREVIEW_ROOT}{contain:layout paint;isolation:isolate;position:relative;overflow:auto;}`

/**
 * Rendered by whichever preview surface is on screen. Exactly one of them is
 * mounted at a time — `App` routes between the queue and the handoff — so this
 * puts exactly one `<style>` in the document rather than one per section.
 */
export function CanvasShellStyles() {
  return <style>{SHELL_CSS}</style>
}
