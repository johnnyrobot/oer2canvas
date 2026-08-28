import { useRef, useState, type FormEvent } from 'react'
import { importStructuredDocument } from '../import/document'
import { DOCUMENT_IMPORT_LIMITS } from '../import/limits'
import {
  STRUCTURED_DOCUMENT_FILE_ACCEPT,
  STRUCTURED_DOCUMENT_FORMAT_SUMMARY,
  capabilityForFilename,
} from '../import/capability'
import type { ImportResult } from '../import/types'
import type { ParserProbeProgressPhase } from '../import/parsers/probe'
import { isAbortError, messageOf } from '../errors'
import { MISSING_RIGHTS_MESSAGE } from '../import/common'
import {
  completeImportMetadata,
  emptyImportMetadata,
  ImportMetadataFields,
  useImportErrorFocus,
} from './ImportMetadataFields'

const PROGRESS_LABEL: Readonly<Record<ParserProbeProgressPhase, string>> = {
  'loading-parser': 'Loading the local document parser…',
  'parser-ready': 'Document parser ready…',
  parsing: 'Reading the document locally…',
  complete: 'Document inspection complete.',
}

/**
 * The structured-document form. Parsing happens in the Worker; the result is
 * handed to the owner, whose `ImportPlanEditor` shows findings, the proposed
 * pages, and the preview. See `TextContentImporter` for the same division.
 */
export function DocumentImporter({ onImported }: { onImported: (result: ImportResult) => void }) {
  const [file, setFile] = useState<File | undefined>()
  const [metadata, setMetadata] = useState(emptyImportMetadata)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const run = useRef<AbortController | undefined>(undefined)
  const errorElement = useImportErrorFocus(error)
  const selectedCapability = file ? capabilityForFilename(file.name) : undefined

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!file) {
      setError('Choose a supported document file before inspecting it.')
      return
    }
    if (!metadata.rightsAuthority) {
      setError(MISSING_RIGHTS_MESSAGE)
      return
    }
    const controller = new AbortController()
    run.current = controller
    setBusy(true)
    setStatus('Reading the selected file…')
    try {
      const imported = await importStructuredDocument(file, {
        metadata: completeImportMetadata(metadata),
        signal: controller.signal,
        onProgress: (progress) => setStatus(PROGRESS_LABEL[progress.phase]),
      })
      onImported(imported)
    } catch (caught) {
      setError(isAbortError(caught)
        ? 'Document inspection cancelled. You can choose a file and try again.'
        : messageOf(caught))
    } finally {
      setBusy(false)
      setStatus('')
      run.current = undefined
    }
  }

  return (
    <form className="mt-5 max-w-3xl" onSubmit={(event) => { void inspect(event) }}>
      <div>
        <label htmlFor="document-file" className="block text-sm font-medium">Document file</label>
        <input
          id="document-file"
          type="file"
          accept={STRUCTURED_DOCUMENT_FILE_ACCEPT}
          aria-describedby={selectedCapability
            ? 'document-file-help document-file-limitations'
            : 'document-file-help'}
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            setFile(chosen)
            setError('')
            if (chosen && !metadata.title.trim()) {
              setMetadata((current) => ({
                ...current,
                title: chosen.name.replace(/\.[^.]+$/i, ''),
              }))
            }
          }}
          className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <span id="document-file-help" className="mt-1 block text-sm text-neutral-600 dark:text-neutral-400">
          {STRUCTURED_DOCUMENT_FORMAT_SUMMARY}, up to {DOCUMENT_IMPORT_LIMITS.maximumInputBytes / 1024 / 1024} MiB.
          The file stays in this browser. Embedded content blocks this text-oriented workflow.
        </span>
        {selectedCapability && (
          <p id="document-file-limitations" className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
            <strong>{selectedCapability.label} limitation:</strong>{' '}
            {selectedCapability.limitations.join(' ')}
          </p>
        )}
      </div>

      <ImportMetadataFields value={metadata} onChange={setMetadata} idPrefix="document" />

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
      <p role="status" aria-live="polite" className="mt-4 text-sm">{status}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="min-h-9 rounded-md bg-brand-700 px-4 text-sm font-medium text-white disabled:opacity-60">
          Inspect document
        </button>
        {busy && (
          <button type="button" className="min-h-9 rounded-md border px-4 text-sm" onClick={() => run.current?.abort()}>
            Cancel import for {metadata.title.trim() || file?.name || 'document'}
          </button>
        )}
      </div>
    </form>
  )
}
