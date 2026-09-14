/**
 * OERI's Appendix A prompt shapes, adapted for a browser that cannot follow a
 * link: the category's own Framework text is inlined as the lens, and the
 * output is asked for as JSON in the columns OERI's tables use.
 *
 * The three sentences quoted from OERI's Gen-AI Crosswalk (April 2026) are
 * the ones that carry its stance, and they are kept verbatim: treat the output
 * as a draft, keep the discipline expert in control, and separate what is seen
 * from what is inferred.
 */
import {
  categoryById, CROSSWALK_ATTRIBUTION, FRAMEWORK_ATTRIBUTION, IDEA_FRAMEWORK, RUBRIC_NA_TEXT, type CategoryId,
} from '../framework'
import type { ImageRow } from '../images'
import type { MetadataRow } from '../metadata'
import { blockElements } from '../text'

export type DraftableCategory = '7.1' | '7.2' | '7.3' | '7.4' | '7.5' | '7.6' | '7.7' | '7.8'
/** The categories with an Ask-the-model zone — every one, since the Crosswalk has a prompt for each. */
export const DRAFTABLE: readonly DraftableCategory[] = ['7.1', '7.2', '7.3', '7.4', '7.5', '7.6', '7.7', '7.8']

export interface SectionInput {
  sectionId: string
  sectionTitle: string
  chapterTitle: string
  /** The source book's title; the model reads the discipline from it. */
  bookTitle?: string
  text: string
  images: ImageRow[]
  metadata: MetadataRow[]
  /** `IdeaHeader.region`; empty or absent means the regional element is left out. */
  region?: string
}

type Msg = { role: 'system' | 'user'; content: string }

const SYSTEM =
  "You are assisting a college instructor who is applying the ASCCC OERI Inclusion, Diversity, Equity, and Anti-Racism (IDEA) Framework to an open textbook section. " +
  "Treat your output as a draft that needs the instructor’s disciplinary expertise; you are never the end result. " +
  "Clearly separate what you see explicitly in the text from what you infer or recommend. " +
  "Do not guess anyone’s race, ethnicity, gender, age, or disability from a name or an image description; describe only what the text states. " +
  `Framework text is quoted from "${FRAMEWORK_ATTRIBUTION.title}" (CC BY 4.0); the shape of this task follows "${CROSSWALK_ATTRIBUTION.title}" (CC BY 4.0).`

function lens(c: CategoryId): string {
  const cat = categoryById(c)
  return `FRAMEWORK CATEGORY ${cat.id} ${cat.title}\nRestorative requirements: ${cat.restorative}\nElements for consideration:\n${cat.elements.map((e) => `- ${e.text}`).join('\n')}` +
    (cat.resources.length ? `\nResources you may name (do not fetch): ${cat.resources.map((r) => `${r.label} <${r.url}>`).join('; ')}` : '')
}

const CONTEXT = (i: SectionInput) =>
  `Chapter: ${i.chapterTitle}\nSection: ${i.sectionTitle}${i.bookTitle ? `\nBook: ${i.bookTitle}` : ''}${i.region ? `\nRegion served: ${i.region}` : ''}`

const ITEM_SHAPE =
  'Respond with JSON only, no prose before or after: {"summary": string, "items": [{"evidence": string, "inference": string, "suggestion": string, "original"?: string, "replacement"?: string}]}. ' +
  '"evidence" quotes the text exactly; "inference" is what you conclude; "suggestion" is the revision. ' +
  'Include "original" and "replacement" ONLY when the suggestion is a direct wording substitution and "original" is copied verbatim from the text.'

