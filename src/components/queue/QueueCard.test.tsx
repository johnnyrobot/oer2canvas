import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueueCard } from './QueueCard'
import type { QueueItem } from '../../contracts/index'
import { VLM_MODELS } from '../../engine/vlm'

const decorative: QueueItem = {
  kind: 'confirm-decorative',
  sectionId: 's1',
  elementId: 'b2c-img-3',
  hash: 'f30414a1',
  context: {
    src: 'https://x/f30414a1',
    reference: 'Find the product of the first terms.',
  },
}

describe('the decorative card', () => {
  it('asks whether the image carries information, not whether it is decorative', () => {
    // The publisher already answered "decorative". Asking a human to re-confirm
    // their word primes agreement, and agreement is the failure mode: press the
    // primary button twelve times and ship twelve silent equations.
    render(<QueueCard item={decorative} position={1} total={25} />)
    expect(
      screen.getByRole('heading', { name: 'Does this image carry information?' }),
    ).toBeTruthy()
  })

  it('names equations and worked-example steps, because that is what these are', () => {
    render(<QueueCard item={decorative} position={1} total={25} />)
    expect(
      screen.getByText(/If it shows an equation, a diagram, or a step in the worked example/),
    ).toBeTruthy()
  })

  it('routes doubt to the safe branch with the cost stated', () => {
    render(<QueueCard item={decorative} position={1} total={25} />)
    expect(
      screen.getByText(
        /A wrong "decoration" answer hides the image from screen readers for every student/,
      ),
    ).toBeTruthy()
  })

  it('counts the position in the queue, not in the group', () => {
    render(<QueueCard item={decorative} position={1} total={25} />)
    expect(screen.getByText('Item 1 of 25')).toBeTruthy()
  })

  it('says nothing at all about a missing caption', () => {
    // A noise line on nearly every card trains the eye to skip the card's text,
    // which is where the question lives.
    render(<QueueCard item={decorative} position={1} total={25} />)
    expect(screen.queryByText(/no caption/i)).toBeNull()
  })

  it('puts skip last, and every control is a text label', () => {
    render(<QueueCard item={decorative} position={1} total={25} />)
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toEqual(['Confirm decorative (D)', 'Needs a description', 'Skip (S)'])
  })

  it('sits the question under the group heading, so headings are navigable', () => {
    render(<QueueCard item={decorative} position={1} total={25} />)
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Images marked decorative')
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe(
      'Does this image carry information?',
    )
  })

  it('says a sentence could not be found rather than showing an empty quote', () => {
    render(<QueueCard item={{ ...decorative, context: {} }} position={1} total={25} />)
    expect(
      screen.getByText('No sentence near this image was found — use the highlighted image below.'),
    ).toBeTruthy()
  })

  it('names every section an answer will reach when the image repeats', () => {
    render(
      <QueueCard
        item={decorative}
        position={1}
        total={25}
        occurrences={['1.1', '1.2', '1.4', '2.1']}
      />,
    )
    expect(
      screen.getByText(
        'This image appears in 4 sections: 1.1, 1.2, 1.4, 2.1 — your answer applies to all of them.',
      ),
    ).toBeTruthy()
  })

  it('says nothing about occurrences when the image is unique', () => {
    render(<QueueCard item={decorative} position={1} total={25} occurrences={['1.4']} />)
    expect(screen.queryByText(/appears in/)).toBeNull()
  })

  it('morphs to the alt cluster in place, without answering anything', () => {
    // "Needs a description" changes the card, it does not record a decision —
    // the answer is the text the instructor then writes.
    const onAnswer = vi.fn()
    render(<QueueCard item={decorative} position={1} total={25} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Needs a description' }))
    expect(onAnswer).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('tells the instructor they skipped this one before', () => {
    render(<QueueCard item={decorative} position={1} total={25} skippedEarlier />)
    expect(screen.getByText('You skipped this earlier.')).toBeTruthy()
  })
})

describe('the alt card', () => {
  const alt: QueueItem = { ...decorative, kind: 'alt' }
  const draftableAlt: QueueItem = { ...alt, context: { src: alt.context.src } }

  it('carries the context block the decorative card carries', () => {
    // A3. This is the card that asks the instructor to WRITE something, so it
    // needs the evidence at least as much as the one that asks yes or no.
    render(<QueueCard item={alt} position={13} total={25} />)
    expect(screen.getByText(/Find the product of the first terms\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the original image (new tab)' })).toBeTruthy()
  })

  it('changes its primary control when a draft exists', () => {
    const withDraft = { ...alt, proposed: 'A four-term polynomial.' }
    render(<QueueCard item={withDraft} position={13} total={25} />)
    expect(screen.getByRole('button', { name: 'Use this description' })).toBeTruthy()
    expect(
      screen.getByLabelText('Suggested description — use it, edit it, or replace it:'),
    ).toBeTruthy()
  })

  it('offers to save rather than to use, when there is no draft to use', () => {
    render(<QueueCard item={alt} position={13} total={25} />)
    expect(screen.getByRole('button', { name: 'Save description' })).toBeTruthy()
  })

  it('does not offer a VLM when a real caption already describes the image', () => {
    // A caption is something written ABOUT the image. Offering a speculative
    // draft beside it invites swapping the grounded answer for the guess.
    const captioned = { ...alt, context: { ...alt.context, caption: 'Figure 3. A four-term polynomial.' } }
    render(
      <QueueCard
        item={captioned}
        position={13}
        total={25}
        drafting={{ models: VLM_MODELS, draft: vi.fn() }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Draft locally' })).toBeNull()
  })

  it('prefills flagged publisher alt as the CURRENT value, not as a suggestion', () => {
    const onAnswer = vi.fn()
    render(
      <QueueCard
        item={{ ...alt, current: 'A screenshot of a computer' }}
        position={13}
        total={25}
        onAnswer={onAnswer}
      />,
    )
    const input = screen.getByDisplayValue('A screenshot of a computer')
    expect(
      screen.getByLabelText(
        'Current description — a check flagged it. Edit it, replace it, or draft a new one:',
      ),
    ).toBe(input)
    // Not "Suggested description": the text is already on the image, and saying
    // otherwise would misstate where it came from.
    expect(screen.queryByLabelText(/Suggested description/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Use this description' }))
    expect(onAnswer).toHaveBeenCalledWith({ type: 'alt', text: 'A screenshot of a computer' })
  })

  it('still offers a VLM on flagged alt — that is the case it exists for', () => {
    // `proposed` suppresses the model because a caption is evidence it should
    // not overwrite. `current` must NOT, or the model is withheld from exactly
    // the images an instructor opened the queue to improve.
    render(
      <QueueCard
        item={{ ...alt, current: 'A screenshot of a computer' }}
        position={13}
        total={25}
        drafting={{ models: VLM_MODELS, draft: vi.fn() }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Draft locally' })).toBeTruthy()
  })

  it('a local draft relabels the field, so an accepted draft is never read as the publisher value', async () => {
    const draft = vi.fn(async () => 'A profile picker with two accounts listed.')
    render(
      <QueueCard
        item={{ ...alt, current: 'A screenshot of a computer' }}
        position={13}
        total={25}
        drafting={{ models: VLM_MODELS, draft }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Draft locally' }))
    await screen.findByDisplayValue('A profile picker with two accounts listed.')
    expect(screen.getByText('Draft — not accepted')).toBeTruthy()
    expect(screen.getByLabelText('Suggested description — use it, edit it, or replace it:')).toBeTruthy()
  })

  it('still offers a VLM when all the compiler found was a nearby sentence', () => {
    // The regression this pins: `alt` carries a `reference` and no caption,
    // which is EVERY image in a step-by-step document import. Suppressing on
    // reference made the drafting seam unreachable in exactly that shape — a
    // sentence saying what the reader should do is not a description of what
    // the image shows.
    render(
      <QueueCard
        item={alt}
        position={13}
        total={25}
        drafting={{ models: VLM_MODELS, draft: vi.fn() }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Draft locally' })).toBeTruthy()
  })

  it('is a single-line input, because Enter must natively accept', () => {
    render(<QueueCard item={alt} position={13} total={25} />)
    expect(screen.getByRole('textbox').tagName).toBe('INPUT')
  })

  it('accepts on Enter through the platform, with no key handler of our own', () => {
    // D5.9: Enter is never globally bound. It works here because a single-line
    // input inside a form submits natively — so what is asserted is the
    // MECHANISM, a form plus a submit button, not a synthetic keypress. jsdom
    // does not implement implicit submission, so a test that "pressed Enter"
    // would be asserting its own fireEvent call and nothing about the browser.
    const onAnswer = vi.fn()
    render(<QueueCard item={alt} position={13} total={25} onAnswer={onAnswer} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    const form = input.closest('form')
    expect(form).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Save description' })).toHaveProperty(
      'type',
      'submit',
    )
    fireEvent.change(input, { target: { value: 'A four-term polynomial.' } })
    fireEvent.submit(form!)
    expect(onAnswer).toHaveBeenCalledWith({ type: 'alt', text: 'A four-term polynomial.' })
  })

  it('leaves the other controls out of the submit path', () => {
    // A button inside a form defaults to type="submit". Left alone, "Skip (S)"
    // would save the description it was pressed instead of.
    render(<QueueCard item={alt} position={13} total={25} />)
    expect(screen.getByRole('button', { name: 'Skip (S)' })).toHaveProperty('type', 'button')
    expect(screen.getByRole('button', { name: 'Decorative (D)' })).toHaveProperty('type', 'button')
  })

  it('prefills the draft, so accepting it untouched is one keystroke', () => {
    const onAnswer = vi.fn()
    render(
      <QueueCard
        item={{ ...alt, proposed: 'A four-term polynomial.' }}
        position={13}
        total={25}
        onAnswer={onAnswer}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use this description' }))
    expect(onAnswer).toHaveBeenCalledWith({ type: 'alt', text: 'A four-term polynomial.' })
  })

  it("caps the description field at Canvas's 120-character limit", () => {
    render(<QueueCard item={alt} position={13} total={25} />)
    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '120')
  })

  it('still offers decorative — answers are orthogonal to kinds', () => {
    render(<QueueCard item={alt} position={13} total={25} />)
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toEqual(['Save description', 'Decorative (D)', 'Skip (S)'])
  })

  it('discloses candidate names and download sizes before a local draft', () => {
    render(
      <QueueCard
        item={draftableAlt}
        position={13}
        total={25}
        drafting={{ models: VLM_MODELS, draft: vi.fn() }}
      />,
    )
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual([
      'Florence-2 base — about 318 MiB',
      'Florence-2 large — about 754 MiB',
      'SmolVLM 256M — about 252 MiB',
    ])
    expect(options.some((option) => /Moondream/.test(option ?? ''))).toBe(false)
    expect(screen.getByText(/Its draft is not accepted until you choose to use it/)).toBeTruthy()
  })

  it('keeps a generated draft unaccepted, lets the user replace it, then accepts their text', async () => {
    const onAnswer = vi.fn()
    const draft = vi.fn(async () => 'A red line rises across labeled axes.')
    render(
      <QueueCard
        item={draftableAlt}
        position={13}
        total={25}
        onAnswer={onAnswer}
        drafting={{ models: VLM_MODELS, draft }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Draft locally' }))
    const input = await screen.findByDisplayValue('A red line rises across labeled axes.')
    expect(screen.getByText('Draft — not accepted')).toBeTruthy()
    expect(onAnswer).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'A blue line rises from 1 to 4 on labeled axes.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use this description' }))
    expect(onAnswer).toHaveBeenCalledWith({
      type: 'alt',
      text: 'A blue line rises from 1 to 4 on labeled axes.',
    })
  })

  it('cancels a local draft with an AbortSignal and leaves written description available', async () => {
    let received: AbortSignal | undefined
    const draft = vi.fn((_model, _image, _progress, signal: AbortSignal) => {
      received = signal
      return new Promise<string>(() => {})
    })
    render(
      <QueueCard
        item={draftableAlt}
        position={13}
        total={25}
        drafting={{ models: VLM_MODELS, draft }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Draft locally' }))
    expect(await screen.findByRole('button', { name: 'Cancel draft' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel draft' }))
    expect(received?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Save description' })).toBeTruthy()
  })

  it('turns a model failure into a written-description fallback', async () => {
    const draft = vi.fn(async () => { throw new Error('model file could not be loaded') })
    render(
      <QueueCard
        item={draftableAlt}
        position={13}
        total={25}
        drafting={{ models: VLM_MODELS, draft }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Draft locally' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/model file could not be loaded/))
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save description' })).toBeTruthy()
  })
})

describe('the table card', () => {
  const table: QueueItem = {
    kind: 'table-headers',
    sectionId: 's1',
    elementId: 'T1',
    context: {
      reference: 'We can use a table to keep track of our work, as shown in Table 1.…',
    },
  }

  it('offers four options with no default', () => {
    render(<QueueCard item={table} position={21} total={25} />)
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toEqual([
      'First row',
      'First column',
      'First row and column',
      "It's a layout table",
      'Skip (S)',
    ])
  })

  it('offers no source link and no occurrence line — a table has neither', () => {
    render(<QueueCard item={table} position={21} total={25} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/appears in/)).toBeNull()
  })

  it('explains an absent reference in table words, not image words', () => {
    render(<QueueCard item={{ ...table, context: {} }} position={21} total={25} />)
    expect(
      screen.getByText('No text near this table was found — use the highlighted table below.'),
    ).toBeTruthy()
  })

  it('shows a real caption and answers with the option chosen', () => {
    const onAnswer = vi.fn()
    render(
      <QueueCard
        item={{ ...table, context: { ...table.context, caption: 'Table 1 Products of terms.' } }}
        position={21}
        total={25}
        onAnswer={onAnswer}
      />,
    )
    expect(screen.getByText(/Table 1 Products of terms\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'First row and column' }))
    expect(onAnswer).toHaveBeenCalledWith({ type: 'table-headers', choice: 'both' })
  })
})

describe('a refusal', () => {
  it('is shown on the card, where the answer that caused it still is', () => {
    // Also announced by the view's alert region; this is the inline half, and
    // it is what the instructor is looking at when they read the message.
    render(
      <QueueCard
        item={{ ...decorative, kind: 'alt' }}
        position={13}
        total={25}
        refusal="Not saved: the description is empty."
      />,
    )
    expect(screen.getByText('Not saved: the description is empty.')).toBeTruthy()
  })

  it('is not itself a live region, so it is not announced twice', () => {
    render(
      <QueueCard
        item={{ ...decorative, kind: 'alt' }}
        position={13}
        total={25}
        refusal="Not saved: the description is empty."
      />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
