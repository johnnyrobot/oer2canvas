import { useState } from 'react'
import { CheckCircle2, Eye, EyeOff } from 'lucide-react'
import type { CanvasCourse, CanvasPage, CanvasUser } from '../canvas/client'

/**
 * §2.3 — the Canvas configuration region, and the only place a token is typed.
 *
 * Presentational on purpose: it holds what is in the two fields and nothing
 * else. Connecting, listing courses and loading pages all belong to whoever owns
 * the client, so this component can be driven through every one of its states
 * from props — which is what makes the error copy and the disabled states
 * testable without a network.
 */

export type ConnectStatus = 'idle' | 'connecting'

const LABEL = 'block text-sm font-medium'
const FIELD =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm ' +
  'dark:border-neutral-700 dark:bg-neutral-900 disabled:opacity-60'

export function CanvasConnect({
  status,
  error,
  user,
  courses,
  selectedCourseId,
  pages,
  pagesError,
  onRetryPages,
  onConnect,
  onCancel,
  onPickCourse,
  onForget,
  fixedAddress,
}: {
  status: ConnectStatus
  /** Already in the user's words — §2.5's copy, chosen by whoever made the call. */
  error?: string
  /** Present once the token has been verified. Its absence IS "not connected". */
  user?: CanvasUser
  courses?: readonly CanvasCourse[]
  selectedCourseId?: number
  /** `undefined` means not loaded; `[]` means loaded and genuinely empty. */
  pages?: readonly CanvasPage[]
  pagesError?: boolean
  onRetryPages?: () => void
  onConnect: (address: string, token: string) => void
  onCancel: () => void
  onPickCourse: (id: number) => void
  onForget: () => void
  /** Exact Canvas origin pinned by an opted-in self-host deployment. */
  fixedAddress?: string
}) {
  const [address, setAddress] = useState(fixedAddress ?? '')
  const [token, setToken] = useState('')
  const [shown, setShown] = useState(false)
  const busy = status === 'connecting'
  const chosen = courses?.find((c) => c.id === selectedCourseId)

  function forgetToken() {
    // Clear the controlled field before awaiting IndexedDB so the token is gone
    // from the live DOM immediately, even if storage is slow or unavailable.
    setToken('')
    setShown(false)
    onForget()
  }

  return (
    <div className="mt-6 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <div>
        <label className={LABEL} htmlFor="canvas-address">Canvas address</label>
        <input
          id="canvas-address"
          className={FIELD}
          type="text"
          value={address}
          disabled={busy}
          readOnly={fixedAddress !== undefined}
          placeholder="https://yourschool.instructure.com"
          onChange={(e) => setAddress(e.target.value)}
        />
        {fixedAddress && (
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            Pinned by this self-hosted deployment.
          </p>
        )}
      </div>

      <div className="mt-4">
        <label className={LABEL} htmlFor="canvas-token">Access token</label>
        <div className="flex items-start gap-2">
          <input
            id="canvas-token"
            className={FIELD}
            /*
              Masked by default because a token is shoulder-surfable and grants
              the whole account; unmaskable because a mistyped 70-character
              string is otherwise impossible to find, and "check the token" is
              advice nobody can act on against a row of dots.
            */
            type={shown ? 'text' : 'password'}
            value={token}
            disabled={busy}
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            type="button"
            className="mt-1 shrink-0 rounded-md border border-neutral-300 p-2 dark:border-neutral-700"
            aria-label={shown ? 'Hide token' : 'Show token'}
            onClick={() => setShown((v) => !v)}
          >
            {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          In Canvas: Account → Settings → New Access Token.
        </p>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={busy}
          onClick={() => onConnect(address, token)}
        >
          Connect
        </button>
        {/*
          Cancel sits BESIDE the line it cancels, per §2.5 — a cancel elsewhere on
          the screen is a button whose target the user has to guess.
        */}
        {busy && (
          <>
            <span role="status" aria-live="polite" className="text-sm">
              Connecting to Canvas…
            </span>
            <button
              type="button"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
              onClick={onCancel}
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {/*
        `role="alert"` and not a styled paragraph. A connection failure is the one
        thing on this screen a user is actively waiting on, and someone who is not
        watching the region gets no signal at all from colour.
      */}
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {user && (
        <div className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-brand-700 dark:text-brand-300" aria-hidden="true" />
            Connected as {user.name}
            <button
              type="button"
              className="ml-2 text-xs underline"
              onClick={forgetToken}
            >
              Forget this token
            </button>
          </p>

          {courses !== undefined && courses.length === 0 ? (
            /*
              Not an apology, and not a dead end. Someone whose account cannot
              edit any course still has a complete route through this product,
              and §9's rule is that the cartridge is never presented as the
              consolation prize — so it is named as the thing that works.
            */
            <p className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">
              This account has no courses you can edit. Cartridge export works without one.
            </p>
          ) : (
            courses !== undefined && (
              <fieldset className="mt-4">
                <legend className="text-sm font-medium">Choose a course</legend>
                <div className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
                  {courses.map((c) => (
                    /*
                      The whole row is the label, so the click target is the row
                      rather than a 16 px circle — §2.3's "full-row click target".
                    */
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-3 py-3 text-sm"
                    >
                      <input
                        type="radio"
                        name="canvas-course"
                        className="size-4"
                        checked={selectedCourseId === c.id}
                        onChange={() => onPickCourse(c.id)}
                      />
                      <span>
                        {c.name}
                        {/*
                          The space is load-bearing. Accessible names are built by
                          concatenating text nodes, so without it a screen reader
                          announces "Intro AlgebraFall 2026" — the term is styled
                          onto its own line, which separates it visually and not
                          at all for anyone listening.
                        */}
                        {c.term && (
                          <>
                            {' '}
                            <span className="block text-xs text-neutral-600 dark:text-neutral-400">
                              {c.term}
                            </span>
                          </>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          )}
          {chosen && (
            <section className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800">
              <h3 className="text-sm font-semibold">Pages already in {chosen.name}</h3>
              {/*
                §2.4 — the sentence that keeps the three questions linked. Without
                it this is a list of trivia; with it, it is the reference the Plan
                screen collides against, and the user knows that before they get
                there.
              */}
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                Chapters you pick will be checked against this list on the Plan screen.
              </p>

              {pagesError && (
                <p role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-700 dark:text-red-300">
                  Could not load pages for {chosen.name}. Check your connection, then try again.
                  <button
                    type="button"
                    className="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
                    onClick={onRetryPages}
                  >
                    Try again
                  </button>
                </p>
              )}

              {pages !== undefined && pages.length === 0 && (
                <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
                  This course has no pages yet. Everything you push will be new.
                </p>
              )}

              {pages !== undefined && pages.length > 0 && (
                <ul className="mt-3 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
                  {pages.map((p) => (
                    <li key={p.url} className="flex flex-wrap items-baseline gap-x-3 py-2">
                      <span className="font-medium">{p.title}</span>
                      {p.updatedAt && (
                        <span className="text-xs text-neutral-600 dark:text-neutral-400">
                          Last edited {formatEdited(p.updatedAt)}
                        </span>
                      )}
                      {/* The slug, in mono, because it is what a push collides on. */}
                      <span className="font-mono text-xs text-neutral-500">{p.url}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * "Last edited 12 Aug 2026".
 *
 * `locale` is a parameter so the format can be pinned in a test while production
 * still follows the reader's own locale — a date rendered `08/12/2026` means two
 * different days either side of the Atlantic, and this list exists to be
 * compared against by eye.
 */
export function formatEdited(iso: string, locale?: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}
