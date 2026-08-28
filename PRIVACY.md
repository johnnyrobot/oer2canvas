# Privacy notice

oer2canvas has no accounts and does not maintain a server-side library of chapters,
answers, exports, or Canvas content.

In the public deployment, your browser requests source content from supported publishers,
sometimes through the stateless relay, and builds the Common Cartridge locally. The public app
does not expose a Canvas address, access-token, course-selection, or direct-push control. Its
relay rejects Canvas API targets, bearer credentials to publishers, and publisher write methods.

Pasted plain text and selected `.txt` files are read, previewed, remediated, audited, and packaged
inside the browser. Their contents, metadata, source hash, and derived pages are not sent through
the application relay or written to browser storage.

Small workflow values remain browser-local. A one-time migration removes Canvas token keys
saved by earlier releases from both the current and legacy IndexedDB databases. Clearing site
data removes other browser-local state.

The repository contains an optional direct-push mode only for an operator who self-hosts and
administers both the PWA/relay and the paired Canvas instance. In that mode, the Canvas origin
is fixed by the deployment; the user's token and page content pass through the operator's own
relay to that exact Canvas origin. The token is held in memory only for the current tab and is
never written to browser storage. “Forget this token” clears the live field, session copy, and
both known database keys. The relay does not retain or log the token or page content.

There is no telemetry, advertising, tracking pixel, or remote AI inference service. The optional
local VLM draft downloads its pinned Florence-2 model files from the Hugging Face model host on
first use and caches them in the browser. Image decoding, model execution, and generated drafts
stay on the device; if a publisher image lacks CORS headers, only that image's bytes are fetched
through the project's stateless allowlisted relay so the browser can decode it.

This notice describes the public deployment maintained by this project. Anyone operating an
independent self-hosted copy is responsible for publishing an accurate notice for that deployment
and for complying with the laws and policies that apply to its users, Canvas data, and publishers.
