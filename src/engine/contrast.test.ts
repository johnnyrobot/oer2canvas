import { checkContrast } from './contrast';
import { parseGradientStops } from './contrast';

// ── Anchor ratios (WCAG 2.x relative-luminance formula) ──────────────────────

test('black on white is the maximum 21.0', () => {
  const r = checkContrast('#000000', '#ffffff');
  expect(r.ratio).toBe(21);
  expect(r.level).toBe('AAA');
  expect(r.passesAA).toBe(true);
  expect(r.passesAAA).toBe(true);
  expect(r.size).toBe('normal');
});

test('identical colors are the minimum 1.0 and fail', () => {
  const r = checkContrast('#abcdef', '#abcdef');
  expect(r.ratio).toBe(1);
  expect(r.level).toBe('fail');
  expect(r.passesAA).toBe(false);
  expect(r.passesAAA).toBe(false);
});

test('order of fg/bg does not change the ratio', () => {
  expect(checkContrast('#000', '#fff').ratio).toBe(checkContrast('#fff', '#000').ratio);
});

// ── Known mid pair + the 3.0 / 4.5 boundary via size sensitivity ─────────────
// Pure red on white = exactly 4.0 (L_red = 0.2126): a clean boundary anchor.

test('red on white is 4.0 — fails AA-normal but passes AA-large', () => {
  const normal = checkContrast('#ff0000', '#ffffff');
  expect(normal.ratio).toBe(4);
  expect(normal.level).toBe('fail'); // 4.0 < 4.5 normal threshold
  expect(normal.passesAA).toBe(false);

  const large = checkContrast('#ff0000', '#ffffff', 'large');
  expect(large.ratio).toBe(4);
  expect(large.level).toBe('AA'); // 4.0 ≥ 3.0 large-AA, < 4.5 large-AAA
  expect(large.passesAA).toBe(true);
  expect(large.passesAAA).toBe(false);
  expect(large.size).toBe('large');
});

// A ratio between 4.5 and 7.0 flips AA→AAA when treated as large text.
// #008000 (CSS "green") on white ≈ 5.14.

test('a 4.5–7.0 pair is AA for normal text but AAA for large text', () => {
  const normal = checkContrast('#008000', '#ffffff');
  expect(normal.ratio > 4.5 && normal.ratio < 7).toBeTruthy();
  expect(normal.level).toBe('AA');
  expect(normal.passesAA).toBe(true);
  expect(normal.passesAAA).toBe(false);

  const large = checkContrast('#008000', '#ffffff', 'large');
  expect(large.level).toBe('AAA'); // ≥ 4.5 large-AAA
  expect(large.passesAAA).toBe(true);
});

test('the classic #767676-on-white pair just passes AA-normal', () => {
  const r = checkContrast('#767676', '#ffffff');
  expect(r.ratio >= 4.5).toBeTruthy();
  expect(r.passesAA).toBe(true);
  expect(r.passesAAA).toBe(false);
  expect(r.level).toBe('AA');
});

// ── Parsing: shorthand hex, alpha hex, rgb()/rgba(), %, named colors ─────────

test('3-digit and 4-digit hex expand correctly (alpha ignored)', () => {
  expect(checkContrast('#000', '#fff').ratio).toBe(21);
  expect(checkContrast('#f00', '#fff').ratio).toBe(4);
  // #rgba / #rrggbbaa: alpha is ignored for the ratio.
  expect(checkContrast('#ff000080', '#ffffffff').ratio).toBe(4);
  expect(checkContrast('#f008', '#ffff').ratio).toBe(4);
});

test('rgb() and rgba() parse with integers and percentages', () => {
  expect(checkContrast('rgb(255,0,0)', 'rgb(255,255,255)').ratio).toBe(4);
  expect(checkContrast('rgba(255, 0, 0, 0.5)', 'white').ratio).toBe(4);
  expect(checkContrast('rgb(100%, 0%, 0%)', '#fff').ratio).toBe(4);
});

test('named CSS colors are parsed case-insensitively', () => {
  expect(checkContrast('red', 'white').ratio).toBe(4);
  expect(checkContrast('BLACK', 'White').ratio).toBe(21);
  expect(checkContrast('rebeccapurple', '#fff').ratio).toBe(checkContrast('#663399', '#fff').ratio);
});

