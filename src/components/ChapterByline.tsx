/**
 * "From <book> by <publisher> — <license>": the one line every chapter render
 * puts under its heading. Shared by the Review chapter view and the IDEA
 * render so the two cannot drift.
 */
import type { Attribution } from '../sources/types'

export function ChapterByline({ attribution }: { attribution: Attribution }) {
  return (
    <p>
      From {attribution.url
        ? <a href={attribution.url}>{attribution.bookTitle}</a>
        : attribution.bookTitle} by{' '}
      {attribution.publisher}
      {attribution.license ? ` — ${attribution.license.name}` : ''}
    </p>
  )
}
