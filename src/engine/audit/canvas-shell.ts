/**
 * Single source of truth for the "Canvas-like" shell that wraps a gated HTML
 * fragment. Used by BOTH sides that must agree:
 *   1. the deterministic AUDIT — `createIframeRunner` (iframe-runner.ts) renders
 *      this exact document into a hidden same-origin iframe and scans it; and
 *   2. the PREVIEW / EXPORT — the renderer's sandboxed iframe `srcdoc` and the
 *      downloaded standalone file.
 *
 * Keeping ONE definition is what makes "what you see matches what was audited"
 * literally true. When the preview applied richer styling than the audit (its own
 * link/table/button/blockquote colors), contrast and structure could read fine in
 * the preview yet differ from the page the auditor actually scanned — so the audit
 * is the authority and the preview now mirrors it byte-for-byte.
 *
 * PURE: no imports, no DOM, no Node APIs — so the browser renderer can import this
 * module exactly as safely as the engine does.
 *
 * The CSS approximates Canvas's content styling that the canonical templates emit
 * (headings, links, tables, buttons, blockquotes): white page, #2d3b45 body text,
 * Helvetica Neue/Arial 16px/1.5, Canvas's link/heading/table/button colors.
 * Animations/transitions are disabled for deterministic, reproducible scans.
 */
export const CANVAS_SHELL_CSS = [
  '*,*::before,*::after{animation:none !important;transition:none !important;}',
  'body{margin:0;padding:16px;background:#ffffff;color:#2d3b45;',
  'font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;}',
  'h1,h2,h3,h4,h5,h6{color:#2d3b45;line-height:1.25;margin:1.2em 0 .4em;font-weight:700;}',
  'h1{font-size:1.75em;}h2{font-size:1.4em;}h3{font-size:1.2em;}h4{font-size:1.05em;}',
  'p{margin:0 0 1em;}',
  'a{color:#0374b5;text-decoration:underline;}',
  'ul,ol{margin:0 0 1em 1.6em;padding:0;}li{margin:.25em 0;}',
  'table{border-collapse:collapse;width:100%;margin:0 0 1em;}',
  // Canvas's content guide requires every table caption to be centered. The
  // compile step emits the same rule inline; keeping it here makes the audit
  // and the standalone preview agree even for a fragment supplied directly.
  'caption{text-align:center;font-weight:700;padding:.25em 0;}',
  'th,td{border:1px solid #c7cdd1;padding:8px 12px;text-align:left;vertical-align:top;}',
  'th{background:#f5f5f5;font-weight:600;}tbody tr:nth-child(even){background:#f2f2f2;}',
  'button,.btn,.Button{background:#0374b5;color:#ffffff;border:0;border-radius:4px;',
  'padding:8px 14px;font:inherit;cursor:pointer;}',
  'blockquote{margin:0 0 1em;padding:.5em 1em;border-left:4px solid #c7cdd1;color:#54616a;}',
  'img{max-width:100%;height:auto;}',
  'code,pre{font-family:ui-monospace,"SFMono-Regular",Consolas,Menlo,monospace;}',
  'hr{border:0;border-top:1px solid #c7cdd1;margin:1.5em 0;}',
  // oer2canvas addition: both the iframe runner and `wrapInCanvasShell` inject the
  // fragment into `<div id="b2c-content">`, so the audited content column needs the
  // width and padding a real Canvas page gives it. Upstream had no such element.
  //
  // THE ID MUST MATCH `wrapInCanvasShell` AND `iframe-runner.ts`. This rule is the
  // only thing that makes the audited column and a previewed column lay out the
  // same; if one side drifts to a different id, the fragment silently renders at
  // the full frame width on that side, and line length, wrapping and every
  // box-dependent axe measurement diverge between what was audited and what is
  // shown. Upstream enforced this with a preview/audit parity test that could not
  // be ported (see canvas-shell.test.ts); this comment now carries the invariant.
  '#b2c-content{max-width:1100px;padding:24px;}',
].join('');

/**
 * The selectors that address the shell DOCUMENT itself rather than something in
 * the fragment. In the audit these are two nested elements — `<body>` holding
 * `<div id="b2c-content">` — and in an in-page preview they are the single
 * element the fragment is mounted into, so both collapse onto the scope root.
 *
 * The consequence is deliberate and worth stating: `body`'s `padding:16px` and
 * the column's `padding:24px` land on one element, so the later rule wins and the
 * preview insets by 24px where the audit insets by 40px. Box parity was never
 * available anyway — the audit lays out in a 1280px frame and the app inside
 * the review column's 60rem — and the shell cannot fix that from here.
 */
const SHELL_DOCUMENT_SELECTORS: ReadonlySet<string> = new Set(['body', '#b2c-content'])

