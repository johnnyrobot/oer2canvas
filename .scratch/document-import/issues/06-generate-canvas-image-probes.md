# 06 — Generate deterministic Canvas embedded-image probe cartridges

**What to build:** Produce small reproducible Canvas cartridges that isolate the unresolved choices for packaged images, along with a repeatable procedure for observing how Canvas imports, stores, renders, shares, and re-exports those assets.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Probe variants cover candidate manifest layouts and app-generated `$IMS-CC-FILEBASE$` references.
- [x] Fixtures include a single image, one shared image referenced by multiple pages, duplicate image bytes, and representative candidate raster types.
- [x] Every probe is deterministic and passes structural cartridge validation before being tested in Canvas.
- [x] A validation worksheet records import success, stored page HTML, rendered image behavior, Files placement, sharing behavior, and re-export behavior.
- [x] The procedure clearly identifies which evidence is required before the production exporter may change.
- [x] Probe generation does not alter the production cartridge path.

## Answer

Added a probe-only Node generator for four controlled manifest layouts: standalone `webcontent`,
`webcontent` with page dependencies, page-owned file entries, and `associatedcontent` with page
dependencies. Each cartridge holds identical page HTML and exact app-generated
`$IMS-CC-FILEBASE$/web_resources/probe/...` references while exercising a single PNG, a GIF shared
by two pages, PNG/JPEG/GIF/WebP rendering, and two paths with identical PNG bytes.

Generation validates safe and deterministic archive entries, well-formed manifest/module XML,
resource references, manifest-to-archive edges, canonical page references, raster signatures, ZIP
CRC/size data, and a third-party `unzip -t` round trip. Tests pin the four archive hashes. The ignored
artifacts are reproducible through `npm run probe:canvas-images` and independently checked through
`npm run probe:canvas-images:validate`.

The checked-in runbook and worksheet require import, stored-HTML, render/alt, Files, shared and
duplicate asset, reimport, sharing/copy, re-export, and clean re-export-import evidence before issue
07 can select a production shape. No production cartridge code or browser export path changed.

Verification: both TypeScript projects, the 5 focused probe tests, all 101 test files / 911 tests,
repeat generation with pinned SHA-256 hashes, `unzip -t`, XML parsing, and raster media detection pass.
