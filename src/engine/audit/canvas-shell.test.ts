import { wrapInCanvasShell, CANVAS_SHELL_CSS, cssScopedTo } from './canvas-shell';

// PORT NOTE (oer2canvas): upstream's second test asserted byte-identical parity
// between `wrapInCanvasShell(frag)` and `previewSrcdoc(frag)` from
// `../../app/renderer/preview.js`. oer2canvas has no preview/export renderer yet,
// so that module does not exist here and the test cannot be ported without
// inventing one. It should be restored verbatim the moment a preview lands —
// parity between what is previewed and what is audited is the entire reason this
// shell is a single exported constant.
//
// One DELIBERATE DIVERGENCE from upstream follows from that gap. Upstream's
// `wrapInCanvasShell` mounted the fragment in `#content`; here it mounts in
// `#b2c-content`, the id `iframe-runner.ts` writes and the id the appended
// content-column CSS rule targets. With the parity test gone, nothing would have
// caught the two mount points drifting apart, and a preview built on `#content`
// would have missed the column rule entirely — laying out at the full frame width
// while the audit ran against a 1100px column. Matching the id keeps "what you see
// matches what was audited" true by construction rather than by a test we cannot
// run yet. The test below pins the id so a future edit cannot quietly split them.

test('the audited Canvas shell carries the full Canvas content CSS, not a bare body (§9a)', () => {
  // The audit must render with the SAME element styling the user sees, so contrast
  // is checked against the real link/table/button/blockquote colors — not a bare page.
  const css = CANVAS_SHELL_CSS;
  // bare-shell baseline (already audited before)
  expect(css).toMatch(/background:#ffffff/);
  expect(css).toMatch(/color:#2d3b45/);
  // element styling that previously ONLY the preview applied (the §9a gap)
  expect(css).toMatch(/a\{color:#0374b5/);
  expect(css).toMatch(/th\{background:#f5f5f5/);
  expect(css).toMatch(/button[^}]*background:#0374b5/);
  expect(css).toMatch(/blockquote\{[^}]*color:#54616a/);
});

test('the shell wraps the fragment in the audit document structure (#b2c-content)', () => {
  const doc = wrapInCanvasShell('<p>hi</p>');
  expect(doc).toMatch(/^<!DOCTYPE html><html lang="en">/);
  // Upstream asserted `#content`; see the PORT NOTE for why this is `#b2c-content`.
  expect(doc).toMatch(/<div id="b2c-content"><p>hi<\/p><\/div>/);
});

// oer2canvas addition, covering the one rule appended to the ported CSS.
test('the shell styles the content column both mount points use (#b2c-content)', () => {
  // `iframe-runner.ts` and `wrapInCanvasShell` both mount the fragment in
  // `<div id="b2c-content">`; without this rule the column runs the full frame
  // width, which is not the line length a student reads and not the box axe
  // measures. The rule and both mount points have to name the same id.
  expect(CANVAS_SHELL_CSS).toMatch(/#b2c-content\{[^}]*max-width:1100px/);
  expect(CANVAS_SHELL_CSS).toMatch(/#b2c-content\{[^}]*padding:24px/);
  expect(wrapInCanvasShell('<p>hi</p>')).toMatch(/id="b2c-content"/);
});

// --- Scoping the shell for the in-page preview -------------------------------
//
// The preview surfaces render gated html as a div inside the app's own page,
// where a stylesheet written for a document reaches nothing. `cssScopedTo`
// rewrites the shell to apply inside one element instead, which is what keeps
// `preview-parity.browser.test.tsx` green — and derives it rather than letting
// anyone hand-copy the declarations into `App.css`, where the two sides would
// drift the moment either was edited.

test('an at-rule is refused rather than silently mis-scoped', () => {
  // A brace scan cannot scope `@media`: it would emit `.x @media screen{...}`
  // and then treat the inner rule as a top-level one, producing css that is
  // wrong in a way no test of the CURRENT shell could ever notice, because the
  // shell has no at-rule today. The failure has to be loud at the moment
  // someone adds one — which is exactly when nobody is thinking about scoping.
  expect(() => cssScopedTo('@media screen{p{color:red;}}', '.x')).toThrow(/at-rule/)
})

test('the shell document selectors collapse onto the scope root', () => {
  // In the audit the fragment sits in `<body>` inside `<div id="b2c-content">`;
  // in the preview there is one element playing both parts, so both selectors
  // have to land on it. Pinned here because the browser parity test cannot see
  // it — that test compares typography and colour, and this is a box decision.
  const css = cssScopedTo('body{padding:16px;}#b2c-content{padding:24px;}p{margin:0;}', '.b2c-section-body')
  expect(css).toBe('.b2c-section-body{padding:16px;}.b2c-section-body{padding:24px;}.b2c-section-body p{margin:0;}')
})

test('a multi-selector rule scopes every selector, not just the first', () => {
  // `h1,h2,h3...` and `th,td` are the shell's shape. Prefixing only the first
  // would leave `td` matching every cell on the SCREEN, including the app's own
  // — publisher styling escaping into the interface that is judging it.
  expect(cssScopedTo('th,td{border:1px solid #c7cdd1;}', '.s')).toBe(
    '.s th,.s td{border:1px solid #c7cdd1;}',
  )
})
