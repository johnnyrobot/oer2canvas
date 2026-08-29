import type { Document } from '@firecrawl/anydoc-wasm'
import { prepareAssets } from '../assets'
import { PARSER_PROBE_LIMITS } from '../parser-limit-values'
import { RASTER_FIXTURES } from '../testing/raster-fixtures'
import { normalizeAnyDocDocument, UnsupportedAnyDocVersionError } from './anydoc-html'

const paragraph = (text: string) => ({
  kind: 'paragraph' as const,
  content: [{ kind: 'text' as const, text }],
})

test('heading and inline anchors receive stable unique ids and internal links target them', () => {
  const document: Document = {
    notes: [],
    assets: [],
    blocks: [
      { kind: 'heading', level: 1, anchor: 'Cell Biology', content: [{ kind: 'text', text: 'Cells' }] },
      {
        kind: 'paragraph',
        content: [{
          kind: 'link',
          target: { kind: 'anchor', value: 'Cell Biology' },
          content: [{ kind: 'text', text: 'Return to cells' }],
        }],
      },
      { kind: 'heading', level: 2, anchor: 'Cell@Biology', content: [{ kind: 'text', text: 'Details' }] },
      {
        kind: 'paragraph',
        content: [{
          kind: 'link',
          target: { kind: 'anchor', value: 'Cell@Biology' },
          content: [{ kind: 'text', text: 'Read details' }],
        }],
      },
    ],
  }

  const normalized = normalizeAnyDocDocument(document)
  const html = new DOMParser().parseFromString(normalized.html, 'text/html')

  expect(html.querySelector('h1')?.getAttribute('id')).toBe('Cell-Biology')
  expect(html.querySelector('h2')?.getAttribute('id')).toBe('Cell-Biology-2')
  expect(html.querySelectorAll('a')[0]?.getAttribute('href')).toBe('#Cell-Biology')
  expect(html.querySelectorAll('a')[1]?.getAttribute('href')).toBe('#Cell-Biology-2')
  expect(normalized.findings).toEqual([])
})

test('an unresolved internal link keeps its label and creates a visible warning', () => {
  const document: Document = {
    notes: [],
    assets: [],
    blocks: [{
      kind: 'paragraph',
      content: [{
        kind: 'link',
        target: { kind: 'anchor', value: 'missing' },
        content: [{ kind: 'text', text: 'Missing section' }],
      }],
    }],
  }

  const normalized = normalizeAnyDocDocument(document)

  expect(normalized.html).toBe('<p>Missing section</p>')
  expect(normalized.findings).toContainEqual(expect.objectContaining({
    code: 'unresolved-link',
    severity: 'warning',
  }))
})

test('layout tables are linearized with a warning while data tables retain table semantics', () => {
  const document: Document = {
    notes: [],
    assets: [],
    blocks: [
      {
        kind: 'table',
        table: {
          kind: 'layout',
          headerRows: 0,
          grid: [[
            { kind: 'origin', cell: { blocks: [paragraph('Left')], colSpan: 1, rowSpan: 1 } },
            { kind: 'origin', cell: { blocks: [paragraph('Right')], colSpan: 1, rowSpan: 1 } },
          ]],
        },
      },
      {
        kind: 'table',
        table: {
          kind: 'data',
          headerRows: 1,
          grid: [[
            { kind: 'origin', cell: { blocks: [paragraph('Term')], colSpan: 1, rowSpan: 1 } },
            { kind: 'origin', cell: { blocks: [paragraph('Meaning')], colSpan: 1, rowSpan: 1 } },
          ]],
        },
      },
    ],
  }

  const normalized = normalizeAnyDocDocument(document)
  const html = new DOMParser().parseFromString(normalized.html, 'text/html')

  expect([...html.body.children].map((element) => element.tagName)).toEqual(['P', 'P', 'TABLE'])
  expect(html.querySelectorAll('table')).toHaveLength(1)
  expect(html.querySelectorAll('thead th')).toHaveLength(2)
  expect(normalized.findings).toContainEqual(expect.objectContaining({
    code: 'layout-table',
    severity: 'warning',
  }))
})

