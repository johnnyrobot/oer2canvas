/**
 * Model text → findings. Two rules do the work: an unparseable response is
 * shown, not dropped; and an item becomes an EDIT only when the text it says
 * it is replacing is actually there, verbatim. The model can propose; it
 * cannot edit what it did not quote.
 */
import { categoryById, type CategoryId } from '../framework'
import type { IdeaFinding } from '../findings'
import type { Rating } from '../review'
import { ideaEditKey } from '../edits'
import { blockElements, countOccurrences, findOccurrence, isQuotation, textBefore, textNodesOf } from '../text'

export interface DraftItem {
  evidence: string
  inference: string
  suggestion: string
  original?: string
  replacement?: string
  imageRef?: string
  [column: string]: string | undefined
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1]! : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no json')
  return JSON.parse(candidate.slice(start, end + 1))
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))

export function parseCategoryResponse(text: string): { items: DraftItem[]; summary?: string; raw?: string } {
  try {
    const j = extractJson(text) as { summary?: unknown; items?: unknown }
    const items = Array.isArray(j.items)
      ? j.items.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null).map((x) => {
          const item: DraftItem = { evidence: str(x.evidence), inference: str(x.inference), suggestion: str(x.suggestion ?? x['suggested revision']) }
          for (const [k, v] of Object.entries(x)) if (!(k in item) && typeof v === 'string') item[k] = v
          if (typeof x.original === 'string' && x.original.trim()) item.original = x.original
          if (typeof x.replacement === 'string') item.replacement = x.replacement
          if (typeof x.imageRef === 'string') item.imageRef = x.imageRef
          return item
        })
      : []
    return { items, ...(typeof j.summary === 'string' ? { summary: j.summary } : {}) }
  } catch {
    return { items: [], raw: text }
  }
}

export function draftsToFindings(
  category: CategoryId,
  sectionId: string,
  html: string,
  parsed: { items: DraftItem[]; summary?: string; raw?: string },
): IdeaFinding[] {
  const out: IdeaFinding[] = []
  const rule = { id: `llm-${category}`, source: 'llm' as const }
  if (parsed.raw !== undefined) {
    out.push({ kind: 'observation', key: `${sectionId}::llm::${category}::raw`, category, sectionId, columns: { response: parsed.raw }, rule: { ...rule, note: 'The model did not answer in the requested shape; its reply is shown as written.' }, origin: 'draft' })
    return out
  }
  if (parsed.summary) {
    out.push({ kind: 'observation', key: `${sectionId}::llm::${category}::summary`, category, sectionId, columns: { summary: parsed.summary }, rule, origin: 'draft' })
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const blocks = blockElements(doc.body).filter((el) => el.getAttribute('id'))
  parsed.items.forEach((item, n) => {
    if (item.original && item.replacement !== undefined) {
      for (const el of blocks) {
        for (const node of textNodesOf(el)) {
          const at = node.data.indexOf(item.original)
          if (at === -1) continue
          const elementId = el.getAttribute('id')!
          const occurrence = countOccurrences(textBefore(el, node, at), item.original)
          if (!findOccurrence(el, item.original, occurrence)) continue
          out.push({
            kind: 'edit', key: ideaEditKey(sectionId, elementId, occurrence, item.original), category, sectionId, elementId,
            original: item.original, occurrence, replacement: item.replacement, inQuotation: isQuotation(el),
            rule: { ...rule, note: item.inference || item.suggestion }, origin: 'draft',
          })
          return
        }
      }
    }
    const columns: Record<string, string> = {}
    for (const [k, v] of Object.entries(item)) if (typeof v === 'string' && v && k !== 'original' && k !== 'replacement') columns[k] = v
    const elementId = item.imageRef && doc.getElementById(item.imageRef) ? item.imageRef : undefined
    out.push({ kind: 'observation', key: `${sectionId}::llm::${category}::${n}`, category, sectionId, ...(elementId ? { elementId } : {}), columns, rule, origin: 'draft' })
  })
  return out
}

export interface RubricDraft {
  /** One entry per area the model answered; `rows` always lists every Rubric 1 row of that area. */
  areas: { id: CategoryId; rows: { id: string; rating: Rating | null }[]; notes: string }[]
  raw?: string
}

const RATING: Record<string, Rating> = {
  'not applicable': 'na', 'n/a': 'na', na: 'na',
  exclusive: 'exclusive',
  'emerging inclusive': 'emerging', emerging: 'emerging',
  inclusive: 'inclusive',
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null
const toRating = (v: unknown): Rating | null => RATING[str(v).trim().toLowerCase()] ?? null

/**
 * Per ROW, because the human's rating is per row (slice 1). A "rows" array is
 * matched by id, bare ("b") or qualified ("7.1.b"); a bare "rating" on the
 * area is honoured only when the area has one row. A three-row area with one
 * rating gets three nulls: spreading it would show the model rating rows it
 * never looked at.
 */
export function parseRubricResponse(text: string): RubricDraft {
  try {
    const j = extractJson(text) as { areas?: unknown }
    const areas = (Array.isArray(j.areas) ? j.areas : [])
      .filter(isRecord)
      .map((x) => {
        const m = /^(7\.[1-8])/.exec(str(x.area).trim())
        if (!m) return undefined
        const id = m[1] as CategoryId
        const frameworkRows = categoryById(id).rows
        const given = new Map<string, Rating | null>()
        for (const r of Array.isArray(x.rows) ? x.rows.filter(isRecord) : []) {
          // The id at the START of the string, bare or qualified, with
          // anything after it ignored: Gemini echoes the prompt's row line
          // back as "7.1.a (Illustrations and Photos of People)" (measured
          // 2026-09-12), and an exact match dropped every row to null.
          const m = /^(?:(7\.[1-8])\.)?([a-z])(?![a-z0-9])/i.exec(str(r.row).trim())
          if (!m) continue
          const full = `${m[1] ?? id}.${m[2]!.toLowerCase()}`
          if (frameworkRows.some((fr) => fr.id === full)) given.set(full, toRating(r.rating))
        }
        if (given.size === 0 && frameworkRows.length === 1 && x.rating !== undefined) given.set(frameworkRows[0]!.id, toRating(x.rating))
        return { id, rows: frameworkRows.map((fr) => ({ id: fr.id, rating: given.get(fr.id) ?? null })), notes: str(x.notes) }
      })
      .filter((x): x is NonNullable<typeof x> => x !== undefined)
    return { areas }
  } catch {
    return { areas: [], raw: text }
  }
}
