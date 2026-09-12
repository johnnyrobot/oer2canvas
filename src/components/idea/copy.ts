/**
 * Every user-facing string on the IDEA screen. STRINGS ONLY, in one place, so
 * the panel, the screen, and the live region never drift apart, and so the
 * one string that argues is quoted from the spec rather than paraphrased.
 */
import type { ChecklistAnswer, Rating } from '../../engine/idea/review'

export const IDEA_COPY = {
  heading: 'IDEA review',
  intro:
    'Apply the ASCCC OERI Inclusion, Diversity, Equity, and Anti-Racism Framework to this chapter. ' +
    'This review is optional and never blocks publishing.',
  storage:
    'Reviews, the assessor, and the benchmark are saved in this browser on this device until you forget them. ' +
    'Nothing about a review is sent anywhere.',
  restorativeHeading: 'Restorative requirements',
  checklistHeading: 'Elements for consideration',
  rubricHeading: 'Rubric 1',
  /** The one string in this feature that argues. Spec §5.3, verbatim. */
  rubricArgument:
    'Rate what you observed, not what the tool counted. The counts and drafts are evidence; the judgment is yours.',
  notesLabel: 'Notes',
  notesHint: 'Page references, examples, and anything the rating needs explaining.',
  resourcesHeading: 'Additional resources',
  opensNewTab: 'opens in a new tab',
  ratedSummary: (rated: number, total: number) => {
    if (total === 1) return rated === 1 ? 'rated' : 'not rated'
    return rated === 0 ? 'not rated' : `${rated} of ${total} rows rated`
  },
  assessor: {
    legend: 'Assessor',
    hint: 'Entered once; stamped into every chapter’s Rubric 1.',
    name: 'Name',
    title: 'Title',
    college: 'College',
  },
  benchmark: {
    label: 'BIPOC benchmark',
    hint:
      '77% of California Community College students are BIPOC (CCCCO Data Mart, Fall 2022). ' +
      'The Framework says colleges may adjust this to their own demographics.',
  },
  chapterLevel: {
    legend: 'Chapter summary',
    summary: 'Summary',
    suggestions: 'Suggestions',
  },
  export: {
    legend: 'Export Rubric 1',
    markdown: 'Download Markdown',
    json: 'Download JSON',
    done: (name: string) => `Downloaded ${name}.`,
  },
  forget: {
    button: 'Forget all IDEA reviews',
    confirm:
      'This removes every chapter’s review, the assessor, and the benchmark from this browser. ' +
      'Files you have already downloaded are unaffected.',
    yes: 'Forget',
    no: 'Keep',
    done: 'IDEA reviews forgotten.',
  },
  chapterSwitcher: 'Chapter under review',
  renderLabel: 'Chapter as it will be published',
  attribution: (title: string, author: string, license: string) =>
    `Framework text from "${title}" by ${author}, licensed ${license}.`,
  empty: 'Nothing to review yet. Prepare chapters first.',
} as const

export const RATING_COPY: Readonly<Record<Rating, string>> = {
  na: 'Not Applicable',
  exclusive: 'Exclusive',
  emerging: 'Emerging Inclusive',
  inclusive: 'Inclusive',
}

export const RATING_ORDER: readonly Rating[] = ['na', 'exclusive', 'emerging', 'inclusive']

export const CHECKLIST_COPY: Readonly<Record<ChecklistAnswer, string>> = {
  yes: 'Yes',
  no: 'No',
  unsure: 'Unsure',
  skip: 'Skip',
}

export const CHECKLIST_ORDER: readonly ChecklistAnswer[] = ['yes', 'no', 'unsure', 'skip']