const TASK: Record<DraftableCategory, (i: SectionInput) => string> = {
  '7.1': (i) =>
    `Analyze the following image descriptions, alt text, and captions for how people are visually represented — diversity across race, ethnicity, age, gender, ability, and more; whether people appear where identity is not the subject; whether any depiction risks a stereotype. Do NOT infer identity from a description that does not state it.\n\nIMAGES:\n${i.images.map((r, n) => `${n + 1}. ref=${r.elementId} alt="${r.alt ?? '(none)'}" caption="${r.caption ?? ''}" reference="${r.reference ?? ''}"`).join('\n') || '(no images)'}\n\n` +
    'Respond with JSON only: {"summary": string, "items": [{"imageRef": string, "evidence": string, "inference": string, "suggestion": string}]}. "imageRef" is the ref value.',
  '7.2': (i) => `Identify the example names used for people in this text. Consider whether they represent various countries of origin, ethnicities, genders, and races and whether any is associated with a stereotype. Do not assert a person’s identity from a name; say what a name suggests only as an inference.\n\nTEXT:\n${i.text}\n\n${ITEM_SHAPE}`,
  '7.3': (i) =>
    `Review this text for gendered language and pronoun use. Identify where the language is inclusive of gender (including gender nonconforming pronouns) and where it is binary or stereotypical. Evaluate it against the Rubric 1 rows for this area — put that evaluation in "summary" as text with the columns area, rating, and notes — and propose where inclusive rewrites would best be incorporated for sentences or scenarios. Pronoun rewrites are the author's to make: describe where and why, and quote the passage as "evidence".\n\nTEXT:\n${i.text}\n\n${ITEM_SHAPE}`,
  '7.4': (i) =>
    `Identify the authors, researchers, scholars, and studies referenced in this text. Assess the diversity of the contributors cited and whether historically underrepresented contributors are absent; suggest current, relevant contributors where appropriate, naming only real people and works you are confident exist. ` +
    'Then identify alternative researchers and/or studies that could be utilized to help diversify the sources used: for each, give a primary link to the source material (name it; nothing will be fetched) and a short description of how it could replace what currently exists.' +
    (i.region ? ` Then identify ways in which this chapter could center historically marginalized scholars and/or communities within ${i.region} in more intentional ways through the examples or narrative descriptions used.` : '') +
    `\n\nTEXT:\n${i.text}\n\n${ITEM_SHAPE}`,
  '7.5': (i) =>
    `Review the applications, examples, and problem scenarios in this text for whether they relate to diverse audiences, assume cultural knowledge, or risk a stereotype.\n\nTEXT:\n${i.text}\n\n` +
    'Respond with JSON only: {"summary": string, "items": [{"scenario": string, "population": string, "cultural knowledge assumed": string, "stereotype risk": string, "suggested revision": string, "original"?: string, "replacement"?: string}]}.',
  '7.6': (i) =>
    `Identify all terms in this text that may be related to race, indigeneity, gender, sexuality, disability, and mental health, and flag any that may be outdated, pathologizing, or inconsistent with equity-oriented professional or community language. Suggest alternative, appropriate terminology, naming which of the resources listed above you drew on. Note any terms that may need explicit historical contextualization rather than replacement.\n\nTEXT:\n${i.text}\n\n${ITEM_SHAPE}`,
  '7.7': (i) => `Review the keywords, glossary terms, headings, and summary content below for whether diverse topics, scholars, and perspectives are represented among what the section signals as important.\n\nMETADATA:\n${i.metadata.map((m) => `- [${m.kind}] ${m.text}${m.detail ? ` — ${m.detail}` : ''}`).join('\n') || '(none)'}\n\n${ITEM_SHAPE}`,
  '7.8': (i) => `Identify issues, events, and concepts in this text where perspectives of underrepresented groups are relevant, and whether they are present, balanced, and free of generalization.\n\nTEXT:\n${i.text}\n\n${ITEM_SHAPE}`,
}

export function categoryPrompt(category: DraftableCategory, input: SectionInput): Msg[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${CONTEXT(input)}\n\n${lens(category)}\n\nTASK:\n${TASK[category](input)}` },
  ]
}

export function rubricPrompt(chapterTitle: string, sections: SectionInput[]): Msg[] {
  const ids: CategoryId[] = ['7.1', '7.2', '7.3', '7.4', '7.5', '7.6', '7.7', '7.8']
  const body = sections.map((s) => `## ${s.sectionTitle}\n${s.text}\n\nImages: ${s.images.map((r) => `alt="${r.alt ?? '(none)'}" caption="${r.caption ?? ''}"`).join(' | ') || '(none)'}`).join('\n\n')
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `Chapter: ${chapterTitle}\n\nDraft a Rubric 1 review of this chapter using the IDEA Framework. For each row of each area, rate as one of: Not Applicable, Exclusive, Emerging Inclusive, Inclusive, and give notes per area that cite evidence from the text. The instructor will make the actual rating; yours is a draft.\n\n` +
        ids.map(lens).join('\n\n') +
        `\n\nRUBRIC 1 ROWS:\n${rubricRows()}\n\n` +
        `CHAPTER TEXT:\n${body}\n\n` +
        'Respond with JSON only: {"areas": [{"area": string, "rows": [{"row": string, "rating": string}], "notes": string}]} with one entry per area 7.1 through 7.8, "area" beginning with the number, and one "rows" entry per row id listed above.',
    },
  ]
}

/** Every Rubric 1 row, quoted, so the model rates exactly what the assessor rates. */
function rubricRows(): string {
  return IDEA_FRAMEWORK.flatMap((c) => c.rows.map((r) =>
    `${r.id} (${c.rubricTitle}): Exclusive = "${r.exclusive}"; Emerging Inclusive = "${r.emerging}"; Inclusive = "${r.inclusive}"; Not Applicable = "${RUBRIC_NA_TEXT}"`,
  )).join('\n')
}

/** Block text, one blank line between blocks, no markup and no ids. */
export function sectionText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.body.querySelector('.b2c-attribution')?.remove()
  return blockElements(doc.body)
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}
