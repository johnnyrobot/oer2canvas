/**
 * Tables: give the caption real semantics, and ask about missing headers.
 *
 * `<caption>` is on Canvas's allowlist even though `<figcaption>` is not, so
 * a table caption can become a genuine caption element rather than the
 * `aria-describedby` workaround figures need.
 *
 * A queued table carries the same context an image item does, minus what tables
 * do not have: no `src`, and no `hash`, so table answers never dedupe across
 * sections. The caption is set only when the publisher wrote one; the
 * referencing sentence comes from the shared walk in `reference.ts`, because a
 * headerless table with no caption would otherwise reach the human with an
 * empty context object and nothing on the card but the question.
 *
 * That sentence is TRUNCATED to its opening sentence and marked with an
 * ellipsis, which images are not. The difference is in the source material: an
 * image is preceded by a one-line instruction, a table by a paragraph
 * explaining how to read it. The card has room for a pointer, not a
 * reproduction, and the whole paragraph is in the section render directly
 * below with the table outlined inside it. The ellipsis is not decoration — a
 * truncated quotation that does not say it is truncated reads as the publisher's
 * whole sentence.
 *
 * `role="presentation"` is HONOURED. The one table in the 1.4 fixture declares
 * it, and an author who writes an ARIA role has made a deliberate statement
 * about their own markup — the humble reading is to believe them. Guessing
 * otherwise would put a multiplication grid in the queue and teach the
 * instructor that the queue is noise.
 */
import type { Step } from './index'
import { ensureId } from '../ids'
import { queueKeyOf } from '../answers'
import { captionText, findCaption } from './caption'
import { firstSentence, referenceFor } from './reference'

const PRESENTATIONAL = new Set(['presentation', 'none'])

/**
 * How a refused structural answer says so.
 *
 * The item stays queued, which is the correctness half — but on its own it
 * leaves the instructor looking at the same card with no reason to pick
 * differently. So the reason travels in the note, behind this prefix, and the
 * session reads it back off the recompiled section to build the card's message.
 * Exported so the producer and the consumer cannot drift: it is one constant,
 * not a string written out in two places.
 */
export const TABLE_REFUSAL = 'Table headers could not be applied safely: '

/**
 * Can this table's headers be promoted mechanically, and if not, why not?
 *
 * This conversion is safe for regular table grids. Ragged tables and spanning
 * cells are why this function exists: a ragged table has no single first row to promote, and a span
 * crossing the cells being promoted means the cell promoted is not the cell that
 * labels the column. In both cases a mechanical conversion produces markup that
 * CLAIMS a structure the table does not have, which is worse than the headerless
 * table we started with. So it returns a reason instead, and the caller keeps
 * the item queued.
 *
 * A ROWSPAN ANYWHERE REFUSES, and a colspan only refuses when it sits in the
 * band being promoted. The asymmetry is not fussiness: a rowspan makes a later
 * row genuinely hold fewer cells than the table has columns, so every row-by-row
 * measurement below misreads that table — including the uniformity check, which
 * would call a perfectly regular table ragged. A colspan is visible in its own
 * row and can be reasoned about locally, so a colspan deep in the body does not
 * make "first column" a wrong answer, and refusing it would send the instructor
 * back to a card with no better answer available to them.
 *
 * Returns `null` when the conversion is safe.
 */
function refusalToPromote(
  table: HTMLTableElement,
  choice: 'row' | 'column' | 'both',
): string | null {
  const rows = Array.from(table.rows)
  if (rows.length === 0) return 'it has no rows'
  // A nested table's cells belong to two tables at once, and an outer cell
  // holding a whole table is not a header in any sense. Zero occurrences in the
  // representative fixtures; refused anyway, because the cost of being wrong is a false claim.
  if (table.querySelector('table')) return 'it contains another table'

  const cells = rows.flatMap((r) => Array.from(r.cells))
  if (cells.some((c) => span(c, 'rowspan') > 1)) {
    return 'a cell spans more than one row'
  }
  // Width in COLUMNS, not in cells: a `colspan="2"` cell is one cell and two
  // columns, and counting cells would report the real 33-3 urinary-system table
  // as ragged when it is a regular grid with a span in it.
  const widths = rows.map((r) => Array.from(r.cells).reduce((n, c) => n + span(c, 'colspan'), 0))
  if (new Set(widths).size > 1) return 'the rows are not all the same width'

  const promoted: Element[] = []
  if (choice === 'row' || choice === 'both') promoted.push(...Array.from(rows[0]!.cells))
  if (choice === 'column' || choice === 'both') {
    for (const row of rows) if (row.cells[0]) promoted.push(row.cells[0]!)
  }
  return promoted.some((c) => span(c, 'colspan') > 1)
    ? 'a cell that would become a header spans more than one column'
    : null
}

