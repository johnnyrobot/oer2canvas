import { formatPageRanges, splitPdfMarkdown, withPageCaptions } from './pdf-pages'
import { sanitizeImportedMarkdown } from './markup'
import { blocksOf } from './page-plan'

test('page numbers are read from the markers, not counted', () => {
  // Measured: a page that produced no text emits NO marker. A four-page PDF
  // whose third page was scanned and whose fourth was blank emits 1, 2 and 4.
  const split = splitPdfMarkdown('<!-- Page 1 -->\n\nOne.\n\n<!-- Page 2 -->\n\nTwo.\n\n<!-- Page 4 -->\n\nFour.\n')
  expect(split.pages.map((page) => page.page)).toEqual([1, 2, 4])
  expect(split.pages.map((page) => page.markdown.trim())).toEqual(['One.', 'Two.', 'Four.'])
  expect(split.preamble.trim()).toBe('')
})

test('text before the first marker belongs to no page and is not dropped', () => {
  const split = splitPdfMarkdown('Front matter.\n\n<!-- Page 1 -->\n\nOne.\n')
  expect(split.preamble.trim()).toBe('Front matter.')
  expect(split.pages).toHaveLength(1)
})

test('a document with no markers at all is one pageless slice', () => {
  const split = splitPdfMarkdown('Just text.\n')
  expect(split.pages).toEqual([])
  expect(split.preamble.trim()).toBe('Just text.')
})

test('the module image placeholder gains a caption naming its page', () => {
  // The module's alt text is the PDF XObject's RESOURCE NAME (`Im1`), which
  // would read as `[Embedded image: Image: Im1]`. The page number is the one
  // true, useful thing available to put there.
  expect(withPageCaptions('Before\n\n![Image: Im1](image)\n\nAfter\n', 7))
    .toBe('Before\n\n![Figure on page 7](image)\n\nAfter\n')
  // An alt the module did not write is left alone.
  expect(withPageCaptions('![A real caption](image)\n', 7)).toBe('![A real caption](image)\n')
})

test('per-page block counts sum to the whole-document block count', () => {
  /*
   * The one inferred assumption in the split design, pinned. The page -> block
   * map is exact only if sanitizing two slices separately yields the same number
   * of top-level blocks as sanitizing their concatenation. If `marked` ever left
   * a bare top-level text node, the two would differ and EVERY `sourcePage` on
   * every finding would be off by an unknown amount — silently.
   */
  const one = '# Heading\n\nA paragraph.\n\n- a\n- b\n'
  const two = 'Loose text with no block wrapper\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n'
  /*
   * Counted with `page-plan.ts`'s own `blocksOf`, which is the function that
   * actually derives the blocks a plan indexes. Counting `body.childNodes`
   * instead measures something else and fails spuriously: `marked` puts a
   * newline between blocks, so concatenating two slices adds one whitespace
   * TEXT node that `blocksOf` skips and a raw child count does not (measured
   * 2026-08-29: 8 against 9 raw, 5 against 5 by this rule).
   */
  const blocks = (markdown: string) => blocksOf(sanitizeImportedMarkdown(markdown).html).length

  expect(blocks(one) + blocks(two)).toBe(blocks(`${one}\n${two}`))
})

test('page numbers print as ranges, and every named page survives the round trip', () => {
  expect(formatPageRanges([3, 4, 5, 6, 7, 8, 9, 41, 55, 56, 57, 58])).toBe('3–9, 41, 55–58')
  expect(formatPageRanges([2])).toBe('2')
  expect(formatPageRanges([2, 3])).toBe('2, 3')
  expect(formatPageRanges([9, 1, 1, 2])).toBe('1, 2, 9')
})
