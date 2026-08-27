import { LIBRETEXTS, PRESSBOOKS } from '../context'
import { createSink } from '../sink'
import { recoverMath } from './math'

const context = {
  profile: PRESSBOOKS,
  contentBaseUrl: 'https://books.example/chapter/one',
  canonicalUrl: 'https://books.example/chapter/one',
  sectionTitle: 'One',
  sectionId: 'one',
  xrefs: new Map<string, string>(),
  attribution: { bookTitle: 'Book', publisher: 'Pressbooks', url: 'https://books.example', authors: [] },
}

test('recovers Pressbooks QuickLaTeX equation images as MathML', () => {
  const doc = new DOMParser().parseFromString(
    '<body><p>Energy <img class="ql-img-displayed-equation" src="https://quicklatex.com/a.png" alt="\\[ E=mc^2 \\]"></p></body>',
    'text/html',
  )
  const sink = createSink('one')
  recoverMath(doc, context, sink)

  expect(doc.querySelector('img')).toBeNull()
  expect(doc.querySelector('math')).not.toBeNull()
  expect(doc.body.textContent).toContain('E')
  expect(sink.result().notes[0]?.message).toContain('1 recovered')
})

test('leaves a source-free QuickLaTeX image for human review', () => {
  for (const alt of ['', 'Rendered by QuickLaTeX.com']) {
    const doc = new DOMParser().parseFromString(
      `<body><img class="ql-img-inline-formula" alt="${alt}"></body>`,
      'text/html',
    )
    recoverMath(doc, context, createSink('one'))
    expect(doc.querySelector('img')).not.toBeNull()
  }
})

test('recovers LibreTexts inline and display delimiters as MathML', () => {
  const doc = new DOMParser().parseFromString(
    '<body><p>The slope is \\(m=\\frac{y_2-y_1}{x_2-x_1}\\).</p><p>\\[E=mc^2\\]</p></body>',
    'text/html',
  )
  const sink = createSink('one')
  recoverMath(doc, { ...context, profile: LIBRETEXTS }, sink)
  expect(doc.querySelectorAll('math')).toHaveLength(2)
  expect(doc.body.textContent).toContain('The slope is')
  expect(doc.body.textContent).not.toContain('\\frac')
  expect(sink.result().notes[0]?.message).toContain('2 recovered')
})
