import type { CompiledChapter } from '../contracts/index'
import { AuditPanel } from './AuditPanel'
import { ChapterByline } from './ChapterByline'
import { CanvasShellStyles } from './CanvasShellStyles'
import { usePackagedAssetUrls } from './usePackagedAssetUrls'

export function ChapterView({ compiled }: { compiled: CompiledChapter }) {
  const { chapter } = compiled
  // Display-only resolution of `$IMS-CC-FILEBASE$/oer2canvas/…` tokens to
  // `blob:` urls. Canvas resolves that token itself at cartridge import time;
  // a browser never can, so without this every embedded image in this app's
  // own preview would render broken. `chapter.assets` is absent for catalog
  // sources (OpenStax/LibreTexts/Pressbooks) — `usePackagedAssetUrls`
  // defaults to `[]` and `resolve` becomes a no-op pass-through for them.
  const resolve = usePackagedAssetUrls(chapter.assets)
  return (
    <section aria-labelledby="chapter-heading">
      {/* Without this, every `.b2c-section-body` below renders publisher content
          in the app's own typeface and the user agent's link blue, while the gate
          panel beside it reports contrast measured against Canvas's. See
          `CanvasShellStyles`. */}
      <CanvasShellStyles />
      <h2 id="chapter-heading">{chapter.title}</h2>
      <ChapterByline attribution={chapter.attribution} />
      {compiled.queue.length > 0 && (
        <p>
          {compiled.queue.length} item(s) need review before this chapter can be published.
        </p>
      )}
      {/*
        THE SECTION TITLE IS NOT REPEATED HERE. The compiled body already opens
        with it: `relevelHeadings` re-levels every section so its shallowest
        heading is an `h2` — the section title — because Canvas renders the page
        title as the page's own `h1` and content must start one below it. That
        heading is part of the audited, publishable bytes and is what a reader
        gets in Canvas, so it is the one that owns the name; an `h3` added here
        put the title on screen twice in every section of every chapter.

        The article is named with `aria-label` instead. It needs an accessible
        name to be worth navigating to, and `aria-labelledby` cannot supply one
        without minting an id inside markup we did not write — `aria-label`
        costs nothing and says the same thing. `s.title` rather than the body's
        heading text on purpose: it is the NORMALIZED title (the body's still
        carries the publisher's `os-number` spans, so it reads "1.4  Polynomials").
      */}
      {compiled.sections.map((s) => (
        <article key={s.id} id={s.id} aria-label={s.title}>
          {s.gate && <AuditPanel result={s.gate} />}
          {/* Never a hole: with no gate there is no body to name the section,
              so the article would otherwise render completely empty. */}
          {!s.gate && <p>This section has not been checked yet.</p>}
          {s.gate && (
            /*
              `GateResult.html` is allowlist-REPAIRED html, and that is the whole
              reason this is safe to set as innerHTML. `validateAllowlist` keeps
              no `on*` handler attribute — they are on no allowlist, per-element
              or global — and drops `<script>` subtrees entirely, so the two
              things innerHTML would otherwise wire up are already gone. This is
              the same invariant the audit iframe rests on, and it is why neither
              the raw publisher html nor `s.html` (compiled but un-audited) may
              ever be rendered here — only `s.gate.html`. It is passed through
              `resolve` for DISPLAY ONLY: `s.gate.html` itself, held in state,
              is never touched, so the bytes the accessibility gate approved
              are exactly the bytes the exported cartridge ships.
            */
            <div
              className="b2c-section-body"
              dangerouslySetInnerHTML={{ __html: resolve(s.gate.html) }}
            />
          )}
        </article>
      ))}
    </section>
  )
}
