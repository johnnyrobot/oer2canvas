/**
 * 7.1 Illustrations and Photos — the INVENTORY, not a judgment.
 *
 * What OERI's own Gen-AI crosswalk feeds a model for 7.1 is exactly this:
 * alt text, captions, and descriptions, never pixels. And what Rubric 1 asks
 * the assessor to tally is exactly what this lays out for them to read. The
 * one boolean here, `mentionsPeople`, is a word-boundary match against a
 * fixed noun list over the image's OWN text; it says the text names a person,
 * and nothing about who. Nothing in this file infers race, gender, age, or
 * disability from anything, and nothing here ever will.
 */
import type { Finder, IdeaFinding } from './findings'
import { referenceFor } from '../compile/steps/reference'

export interface ImageRow {
  sectionId: string
  elementId: string
  src: string
  /** `null` = no attribute at all; `''` = declared decorative. */
  alt: string | null
  caption?: string
  /** The preceding sentence, via `referenceFor`. */
  reference?: string
  mentionsPeople: boolean
  presentational: boolean
}

export interface ImageSummary {
  images: number
  withPeople: number
  decorative: number
  noAlt: number
}

export const PEOPLE_NOUNS: readonly string[] = [
  'person', 'people', 'man', 'men', 'woman', 'women', 'boy', 'boys', 'girl', 'girls', 'child', 'children',
  'baby', 'infant', 'toddler', 'teen', 'teenager', 'adult', 'adults', 'student', 'students', 'teacher', 'teachers',
  'instructor', 'professor', 'worker', 'workers', 'nurse', 'nurses', 'doctor', 'doctors', 'physician', 'patient',
  'patients', 'scientist', 'scientists', 'researcher', 'researchers', 'engineer', 'engineers', 'farmer', 'farmers',
  'family', 'families', 'parent', 'parents', 'mother', 'father', 'couple', 'crowd', 'group of', 'team', 'athlete',
  'athletes', 'player', 'players', 'customer', 'customers', 'shopper', 'employee', 'employees', 'soldier', 'soldiers',
  'officer', 'officers', 'portrait', 'face', 'faces', 'hand', 'hands', 'someone', 'anyone', 'everyone',
]

// Bounded by "not a word character or hyphen" on both sides, so "doctor" does
// not fire on "doctorate" and "man" does not fire on "Manganese".
const PEOPLE = new RegExp(
  `(?<![\\w-])(?:${PEOPLE_NOUNS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w-])`,
  'i',
)

const text = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/**
 * The image's own id, or the nearest ancestor's: something the render can
 * outline. The compiled html gives an id to every image the alt queue asked
 * about and to none it trusted; a trusted image sits inside a `.b2c-figure`
 * or a block from `ensureBlockIds`, either of which has one. Reads only.
 */
function idFor(img: Element, index: number): string {
  const own = img.getAttribute('id')
  if (own) return own
  const ancestor = img.closest('[id]')
  return ancestor?.getAttribute('id') ?? `b2c-img-inv-${index}`
}

export function imageInventory(sectionId: string, html: string): ImageRow[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return Array.from(doc.body.querySelectorAll('img')).map((img, index) => {
    const alt = img.getAttribute('alt')
    const caption = text(img.closest('.b2c-figure')?.querySelector('.b2c-caption')?.textContent)
    const reference = referenceFor(img)
    const role = img.getAttribute('role') ?? ''
    const presentational = role === 'presentation' || role === 'none' || img.closest('[aria-hidden="true"]') !== null
    return {
      sectionId,
      elementId: idFor(img, index),
      src: img.getAttribute('src') ?? '',
      alt,
      ...(caption ? { caption } : {}),
      ...(reference ? { reference } : {}),
      mentionsPeople: PEOPLE.test(`${alt ?? ''} ${caption}`),
      presentational,
    }
  })
}

export function imageSummary(rows: readonly ImageRow[]): ImageSummary {
  return {
    images: rows.length,
    withPeople: rows.filter((r) => r.mentionsPeople).length,
    decorative: rows.filter((r) => r.presentational || r.alt === '').length,
    noAlt: rows.filter((r) => r.alt === null).length,
  }
}

/** The rule ids the 7.1 finder stamps, so a panel can tell a row from the summary without reading keys. */
export const IMAGE_ROW_RULE = 'inventory-image'
export const IMAGE_SUMMARY_RULE = 'inventory-image-summary'

/** One observation per image, then the section summary. Always at least the summary. */
export const findImages: Finder = (sectionId, html) => {
  const rows = imageInventory(sectionId, html)
  const s = imageSummary(rows)
  const out: IdeaFinding[] = rows.map((r, i) => ({
    kind: 'observation',
    key: `${sectionId}::${r.elementId}::${i}::image`,
    category: '7.1',
    sectionId,
    elementId: r.elementId,
    columns: {
      image: r.src.split('/').pop() ?? r.src,
      description: r.alt === null ? '(no alt text)' : r.alt === '' ? '(decorative)' : r.alt,
      caption: r.caption ?? '—',
      reference: r.reference ?? '—',
      'mentions people': r.mentionsPeople ? 'yes' : 'no',
    },
    rule: { id: IMAGE_ROW_RULE, source: 'inventory' },
    origin: 'rule',
  }))
  out.push({
    kind: 'observation',
    key: `${sectionId}::summary::7.1`,
    category: '7.1',
    sectionId,
    columns: {
      images: String(s.images),
      'mention people': String(s.withPeople),
      decorative: String(s.decorative),
      'no alt text': String(s.noAlt),
    },
    rule: { id: IMAGE_SUMMARY_RULE, source: 'inventory' },
    origin: 'rule',
  })
  return out
}
