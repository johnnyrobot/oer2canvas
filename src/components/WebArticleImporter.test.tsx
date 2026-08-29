import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WebArticleImporter } from './WebArticleImporter'

const SENTINEL = 'fc-SENTINEL-do-not-leak-0123456789'

const okEnvelope = {
  success: true,
  data: {
    markdown: '# Photosynthesis\n\nPlants convert light.',
    metadata: {
      url: 'https://en.wikipedia.org/wiki/Photosynthesis',
      sourceURL: 'https://en.wikipedia.org/wiki/Photosynthesis',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
    },
  },
}

const okFetch: typeof globalThis.fetch = async () => new Response(JSON.stringify(okEnvelope))
const failingFetch: typeof globalThis.fetch = async () =>
  new Response(JSON.stringify({ success: false }), { status: 401 })

/** Fill in everything the form needs before it will submit. */
function completeForm(url = 'https://en.wikipedia.org/wiki/Photosynthesis') {
  fireEvent.change(screen.getByLabelText(/Web page address/i), { target: { value: url } })
  fireEvent.change(screen.getByLabelText(/Firecrawl API key/i), { target: { value: SENTINEL } })
  fireEvent.change(screen.getByLabelText(/Document title/i), { target: { value: 'Photosynthesis' } })
  fireEvent.click(screen.getByRole('radio', { name: /permission to republish/i }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
}

test('the panel states the destination, what is sent, and the cost, before the button', () => {
  render(<WebArticleImporter onImported={() => {}} />)
  const disclosure = screen.getByText(/api\.firecrawl\.dev/)
  expect(disclosure).toBeInTheDocument()
  expect(disclosure.textContent).toMatch(/directly from (this|your) browser/i)
  // The relay is named so a reader knows what is NOT involved.
  expect(disclosure.textContent).toMatch(/relay is not involved/i)
  expect(disclosure.textContent).toMatch(/one Firecrawl credit/i)
  expect(disclosure.textContent).toMatch(/memory|never written to browser storage/i)
  // Not behind a triangle. A disclosure the user must open is not a disclosure.
  expect(disclosure.closest('details')).toBeNull()
})

test('Forget key clears the field and the held key, not just the field', () => {
  // The memory half is asserted in the containment suite, which can see the
  // store. Here: the control exists, is reachable, and empties the input.
  render(<WebArticleImporter onImported={() => {}} />)
  const key = screen.getByLabelText(/Firecrawl API key/i)
  fireEvent.change(key, { target: { value: 'fc-abc' } })
  fireEvent.click(screen.getByRole('button', { name: /Forget key/i }))
  expect(key).toHaveValue('')
})

test('the key field is masked by default and can be revealed', () => {
  // `CanvasConnect` settled this for the Canvas token: masked because it is
  // shoulder-surfable, unmaskable because "check the key" is advice nobody can
  // act on against a row of dots.
  render(<WebArticleImporter onImported={() => {}} />)
  const key = screen.getByLabelText(/Firecrawl API key/i)
  expect(key).toHaveAttribute('type', 'password')
  fireEvent.click(screen.getByRole('button', { name: /Show key/i }))
  expect(key).toHaveAttribute('type', 'text')
})

test('a libretexts url gets a nudge with a button, and is never redirected', () => {
  /*
   * Two URL boxes in one app, deliberately. `SourceBrowser`'s box is a BOOK
   * OPENER: it validates the host, derives a title, and calls `onPick` with a
   * `BookRef` for the chapter picker — no fetch, no key, no credit, a known-open
   * license. This box is an ARTICLE IMPORTER: one fetch, one `ImportResult`, one
   * page. Merging them would make one control whose behaviour forks invisibly on
   * hostname.
   *
   * So: a nudge, never a redirect. Silently doing something other than what the
   * button says is exactly the surprise this repo's fail-closed rule prevents.
   */
  const onOpenLibreTexts = vi.fn()
  render(<WebArticleImporter onImported={() => {}} onOpenLibreTexts={onOpenLibreTexts} />)
  fireEvent.change(screen.getByLabelText(/Web page address/i), {
    target: { value: 'https://chem.libretexts.org/Bookshelves/Organic' },
  })
  expect(screen.getByText(/structured chapters and needs no API key/i)).toBeInTheDocument()
  expect(onOpenLibreTexts).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /LibreTexts tab/i }))
  expect(onOpenLibreTexts).toHaveBeenCalledTimes(1)
})

