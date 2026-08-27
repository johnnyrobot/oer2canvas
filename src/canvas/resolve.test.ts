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
  Two sections titled "Introduction" and ONE page that could be either: the same
  coin toss as two pages, and refused for the same reason. Claiming it for
  chapter 1 because chapter 1 comes first is a guess dressed as an ordering rule.
*/
test('one page that two sections could both own is claimed by neither', () => {
  const resolved = resolveTargets(TWO, [page('introduction', 'Introduction')])
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
  const resolved = resolveTargets(TWO, [
    page('introduction', 'Introduction'),
    page('introduction-2', 'Introduction'),
  ])
  expect(resolved.map((r) => r.ambiguous)).toEqual([true, true])
  expect(resolved.map((r) => r.existingUrl)).toEqual([undefined, undefined])
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
