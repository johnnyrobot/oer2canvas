# 17 — Import a publisher URL

**What to build:** Let a user paste the address of one page on a publisher the relay already forwards to — OpenStax, LibreTexts, or a Pressbooks network — and import exactly that page through the same fetch, compile, audit, gate and cartridge path the catalog browse uses, with authors and licence recovered from the bundled catalogs.

**Blocked by:** —

**Design:** [17-import-publisher-url-design.md](../17-import-publisher-url-design.md)

**Plan:** [17-import-publisher-url-plan.md](../17-import-publisher-url-plan.md)

**Status:** ready-for-agent

- [ ] A pasted URL on an already-forwardable host imports exactly **one page**; a container URL (a LibreTexts page with children, a Pressbooks `/part/`, a book root) offers the book browse instead of expanding to many pages, and issues no crawl of its own.
- [ ] The result is a `Chapter` compiled under its own publisher profile, and the same page reached by catalog browse and by URL produces **identical published bytes**.
- [ ] Authors, licence name and licence URL are recovered from the bundled catalogs and, for OpenStax, from the TOC; a URL naming no catalogued book requires a rights acknowledgement before the fetch and still publishes a D9 attribution block.
- [ ] An `<img>` whose source resolves to a non-public network address is refused with BOTH a blocking finding and a visible `[Embedded image: alt]` placeholder, and never reaches the published bytes.
- [ ] Timeout, cancellation, a 429 carrying `retry-after`, an off-allowlist redirect, a non-HTML content type, and an unreachable publisher are all bounded and reported in terms of the publisher, not the relay.
- [ ] Fetched publisher HTML passes through the existing sanitization and compile path — no new normalization, no packaged image bytes, no change to `worker/relay.ts` or `worker/allowlist-hosts.ts`.