// ── Invalid input throws ─────────────────────────────────────────────────────

test('invalid colors throw a clear Error', () => {
  expect(() => checkContrast('notacolor', '#fff')).toThrow(/color/i);
  expect(() => checkContrast('#12', '#fff')).toThrow(/color/i);
  expect(() => checkContrast('#gggggg', '#fff')).toThrow(/color/i);
  expect(() => checkContrast('rgb(300)', '#fff')).toThrow(/color/i);
  expect(() => checkContrast('', '#fff')).toThrow(/color/i);
});

test('transparent is rejected fail-safe (no defined contrast)', () => {
  expect(() => checkContrast('transparent', '#fff')).toThrow(/transparent|color/i);
});

test('a pair whose raw ratio is just below 4.5 fails AA even though it displays as 4.5', () => {
  // #767776 on white computes to ~4.496:1 (verified): displays as 4.5 after rounding,
  // but must FAIL the 4.5 threshold — the old round-before-compare wrongly passed it.
  const r = checkContrast('#767776', '#ffffff');
  expect(r.ratio).toBe(4.5);      // display value is rounded to 2dp
  expect(r.passesAA).toBe(false); // raw 4.496 < 4.5 → fail
  expect(r.level).toBe('fail');
});

test('parseGradientStops extracts colors and drops the direction token', () => {
  expect(
    parseGradientStops('linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)'),
  ).toEqual(['90deg', 'rgb(255, 0, 0)', 'rgb(0, 0, 255)']);
});

test('parseGradientStops handles "to <side>", hex, named colors, and radial', () => {
  expect(parseGradientStops('linear-gradient(to right, #fff, #000)')).toEqual(['to', '#fff', '#000']);
  expect(parseGradientStops('radial-gradient(circle, red, blue 80%)')).toEqual(['circle', 'red', 'blue']);
});

test('parseGradientStops returns [] for non-gradients and conic gradients', () => {
  expect(parseGradientStops('url("x.png")')).toEqual([]);
  expect(parseGradientStops('conic-gradient(red, blue)')).toEqual([]);
});

import { parseColorAlpha, compositeLayers } from './contrast';

test('parseColorAlpha reads alpha from rgba, hex8, and treats transparent as a=0', () => {
  expect(parseColorAlpha('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  expect(parseColorAlpha('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 });
  expect(parseColorAlpha('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  expect(parseColorAlpha('#fff').a).toBe(1);
});

test('compositeLayers folds a 50% black overlay onto white to mid-grey', () => {
  // top→bottom: a 50%-alpha black over the opaque white base → rgb(128,128,128) (rounded).
  expect(compositeLayers(['rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)'])).toBe('rgb(128, 128, 128)');
});

test('compositeLayers returns the single opaque layer unchanged', () => {
  expect(compositeLayers(['#ffffff'])).toBe('rgb(255, 255, 255)');
  expect(compositeLayers(['rgb(20, 40, 60)'])).toBe('rgb(20, 40, 60)');
});

test('black on white is 21', () => {
  expect(checkContrast('#000000', '#ffffff').ratio).toBe(21)
})

test('identical colors are 1', () => {
  expect(checkContrast('#777', '#777').ratio).toBe(1)
})

test('a ratio between 3.0 and 4.5 fails AA-normal but passes AA-large', () => {
  // #ff0000 on #ffffff has a raw ratio of ~3.9985 (rounds to 4), which sits
  // strictly between the large (3.0) and normal (4.5) AA thresholds -- the
  // band where the two thresholds actually disagree.
  const normal = checkContrast('#ff0000', '#ffffff')
  expect(normal.ratio).toBe(4)
  expect(normal.passesAA).toBe(false)

  const large = checkContrast('#ff0000', '#ffffff', 'large')
  expect(large.ratio).toBe(4)
  expect(large.passesAA).toBe(true)
})

test('transparent is rejected fail-safe rather than scored as passing', () => {
  expect(() => checkContrast('#000', 'transparent')).toThrow()
})
