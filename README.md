# oer2canvas

oer2canvas turns an open-textbook chapter into accessible Canvas-ready pages. It runs the
fetch, repair, audit, and compliance queue in the browser. The server component is a
stateless Cloudflare Worker used only where browser CORS prevents a direct request — which is
why web page import does not use it. Firecrawl's API answers cross-origin browser requests
directly, so that call is made from the browser and the user's key never reaches this project's
infrastructure.

## Release scope

The public web app supports OpenStax, LibreTexts, Pressbooks, pasted text/Markdown/HTML, local
UTF-8 `.txt`, `.md`, `.markdown`, `.html`, and `.htm` files, text-oriented `.docx`, `.epub`,
`.odt`, and `.rtf` files, text-based `.pdf` files, PowerPoint decks (`.pptx`, `.pptm`, `.ppsx`,
`.ppsm`), and one web page at a time, through one output path:

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

A PowerPoint deck becomes **one proposed page**, with each slide a titled section — a deck is
one lesson, and an instructor who wants it split can do that in the page plan editor, which
already splits at any block boundary. Because a deck is not a document, its slides are read
twice: once by the parser, and once from the file's own package, so the two accounts can be
compared. What that comparison buys, and what it costs:

- **Speaker notes are never imported.** The parser emits a presenter's private note as an
  ordinary quotation, indistinguishable from a pull quote; matching it against the deck's own
  notes part is what tells them apart. Notes are dropped and the slides that had them are
  named, so you can add whatever students actually need.
- **Diagrams, charts, and embedded audio or video are not imported.** They leave no content
  behind at all, so a finding names the slide, the kind, and the count; add them in Canvas
  afterwards.
- **A slide with no title is titled by its number** (`Slide 7`) and listed, so it can be found
  and renamed. Roughly two in five slides in real decks carry no title placeholder, so this is
  ordinary rather than exceptional.
- **An equation blocks import**, the same as in a Word document or an EPUB.
- **An image the importer cannot package** — a pasted chart, a Visio drawing, or legacy clip
  art, usually saved as EMF or WMF — blocks import; replace it with PNG, JPEG, GIF, or WebP.
- **A slide whose content cannot be matched to the deck's own outline blocks import outright.**
  Publishing a guess would put a paragraph under the wrong slide's heading, where nothing looks
  wrong and no reader could discover it.
- **Macros are never read or run.** A `.pptm` or `.ppsm` imports its slides and nothing of its
  macro.

OpenDocument Presentation (`.odp`) is **not** offered. Its support was evaluated against the
same bar and did not meet it: an Impress chart or diagram is an embedded object neither account
can identify, so it is dropped — or published as a still picture of itself — with nothing saying
so. Everything else on that path works, but a silent loss is the one thing this workflow refuses
to publish, so the format stays unreleased rather than shipping with a limitation nobody could
act on.

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
