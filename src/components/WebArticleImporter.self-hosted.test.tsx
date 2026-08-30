import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WebArticleImporter } from './WebArticleImporter'

/*
 * The opted-in web-extraction build.
 *
 * Runs ONLY in the `unit-self-hosted` Vitest project, whose `define` pins
 * `__OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__`. Everything here is about what
 * the build switch DECIDES; the extractor's own behaviour — its handshake,
 * its whole failure taxonomy, the redirect trap — is tested with no build
 * switch at all in `src/import/self-hosted-extractor.test.ts`, because that
 * module takes its origin as a dependency.
 */

const ORIGIN = 'https://extract.example.edu'
const ADDRESS = 'https://en.wikipedia.org/wiki/Photosynthesis'

const crawled = {
  success: true,
  results: [{
    url: ADDRESS,
    success: true,
    markdown: {
      raw_markdown: '# Photosynthesis\n\nPlants convert light.',
      markdown_with_citations: '',
      references_markdown: '',
    },
    status_code: 200,
    redirected_status_code: 200,
    redirected_url: ADDRESS,
    response_headers: { 'content-type': 'text/html; charset=utf-8' },
  }],
}

function serviceFetch(log?: string[]): typeof globalThis.fetch {
  return async (url) => {
    log?.push(String(url))
    return String(url).endsWith('/health')
      ? Response.json({ status: 'ok', version: '0.9.2' })
      : Response.json(crawled)
  }
}

/** Everything the form needs before it will submit. Note what is NOT here. */
function completeForm() {
  fireEvent.change(screen.getByLabelText(/Web page address/i), { target: { value: ADDRESS } })
  fireEvent.change(screen.getByLabelText(/Document title/i), { target: { value: 'Photosynthesis' } })
  fireEvent.click(screen.getByRole('radio', { name: /permission to republish/i }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
}

test('the build switch really is on in this project', () => {
  /*
   * First assertion in the file, for the reason the forced-colors suite opens
   * the same way: a suite that quietly measured the public configuration would
   * pass every assertion below and prove nothing at all.
   */
  expect(__OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__).toBe(ORIGIN)
})

test('there is no key field, no reveal toggle, and no forget control', () => {
  render(<WebArticleImporter onImported={() => {}} />)

  expect(screen.queryByLabelText(/API key/i)).toBeNull()
  expect(screen.queryByRole('button', { name: /Forget key/i })).toBeNull()
  expect(screen.queryByRole('button', { name: /(Show|Hide) key/i })).toBeNull()
  /*
   * Absent rather than merely unlabelled, which is issue 17's second criterion
   * word for word: no password input of any kind survives on this screen, so a
   * relabelled or restyled key field could not slip past the queries above.
   */
  expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)
  // And the address field is still here, so this is not passing because the
  // panel failed to render at all.
  expect(screen.getByLabelText(/Web page address/i)).toBeInTheDocument()
})

test('the disclosure names the operator’s origin, the absence of a credential, and the relay', () => {
  render(<WebArticleImporter onImported={() => {}} />)
  const disclosure = screen.getByText(new RegExp(ORIGIN))

  expect(disclosure.textContent).toMatch(/no credential of any kind/i)
  expect(disclosure.textContent).toMatch(/No account and no API key/i)
  expect(disclosure.textContent).toMatch(/relay is not involved/i)
  // Who actually sees the address, said plainly. It is the operator, not this
  // project and not a vendor, and a user cannot infer that from anything else.
  expect(disclosure.textContent).toMatch(/operator of\s+this deployment, not this project, sees the address/i)
  // Firecrawl is not merely unused here; it is not mentioned.
  expect(disclosure.textContent).not.toMatch(/firecrawl/i)
  expect(disclosure.closest('details')).toBeNull()
})

test('the whole screen never says Firecrawl', () => {
  render(<WebArticleImporter onImported={() => {}} />)
  expect(document.body.textContent).not.toMatch(/firecrawl/i)
})

test('importing calls the pinned service, and no vendor', async () => {
  const seen: string[] = []
  render(<WebArticleImporter onImported={() => {}} fetch={serviceFetch(seen)} />)
  completeForm()
  fireEvent.click(screen.getByRole('button', { name: /Import this page/i }))

  await waitFor(() => expect(seen.length).toBe(2))
  // The handshake, then the one crawl. Both at the pinned origin and nowhere
  // else — the assertion that a build switch actually changed the destination
  // rather than only the wording above it.
  expect(seen.every((url) => url.startsWith(`${ORIGIN}/`))).toBe(true)
  expect(seen.join('|')).not.toContain('firecrawl')
})

test('the busy line names the extraction service rather than a vendor', async () => {
  let release: (() => void) | undefined
  const slow: typeof globalThis.fetch = async (url) => {
    if (String(url).endsWith('/health')) return Response.json({ status: 'ok', version: '0.9.2' })
    await new Promise<void>((resolve) => { release = resolve })
    return Response.json(crawled)
  }
  render(<WebArticleImporter onImported={() => {}} fetch={slow} />)
  completeForm()
  fireEvent.click(screen.getByRole('button', { name: /Import this page/i }))

  await screen.findByText(/Asking the extraction service for this page/i)
  release?.()
})

test('an imported page is attributed to a self-hosted service, not to a product', async () => {
  let imported: { report: { parser: string } } | undefined
  render(<WebArticleImporter onImported={(result) => { imported = result }} fetch={serviceFetch()} />)
  completeForm()
  fireEvent.click(screen.getByRole('button', { name: /Import this page/i }))

  await waitFor(() => expect(imported).toBeDefined())
  expect(imported!.report.parser).toBe('self-hosted-extractor')
})
