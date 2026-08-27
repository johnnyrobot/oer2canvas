import { altTextIssue } from './alt-text';
import type { ImageAlt } from './types';

const img = (alt: string | null, over: Partial<ImageAlt> = {}): ImageAlt => ({
  alt,
  src: 'https://example.instructure.com/courses/1/files/9/preview',
  presentation: false,
  ...over,
});

// ── not our job: axe already owns these ───────────────────────────────────────

test('missing alt is NOT reported here — axe image-alt already blocks it', () => {
  // Double-reporting would inflate the issue count and mis-attribute "fixed".
  expect(altTextIssue(img(null))).toBe(null);
});

test('empty alt is the correct decorative marker — not an issue', () => {
  expect(altTextIssue(img(''))).toBe(null);
  expect(altTextIssue(img('', { presentation: true }))).toBe(null);
});

// ── filename-as-alt: the headline defect (WAVE misses this too) ───────────────

test('filename alt is an error — real failures found in shipped courses', () => {
  for (const alt of [
    'SPEED BUMP.jpg', // art103
    'giotto_ Chapel.jpg', // art103
    'ios-icon.png', // english-102-accessible-template (!)
    'DigitalLiteracy2.jpg', // digital-literacy-2016
    'Paul Burwick (1) (1).jpg', // cvc-oei
    "'The_Prophet',_woodcut_by_Emil_Nolde,_1912.jpg", // art103
    'banner_final_v2.PNG',
    'chart.jpeg',
    'diagram.svg',
    'photo.webp',
  ]) {
    const issue = altTextIssue(img(alt));
    // expected an issue for this alt
    expect(issue).toBeTruthy();
    expect(issue!.id).toBe('alt-text-filename');
    // must withhold the passed-checks badge
    expect(issue!.severity).toBe('error');
    // message should quote the offending alt
    expect(issue!.message.includes(alt)).toBeTruthy();
  }
});

test('a description that merely mentions a file extension is not a filename', () => {
  // Guards against a naive /\.\w{3}$/ rule firing on real prose.
  expect(altTextIssue(img('Screenshot of the settings page, showing the Export Course Content button'))).toBe(null);
  expect(altTextIssue(img('The .png versus .jpg tradeoff, illustrated with two sample images'))).toBe(null);
});

// ── placeholder / generic ─────────────────────────────────────────────────────

test('placeholder-word alt is an error', () => {
  for (const alt of ['image', 'Image', ' photo ', 'picture', 'untitled', 'placeholder', 'graphic', 'image1', 'Screenshot']) {
    const issue = altTextIssue(img(alt));
    // expected an issue for this alt
    expect(issue).toBeTruthy();
    expect(issue!.id).toBe('alt-text-placeholder');
    expect(issue!.severity).toBe('error');
  }
});

test('a URL as alt is an error', () => {
  const issue = altTextIssue(img('https://example.com/a/b'));
  expect(issue).toBeTruthy();
  expect(issue!.id).toBe('alt-text-url');
  expect(issue!.severity).toBe('error');
});

test("alt text over Canvas's 120-character limit is an error", () => {
  const issue = altTextIssue(img('A detailed description '.repeat(8)));
  expect(issue).toBeTruthy();
  expect(issue!.id).toBe('alt-text-too-long');
  expect(issue!.severity).toBe('error');
  expect(issue!.category).toBe('error');
  expect(issue!.message).toContain('120-character limit');
});

// ── redundant phrasing: real defect, but the alt still carries meaning ────────

test('redundant "image of" prefix is a warning, not a badge-withholding error', () => {
  for (const alt of ['image of a picture of a cat', 'Picture of the Sphinx at Giza', 'photo showing the lab bench']) {
    const issue = altTextIssue(img(alt));
    // expected an issue for this alt
    expect(issue).toBeTruthy();
    expect(issue!.id).toBe('alt-text-redundant');
    expect(issue!.severity).toBe('warning');
  }
});

// ── too short: judgment, so route to human review ─────────────────────────────

