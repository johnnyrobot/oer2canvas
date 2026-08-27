import { createIframeRunner } from './iframe-runner'

test('reports an image with no alt as an axe violation', async () => {
  const runner = createIframeRunner()
  try {
    const result = await runner.run('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">')
    expect(result.axe.violations.some((v) => v.id === 'image-alt')).toBe(true)
  } finally {
    await runner.dispose()
  }
})

test('finds no violation in a clean fragment', async () => {
  const runner = createIframeRunner()
  try {
    const result = await runner.run('<h2>Title</h2><p>Some readable body text.</p>')
    expect(result.axe.violations).toHaveLength(0)
  } finally {
    await runner.dispose()
  }
})

test('extracts text runs with resolved foreground and background', async () => {
  const runner = createIframeRunner()
  try {
    const result = await runner.run('<p style="color:#999999">low contrast text</p>')
    expect(result.textRuns.length).toBeGreaterThan(0)
    const run = result.textRuns[0]!
    // The exact colour, not just /rgb/: a loose match would still pass if this read
    // `backgroundColor` instead of `color`, since `rgba(0, 0, 0, 0)` contains "rgb".
    expect(run.fg).toBe('rgb(153, 153, 153)')
    expect(run.background.kind).toBe('layers')
    // The shell paints an opaque white base, so the layer stack must bottom out
    // there — that base is what the contrast ratio is ultimately computed against.
    expect(run.background).toMatchObject({ layers: ['rgb(255, 255, 255)'] })
    expect(run.size).toBe('normal')
  } finally {
    await runner.dispose()
  }
})

// A wrong size class silently moves the AA threshold between 4.5:1 and 3:1, so it
// fails the same way an unresolvable background would: as a pass, not an error.
test('classifies text size against the WCAG large-text thresholds', async () => {
  const runner = createIframeRunner()
  try {
    const result = await runner.run(
      '<p style="font-size:24px">eighteen point</p>' +
        '<p style="font-size:19px;font-weight:700">fourteen point bold</p>' +
        '<p style="font-size:19px;font-weight:400">nineteen px normal weight</p>' +
        '<p style="font-size:16px">body copy</p>',
    )
    expect(result.textRuns.map((r) => r.size)).toEqual(['large', 'large', 'normal', 'normal'])
  } finally {
    await runner.dispose()
  }
})

test('skips text hidden by an ancestor rather than auditing it', async () => {
  const runner = createIframeRunner()
  try {
    // `getComputedStyle` on the <p> reports display:block and opacity:1 in both
    // cases — the element's own values, not the used ones. Auditing these would
    // raise a badge-withholding contrast error against text nobody can see, making
    // a chapter unpublishable for an invisible reason.
    const none = await runner.run('<div style="display:none"><p style="color:#eeeeee">x</p></div>')
    expect(none.textRuns).toHaveLength(0)

    const transparent = await runner.run('<div style="opacity:0"><p style="color:#eeeeee">x</p></div>')
    expect(transparent.textRuns).toHaveLength(0)

    const hidden = await runner.run('<div style="visibility:hidden"><p style="color:#eeeeee">x</p></div>')
    expect(hidden.textRuns).toHaveLength(0)

    // ...and still collects the visible sibling, so this is not just "collects nothing".
    const mixed = await runner.run('<div style="display:none"><p>hidden</p></div><p>visible</p>')
    expect(mixed.textRuns).toHaveLength(1)
  } finally {
    await runner.dispose()
  }
})

test('extracts images with their alt state', async () => {
  const runner = createIframeRunner()
  try {
    const result = await runner.run(
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="a cat">' +
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">',
    )
    expect(result.images).toHaveLength(2)
    expect(result.images![0]!.alt).toBe('a cat')
    expect(result.images![1]!.alt).toBe('')
  } finally {
    await runner.dispose()
  }
})

