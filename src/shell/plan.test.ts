import type { CompiledChapter, CompiledSection } from '../contracts/index'
import { buildPlan, commitLabel, reRunBehaviour } from './plan'
import type { Destination } from './phases'

const CANVAS: Destination = { kind: 'canvas', courseId: 7, courseName: 'Intro Algebra' }
const CARTRIDGE: Destination = { kind: 'cartridge' }

const section = (id: string, over: Partial<CompiledSection> = {}): CompiledSection => ({
  id, title: `Section ${id}`, html: `<p>${id}</p>`, notes: [], queue: [], ...over,
})

const chapter = (title: string, sections: CompiledSection[]): CompiledChapter => ({
  chapter: { title } as CompiledChapter['chapter'], sections, queue: [],
})

// The correction that matters. `compile` emits one section per page, so a
// chapter of twelve sections is twelve Canvas pages — a summary saying "1 page"
// would understate a real push by an order of magnitude.
test('counts PAGES per section, not per chapter', () => {
  const plan = buildPlan(
    [chapter('Ch 1', [section('a'), section('b'), section('c')]), chapter('Ch 2', [section('d')])],
    CARTRIDGE, 0,
  )
  expect(plan.chapterCount).toBe(2)
  expect(plan.pageCount).toBe(4)
  expect(plan.summary).toBe('2 chapters become 4 pages in a cartridge file.')
})

test('the summary names the course when Canvas is the destination', () => {
  const plan = buildPlan([chapter('Ch 1', [section('a')])], CANVAS, 0)
  expect(plan.summary).toBe('1 chapter becomes 1 page in Intro Algebra.')
})

// A section that failed to compile emits nothing, so making it a page would
// create an empty one in a live course.
test('a failed section becomes no page, and is counted as left out', () => {
  const plan = buildPlan(
    [chapter('Ch 1', [section('a'), section('b', { error: 'boom', html: '' })])],
    CARTRIDGE, 0,
  )
  expect(plan.pageCount).toBe(1)
  expect(plan.groups[0]!.failed).toBe(1)
  expect(plan.blockers).toContain('1 section failed to compile and would be left out.')
})

// THE PLAN MAY NOT SILENTLY GUESS. Canvas collisions need the course's page
// list; without it, "new" would be a claim the app cannot support.
test('Canvas pages read unknown until the course page list is loaded', () => {
  const plan = buildPlan([chapter('Ch 1', [section('a')])], CANVAS, 0)
  expect(plan.groups[0]!.pages[0]!.status).toEqual({ kind: 'unknown', reason: 'not-loaded' })
})

test('a cartridge has no course to collide with, so its pages are simply new', () => {
  const plan = buildPlan([chapter('Ch 1', [section('a')])], CARTRIDGE, 0)
  expect(plan.groups[0]!.pages[0]!.status).toEqual({ kind: 'new' })
})

// D5 stated where the commit is refused, not only in the sidebar: a button that
// refuses without saying why is how a user concludes the app is broken.
test('an unanswered queue blocks the commit and says how many', () => {
  const plan = buildPlan([chapter('Ch 1', [section('a')])], CARTRIDGE, 4)
  expect(plan.blockers).toContain('4 items still need answers.')
  expect(buildPlan([chapter('Ch 1', [section('a')])], CARTRIDGE, 1).blockers)
    .toContain('1 item still needs answers.')
})

// A section with no `gate` has not been audited, which is a different thing from
// one that was audited and failed — and the plan says which.
test('an unaudited selection is blocked, and says so in those words', () => {
  expect(buildPlan([chapter('Ch 1', [section('a')])], CARTRIDGE, 0).blockers)
    .toEqual(['1 chapter has not finished its checks.'])
})

test('no destination is itself a blocker', () => {
  expect(buildPlan([chapter('Ch 1', [section('a')])], undefined, 0).blockers)
    .toContain('Choose where this goes first.')
})

