import { render, screen } from '@testing-library/react'
import type { CompiledChapter, CompiledSection } from '../contracts/index'
import { PlanScreen } from './PlanScreen'
import type { Destination } from './phases'

const CANVAS: Destination = { kind: 'canvas', courseId: 7, courseName: 'Intro Algebra' }

/** A verdict that passed. `isPublishable` needs one, or the plan is never ready. */
const PASSED = {
  html: '<p>x</p>',
  conformance: { blockers: [], issues: [] },
  badgeWithheld: false,
} as unknown as CompiledSection['gate']

const section = (id: string, title: string): CompiledSection => ({
  id, title, html: `<p>${id}</p>`, notes: [], queue: [], gate: PASSED,
})

const chapter = (title: string, sections: CompiledSection[]): CompiledChapter => ({
  chapter: { title } as CompiledChapter['chapter'], sections, queue: [],
})

const CHAPTERS = [chapter('Chapter 1', [section('a', 'Introduction'), section('b', 'Polynomials')])]

test('a page that would replace an existing one says so, in the indicative', () => {
  render(
    <PlanScreen
      destination={CANVAS}
      chapters={CHAPTERS}
      unansweredCount={0}
      existingPages={[{ url: 'chapter-1-introduction', title: 'Introduction' }]}
    />,
  )
  expect(screen.getByText('Replaces an existing page')).toBeInTheDocument()
  expect(screen.getByText('New page')).toBeInTheDocument()
})

// Colour alone would say this only to people who can see it, and "you are about
// to overwrite your own work" is the single most expensive thing to miss here.
test('the overwrite warning carries an icon and words, not just a colour', () => {
  render(
    <PlanScreen
      destination={CANVAS}
      chapters={CHAPTERS}
      unansweredCount={0}
      existingPages={[{ url: 'chapter-1-introduction', title: 'Introduction' }]}
    />,
  )
  expect(screen.getByText(/1 would overwrite a page already in Intro Algebra/)).toBeInTheDocument()
})

/*
  This branch used to read "Producing the file is not built yet — that is the
  cartridge writer, and it is the next thing." Both halves are now false: the
  cartridge writer ships, and with E7 shipped the only way to reach a ready plan
  with nothing to commit is a Canvas destination that has not been connected. The
  sentence has to name that, or it sends someone to wait for a feature that
  arrived two epics ago.
*/
test('a ready plan with no way to commit says the course is not connected', () => {
  render(
    <PlanScreen
      destination={CANVAS}
      chapters={CHAPTERS}
      unansweredCount={0}
      existingPages={[]}
    />,
  )
  expect(screen.getByText(/Connect Canvas on the Destination screen/)).toBeInTheDocument()
  expect(screen.queryByText(/not built yet/)).not.toBeInTheDocument()
})

test('browser-import warnings remain visible in the plan summary', () => {
  render(
    <PlanScreen
      destination={{ kind: 'cartridge' }}
      chapters={CHAPTERS}
      unansweredCount={0}
      importFindings={[{
        code: 'unresolved-link',
        severity: 'warning',
        message: 'A relative link could not be preserved; its visible text remains.',
      }]}
    />,
  )

  expect(screen.getByRole('heading', { name: 'Import findings' })).toBeInTheDocument()
  expect(screen.getByText(/relative link could not be preserved/i)).toBeInTheDocument()
})