/**
 * `CANVAS_SHELL_CSS` rewritten to apply inside `root` instead of to a document.
 *
 * THIS EXISTS SO THE PREVIEW CANNOT DRIFT FROM THE AUDIT. The audit renders a
 * fragment as a whole document styled by the shell; the app renders the same
 * bytes as a div inside its own page, where none of those rules reach. Before
 * this, that div had no rule anywhere in the tree: publisher content inherited
 * the app's `system-ui` and ink while the audit measured Helvetica on white, and
 * links rendered at the user agent's `#0000EE` while the contrast the gate
 * reported was computed against Canvas's `#0374b5`. The preview was showing a
 * page that existed nowhere, and the gate's verdict described a page the
 * instructor never saw.
 *
 * Derived rather than hand-mirrored, and that is the whole point. A copy of the
 * four `body` declarations in a stylesheet would be correct exactly until
 * someone edited one side, which is the drift `canvas-shell.test.ts`'s PORT NOTE
 * warned about when it asked for the parity test to be restored "the moment a
 * preview lands". `preview-parity.browser.test.tsx` is that restoration, and it
 * compares COMPUTED styles — css text agreeing proves nothing about what a
 * browser resolves, and it is what the browser resolves that the audit measured.
 *
 * PURE, like everything else in this module: string in, string out, no DOM.
 */
export function canvasShellCssFor(root: string): string {
  return cssScopedTo(CANVAS_SHELL_CSS, root)
}

/**
 * The rewrite itself, over any flat stylesheet.
 *
 * Takes the css rather than closing over the constant so its rules can be stated
 * against inputs the shell does not currently contain — an at-rule, an unclosed
 * block — which is the only way the guards below are reachable from a test.
 */
export function cssScopedTo(css: string, root: string): string {
  return parseRules(css)
    .map(({ selectors, declarations }) => {
      const scoped = selectors.map((s) => (SHELL_DOCUMENT_SELECTORS.has(s) ? root : `${root} ${s}`))
      return `${scoped.join(',')}{${declarations}}`
    })
    .join('')
}

/**
 * Split a flat stylesheet into its rules.
 *
 * `CANVAS_SHELL_CSS` is deliberately flat — no at-rules, no nesting — so a brace
 * scan is sufficient and a css parser would be a dependency bought for nothing.
 * That flatness is an INVARIANT this function depends on, not an accident of the
 * current text, so it is asserted rather than assumed: an `@media`, `@supports`
 * or nested block would make the scan below produce silently wrong selectors,
 * and a preview styled by silently wrong css is exactly the failure this module
 * exists to prevent. Throwing sends whoever adds one straight here.
 */
function parseRules(css: string): { selectors: string[]; declarations: string }[] {
  if (css.includes('@')) {
    throw new Error('cssScopedTo cannot scope an at-rule; CANVAS_SHELL_CSS must stay flat')
  }
  const rules: { selectors: string[]; declarations: string }[] = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open === -1) break
    const close = css.indexOf('}', open)
    if (close === -1) {
      throw new Error('CANVAS_SHELL_CSS has an unclosed rule')
    }
    const selectors = css
      .slice(i, open)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    rules.push({ selectors, declarations: css.slice(open + 1, close) })
    i = close + 1
  }
  return rules
}

/**
 * Wrap a Canvas-safe fragment in the shared shell as a full HTML document. The
 * fragment is placed inside `#b2c-content` exactly as both the auditor's iframe
 * runner and a preview iframe's `srcdoc` consume it.
 *
 * DIVERGENCE FROM UPSTREAM: canvas-agent used `#content` here. oer2canvas uses
 * `#b2c-content` so this wrapper and `iframe-runner.ts` — the two places a fragment
 * is ever mounted — agree on the id, and therefore both pick up the content-column
 * rule in `CANVAS_SHELL_CSS`. Upstream kept them honest with a preview/audit parity
 * test that could not be ported (no preview renderer exists here yet); matching the
 * id is what preserves the guarantee that test enforced. Changing the id on one
 * side alone reintroduces exactly the drift the test existed to catch.
 */
export function wrapInCanvasShell(fragment: string): string {
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    // A non-empty <title> is REQUIRED: the auditor scans this exact document, and
    // WCAG 2.4.2 (axe `document-title`, impact serious → a badge-WITHHOLDING `error`
    // in the gate) fires on a title-less document — which would otherwise withhold
    // the badge on EVERY rendered fragment. The exported standalone file needs one too.
    '<title>Canvas content</title>' +
    `<style>${CANVAS_SHELL_CSS}</style></head>` +
    `<body><div id="b2c-content">${fragment}</div></body></html>`
  );
}