/** A span attribute as a number. Absent, empty and unparseable all mean 1. */
function span(cell: Element, name: 'colspan' | 'rowspan'): number {
  const parsed = Number.parseInt(cell.getAttribute(name) ?? '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

/** Replace one cell with a `<th>`, preserving its children, its id and its attributes. */
function promote(cell: HTMLTableCellElement, scope?: 'col' | 'row'): void {
  const th = cell.ownerDocument.createElement('th')
  for (const attr of Array.from(cell.attributes)) th.setAttribute(attr.name, attr.value)
  // A corner cell labels neither its row nor its column, so it gets no scope —
  // including when the publisher's own `td` carried one.
  if (scope) th.setAttribute('scope', scope)
  else th.removeAttribute('scope')
  while (cell.firstChild) th.appendChild(cell.firstChild)
  cell.replaceWith(th)
}

/**
 * Apply the human's choice. `refusalToPromote` has already said it is safe.
 *
 * Every cell's fate is decided from its POSITION rather than from a reference
 * taken beforehand, because `promote` replaces the cell: the corner cell
 * captured before the first call is detached by the time the second band runs,
 * and comparing against it silently stops excluding anything.
 */
function applyHeaders(table: HTMLTableElement, choice: 'row' | 'column' | 'both'): void {
  const headerRow = choice === 'row' || choice === 'both'
  const headerColumn = choice === 'column' || choice === 'both'

  for (const [r, row] of Array.from(table.rows).entries()) {
    for (const [c, cell] of Array.from(row.cells).entries()) {
      const inRow = headerRow && r === 0
      const inColumn = headerColumn && c === 0
      if (!inRow && !inColumn) continue
      // The corner under `both` is in both bands and gets no scope at all: it
      // labels neither its row nor its column, and a scope would claim it does.
      promote(cell, inRow && inColumn ? undefined : inRow ? 'col' : 'row')
    }
  }
}

/**
 * Apply the table presentation rules from Canvas_Style_Guide.md while the
 * source table is still easy to inspect. Canvas strips page stylesheets, so
 * these small, allowlisted attributes must travel with the table itself.
 *
 * We only fill in missing presentation. A publisher's explicit width, border,
 * or row colour is content-owned and is preserved; changing those values would
 * be a visual rewrite rather than an accessibility repair.
 */
function applyCanvasTablePresentation(table: HTMLTableElement): number {
  let changed = 0
  const style = table.style

  if (!table.hasAttribute('width') && !style.width) {
    table.setAttribute('width', '100%')
    changed += 1
  }
  if (!table.hasAttribute('border') && !style.border) {
    table.setAttribute('border', '1')
    changed += 1
  }

  for (const caption of Array.from(table.querySelectorAll(':scope > caption'))) {
    const captionStyle = (caption as HTMLElement).style
    if (captionStyle.textAlign !== 'center') {
      captionStyle.textAlign = 'center'
      changed += 1
    }
  }

  // Canvas defaults header cells to centered text in some themes. The guide
  // calls for left-aligned table content unless the source explicitly asked for
  // another alignment, so pin the default on cells that carry no alignment
  // instruction. `data-align` is used by OpenStax and counts as an instruction.
  const cells = Array.from(table.querySelectorAll('th, td')).filter(
    (cell) => cell.closest('table') === table,
  )
  for (const cell of cells) {
    const cellStyle = (cell as HTMLElement).style
    if (
      !cell.hasAttribute('align') &&
      !cellStyle.textAlign &&
      !cell.hasAttribute('data-align')
    ) {
      cellStyle.textAlign = 'left'
      changed += 1
    }
  }

  // Ledger-style striping is applied to data rows only. Header rows (including
  // a first row made of <th> elements) retain their stronger header treatment.
  const dataRows = Array.from(table.rows).filter((row) => {
    if (row.closest('table') !== table) return false
    if (row.closest('thead, tfoot')) return false
    const cells = Array.from(row.cells)
    return cells.length > 0 && !cells.every((cell) => cell.tagName.toLowerCase() === 'th')
  })
  dataRows.forEach((row, index) => {
    const rowStyle = (row as HTMLElement).style
    if (index % 2 !== 1 || rowStyle.backgroundColor || rowStyle.background) return
    rowStyle.backgroundColor = '#f2f2f2'
    changed += 1
  })

  return changed
}

export const fixTables: Step = (doc, ctx, sink) => {
  const tables = Array.from(doc.body.querySelectorAll('table'))
  let presentationChanges = 0
  let captionsAdded = 0

  tables.forEach((table, index) => {
    const source = findCaption(table, ctx.profile)
    let text = ''
    if (source) {
      text = captionText(source)
      if (text && !table.querySelector(':scope > caption')) {
        const caption = doc.createElement('caption')
        caption.textContent = text
        // The html spec requires <caption> to be the table's first child.
        table.insertBefore(caption, table.firstChild)
      }
      source.remove()
    }

    // Canvas's content guide requires every table to have a caption. Preserve
    // an author caption when present; otherwise use the table summary or the
    // opening sentence that introduces it. A short neutral fallback is still
    // more honest than silently shipping a captionless table, and the missing
    // header queue continues to ask the instructor for the structural answer.
    const existingCaption = table.querySelector(':scope > caption')
    if (!existingCaption || !existingCaption.textContent?.trim()) {
      const introducingParagraph = referenceFor(table)
      const fallback =
        table.getAttribute('summary')?.trim() ||
        table.getAttribute('aria-label')?.trim() ||
        (introducingParagraph ? firstSentence(introducingParagraph) : '') ||
        'Data table'
      if (existingCaption) {
        existingCaption.textContent = fallback
      } else {
        const caption = doc.createElement('caption')
        caption.textContent = fallback
        table.insertBefore(caption, table.firstChild)
      }
      captionsAdded += 1
    }

    presentationChanges += applyCanvasTablePresentation(table as HTMLTableElement)

    const role = table.getAttribute('role') ?? ''
    if (PRESENTATIONAL.has(role)) {
      sink.note('tables', `Table declares role="${role}"; left as the publisher marked it`)
      return
    }

    if (table.querySelector('th')) return

    // Keys are omitted rather than set to undefined: `QueueItem.context` is
    // serialized into the golden files, and an absent key and a present-but-empty
    // one are different claims about what the publisher wrote.
    const paragraph = referenceFor(table)
    const opening = paragraph === undefined ? undefined : firstSentence(paragraph)
    const reference =
      opening === undefined || opening === paragraph ? opening : `${opening}\u2026`
    const elementId = ensureId(table, 'table', index)
    // A9: the card is spared a caption that is only a label. Three of the 31
    // captions on real queued tables are "Table 5", "Table 6", "Table 7", and
    // printing "Caption: Table 5" is the same noise line that printing
    // "No caption" would be — it teaches the eye to skip the card's text, which
    // is where the question lives. The <caption> ELEMENT is untouched: it is the
    // publisher's label, the body says "as shown in Table 5", and it belongs in
    // the render.
    const captionForCard = text && !ctx.profile.labelOnlyCaption.test(text) ? text : ''
    const context = {
      ...(captionForCard ? { caption: captionForCard } : {}),
      ...(reference ? { reference } : {}),
    }

    // A table never carries a hash, so its key is always section-scoped and a
    // table answer can never propagate across sections (D5.2). Two identical
    // images are the same picture; two identical tables are not necessarily the
    // same table.
    const answer = ctx.answers?.get(queueKeyOf({ sectionId: ctx.sectionId, elementId }))
    if (answer?.type === 'table-headers') {
      if (answer.choice === 'presentation') {
        table.setAttribute('role', 'presentation')
        sink.note('tables', 'Table confirmed as layout by the instructor; marked role="presentation"')
        return
      }
      const refusal = refusalToPromote(table as HTMLTableElement, answer.choice)
      if (refusal) {
        // REFUSE, AND STAY QUEUED. Dropping the item here would ship a
        // headerless table gate-clean, which is the failure this whole slice
        // exists to prevent. The human picks again or marks it layout.
        sink.note('tables', `${TABLE_REFUSAL}${refusal}`)
        sink.queue({ kind: 'table-headers', elementId, context })
        return
      }
      applyHeaders(table as HTMLTableElement, answer.choice)
      sink.note('tables', `Table headers set by the instructor: ${answer.choice}`)
      return
    }

    sink.queue({ kind: 'table-headers', elementId, context })
  })

  if (presentationChanges > 0 || captionsAdded > 0) {
    sink.note(
      'tables',
      `Applied Canvas table guidance: ${captionsAdded > 0 ? `${captionsAdded} caption(s) added; ` : ''}100% width, visible borders, centered captions, and ledger-style row striping where missing.`,
      presentationChanges + captionsAdded,
    )
  }
}