// MEASURED on a live Canvas, with both importers: a second import of the same
// file produced 8 pages and 8 pages, no duplicates, `updated_at` untouched. This
// test used to assert the opposite, because the PRD asserted an "asymmetry
// inherent to the format" that nobody had checked. Both destinations update.
test('both destinations state that re-running updates, in the indicative', () => {
  const canvas = reRunBehaviour(CANVAS)!
  const cartridge = reRunBehaviour(CARTRIDGE)!

  expect(canvas.text).toContain('updates in place')
  expect(cartridge.text).toContain('updates the pages it created')

  /*
   * Assert the CLAIM, never scan for words — a lesson learned twice in a row
   * here. A ban on "duplicat" flagged the cartridge line, which says "rather
   * than duplicating them"; a ban on "second cop(y|ies)" then flagged the Canvas
   * line, which says "no second copies are created". Both were denials of the
   * very thing being banned. Only the falsified assertion itself is forbidden.
   */
  for (const b of [canvas, cartridge]) {
    expect(b.tone).toBe('info')
    expect(b.text).not.toMatch(/never updates/i)
    // The hedge this screen exists to avoid.
    expect(b.text).not.toMatch(/\bmay\b|\bmight\b|\bcould\b/)
  }
})

test('the commit button names the count and the destination', () => {
  expect(commitLabel(CANVAS, 36)).toBe('Push 36 pages to Intro Algebra')
  expect(commitLabel(CARTRIDGE, 1)).toBe('Download cartridge — 1 page')
})

// The counts above notice an unanswered queue and a failed compile, but say
// nothing about a section whose
// audit found a DEFINITE WCAG failure. Without `isPublishable`, a chapter with a
// real blocker and an empty queue exports clean.
test('a chapter with accessibility blockers cannot be committed', () => {
  const blocked: CompiledChapter = {
    chapter: { title: 'Ch 1' } as CompiledChapter['chapter'],
    sections: [{
      ...section('a'),
      gate: {
        html: '<p>a</p>',
        conformance: {
          passedChecks: false,
          blockers: [{ id: 'image-alt', message: 'Image has no alt', severity: 'blocker' }],
          warnings: [], needsHumanReview: [],
        },
        badgeWithheld: true,
      } as CompiledSection['gate'],
    }],
    queue: [],
  }
  expect(buildPlan([blocked], CARTRIDGE, 0).blockers)
    .toContain('1 chapter has accessibility blockers that must be fixed first.')
})

// ...and the inverse, so the rule is not just "always refuse".
test('a fully audited clean chapter commits', () => {
  const clean: CompiledChapter = {
    chapter: { title: 'Ch 1' } as CompiledChapter['chapter'],
    sections: [{
      ...section('a'),
      gate: {
        html: '<p>a</p>',
        conformance: { passedChecks: true, blockers: [], warnings: [], needsHumanReview: [] },
        badgeWithheld: false,
      } as CompiledSection['gate'],
    }],
    queue: [],
  }
  expect(buildPlan([clean], CARTRIDGE, 0).blockers).toEqual([])
})

/*
  §2.4's whole purpose, arriving on the screen that needed it. The Destination
  screen loads the course's existing pages FIRST so this screen can say, before
  anything is sent, which of them a push would land on top of.
*/
test('a page whose slug already exists in the course reads as an overwrite', () => {
  const plan = buildPlan(
    [chapter('Chapter 1', [section('a', { title: 'Introduction' }), section('b', { title: 'Polynomials' })])],
    CANVAS, 0,
    [{ url: 'chapter-1-introduction', title: 'Introduction' }, { url: 'syllabus', title: 'Syllabus' }],
  )
  expect(plan.groups[0]!.pages.map((p) => [p.title, p.status.kind])).toEqual([
    ['Introduction', 'overwrite'],
    ['Polynomials', 'new'],
  ])
})

test('the summary says how many pages a push would overwrite', () => {
  const plan = buildPlan(
    [chapter('Chapter 1', [section('a', { title: 'Introduction' }), section('b', { title: 'Polynomials' })])],
    CANVAS, 0,
    [{ url: 'chapter-1-introduction', title: 'Introduction' }],
  )
  expect(plan.summary).toContain('1 would overwrite a page already in Intro Algebra')
})

// The rule this screen has held since it was written: it may not silently guess.
test('without the course page list, Canvas collisions stay unknown rather than optimistic', () => {
  const plan = buildPlan([chapter('Chapter 1', [section('a')])], CANVAS, 0)
  expect(plan.groups[0]!.pages[0]!.status.kind).toBe('unknown')
})

test('an empty course page list is knowledge, not absence — everything is new', () => {
  const plan = buildPlan([chapter('Chapter 1', [section('a')])], CANVAS, 0, [])
  expect(plan.groups[0]!.pages[0]!.status.kind).toBe('new')
})

