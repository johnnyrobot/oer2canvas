import { flattenToc, fetchChapter, buildXrefMap } from './openstax'
import type { BookToc, OpenStaxClient, ChapterOutline } from './openstax'
import type { BookRef } from './types'
import bookTocFixture from './fixtures/openstax/book-toc.json'

const tree = {
  id: 'book@1',
  title: 'Book',
  contents: [
    { id: 'pref@1', title: 'Preface' },
    {
      id: 'ch1@1',
      title: 'Chapter 1',
      contents: [
        { id: 'p11@1.2', title: '1.1 First' },
        { id: 'p12@1.2', title: '1.2 Second' },
      ],
    },
  ],
}

test('flattens only nodes that have children into chapters', () => {
  const chapters = flattenToc(tree)
  expect(chapters).toHaveLength(1)
  expect(chapters[0]!.title).toBe('Chapter 1')
  expect(chapters[0]!.sections.map((s) => s.title)).toEqual(['1.1 First', '1.2 Second'])
})

test('strips the @version suffix from ids', () => {
  const chapters = flattenToc(tree)
  expect(chapters[0]!.id).toBe('ch1')
  expect(chapters[0]!.sections[0]!.id).toBe('p11')
})

test('fetchChapter assembles sections in order with attribution', async () => {
  const client: OpenStaxClient = {
    resolveRelease: async () => ({ archiveUrl: '/a', versions: {} }),
    fetchToc: async () => ({ title: 'Book', tree }),
    fetchPage: async (_b, id) => ({ id, title: `T-${id}`, content: `<p>${id}</p>` }),
    pageUrl: async (b, id) => `https://openstax.org/contents/${b}@1:${id}.json`,
  }
  const book: BookRef = {
    source: 'openstax', id: 'uuid-1', slug: 'algebra', title: 'Algebra',
    license: 'Creative Commons Attribution License', authors: [],
  }
  const chapter = await fetchChapter(client, book, flattenToc(tree)[0]!)

  expect(chapter.source).toBe('openstax')
  expect(chapter.title).toBe('Chapter 1')
  expect(chapter.sections.map((s) => s.order)).toEqual([0, 1])
  expect(chapter.sections[0]!.html).toContain('p11')
  expect(chapter.attribution.url).toBe('https://openstax.org/books/algebra')
  expect(chapter.attribution.publisher).toBe('OpenStax')
  expect(chapter.attribution.license?.name).toBe('Creative Commons Attribution License')
})

// A real OpenStax chapter carries grouping nodes with no page of their own —
// "Chapter Review" (Key Terms / Key Equations / Key Concepts) and "Exercises"
// (Review Exercises / Practice Test). fetchPage on a grouping node's id 404s.
const treeWithGrouping = {
  id: 'book@1',
  title: 'Book',
  contents: [
    { id: 'pref@1', title: 'Preface' },
    {
      id: 'ch1@1',
      title: 'Chapter 1',
      contents: [
        { id: 'p11@1.2', title: '1.1 First' },
        { id: 'p12@1.2', title: '1.2 Second' },
        {
          id: 'review@1',
          title: 'Chapter Review',
          contents: [
            { id: 'kt@1', title: 'Key Terms' },
            { id: 'ke@1', title: 'Key Equations' },
            { id: 'kc@1', title: 'Key Concepts' },
          ],
        },
        {
          id: 'exercises@1',
          title: 'Exercises',
          contents: [
            { id: 're@1', title: 'Review Exercises' },
            { id: 'pt@1', title: 'Practice Test' },
          ],
        },
      ],
    },
  ],
}

test('flattens a grouping node into its leaves, in document order, and never emits the grouping node itself', () => {
  const chapters = flattenToc(treeWithGrouping)
  expect(chapters).toHaveLength(1)
  expect(chapters[0]!.sections.map((s) => s.title)).toEqual([
    '1.1 First',
    '1.2 Second',
    'Key Terms',
    'Key Equations',
    'Key Concepts',
    'Review Exercises',
    'Practice Test',
  ])
  const titles = chapters[0]!.sections.map((s) => s.title)
  expect(titles).not.toContain('Chapter Review')
  expect(titles).not.toContain('Exercises')
})

