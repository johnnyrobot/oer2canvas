import type axe from 'axe-core'
/*
 * The BYTES of axe's prebuilt standalone build, not the bundled module.
 *
 * `?raw` hands back the file verbatim, which is the whole point — see
 * `axeInFrame` below for why deriving the payload from the bundled module
 * cannot survive minification.
 */
import axeSource from 'axe-core/axe.min.js?raw'
import { CANVAS_SHELL_CSS } from './canvas-shell'
import type { DisposableScanRunner, ImageAlt, ResolvedBackground, ScanResult, TextRun } from './types'
import type { TextSize } from '../../contracts/index'

/**
 * A ScanRunner that renders into a hidden same-origin iframe in the user's own
 * browser and runs axe-core against it.
 *
 * This replaces canvas-agent's Playwright runner. Because the browser sat behind
 * the one-method `ScanRunner` seam, `createAuditor` is untouched — the 150MB
 * Chromium dependency drops out through a seam that already existed.
 *
 * The iframe is reused across runs and released by `dispose()`. Disposal is FINAL:
 * a later `run()` rejects rather than allocating a second frame.
 */

const LARGE_PX = 24        // 18pt
const LARGE_BOLD_PX = 18.66 // 14pt
const BOLD = 700

function sizeClass(style: CSSStyleDeclaration): TextSize {
  const px = parseFloat(style.fontSize)
  const weight = parseInt(style.fontWeight, 10) || 400
  if (px >= LARGE_PX) return 'large'
  if (px >= LARGE_BOLD_PX && weight >= BOLD) return 'large'
  return 'normal'
}

function isOpaque(color: string): boolean {
  const m = /rgba?\(([^)]+)\)/.exec(color)
  if (!m) return false
  const parts = m[1]!.split(',').map((s) => parseFloat(s))
  return parts.length < 4 || parts[3]! >= 1
}

/**
 * Walk up the ancestor chain compositing background layers down to an opaque base.
 * A gradient or background image cannot be reduced to a single color, so it is
 * classified rather than guessed — the auditor turns those into alerts, never
 * silent passes.
 */
function resolveBackground(el: Element, win: Window): ResolvedBackground {
  const layers: string[] = []
  let node: Element | null = el
  while (node) {
    const style = win.getComputedStyle(node)
    if (style.backgroundImage && style.backgroundImage !== 'none') {
      if (/gradient/i.test(style.backgroundImage)) {
        if (/conic/i.test(style.backgroundImage)) {
          return { kind: 'unresolvable', reason: 'conic-gradient' }
        }
        return { kind: 'gradient', css: style.backgroundImage }
      }
      return { kind: 'image', swatches: [] }
    }
    if (style.filter && style.filter !== 'none') {
      return { kind: 'unresolvable', reason: 'css-filter' }
    }
    const bg = style.backgroundColor
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      layers.push(bg)
      if (isOpaque(bg)) return { kind: 'layers', layers }
    }
    node = node.parentElement
  }
  // The shell paints an opaque white base, so this is the documented floor.
  layers.push('rgb(255, 255, 255)')
  return { kind: 'layers', layers }
}

function collectTextRuns(doc: Document, win: Window): TextRun[] {
  const runs: TextRun[] = []
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const seen = new Set<Element>()
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!node.textContent || !node.textContent.trim()) continue
    const el = node.parentElement
    if (!el || seen.has(el)) continue
    seen.add(el)
    // Visibility is asked of the browser, not inferred from the element's own
    // computed style, because `getComputedStyle` reports an element's OWN value and
    // not the used value. A `<p>` inside `<div style="display:none">` computes
    // `display: "block"`, and because `opacity` does not inherit, a `<p>` inside
    // `<div style="opacity:0">` computes `1` — so the obvious per-element checks
    // miss every ancestor-hidden case and only `visibility` (which does inherit)
    // ever worked. Collecting invisible text is not a harmless extra: a hidden
    // low-contrast run becomes a badge-withholding contrast error against text no
    // student can see, and the gate publishes nothing until the queue is empty.
    // `checkVisibility` resolves the whole ancestor chain, and covers
    // `content-visibility` besides.
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
    const style = win.getComputedStyle(el)
    runs.push({ fg: style.color, background: resolveBackground(el, win), size: sizeClass(style) })
  }
  return runs
}

