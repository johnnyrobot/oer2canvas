# Privacy notice

oer2canvas has no accounts and does not maintain a server-side library of chapters,
answers, exports, or Canvas content.

In the public deployment, your browser requests source content from supported publishers,
sometimes through the stateless relay, and builds the Common Cartridge locally. On the Web page
tab it also requests content from **any address you enter**, through Firecrawl and on your own
Firecrawl account; that is described in full below. The public app
does not expose a Canvas address, access-token, course-selection, or direct-push control. Its
relay rejects Canvas API targets, bearer credentials to publishers, and publisher write methods.

Pasted text, Markdown, and HTML and selected `.txt`, `.md`, `.markdown`, `.html`, `.htm`, `.docx`,
`.epub`, `.odt`, `.rtf`, and `.pdf` files are read, previewed, remediated, audited, and packaged
inside the browser. Markdown and HTML are normalized locally in the main browser context; structured documents
are parsed by AnyDoc WebAssembly in a dedicated browser Worker. Their contents, metadata, source
hash, parser output, and derived pages are not sent through the application relay or written to
browser storage.

Selected PDF files likewise transfer their bytes directly to a dedicated browser Worker, which
classifies and extracts them locally. AnyDoc and PDF Inspector execute locally as WebAssembly; the
bytes of a file you select, those parsers' output, and benchmark measurements are not uploaded to
Cloudflare, Firecrawl, or another service. That sentence is about local file parsing, and stays
true — importing a **web page** is a separate feature that does talk to Firecrawl's API, described
next. Parser assets may be cached by the browser after first use, but imported documents are not.

Importing a web page sends two things out of your browser: **the address you enter, and your own
Firecrawl API key.** They go directly to `api.firecrawl.dev`, and only when you press the import
button on the Web page tab — never on a keystroke, never in the background, and never for any other
kind of import. This app's relay is not involved and never sees your key, so no copy of the address
or the key reaches this project's Cloudflare account. Firecrawl fetches that one page and returns
its extracted text, which is then normalized, previewed, audited, and packaged in your browser like
any other import. One import is one request for one page; no links are followed. Your key is held
in the tab's memory only, is never written to browser storage, and is erased when you close the tab
or press Forget key; the fetched article is not persisted either. Firecrawl's own privacy terms
govern what Firecrawl does with the address and with the page it fetches — this project cannot
speak for them. Note what this means: **any URL you paste is a host this app now talks to**, on
your account.

A deployment whose operator runs their own extraction service changes exactly one thing about
that paragraph, and the interface says which before you press the button. The address you enter
goes from your browser to that operator's own service — its address is named on the screen —
instead of to `api.firecrawl.dev`. **No API key is sent, asked for, or held, because there is
no key field in that build at all**, and no credential of any kind leaves your browser on this
path. This app's relay is still not involved. The operator of that deployment, rather than this
project or a third-party vendor, is who sees the address you enter and runs the browser that
fetches it; they are responsible for publishing an accurate notice for their own deployment, as
the last paragraph of this notice says. Everything after the fetch — normalizing, previewing,
auditing, packaging — happens in your browser exactly as it does on the public app.

Small workflow values remain browser-local. A one-time migration removes Canvas token keys
saved by earlier releases from both the current and legacy IndexedDB databases. Clearing site
data removes other browser-local state.

The optional IDEA review keeps its ratings, checklist answers, notes, assessor name and title, and
BIPOC benchmark in this browser's IndexedDB database on this device, so that a reload does not
lose them. They are never sent to the relay, to a publisher, or to any other host, and are removed
by **Forget all IDEA reviews** on the IDEA screen or by clearing site data. On a shared computer,
forget them when you are done.

The repository contains an optional direct-push mode only for an operator who self-hosts and
administers both the PWA/relay and the paired Canvas instance. In that mode, the Canvas origin
is fixed by the deployment; the user's token and page content pass through the operator's own
relay to that exact Canvas origin. The token is held in memory only for the current tab and is
never written to browser storage. “Forget this token” clears the live field, session copy, and
both known database keys. The relay does not retain or log the token or page content.

There is no telemetry, advertising, tracking pixel, or remote AI inference service. Read that
alongside the two remote hosts this app can talk to on purpose, both described above: the Hugging
Face model host, for the optional local VLM draft, and `api.firecrawl.dev`, for web page import. The
optional
local VLM draft downloads its pinned Florence-2 model files from the Hugging Face model host on
first use and caches them in the browser. Image decoding, model execution, and generated drafts
stay on the device; if a publisher image lacks CORS headers, only that image's bytes are fetched
through the project's stateless allowlisted relay so the browser can decode it.

This notice describes the public deployment maintained by this project. Anyone operating an
independent self-hosted copy is responsible for publishing an accurate notice for that deployment
and for complying with the laws and policies that apply to its users, Canvas data, and publishers.
