/**
 * Layer 3 of the three (design §1.2): re-audit the sections an answer changed,
 * in the background, one at a time.
 *
 * ONE AT A TIME IS THE POINT. Each audit builds an iframe and runs axe over a
 * real layout — the measured ~2 s per section. Running three at once does not
 * make them finish sooner on a single main thread; it makes all three compete
 * with the typing and scrolling of the person the work is meant to be hidden
 * from. Sequential keeps the cost inside the reading time that was going to
 * happen anyway.
 *
 * The driver is deliberately dumb: it does not decide whether a verdict is still
 * valid. That rule compares bytes and lives in the reducer (`session.ts`), where
 * it is testable without timing.
 */
export async function drainReaudits<T>(
  sectionIds: readonly string[],
  audit: (sectionId: string) => Promise<T>,
  onAudited: (sectionId: string, result: T) => void,
  opts: { signal?: AbortSignal; onError?: (sectionId: string, error: unknown) => void } = {},
): Promise<void> {
  for (const sectionId of sectionIds) {
    if (opts.signal?.aborted) return
    let result: T
    try {
      result = await audit(sectionId)
    } catch (error) {
      // A section that cannot be audited stays dirty, which is honest — it has
      // no verdict and the screen says so. Stranding the other fourteen behind
      // it would not be.
      opts.onError?.(sectionId, error)
      continue
    }
    // Re-checked after the await: the answer that queued this drain may have
    // been superseded while axe was running.
    if (opts.signal?.aborted) return
    onAudited(sectionId, result)
  }
}
