# Security policy

## Reporting a vulnerability

Please report security issues privately to `johnny@johnnyrobot.ai`. Do not include Canvas
tokens, course exports, or private publisher material in a report. If a report contains a
credential, revoke it in Canvas immediately and mention only that it was revoked.

## Security boundaries

- No account, user database, analytics, or server-side content store exists.
- The public build has no Canvas address, token, course-selection, or direct-push entry point.
  Its relay refuses every Canvas API target and never forwards credentials or write methods to
  publisher hosts.
- Direct Canvas push is a default-off repository capability only for an operator who self-hosts
  and administers both this PWA/relay and its paired Canvas instance. Enabling it requires an
  explicit `self-hosted-canvas` mode and exact HTTPS Canvas origin in both the build and Worker;
  the UI address is read-only and the Worker rejects every other origin. The committed public
  mode overrides even a stale Canvas-origin binding.
- In that optional mode, Canvas tokens are session-only and never written to browser storage. A
  one-time migration removes token keys left by earlier releases from both current and legacy
  IndexedDB names; `Forget this token` clears the live field, session copy, and both database keys.
- The Firecrawl API key is entered by the user, sent only to `api.firecrawl.dev` in an
  `Authorization` header, never placed in a URL or a request body, and held in memory for the
  current tab only. It is never written to browser storage and needs no migration, because no
  release ever wrote one. `Forget key` clears the held key and the live field.
- Web extraction has a second, default-off deployment mode in which the operator runs the
  extraction service themselves and no key is required. It is compiled out of the public build:
  the artifact check requires the public bundle to name the Firecrawl endpoint and no other, and
  requires a self-hosted bundle to be the exact mirror — no `api.firecrawl.dev`, no
  `/v2/scrape`, and no key field on the screen.
- In that mode the extractor origin is pinned at build time and validated by the same rule as
  the pinned Canvas origin: public HTTPS FQDN, no path, no query, no credentials, no IP literal,
  no private or reserved host. Loopback and plain HTTP are refused at build time because a page
  served over HTTPS cannot reach either — measured 2026-08-30 on Chromium 151, a loopback fetch
  is denied by the Local Network Access permission and any other plain-HTTP fetch is blocked as
  mixed content.
- No credential is sent by the browser in that mode. The extraction service's own token, if it
  has one, is supplied by the operator's reverse proxy; the app has no field, no store, and no
  build variable for it.
- The app refuses an extraction service whose reported version is outside the supported range,
  rather than importing pages whose origin status it cannot check.
- The relay is not involved in web-page import in either mode and its allowlist is unchanged.
  The extractor sits beside the relay, not behind it: a Worker at the edge cannot reach an
  operator's own network, and one allowlisted host that fetches whatever URL is named in a
  request body would be an open proxy with an extra hop. A CORS or network failure is reported
  as such and never offers a relay route.
- A target URL is validated as public HTTPS before the request leaves the browser — the extraction
  service is itself an SSRF vector, and was measured accepting and proxying `http://127.0.0.1:8080/`
  on 2026-08-29 — and the post-redirect URL is re-validated.
- The origin's status is checked: a 404 delivered inside a successful extraction is refused.
- A PDF URL is refused rather than remotely text-extracted, because the remote path produces none
  of the scanned-page signals the local PDF path uses to decide whether a page may publish.
- Fetched Markdown is untrusted and passes through the same sanitizer, the same 2 MiB limit, and
  the same accessibility gate as pasted Markdown.
- The relay accepts only HTTPS targets, blocks private/loopback/reserved hosts, forwards an
  explicit request-header allowlist, drops cookies, re-validates GET redirects, refuses DELETE,
  rate-limits direct clients, and forces relayed responses to be sandboxed,
  attachment-delivered, and non-cacheable.
- Publisher HTML is parsed in an inert detached document. Only allowlist-repaired HTML is
  placed in the audit iframe or sent to Canvas.
- Pasted and file-selected text, Markdown, and HTML are decoded as strict UTF-8 and limited to
  2 MiB. Plain text is escaped. Markdown runs through an isolated pinned GFM parser; its raw HTML
  and direct HTML imports then share one detached `DOMParser` sanitizer. That sanitizer removes
  scripts, handlers, forms, active embeds, source styles, unsafe URL schemes, and unsupported
  elements with visible findings before any preview. The controlled result still passes through
  the same final allowlist and accessibility gate as publisher content. Relative links are resolved
  only from a public HTTPS base; private-network, IP-literal, and credential-bearing targets are
  rejected. Markup images never issue network requests: supplied alternative text is retained and
  preparation remains blocked until controlled asset packaging ships. Source files and derived
  document data remain browser-local.
- Release-enabled text-oriented DOCX, EPUB, ODT, and RTF are limited to 16 MiB and parsed by AnyDoc in a disposable
  module Worker with a transferred buffer, a 30-second timeout, and measured input/asset/memory
  budgets. Content signatures must identify the selected format regardless of its filename or reported MIME type.
  Parser text is escaped into a fixed semantic HTML vocabulary; unsupported or embedded content
  blocks preparation instead of disappearing. Source files and derived document data remain local.
- Release-enabled text-based PDF import uses the same disposable-Worker boundary: the PDF
  Inspector module Worker classifies a document before extracting it, so an over-budget file is
  refused before its text is built. Parser output remains untrusted, and a cancelled or failed
  Worker is terminated.

## Operational requirements before launch

- Deploy only from a protected `main` branch after CI passes.
- Keep Workers observability/logging disabled unless a reviewed redaction policy is added;
  tokens and publisher content must never enter logs.
- Run `npm run verify:production` after every deployment.
- Keep the public build in `public-cartridge-only` mode with no Canvas origin, and keep the
  Worker's committed `DEPLOYMENT_MODE=public-cartridge-only`. `verify:production` must confirm
  Canvas push is reported disabled and Canvas-shaped relay targets are refused.
- Review Cloudflare request and CPU quotas before public promotion; move to a paid plan if
  adoption exceeds the documented free-tier budget.