// Nesting deeper than the one level OpenStax happens to use today — the ruling was to
// write flattenToc generally rather than assume a fixed depth.
const deepTree = {
  id: 'book@1',
  title: 'Book',
  contents: [
    {
      id: 'ch1@1',
      title: 'Chapter 1',
      contents: [
        { id: 'a@1', title: 'A' },
        {
          id: 'outer@1',
          title: 'Outer Group',
          contents: [
            { id: 'b@1', title: 'B' },
            {
              id: 'inner@1',
              title: 'Inner Group',
              contents: [
                { id: 'c@1', title: 'C' },
                { id: 'd@1', title: 'D' },
              ],
            },
          ],
        },
      ],
    },
  ],
}

test('flattens grouping nodes nested more than one level deep, in document order', () => {
  const chapters = flattenToc(deepTree)
  const titles = chapters[0]!.sections.map((s) => s.title)
  expect(titles).toEqual(['A', 'B', 'C', 'D'])
  expect(titles).not.toContain('Outer Group')
  expect(titles).not.toContain('Inner Group')
})

// Verbatim shape of a real OpenStax TOC title, captured against book-toc.json.
const REAL_CHAPTER_TITLE_MARKUP =
  '<span class="os-number"><span class="os-part-text">Chapter </span>1</span>\n' +
  '<span class="os-divider"> </span>\n' +
  '<span data-type="" itemprop="" class="os-text">Prerequisites</span>'

const markupTree = {
  id: 'book@1',
  title: 'Book',
  contents: [
    {
      id: 'ch1@1',
      title: REAL_CHAPTER_TITLE_MARKUP,
      contents: [{ id: 'p11@1', title: '1.1 Real Numbers: Algebra Essentials' }],
    },
  ],
}

test('normalizes a TOC title carrying span markup and embedded newlines', () => {
  const chapters = flattenToc(markupTree)
  expect(chapters[0]!.title).toBe('Chapter 1 Prerequisites')
})

test('leaves an already-plain TOC title unchanged', () => {
  const chapters = flattenToc(markupTree)
  expect(chapters[0]!.sections[0]!.title).toBe('1.1 Real Numbers: Algebra Essentials')
})

function fakeClient(overrides: Partial<OpenStaxClient> = {}): OpenStaxClient {
  return {
    resolveRelease: async () => ({ archiveUrl: '/a', versions: {} }),
    fetchToc: async () => ({ title: 'Book', tree }),
    fetchPage: async (_b, id) => ({ id, title: `T-${id}`, content: `<p>${id}</p>` }),
    pageUrl: async (b, id) => `https://openstax.org/contents/${b}@1:${id}.json`,
    ...overrides,
  }
}

const book: BookRef = { source: 'openstax', id: 'uuid-1', slug: 'algebra', title: 'Algebra', authors: [] }

test('fetchChapter fetches pages strictly sequentially — never more than one in flight', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const client = fakeClient({
    fetchPage: async (_b, id) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 0))
      inFlight--
      return { id, title: `T-${id}`, content: `<p>${id}</p>` }
    },
  })
  await fetchChapter(client, book, flattenToc(tree)[0]!)
  expect(maxInFlight).toBe(1)
})

test('fetchChapter calls fetchPage exactly once per section, with the book id and bare page ids in order', async () => {
  const calls: Array<[string, string]> = []
  const client = fakeClient({
    fetchPage: async (bookId, id) => {
      calls.push([bookId, id])
      return { id, title: `T-${id}`, content: `<p>${id}</p>` }
    },
  })
  const outline = flattenToc(tree)[0]!
  await fetchChapter(client, book, outline)
  expect(calls).toEqual([
    ['uuid-1', 'p11'],
    ['uuid-1', 'p12'],
  ])
})

test('falls back to the fetched page title when the outline section title is empty', async () => {
  const outline: ChapterOutline = {
    id: 'ch1',
    title: 'Chapter 1',
    sections: [{ id: 'p11', title: '' }],
  }
  const client = fakeClient({
    fetchPage: async (_b, id) => ({ id, title: 'Fetched Title', content: `<p>${id}</p>` }),
  })
  const chapter = await fetchChapter(client, book, outline)
  expect(chapter.sections[0]!.title).toBe('Fetched Title')
})

