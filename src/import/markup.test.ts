import { sanitizeImportedHtml } from './markup'

test('a caller can take ownership of the unavailable-image finding', () => {
  const source = '<p>Before <img src="https://example.org/a.png" alt="A cell"> after.</p>'

  const owned = sanitizeImportedHtml(source)
  expect(owned.findings.map((finding) => finding.code)).toContain('import-image-unavailable')

  const deferred = sanitizeImportedHtml(source, { deferImageFindings: true })
  expect(deferred.findings.map((finding) => finding.code)).not.toContain('import-image-unavailable')

  // Deferring the FINDING never defers the placeholder or the count. The gap in
  // the page is still marked, in the same words, and the caller still knows how
  // many there were — otherwise this option would be a way to lose an image
  // silently, which is the one thing the whole contract forbids.
  expect(deferred.html).toContain('[Embedded image: A cell]')
  expect(deferred.counts.images).toBe(1)
  expect(deferred.counts.unavailableAssets).toBe(1)
  expect(deferred.html).toBe(owned.html)
})

test('deferring the image finding defers only that finding', () => {
  // Everything else the sanitizer reports is unaffected: an option that quietly
  // widened to cover active content would suppress a warning about a removed
  // script, which no caller ever asked to own.
  const source = '<p onclick="steal()">Text <img src="https://example.org/a.png"> more.</p>'
  const deferred = sanitizeImportedHtml(source, { deferImageFindings: true })

  expect(deferred.findings.map((finding) => finding.code)).toEqual(['import-active-content-removed'])
})
