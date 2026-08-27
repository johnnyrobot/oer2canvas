import { describe, it, expect } from 'vitest'
import { queueKeyOf, validateAnswer } from './answers'

describe('queueKeyOf', () => {
  it('prefers the content hash, so one answer clears every copy of an image', () => {
    expect(queueKeyOf({ hash: 'abc', sectionId: 's1', elementId: 'b2c-img-3' })).toBe('abc')
  })

  it('falls back to section::element when the publisher gives no hash', () => {
    // Tables never carry a hash, so this is their only key — and it is why a
    // table answer can never propagate across sections (D5.2).
    expect(queueKeyOf({ sectionId: 's1', elementId: 'T2' })).toBe('s1::T2')
  })
})

// Every assertion is on the WHOLE verdict, not a plucked field: `AnswerVerdict`
// is a discriminated union, so `result.message` does not typecheck without
// narrowing, and matching the whole object also catches a stray extra key.
describe('validateAnswer', () => {
  it('refuses a filename with the exact refusal copy', () => {
    expect(validateAnswer({ type: 'alt', text: 'IMG_2231.jpg' })).toEqual({
      refused: true,
      message:
        'Not saved: that looks like a file name or web address. Describe what the image shows.',
    })
  })

  it('refuses a url with the same copy — one message for one mistake', () => {
    expect(validateAnswer({ type: 'alt', text: 'https://openstax.org/a/b.png' })).toEqual({
      refused: true,
      message: expect.stringMatching(/^Not saved: that looks like a file name or web address\./),
    })
  })

  it('refuses an empty description', () => {
    // altTextIssue returns null here, because alt="" is valid decorative markup.
    // A human submitting nothing is a different act, and only this layer can see it.
    expect(validateAnswer({ type: 'alt', text: '   ' })).toEqual({
      refused: true,
      message: 'Not saved: the description is empty.',
    })
  })

  it("refuses a description over Canvas's 120-character limit", () => {
    expect(validateAnswer({ type: 'alt', text: 'A'.repeat(121) })).toEqual({
      refused: true,
      message: "Not saved: the description must be 120 characters or fewer for Canvas.",
    })
  })

  it('refuses a placeholder', () => {
    expect(validateAnswer({ type: 'alt', text: 'image' })).toEqual({
      refused: true,
      message: 'Not saved: that is a placeholder, not a description.',
    })
  })

  it('accepts a redundant label prefix, and carries the note forward', () => {
    // The one accept-with-note string the UX spec writes out in full (§4). The
    // label is quoted from the text, so the instructor sees their own words.
    expect(validateAnswer({ type: 'alt', text: 'Figure 2 A four-term polynomial.' })).toEqual({
      refused: false,
      note:
        "Saved, with a note: this starts with 'Figure 2'. The caption already carries " +
        'that label, so screen readers will hear it twice.',
    })
  })

  it("does not read 'Figure skating' as a label — a label carries a number", () => {
    // A false positive costs only a note, but a note that is wrong teaches the
    // instructor to ignore notes.
    expect(
      validateAnswer({
        type: 'alt',
        text: 'Figure skating jump, mid-rotation, one blade off the ice.',
      }),
    ).toEqual({ refused: false })
  })

  it("carries the audit's own note for boilerplate the audit judges", () => {
    // 'Image of' is alt-text-redundant: a warning, so it accepts. The gate never
    // blocked on it and neither does the queue.
    expect(validateAnswer({ type: 'alt', text: 'Image of a four-term polynomial.' })).toEqual({
      refused: false,
      note: expect.stringContaining('Saved, with a note: Alt text begins with redundant boilerplate'),
    })
  })

  it('accepts a real description with no note at all', () => {
    expect(
      validateAnswer({
        type: 'alt',
        text: 'A four-term polynomial with the first terms highlighted.',
      }),
    ).toEqual({ refused: false })
  })

  it('accepts decorative and table answers — there is no text to judge', () => {
    expect(validateAnswer({ type: 'decorative' })).toEqual({ refused: false })
    expect(validateAnswer({ type: 'table-headers', choice: 'both' })).toEqual({ refused: false })
  })
})
