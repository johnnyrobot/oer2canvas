/**
 * What the instructor decided about a finding. Plain data, one map, beside the
 * queue's `answers` and shaped the same way: `applyIdeaEdits` reads it on every
 * recompile, so reversing a decision is a map delete plus a recompile.
 */
export type IdeaEdit =
  | { kind: 'replace'; replacement: string }
  /** Kept as written (a quotation, a proper name); optionally followed by a parenthetical. */
  | { kind: 'keep'; context?: string }

export interface IdeaEdits {
  edits: ReadonlyMap<string, IdeaEdit>
  /** Hidden for this session. Not an edit: nothing in the bytes changes. */
  dismissed: ReadonlySet<string>
}

const SEP = '::'

/** `${sectionId}::${elementId}::${occurrence}::${original}` — original last, so it may itself contain `::`. */
export function ideaEditKey(sectionId: string, elementId: string, occurrence: number, original: string): string {
  return [sectionId, elementId, String(occurrence), original].join(SEP)
}

export function parseIdeaEditKey(key: string): { sectionId: string; elementId: string; occurrence: number; original: string } {
  const [sectionId, elementId, occurrence, ...rest] = key.split(SEP)
  return { sectionId: sectionId!, elementId: elementId!, occurrence: Number(occurrence), original: rest.join(SEP) }
}

export type IdeaEditsEvent =
  | { type: 'replace'; key: string; replacement: string }
  | { type: 'keep'; key: string; context?: string }
  | { type: 'dismiss'; key: string }
  | { type: 'undo'; key: string }

export function newEdits(): IdeaEdits {
  return { edits: new Map(), dismissed: new Set() }
}

export function reduceEdits(e: IdeaEdits, event: IdeaEditsEvent): IdeaEdits {
  const edits = new Map(e.edits)
  const dismissed = new Set(e.dismissed)
  switch (event.type) {
    case 'replace':
      edits.set(event.key, { kind: 'replace', replacement: event.replacement })
      dismissed.delete(event.key)
      break
    case 'keep':
      edits.set(event.key, event.context === undefined ? { kind: 'keep' } : { kind: 'keep', context: event.context })
      dismissed.delete(event.key)
      break
    case 'dismiss':
      edits.delete(event.key)
      dismissed.add(event.key)
      break
    case 'undo':
      edits.delete(event.key)
      dismissed.delete(event.key)
      break
  }
  return { edits, dismissed }
}

export function sectionsWithEdits(e: IdeaEdits): Set<string> {
  return new Set([...e.edits.keys()].map((k) => parseIdeaEditKey(k).sectionId))
}
