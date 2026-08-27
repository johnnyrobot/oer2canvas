import { useMemo, useState } from 'react'
import { openStaxCatalog, searchCatalog } from '../sources/openstax-catalog'
import type { BookRef } from '../sources/types'

export function OpenStaxBrowser({ onPick }: { onPick: (book: BookRef) => void }) {
  const [q, setQ] = useState('')
  const all = useMemo(() => openStaxCatalog(), [])
  const hits = useMemo(() => searchCatalog(all, q), [all, q])

  return (
    <section aria-labelledby="browser-heading">
      <h2 id="browser-heading" className="text-xl font-semibold">OpenStax books</h2>
      <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
        Open a book to see its chapters.
      </p>

      <div className="mt-4 max-w-md">
        <label htmlFor="book-search" className="block text-sm font-medium">Search books</label>
        <input
          id="book-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      {/*
        `role="list"` restores what Tailwind's preflight takes away: a `ul` with
        `list-style: none` is no longer announced as a list in Safari + VoiceOver,
        so a catalog of 112 books loses both its item count and list navigation.
      */}
      <ul role="list" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {hits.slice(0, 50).map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => onPick(b)}
              className="flex h-full w-full flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-4 text-left hover:border-brand-500 dark:border-neutral-800 dark:bg-neutral-900"
            >
              {/*
                TITLE ONLY, deliberately. Putting the subject inside the button
                folds it into the accessible name — "Algebra and Trigonometry
                Math" — which lengthens every name in a 112-item catalog and
                raises an SC 2.5.3 question about which part is the label. The
                spec's subject GROUPING (headed groups above the rows) says the
                same thing once per group instead of once per book.
              */}
              <span className="font-medium">{b.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