// --- The committed fixture's real shape -----------------------------------
//
// Every test above builds its own tiny tree, which is how `flattenToc` drifted
// into calling "Answer Key" a chapter without anything failing. These two pin
// the REAL fixture: if a re-capture or a rule change moves the chapter list, it
// fails here rather than in a browser three screens later.

/** The committed TOC, typed for `flattenToc`. The JSON carries extra wire fields. */
const bookToc = bookTocFixture as unknown as BookToc

test('flattens the committed Algebra and Trigonometry TOC into exactly its 13 chapters', () => {
  expect(flattenToc(bookToc.tree).map((c) => c.title)).toEqual([
    'Chapter 1 Prerequisites',
    'Chapter 2 Equations and Inequalities',
    'Chapter 3 Functions',
    'Chapter 4 Linear Functions',
    'Chapter 5 Polynomial and Rational Functions',
    'Chapter 6 Exponential and Logarithmic Functions',
    'Chapter 7 The Unit Circle: Sine and Cosine Functions',
    'Chapter 8 Periodic Functions',
    'Chapter 9 Trigonometric Identities and Equations',
    'Chapter 10 Further Applications of Trigonometry',
    'Chapter 11 Systems of Equations and Inequalities',
    'Chapter 12 Analytic Geometry',
    'Chapter 13 Sequences, Probability, and Counting Theory',
  ])
})

test('the committed TOC yields a 12-section chapter 1, and no front or back matter', () => {
  const chapters = flattenToc(bookToc.tree)
  expect(chapters[0]!.sections.map((s) => s.title)).toEqual([
    'Introduction to Prerequisites',
    '1.1 Real Numbers: Algebra Essentials',
    '1.2 Exponents and Scientific Notation',
    '1.3 Radicals and Rational Exponents',
    '1.4 Polynomials',
    '1.5 Factoring Polynomials',
    '1.6 Rational Expressions',
    'Key Terms',
    'Key Equations',
    'Key Concepts',
    'Review Exercises',
    'Practice Test',
  ])
  // "Answer Key" is a root-level container of 13 answer pages and used to be
  // emitted as a 13-section chapter; "Preface", "Appendix A" and "Index" are
  // root-level leaves and were always skipped.
  const titles = chapters.map((c) => c.title)
  expect(titles).not.toContain('Answer Key')
  expect(titles).not.toContain('Preface')
  expect(titles).not.toContain('Index')
})

// --- Unit-structured books ------------------------------------------------
//
// Shape captured live from University Physics Volume 1 on 2026-08-21, which is
// in the bundled catalog: two root-level `toc_type: 'unit'` containers holding
// 14 and 3 chapters, seven root-level Appendix leaves, an "Answer Key"
// container, and an "Index" leaf. Treating a unit as a chapter turned its first
// entry into 190 leaf sections — 190 sequential page fetches and 190 audits on
// the main thread — which is adopting a book, not a chapter, and the spec puts
// that explicitly out of scope.

const unitTree = {
  id: 'book@1',
  title: 'Book',
  contents: [
    { id: 'pref@1', title: 'Preface' },
    {
      id: 'u1@1',
      title: 'Unit 1 Mechanics',
      toc_type: 'unit',
      contents: [
        {
          id: 'ch1@1',
          title: 'Chapter 1 Units and Measurement',
          toc_type: 'chapter',
          contents: [
            { id: 'c1i@1', title: 'Introduction' },
            { id: 'c1s1@1', title: '1.1 The Scope and Scale of Physics' },
            {
              id: 'c1rev@1',
              title: 'Chapter Review',
              toc_type: 'sub-book-tree',
              contents: [{ id: 'c1kt@1', title: 'Key Terms' }],
            },
          ],
        },
        {
          id: 'ch2@1',
          title: 'Chapter 2 Vectors',
          toc_type: 'chapter',
          contents: [{ id: 'c2s1@1', title: '2.1 Scalars and Vectors' }],
        },
      ],
    },
    { id: 'appa@1', title: 'Appendix A Units' },
    {
      id: 'ak@1',
      title: 'Answer Key',
      toc_type: 'sub-book-tree',
      contents: [
        { id: 'ak1@1', title: 'Chapter 1' },
        { id: 'ak2@1', title: 'Chapter 2' },
      ],
    },
    { id: 'idx@1', title: 'Index' },
  ],
}