// The three alt states mean different things under WCAG 1.1.1, and `null` — no alt
// attribute at all — is the one that is an outright failure rather than a judgement
// call, so it must be distinguishable from the empty decorative marker.
test('distinguishes a missing alt attribute from an empty one, and flags presentation', async () => {
  const runner = createIframeRunner()
  const src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
  try {
    const result = await runner.run(
      `<img src="${src}">` +
        `<img src="${src}" alt="">` +
        `<img src="${src}" alt="" role="presentation">` +
        `<img src="${src}" alt="a cat" aria-hidden="true">`,
    )
    expect(result.images).toHaveLength(4)
    expect(result.images!.map((i) => i.alt)).toEqual([null, '', '', 'a cat'])
    expect(result.images!.map((i) => i.presentation)).toEqual([false, false, true, true])
    expect(result.images![0]!.src).toBe(src)
  } finally {
    await runner.dispose()
  }
})

// A background that cannot be reduced to a colour must be CLASSIFIED, never guessed:
// the auditor turns `unresolvable` into an alert, and a regression here would turn a
// genuine contrast failure into a silent pass. These two branches are the reason the
// `ResolvedBackground` union has an `unresolvable` arm at all.

test('a conic gradient behind text is unresolvable, not a guessed colour', async () => {
  const runner = createIframeRunner()
  try {
    const result = await runner.run('<p style="background:conic-gradient(red,blue)">text</p>')
    const bg = result.textRuns[0]!.background
    expect(bg.kind).toBe('unresolvable')
    expect(bg).toMatchObject({ reason: 'conic-gradient' })
  } finally {
    await runner.dispose()
  }
})

test('a CSS filter anywhere up the ancestor chain is unresolvable', async () => {
  const runner = createIframeRunner()
  try {
    // The filter is on an ANCESTOR, not on the text element: a filter repaints
    // everything beneath it, so the computed background colour of the text's own
    // box no longer describes what is actually rendered behind the glyphs.
    const result = await runner.run('<div style="filter:grayscale(1)"><p>text</p></div>')
    const bg = result.textRuns[0]!.background
    expect(bg.kind).toBe('unresolvable')
    expect(bg).toMatchObject({ reason: 'css-filter' })
  } finally {
    await runner.dispose()
  }
})

test('dispose is final — a later run rejects rather than allocating again', async () => {
  const runner = createIframeRunner()
  await runner.run('<p>x</p>')
  await runner.dispose()
  await expect(runner.run('<p>y</p>')).rejects.toThrow(/disposed/)
  // Finality is about the FRAME, not the rejection: prove the refused run allocated
  // nothing rather than merely that it threw.
  expect(document.querySelectorAll('iframe[title="accessibility audit surface"]')).toHaveLength(0)
})

test('dispose is idempotent and safe on a runner that never ran', async () => {
  const runner = createIframeRunner()
  await runner.dispose()
  await expect(runner.dispose()).resolves.toBeUndefined()
})

it('does not report contrast rows for MathML operator glyphs', async () => {
  // axe reports `color-contrast` INCOMPLETE on <mo> nodes — "content contains
  // only non-text characters" — which it cannot adjudicate. One section of
  // Algebra and Trigonometry has 1446 of them, and a needs-review row no human
  // can act on is exactly the noise that gets a queue abandoned.
  //
  // The operator MUST be U+2212 MINUS SIGN ('\u2212'), not ASCII '-' or '+'.
  // axe's own `color-contrast` `matches` stage strips ASCII punctuation
  // (including '+') from an element's visible text before it ever decides
  // whether the rule applies; with only punctuation left, the element fails
  // `matches` and the rule never runs — so a '+' fixture cannot fail this test
  // and cannot detect the exclusion below being removed. U+2212 falls outside
  // that punctuation strip and reaches axe's `nonBmp`/incomplete branch
  // instead, which is what this fix targets. It is also not a hypothetical:
  // the benchmark section's 1446 `<mo>` elements have 10 distinct contents,
  // and U+2212 is the one that appears 330 times.
  const runner = createIframeRunner()
  try {
    const math = '<math><semantics><mrow><mo>\u2212</mo><mn>1</mn></mrow></semantics></math>'
    const scan = await runner.run(`<p>text</p>${math.repeat(20)}`)
    const rows = [...(scan.axe.incomplete ?? []), ...scan.axe.violations]
    expect(rows.filter((r) => r.id === 'color-contrast')).toEqual([])
  } finally {
    await runner.dispose()
  }
})

