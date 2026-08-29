# Pre-existing defects surfaced while designing issues 11 and 12

Found 2026-08-28 by the design agents for issues 11 (PDF) and 12 (URL), plus one I verified
myself by reading. **None were caused by the `feat/harden-packaged-assets` branch** — all were
live in `main`.

**Status: 1, 2 and 3 are fixed and merged. 4 remains open.**

Both agent descriptions turned out to be wrong in ways that changed the fix, which is why each
was re-verified before anything was changed:

- #2 was attributed to the import path; `filterAttrs` is in `src/engine/allowlist.ts`, the GATE
  sanitizer, a later stage entirely. The substance held, the location did not.
- #3 was described as vanishing "invisibly". It was not silent — `import-image-unavailable`
  already fired as a BLOCKER, so publication was already prevented. The missing half was the
  visible marker, not the finding.

The practical effect was that the two were ranked backwards: #2 was the serious one.

---

## 1. Export bypasses the accessibility gate — CRITICAL — FIXED (0b77d74)

**Verified by reading, end to end.**

- `src/shell/PlanScreen.tsx:64` — `const ready = plan.blockers.length === 0`
- `src/shell/PlanScreen.tsx:190-193` — the commit button carries `onClick={onCommit}`
  **unconditionally** and only `aria-disabled={!ready || !onCommit}`. `aria-disabled` is
  advisory: it does not prevent activation by mouse, keyboard, or touch.
- `src/App.tsx:815-821` — `onCommit` is `commitCartridge` whenever
  `destination?.kind === 'cartridge'`, **regardless of blockers**.
- `src/App.tsx:595-607` — `commitCartridge` has no guard. It calls `downloadCartridge` directly.

`plan.blockers` includes accessibility blockers from the gate itself
(`src/shell/plan.ts:194-199`, `s.gate?.conformance.blockers.length > 0`), unanswered items
(`:144`), and sections that failed to compile (`:148`).

**So:** with a cartridge destination and a chapter that FAILED the accessibility gate, the
button renders in disabled styling with `aria-disabled="true"` — and clicking it still exports
the cartridge. The app's central promise (the gate decides what may be published) does not hold
on the cartridge path.

Note `commitPush` (`src/App.tsx:603`) DOES guard itself. The `aria-disabled` pattern is the
right UX choice here — the comment at `PlanScreen.tsx:203-206` deliberately keeps the control
focusable and explains the reasons in adjacent visible text rather than using a `disabled`
attribute and a tooltip — but that pattern REQUIRES a guard in the handler. It was written for
push and missed for cartridge.

**Fix shape:** guard `commitCartridge` the way `commitPush` guards itself. A `ready`/blockers
check in the handler, not only in the styling.

---

## 2. An off-scheme `img.src` is dropped silently — no finding — FIXED (f52b2e5)

`filterAttrs` (markup/sanitization path) drops an `img` `src` whose scheme is not permitted and
publishes `<img alt="…">` with no source and no finding.

Violates the invariant issue 09 exists to protect: nothing publishes with a silent hole. Every
refused image must keep BOTH a blocking finding and a visible `[Embedded image: alt]`
placeholder. The anydoc path does this; the markup path does not.

Found by the issue-12 design agent.

---

## 3. An alt-less image becomes an empty text node — FIXED (0ddeeea)

`src/import/markup.ts:353` replaces an image lacking `alt` with an **empty text node**, so it
vanishes invisibly. The sibling anydoc path emits `[Embedded image: alt]` instead.

Same family as #2 — the no-silent-holes rule is enforced on the anydoc path and not on the
Markdown/HTML path. #2 and #3 are probably one fix.

Found by the issue-11 design agent.

---

## 4. A 429 is the one status never waited on — OPEN

`webbooks.ts` retries only on status >= 500. The relay's own limiter returns **429** with
`retry-after: 60` (limiter is 60 requests / 60 s), so the one response that explicitly tells the
client how long to wait is the one the client never waits on.

Found by the issue-12 design agent.

---

## Outcome

- **#1 — fixed in `0b77d74`.** Guarded at the button, where `ready` is derived and is the single
  authority. A test reproduced the bypass first: `onCommit` fired once against `aria-disabled="true"`.
  A sweep of every other `aria-disabled` control found `AppShell.tsx:374` and `ImportPlanEditor`'s
  Split button both already guarded, so this was one miss, not a systemic pattern.
- **#2 — fixed in `f52b2e5`.** Added `strippedUrls` to `AllowlistResult`; the gate turns each into a
  blocker. The sanitized html is unchanged — `allowlist.test.ts:110-111` deliberately pins it, and
  dropping a bad scheme is correct. What was missing was that anyone find out.
- **#3 — fixed in `0ddeeea`.** The markup path now emits `[Embedded image: alt]`, the placeholder
  `anydoc-html.ts` already used, so both import paths describe the same loss in the same words.
- **#4 — still open.** It was briefly homed in the publisher-URL plan, which was dropped on
  2026-08-29 (see `publisher-url-import-not-pursued.md`). It needs a new home, and it is still
  reachable: `webbooks.ts` serves the LibreTexts and OpenStax catalog browse that ships today, and
  the relay's limiter is 60 requests per 60 seconds — so a 429 is an ordinary outcome of browsing a
  large book, not a hypothetical.