/*
  A page Canvas named itself — `1-dot-4-polynomials`, from a previous push — is
  still this section's page, and the plan has to say so. Matching on our own slug
  alone would call it `new` and then quietly create a duplicate.
*/
test('recognises a page a previous push created under a url Canvas invented', () => {
  const plan = buildPlan(
    [chapter('Chapter 1', [section('a', { title: '1.4 Polynomials' })])],
    CANVAS, 0,
    [{ url: '1-dot-4-polynomials', title: '1.4 Polynomials' }],
  )
  expect(plan.groups[0]!.pages[0]!.status.kind).toBe('overwrite')
})

// Two sections titled "Introduction" and two pages that could be either: the
// plan refuses rather than promising an overwrite it cannot identify.
test('an ambiguous match is reported as unknown, never as an overwrite', () => {
  const plan = buildPlan(
    [
      chapter('Chapter 1', [section('a', { title: 'Introduction' })]),
      chapter('Chapter 2', [section('b', { title: 'Introduction' })]),
    ],
    CANVAS, 0,
    [{ url: 'introduction', title: 'Introduction' }, { url: 'introduction-2', title: 'Introduction' }],
  )
  expect(plan.groups.flatMap((g) => g.pages).map((p) => p.status.kind)).toEqual(['unknown', 'unknown'])
})

/*
  `unknown` now has two causes and they call for different words. "Existing pages
  couldn't be loaded" is a network problem the user can retry; an ambiguous match
  is a course whose pages this app cannot tell apart, where retrying changes
  nothing. Saying the first when the second is true sends someone to check a
  connection that is fine.
*/
// Direct push has no file-upload path at all (`src/canvas/client.ts` writes
// only `wiki_page.body`), so a page carrying a packaged image reference would
// import into Canvas broken. Cartridge export is the only route that carries
// the bytes with it.
const chapterWithAsset = (title: string, sections: CompiledSection[]): CompiledChapter => ({
  chapter: {
    title,
    assets: [{ id: 'a', mediaType: 'image/png', extension: 'png', bytes: new Uint8Array(), sha256: 'a', name: 'a.png' }],
    // The bare `{ title }` cast used elsewhere in this file loses its "T
    // assignable to S" escape hatch once `assets` is added, because
    // `Chapter['assets']` is optional and readonly while the literal's
    // inferred type is neither — `unknown` is the honest way to say this test
    // double intentionally only fills in the two fields `buildPlan` reads.
  } as unknown as CompiledChapter['chapter'],
  sections,
  queue: [],
})

test('a canvas destination blocks while an import carries packaged assets', () => {
  const plan = buildPlan([chapterWithAsset('Ch 1', [section('a')])], CANVAS, 0)
  expect(plan.blockers.some((blocker) => /cartridge/i.test(blocker))).toBe(true)
})

test('cartridge export is unblocked with packaged assets', () => {
  const plan = buildPlan([chapterWithAsset('Ch 1', [section('a')])], CARTRIDGE, 0)
  expect(plan.blockers.some((blocker) => /image/i.test(blocker))).toBe(false)
})

test('a canvas destination is unaffected when nothing is packaged', () => {
  const plan = buildPlan([chapter('Ch 1', [section('a')])], CANVAS, 0)
  expect(plan.blockers.some((blocker) => /image/i.test(blocker))).toBe(false)
})

// The block is permanent — it was a considered trade against rewriting audited
// html after the gate, not a placeholder waiting on a design. The message must
// name the real remedy (cartridge export) and never suggest this is temporary.
test('the push blocker does not describe itself as temporary', () => {
  const plan = buildPlan([chapterWithAsset('Ch 1', [section('a')])], CANVAS, 0)
  const blocker = plan.blockers.find((b) => /image/i.test(b))!
  expect(blocker).toMatch(/cartridge/i)
  expect(blocker).not.toMatch(/yet|for now|currently|not supported yet/i)
})

test('an unknown status carries why it is unknown', () => {
  const notLoaded = buildPlan([chapter('Chapter 1', [section('a')])], CANVAS, 0)
  expect(notLoaded.groups[0]!.pages[0]!.status).toEqual({ kind: 'unknown', reason: 'not-loaded' })

  const ambiguous = buildPlan(
    [
      chapter('Chapter 1', [section('a', { title: 'Introduction' })]),
      chapter('Chapter 2', [section('b', { title: 'Introduction' })]),
    ],
    CANVAS, 0,
    [{ url: 'introduction', title: 'Introduction' }, { url: 'introduction-2', title: 'Introduction' }],
  )
  expect(ambiguous.groups[0]!.pages[0]!.status).toEqual({ kind: 'unknown', reason: 'ambiguous' })
})
