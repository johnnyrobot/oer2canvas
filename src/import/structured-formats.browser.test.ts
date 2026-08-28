import { probeParser } from './parsers/probe'
import { EPUB_ODT_RTF_FIXTURE_CASES } from './testing/document-fixture-cases'

test.each(EPUB_ODT_RTF_FIXTURE_CASES)('$format preserves the representative semantic corpus in the real Worker', async ({ format, fixture }) => {
  const bytes = await fixture()
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  const parsed = await probeParser({
    parser: 'anydoc',
    bytes: bytes.buffer,
    formatHint: format,
  })
  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()

  expect(parsed).toMatchObject({
    detectedFormat: format,
    formatDetection: 'content',
    normalized: { findings: [] },
  })
  const html = new DOMParser().parseFromString(parsed.normalized!.html, 'text/html')
  expect([...html.querySelectorAll('h1')].some((heading) => heading.textContent === 'Cell Biology')).toBe(true)
  expect(html.querySelector('a')).toHaveAttribute('href', 'https://example.edu/cells')
  expect(html.querySelector('ul')).toHaveTextContent('Membrane')
  expect(html.querySelector('ul')).toHaveTextContent('Cytoplasm')
  expect(html.querySelector('table')).toHaveTextContent('Structure')
  expect(html.querySelector('table')).toHaveTextContent('Stores DNA')
})
