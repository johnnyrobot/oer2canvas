# oer2canvas

oer2canvas turns an open-textbook chapter into accessible Canvas-ready pages. It runs the
fetch, repair, audit, and compliance queue in the browser. The server component is a
stateless Cloudflare Worker used only where browser CORS prevents a direct request — which is
why web page import does not use it. Firecrawl's API answers cross-origin browser requests
directly, so that call is made from the browser and the user's key never reaches this project's
infrastructure. A self-hosting operator can instead point web page import at an extraction
service they run themselves, in which case their users need no account and no key at all; see
[Optional self-hosted web extraction](#optional-self-hosted-web-extraction).

## Release scope

The public web app supports OpenStax, LibreTexts, Pressbooks, pasted text/Markdown/HTML, local
UTF-8 `.txt`, `.md`, `.markdown`, `.html`, and `.htm` files, text-oriented `.docx`, `.epub`,
`.odt`, and `.rtf` files, text-based `.pdf` files, and one web page at a time, through one output
path:

- a Common Cartridge 1.1 download, with no Canvas address, account, or token access.

Text, Markdown, and HTML imports are processed entirely in the browser and are limited to 2 MiB.
Plain text is escaped. Markdown uses a pinned GFM parser, and both
its raw HTML and direct HTML imports pass through one inert semantic sanitizer. Scripts, event
handlers, forms, active embeds, source styling, unsafe URLs, and unsupported elements are removed
with visible findings before preview. A validated public HTTPS source URL can resolve relative links;
private-network, IP-literal, and credential-bearing targets are rejected. Without a base, relative
links become non-link text with a warning. Markup images never issue network requests: their
alternative text is retained and they block preparation until packaged markup assets ship.
Web page import fetches one address at a time and requires the user's own Firecrawl account and
API key. The address and the key go from the browser directly to `api.firecrawl.dev` and never
through the relay, which is unchanged and never sees the key; the key is held in the tab's memory
only and is erased on Forget key or when the tab closes. One URL becomes one page and no links are
followed. The interface says all of this above the button, before anything is sent. Images in a
fetched article are not packaged: each is marked in place with a visible placeholder and blocks
preparation, exactly as a Markdown import's images do. A PDF address is refused and pointed at the
Document tab, where a page that is an image of text can be recognised and refused. A 404 delivered
inside a successful extraction, a redirect into a private network, and an address that is not
public HTTPS are all refused rather than published.

Text-oriented structured-document imports are limited to 16 MiB and parsed locally in a
disposable AnyDoc WebAssembly Worker. Headings, paragraphs, lists, links, code blocks, and simple
tables are converted to controlled semantic HTML. Embedded images and other unsupported
structured-document content are shown as blocking findings instead of being omitted silently. Every
import then becomes a proposed page plan: the document is split at the highest heading level that
repeats (a lone document title is not a split; content with no repeated headings starts as one
page), up to 100 proposed pages per document. Before anything is prepared, the user can rename,
include or exclude, split, merge, and reorder the proposed pages with keyboard-operable controls
and preview each one, without the source being reread. Page identities derive from the source
content hash and each page's structural position, so re-importing the same document updates the
same Canvas pages. Changing a plan that was already prepared discards the prepared output until
it is confirmed again. The import requires a title, a stated basis for republishing the material,
and acknowledgement that the user remains responsible for rights and final accessibility review;
these and the optional author, source, public URL, and license metadata stay editable on the page
plan and become the page's source-and-license attribution. The app never invents a URL or an open
license.

The repository also retains a resumable Canvas REST push for an operator-controlled deployment.
It is disabled in the public build and public relay. It may be enabled only when the operator
self-hosts and administers **both** this PWA/relay and the Canvas instance it is pinned to. See
[Optional self-hosted Canvas push](#optional-self-hosted-canvas-push).

LibreTexts is browsed from a 1,000-book Commons snapshot and imports either its Deki tree or
its public recursive page hierarchy. Pressbooks is browsed from static snapshots covering 15
verified networks and 6,639 books. The optional local VLM alt-text draft runs in the browser
with WebGPU; the first use downloads and caches the selected Florence-2 base model (about
318 MiB) and no image or draft is sent to an inference service.

PDF import runs the PDF Inspector module Worker locally. Parser code and WASM are fetched only
after the user starts a matching import, and source bytes stay in the browser. The Worker
classifies the document before extracting it, so an over-budget file is refused before its text is
built; a page that is an image of text blocks preparation, because this release runs no OCR in the
browser; and a figure is marked in place rather than imported. The document-import release
matrix is desktop Chrome and Firefox.
Playwright WebKit remains diagnostic cross-engine evidence; Safari and mobile browsers are not
supported for document import.

A failed or cancelled import says what went wrong, the form stays usable, and nothing from
the interrupted attempt is kept, so you can correct the input and try again.

## Local development

```sh
npm ci
npm run dev:relay   # terminal 1
npm run dev         # terminal 2
```

The relay must run alongside Vite because some publisher resources do not provide browser
CORS. The application itself never reads `.env.local`; local
Canvas probes may use that file, but it must never contain a `VITE_` variable or be
committed.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:dist

# Optional self-host artifact boundary
OER2CANVAS_DEPLOYMENT_MODE=self-hosted-canvas \
OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN=https://canvas.example.edu \
npm run build
OER2CANVAS_EXPECT_SELF_HOSTED_CANVAS_ORIGIN=https://canvas.example.edu npm run test:dist
```

The suite includes jsdom unit tests, headless Chromium accessibility/parity tests, and a
smoke test that exercises the built bundle through compile, audit, and cartridge export. The
default artifact test requires the Canvas controls to be absent; the optional two-command check
requires the enabled artifact to expose one read-only pinned Canvas origin.

## Production deployment

Cloudflare account access, ownership of `johnnyrobot.dev`, and the custom domain are
required for deployment. After those are configured:

```sh
npm run deploy
PRODUCTION_ORIGIN=https://oer2canvas.johnnyrobot.dev npm run verify:production
```

The repository also contains a manual `production` GitHub Actions deployment. Its environment
is restricted to protected branches and requires scoped `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` secrets. The required CI check blocks merges to `main`.

`verify:production` is intentionally read-only. It verifies the HTML, manifest icons, all
catalog families, relay guards, and one public response from each E8 publisher without
sending a Canvas token. It also verifies that the public relay refuses Canvas-shaped targets.

## Optional self-hosted Canvas push

The direct-push code is provided for operators who administer their own deployment. This mode
is not for `*.instructure.com`, a school/employer/institutional Canvas service, or any other
third-party Canvas instance. Enable it only when all of the following are true:

- you deploy and administer your own copy of the oer2canvas PWA and its relay;
- you self-host and administer the Canvas instance receiving the pages; and
- you pin the same exact HTTPS Canvas origin in both the frontend build and the Worker.

The public/default build is fail-closed: the frontend defaults to `public-cartridge-only`, and
the Worker commits that mode so it overrides even a stale Canvas-origin binding. This removes
the Canvas address/token/course UI and makes the relay reject all Canvas API traffic. To build
an operator-controlled deployment, replace the example origin and your Worker route/domain,
then set both sides explicitly:

```sh
# terminal 1, local relay
npm run dev:relay -- \
  --var DEPLOYMENT_MODE:self-hosted-canvas \
  --var SELF_HOSTED_CANVAS_ORIGIN:https://canvas.example.edu

# terminal 2, local PWA
OER2CANVAS_DEPLOYMENT_MODE=self-hosted-canvas \
OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN=https://canvas.example.edu \
npm run dev

# production build and Worker deploy
OER2CANVAS_DEPLOYMENT_MODE=self-hosted-canvas \
OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN=https://canvas.example.edu \
npm run build
npx wrangler deploy \
  --var DEPLOYMENT_MODE:self-hosted-canvas \
  --var SELF_HOSTED_CANVAS_ORIGIN:https://canvas.example.edu
```

Both origin values must be identical bare origins such as `https://canvas.example.edu`, with no
path, and both deployment modes must be `self-hosted-canvas`. The origin must use a public,
non-IP FQDN; private/loopback/reserved hostnames and IP literals remain blocked by
the shared frontend/Worker validator. The PWA
shows the pinned address read-only, and the relay permits Canvas GET/POST/PUT only at that exact
origin. A missing, invalid, or different Worker value fails closed. Do not weaken the exact-origin
check or the explicit public-mode override to support arbitrary user-entered Canvas hosts. A
deployment intended for other people's
institutional accounts needs an institution-approved OAuth or LTI design instead of this
manual-token self-host mode.

A separate verifier performs reversible writes only against a named test/sandbox course on that
paired self-hosted deployment:

```sh
SELF_HOSTED_APP_ORIGIN=https://oer2canvas.example.edu \
CANVAS_BASE_URL=https://canvas.example.edu \
CANVAS_TEST_COURSE_ID=123 \
npm run verify:canvas-live
```

It refuses non-test course names, creates a one-hour token, proves whether requested Canvas
URL scopes are actually enforced, drives a create and in-place update through the deployed
app, reads a semantic fixture back after Canvas sanitization, and restores the original page
set in cleanup. Canvas documents that manually generated scopes are ignored when the
instance's default developer key does not enable scopes; the verifier reports that condition
as an open least-privilege gate rather than treating scope metadata as enforcement.

## Optional self-hosted web extraction

By default, importing a web page requires the user's own Firecrawl account and API key. An
operator who self-hosts this app can instead point web page import at an extraction service
they run themselves, so their users import a URL with no third-party account and no key. It is
a separate opt-in from Canvas push and neither requires the other. The public build has this
compiled out entirely.

The two builds share everything except the fetch. The public-HTTPS check on the address, the
refusal of a 404 delivered inside a successful extraction, the PDF refusal, the redirect
disclosure, sanitization, the image refusal, provenance, and the rights ceremony are one
implementation used by both, so the two deployments cannot disagree about what a page is. What
differs is what the extractor extracts: this mode has no equivalent of Firecrawl's
main-content-only option, so an imported page carries more of the site's navigation and footer
than the same URL does on the public build. It is visible in the preview and editable in the
page plan.

### The extraction service must serve HTTPS. Localhost will not work.

This is the part most likely to cost a day, so it is stated first. A local extractor
conventionally listens on `http://localhost:11235`, and an HTTPS page cannot reach it. Measured
2026-08-30 against Chromium 151:

```
Access to fetch at 'http://127.0.0.1:63631/probe' from origin 'https://oer2canvas.example'
has been blocked by CORS policy: Permission was denied for this request to access the
`loopback` address space.
```

That is Local Network Access, not mixed content, and the permission is denied by default. Any
*other* plain-HTTP address fails earlier still, as mixed content, before the request is even
made. The same requests from a page served over plain HTTP succeeded, which is what rules out
every other explanation. `http://localhost` would also serve only the one machine sitting at
it, which is not what a campus deployment needs.

So the build refuses a loopback, private, IP-literal, or plain-HTTP origin, with the same
validator the pinned Canvas origin uses. The failure is a build error naming the variable
rather than a runtime failure nobody can diagnose.

**The extractor is not behind the relay, and the relay is unchanged.** A Cloudflare Worker at
the edge cannot reach a machine on the operator's own network, so routing through the relay
would not solve the localhost problem — it would make it unsolvable. And allowlisting one
destination that then fetches whatever URL is named in its request body would be an open proxy
with an extra hop, which is exactly what the relay's host allowlist exists to prevent.

### What the operator runs

The extraction service is [crawl4ai](https://github.com/unclecode/crawl4ai)'s Docker REST
server, version `0.9.x`. Earlier versions cannot report the status of a page reached through a
redirect, so this app's version handshake refuses them rather than importing pages whose status
it cannot check.

The service binds loopback by default and its own configuration tells operators to put a
TLS-terminating reverse proxy in front of it for any other exposure. That proxy does three
jobs:

1. **Terminates TLS** at the origin pinned in the build, e.g. `https://extract.example.edu`.
2. **Answers CORS** for the app's origin. crawl4ai 0.9 ships `cors_allow_origins: []` and
   installs no CORS middleware until an origin is listed, so a browser-direct call to an
   unconfigured service fails at the preflight.
3. **Supplies the service's own credential**, if it has one. crawl4ai refuses to start on a
   non-loopback bind without `CRAWL4AI_API_TOKEN`. That token belongs to the operator's proxy;
   this app never asks for it, never holds it, and never sends one.

### Building it

```sh
# A frontend build only. There is no Worker variable for this mode, because the
# relay is not in this path at all — see above.
OER2CANVAS_WEB_EXTRACTION=self-hosted-extractor \
OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN=https://extract.example.edu \
npm run build
OER2CANVAS_EXPECT_SELF_HOSTED_EXTRACTOR_ORIGIN=https://extract.example.edu npm run test:dist
```

Both variables are required together and the build fails closed in both directions: the mode
with no origin is an error, and an origin with no mode is an error too, because a variable that
is set and silently ignored is how a capability appears to be on while it is off. The origin
must be a bare public HTTPS origin with no path, no query, and no credentials.

`npm run test:dist` checks the artifact rather than the source: the self-hosted bundle must
name the extraction endpoint and must NOT name `api.firecrawl.dev`, `/v2/scrape`, or a Firecrawl
API key field, and the default public bundle must be the exact mirror of that. Run it both ways
after changing either side.

## Canvas token handling in optional self-host mode

The public deployment never asks for or accepts a Canvas token. In an explicitly enabled
self-host deployment, the token is entered by the operator/user, sent only to the pinned Canvas
host through that operator's relay,
and held in memory only for the current tab. It is never written to browser storage. The
relay forwards the bearer header but does not store or log it; it also strips cookies,
returns inert non-cacheable responses, and rejects foreign browser origins. A one-time
startup migration removes token keys left by earlier releases from both IndexedDB database
names. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Accessibility and content integrity

Publication is gated on the final Canvas-safe bytes: zero definite audit blockers and an
empty human-review queue. The app's own interface is tested against WCAG 2.2 A/AA rules.
Generated textbook pages target the supplied Canvas guide's WCAG 2.1 AA requirements: Template 1
structure, Canvas-allowlisted markup, descriptive links, accessible tables, contrast-safe colors,
and Canvas's 120-character alt-text limit are enforced during compilation.
This is a content transformation aid, not a legal or institutional accessibility
certification; instructors remain responsible for reviewing imported results in their Canvas
instance. See [ACCESSIBILITY.md](ACCESSIBILITY.md).

## Project documents

- [Production operations runbook](docs/OPERATIONS.md)
- [Proposed browser document import specification](docs/DOCUMENT_IMPORT_SPEC.md)
- [Proposed browser document import implementation plan](docs/DOCUMENT_IMPORT_IMPLEMENTATION_PLAN.md)
- [Canvas embedded-image probe procedure](docs/canvas-image-probes/README.md)
- [Privacy notice](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Accessibility statement](ACCESSIBILITY.md)
- [Third-party notices](THIRD-PARTY-NOTICES.md)
