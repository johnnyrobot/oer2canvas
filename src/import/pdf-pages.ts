/**
 * Cutting extracted PDF Markdown into pages, and saying which page something
 * came from.
 *
 * SPLIT, NEVER MARK. `sanitizeImportedHtml` deletes every HTML comment, so a
 * page marker that reached it would be gone. The tempting fix — rewriting each
 * marker into a `<span id>` that clears the allowlist — is rejected: that
 * sentinel would then sit inside the bytes the accessibility gate audits and
 * `buildCartridge` publishes VERBATIM, so it would either ship to Canvas as a
 * stray element or be stripped after the gate. Post-gate rewriting is exactly
 * what issue 08's design was built to avoid, and criterion 6 is audited-byte
 * parity. Splitting before sanitization means no PDF-specific token ever exists
 * in gated bytes: parity holds by construction rather than by a check.
 *
 * The cost, stated: a construct straddling a physical page break — most
 * plausibly a table continued across two sheets — is cut in two. Both halves
 * render, and `layout.pagesWithTables` already flags such a document. The
 * alternative loses all page provenance and fails criteria 2 and 5 outright.
 */

/** `<!-- Page 7 -->` on its own line, the exact form the module emits. */
const PAGE_MARKER = /^<!-- Page (\d+) -->[ \t]*$/gm

export interface PdfPageSlice {
  /** 1-indexed, READ from the marker. A page that produced no text has none. */
  page: number
  markdown: string
}

export interface PdfMarkdownSplit {
  /** Content before the first marker, which the module attributed to no page. */
  preamble: string
  pages: PdfPageSlice[]
}

export function splitPdfMarkdown(markdown: string): PdfMarkdownSplit {
  const pages: PdfPageSlice[] = []
  let preambleEnd = markdown.length
  let open: { page: number; from: number } | undefined
  for (const match of markdown.matchAll(PAGE_MARKER)) {
    const at = match.index ?? 0
    if (open === undefined) preambleEnd = at
    else pages.push({ page: open.page, markdown: markdown.slice(open.from, at) })
    open = { page: Number(match[1]), from: at + match[0].length }
  }
  if (open) pages.push({ page: open.page, markdown: markdown.slice(open.from) })
  return { preamble: markdown.slice(0, preambleEnd), pages }
}

/**
 * The module writes `![Image: Im1](image)`, where `Im1` is the PDF XObject's
 * resource name and `image` is a literal, not a url. Rendered as-is that reads
 * `[Embedded image: Image: Im1]`, which tells a reader nothing. The page number
 * is the one true and useful caption available, and this is the last moment it
 * is known — after the split, before the sanitizer flattens the image away.
 *
 * Rewritten BEFORE sanitization, so the caption is ordinary audited content and
 * nothing is touched after the gate. Only the module's own exact form is
 * rewritten; anything else is left alone, so a future version that emits a real
 * caption keeps it (and the test above fails loudly if the form changes).
 */
export function withPageCaptions(markdown: string, page: number): string {
  return markdown.replace(/!\[Image: [^\]]*\]\(image\)/g, `![Figure on page ${page}](image)`)
}

/**
 * `[3,4,5,6,7,8,9,41,55,56,57,58]` -> `3–9, 41, 55–58`.
 *
 * NOT TRUNCATED, deliberately. Criterion 2 asks for page-specific evidence, and
 * a count alone is not that. The worst case is bounded by a budget that is
 * already enforced BEFORE extraction: `maximumPdfPages` is 200, so a pathological
 * alternating document names at most 100 ranges — long, but finite, and a
 * document with 100 unreadable stretches is refused rather than published
 * anyway. `describe()` in `markup.ts` sets the same precedent of enumerating
 * everything. Any truncation limit would be a number with nothing behind it.
 */
export function formatPageRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((first, second) => first - second)
  const ranges: string[] = []
  for (let index = 0; index < sorted.length;) {
    let last = index
    while (last + 1 < sorted.length && sorted[last + 1] === sorted[last]! + 1) last += 1
    // Two adjacent pages print as "2, 3": a dash saves nothing and reads worse.
    if (last - index >= 2) ranges.push(`${sorted[index]}–${sorted[last]}`)
    else for (let at = index; at <= last; at += 1) ranges.push(`${sorted[at]}`)
    index = last + 1
  }
  return ranges.join(', ')
}