/**
 * Load axe-core into the frame's own realm and hand back that copy.
 *
 * axe binds to the window it was loaded in: its context check is
 * `contextList instanceof window.Node`, which is FALSE for an element belonging to
 * the iframe's realm, so the parent's `axe.run(frameElement)` rejects its own
 * arguments. Injecting axe and running the frame's own copy is the published
 * escape hatch for exactly this — it is how `@axe-core/playwright` gets axe into
 * a page — and it means every `instanceof`, `getComputedStyle` and `document`
 * axe touches is the one belonging to the document under audit.
 *
 * WE INJECT `axe.min.js` VERBATIM VIA `?raw`, NOT `axe.source`. This is not a
 * style preference; `axe.source` is unusable in a bundled app.
 * `axe-core/axe.js:32` builds it at RUNTIME from the live function:
 *
 *   axe.source = '(' + axeFunction.toString() + ')(typeof window === "object" ? window : this);'
 *
 * so its contents are whatever the bundler left behind. Under `vite build` the
 * minifier renames `axeFunction` and rescopes its body against the surrounding
 * chunk — `axeFunction` does not appear in `dist/` at all. Stringify that and
 * evaluate it in a FRESH REALM and the identifiers it closed over are simply not
 * there: the frame threw `ReferenceError: t is not defined`, the audit never ran,
 * and the whole product was inert in production while 357 tests stayed green,
 * because every one of them ran the dev transform where the function still has
 * its own name. The `?raw` bytes are the same in dev and in `dist/` by
 * construction, so there is nothing left for a bundler setting to change.
 * `scripts/smoke-dist.mjs` executes the built bundle and pins it.
 *
 * Injected per run because `run()` rewrites the frame document each time; that
 * fresh document is what keeps one scan from inheriting the previous fragment's
 * styles. axe also captures its globals by value at load time — `axe.js:12-14` is
 * `(function axeFunction(window) { var global = window; var document = window.document;`
 * — so a freshly loaded copy per scan is the cheap way to be sure the axe doing the
 * scanning is bound to the document being scanned, with no memoised state carried
 * over from the previous fragment. It costs ~2ms; V8 caches the compiled source.
 *
 * The stale-copy delete and the post-injection check are not belt-and-braces. A
 * `document.open()` reuses the frame's `Window`, so `win.axe` SURVIVES the rewrite
 * (measured: identical object afterwards). If the injection is ever blocked — a
 * strict CSP is the realistic cause, since this appends an inline script — then
 * without the delete, run 1 fails with an opaque `Cannot read properties of
 * undefined`, and every run after it silently falls back to the previous run's axe
 * instance. Deleting first and asserting after turns both cases into one loud,
 * self-describing error, and makes "each scan gets its own axe" true by
 * construction rather than by assumption.
 */
function axeInFrame(doc: Document, win: Window): typeof axe {
  delete (win as unknown as { axe?: unknown }).axe
  const script = doc.createElement('script')
  script.textContent = axeSource
  doc.head.appendChild(script)
  const injected = (win as unknown as { axe?: typeof axe }).axe
  if (!injected) {
    throw new Error('axe-core did not load into the audit frame (script injection blocked?)')
  }
  return injected
}

function collectImages(doc: Document): ImageAlt[] {
  return Array.from(doc.querySelectorAll('img')).map((img) => ({
    alt: img.hasAttribute('alt') ? img.getAttribute('alt')! : null,
    src: img.getAttribute('src') ?? '',
    presentation:
      img.getAttribute('role') === 'presentation' ||
      img.getAttribute('role') === 'none' ||
      img.getAttribute('aria-hidden') === 'true',
  }))
}

/**
 * How long to wait for the frame that may never come, in ms.
 *
 * Only ever spent when frames are NOT being delivered; a painted tab resolves on
 * the rAF at ~16 ms and never reaches this. It needs headroom over one frame at a
 * low refresh rate (33 ms at 30 Hz) so an ordinary slow frame still wins the race
 * and behaviour in the foreground stays exactly what it was.
 */
const LAYOUT_SETTLE_TIMEOUT_MS = 50

/**
 * Let layout settle before reading computed styles: one frame when frames are
 * happening, a bounded fallback when they are not.
 *
 * THE BARE `requestAnimationFrame` AWAIT THIS REPLACES COULD PARK FOREVER (#19). A
 * page the browser is not painting gets no rendering opportunities, so its rAF
 * callbacks do not fire — that is specified behaviour for a hidden document, not an
 * automation quirk. `compileAndAuditChapter` awaits `run()` once per section in a
 * loop that must complete, so a chapter left in a backgrounded tab stopped dead
 * inside one section: measured at 124 s in a single section against ~2 s once
 * released, no CPU burned while stalled, full speed the instant anything touched the
 * tab. Slices 6 and 7 are why this is worth fixing at moderate severity — a cartridge
 * export and a Canvas push are exactly the operations a user backgrounds on purpose.
 *
 * The rAF is kept rather than deleted, even though removing it outright left all 557
 * other tests green (#19 step 2) and every property read downstream — `color`,
 * `fontSize`, `fontWeight`, `backgroundColor`, `backgroundImage`, `filter` — is one
 * that `getComputedStyle` flushes for itself. A green suite is evidence that nothing
 * MEASURED depends on the frame, not proof that nothing does, and this audit's
 * verdicts are the product's whole claim. Racing keeps the foreground path
 * byte-identical to what shipped and changes only the case that previously hung.
 *
 * The timer is the PARENT's, not `win`'s, so that a `dispose()` mid-run — which
 * discards the frame's realm and every callback pending in it, rAF and timer alike —
 * cannot resurrect the same indefinite park through the escape hatch itself.
 *
 * BOUNDED IS NOT 50 MS IN A HIDDEN TAB. Background timer throttling clamps this to
 * ~1 s, and intensive throttling to ~1/min once the tab has been hidden and quiet for
 * five minutes. That is still categorically different from never — the loop already
 * awaits two `setTimeout(0)`s per section under the same clamp — but a backgrounded
 * chapter is throttle-bound, not fast. Slices 6 and 7 should not read this as a
 * licence to put a long unattended operation on the main thread's timer queue.
 */
