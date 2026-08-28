import { importText } from './text'

test('pasted text becomes one deterministic semantic page with provenance', async () => {
  const options = {
    metadata: {
      title: 'Week 1 notes',
      author: 'Ada Instructor',
      sourceName: 'Biology Department',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      rightsAuthority: 'open-license' as const,
      rightsAcknowledged: true,
    },
  }
  const input = { kind: 'paste' as const, text: 'Cells < tissues\n\nResearch & practice' }

  const first = await importText(input, options)
  const second = await importText(input, options)

  expect(first.work).toEqual(second.work)
  expect(first.work).toMatchObject({
    title: 'Week 1 notes',
    format: 'text',
    assets: [],
    provenance: {
      kind: 'paste',
      author: 'Ada Instructor',
      sourceName: 'Biology Department',
      license: {
        name: 'CC BY 4.0',
        url: 'https://creativecommons.org/licenses/by/4.0/',
      },
      rights: { authority: 'open-license', acknowledged: true },
    },
  })
  expect(first.work.sections).toEqual([
    expect.objectContaining({
      title: 'Week 1 notes',
      order: 0,
      html: '<p>Cells &lt; tissues</p><p>Research &amp; practice</p>',
    }),
  ])
  expect(first.report).toMatchObject({
    parser: 'native',
    format: 'text',
    findings: [],
    counts: {
      sections: 1,
      headings: 0,
      tables: 0,
      images: 0,
      equations: 0,
      notes: 0,
      unavailableAssets: 0,
    },
  })
  expect(first.report.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
})

test('empty pasted text is rejected with a recoverable explanation', async () => {
  await expect(importText(
    { kind: 'paste', text: ' \n\t ' },
    {
      metadata: {
        title: 'Empty notes',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )).rejects.toThrow('Add some text before creating the preview.')
})

test('title, publishing authority, and responsibility acknowledgement are required', async () => {
  const cases = [
    {
      metadata: { title: ' ', rightsAuthority: 'own' as const, rightsAcknowledged: true },
      message: 'Enter a document title before creating the preview.',
    },
    {
      metadata: { title: 'Notes', rightsAuthority: '' as never, rightsAcknowledged: true },
      message: 'Choose why you have permission to republish this content.',
    },
    {
      metadata: { title: 'Notes', rightsAuthority: 'own' as const, rightsAcknowledged: false },
      message: 'Confirm responsibility for rights and the final accessibility review.',
    },
  ]

  for (const entry of cases) {
    await expect(importText(
      { kind: 'paste', text: 'Useful text' },
      { metadata: entry.metadata },
    )).rejects.toThrow(entry.message)
  }
})

test('a license URL cannot be silently accepted without a license name', async () => {
  await expect(importText(
    { kind: 'paste', text: 'Useful text' },
    {
      metadata: {
        title: 'Notes',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        rightsAuthority: 'open-license',
        rightsAcknowledged: true,
      },
    },
  )).rejects.toThrow('Enter a license name when you provide a license URL.')
})

test('a UTF-8 text file is imported by name and invalid encoding is explained', async () => {
  const metadata = {
    title: 'Uploaded notes',
    rightsAuthority: 'permission' as const,
    rightsAcknowledged: true,
  }
  const valid = new File(['Résumé notes'], 'resume.txt', { type: 'text/plain' })
  const result = await importText({ kind: 'file', file: valid }, { metadata })

  expect(result.work.provenance).toMatchObject({
    kind: 'local-file',
    originalName: 'resume.txt',
  })
  expect(result.report).toMatchObject({
    originalName: 'resume.txt',
    originalBytes: new TextEncoder().encode('Résumé notes').byteLength,
  })
  expect(result.work.sections[0]?.html).toBe('<p>Résumé notes</p>')

  const invalid = new File([new Uint8Array([0xc3, 0x28])], 'broken.txt', { type: 'text/plain' })
  await expect(importText({ kind: 'file', file: invalid }, { metadata }))
    .rejects.toThrow('broken.txt does not contain valid UTF-8 text.')
})

test('file imports accept only .txt files even when another format contains UTF-8 text', async () => {
  await expect(importText(
    { kind: 'file', file: new File(['# Markdown'], 'notes.md', { type: 'text/plain' }) },
    {
      metadata: {
        title: 'Notes',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )).rejects.toThrow('Choose a plain-text file with a .txt extension.')
})

test('oversized text is rejected before the file is read', async () => {
  const file = new File(
    [new Uint8Array((2 * 1024 * 1024) + 1)],
    'too-large.txt',
    { type: 'text/plain' },
  )
  const arrayBuffer = vi.spyOn(file, 'arrayBuffer')

  await expect(importText(
    { kind: 'file', file },
    {
      metadata: {
        title: 'Large notes',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )).rejects.toThrow('Plain-text imports must be 2 MiB or smaller.')
  expect(arrayBuffer).not.toHaveBeenCalled()
})

test('cancelling a file read stops before hashing or creating derived content', async () => {
  const file = new File(['held'], 'held.txt', { type: 'text/plain' })
  let release: ((value: ArrayBuffer) => void) | undefined
  vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise((resolve) => { release = resolve }))
  const digest = vi.spyOn(globalThis.crypto.subtle, 'digest')
  const controller = new AbortController()

  const pending = importText(
    { kind: 'file', file },
    {
      metadata: {
        title: 'Held notes',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
      signal: controller.signal,
    },
  )
  controller.abort()
  release?.(new TextEncoder().encode('held').buffer)

  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(digest).not.toHaveBeenCalled()
})
