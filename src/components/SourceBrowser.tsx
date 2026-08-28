import { useEffect, useMemo, useState } from 'react'
import { OpenStaxBrowser } from './OpenStaxBrowser'
import { TextContentImporter } from './TextContentImporter'
import { DocumentImporter } from './DocumentImporter'
import {
  loadLibreTextsCatalog,
  loadPressbooksCatalog,
  pressbooksNetworks,
  searchSourceCatalog,
} from '../sources/catalogs'
import type { BookRef } from '../sources/types'
import type { ImportResult } from '../import/types'
import { messageOf } from '../errors'

type SourceTab = 'openstax' | 'libretexts' | 'pressbooks' | 'document' | 'text'
type CatalogTab = Extract<SourceTab, 'libretexts' | 'pressbooks'>

const BASE_TABS = ['openstax', 'libretexts', 'pressbooks'] as const
const TAB_LABELS: Readonly<Record<SourceTab, string>> = {
  openstax: 'OpenStax',
  libretexts: 'LibreTexts',
  pressbooks: 'Pressbooks',
  document: 'Document',
  text: 'Text / Markdown / HTML',
}

const CATALOG_TABS: Readonly<Record<CatalogTab, {
  heading: string
  key: (network: string) => string
  load: (network: string) => Promise<BookRef[]>
}>> = {
  libretexts: {
    heading: 'LibreTexts books',
    key: () => 'libretexts',
    load: () => loadLibreTextsCatalog(),
  },
  pressbooks: {
    heading: 'Pressbooks books',
    key: (network) => `pressbooks:${network}`,
    load: (network) => loadPressbooksCatalog(network),
  },
}

function isCatalogTab(tab: SourceTab): tab is CatalogTab {
  return tab === 'libretexts' || tab === 'pressbooks'
}

const defaultPressbooks = pressbooksNetworks.find((network) => network.isDefault) ?? pressbooksNetworks[0]

/**
 * Three real catalogs. LibreTexts and Pressbooks are generated snapshots, so
 * searching and filtering never turns a keystroke into publisher traffic.
 */
