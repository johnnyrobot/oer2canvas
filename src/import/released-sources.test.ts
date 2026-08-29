import { RELEASED_SOURCES } from './released-sources'
import { DOCUMENT_FORMAT_CAPABILITIES, releaseEnabledFormats } from './capability'

test('every released source is either a capability-table format or the url source', () => {
  /*
   * Criterion 1 says the published capability table "matches corpus-tested
   * support ... and optional URL acquisition". The table cannot hold the URL
   * source — `DOCUMENT_FILE_ACCEPT` turns it into a file picker's `accept`
   * string, and a URL has no extension. So the two lists are kept apart and
   * reconciled HERE, which is the one place that can be wrong.
   */
  const fromTable = releaseEnabledFormats()
  const fileSources = RELEASED_SOURCES.filter((source) => source.kind === 'file')
  expect(fileSources.map((source) => source.format).sort()).toEqual([...fromTable].sort())

  const urlSources = RELEASED_SOURCES.filter((source) => source.kind === 'url')
  expect(urlSources.map((source) => source.format)).toEqual(['web'])
})

test('no capability is enabled without being released, and none released without being enabled', () => {
  // The failure this catches: someone flips a `status` to 'enabled' and ships a
  // format nothing in this issue ever tested. Because RELEASED_SOURCES's file
  // entries are a hand-written literal list (not derived from the capability
  // table — see released-sources.ts for why), this comparison is a real
  // reconciliation between two independently authored lists, not a tautology.
  const enabled = DOCUMENT_FORMAT_CAPABILITIES
    .filter((entry) => entry.status === 'enabled')
    .map((entry) => entry.format)
  const released = RELEASED_SOURCES.filter((source) => source.kind === 'file').map((s) => s.format)
  expect([...enabled].sort()).toEqual([...released].sort())
})

test('every released source names the limits a user meets', () => {
  // Criterion 5 requires resource limits be stated. This is the machine-readable
  // half; Task 9 asserts the prose half.
  for (const source of RELEASED_SOURCES) {
    expect(source.maximumBytes).toBeGreaterThan(0)
    expect(source.limitations.length).toBeGreaterThan(0)
  }
})
