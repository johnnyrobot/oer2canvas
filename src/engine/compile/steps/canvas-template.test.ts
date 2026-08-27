import { applyCanvasTemplate } from './canvas-template'
import type { CompileContext } from '../context'
import { createSink } from '../sink'

function run(html: string, context: Partial<CompileContext> = {}) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const sink = createSink('s1')
  applyCanvasTemplate(doc, context as CompileContext, sink)
  return { html: doc.body.innerHTML, notes: sink.result().notes }
}

test('the section title becomes the brand banner, bolded', () => {
  const { html } = run('<h2>1.1 The Science of Biology</h2><p>body</p>')
  expect(html).toContain('background-color: #1f4e79')
  expect(html).toContain('color: white')
  expect(html).toMatch(/<h2[^>]*><strong>1\.1 The Science of Biology<\/strong><\/h2>/)
})

// The publisher's own markup inside the heading is wrapped, not rewritten:
// os-number and os-divider carry the section numbering.
test('the banner keeps the publisher’s markup inside the heading', () => {
  const { html } = run('<h2><span class="os-number">1.1</span><span class="os-text">Title</span></h2>')
  expect(html).toContain('class="os-number"')
  expect(html).toContain('class="os-text"')
})

test('the page uses the guide’s inner content wrapper', () => {
  const { html } = run('<h2>T</h2><p>body</p>')
  expect(html).toContain('style="padding: 20px; border-radius: 5px;"><h2')
  expect(html).toContain('class="border border-b"')
  expect(html).toContain('border-color: #ffffff; padding-left: 15px; padding-right: 15px;')
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  expect(doc.querySelector('div[style*="padding: 20px"] div[style*="background-color"]')).not.toBeNull()
})

test('a missing heading uses the source section title for the banner', () => {
  const { html } = run('<p>body</p>', { sectionTitle: 'Imported section' })
  expect(html).toMatch(/<h2[^>]*><strong>Imported section<\/strong><\/h2>/)
})

test('h3 gets the brand colour and rule; h4 uses the guide colour/span treatment', () => {
  const { html } = run('<h2>T</h2><h3>Objectives</h3><h4>Sub</h4>')
  expect(html).toMatch(/<h3[^>]*style="[^"]*color: #1f4e79; border-bottom: 2px solid #2e75b6/)
  expect(html).toMatch(/<h4[^>]*style="[^"]*color: #1f4e79;[^>]*><span style="color: #1f4e79;"><strong>Sub<\/strong><\/span>/)
  // The secondary is for rules only, never behind text.
  expect(html).not.toContain('background-color: #2e75b6')
})

test('existing inline styles are preserved, not replaced', () => {
  const { html } = run('<h2 style="text-align: center;">T</h2>')
  expect(html).toContain('text-align: center;')
  expect(html).toContain('background-color: #1f4e79')
})

test('the footer closes the page and marks its decorative arrow aria-hidden', () => {
  const { html } = run('<h2>T</h2>')
  expect(html).toContain('Click on the Next button below to continue.')
  expect(html).toContain('<span aria-hidden="true">▼</span>')
})

// An answer rebuilds a section from its source, so the step runs again on
// markup it has already dressed. Nesting one template inside another would
// double every border and indent the page twice.
test('running twice changes nothing the second time', () => {
  const doc = new DOMParser().parseFromString('<body><h2>T</h2><p>x</p></body>', 'text/html')
  const ctx = {} as CompileContext
  applyCanvasTemplate(doc, ctx, createSink('s1'))
  const once = doc.body.innerHTML
  applyCanvasTemplate(doc, ctx, createSink('s1'))
  expect(doc.body.innerHTML).toBe(once)
  expect(doc.body.querySelectorAll('.b2c-canvas-template')).toHaveLength(1)
})

test('a section with no h2 still gets the container and footer', () => {
  const { html } = run('<p>only a paragraph</p>')
  expect(html).toContain('b2c-canvas-template')
  expect(html).toContain('Click on the Next button below to continue.')
})

test('it reports what it changed', () => {
  const { notes } = run('<h2>T</h2><h3>A</h3><h3>B</h3>')
  expect(notes[0]!.step).toBe('canvasTemplate')
  expect(notes[0]!.count).toBe(3)
})
