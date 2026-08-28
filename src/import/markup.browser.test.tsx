import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import { TextContentImporter } from '../components/TextContentImporter'
import { ImportPlanEditor, createImportDraft, type ImportDraft } from '../components/ImportPlanEditor'
import { ChapterView } from '../components/ChapterView'
import { compileAndAuditChapter } from '../engine'
import { DOCUMENT } from '../engine/compile/context'
import { buildCartridge } from '../engine/export/cartridge'
import { importText } from './text'
import { toChapter } from './to-chapter'

const EXECUTION_FLAG = '__oer2canvasHostileImportExecuted'
const HOSTILE_HTML = [
  '<h1>Hostile lesson</h1>',
  `<p style="position:fixed;inset:0" onmouseenter="parent.${EXECUTION_FLAG} += 1">Safe prose</p>`,
  `<img alt="A diagram" src="/__missing-hostile-image.png" onerror="parent.${EXECUTION_FLAG} += 1">`,
  `<a href="javascript:parent.${EXECUTION_FLAG} += 1">Unsafe link</a>`,
  `<script>parent.${EXECUTION_FLAG} += 1</script>`,
  `<iframe srcdoc="&lt;script>parent.parent.${EXECUTION_FLAG} += 1&lt;/script>"></iframe>`,
  `<svg onload="parent.${EXECUTION_FLAG} += 1"><circle></circle></svg>`,
  '<form action="https://example.edu/collect"><button>Submit me</button></form>',
  '<marquee>Preserved unsupported text</marquee>',
].join('')
const HOSTILE_MARKDOWN = [
  '# Hostile Markdown lesson',
  '',
  '- Preserved Markdown list item',
  '',
  'Equation: \\(E=mc^2\\)',
  '',
  `[Unsafe Markdown link](javascript:parent.${EXECUTION_FLAG}+=1)`,
  '',
  HOSTILE_HTML,
].join('\n')
const PIPELINE_HTML = HOSTILE_HTML.replace(
  `<img alt="A diagram" src="/__missing-hostile-image.png" onerror="parent.${EXECUTION_FLAG} += 1">`,
  '',
)
const PIPELINE_MARKDOWN = HOSTILE_MARKDOWN.replace(HOSTILE_HTML, PIPELINE_HTML)

type ExecutionGlobal = typeof globalThis & Record<typeof EXECUTION_FLAG, number>

/** The form and the plan editor it hands off to, as `App` wires them. */
function TextImportFlow() {
  const [draft, setDraft] = useState<ImportDraft | undefined>()
  return draft
    ? <ImportPlanEditor draft={draft} onChange={setDraft} onConfirm={() => {}} onDiscard={() => setDraft(undefined)} />
    : <TextContentImporter onImported={(result) => setDraft(createImportDraft(result))} />
}
const executionGlobal = globalThis as ExecutionGlobal

afterEach(() => {
  cleanup()
  delete (globalThis as Partial<ExecutionGlobal>)[EXECUTION_FLAG]
})

test.each([
  { label: 'pasted HTML', mode: 'paste' as const, format: 'HTML', source: HOSTILE_HTML },
  { label: 'an HTML file', mode: 'file' as const, format: 'HTML', source: HOSTILE_HTML },
  { label: 'pasted Markdown', mode: 'paste' as const, format: 'Markdown', source: HOSTILE_MARKDOWN },
])('hostile content from $label stays inert in the import preview and discloses every repair category', async ({ mode, format, source }) => {
  executionGlobal[EXECUTION_FLAG] = 0
  const { container } = render(<TextImportFlow />)
  fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Hostile import' } })
  if (mode === 'paste') {
    fireEvent.click(screen.getByRole('radio', { name: format }))
    fireEvent.change(screen.getByLabelText('Content to import'), { target: { value: source } })
  } else {
    fireEvent.click(screen.getByRole('radio', { name: 'Upload a text, Markdown, or HTML file' }))
    fireEvent.change(screen.getByLabelText(/^Content file/), {
      target: { files: [new File([HOSTILE_HTML], 'hostile.html', { type: 'text/html' })] },
    })
  }
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create page plan' }))

  expect(await screen.findByRole('heading', { name: 'Page plan: Hostile import' })).toBeVisible()
  for (const summary of screen.getAllByText(/^Preview /)) fireEvent.click(summary)
  expect(await screen.findByText('Safe prose')).toBeVisible()
  await new Promise<void>((resolve) => setTimeout(resolve, 50))

  expect(executionGlobal[EXECUTION_FLAG]).toBe(0)
  expect(container.querySelector('script, iframe, svg, form, [onerror], [onmouseenter], [style]')).toBeNull()
  expect(container.querySelector('a[href]')).toBeNull()
  expect(screen.getByText('Safe prose')).toBeVisible()
  expect(container).toHaveTextContent('Submit mePreserved unsupported text')
  expect(screen.getByText(/Removed active content that could execute or submit data/i)).toBeVisible()
  expect(screen.getByText(/Removed unsafe URL values/i)).toBeVisible()
  expect(screen.getByText(/Removed unsupported element wrappers/i)).toBeVisible()
  expect(screen.getByText(/Removed unsupported or unsafe attributes/i)).toBeVisible()
})

test.each([
  { format: 'html' as const, source: PIPELINE_HTML },
  { format: 'markdown' as const, source: PIPELINE_MARKDOWN },
])('hostile $format stays inert through real audit and review, and audited bytes reach the cartridge unchanged', async ({ format, source }) => {
  executionGlobal[EXECUTION_FLAG] = 0
  const imported = await importText(
    { kind: 'paste', format, text: source },
    {
      metadata: {
        title: 'Hostile import',
        sourceUrl: 'https://example.edu/fixtures/hostile-source.html',
        rightsAuthority: 'own',
        rightsAcknowledged: true,
      },
    },
  )

  const compiled = await compileAndAuditChapter(toChapter(imported.work), { profile: DOCUMENT })
  const audited = compiled.sections[0]!.gate!.html
  expect(compiled.sections[0]!.gate!.conformance.blockers).toEqual([])
  if (format === 'markdown') {
    expect(new DOMParser().parseFromString(audited, 'text/html').querySelector('math')).not.toBeNull()
  }
  expect(executionGlobal[EXECUTION_FLAG]).toBe(0)

  const { container } = render(<ChapterView compiled={compiled} />)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(executionGlobal[EXECUTION_FLAG]).toBe(0)
  expect(container.querySelector('script, iframe, svg, form, [onerror], [onmouseenter]')).toBeNull()
  expect([...container.querySelectorAll('[style]')].some((element) =>
    element.getAttribute('style')?.includes('position: fixed'))).toBe(false)

  const page = buildCartridge([compiled]).find((entry) => entry.name.startsWith('wiki_content/'))
  const exported = new TextDecoder().decode(page!.data)
  expect(exported).toContain(`<body>${audited}</body>`)
  expect(exported).not.toMatch(/<script|<iframe|<svg|<form|\son\w+=|javascript:/i)
})