test('ordered lists preserve start, marker family, nesting, and literal marker overrides', () => {
  const document: Document = {
    notes: [],
    assets: [],
    blocks: [{
      kind: 'list',
      list: {
        marker: 'lowerAlpha',
        start: 3,
        items: [
          { blocks: [paragraph('Third')] },
          {
            markerLabel: '4-b)',
            blocks: [
              paragraph('Composite'),
              {
                kind: 'list',
                list: { marker: 'upperRoman', start: 2, items: [{ blocks: [paragraph('Nested')] }] },
              },
            ],
          },
        ],
      },
    }],
  }

  const html = new DOMParser().parseFromString(
    normalizeAnyDocDocument(document).html,
    'text/html',
  )

  expect(html.querySelector('ol')?.getAttribute('start')).toBe('3')
  expect(html.querySelector('ol')?.getAttribute('type')).toBe('a')
  expect(html.querySelector('li[style]')?.textContent).toContain('4-b) Composite')
  expect(html.querySelector('ol ol')?.getAttribute('start')).toBe('2')
  expect(html.querySelector('ol ol')?.getAttribute('type')).toBe('I')
})

test('unknown future block and inline kinds fail as an unsupported AnyDoc version', () => {
  const futureBlock = {
    notes: [], assets: [], blocks: [{ kind: 'futureBlock' }],
  } as unknown as Document
  const futureInline = {
    notes: [], assets: [], blocks: [{ kind: 'paragraph', content: [{ kind: 'futureInline' }] }],
  } as unknown as Document

  expect(() => normalizeAnyDocDocument(futureBlock)).toThrow(UnsupportedAnyDocVersionError)
  expect(() => normalizeAnyDocDocument(futureInline)).toThrow(UnsupportedAnyDocVersionError)
})

const documentWith = (assets: { id: number; mediaType: string; originPart: string; data: Uint8Array }[]) => ({
  kind: 'document',
  blocks: [{
    kind: 'paragraph',
    content: assets.map((asset) => ({
      kind: 'image', alt: `Figure ${asset.id}`, source: { kind: 'asset', assetId: asset.id },
    })),
  }],
  assets, notes: [],
}) as never

test('packages a validated raster as a cartridge reference with its true size', async () => {
  const assets = [{ id: 0, mediaType: 'image/png', originPart: 'word/media/image1.png', data: RASTER_FIXTURES.png.bytes }]
  const result = normalizeAnyDocDocument(documentWith(assets), 'docx', await prepareAssets(assets))

  expect(result.html).toContain('src="$IMS-CC-FILEBASE$/oer2canvas/image1-')
  expect(result.html).toContain('alt="Figure 0"')
  expect(result.html).toContain('width="16"')
  expect(result.html).toContain('height="16"')
  expect(result.html).not.toContain('[Embedded image')
  expect(result.findings.some((finding) => finding.code === 'embedded-content')).toBe(false)
  expect(result.packagedAssets).toHaveLength(1)
})

test('two references to identical bytes package once and share one reference', async () => {
  const bytes = RASTER_FIXTURES.gif.bytes
  const assets = [
    { id: 0, mediaType: 'image/gif', originPart: 'a/one.gif', data: bytes },
    { id: 1, mediaType: 'image/gif', originPart: 'b/two.gif', data: bytes },
  ]
  const result = normalizeAnyDocDocument(documentWith(assets), 'epub', await prepareAssets(assets))
  const references = [...result.html.matchAll(/src="([^"]+)"/g)].map((match) => match[1])
  expect(references).toHaveLength(2)
  expect(references[0]).toBe(references[1])
  expect(result.packagedAssets).toHaveLength(1)
})

test('an unsupported asset keeps the blocker and the visible placeholder', async () => {
  const assets = [{
    id: 0, mediaType: 'image/svg+xml', originPart: 'a.svg',
    data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  }]
  const result = normalizeAnyDocDocument(documentWith(assets), 'docx', await prepareAssets(assets))
  expect(result.html).toContain('[Embedded image: Figure 0]')
  expect(result.findings.some((finding) => finding.code === 'embedded-content')).toBe(true)
  expect(result.packagedAssets).toHaveLength(0)
  // A rejected asset becomes a placeholder just like a genuinely unavailable
  // one, so it must move the same user-facing counter — not just images
  // whose `source.kind` is literally `'unavailable'`.
  expect(result.unavailableAssets).toBe(1)
})

