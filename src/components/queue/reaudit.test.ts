import { describe, it, expect } from 'vitest'
import { drainReaudits } from './reaudit'

describe('the re-audit driver', () => {
  it('runs one section at a time, not all of them at once', async () => {
    // Each audit builds an iframe and runs axe. Parallelising them turns a
    // background cost into a foreground one on the machine the instructor is
    // reading on.
    const inFlight = { now: 0, peak: 0 }
    const audit = async () => {
      inFlight.now++
      inFlight.peak = Math.max(inFlight.peak, inFlight.now)
      await Promise.resolve()
      inFlight.now--
      return 'green'
    }
    await drainReaudits(['a', 'b', 'c'], audit, () => {})
    expect(inFlight.peak).toBe(1)
  })

  it('reports each result as it lands, not all of them at the end', async () => {
    // The screen un-greys one section at a time. Batching would hold three
    // finished audits back behind the slowest.
    const seen: string[] = []
    await drainReaudits(['a', 'b'], async (id) => id.toUpperCase(), (id, result) => {
      seen.push(`${id}:${result}`)
    })
    expect(seen).toEqual(['a:A', 'b:B'])
  })

  it('keeps going when one audit throws', async () => {
    // One section that cannot be audited leaves that section dirty, which is
    // honest. Stranding the other fourteen behind it is not.
    const done: string[] = []
    await drainReaudits(
      ['a', 'b', 'c'],
      async (id) => {
        if (id === 'b') throw new Error('iframe died')
        return id
      },
      (id) => done.push(id),
    )
    expect(done).toEqual(['a', 'c'])
  })

  it('stops at the next boundary when aborted', async () => {
    const controller = new AbortController()
    const done: string[] = []
    await drainReaudits(
      ['a', 'b', 'c'],
      async (id) => id,
      (id) => {
        done.push(id)
        controller.abort()
      },
      { signal: controller.signal },
    )
    expect(done).toEqual(['a'])
  })
})
