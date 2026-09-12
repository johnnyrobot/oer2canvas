import { tasl, type ImageHit } from './search'

const hit = (over: Partial<ImageHit>): ImageHit => ({
  provider: 'commons', id: 'File:X.jpg', title: 'Students at a bench', thumbUrl: 't', fullUrl: 'f', width: 10, height: 10,
  license: { kind: 'by', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, creator: 'A. Photographer', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg', ...over,
})

test('TASL names title, creator, source, and licence', () => {
  expect(tasl(hit({})).text).toBe('“Students at a bench” by A. Photographer, Wikimedia Commons, CC BY 4.0')
  expect(tasl(hit({ creator: undefined })).text).toBe('“Students at a bench”, Wikimedia Commons, CC BY 4.0')
  expect(tasl(hit({ provider: 'openverse', license: { kind: 'cc0', name: 'CC0 1.0' } })).text).toBe('“Students at a bench” by A. Photographer, via Openverse, CC0 1.0')
})

test('share-alike is flagged', () => {
  expect(tasl(hit({ license: { kind: 'by-sa', name: 'CC BY-SA 4.0' } })).shareAlike).toBe(true)
  expect(tasl(hit({})).shareAlike).toBe(false)
})