test('an unavailable image still blocks even when other assets package', async () => {
  const assets = [{ id: 0, mediaType: 'image/png', originPart: 'ok.png', data: RASTER_FIXTURES.png.bytes }]
  const document = {
    kind: 'document',
    blocks: [{ kind: 'paragraph', content: [
      { kind: 'image', alt: 'Fine', source: { kind: 'asset', assetId: 0 } },
      { kind: 'image', alt: 'Gone', source: { kind: 'unavailable' } },
    ] }],
    assets, notes: [],
  } as never
  const result = normalizeAnyDocDocument(document, 'docx', await prepareAssets(assets))
  expect(result.html).toContain('$IMS-CC-FILEBASE$')
  expect(result.html).toContain('[Embedded image: Gone]')
  expect(result.findings.some((finding) => finding.code === 'embedded-content')).toBe(true)
})

test('an external image at a public host is left as a remote url, not packaged, with a hotlink warning', async () => {
  const document = {
    kind: 'document',
    blocks: [{ kind: 'paragraph', content: [
      { kind: 'image', alt: 'Remote', source: { kind: 'external', url: 'https://example.org/a.png' } },
    ] }],
    assets: [], notes: [],
  } as never
  const result = normalizeAnyDocDocument(document, 'epub', await prepareAssets([]))
  expect(result.html).toContain('src="https://example.org/a.png"')
  expect(result.packagedAssets).toHaveLength(0)
  expect(result.findings).toContainEqual(expect.objectContaining({
    code: 'external-image',
    severity: 'warning',
  }))
})

test('an external image at a non-public host is refused, not hotlinked', async () => {
  const document = {
    kind: 'document',
    blocks: [{ kind: 'paragraph', content: [
      { kind: 'image', alt: 'Internal', source: { kind: 'external', url: 'http://localhost/internal.png' } },
    ] }],
    assets: [], notes: [],
  } as never
  const result = normalizeAnyDocDocument(document, 'epub', await prepareAssets([]))
  expect(result.html).not.toContain('<img')
  expect(result.html).toContain('[Embedded image: Internal]')
  expect(result.findings).toContainEqual(expect.objectContaining({
    code: 'embedded-content',
    severity: 'blocker',
  }))
  expect(result.findings.some((finding) => finding.code === 'external-image')).toBe(false)
})

test('an asset no image ever refers to raises a warning instead of vanishing silently', async () => {
  // anydoc documents `Asset` as any embedded binary payload, not only images
  // (an OLE object payload lands in `document.assets` too, with no inline
  // image ever pointing at it). Removing the old blanket "any assets present"
  // blocker must not also remove the only signal this case had.
  const assets = [{ id: 0, mediaType: 'application/octet-stream', originPart: 'objects/embed1.bin', data: new Uint8Array([1, 2, 3]) }]
  const document = {
    kind: 'document',
    blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: 'No image here.' }] }],
    assets, notes: [],
  } as never
  const result = normalizeAnyDocDocument(document, 'docx', await prepareAssets(assets))
  expect(result.findings).toContainEqual(expect.objectContaining({
    code: 'unreferenced-asset',
    severity: 'warning',
  }))
})

