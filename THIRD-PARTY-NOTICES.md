# Third-party notices

The application uses third-party open-source software. The authoritative package versions
are in `package-lock.json`; this summary identifies the direct runtime and build tools.

| Package | License | Use |
| --- | --- | --- |
| React / React-DOM | MIT | UI runtime |
| axe-core | MPL-2.0 | Accessibility audit engine |
| lucide-react | ISC | Interface icons |
| Temml | MIT | Converts publisher-carried TeX equations to MathML |
| Marked 18.0.11 | MIT | Parses local Markdown with a controlled GFM configuration before sanitization |
| @huggingface/transformers | Apache-2.0 | Browser/WebGPU runtime for the optional local VLM draft |
| @firecrawl/anydoc-wasm 0.2.4 | MIT | Browser Worker parsing for released DOCX, ODT, RTF, EPUB, PowerPoint (`.pptx`, `.pptm`, `.ppsx`, `.ppsm`), and OpenDocument Presentation (`.odp`) import |
| @firecrawl/pdf-inspector-wasm 1.17.0 | MIT | Browser Worker classification and text extraction for released PDF import |
| pdfjs-dist 6.3.289 | Apache-2.0 | Browser-side recovery of image XObjects from a PDF, which the extraction module does not expose |
| Vite / Vitest / Playwright | MIT | Build and test tooling |
| vite-plugin-pwa / Workbox | MIT | Service worker and PWA assets |
| Tailwind CSS | MIT | Styles |
| Wrangler | MIT | Cloudflare Worker development/deployment |

The dependency packages ship their full license text in `node_modules` during development
and in their published distributions. Publisher content and images remain subject to the
publisher's own licenses; every emitted page carries source attribution and the license
metadata available from the source.

The selected `onnx-community/Florence-2-base-ft` model is released under the MIT license.
Its pinned ONNX weights are downloaded from Hugging Face only when local drafting is requested
and are cached by the browser.

The root lockfile applies security overrides for Transformers.js's Node-only transitive
packages (`onnxruntime-node@1.29.0` and `sharp@0.35.4`; `adm-zip@0.6.0` is resolved below
onnxruntime-node). These packages are not imported by the browser export, but the overrides
keep the installed production graph on fixed versions for auditability.

The IDEA phase reproduces, in full, the category descriptions ("Restorative Requirements"),
"Elements for Consideration", Rubric 1 rows and instructions, and the Additional Resources links
from the "ASCCC OERI Inclusion, Diversity, Equity, and Anti-Racism (IDEA) Framework and
Implementation Guide, March 2025" by the ASCCC Open Educational Resources Initiative
(https://asccc-oeri.org/asccc-oeri-inclusion-diversity-equity-and-anti-racism-idea-audit-framework/),
licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The text is vendored in
`src/engine/idea/framework.ts`, where the one editorial choice (an unbulleted example paragraph
kept with its bullet) is recorded; element and row ids there are ours, stable, and never
renumbered.