test('recurses into a Unit and emits its chapters, never the Unit itself', () => {
  const chapters = flattenToc(unitTree)
  expect(chapters.map((c) => c.title)).toEqual([
    'Chapter 1 Units and Measurement',
    'Chapter 2 Vectors',
  ])
  expect(chapters[0]!.id).toBe('ch1')
  // The chapter's own grouping node is still recursed into, as everywhere else.
  expect(chapters[0]!.sections.map((s) => s.title)).toEqual([
    'Introduction',
    '1.1 The Scope and Scale of Physics',
    'Key Terms',
  ])
})

test('skips a root-level back-matter container instead of calling it a chapter', () => {
  expect(flattenToc(unitTree).map((c) => c.title)).not.toContain('Answer Key')
})

test('recognises a Unit by shape when the TOC carries no structural tags', () => {
  // Same tree with every `toc_type` removed: the fallback rule is "every child
  // has children of its own", which a unit satisfies and a chapter never does,
  // because a chapter always mixes leaf sections with its grouping nodes.
  const untagged = JSON.parse(
    JSON.stringify(unitTree, (key, value) => (key === 'toc_type' ? undefined : value)),
  )
  expect(flattenToc(untagged).map((c) => c.title)).toEqual([
    'Chapter 1 Units and Measurement',
    'Chapter 2 Vectors',
  ])
})

// --- D9 attribution -------------------------------------------------------

const TOC_LICENSE: BookToc = {
  title: 'Book',
  tree,
  license: { name: 'Creative Commons Attribution License', url: 'http://creativecommons.org/licenses/by/4.0/' },
}

test('prefers the TOC licence over the catalog name, and keeps its url', async () => {
  const chapter = await fetchChapter(
    fakeClient(),
    { ...book, license: 'CC BY (catalog string)' },
    flattenToc(tree)[0]!,
    TOC_LICENSE,
  )
  expect(chapter.attribution.license).toEqual({
    name: 'Creative Commons Attribution License',
    url: 'http://creativecommons.org/licenses/by/4.0/',
  })
})

test('falls back to the catalog licence name when no TOC is supplied', async () => {
  const chapter = await fetchChapter(
    fakeClient(),
    { ...book, license: 'CC BY (catalog string)' },
    flattenToc(tree)[0]!,
  )
  expect(chapter.attribution.license).toEqual({ name: 'CC BY (catalog string)' })
})

test('omits the licence entirely when neither source has one', async () => {
  const chapter = await fetchChapter(fakeClient(), book, flattenToc(tree)[0]!, {
    title: 'Book',
    tree,
    license: undefined,
  })
  expect(chapter.attribution.license).toBeUndefined()
})

test('carries book.authors through to attribution, not a hardcoded empty list', async () => {
  // The pass-through this task exists to add: `fetchChapter` must forward
  // `book.authors` rather than hardcoding an empty list. A non-empty fixture
  // is required here — every other `BookRef` fixture in this file sets
  // `authors: []`, which cannot distinguish "passed through" from "hardcoded".
  const chapter = await fetchChapter(
    fakeClient(),
    { ...book, authors: ['Jay Abramson', 'Valeree Falduto'] },
    flattenToc(tree)[0]!,
    TOC_LICENSE,
  )
  expect(chapter.attribution.authors).toEqual(['Jay Abramson', 'Valeree Falduto'])
})

test('an author-less book degrades to an empty list', async () => {
  const chapter = await fetchChapter(fakeClient(), book, flattenToc(tree)[0]!, TOC_LICENSE)
  expect(chapter.attribution.authors).toEqual([])
  // Everything D9 CAN carry from this API is carried.
  expect(chapter.attribution.bookTitle).toBe('Algebra')
  expect(chapter.attribution.publisher).toBe('OpenStax')
  expect(chapter.attribution.url).toBe('https://openstax.org/books/algebra')
  expect(chapter.attribution.license?.url).toBe('http://creativecommons.org/licenses/by/4.0/')
})

// --- Canonical urls and the xref map --------------------------------------