test('missing alt and explicit empty alt both omit the attribute; real alt text renders it', async () => {
  // anydoc 0.2.4 never actually produces `undefined` for `Inline.alt` on any
  // supported format (verified empirically against the wasm directly) — it
  // collapses "no alt carrier at all" and "author wrote alt=''" to the same
  // `''`. Since those two source states cannot be told apart, this renderer
  // treats BOTH the synthetic `undefined` case (kept here for robustness,
  // even though the real parser never sends it) and an explicit `''` as
  // UNDESCRIBED, omitting the `alt` attribute for both — which routes the
  // image into the "describe this" queue rather than "confirm decorative".
  // Only real alt text renders the attribute at all. See `anydoc-html.ts`'s
  // `alt`/`altAttribute` comment and `engine/compile/steps/alt.ts`'s header
  // for why an empty alt is treated as an unfilled field, not a decorative
  // declaration.
  const assets = [
    { id: 0, mediaType: 'image/png', originPart: 'no-alt.png', data: RASTER_FIXTURES.png.bytes },
    { id: 1, mediaType: 'image/gif', originPart: 'empty-alt.gif', data: RASTER_FIXTURES.gif.bytes },
    { id: 2, mediaType: 'image/jpeg', originPart: 'real-alt.jpg', data: RASTER_FIXTURES.jpeg.bytes },
  ]
  const document = {
    kind: 'document',
    blocks: [{ kind: 'paragraph', content: [
      { kind: 'image', source: { kind: 'asset', assetId: 0 } },
      { kind: 'image', alt: '', source: { kind: 'asset', assetId: 1 } },
      { kind: 'image', alt: 'A photograph of a cell wall', source: { kind: 'asset', assetId: 2 } },
    ] }],
    assets, notes: [],
  } as never
  const result = normalizeAnyDocDocument(document, 'docx', await prepareAssets(assets))
  const images = [...new DOMParser().parseFromString(result.html, 'text/html').querySelectorAll('img')]
  expect(images).toHaveLength(3)
  expect(images[0]!.hasAttribute('alt')).toBe(false)
  expect(images[1]!.hasAttribute('alt')).toBe(false)
  expect(images[2]!.getAttribute('alt')).toBe('A photograph of a cell wall')
})

test('every reason an image was refused is reported, with counts', async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
  const oversized = new Uint8Array(PARSER_PROBE_LIMITS.maximumIndividualAssetBytes + 1)
  oversized.set(RASTER_FIXTURES.png.bytes)
  const assets = [
    { id: 0, mediaType: 'image/svg+xml', originPart: 'a.svg', data: svg },
    { id: 1, mediaType: 'image/png', originPart: 'b.png', data: oversized },
  ]
  const document = {
    kind: 'document',
    blocks: [{ kind: 'paragraph', content: [
      { kind: 'image', alt: 'A', source: { kind: 'asset', assetId: 0 } },
      { kind: 'image', alt: 'B', source: { kind: 'asset', assetId: 1 } },
      { kind: 'image', alt: 'C', source: { kind: 'unavailable' } },
    ] }],
    assets, notes: [],
  } as never

  const result = normalizeAnyDocDocument(document, 'docx', await prepareAssets(assets))
  const blocker = result.findings.find((f) => f.code === 'embedded-content')!

  // One finding, not three — but it must name all three causes with counts.
  expect(result.findings.filter((f) => f.code === 'embedded-content')).toHaveLength(1)
  expect(blocker.message).toMatch(/3 images/)
  expect(blocker.message).toMatch(/1 in an unsupported or corrupt format/)
  expect(blocker.message).toMatch(/1 over the size budget/)
  expect(blocker.message).toMatch(/1 with missing or unreadable bytes/)
  // Every one still leaves a visible placeholder.
  expect(result.html.match(/\[Embedded image/g)).toHaveLength(3)
  expect(result.unavailableAssets).toBe(3)
})

test('a single refusal reads naturally rather than as a list of one', async () => {
  const assets = [{
    id: 0, mediaType: 'image/svg+xml', originPart: 'a.svg',
    data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  }]
  const document = {
    kind: 'document',
    blocks: [{ kind: 'paragraph', content: [
      { kind: 'image', alt: 'A', source: { kind: 'asset', assetId: 0 } },
    ] }],
    assets, notes: [],
  } as never
  const result = normalizeAnyDocDocument(document, 'docx', await prepareAssets(assets))
  const blocker = result.findings.find((f) => f.code === 'embedded-content')!
  // CONTROLLER RULING: the brief's original regex here was
  // `/1 image could not be packaged/`, but the message this same brief
  // specifies renders "1 image THAT could not be packaged" — the multi-cause
  // example sentence includes "that" and the singular case reuses the same
  // template. The message text is correct; the brief's test regex had a typo.
  expect(blocker.message).toMatch(/1 image that could not be packaged/)
  expect(blocker.message).toMatch(/unsupported or corrupt format/)
})
