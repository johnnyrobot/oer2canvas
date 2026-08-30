import { useRef, useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { importWebArticle } from '../import/web'
import { createFirecrawlFetcher } from '../import/firecrawl'
import { createSelfHostedExtractorFetcher } from '../import/self-hosted-extractor'
import { createFirecrawlKeyStore } from '../import/firecrawl-key'
import { publisherForHost, PUBLISHER_TAB_LABELS } from '../sources/publisher-hosts'
import type { ImportResult } from '../import/types'
import { isAbortError, messageOf } from '../errors'
import { MISSING_RIGHTS_MESSAGE } from '../import/common'
import {
  completeImportMetadata,
  emptyImportMetadata,
  ImportMetadataFields,
  useImportErrorFocus,
} from './ImportMetadataFields'

const FIELD = 'mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900'

/**
 * Empty in the public build, where a page is fetched by Firecrawl on the user's
 * own key. An exact HTTPS origin in a build whose operator runs the extraction
 * service themselves, where no key is asked for, sent, or held.
 *
 * Read at MODULE scope and compared against `''`, exactly as `App.tsx` reads
 * the pinned Canvas origin — and NOT taken as a prop, which is the part worth
 * stating. A prop would keep both branches live in every build, which would put
 * the extractor's endpoint in the public bundle; `scripts/smoke-dist.mjs`
 * refuses that. The cost of the constant is that neither branch can be switched
 * from inside a test, which is why the opted-in build has a Vitest project of
 * its own (`vitest.config.ts`, `unit-self-hosted`).
 */
const SELF_HOSTED_EXTRACTOR_ORIGIN =
  typeof __OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__ === 'string'
    ? __OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__
    : ''

/** The publisher whose own tab already covers this address, if any. */
function nudgeFor(rawUrl: string): { id: string; label: string } | undefined {
  try {
    const publisher = publisherForHost(new URL(rawUrl).hostname)
    return publisher ? { id: publisher, label: PUBLISHER_TAB_LABELS[publisher] } : undefined
  } catch {
    // A half-typed address is not a publisher and not an error yet.
    return undefined
  }
}

/**
 * The one-URL, one-page importer.
 *
 * Mirrors `TextContentImporter`: it fetches and hands the result to its owner,
 * so the page plan, findings and preview belong to `ImportPlanEditor` and
 * editing them never comes back through this form. On this path that also means
 * editing never re-fetches, and so never spends a second Firecrawl credit.
 */
export function WebArticleImporter({
  onImported,
  onOpenLibreTexts,
  fetch: injectedFetch,
}: {
  onImported: (result: ImportResult) => void
  onOpenLibreTexts?: () => void
  /** Injected so the suite runs with no network, as `RelayDeps` does. */
  fetch?: typeof globalThis.fetch
}) {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [keyShown, setKeyShown] = useState(false)
  const [metadata, setMetadata] = useState(emptyImportMetadata)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const activeImportController = useRef<AbortController | undefined>(undefined)
  const errorElement = useImportErrorFocus(error)
  /*
   * One store per mounted panel, and THE STORE is what the fetcher reads — the
   * input is only how the key is typed. That is what makes Forget key clear the
   * key rather than merely the field.
   *
   * NOT CONSTRUCTED AT ALL when an operator has pinned their own extractor.
   * Issue 17's second criterion says no key may be "required, requested, or
   * STORABLE" in that build, and a store that exists is somewhere a key could
   * be put. The ternary folds with the constant, so the store — and the module
   * that makes one — leaves that bundle entirely.
   */
  const keyStore = useRef(SELF_HOSTED_EXTRACTOR_ORIGIN ? undefined : createFirecrawlKeyStore())

  const nudge = nudgeFor(url)

  function forgetKey() {
    keyStore.current?.forget()
    setKey('')
  }

  async function importPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!metadata.rightsAuthority) {
      setError(MISSING_RIGHTS_MESSAGE)
      return
    }

    const controller = new AbortController()
    activeImportController.current = controller
    setBusy(true)
    try {
      const imported = await importWebArticle(url, {
        metadata: completeImportMetadata(metadata),
        /*
         * The one place the deployment mode changes what happens. Everything
         * else on this screen, and everything below the seam, is shared — so
         * the two builds cannot come to disagree about what a page is.
         */
        fetcher: SELF_HOSTED_EXTRACTOR_ORIGIN
          ? createSelfHostedExtractorFetcher({
            origin: SELF_HOSTED_EXTRACTOR_ORIGIN,
            ...(injectedFetch ? { fetch: injectedFetch } : {}),
          })
          : createFirecrawlFetcher({
            // A getter, so a key forgotten between this render and the request
            // is actually gone rather than captured in a closure.
            key: () => keyStore.current?.peek(),
            ...(injectedFetch ? { fetch: injectedFetch } : {}),
          }),
        signal: controller.signal,
      })
      onImported(imported)
    } catch (caught) {
      setError(isAbortError(caught)
        ? 'Import cancelled. You can edit the address and try again.'
        : messageOf(caught))
    } finally {
      setBusy(false)
      activeImportController.current = undefined
    }
  }

  return (
    <form className="mt-5 max-w-3xl" onSubmit={(event) => { void importPage(event) }}>
      {/*
        Above the button, in prose, not behind a disclosure triangle. A
        disclosure the user has to open is not a disclosure, and this is the
        moment before anything leaves the browser.

        Two whole paragraphs rather than one with interpolated fragments,
        because they are different claims about where bytes go and who sees
        them. A template that produced both would be one sentence nobody can
        read as either.
      */}
      {SELF_HOSTED_EXTRACTOR_ORIGIN ? (
        <p className="rounded-md border border-neutral-300 p-3 text-sm text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
          Importing a web page sends the address below from this browser to {SELF_HOSTED_EXTRACTOR_ORIGIN},
          the extraction service this deployment’s operator runs. No account and no API key are
          needed, and this browser sends no credential of any kind. This app’s relay is not
          involved. That service fetches the page and returns the extracted text; the operator of
          this deployment, not this project, sees the address you enter.
        </p>
      ) : (
        <p className="rounded-md border border-neutral-300 p-3 text-sm text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
          Importing a web page sends the address below and your Firecrawl API key directly from this
          browser to api.firecrawl.dev. This app’s relay is not involved and never sees your key.
          Firecrawl fetches the page and returns the extracted text; each import costs one Firecrawl
          credit. Your key is held in this tab’s memory only, is never written to browser storage, and
          is erased when you close the tab or choose Forget key.
        </p>
      )}

      <label className="mt-4 block text-sm font-medium">
        Web page address
        <input
          type="url"
          required
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            // The recorded source URL follows the address box, so the
            // attribution the user sees is the page they asked for.
            setMetadata((current) => ({ ...current, sourceUrl: event.target.value }))
          }}
          className={FIELD}
        />
      </label>

      {nudge && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <span>
            {nudge.label} is available as a tab with structured chapters and needs no API key.
          </span>
          {nudge.id === 'libretexts' && onOpenLibreTexts && (
            <button
              type="button"
              className="min-h-9 rounded-md border px-3 text-sm"
              onClick={onOpenLibreTexts}
            >
              Open the LibreTexts tab
            </button>
          )}
        </p>
      )}

      {/*
        ABSENT, not disabled and not hidden, when an operator pinned their own
        extractor. The constant folds, so this whole block — the input, the
        reveal toggle, Forget key, and the store above — is gone from that
        build rather than merely unreachable in it.
      */}
      {!SELF_HOSTED_EXTRACTOR_ORIGIN && (
      <div className="mt-4">
        <label className="block text-sm font-medium" htmlFor="web-article-key">
          Firecrawl API key
        </label>
        <div className="flex items-start gap-2">
          <input
            id="web-article-key"
            /*
              Masked by default and unmaskable, for the reason `CanvasConnect`
              already gives about the Canvas token: it is shoulder-surfable, and
              "check the key" is advice nobody can act on against a row of dots.
            */
            type={keyShown ? 'text' : 'password'}
            value={key}
            /*
              `autoComplete="off"` and a name that is not password-shaped, so a
              browser password manager is not invited to save it. A manager
              storing the key would be persistence this app does not control and
              cannot forget.
            */
            autoComplete="off"
            name="firecrawl-api-key"
            onChange={(event) => {
              setKey(event.target.value)
              keyStore.current?.hold(event.target.value)
            }}
            className={FIELD}
          />
          <button
            type="button"
            className="mt-1 shrink-0 rounded-md border border-neutral-300 p-2 dark:border-neutral-700"
            aria-label={keyShown ? 'Hide key' : 'Show key'}
            onClick={() => setKeyShown((shown) => !shown)}
          >
            {keyShown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="mt-1 shrink-0 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
            onClick={forgetKey}
          >
            Forget key
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          From your own Firecrawl account. It goes only to the address named above, and nowhere else.
        </p>
      </div>
      )}

      <ImportMetadataFields
        value={metadata}
        onChange={setMetadata}
        idPrefix="web-article"
        rightsPreface={
          <>
            Extraction is not a license. A page being publicly readable does not make it openly
            licensed, and this app cannot tell you what license a page carries. Choose the basis you
            actually have.
          </>
        }
        sourceUrl={{ readOnly: true, note: 'Recorded from the address you imported.' }}
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
      <p role="status" aria-live="polite" className="mt-4 text-sm">
        {busy
          ? SELF_HOSTED_EXTRACTOR_ORIGIN
            ? 'Asking the extraction service for this page…'
            : 'Asking Firecrawl for this page…'
          : ''}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="min-h-9 rounded-md bg-brand-700 px-4 text-sm font-medium text-white disabled:opacity-60">
          Import this page
        </button>
        {busy && (
          <button
            type="button"
            className="min-h-9 rounded-md border px-4 text-sm"
            onClick={() => activeImportController.current?.abort()}
          >
            Cancel import for {metadata.title.trim() || url || 'this page'}
          </button>
        )}
      </div>
    </form>
  )
}
