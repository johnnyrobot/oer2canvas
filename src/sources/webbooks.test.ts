import type { BookRef } from './types'
import {
  createLibreTextsClient,
  createPressbooksClient,
  parseDekiToc,
  parsePressbooksToc,
  parseWebBookToc,
} from './webbooks'
import libreRoot from './fixtures/libretexts/root.html?raw'
import libreChapter from './fixtures/libretexts/chapter.html?raw'
import librePage from './fixtures/libretexts/page.html?raw'
import dekiTree from './fixtures/libretexts/deki-tree.json'
import pressbooksToc from './fixtures/pressbooks/toc.json'
import pressbooksChapter from './fixtures/pressbooks/chapter.json'

const HTML = `
  <nav id="toc"><ul>
    <li><a href="/book/1">Chapter 1</a><ul><li><a href="/book/1/1">One</a></li><li><a href="/book/1/2">Two</a></li></ul></li>
    <li><a href="/book/2">Chapter 2</a></li>
  </ul></nav>
`

test('parses nested generic webbook lists into outlines and sections', () => {
  expect(parseWebBookToc(HTML, 'https://example.org/book', 'Book', ['#toc'])).toEqual([
    {
      id: encodeURIComponent('https://example.org/book/1'), title: 'Chapter 1',
      sections: [
        { id: `${encodeURIComponent('https://example.org/book/1/1')}:0`, title: 'One', url: 'https://example.org/book/1/1' },
        { id: `${encodeURIComponent('https://example.org/book/1/2')}:1`, title: 'Two', url: 'https://example.org/book/1/2' },
      ],
    },
    {
      id: encodeURIComponent('https://example.org/book/2'), title: 'Chapter 2',
      sections: [{ id: `${encodeURIComponent('https://example.org/book/2')}:0`, title: 'Chapter 2', url: 'https://example.org/book/2' }],
    },
  ])
})

test('falls back to a flat outline when a generic publisher has no list wrapper', () => {
  const outlines = parseWebBookToc(
    '<main><a href="/one">One</a><a href="/two">Two</a><a href="/image.png">image</a></main>',
    'https://example.org/book', 'Book', ['#missing'],
  )
  expect(outlines[0]?.sections.map((section) => section.title)).toEqual(['One', 'Two'])
})

test('parses the one-or-many Deki envelope and preserves public page URLs', () => {
  const outlines = parseDekiToc(dekiTree, 'https://chem.libretexts.org')
  expect(outlines).toHaveLength(1)
  expect(outlines[0]?.title).toBe('1: Chapter One')
  expect(outlines[0]?.sections.map((section) => section.id)).toEqual(['101', '102'])
  expect(outlines[0]?.sections.every((section) => section.url?.startsWith('https://chem.libretexts.org/'))).toBe(true)
})

const LIBRE_BOOK: BookRef = {
  source: 'libretexts', id: 'chem-100',
  slug: 'https://chem.libretexts.org/Bookshelves/Fixture_Book',
  title: 'Fixture Book', authors: ['Libre Author'], license: 'CC BY',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
}

function decodedRelayTarget(input: RequestInfo | URL): string {
  const raw = String(input)
  return raw.startsWith('/relay?url=') ? decodeURIComponent(raw.slice('/relay?url='.length)) : raw
}

test('LibreTexts uses the rendered recursive hierarchy when anonymous Deki access is forbidden', async () => {
  const calls: string[] = []
  const client = createLibreTextsClient({
    relayUrl: '/relay',
    fetch: async (input) => {
      const url = decodedRelayTarget(input)
      calls.push(url)
      if (url.includes('/@api/deki/')) return new Response('forbidden', { status: 403 })
      if (url.endsWith('/1_Chapter_One')) return new Response(libreChapter)
      if (url.endsWith('/1.1_Lesson')) return new Response(librePage)
      return new Response(libreRoot)
    },
  })
  const outlines = await client.fetchOutlines(LIBRE_BOOK)
  expect(outlines).toEqual([{
    id: '101', title: '1: Chapter One',
    sections: [{
      id: '101', title: '1: Chapter One', kind: 'libre-tree',
      url: 'https://chem.libretexts.org/Bookshelves/Fixture_Book/1_Chapter_One',
    }],
  }])
  expect(calls).toHaveLength(2)
  const chapter = await client.fetchChapter(LIBRE_BOOK, outlines[0]!)
  expect(chapter.sections.map((section) => section.title)).toEqual(['1.1: Lesson'])
  expect(chapter.sections[0]?.html).toContain('Measured LibreTexts fixture content.')
  expect(chapter.sections[0]?.html).not.toContain('Page chrome')
  expect(chapter.attribution.license?.url).toBe('https://creativecommons.org/licenses/by/4.0/')
  expect(calls.some((url) => url.includes('/@api/deki/'))).toBe(true)
  expect(calls).toHaveLength(4)
})

test('LibreTexts accepts a usable public-URL Deki tree', async () => {
  const client = createLibreTextsClient({ fetch: async () => Response.json(dekiTree) })
  await expect(client.fetchOutlines(LIBRE_BOOK)).resolves.toHaveLength(1)
})

test('Pressbooks TOC keeps readable entries in source order and decodes titles', () => {
  const outlines = parsePressbooksToc(pressbooksToc)
  expect(outlines.map((outline) => outline.title)).toEqual(["Reviewer’s Notes", '1. First Chapter'])
  expect(outlines.map((outline) => outline.id)).toEqual(['front-matter:10', 'chapters:21'])
})

test('Pressbooks fetches typed content endpoints for a selected TOC entry', async () => {
  const calls: string[] = []
  const client = createPressbooksClient({
    relayUrl: '/relay',
    fetch: async (input) => {
      const url = decodedRelayTarget(input)
      calls.push(url)
      return Response.json(url.includes('/toc') ? pressbooksToc : pressbooksChapter)
    },
  })
  const book: BookRef = {
    source: 'pressbooks', id: 'https://books.example/fixture/', slug: 'https://books.example/fixture/',
    title: 'Fixture Pressbook', authors: ['Press Author'], license: 'CC BY',
  }
  const outlines = await client.fetchOutlines(book)
  const chapter = await client.fetchChapter(book, outlines[1]!)
  expect(chapter.sections[0]?.html).toContain('Measured Pressbooks fixture content.')
  expect(calls[1]).toContain('/wp-json/pressbooks/v2/chapters?')
  expect(calls[1]).toContain('include=21')
})

test('publisher JSON retries an empty success response before failing the import', async () => {
  let attempts = 0
  const client = createPressbooksClient({
    fetch: async () => {
      attempts++
      return attempts === 1 ? new Response('') : Response.json(pressbooksToc)
    },
  })
  const book: BookRef = { source: 'pressbooks', id: 'fixture', slug: 'https://books.example/fixture/', title: 'Fixture', authors: [] }
  await expect(client.fetchOutlines(book)).resolves.toHaveLength(2)
  expect(attempts).toBe(2)
})
