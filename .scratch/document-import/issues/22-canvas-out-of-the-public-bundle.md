# 22 — Keep the Canvas capability out of the public bundle

**What to build:** Make a public artifact not CONTAIN the Canvas token UI and the Canvas API paths,
rather than merely decline to render them.

**Blocked by:** None.

**Status:** resolved

**Found by an operator**, 2026-08-30, while checking that the public deployment offered only the
cartridge destination. It does — that part was never broken. But the implementation behind the
destination shipped anyway.

Measured on the deployed public artifact before the fix:

| string in the public bundle | before | after |
| --- | --- | --- |
| `Canvas address` | 3 | 0 |
| `Access token` | 1 | 0 |
| `/api/v1/courses` | 4 | 0 |
| `A Canvas course` | 1 | 0 |

**Why a runtime gate was not enough.** `App.tsx` read the folded build constant and rendered
nothing, which is a true guarantee about behaviour and a weaker one about the artifact. The two
failure modes differ: a runtime gate that regresses ships a Canvas token field to every public
visitor, and an absent module cannot, whatever the gate does. Issue 17 already held the web
extractor to the stronger bar; this brings Canvas — the older and more sensitive capability — up to
it.

- [x] A public artifact contains no Canvas token UI, no Canvas API path, and no Canvas destination card.
- [x] A self-hosted artifact still contains all of it and still pins its configured origin read-only.
- [x] The boundary is enforced by `scripts/smoke-dist.mjs` against the built artifact, not by review.
- [x] The new assertion was proved to bite before it was trusted.
- [x] No behaviour changes on either build.

## Answer

**The mechanism is a locally folded constant, and "locally" is the whole finding.** Routing the
value through an exported `const` in a shared module DOES NOT WORK — measured 2026-08-30, with the
markers unchanged at 3/1/4/1. Rollup will not propagate a constant across a module boundary for
this purpose, so the guard stays live and the modules ship. The value must be folded in the SAME
file that gates on it, which is what `WebArticleImporter.tsx` already did for the extractor origin
and what this now does in `screens.tsx`, `useCanvasConnection.ts` and `App.tsx`. A shared
`canvas-capability.ts` was written, measured, and deleted.

**Three references had to become statically dead**, one per module the strings lived in:

1. `screens.tsx` — the destination card and the `CanvasConnect` panel are both behind
   `CANVAS_ENABLED`, so the JSX folds away and Rollup shakes `CanvasConnect.tsx`.
2. `App.tsx` — `createClient` is a folded ternary, so `canvas/client.ts` and its `/api/v1/courses`
   go with it.
3. `useCanvasConnection.ts` — `normalizeBaseUrl(address)` sits behind the same constant, which is
   what shakes `canvas/transport.ts` and its "Canvas address" messages. `connect` is unreachable on
   a public build in any case: its only caller is `CanvasConnect`, which that build does not
   contain.

`useCanvasConnection`'s `createClient` may now return a promise. That was written for a dynamic
`import()` that turned out to be unnecessary — a static import behind a folded constant shakes
just as well and emits no chunk, whereas `await import()` in a live branch emits one that still
carries the strings. The async signature is kept because `connect` was already async and it costs
nothing, but it is not load-bearing.

**One real consequence, not a workaround.** Gating on a build constant means a public-defines test
project can no longer reach the Canvas UI by injecting a `canvas` prop — that is the point, since a
prop would keep the branch alive. So `useCanvasConnection`'s tests and the Canvas half of
`DestinationScreen`'s move to the `unit-self-hosted` project, which now pins a Canvas origin
alongside the extractor origin it already pinned. The public half of `DestinationScreen` stays in
`unit`, where a public build is exactly the configuration under test. Test count is unchanged at
1653.

**The assertion was proved to bite before it was trusted:** it failed on the pre-fix public
artifact naming `"Canvas address"`, and the pre-existing rendered checks still fail correctly when
a public artifact is measured against self-hosted expectations.
