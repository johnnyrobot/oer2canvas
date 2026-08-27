import { runContrastIssue } from './run-contrast';
import type { TextRun } from './types';

const OPTS = { failSeverity: 'blocker' as const, imageFailSeverity: 'warning' as const, gradientSamples: 9 };
const run = (over: Partial<TextRun>): TextRun => ({ fg: '#000000', size: 'normal', background: { kind: 'layers', layers: ['#ffffff'] }, ...over });

test('solid layers: passing pair → null, failing pair → blocker', () => {
  expect(runContrastIssue(run({ fg: '#000000' }), OPTS)).toBe(null);
  const issue = runContrastIssue(run({ fg: '#999999' }), OPTS);
  expect(issue?.severity).toBe('blocker');
  expect(issue?.category).toBe('contrast');
  expect(issue?.message ?? '').toMatch(/2\.85/);
});

test('layers: a 50% black overlay on white is composited before checking', () => {
  // white text on (black@50% over white)=grey(128) → fails → blocker.
  const issue = runContrastIssue(run({ fg: '#ffffff', background: { kind: 'layers', layers: ['rgba(0,0,0,0.5)', 'rgb(255,255,255)'] } }), OPTS);
  expect(issue?.severity).toBe('blocker');
});

test('gradient: worst-case stop drives the verdict and blocks', () => {
  const issue = runContrastIssue(run({ fg: '#000000', background: { kind: 'gradient', css: 'linear-gradient(90deg, #ffffff, #222222)' } }), OPTS);
  expect(issue?.severity).toBe('blocker');
  expect(issue?.message ?? '').toMatch(/gradient/i);
});

test('gradient: a uniformly high-contrast gradient passes (null)', () => {
  expect(runContrastIssue(run({ fg: '#000000', background: { kind: 'gradient', css: 'linear-gradient(90deg, #ffffff, #f0f0f0)' } }), OPTS)).toBe(null);
});

test('gradient: a translucent dark stop is composited over the base — light text BLOCKS, not a 21:1 fail-OPEN', () => {
  // Regression guard (Jun-15 fix). Pre-fix this dropped each stop's alpha → opaque
  // black → white text scored ~21:1 and PASSED. Composited over the opaque base,
  // the transparent end flattens to white, so white text fails and the gate blocks.
  const issue = runContrastIssue(
    run({ fg: '#ffffff', background: { kind: 'gradient', css: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0))' } }),
    OPTS,
  );
  expect(issue?.severity).toBe('blocker');
  expect(issue?.message ?? '').toMatch(/gradient/i);
});

test('gradient: dark text over the same translucent gradient still passes (no over-blocking)', () => {
  expect(
    runContrastIssue(run({ fg: '#000000', background: { kind: 'gradient', css: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0))' } }), OPTS),
  ).toBe(null);
});

test('image: a failing worst-case swatch is a WARNING by default, with estimate wording', () => {
  const issue = runContrastIssue(run({ fg: '#ffffff', background: { kind: 'image', swatches: ['rgb(240, 240, 240)'] } }), OPTS);
  expect(issue?.severity).toBe('warning');
  expect(issue?.message ?? '').toMatch(/estimated from rendered pixels/i);
});

test('unresolvable → alert; transparent text → alert', () => {
  expect(runContrastIssue(run({ background: { kind: 'unresolvable', reason: 'css filter' } }), OPTS)?.severity).toBe('alert');
  expect(runContrastIssue(run({ fg: 'transparent' }), OPTS)?.severity).toBe('alert');
});

test('unparseable gradient → alert (needs review)', () => {
  expect(runContrastIssue(run({ background: { kind: 'gradient', css: 'conic-gradient(red, blue)' } }), OPTS)?.severity).toBe('alert');
});

test('large text uses the 3:1 minimum (passes where normal text would fail)', () => {
  // ~3.95:1 pair: passes large (≥3.0), fails normal (<4.5).
  expect(runContrastIssue(run({ fg: '#808080', size: 'large' }), OPTS)).toBe(null);
  expect(runContrastIssue(run({ fg: '#808080', size: 'normal' }), OPTS)?.severity).toBe('blocker');
});

test('unparseable fg → alert (needs review)', () => {
  expect(runContrastIssue(run({ fg: 'var(--color)' }), OPTS)?.severity).toBe('alert');
});

test('image with no usable swatches → alert', () => {
  expect(runContrastIssue(run({ background: { kind: 'image', swatches: [] } }), OPTS)?.severity).toBe('alert');
});
