/**
 * Unit tests for the pure axe→IssueSet mapping helpers (offline, no browser).
 * Strict TDD: these are written before the implementation.
 */
import { severityForImpact, semanticCategory, DEFAULT_VIOLATION_SEVERITY } from './mapping';

test('severityForImpact maps each axe impact per the frozen table', () => {
  expect(severityForImpact('critical')).toBe('blocker');
  expect(severityForImpact('serious')).toBe('error');
  expect(severityForImpact('moderate')).toBe('warning');
  expect(severityForImpact('minor')).toBe('advisory');
});

test('severityForImpact falls back to the default for null/undefined impact', () => {
  expect(severityForImpact(null)).toBe(DEFAULT_VIOLATION_SEVERITY);
  expect(severityForImpact(undefined)).toBe(DEFAULT_VIOLATION_SEVERITY);
  // The documented default is a definite-but-non-blocking 'error'.
  expect(DEFAULT_VIOLATION_SEVERITY).toBe('error');
});

test('semanticCategory: contrast rules → contrast', () => {
  expect(semanticCategory('color-contrast')).toBe('contrast');
  expect(semanticCategory('color-contrast-enhanced')).toBe('contrast');
});

test('semanticCategory: aria-* rules → aria', () => {
  expect(semanticCategory('aria-required-children')).toBe('aria');
  expect(semanticCategory('aria-valid-attr-value')).toBe('aria');
  expect(semanticCategory('aria-hidden-focus')).toBe('aria');
});

test('semanticCategory: heading/landmark/list/table structure rules → structure', () => {
  expect(semanticCategory('heading-order')).toBe('structure');
  expect(semanticCategory('region')).toBe('structure');
  expect(semanticCategory('landmark-one-main')).toBe('structure');
  expect(semanticCategory('list')).toBe('structure');
  expect(semanticCategory('listitem')).toBe('structure');
  expect(semanticCategory('td-headers-attr')).toBe('structure');
  expect(semanticCategory('th-has-data-cells')).toBe('structure');
});

test('semanticCategory: unclassified rules → undefined (caller defaults them)', () => {
  expect(semanticCategory('image-alt')).toBe(undefined);
  expect(semanticCategory('label')).toBe(undefined);
  expect(semanticCategory('document-title')).toBe(undefined);
  expect(semanticCategory('button-name')).toBe(undefined);
  expect(semanticCategory('link-name')).toBe(undefined);
});