describe('canonical urls', () => {
  it('keeps each section slug from the TOC', () => {
    const chapters = flattenToc(bookToc.tree)
    const ch1 = chapters.find((c) => c.title.includes('Prerequisites'))!
    const polynomials = ch1.sections.find((s) => s.title.includes('Polynomials'))!
    expect(polynomials.slug).toBe('1-4-polynomials')
  })

  it('maps every page uuid to its public url', () => {
    const xrefs = buildXrefMap(bookToc.tree, 'algebra-and-trigonometry')
    expect(xrefs.get('49cf2d69-1d37-49aa-9e61-16da4c52ce37')).toBe(
      'https://openstax.org/books/algebra-and-trigonometry/pages/1-5-factoring-polynomials',
    )
  })

  it('resolves BACK MATTER too, because that is where the links actually point', () => {
    // Every one of the 29 intra-book links in the 1.4 fixture targets the
    // chapter ANSWER KEY, which `flattenToc` deliberately skips as back matter.
    // If this map skipped it too, every solution link in the book would fall
    // back to the book url — so the map walks the whole tree, not the chapters.
    const xrefs = buildXrefMap(bookToc.tree, 'algebra-and-trigonometry')
    expect(xrefs.get('f92fd036-ead4-5380-895d-8f6f9fdbcef7')).toBe(
      'https://openstax.org/books/algebra-and-trigonometry/pages/chapter-1',
    )
  })

  it('omits nodes the TOC gave no slug, rather than inventing a url', () => {
    const xrefs = buildXrefMap({ id: 'x@1', title: 'No slug', contents: [] }, 'book')
    expect(xrefs.size).toBe(0)
  })
})

describe('fetchChapter', () => {
  // A real book id/slug and a real fake client, distinct from the toy `book`/
  // `fakeClient` used above: these tests need urls that resolve against the
  // committed fixture's actual slugs, which the toy `tree` carries none of.
  const book: BookRef = {
    source: 'openstax',
    id: '13ac107a-f15f-49d2-97e8-60ab2e3b519c',
    slug: 'algebra-and-trigonometry',
    title: 'Algebra and Trigonometry',
    authors: [],
  }
  const chapter1 = flattenToc(bookToc.tree).find((c) => c.title.includes('Prerequisites'))!
  const outline: ChapterOutline = {
    ...chapter1,
    sections: [chapter1.sections.find((s) => s.slug === '1-4-polynomials')!],
  }
  const fakeClient: OpenStaxClient = {
    resolveRelease: async () => ({ archiveUrl: '/a', versions: { [book.id]: '1' } }),
    fetchToc: async () => bookToc,
    fetchPage: async (_b, id) => ({ id, title: `T-${id}`, content: `<p>${id}</p>` }),
    pageUrl: async (b, id) => `https://openstax.org/a/contents/${b}@1:${id}.json`,
  }

  it('stops fetching pages when the signal aborts', async () => {
    // A chapter is a dozen sequential page fetches; without this the user's
    // cancel is ignored until every one of them has come back. Granularity is
    // one page: the check is between requests, not inside the in-flight one.
    const controller = new AbortController()
    const fetched: string[] = []
    const many: ChapterOutline = { ...chapter1 }
    const client: OpenStaxClient = {
      ...fakeClient,
      fetchPage: async (_b, id) => {
        fetched.push(id)
        if (fetched.length === 2) controller.abort()
        return { id, title: `T-${id}`, content: `<p>${id}</p>` }
      },
    }
    expect(many.sections.length).toBeGreaterThan(3)
    await expect(
      fetchChapter(client, book, many, bookToc, controller.signal),
    ).rejects.toThrow(/abort/i)
    expect(fetched).toHaveLength(2)
  })

  it('records where each section was served from and its canonical url', async () => {
    const chapter = await fetchChapter(fakeClient, book, outline, bookToc)
    const first = chapter.sections[0]!
    expect(first.contentBaseUrl).toMatch(/\/contents\/[0-9a-f-]+@[^:]+:[0-9a-f-]+\.json$/)
    expect(first.canonicalUrl).toBe(
      'https://openstax.org/books/algebra-and-trigonometry/pages/1-4-polynomials',
    )
  })

  it('degrades a slugless section to the book url rather than emitting nothing', async () => {
    const noSlug = { ...outline, sections: [{ id: outline.sections[0]!.id, title: 'x' }] }
    const chapter = await fetchChapter(fakeClient, book, noSlug, bookToc)
    expect(chapter.sections[0]!.canonicalUrl).toBe(
      'https://openstax.org/books/algebra-and-trigonometry',
    )
  })
})
