import { useRef, useState, type FormEvent } from 'react'
import { importText, MAX_TEXT_IMPORT_BYTES, type TextLikeFormat } from '../import/text'
import { TEXT_CONTENT_FILE_ACCEPT, capabilityForFormat } from '../import/capability'
import type { ImportResult } from '../import/types'
import { isAbortError, messageOf } from '../errors'
import { MISSING_RIGHTS_MESSAGE } from '../import/common'
import {
  completeImportMetadata,
  emptyImportMetadata,
  ImportMetadataFields,
  IMPORT_RIGHTS_OPTIONS,
  useImportErrorFocus,
} from './ImportMetadataFields'

export function TextContentImporter({ onConfirm }: { onConfirm: (result: ImportResult) => void }) {
  const [mode, setMode] = useState<'paste' | 'file'>('paste')
  const [pasteFormat, setPasteFormat] = useState<TextLikeFormat>('text')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | undefined>()
  const [metadata, setMetadata] = useState(emptyImportMetadata)
  const [result, setResult] = useState<ImportResult | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = useRef<AbortController | undefined>(undefined)
  const errorElement = useImportErrorFocus(error)

  async function createPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (mode === 'file' && !file) {
      setError('Choose a text, Markdown, or HTML file before creating the preview.')
      return
    }
    if (!metadata.rightsAuthority) {
      setError(MISSING_RIGHTS_MESSAGE)
      return
    }

    const controller = new AbortController()
    run.current = controller
    setBusy(true)
    try {
      const imported = await importText(
        mode === 'paste' ? { kind: 'paste', text, format: pasteFormat } : { kind: 'file', file: file! },
        {
          metadata: completeImportMetadata(metadata),
          signal: controller.signal,
        },
      )
      setResult(imported)
    } catch (caught) {
      setError(isAbortError(caught) ? 'Import cancelled. You can edit the source and try again.' : messageOf(caught))
    } finally {
      setBusy(false)
      run.current = undefined
    }
  }

  if (result) {
    const provenance = result.work.provenance
    const capability = capabilityForFormat(result.work.format)
    const blockers = result.report.findings.filter((finding) => finding.severity === 'blocker')
    return (
      <section aria-labelledby="text-content-preview-heading" className="mt-5 max-w-3xl">
        <h3 id="text-content-preview-heading" className="text-lg font-semibold">
          Preview: {result.work.title}
        </h3>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          {capability?.label ?? result.work.format.toUpperCase()} ·{' '}
          {result.work.format === 'markdown' ? 'Marked GFM browser parser' : 'Native browser parser'} ·{' '}
          One Canvas page · {result.report.counts.headings} headings · {result.report.counts.tables} tables ·{' '}
          {result.work.assets.length} packaged assets ·{' '}
          {result.report.originalBytes?.toLocaleString()} bytes · processed in this browser
        </p>
        {result.report.findings.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            No extraction warnings or blockers.
          </p>
        ) : (
          <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-medium">
              {blockers.length > 0
                ? 'This content cannot be prepared because sanitization left a blocker.'
                : 'Review the material removed during safe import.'}
            </p>
            <ul role="list" className="mt-2 list-disc space-y-1 pl-5">
              {result.report.findings.map((finding) => (
                <li key={finding.code}>
                  <strong>{finding.severity === 'blocker' ? 'Blocker' : 'Warning'}:</strong>{' '}
                  {finding.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="font-medium">Source</dt>
          <dd>{provenance.sourceName ?? provenance.originalName ?? 'User-provided content'}</dd>
          <dt className="font-medium">Author</dt>
          <dd>{provenance.author ?? 'Not supplied'}</dd>
          <dt className="font-medium">Rights basis</dt>
          <dd>{IMPORT_RIGHTS_OPTIONS.find((option) => option.value === provenance.rights.authority)?.label}</dd>
        </dl>
        <div className="mt-4 rounded-lg border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          {/* `importText` either escapes every source character or returns the
              controlled result of the inert Markdown/HTML sanitizer. */}
          <div dangerouslySetInnerHTML={{ __html: result.work.sections[0]!.html }} />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={blockers.length > 0}
            className="min-h-9 rounded-md bg-brand-700 px-4 text-sm font-medium text-white disabled:opacity-60"
            onClick={() => onConfirm(result)}
          >
            Prepare this page
          </button>
          <button
            type="button"
            className="min-h-9 rounded-md border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
            onClick={() => setResult(undefined)}
          >
            Edit import
          </button>
        </div>
      </section>
    )
  }

  return (
    <form className="mt-5 max-w-3xl" onSubmit={(event) => { void createPreview(event) }}>
      <fieldset>
        <legend className="text-sm font-medium">Text and markup source</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          <label className="flex min-h-9 items-center gap-2">
            <input
              type="radio"
              name="text-content-source"
              checked={mode === 'paste'}
              onChange={() => setMode('paste')}
            />
            Paste content
          </label>
          <label className="flex min-h-9 items-center gap-2">
            <input
              type="radio"
              name="text-content-source"
              checked={mode === 'file'}
              onChange={() => setMode('file')}
            />
            Upload a text, Markdown, or HTML file
          </label>
        </div>
      </fieldset>

      {mode === 'paste' ? (
        <>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Pasted content format</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {([
                ['text', 'Plain text'],
                ['markdown', 'Markdown'],
                ['html', 'HTML'],
              ] as const).map(([format, label]) => (
                <label key={format} className="flex min-h-9 items-center gap-2">
                  <input
                    type="radio"
                    name="pasted-content-format"
                    checked={pasteFormat === format}
                    onChange={() => setPasteFormat(format)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="mt-4 block text-sm font-medium">
            Content to import
            <textarea
              required
              rows={10}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
        </>
      ) : (
        <label className="mt-4 block text-sm font-medium">
          Content file
          <input
            type="file"
            accept={TEXT_CONTENT_FILE_ACCEPT}
            aria-describedby="text-content-file-help"
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              setFile(chosen)
              if (chosen && !metadata.title.trim()) {
                setMetadata((current) => ({
                  ...current,
                  title: chosen.name.replace(/\.(?:txt|md|markdown|html|htm)$/i, ''),
                }))
              }
            }}
            className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <span id="text-content-file-help" className="mt-1 block font-normal text-neutral-600 dark:text-neutral-400">
            UTF-8 .txt, .md, .markdown, .html, or .htm, up to{' '}
            {MAX_TEXT_IMPORT_BYTES / 1024 / 1024} MiB. The file stays in this browser.
          </span>
        </label>
      )}

      <ImportMetadataFields
        value={metadata}
        onChange={setMetadata}
        idPrefix="text-content"
      />

      {error && (
        <p
          ref={errorElement}
          role="alert"
          tabIndex={-1}
          className="mt-4 text-sm text-red-700 outline-none focus:ring-2 focus:ring-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <p role="status" aria-live="polite" className="mt-4 text-sm">{busy ? 'Reading content locally…' : ''}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="min-h-9 rounded-md bg-brand-700 px-4 text-sm font-medium text-white disabled:opacity-60">
          Create one-page preview
        </button>
        {busy && (
          <button type="button" className="min-h-9 rounded-md border px-4 text-sm" onClick={() => run.current?.abort()}>
            Cancel import for {metadata.title.trim() || file?.name || 'this content'}
          </button>
        )}
      </div>
    </form>
  )
}
