/**
 * 7.7 Keyword, Glossary, and Metadata — what the section SIGNALS as important.
 *
 * The Framework's point is that summaries, key terms, and glossaries tell a
 * student what matters, so whoever is absent from them is absent from what
 * matters. This lists what those sections contain; the instructor judges.
 *
 * Proper nouns are the crudest of these: capitalised runs that appear at least
 * twice and at least once where the grammar did not force the capital.
 * Textbook prose names the theorists it centres, and a list of them is a list
 * the assessor can read against the Framework's example (a summary naming
 * four white men).
 */
import type { Finder, IdeaFinding } from './findings'

export type MetadataKind = 'heading' | 'glossary' | 'defined-term' | 'key-block' | 'proper-noun'

export interface MetadataRow {
  sectionId: string
  elementId?: string
  kind: MetadataKind
  text: string
  /** A glossary definition, or a proper noun's occurrence count. */
  detail?: string
}

/**
 * Where publishers put the "this is what matters" blocks. A fixed list rather
 * than a `PublisherProfile` field because finders receive no profile.
 */
export const KEY_BLOCK_SELECTOR = [
  '.os-key-takeaways', '.key-takeaways', '.os-summary', '.summary', '.os-learning-objectives',
  '.learning-objectives', '.chapter-summary', '.key-concepts', '.os-glossary-container', '.glossary',
  '[data-type="key-takeaways"]', '[data-type="summary"]', '[data-type="learning-objectives"]',
].join(', ')

/**
 * Words that open a sentence because of grammar, not because they are names.
 * A sentence-initial run that starts with one of these ("Then Golgi bodies")
 * loses it, so the name behind it is counted on its own.
 */
const OPENERS = new Set([
  'The', 'A', 'An', 'In', 'On', 'At', 'As', 'By', 'For', 'From', 'To', 'With', 'Of',
  'This', 'These', 'That', 'Those', 'Then', 'There', 'Here', 'Now', 'When', 'While', 'Where',
  'After', 'Before', 'Once', 'Since', 'Until', 'If', 'Although', 'Because', 'But', 'And', 'Or', 'So', 'Yet',
  'It', 'Its', 'He', 'She', 'They', 'We', 'You', 'I', 'His', 'Her', 'Their', 'Our', 'Your',
  'Some', 'Many', 'Most', 'Each', 'Every', 'Both', 'All', 'Any', 'No', 'Not', 'Other', 'Another', 'Such',
  'However', 'Therefore', 'Thus', 'Also', 'Finally', 'First', 'Second', 'Third', 'Next', 'Later',
  'One', 'Two', 'Three', 'Four', 'Five', 'Which', 'Who', 'What', 'How', 'Why',
])

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

interface Tally { total: number; midSentence: number }

/**
 * Capitalised runs of 1–3 words, with how many occurrences the grammar did
 * NOT capitalise. A single word at a sentence start is ambiguous; a run of two
 * or more capitalised words there ("Sigmund Freud proposed…") is not, and
 * counts as mid-sentence evidence.
 */
function properNouns(paragraphText: string): Map<string, Tally> {
  const counts = new Map<string, Tally>()
  const sentences = paragraphText.split(/(?<=[.!?])\s+/)
  for (const sentence of sentences) {
    const run = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g
    let m: RegExpExecArray | null
    while ((m = run.exec(sentence)) !== null) {
      let name = m[1]!
      let atStart = false
      if (m.index === 0) {
        const words = name.split(/\s+/)
        if (words.length > 1 && OPENERS.has(words[0]!)) name = words.slice(1).join(' ')
        else if (words.length === 1) atStart = true
      }
      const c = counts.get(name) ?? { total: 0, midSentence: 0 }
      c.total += 1
      if (!atStart) c.midSentence += 1
      counts.set(name, c)
    }
  }
  return counts
}

export function metadataInventory(sectionId: string, html: string): MetadataRow[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const rows: MetadataRow[] = []
  const withId = (el: Element) => (el.getAttribute('id') ? { elementId: el.getAttribute('id')! } : {})

  for (const h of Array.from(doc.body.querySelectorAll('h2, h3, h4'))) {
    rows.push({ sectionId, ...withId(h), kind: 'heading', text: clean(h.textContent) })
  }
  for (const dt of Array.from(doc.body.querySelectorAll('dt'))) {
    const dd = dt.nextElementSibling?.tagName === 'DD' ? clean(dt.nextElementSibling.textContent) : ''
    rows.push({ sectionId, ...withId(dt), kind: 'glossary', text: clean(dt.textContent), ...(dd ? { detail: dd } : {}) })
  }
  for (const p of Array.from(doc.body.querySelectorAll('p, li'))) {
    const lead = p.firstElementChild
    if (lead && (lead.tagName === 'STRONG' || lead.tagName === 'B') && p.firstChild === lead) {
      const term = clean(lead.textContent)
      if (term && term.length <= 60) rows.push({ sectionId, ...withId(p), kind: 'defined-term', text: term })
    }
  }
  for (const block of Array.from(doc.body.querySelectorAll(KEY_BLOCK_SELECTOR))) {
    for (const p of Array.from(block.querySelectorAll('p, li'))) {
      rows.push({ sectionId, ...withId(p), kind: 'key-block', text: clean(p.textContent) })
    }
  }
  const totals = new Map<string, Tally>()
  for (const p of Array.from(doc.body.querySelectorAll('p, li, dd'))) {
    for (const [name, c] of properNouns(clean(p.textContent))) {
      const t = totals.get(name) ?? { total: 0, midSentence: 0 }
      t.total += c.total
      t.midSentence += c.midSentence
      totals.set(name, t)
    }
  }
  // Longest names first, then drop any shorter name that sits inside a kept
  // one ("Freud" inside "Sigmund Freud"), so the list names people once.
  const kept: string[] = []
  for (const [name, c] of [...totals].sort((a, b) => b[0].length - a[0].length)) {
    if (c.total < 2 || c.midSentence < 1) continue
    if (kept.some((k) => k.includes(name))) continue
    kept.push(name)
  }
  for (const name of kept) rows.push({ sectionId, kind: 'proper-noun', text: name, detail: String(totals.get(name)!.total) })
  return rows
}

export const findMetadata: Finder = (sectionId, html) => {
  return metadataInventory(sectionId, html).map<IdeaFinding>((r, i) => ({
    kind: 'observation',
    key: `${sectionId}::${r.elementId ?? 'meta'}::${i}::${r.kind}`,
    category: '7.7',
    sectionId,
    ...(r.elementId ? { elementId: r.elementId } : {}),
    columns: { kind: r.kind.replace('-', ' '), text: r.text, ...(r.detail ? { detail: r.detail } : {}) },
    rule: { id: `inventory-${r.kind}`, source: 'inventory' },
    origin: 'rule',
  }))
}
