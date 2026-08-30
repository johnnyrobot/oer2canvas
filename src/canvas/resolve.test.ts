import type { CompiledChapter, CompiledSection } from '../contracts/index'
import { pageTargets } from '../engine/export/page-identity'
import { resolveTargets } from './resolve'

const section = (id: string, title: string): CompiledSection => ({
  id, title, html: `<p>${id}</p>`, notes: [], queue: [],
})
const chapter = (title: string, sections: CompiledSection[]): CompiledChapter => ({
  chapter: { title } as CompiledChapter['chapter'], sections, queue: [],
})

const ONE = pageTargets([chapter('Chapter 1', [section('a', 'Introduction'), section('b', '1.4 Polynomials')])])
const TWO = pageTargets([
  chapter('Chapter 1', [section('a', 'Introduction')]),
  chapter('Chapter 2', [section('b', 'Introduction')]),
])

const page = (url: string, title: string) => ({ url, title })

/*
  MEASURED 2026-08-23 on a live Canvas, and it is why this module exists:
  `PUT /courses/:id/pages/:url` does NOT create a page at `:url`. Canvas derives
  every page url from the TITLE and ignores `wiki_page[url]` on both POST and
  PUT — so a PUT aimed at a url that does not exist creates a SECOND page
  ("alpha-title", then "alpha-title-2"). The only way to update in place is to
  aim at a url Canvas already has.
*/
test('a page the cartridge created is recognised by its slug, and updated in place', () => {
  const resolved = resolveTargets(ONE, [page('chapter-1-introduction', 'Introduction')])
  expect(resolved[0]!.existingUrl).toBe('chapter-1-introduction')
  expect(resolved[1]!.existingUrl).toBeUndefined()
})

test('a page a previous push created is recognised by its title, at Canvas’s own url', () => {
  // Canvas turned "1.4 Polynomials" into this on the way in. We never chose it.
  const resolved = resolveTargets(ONE, [page('1-dot-4-polynomials', '1.4 Polynomials')])
  expect(resolved[1]!.existingUrl).toBe('1-dot-4-polynomials')
})

test('nothing in the course means everything is created, and nothing is aimed at a stale url', () => {
  const resolved = resolveTargets(ONE, [])
  expect(resolved.map((r) => r.existingUrl)).toEqual([undefined, undefined])
})

/*
  Two sections that want ONE title, and one page that could be either: a coin
  toss, refused. Claiming it for the first because it comes first is a guess
  dressed as an ordering rule.

  The two sections are in the SAME chapter, which is the only way this arises
  now. It used to be written with one section from each of two chapters, but a
  target's title carries its chapter since 2026-08-30, so two chapters can no
  longer want one title — that is the point of the qualification, and the
  cross-chapter case is covered by its own test below. Same-titled sections
  within a chapter are anticipated elsewhere in this module: `pageTargetsByChapter`
  already de-duplicates their slugs.
*/
test('one page that two sections could both own is claimed by neither', () => {
  const twins = pageTargets([
    chapter('Chapter 1', [section('a', 'Introduction'), section('b', 'Introduction')]),
  ])
  // A url Canvas invented, so neither section's slug matches and only the title is left.
  const resolved = resolveTargets(twins, [page('introduction-xyz', 'Chapter 1 Introduction')])
  expect(resolved.map((r) => r.existingUrl)).toEqual([undefined, undefined])
  expect(resolved.map((r) => r.ambiguous)).toEqual([true, true])
})

// An existing page must never become the destination for two sections at once:
// the second write would silently overwrite the first, and a chapter would lose
// a page with nothing anywhere reporting it.
test('a page already claimed by slug is not claimed again by title', () => {
  const resolved = resolveTargets(TWO, [
    page('chapter-1-introduction', 'Introduction'),
  ])
  expect(resolved[0]!.existingUrl).toBe('chapter-1-introduction')
  expect(resolved[1]!.existingUrl).toBeUndefined()
  const urls = resolved.map((r) => r.existingUrl).filter(Boolean)
  expect(new Set(urls).size).toBe(urls.length)
})

/*
  The honest limit of title matching. Two sections titled "Introduction" and two
  existing pages titled "Introduction" that carry NEITHER of our slugs: there is
  no evidence in the course saying which is which, so the match is a coin toss
  and is refused rather than guessed.
*/
test('refuses to guess when two same-titled pages could each be the target', () => {
  // One wanting section, two free pages carrying its title. Which one is it?
  // Unanswerable, so neither is touched. (Two pages can share a title in Canvas
  // even though they cannot share a url.)
  const one = pageTargets([chapter('Chapter 1', [section('a', 'Introduction')])])
  const resolved = resolveTargets(one, [
    page('introduction', 'Chapter 1 Introduction'),
    page('introduction-2', 'Chapter 1 Introduction'),
  ])
  expect(resolved.map((r) => r.ambiguous)).toEqual([true])
  expect(resolved.map((r) => r.existingUrl)).toEqual([undefined])
})

test('a slug match settles what a title match could not', () => {
  const resolved = resolveTargets(TWO, [
    page('chapter-1-introduction', 'Introduction'),
    page('chapter-2-introduction', 'Introduction'),
  ])
  expect(resolved.map((r) => r.existingUrl)).toEqual([
    'chapter-1-introduction',
    'chapter-2-introduction',
  ])
  expect(resolved.some((r) => r.ambiguous)).toBe(false)
})

/*
  THE BUG AN OPERATOR HIT, 2026-08-30: pushing chapter 2 in a SEPARATE run
  overwrote chapter 1's "Introduction".

  Within one run it was already safe — two sections want the title, so the
  matcher above calls it ambiguous and creates both. Across runs there is only
  one wanting section and one free page, which reads as a clean identification
  and is not one: the free page belongs to a different chapter. Canvas derives
  the url from the TITLE (see the measurement above), so chapter 1's push left a
  page at `introduction` that chapter 2 then claimed.

  The fix is that a target's title now carries its chapter, so the two chapters
  no longer want the same title at all.
*/
test('a page from another chapter is not claimed by a same-named section pushed later', () => {
  const chapterTwoAlone = pageTargets([chapter('Chapter 2', [section('b', 'Introduction')])])
  // What chapter 1's earlier push left behind, at the url Canvas chose for it.
  const resolved = resolveTargets(chapterTwoAlone, [page('introduction', 'Introduction')])
  expect(resolved[0]!.existingUrl).toBeUndefined()
})
