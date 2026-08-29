# 17 — Extract a web article on a self-hosted deployment, without a Firecrawl key

**What to build:** Let a self-hosted operator point the web-article importer at an extraction service they run themselves, so their users import a URL with no third-party account and no API key, while the public deployment continues to require a user-supplied Firecrawl key.

**Blocked by:** 12 — Import one URL using a memory-only Firecrawl key.

**Status:** ready-for-agent

Issue 12 builds a `WebArticleFetcher` seam in `src/import/web.ts` with `firecrawlFetcher` as its first
implementation, and keeps every shared concern — sanitization, the 404-inside-200 check, PDF refusal,
image refusal, findings, provenance, the rights ceremony — BELOW the seam. This issue supplies the
second implementation. It exists because the two deployments answer "who bears the abuse liability
for fetching arbitrary URLs" differently: on the public build it is the instructor's own Firecrawl
account, and on a self-hosted build it is the operator's own machine, which is theirs to answer for.

**The house pattern to follow.** A capability that is off in the public build and switched on by an
operator pinning an exact origin already exists here for Canvas push: `src/vite-env.d.ts` declares
`__OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__` as "Empty in the public build; an exact HTTPS origin in an
opted-in self-host build", `worker/relay.ts` reads the matching `SELF_HOSTED_CANVAS_ORIGIN`, and
`src/App.tsx` gates the whole push capability on it. Read that before designing anything new.

**The hard part, which is not a config line.** A local extractor conventionally listens on
`http://localhost:<port>`. A page served over HTTPS cannot call plain HTTP, and the relay allowlists
destination hosts precisely so it cannot become an arbitrary proxy. Whether the extractor sits behind
the relay, beside it, or is required to serve HTTPS is the substance of this issue, not an afterthought.

**On tool choice.** `crawl4ai` drives headless Chromium and ships a Docker REST server, so "the
operator runs a service at an origin" is its native deployment mode. `scrapling` targets resilient
scrapers and anti-bot evasion, which is a different problem. Whatever is chosen must render
JavaScript — see the third criterion for why.

- [ ] A self-hosted build reaches an operator-configured extractor origin; the public build has the capability compiled out entirely, matching the `SELF_HOSTED_CANVAS_ORIGIN` precedent.
- [ ] No Firecrawl key is required, requested, or storable when a local extractor is configured, and the key UI is absent rather than merely hidden.
- [ ] The same URL yields the same Canvas page in both deployments. Everything below the fetcher seam stays shared, so the two builds cannot disagree about what a page is.
- [ ] The extractor renders JavaScript, so a JS-shell article does not succeed on the public build and fail on a self-hosted one — an inconsistency a user would have no way to diagnose.
- [ ] The origin and transport problem is settled explicitly and documented: how an HTTPS page reaches the extractor, and what that means for the relay's allowlist, which must not become an arbitrary proxy.
- [ ] Extractor failures are as actionable as Firecrawl's: unreachable, wrong or unsupported version, malformed response, timeout, and cancellation each produce a finding a user can act on.
- [ ] `PRIVACY.md`, `README.md` and `SECURITY.md` state what a self-hosted deployment sends where, as precisely as issue 12 makes them state it for the public one.

**Known coupling to issue 12.** Its Task 12 asserts that exactly one extraction endpoint appears in
the source and in the built bundle. That assertion is correct for the public build and must be
re-scoped, not deleted, when a second fetcher ships — the property worth keeping is that the PUBLIC
bundle contains exactly one endpoint, not that the codebase does.

**Not a blocker on 13 — Release core document importer.** This is a deployment-mode enhancement. The
public release ships with issue 12's Firecrawl path alone.
