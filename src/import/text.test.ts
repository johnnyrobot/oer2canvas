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

test('pasted Markdown preserves GFM semantics and reports hostile raw HTML repairs', async () => {
  const result = await importText(
    {
      kind: 'paste',
      format: 'markdown',
      text: [
        '# Cell study guide',
        '',
        '- Membrane',
        '- Nucleus',
        '',
        '| Organelle | Role |',
        '| --- | --- |',
        '| Nucleus | Stores DNA |',
        '',
        '[Safe course](https://example.edu/cells)',
        '',
        '```ts',
        'const cell = "safe"',
        '```',
        '',
        '<script>globalThis.markdownExecuted = true</script>',
        '<a href="javascript:globalThis.markdownExecuted=true" onclick="globalThis.markdownExecuted=true">Unsafe course</a>',
      ].join('\n'),
    },
    {
      metadata: {
        title: 'Biology notes',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )

  const document = new DOMParser().parseFromString(result.work.sections[0]!.html, 'text/html')
  expect(result.work.format).toBe('markdown')
  expect(document.querySelector('h1')?.textContent).toBe('Cell study guide')
  expect([...document.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
    'Membrane',
    'Nucleus',
  ])
  expect(document.querySelector('table')?.textContent).toContain('Stores DNA')
  expect(document.querySelector('pre code')?.textContent).toContain('const cell = "safe"')
  expect(document.querySelector('a[href="https://example.edu/cells"]')?.textContent).toBe('Safe course')
  expect(document.querySelector('script')).toBeNull()
  expect(document.querySelector('[onclick]')).toBeNull()
  expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
  expect(result.report).toMatchObject({
    parser: 'native',
    format: 'markdown',
    counts: { headings: 1, tables: 1, images: 0 },
  })
  expect(result.report.findings.map((finding) => finding.code)).toEqual([
    'import-active-content-removed',
    'import-dangerous-url-removed',
  ])
})

test('Markdown raw HTML and pasted HTML follow the same sanitization policy', async () => {
  const hostile = [
    '<h2>Shared policy</h2>',
    '<figure><figcaption>Unsupported wrapper</figcaption><p>Preserved prose</p></figure>',
    '<p style="position:fixed" onmouseover="globalThis.importExecuted=true">Styled prose</p>',
    '<a href="data:text/html,unsafe">Unsafe link</a>',
    '<iframe srcdoc="<script>globalThis.importExecuted=true</script>"></iframe>',
  ].join('')
  const metadata = {
    title: 'Policy comparison',
    rightsAuthority: 'own' as const,
    rightsAcknowledged: true,
  }

  const [fromMarkdown, fromHtml] = await Promise.all([
    importText({ kind: 'paste', format: 'markdown', text: hostile }, { metadata }),
    importText({ kind: 'paste', format: 'html', text: hostile }, { metadata }),
  ])

  expect(fromMarkdown.work.sections[0]!.html).toBe(fromHtml.work.sections[0]!.html)
  expect(fromHtml.work.sections[0]!.html).toBe(
    '<h2>Shared policy</h2>Unsupported wrapper<p>Preserved prose</p>' +
      '<p>Styled prose</p><a>Unsafe link</a>',
  )
  expect(fromMarkdown.report.findings).toEqual(fromHtml.report.findings)
  expect(fromHtml.report.findings.map((finding) => finding.code)).toEqual([
    'import-active-content-removed',
    'import-dangerous-url-removed',
    'import-unsupported-element-removed',
    'import-unsafe-attribute-removed',
  ])
})

test('a complete HTML document excludes its head and discloses active and unsupported head material', async () => {
  const result = await importText(
    {
      kind: 'paste',
      format: 'html',
      text: '<!doctype html><html><head><title>Source title</title><style>body{display:none}</style></head>' +
        '<body><h2>Visible lesson</h2></body></html>',
    },
    {
      metadata: {
        title: 'Imported lesson',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )

  expect(result.work.sections[0]!.html).toBe('<h2>Visible lesson</h2>')
  expect(result.report.findings.map((finding) => finding.code)).toEqual([
    'import-active-content-removed',
    'import-unsupported-element-removed',
  ])
  expect(result.report.findings[1]?.message).toContain('<title>')
})

test('unsafe attributes on an unsupported wrapper are disclosed before the wrapper is removed', async () => {
  const result = await importText(
    {
      kind: 'paste',
      format: 'html',
      text: '<custom-card onclick="evil()" href="javascript:evil()" style="position:fixed">Visible text</custom-card>',
    },
    {
      metadata: {
        title: 'Custom element',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )

  expect(result.work.sections[0]!.html).toBe('Visible text')
  expect(result.report.findings.map((finding) => finding.code)).toEqual([
    'import-active-content-removed',
    'import-dangerous-url-removed',
    'import-unsupported-element-removed',
    'import-unsafe-attribute-removed',
  ])
  expect(result.report.findings[0]?.message).toContain('onclick handler')
  expect(result.report.findings[1]?.message).toContain('href on <custom-card>')
  expect(result.report.findings[3]?.message).toContain('style on <custom-card>')
})

test('a relative local image is a visible unavailable-asset blocker unless a public base URL is supplied', async () => {
  const file = new File(['<p>Diagram:</p><img src="images/cell.png" alt="A cell">'], 'lesson.html')
  const metadata = {
    title: 'Image lesson',
    rightsAuthority: 'own' as const,
    rightsAcknowledged: true,
  }

  const local = await importText({ kind: 'file', file }, { metadata })
  expect(local.report.findings).toContainEqual(expect.objectContaining({
    code: 'import-relative-image-unavailable',
    severity: 'blocker',
  }))
  expect(local.report.counts).toMatchObject({ images: 1, unavailableAssets: 1 })

  const withBase = await importText(
    { kind: 'file', file },
    { metadata: { ...metadata, sourceUrl: 'https://example.edu/lessons/lesson.html' } },
  )
  expect(withBase.report.findings.map((finding) => finding.code))
    .not.toContain('import-relative-image-unavailable')
  expect(withBase.report.counts).toMatchObject({ images: 1, unavailableAssets: 0 })
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
  )).rejects.toThrow('Add some content before creating the preview.')
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

test.each([
  {
    name: 'study.md',
    format: 'markdown' as const,
    source: '# Study notes\n\n- First topic',
    selector: 'h1',
    text: 'Study notes',
  },
  {
    name: 'lesson.html',
    format: 'html' as const,
    source: '<h2>Lesson notes</h2><p>First topic</p>',
    selector: 'h2',
    text: 'Lesson notes',
  },
])('$name is imported locally through its controlled parser', async ({ name, format, source, selector, text }) => {
  const result = await importText(
    { kind: 'file', file: new File([source], name) },
    {
      metadata: {
        title: 'Uploaded content',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )

  const document = new DOMParser().parseFromString(result.work.sections[0]!.html, 'text/html')
  expect(result.work.format).toBe(format)
  expect(document.querySelector(selector)?.textContent).toBe(text)
  expect(result.report).toMatchObject({
    parser: 'native',
    format,
    originalName: name,
    originalBytes: new TextEncoder().encode(source).byteLength,
  })
})

test('file imports accept only enabled text-like extensions even when another format contains UTF-8 text', async () => {
  await expect(importText(
    { kind: 'file', file: new File(['{\\rtf1 not really RTF}'], 'notes.rtf', { type: 'text/plain' }) },
    {
      metadata: {
        title: 'Notes',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )).rejects.toThrow('Choose a text, Markdown, or HTML file')
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

test('an oversized HTML file is rejected by format before the file is read', async () => {
  const file = new File(['not read'], 'too-large.html', { type: 'text/html' })
  Object.defineProperty(file, 'size', {
    configurable: true,
    value: (2 * 1024 * 1024) + 1,
  })
  const arrayBuffer = vi.spyOn(file, 'arrayBuffer')

  await expect(importText(
    { kind: 'file', file },
    {
      metadata: {
        title: 'Large HTML',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )).rejects.toThrow('HTML imports must be 2 MiB or smaller.')
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