test('very short alt is an alert (human review), not an error', () => {
  const issue = altTextIssue(img('Map'));
  expect(issue).toBeTruthy();
  expect(issue!.id).toBe('alt-text-too-short');
  // short-but-valid alt exists (e.g. "CEO"); do not block on it
  expect(issue!.severity).toBe('alert');
});

// ── good alt passes ──────────────────────────────────────────────────────────

test('specific, descriptive alt passes', () => {
  for (const alt of [
    'Bar chart of BIO 101 enrollment rising each quarter, from about 70 students in Q1 to 160 in Q4.',
    'aerial view of football field during daytime', // real, from art103
    'Boldt Castle ~ Power House ~ 1000 Islands', // real, from art103
    'Stack of books in soft pastel colors.',
  ]) {
    // expected no issue for this alt
    expect(altTextIssue(img(alt))).toBe(null);
  }
});

test('category tracks severity so the WAVE-style report groups it correctly', () => {
  // An `error`-severity issue filed under `alert` would be under-counted by any
  // report that groups on category.
  const definite = altTextIssue(img('logo.png'));
  expect(definite).toBeTruthy();
  expect(definite!.severity).toBe('error');
  expect(definite!.category).toBe('error');

  const soft = altTextIssue(img('Map'));
  expect(soft).toBeTruthy();
  expect(soft!.severity).toBe('alert');
  expect(soft!.category).toBe('alert');
});

// ── decorative images are out of scope, however sloppy their markup ───────────

test('a decorative image is never judged on alt QUALITY', () => {
  // role="presentation" (or an aria-hidden ancestor) removes the image from the
  // accessibility tree — a screen reader never announces this alt at all, so
  // flagging it would withhold the badge over text nobody will ever hear.
  // Sloppy markup, yes; a WCAG 1.1.1 failure, no. axe owns the aria-* rules.
  expect(altTextIssue(img('SPEED BUMP.jpg', { presentation: true }))).toBe(null);
  expect(altTextIssue(img('image', { presentation: true }))).toBe(null);
  // ...but the identical alt on a NON-decorative image is still an error.
  expect(altTextIssue(img('SPEED BUMP.jpg'))?.id).toBe('alt-text-filename');
});

test('redundant prefix is caught with a colon and no space ("Image: chart")', () => {
  expect(altTextIssue(img('Image: chart of Q1 revenue'))?.id).toBe('alt-text-redundant');
  expect(altTextIssue(img('Photo:the lab bench at dusk'))?.id).toBe('alt-text-redundant');
});

// ── integration: the pass reaches the gate ───────────────────────────────────

test('the auditor folds alt-quality issues in after the contrast pass', async () => {
  const { createAuditor } = await import('./auditor');
  const runner = {
    run: async () => ({
      axe: { violations: [], incomplete: [] },
      textRuns: [],
      images: [
        { alt: 'SPEED BUMP.jpg', src: 'a.jpg', presentation: false },
        { alt: 'A speed bump on a residential street', src: 'b.jpg', presentation: false },
        { alt: '', src: 'divider.gif', presentation: true },
      ],
    }),
  };
  const { issues } = await createAuditor(runner)('<img>');
  // only the junk alt is reported — good alt and decorative alt="" are silent
  expect(issues.map((i) => [i.id, i.severity])).toEqual([['alt-text-filename', 'error']]);
});

test('a filename alt withholds the passed-checks badge (the hole this closes)', async () => {
  const { createAuditor } = await import('./auditor');
  const { enforceGate } = await import('../gate');
  const audit = createAuditor({
    run: async () => ({
      axe: { violations: [], incomplete: [] },
      textRuns: [],
      // What a small model might DRAFT via describe_image. Before this pass,
      // axe saw "alt is present" and the gate happily badged the page.
      images: [{ alt: 'ios-icon.png', src: 'ios-icon.png', presentation: false }],
    }),
  });
  const result = await enforceGate('<img src="ios-icon.png" alt="ios-icon.png">', {
    validateAllowlist: async (html) => ({ html, removedSemantic: [] }),
    audit,
  });
  expect(result.conformance.passedChecks).toBe(false);
  expect(result.badgeWithheld).toBe(true);
  expect(result.conformance.blockers[0]?.id).toBe('alt-text-filename');
});
