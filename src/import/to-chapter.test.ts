import { compileAndAuditChapter } from '../engine'
import type { GateDeps } from '../engine/gate'
import { DOCUMENT } from '../engine/compile/context'
import { buildCartridge } from '../engine/export/cartridge'
import { importText } from './text'
import { toChapter } from './to-chapter'

const cleanGate: GateDeps = {
  validateAllowlist: async (html) => ({ html, removedSemantic: [] }),
  audit: async () => ({ issues: [] }),
}

test('an imported local document crosses the shared Chapter compile and audit seam', async () => {
  const imported = await importText(
    { kind: 'paste', text: 'First paragraph.\n\nSecond paragraph.' },
    {
      metadata: {
        title: 'Week 1 notes',
        sourceName: 'Biology Department',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )

  const chapter = toChapter(imported.work)
  expect(chapter).toMatchObject({
    source: 'document',
    bookId: imported.work.id,
    title: 'Week 1 notes',
    attribution: {
      bookTitle: 'Week 1 notes',
      publisher: 'Biology Department',
      authors: [],
    },
  })
  expect(chapter.attribution.url).toBeUndefined()
  expect(chapter.sections[0]?.id).toBe(imported.work.sections[0]?.id)
  expect(chapter.sections[0]?.contentBaseUrl).toBeUndefined()
  expect(chapter.sections[0]?.canonicalUrl).toBeUndefined()

  const compiled = await compileAndAuditChapter(chapter, { profile: DOCUMENT, deps: cleanGate })
  const html = compiled.sections[0]?.gate?.html ?? ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const source = doc.querySelector('.b2c-attribution p')

  expect(doc.body.textContent).toContain('First paragraph.')
  expect(source?.textContent).toBe('Week 1 notes — source: Biology Department.')
  expect(source?.querySelector('a')).toBeNull()
  expect(doc.body.textContent).toContain('No author or organization was supplied.')
  expect(doc.body.textContent).toContain('No license was supplied.')
  expect(compiled.queue).toEqual([])
})

test('the cartridge writes the exact repaired bytes that passed the gate', async () => {
  const imported = await importText(
    { kind: 'paste', text: 'Before the allowlist' },
    {
      metadata: {
        title: 'Audited notes',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )
  const compiled = await compileAndAuditChapter(toChapter(imported.work), {
    profile: DOCUMENT,
    deps: {
      validateAllowlist: async (html) => ({
        html: html.replace('Before the allowlist', 'Exact repaired bytes'),
        removedSemantic: [],
      }),
      audit: async () => ({ issues: [] }),
    },
  })
  expect(compiled.sections[0]?.html).toContain('Before the allowlist')
  expect(compiled.sections[0]?.gate?.html).toContain('Exact repaired bytes')

  const page = buildCartridge([compiled]).find((entry) => entry.name.startsWith('wiki_content/'))
  const exported = new TextDecoder().decode(page?.data)

  expect(exported).toContain(compiled.sections[0]?.gate?.html)
  expect(exported).not.toContain('Before the allowlist')
})

test('carries packaged assets onto the chapter', () => {
  const asset = {
    id: 'a3f91c2e',
    mediaType: 'image/png',
    extension: 'png',
    bytes: new Uint8Array([1, 2, 3]),
    sha256: 'a3f91c2e',
    originPart: 'word/media/image1.png',
    name: 'image1-a3f91c2e.png',
  }
  const chapter = toChapter({
    id: 'w',
    title: 'T',
    format: 'docx',
    sections: [{ id: 's', title: 'T', order: 0, html: '<p>x</p>' }],
    assets: [asset],
    provenance: { kind: 'local-file', rights: { authority: 'own', acknowledged: true } },
  })
  expect(chapter.assets).toEqual([asset])
})

test('a chapter with no assets carries none rather than an empty promise', () => {
  const chapter = toChapter({
    id: 'w',
    title: 'T',
    format: 'text',
    sections: [{ id: 's', title: 'T', order: 0, html: '<p>x</p>' }],
    assets: [],
    provenance: { kind: 'paste', rights: { authority: 'own', acknowledged: true } },
  })
  expect(chapter.assets).toEqual([])
})
