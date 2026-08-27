import type { FixNote, QueueItem } from '../../contracts/index'

export interface Sink {
  /** Record an auto-fix. Visible for trust, collapsed by default in the UI. */
  note(step: string, message: string, count?: number): void
  /** Record a question for a human. `sectionId` is filled in here. */
  queue(item: Omit<QueueItem, 'sectionId'>): void
  result(): { notes: FixNote[]; queue: QueueItem[] }
}

export function createSink(sectionId: string): Sink {
  const notes: FixNote[] = []
  const queue: QueueItem[] = []
  return {
    note(step, message, count) {
      notes.push(count === undefined ? { step, message } : { step, message, count })
    },
    queue(item) {
      queue.push({ ...item, sectionId })
    },
    result: () => ({ notes, queue }),
  }
}
