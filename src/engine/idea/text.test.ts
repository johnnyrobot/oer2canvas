import {
  blockElements, countOccurrences, findOccurrence, isQuotation, preserveCase, replaceAt, textNodesOf,
} from './text'

const doc = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')

test('blockElements returns outermost blocks in document order', () => {
  const d = doc('<p id="a">x</p><ul><li id="b">y<p id="c">nested</p></li></ul><h2 id="d">z</h2>')
  expect(blockElements(d.body).map((e) => e.id)).toEqual(['a', 'b', 'd'])
})

test('textNodesOf skips script and style', () => {
  const d = doc('<p id="a">one <strong>two</strong><script>x</script> three</p>')
  expect(textNodesOf(d.getElementById('a')!).map((t) => t.data)).toEqual(['one ', 'two', ' three'])
})

test('findOccurrence finds the nth match inside one text node', () => {
  const d = doc('<p id="a">a crazy idea, a <em>crazy</em> plan, crazy again</p>')
  const el = d.getElementById('a')!
  const first = findOccurrence(el, 'crazy', 0)!
  expect(first.node.data).toBe('a crazy idea, a ')
  expect(first.offset).toBe(2)
  const second = findOccurrence(el, 'crazy', 1)!
  expect(second.node.data).toBe('crazy')
  const third = findOccurrence(el, 'crazy', 2)!
  expect(third.node.data).toBe(' plan, crazy again')
  expect(findOccurrence(el, 'crazy', 3)).toBeUndefined()
})

test('a match that would cross an inline boundary is not found', () => {
  const d = doc('<p id="a">falling on <em>deaf</em> ears</p>')
  expect(findOccurrence(d.getElementById('a')!, 'falling on deaf ears', 0)).toBeUndefined()
})

test('countOccurrences is whole-string and case-sensitive', () => {
  expect(countOccurrences('Crazy crazy crazy', 'crazy')).toBe(2)
})

test('preserveCase keeps a leading capital and an all-caps word', () => {
  expect(preserveCase('Suffers from', 'has')).toBe('Has')
  expect(preserveCase('CRAZY', 'wild')).toBe('WILD')
  expect(preserveCase('crazy', 'wild')).toBe('wild')
})

test('replaceAt swaps the text in place and leaves the rest of the node', () => {
  const d = doc('<p id="a">he suffers from asthma today</p>')
  const el = d.getElementById('a')!
  replaceAt(findOccurrence(el, 'suffers from', 0)!, 'suffers from', 'has')
  expect(el.textContent).toBe('he has asthma today')
})

test('isQuotation is true inside blockquote, q, cite, or a paragraph carrying a citation', () => {
  const d = doc('<blockquote><p id="a">x</p></blockquote><p id="b">As Smith (1911) wrote</p><p id="c">plain</p><p id="d">Brown v. Board</p>')
  expect(isQuotation(d.getElementById('a')!)).toBe(true)
  expect(isQuotation(d.getElementById('b')!)).toBe(true)
  expect(isQuotation(d.getElementById('c')!)).toBe(false)
  expect(isQuotation(d.getElementById('d')!)).toBe(true)
})
