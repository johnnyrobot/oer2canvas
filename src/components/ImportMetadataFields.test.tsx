import { render, screen } from '@testing-library/react'
import { ImportMetadataFields, emptyImportMetadata } from './ImportMetadataFields'

const draft = emptyImportMetadata()

test('the rights fieldset can carry a preface, and the source url can be recorded rather than asked', () => {
  render(<ImportMetadataFields
    value={draft}
    onChange={() => {}}
    idPrefix="web-article"
    rightsPreface={<>Extraction is not a license.</>}
    sourceUrl={{ readOnly: true, note: 'Recorded from the address you imported.' }}
  />)
  expect(screen.getByText(/Extraction is not a license/)).toBeInTheDocument()
  expect(screen.getByLabelText(/Public source URL/)).toHaveAttribute('readonly')
  expect(screen.getByText(/Recorded from the address you imported/)).toBeInTheDocument()
})

test('the existing callers are unchanged when the new props are absent', () => {
  render(<ImportMetadataFields value={draft} onChange={() => {}} idPrefix="text-content" />)
  expect(screen.getByLabelText(/Public source URL/)).not.toHaveAttribute('readonly')
  expect(screen.queryByText(/Extraction is not a license/)).toBeNull()
})
