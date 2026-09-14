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
  /** The radiogroup's name: the row letter when a category has several rows, else just "Rating". */
  ratingRow: (rowLetter: string) => `Row ${rowLetter}`,
  rating: 'Rating',
  /** Plan's one line about this phase, from `ideaSummary`'s "optional" / "n of m rated". */
  planLine: (summary: string) => `IDEA review — ${summary}`,
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
    region: 'Region served',
    regionHint: 'e.g. California Central Valley - used only to focus the model\'s suggestions. Not part of Rubric 1.',
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
    count: (n: number) => `${n} suggestion${n === 1 ? '' : 's'}`,
    /** Read by a screen reader between the original and its replacement. */
    replaceWith: 'replace with',
    /** Labels for an observation's columns; a key with no label is shown as itself. */
    columns: {
      text: 'Text',
      context: 'Context',
      alternative: 'One alternative',
      idiom: 'Idiom',
      gloss: 'Meaning',
      image: 'Image',
      description: 'Description',
      caption: 'Caption',
      reference: 'Referenced as',
      images: 'Images',
      decorative: 'Decorative',
      kind: 'Kind',
      detail: 'Detail',
    } as Readonly<Record<string, string>>,
  },
  applied: {
    heading: 'Applied',
    undo: 'Undo',
    stale: 'no longer matches; not applied',
    replaced: (from: string, to: string) => `“${from}” → “${to}”`,
    kept: (term: string, context?: string) => (context ? `“${term}” kept, with “(${context})”` : `“${term}” kept as is`),
    image: (alt: string) => `Image added: “${alt}”`,
    announceApplied: 'Applied.',
    announceUndone: 'Undone.',
    announceDismissed: 'Dismissed.',
  },
  imageSearch: {
    /** The link under each result to the page the image came from. */
    sourceLink: 'source',
    find: 'Find an openly licensed photo',
    findAlternative: 'Find an alternative',
    heading: 'Openly licensed images',
    /** Spec §6.2: the Framework's guidance line, above the results. */
    guidance: 'Look for people whose identity is not the subject of the image.',
    query: 'Search for',
    provider: 'Source',
    licenses: 'Licences',
    shareAlikeNote: 'share-alike: the page must carry the same licence for this image',
    search: 'Search',
    searching: 'Searching…',
    cancel: 'Cancel',
    close: 'Close image search',
    none: 'No images matched. Try a broader search, or one of these collections:',
    more: 'More sources (no search here; add an image through Document import)',
    use: 'Use this image',
    by: (creator: string) => `by ${creator}`,
    notOffered: (label: string) => `${label} could not be reached from a browser when last measured.`,
  },
  placeImage: {
    title: 'Place this image',
    alt: 'Describe this image for a student who cannot see it',
    altHint: 'One or two sentences: what it shows and what matters about it. Don’t start with “Image of”.',
    caption: 'Caption (optional)',
    where: 'Where',
    replace: (what: string) => `Replace ${what}`,
    after: (what: string) => `After “${what}”`,
    obligation: (tasl: string) => `This page will credit: ${tasl}`,
    shareAlike: 'This image is CC BY-SA. The page will say that adaptations of the image must carry the same licence.',
    use: 'Use this image',
    fetching: 'Fetching the image…',
    cancel: 'Cancel',
    announceAdded: 'Image added.',
    /** Why `prepareAssets` refused the bytes, by its rejection reason. */
    refused: {
      'unsupported-type': 'That file is not an image this app can package (PNG, JPEG, GIF, WebP).',
      'too-large': 'That image is larger than the cartridge budget allows.',
      'too-many-pixels': 'That image would decode to more pixels than the cartridge budget allows.',
      other: 'That image could not be prepared.',
    } as Readonly<Record<string, string>>,
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
  llm: {
    legend: 'Model provider (optional)',
    intro: 'Bring your own API key to draft suggestions for the categories a rule cannot check. Drafts are never applied on their own.',
    provider: 'Provider',
    key: 'API key',
    model: 'Model',
    save: 'Save on this device',
    forget: 'Forget key',
    showKey: 'Show key',
    hideKey: 'Hide key',
    stored: 'Your key is stored in this browser on this device (not on any server) and stays until you choose Forget key. On a shared computer, forget it when you are done. Forget all IDEA reviews does not remove it.',
    notOffered: (label: string) => `${label} cannot be called from a browser directly, so it is not offered here.`,
    evidence: 'measured',
    terms: (label: string) => `${label} terms`,
    none: 'No provider set. Add a key above to draft suggestions for this category, or use the checklist.',
    heading: 'Ask the model',
    send: (label: string) => `Send this section to ${label}`,
    sending: (label: string) => `Waiting for ${label}…`,
    cancel: 'Cancel',
    sends: 'What leaves your browser when you press the button: this section’s text and its image descriptions (for 7.1, only the image descriptions). Nothing is sent until you press it.',
    draftLabel: 'Drafts',
    error: {
      'bad-key': 'The provider rejected this key. Check it in the settings above.',
      'model-not-found': 'The provider does not know this model name. Check it in the settings above.',
      'rate-limited': 'The provider is rate-limiting this key.',
      unreachable: 'The provider could not be reached from this browser.',
      timeout: 'The provider did not answer in time.',
      aborted: 'Cancelled.',
    } as const,
    crosswalk: {
      sentence: "Prompts follow OERI's",
      link: 'IDEA Framework Gen-AI Crosswalk Instructions',
      licence: '(CC BY 4.0).',
    },
    summaries: {
      heading: 'Chapter summaries and key concepts',
      button: (label: string) => `Draft: chapter summaries and key concepts (${label})`,
      sends: 'What leaves your browser for this button: this section’s headings and key blocks and its first and last two paragraphs.',
    },
    rubricDraft: {
      button: (label: string) => `Draft a Rubric 1 review with ${label}`,
      column: 'Model draft',
      noDraft: 'no draft',
      useNote: 'Use this note',
      cannotCopy: 'A draft rating is shown for comparison only; choose your own rating.',
    },
  },
} as const

export { RATING_LABEL as RATING_COPY } from '../../engine/idea/review'

export const RATING_ORDER: readonly Rating[] = ['na', 'exclusive', 'emerging', 'inclusive']

export const CHECKLIST_COPY: Readonly<Record<ChecklistAnswer, string>> = {
  yes: 'Yes',
  no: 'No',
  unsure: 'Unsure',
  skip: 'Skip',
}

export const CHECKLIST_ORDER: readonly ChecklistAnswer[] = ['yes', 'no', 'unsure', 'skip']
