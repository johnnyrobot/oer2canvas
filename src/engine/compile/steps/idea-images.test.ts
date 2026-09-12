import { insertIdeaImages } from './idea-images'
import { applyIdeaEdits, IDEA_CHANGE_NOTE } from './idea-edits'
import { appendAttribution } from './attribution'
import { blockId, ensureBlockIds } from './block-ids'
import { resolveAlt } from './alt'
import { createSink } from '../sink'
import { fixtureContext } from '../fixture-context'
import { imageEditKey, type IdeaEdit, type ImageEdit } from '../../idea/edits'

const b0 = blockId('s1', 0)

const image: ImageEdit = {
  kind: 'image', placement: { kind: 'insert-after', elementId: b0 }, assetName: 'lab-abc12345.jpg', width: 800, height: 600,
  alt: 'Two students at a lab bench', caption: 'Students in a chemistry lab.',
  attribution: { text: '“Lab” by A, Wikimedia Commons, CC BY-SA 4.0', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Lab.jpg', licenseName: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', shareAlike: true },
}
const one = (edit: ImageEdit) => new Map<string, IdeaEdit>([[imageEditKey('s1', edit.assetName), edit]])

// The same neighbours the step has in `STEPS`, in the same order.
function compile(html: string, edits: ReadonlyMap<string, IdeaEdit>, sectionId = 's1') {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const { ctx: base } = fixtureContext('page-section')
  const ctx = { ...base, sectionId, ideaEdits: edits }
  const sink = createSink(sectionId)
  ensureBlockIds(doc, ctx, sink)
  insertIdeaImages(doc, ctx, sink)
  resolveAlt(doc, ctx, sink)
  appendAttribution(doc, ctx, sink)
  applyIdeaEdits(doc, ctx, sink)
  return { html: doc.body.innerHTML, ...sink.result() }
}

test('insert-after places a figure with a packaged src, alt, size, and a TASL caption tied by aria-describedby', () => {
  const { html, queue } = compile('<p>First.</p><p>Second.</p>', one(image))
  expect(html).toContain(`<p id="${b0}">First.</p><div class="b2c-figure" id="b2c-idea-img-lab-abc12345">`)
  expect(html).toContain('src="$IMS-CC-FILEBASE$/oer2canvas/lab-abc12345.jpg"')
  expect(html).toContain('alt="Two students at a lab bench"')
  expect(html).toContain('width="800" height="600"')
  expect(html).toContain('aria-describedby="b2c-cap-b2c-idea-img-lab-abc12345"')
  expect(html).toContain('<p class="b2c-caption" id="b2c-cap-b2c-idea-img-lab-abc12345">Students in a chemistry lab. “Lab” by A, Wikimedia Commons, CC BY-SA 4.0 (<a href="https://commons.wikimedia.org/wiki/File:Lab.jpg">source</a>)</p>')
  // The figure lands after the first block, before the second.
  expect(html.indexOf('lab-abc12345')).toBeLessThan(html.indexOf('Second.'))
  // With alt present and clean, resolveAlt trusts it: nothing is queued.
  expect(queue).toEqual([])
})

test('an empty caption leaves only the credit in the caption', () => {
  const { html } = compile('<p>x</p>', one({ ...image, caption: '' }))
  expect(html).toContain('<p class="b2c-caption" id="b2c-cap-b2c-idea-img-lab-abc12345">“Lab” by A, Wikimedia Commons, CC BY-SA 4.0 (<a')
})

test('replace swaps an existing image in place and keeps the surrounding block', () => {
  const html = '<p>Intro.</p><div class="b2c-figure" id="old"><img id="old-img" src="x.png" alt="Old"></div><p>After.</p>'
  const out = compile(html, one({ ...image, placement: { kind: 'replace', elementId: 'old' } })).html
  expect(out).not.toContain('x.png')
  expect(out).toContain('lab-abc12345.jpg')
  expect(out.indexOf('Intro.')).toBeLessThan(out.indexOf('lab-abc12345.jpg'))
  expect(out.indexOf('lab-abc12345.jpg')).toBeLessThan(out.indexOf('After.'))
})

test('a placement target that no longer exists is dropped with a note', () => {
  const { html, notes } = compile('<p>x</p>', one({ ...image, placement: { kind: 'insert-after', elementId: 'gone' } }))
  expect(html).not.toContain('lab-abc12345')
  expect(notes).toContainEqual({ step: 'idea-images', message: '1 added image could not be placed because its target is gone', count: 1 })
  expect(html).not.toContain('b2c-idea-image-credit')
})

test('an edit keyed to another section is left alone', () => {
  const { html } = compile('<p>x</p>', one(image), 's2')
  expect(html).not.toContain('lab-abc12345')
})

test('the attribution block gets the change note, an additional-image credit, and the share-alike sentence', () => {
  const { html, notes } = compile('<p>x</p>', one(image))
  expect(html).toContain(IDEA_CHANGE_NOTE)
  expect(html).toMatch(/<p class="b2c-idea-image-credit" data-asset="lab-abc12345\.jpg">Additional image: “Lab” by A, Wikimedia Commons, <a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/">CC BY-SA 4\.0<\/a> \(<a href="https:\/\/commons\.wikimedia\.org\/wiki\/File:Lab\.jpg">source<\/a>\)\. This image is licensed share-alike; adaptations of it must carry the same licence\.<\/p>/)
  expect(notes).toContainEqual({ step: 'idea-images', message: '1 image(s) added by the instructor', count: 1 })
})

test('a licence without a deed url is credited as plain text, without the share-alike sentence', () => {
  const pd: ImageEdit = { ...image, attribution: { text: '“Lab” by A, Wikimedia Commons, Public domain', sourcePageUrl: 's', licenseName: 'Public domain', shareAlike: false } }
  const { html } = compile('<p>x</p>', one(pd))
  expect(html).toContain('Additional image: “Lab” by A, Wikimedia Commons, Public domain (<a href="s">source</a>).</p>')
  expect(html).not.toContain('share-alike')
})

test('compiling twice is idempotent: no second figure, no second credit', () => {
  const edits = one(image)
  const once = compile('<p>x</p>', edits).html
  const twice = compile(once, edits).html
  expect(twice.split('$IMS-CC-FILEBASE$/oer2canvas/lab-abc12345.jpg')).toHaveLength(2)
  expect(twice.split('id="b2c-idea-img-lab-abc12345"')).toHaveLength(2)
  expect(twice.split('b2c-idea-image-credit')).toHaveLength(2)
})
