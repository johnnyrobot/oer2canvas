import { IDEA_CHANGE_NOTE, applyIdeaEdits } from './idea-edits'
import { appendAttribution } from './attribution'
import { ensureBlockIds } from './block-ids'
import { createSink } from '../sink'
import { fixtureContext } from '../fixture-context'
import { ideaEditKey, type IdeaEdit } from '../../idea/edits'

function compile(html: string, edits: ReadonlyMap<string, IdeaEdit>) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const { ctx: base } = fixtureContext('page-section')
  const ctx = { ...base, sectionId: 's1', ideaEdits: edits }
  const sink = createSink('s1')
  ensureBlockIds(doc, ctx, sink)
  appendAttribution(doc, ctx, sink)
  applyIdeaEdits(doc, ctx, sink)
  return { html: doc.body.innerHTML, notes: sink.result().notes }
}

test('a replace edit changes the nth occurrence and preserves case', () => {
  const edits = new Map<string, IdeaEdit>([
    [ideaEditKey('s1', 'b2c-blk-0', 1, 'Suffers from'), { kind: 'replace', replacement: 'has' }],
  ])
  const { html } = compile('<p>Suffers from one. Suffers from two.</p>', edits)
  expect(html).toContain('<p id="b2c-blk-0">Suffers from one. Has two.</p>')
})

test('a keep edit with context inserts a parenthetical after the original', () => {
  const edits = new Map<string, IdeaEdit>([
    [ideaEditKey('s1', 'b2c-blk-0', 0, 'schizophrenics'), { kind: 'keep', context: 'a term used at the time' }],
  ])
  const { html } = compile('<p>the schizophrenics were</p>', edits)
  expect(html).toContain('the schizophrenics (a term used at the time) were')
})

test('a keep edit without context changes nothing and adds no change note', () => {
  const edits = new Map<string, IdeaEdit>([[ideaEditKey('s1', 'b2c-blk-0', 0, 'x'), { kind: 'keep' }]])
  const { html } = compile('<p>x</p>', edits)
  expect(html).not.toContain(IDEA_CHANGE_NOTE)
})

test('an edit whose original is no longer there is dropped with a note, never applied', () => {
  const edits = new Map<string, IdeaEdit>([
    [ideaEditKey('s1', 'b2c-blk-0', 0, 'gone'), { kind: 'replace', replacement: 'x' }],
  ])
  const { html, notes } = compile('<p>nothing to match</p>', edits)
  expect(html).toContain('<p id="b2c-blk-0">nothing to match</p>')
  expect(notes).toContainEqual({ step: 'idea-edits', message: '1 inclusive-language edit no longer matched and was not applied', count: 1 })
})

test('an edit for another section is ignored', () => {
  const edits = new Map<string, IdeaEdit>([
    [ideaEditKey('s2', 'b2c-blk-0', 0, 'crazy'), { kind: 'replace', replacement: 'wild' }],
  ])
  expect(compile('<p>crazy</p>', edits).html).toContain('<p id="b2c-blk-0">crazy</p>')
})

test('the change note is appended to the attribution block once, when something applied', () => {
  const edits = new Map<string, IdeaEdit>([
    [ideaEditKey('s1', 'b2c-blk-0', 0, 'crazy'), { kind: 'replace', replacement: 'wild' }],
    [ideaEditKey('s1', 'b2c-blk-1', 0, 'crazy'), { kind: 'replace', replacement: 'wild' }],
  ])
  const { html, notes } = compile('<p>crazy</p><p>crazy</p>', edits)
  expect(html.split(IDEA_CHANGE_NOTE)).toHaveLength(2)
  expect(html).toMatch(/<div class="b2c-attribution">[\s\S]*<p class="b2c-idea-change">/)
  expect(notes).toContainEqual({ step: 'idea-edits', message: '2 inclusive-language edit(s) applied', count: 2 })
})

test('with no edits the step is a no-op', () => {
  const { html, notes } = compile('<p>crazy</p>', new Map())
  expect(html).toContain('<p id="b2c-blk-0">crazy</p>')
  expect(notes.filter((n) => n.step === 'idea-edits')).toEqual([])
})