async function settleLayout(win: Window): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, LAYOUT_SETTLE_TIMEOUT_MS)
    win.requestAnimationFrame(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export function createIframeRunner(): DisposableScanRunner {
  let frame: HTMLIFrameElement | undefined
  let disposed = false

  function ensureFrame(): HTMLIFrameElement {
    if (frame) return frame
    const el = document.createElement('iframe')
    // Same-origin so axe can reach the DOM; off-screen rather than display:none,
    // because a display:none frame has no layout and every computed style is useless.
    el.setAttribute('aria-hidden', 'true')
    el.setAttribute('title', 'accessibility audit surface')
    el.style.position = 'absolute'
    el.style.left = '-10000px'
    el.style.top = '0'
    el.style.width = '1280px'
    el.style.height = '900px'
    el.style.border = '0'
    document.body.appendChild(el)
    frame = el
    return el
  }

  return {
    /**
     * Scan one fragment.
     *
     * CALLER INVARIANT — `html` MUST ALREADY HAVE BEEN THROUGH THE ALLOWLIST REPAIR.
     *
     * The audit frame is same-origin and executes scripts, and it has to be both:
     * same-origin so `collectTextRuns`/`collectImages` can read the frame's DOM and
     * computed styles from here, and script-enabled so `axeInFrame` can load axe
     * into it. A `sandbox` attribute cannot buy anything back — `allow-scripts`
     * without `allow-same-origin` kills the DOM reads this runner exists to make,
     * and specifying both together is defined as equivalent to no sandbox at all.
     *
     * So the consequence is real and unavoidable: `innerHTML` does not run `<script>`
     * tags, but it DOES wire up inline handlers, and an `<img onerror=...>` in raw
     * publisher markup would execute on this origin — the same origin that owns
     * the app's browser-local state and may hold the current in-memory Canvas
     * token. Sanitising is the caller's job,
     * done once, upstream, where it belongs.
     *
     * Nothing in the shipped pipeline violates this today: `enforceGate` runs
     * `validateAllowlist` before `audit`, so the runner only ever sees repaired
     * markup — which is also what the spec requires, since auditing anything but the
     * exact bytes to be published would be theater. But `createIframeRunner` is a
     * public export, so a future caller could reach it directly; that caller owes
     * this frame repaired HTML.
     */
    async run(html: string): Promise<ScanResult> {
      if (disposed) throw new Error('ScanRunner has been disposed')
      const el = ensureFrame()
      const doc = el.contentDocument!
      const win = el.contentWindow as Window & typeof globalThis

      doc.open()
      doc.write(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
          `<title>audit surface</title><style>${CANVAS_SHELL_CSS}</style></head>` +
          `<body><div id="b2c-content"></div></body></html>`,
      )
      doc.close()

      // Fragment goes in as markup, not as a parsed-and-reserialized tree, so the
      // audit sees exactly the bytes that would be published.
      doc.getElementById('b2c-content')!.innerHTML = html

      await settleLayout(win)

      const root = doc.getElementById('b2c-content')!
      const axeResults = await axeInFrame(doc, win).run(
        // axe has no PER-RULE element exclusion — `context.exclude` applies to
        // every rule — so this excludes MathML subtrees wholesale. That is
        // acceptable here and nowhere else: a <math> subtree contains no images,
        // links, form controls or headings, so `color-contrast` is very nearly
        // the only rule that would have applied to it.
        //
        // Nothing goes unchecked. `collectTextRuns` below walks every text node
        // in the frame with `getComputedStyle`, math included, and
        // `run-contrast.ts` adjudicates them against real computed colours — so
        // a genuinely low-contrast equation still fails, through the checker
        // that can actually decide. What axe reported was `incomplete`: not a
        // failure, a refusal to judge, on 1446 nodes in one section.
        //
        // Decorative aria-hidden icons are excluded for the same reason: they
        // carry no accessible content, and axe's glyph-only contrast result is
        // an un-actionable incomplete. The computed-contrast walker still sees
        // their pixels, so visible colour remains checked.
        //
        // It is also a real cut into the measured 1.78 s, since color-contrast
        // is axe's most expensive rule.
        { include: [root], exclude: [['math'], ['[aria-hidden="true"]']] },
        {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
          resultTypes: ['violations', 'incomplete'],
        },
      )

      return {
        axe: {
          violations: axeResults.violations as ScanResult['axe']['violations'],
          incomplete: axeResults.incomplete as ScanResult['axe']['incomplete'],
        },
        textRuns: collectTextRuns(doc, win),
        images: collectImages(doc),
      }
    },

    async dispose(): Promise<void> {
      disposed = true
      if (frame) {
        frame.remove()
        frame = undefined
      }
    },
  }
}
