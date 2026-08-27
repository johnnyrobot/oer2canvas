/**
 * Publisher chrome is not content.
 *
 * OpenStax serves each section as a WHOLE XHTML document — `<html xmlns:m=...>`,
 * a `<head>` carrying a `:target` highlight rule and footnote styling, and a
 * `<script>`. `allowlist.ts` would drop script and style anyway; removing them
 * here means the audit frame never has to reason about a nested document, and
 * the note says what left rather than leaving it to be noticed.
 */
import type { Step } from './index'

export const stripChrome: Step = (doc, ctx, sink) => {
  let removed = 0
  for (const selector of ctx.profile.chrome) {
    for (const el of Array.from(doc.querySelectorAll(selector))) {
      el.remove()
      removed += 1
    }
  }
  if (removed > 0) {
    sink.note('strip-chrome', `Removed ${removed} publisher chrome element(s)`, removed)
  }
}