test('the nudge does not block the import', () => {
  // Non-blocking: an instructor who wants one LibreTexts page as one Canvas
  // page is not wrong, and this feature is for them too.
  render(<WebArticleImporter onImported={() => {}} />)
  fireEvent.change(screen.getByLabelText(/Web page address/i), {
    target: { value: 'https://chem.libretexts.org/Bookshelves/Organic' },
  })
  expect(screen.getByRole('button', { name: /Import this page/i })).toBeEnabled()
})

test('a page with no publisher tab gets no nudge', () => {
  render(<WebArticleImporter onImported={() => {}} />)
  fireEvent.change(screen.getByLabelText(/Web page address/i), {
    target: { value: 'https://en.wikipedia.org/wiki/Photosynthesis' },
  })
  expect(screen.queryByText(/structured chapters and needs no API key/i)).toBeNull()
})

test('a successful import hands the result to its owner', async () => {
  const onImported = vi.fn()
  render(<WebArticleImporter onImported={onImported} fetch={okFetch} />)
  completeForm()
  fireEvent.click(screen.getByRole('button', { name: /Import this page/i }))

  await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
  expect(onImported.mock.calls[0]![0].report.parser).toBe('firecrawl')
})

test('a failed import shows an app-authored message and the panel stays usable', async () => {
  render(<WebArticleImporter onImported={() => {}} fetch={failingFetch} />)
  completeForm()
  fireEvent.click(screen.getByRole('button', { name: /Import this page/i }))

  const alert = await screen.findByRole('alert')
  await waitFor(() => expect(alert).toHaveFocus())
  expect(alert).toHaveTextContent(/rejected this API key/i)
  expect(screen.getByRole('button', { name: /Import this page/i })).toBeEnabled()
})

test('nothing rendered ever contains the key, including after a failure', async () => {
  // Error reporting is the classic leak path: `messageOf` returns
  // `error.message` verbatim and the panel renders it into `role="alert"`.
  render(<WebArticleImporter onImported={() => {}} fetch={failingFetch} />)
  completeForm()
  fireEvent.click(screen.getByRole('button', { name: /Import this page/i }))
  const alert = await screen.findByRole('alert')

  // The masked input's VALUE is not text content, and that is the point: it is
  // in the DOM as a value, nowhere as visible or accessible text.
  expect(document.body.textContent ?? '').not.toContain(SENTINEL)
  expect(alert.textContent).not.toContain(SENTINEL)
})

test('Forget key clears the held key, not merely the input', async () => {
  let called = 0
  const counting: typeof globalThis.fetch = async () => {
    called += 1
    return new Response(JSON.stringify(okEnvelope))
  }
  render(<WebArticleImporter onImported={() => {}} fetch={counting} />)
  completeForm()
  fireEvent.click(screen.getByRole('button', { name: /Forget key/i }))
  fireEvent.click(screen.getByRole('button', { name: /Import this page/i }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/Firecrawl API key/i)
  // The assertion that distinguishes "cleared" from "cleared the form field":
  // a stale captured key would have produced a request.
  expect(called).toBe(0)
})

test('cancel aborts the in-flight import and reports it as cancelled', async () => {
  const never: typeof globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))
  })
  render(<WebArticleImporter onImported={() => {}} fetch={never} />)
  completeForm()
  fireEvent.click(screen.getByRole('button', { name: /Import this page/i }))

  fireEvent.click(await screen.findByRole('button', { name: /Cancel import/i }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/cancelled/i)
})
