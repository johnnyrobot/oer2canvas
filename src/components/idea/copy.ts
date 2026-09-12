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
  findings: {
    heading: 'What a rule found',
    none: 'No wording this rule set recognises. That is not a clean bill; the checklist below is the review.',
    ruleSays: (source: string) => `${source} ↗`,
    inQuotation: 'inside a quotation',
    where: (sectionTitle: string) => `in ${sectionTitle}`,
    replace: 'Replace',
    edit: 'Edit…',
    keep: 'Keep, add context…',
    keepAsIs: 'Keep as is',
    dismiss: 'Dismiss',
    save: 'Save',
    cancel: 'Cancel',
    contextPlaceholder: 'a widely used term at the time',
    replacementLabel: 'Replacement',
    contextLabel: 'Context to add after the term',
    observation: 'Observation',
    suggestionLabel: 'Suggested wording',
    useSuggestion: 'Use this wording',
    draft: 'draft',
    rule: 'rule',
    failed: (categoryId: string, sectionTitle: string) => `${categoryId} couldn’t be checked on ${sectionTitle}`,
    failedDetail: 'Error',
  },
  applied: {
    heading: 'Applied',
    undo: 'Undo',
    stale: 'no longer matches; not applied',
    replaced: (from: string, to: string) => `“${from}” → “${to}”`,
    kept: (term: string, context?: string) => (context ? `“${term}” kept, with “(${context})”` : `“${term}” kept as is`),
    announceApplied: 'Applied.',
    announceUndone: 'Undone.',
    announceDismissed: 'Dismissed.',
  },
  inventory: {
    heading: 'Inventory',
    none: 'Nothing to list in this section.',
    imagesSummary: (images: number, people: number) =>
      `${images} image${images === 1 ? '' : 's'} · ${people} mention${people === 1 ? 's' : ''} people`,
    items: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
    guidance71:
      'Read the descriptions and captions as a set: who is shown, in what role, and where the picture does not relate to identity. Then tally for Rubric 1.',
    guidance77:
      'These are the terms and names the section signals as important. Rubric 1 asks whether diverse scholars and perspectives appear among them.',
  },
  render: {
    pending: 'Re-checking this section…',
  },
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
