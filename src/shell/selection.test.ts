import type { CompiledChapter, CompiledSection, QueueItem } from '../contracts/index'
import { mergeSelection, prepareLabel, regroup, toggle } from './selection'

const item = (elementId: string, sectionId: string, hash?: string): QueueItem => ({
  kind: 'alt', elementId, sectionId, hash, context: {},
})

const section = (id: string, queue: QueueItem[] = [], html = `<p>${id}</p>`): CompiledSection => ({
  id, title: `Section ${id}`, html, notes: [], queue,
})

const chapter = (title: string, sections: CompiledSection[]): CompiledChapter => ({
  chapter: { title } as CompiledChapter['chapter'],
  sections,
  queue: sections.flatMap((s) => s.queue),
})

test('an empty selection merges to nothing rather than an empty chapter', () => {
  expect(mergeSelection([])).toBeUndefined()
})

// The reason the whole selection shares one queue: an image reused across four
// chapters is ONE question, and the dedupe can only see it if every chapter's
// items are in the same queue.
test('one queue across the selection, deduped by hash across chapter boundaries', () => {
  const merged = mergeSelection([
    chapter('One', [section('a', [item('img1', 'a', 'sha-shared')])]),
    chapter('Two', [section('b', [item('img9', 'b', 'sha-shared')])]),
  ])!
  expect(merged.sections).toHaveLength(2)
  expect(merged.queue).toHaveLength(1)
})

test('sections keep the selection order', () => {
  const merged = mergeSelection([
    chapter('One', [section('a'), section('b')]),
    chapter('Two', [section('c')]),
  ])!
  expect(merged.sections.map((s) => s.id)).toEqual(['a', 'b', 'c'])
})

// The critical one. An answer REBUILDS the section it touched, so regrouping
// from the originals would hand back pre-answer bytes and show every gate panel
// beside markup it no longer describes.
test('regroup reads answered sections back, never the stale originals', () => {
  const originals = [
    chapter('One', [section('a', [item('img1', 'a')])]),
    chapter('Two', [section('b')]),
  ]
  const answered: CompiledChapter = {
    ...mergeSelection(originals)!,
    sections: [section('a', [], '<p>answered a</p>'), section('b')],
    queue: [],
  }

  const out = regroup(originals, answered)
  expect(out).toHaveLength(2)
  expect(out[0]!.sections[0]!.html).toBe('<p>answered a</p>')
  expect(out[0]!.queue).toHaveLength(0)
  // ...and each chapter keeps its own identity rather than the merged one's.
  expect(out[0]!.chapter.title).toBe('One')
  expect(out[1]!.chapter.title).toBe('Two')
})

test('a section missing from the answered set falls back rather than vanishing', () => {
  const originals = [chapter('One', [section('a'), section('b')])]
  const answered: CompiledChapter = { ...mergeSelection(originals)!, sections: [section('a')] }
  expect(regroup(originals, answered)[0]!.sections.map((s) => s.id)).toEqual(['a', 'b'])
})

// A tray listing chapters 7, 2, 9 describes the user's clicking, not their
// selection — and it is the order the pages will be created in.
test('toggle keeps the book’s order, not the click order', () => {
  const order = [{ id: '1' }, { id: '2' }, { id: '3' }]
  let sel = toggle([], order[2]!, order)
  sel = toggle(sel, order[0]!, order)
  sel = toggle(sel, order[1]!, order)
  expect(sel.map((s) => s.id)).toEqual(['1', '2', '3'])
})

test('toggle removes a chapter already chosen', () => {
  const order = [{ id: '1' }, { id: '2' }]
  expect(toggle([order[0]!, order[1]!], order[0]!, order).map((s) => s.id)).toEqual(['2'])
})

test('the prepare label counts properly', () => {
  expect(prepareLabel(1)).toBe('Prepare 1 chapter')
  expect(prepareLabel(3)).toBe('Prepare 3 chapters')
})