export function SourceBrowser({
  onPick,
  onImportText,
  onImportDocument,
}: {
  onPick: (book: BookRef) => void
  onImportText?: (result: ImportResult) => void
  onImportDocument?: (result: ImportResult) => void
}) {
  const [tab, setTab] = useState<SourceTab>('openstax')
  const [libreUrl, setLibreUrl] = useState('')
  const [libreError, setLibreError] = useState('')
  const [query, setQuery] = useState('')
  const [network, setNetwork] = useState(defaultPressbooks?.host ?? '')
  const [books, setBooks] = useState<readonly BookRef[] | undefined>()
  const [loadedKey, setLoadedKey] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [attempt, setAttempt] = useState(0)

  const catalog = isCatalogTab(tab) ? CATALOG_TABS[tab] : undefined
  const catalogKey = catalog?.key(network) ?? ''
  useEffect(() => {
    if (!catalog || loadedKey === catalogKey) return
    let active = true
    setBooks(undefined)
    setCatalogError('')
    void catalog.load(network)
      .then((loaded) => {
        if (!active) return
        setBooks(loaded)
        setLoadedKey(catalogKey)
      })
      .catch((error: unknown) => {
        if (!active) return
        setCatalogError(messageOf(error))
      })
    return () => { active = false }
  }, [attempt, catalog, catalogKey, loadedKey, network])

  const hits = useMemo(() => searchSourceCatalog(books ?? [], query), [books, query])

  const openLibreTexts = () => {
    try {
      const url = new URL(libreUrl)
      const hostname = url.hostname.toLowerCase()
      if (url.protocol !== 'https:' || (hostname !== 'libretexts.org' && !hostname.endsWith('.libretexts.org'))) {
        throw new Error('host')
      }
      const title = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? 'LibreTexts book')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      setLibreError('')
      onPick({ source: 'libretexts', id: url.toString(), slug: url.toString(), title, authors: [] })
    } catch {
      setLibreError('Enter a public HTTPS URL on a libretexts.org host.')
    }
  }

  return (
    <section aria-labelledby="source-heading">
      <h2 id="source-heading" className="text-xl font-semibold">Choose content</h2>
      <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
        Search an OER publisher, upload a document, or import text, Markdown, or HTML in this browser.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Content source">
        {[
          ...BASE_TABS,
          ...(onImportDocument ? ['document' as const] : []),
          ...(onImportText ? ['text' as const] : []),
        ].map((source) => (
          <button
            key={source}
            type="button"
            role="tab"
            aria-selected={tab === source}
            className={`min-h-9 rounded-md border px-3 text-sm ${tab === source ? 'border-brand-700 bg-brand-50 text-brand-700 dark:bg-neutral-800 dark:text-brand-300' : 'border-neutral-300 dark:border-neutral-700'}`}
            onClick={() => {
              setTab(source)
              setQuery('')
              setCatalogError('')
            }}
          >
            {TAB_LABELS[source]}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === 'openstax' && <OpenStaxBrowser onPick={onPick} />}
        {tab === 'document' && onImportDocument && <DocumentImporter onImported={onImportDocument} />}
        {tab === 'text' && onImportText && <TextContentImporter onImported={onImportText} />}
        {catalog && (
          <section aria-labelledby={`${tab}-catalog-heading`}>
            <h3 id={`${tab}-catalog-heading`} className="text-lg font-semibold">
              {catalog.heading}
            </h3>
            <div className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-2">
              <label htmlFor={`${tab}-search`} className="block text-sm font-medium">
                Search books
                <input
                  id={`${tab}-search`}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
              {tab === 'pressbooks' && (
                <label htmlFor="pressbooks-network" className="block text-sm font-medium">
                  Network
                  <select
                    id="pressbooks-network"
                    value={network}
                    onChange={(event) => setNetwork(event.target.value)}
                    className="mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    {pressbooksNetworks.map((option) => (
                      <option key={option.host} value={option.host}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {!books && !catalogError && <p role="status" className="mt-4 text-sm">Loading catalog…</p>}
            {catalogError && (
              <div className="mt-4 rounded-md border border-red-300 p-3 text-sm text-red-800 dark:text-red-300" role="alert">
                <p>Could not load the catalog. {catalogError}</p>
                <button type="button" className="mt-2 rounded-md border px-3 py-2" onClick={() => setAttempt((value) => value + 1)}>
                  Try again
                </button>
              </div>
            )}
            {books && (
              <>
                <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
                  {hits.length.toLocaleString()} {hits.length === 1 ? 'book' : 'books'}
                  {hits.length > 100 ? ' — showing the first 100' : ''}
                </p>
                {hits.length === 0 ? (
                  <p className="mt-4 text-sm">No books matched that search.</p>
                ) : (
                  <BookGrid books={hits.slice(0, 100)} onPick={onPick} />
                )}
              </>
            )}

            {tab === 'libretexts' && (
              <details className="mt-6 max-w-xl">
                <summary className="cursor-pointer text-sm font-medium">Open a LibreTexts URL instead</summary>
                <label htmlFor="libretexts-url" className="mt-3 block text-sm font-medium">LibreTexts book or chapter URL</label>
                <input
                  id="libretexts-url"
                  type="url"
                  value={libreUrl}
                  onChange={(event) => setLibreUrl(event.target.value)}
                  placeholder="https://chem.libretexts.org/Bookshelves/..."
                  className="mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900"
                />
                <button type="button" className="mt-3 min-h-9 rounded-md bg-brand-700 px-4 text-sm font-medium text-white" onClick={openLibreTexts} disabled={!libreUrl.trim()}>
                  Open LibreTexts book
                </button>
                {libreError && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{libreError}</p>}
              </details>
            )}
          </section>
        )}
      </div>
    </section>
  )
}

function BookGrid({ books, onPick }: { books: readonly BookRef[]; onPick: (book: BookRef) => void }) {
  return (
    <ul role="list" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {books.map((book) => (
        <li key={book.id}>
          <button
            type="button"
            onClick={() => onPick(book)}
            className="flex h-full w-full flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-4 text-left hover:border-brand-500 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <span className="font-medium">{book.title}</span>
            {book.authors.length > 0 && <span className="text-xs text-neutral-600 dark:text-neutral-400">{book.authors.join(', ')}</span>}
            {book.subject && <span className="text-xs text-neutral-600 dark:text-neutral-400">{book.subject}</span>}
            {book.license && <span className="text-xs text-neutral-600 dark:text-neutral-400">License: {book.license}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}
