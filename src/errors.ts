/** Anything can be thrown; only an `Error` is guaranteed to have a message. */
export function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** AbortSignal and browser APIs identify user-requested cancellation by name. */
export function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError'
}
