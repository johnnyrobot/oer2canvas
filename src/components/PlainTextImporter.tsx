import { useRef, useState, type FormEvent } from 'react'
import { importText, MAX_TEXT_IMPORT_BYTES } from '../import/text'
import { PLAIN_TEXT_FILE_ACCEPT } from '../import/capability'
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

export function PlainTextImporter({ onConfirm }: { onConfirm: (result: ImportResult) => void }) {
  const [mode, setMode] = useState<'paste' | 'file'>('paste')
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
      setError('Choose a .txt file before creating the preview.')
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
        mode === 'paste' ? { kind: 'paste', text } : { kind: 'file', file: file! },
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
    return (
      <section aria-labelledby="plain-text-preview-heading" className="mt-5 max-w-3xl">
        <h3 id="plain-text-preview-heading" className="text-lg font-semibold">
          Preview: {result.work.title}
        </h3>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          Plain text · Native browser parser · One Canvas page · {result.work.assets.length} packaged assets ·{' '}
          {result.report.originalBytes?.toLocaleString()} bytes · processed in this browser
        </p>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          {result.report.findings.length === 0
            ? 'No extraction warnings or blockers.'
            : `${result.report.findings.length} extraction findings require review.`}
        </p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="font-medium">Source</dt>
          <dd>{provenance.sourceName ?? provenance.originalName ?? 'User-provided text'}</dd>
          <dt className="font-medium">Author</dt>
          <dd>{provenance.author ?? 'Not supplied'}</dd>
          <dt className="font-medium">Rights basis</dt>
          <dd>{IMPORT_RIGHTS_OPTIONS.find((option) => option.value === provenance.rights.authority)?.label}</dd>
        </dl>
        <div className="mt-4 rounded-lg border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          {/* `importText` creates this markup by escaping every source character;
              raw user input is never parsed as HTML or attached to the live DOM. */}
          <div dangerouslySetInnerHTML={{ __html: result.work.sections[0]!.html }} />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="min-h-9 rounded-md bg-brand-700 px-4 text-sm font-medium text-white"
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
        <legend className="text-sm font-medium">Plain-text source</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          <label className="flex min-h-9 items-center gap-2">
            <input
              type="radio"
              name="plain-text-source"
              checked={mode === 'paste'}
              onChange={() => setMode('paste')}
            />
            Paste text
          </label>
          <label className="flex min-h-9 items-center gap-2">
            <input
              type="radio"
              name="plain-text-source"
              checked={mode === 'file'}
              onChange={() => setMode('file')}
            />
            Upload a .txt file
          </label>
        </div>
      </fieldset>

      {mode === 'paste' ? (
        <label className="mt-4 block text-sm font-medium">
          Text to import
          <textarea
            required
            rows={10}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
      ) : (
        <label className="mt-4 block text-sm font-medium">
          Text file
          <input
            type="file"
            accept={PLAIN_TEXT_FILE_ACCEPT}
            aria-describedby="plain-text-file-help"
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              setFile(chosen)
              if (chosen && !metadata.title.trim()) {
                setMetadata((current) => ({
                  ...current,
                  title: chosen.name.replace(/\.txt$/i, ''),
                }))
              }
            }}
            className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <span id="plain-text-file-help" className="mt-1 block font-normal text-neutral-600 dark:text-neutral-400">
            UTF-8 text, up to {MAX_TEXT_IMPORT_BYTES / 1024 / 1024} MiB. The file stays in this browser.
          </span>
        </label>
      )}

      <ImportMetadataFields
        value={metadata}
        onChange={setMetadata}
        idPrefix="plain-text"
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
      <p role="status" aria-live="polite" className="mt-4 text-sm">{busy ? 'Reading text locally…' : ''}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="min-h-9 rounded-md bg-brand-700 px-4 text-sm font-medium text-white disabled:opacity-60">
          Create one-page preview
        </button>
        {busy && (
          <button type="button" className="min-h-9 rounded-md border px-4 text-sm" onClick={() => run.current?.abort()}>
            Cancel import for {metadata.title.trim() || file?.name || 'plain text'}
          </button>
        )}
      </div>
    </form>
  )
}
