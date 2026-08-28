# 02 — Prove browser parser workers and establish import budgets

**What to build:** Prove that the selected document and PDF parsers can load lazily and run inside browser workers without server compute, then establish evidence-based browser support and resource limits for production imports.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] A production build can lazy-load AnyDoc and PDF Inspector only after the user begins a matching import.
- [x] Parsing runs in module workers and transfers file buffers without unnecessary full-buffer copies.
- [x] The probe supports progress reporting, cancellation, worker termination, and a clean retry.
- [x] Benchmarks cover representative small, medium, and stress fixtures on the supported browser matrix.
- [x] File-size, page-count, asset-count, timeout, and memory guardrails are selected from recorded measurements rather than guesses.
- [x] Failure to initialize WebAssembly or a worker produces a user-actionable error and does not affect existing publisher imports.

## Answer

Browser-only parsing is feasible. The production build now has probe-only AnyDoc 0.2.4 and PDF
Inspector 1.17.0 module Workers. Each source buffer is transferred, not cloned; each attempt owns a
fresh disposable Worker; and progress, cancellation, timeout, initialization failure, result
budgets, termination, and retry are covered at the public Worker boundary. Existing publisher and
plain-text imports do not invoke either probe.

The built-artifact smoke proves initial application load requests no parser code or WASM. An
AnyDoc probe loads only its Worker/WASM pair, and a PDF probe loads only its pair. The four hashed
assets are excluded from service-worker install precache and enter a bounded runtime cache only
after use.

The supported release matrix is desktop Chrome and Firefox. The committed benchmark passed
generated small, medium, and boundary fixtures in Chrome 151 and Playwright Firefox 153; Playwright
WebKit 26.5 also passed as diagnostic cross-engine evidence but does not imply Safari support. The limits
are 16 MiB input, 200 PDF pages, 64 assets, 8 MiB total assets, 4 MiB per asset, 30 seconds, and 128
MiB reported WASM memory. The slowest observed parse was 4,287 ms and the highest observed WASM
linear memory was 97,845,248 bytes. See
`docs/evidence/document-parser-benchmark-2026-08-27.md` and its adjacent JSON report.

Safari and mobile browsers are intentionally outside the initial document-import support matrix,
so they are not release gates. Page-formation work will separately measure and select the
proposed-page limit because this parser probe does not form Canvas pages. Document formats remain
`probe-only` until their corresponding import tickets enable them in the UI.
