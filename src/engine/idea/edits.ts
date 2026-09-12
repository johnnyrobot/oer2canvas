/**
 * What the instructor decided about a finding. Plain data, one map, beside the
 * queue's `answers` and shaped the same way: `applyIdeaEdits` reads it on every
 * recompile, so reversing a decision is a map delete plus a recompile.
 */
export type IdeaEdit =
  | { kind: 'replace'; replacement: string }
  /** Kept as written (a quotation, a proper name); optionally followed by a parenthetical. */
  | { kind: 'keep'; context?: string }
  | ImageEdit

export interface ImagePlacement {
  kind: 'replace' | 'insert-after'
  elementId: string
}

/**
 * Slice 5: an image the instructor added. A REFERENCE to packaged bytes, not
 * the bytes — `assetName` is the archive entry `prepareAssets` minted, and
 * the chapter's `assets` (and the IDEA document's, so a reload finds them)
 * carry the `ImportedAsset` with that name. Everything the compile step needs
 * to emit the figure and the credit is here, so a recompile never has to ask
 * the provider again.
 */
export interface ImageEdit {
  kind: 'image'
  placement: ImagePlacement
  assetName: string
  width: number
  height: number
  alt: string
  caption: string
  attribution: {
    /** Title · Author · Source · License, as `tasl()` writes it. */
    text: string
    sourcePageUrl: string
    licenseName: string
    licenseUrl?: string
    shareAlike: boolean
  }
}

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

/** Four `::`-separated parts at least, as `ideaEditKey` builds them. */
export function isIdeaEditKey(value: unknown): value is string {
  return typeof value === 'string' && value.split(SEP).length >= 4
}

export function parseIdeaEditKey(key: string): { sectionId: string; elementId: string; occurrence: number; original: string } {
  const [sectionId, elementId, occurrence, ...rest] = key.split(SEP)
  return { sectionId: sectionId!, elementId: elementId!, occurrence: Number(occurrence), original: rest.join(SEP) }
}

/**
 * An image edit is not about an occurrence of text, so its key uses the
 * literal element id `image`, occurrence 0, and the asset name where the
 * original text would go: one key per asset per section, parseable by
 * `parseIdeaEditKey` like every other.
 */
export function imageEditKey(sectionId: string, assetName: string): string {
  return ideaEditKey(sectionId, 'image', 0, assetName)
}

/**
 * The id of the figure an image edit places: one per asset, derived here so
 * the step that emits it, the step that credits it, and the Applied list
 * that looks for it all agree.
 */
export function ideaFigureId(edit: ImageEdit): string {
  return `b2c-idea-img-${edit.assetName.replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9_-]/g, '-')}`
}

export type IdeaEditsEvent =
  | { type: 'replace'; key: string; replacement: string }
  | { type: 'keep'; key: string; context?: string }
  | { type: 'image'; key: string; edit: ImageEdit }
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
    case 'image':
      edits.set(event.key, event.edit)
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