it('still evaluates ordinary text, so the exclusion is narrow', async () => {
  const runner = createIframeRunner()
  try {
    const scan = await runner.run('<p style="color:#eee;background:#fff">invisible</p>')
    const rows = [...(scan.axe.incomplete ?? []), ...scan.axe.violations]
    expect(rows.some((r) => r.id === 'color-contrast')).toBe(true)
  } finally {
    await runner.dispose()
  }
})

// #19. A page the browser is not painting gets no rendering opportunities, so its
// `requestAnimationFrame` callbacks do not fire — ordinary specified behaviour for a
// hidden document, not an automation quirk. `run()` awaited one frame per section and
// `compileAndAuditChapter` awaits `run()` in a loop that must complete, so a chapter
// left in a backgrounded tab parked inside a single section indefinitely: 124 s in one
// measured run against ~2 s per section once released, no CPU burned while stalled.
//
// These two model the CONDITION, not the environment. A `requestAnimationFrame` that
// registers its callback and never invokes it IS a page receiving no frames, and it
// reproduces on demand — every attempt to reproduce the environment instead
// (`Emulation.setPageVisibilityState`, `Page.setWebLifecycleState`, occluding the
// window, a second Playwright page in front) failed, because Playwright keeps its
// pages visible and because the in-page probe used to observe the stall was itself
// enough to keep the page alive.

/**
 * Install a `requestAnimationFrame` that never calls back on the runner's frame, and
 * report how many times it was asked.
 *
 * The frame is allocated lazily by the first `run()`, so a run has to happen first;
 * `document.open()` reuses the frame's `Window`, which is what lets a stub installed
 * out here survive the per-run document rewrite.
 */
function starveOfFrames(): { requested: () => number } {
  const frame = document.querySelector<HTMLIFrameElement>(
    'iframe[title="accessibility audit surface"]',
  )!
  const win = frame.contentWindow as Window
  let requested = 0
  win.requestAnimationFrame = ((): number => ++requested) as typeof win.requestAnimationFrame
  return { requested: () => requested }
}

test('settles even when the frame is never given a rendering opportunity', async () => {
  const runner = createIframeRunner()
  try {
    await runner.run('<p>allocate the frame</p>')
    const starved = starveOfFrames()

    const outcome = await Promise.race([
      runner.run('<p style="color:#999999">x</p>').then(() => 'settled' as const),
      new Promise<'parked'>((resolve) => setTimeout(() => resolve('parked'), 2000)),
    ])

    // Asserted BEFORE the outcome: a stub that was never reached would let this test
    // report green against a runner that still parks.
    expect(starved.requested()).toBeGreaterThan(0)
    expect(outcome).toBe('settled')
  } finally {
    await runner.dispose()
  }
})

// The bound is only worth having if it costs nothing. This audit's verdicts are the
// product's whole claim, so a fallback that let a starved frame return a DIFFERENT
// answer — a contrast row that resolves against the wrong background, a size class
// that lands on the wrong side of the AA threshold — would be a worse bug than the
// stall it fixes, and a silent one. The fragment carries a case of each thing the
// frame could plausibly have been settling: resolved colours, both size classes, an
// ancestor-hidden run, an image, and MathML.
test('a starved frame returns the same verdict as a painted one', async () => {
  const html =
    '<h2>Title</h2>' +
    '<p style="color:#999999">low contrast body text</p>' +
    '<p style="font-size:24px">eighteen point</p>' +
    '<p style="font-size:19px;font-weight:700">fourteen point bold</p>' +
    '<div style="opacity:0"><p style="color:#eeeeee">hidden</p></div>' +
    '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">' +
    '<math><semantics><mrow><mo>\u2212</mo><mn>1</mn></mrow></semantics></math>'

  const runner = createIframeRunner()
  try {
    const painted = await runner.run(html)
    const starved = starveOfFrames()
    const unpainted = await runner.run(html)

    expect(starved.requested()).toBeGreaterThan(0)
    expect(unpainted).toEqual(painted)
  } finally {
    await runner.dispose()
  }
})
